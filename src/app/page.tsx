'use client';

import { useEffect, useState } from 'react';
import { auth, db } from '@/lib/firebase';
import { onAuthStateChanged, signInWithPopup, GoogleAuthProvider, User } from 'firebase/auth';
import { collection, getDocs, query, where, orderBy, DocumentData } from 'firebase/firestore';
import { FaBell, FaSyncAlt, FaClock } from 'react-icons/fa';
import { Button } from '@/components/ui/button';

interface EntryData extends DocumentData {
  id?: string;
  number: string;
  amount: number;
  userId?: string;
  createdAt: Date;
  date: string;
  type: 'jodi' | 'single';
}

interface TimeSlot {
  time: string;
  timeKey: string;
  entries: EntryData[];
}

interface AggregatedBet {
  number: string;
  amount: number;
  userCount: number;
}

export default function YourGameApp() {
  const [user, setUser] = useState<User | null>(null);
  const [timeSlots, setTimeSlots] = useState<TimeSlot[]>([]);
  const [viewType, setViewType] = useState<'jodi' | 'single'>('jodi');
  const [selectedDate, setSelectedDate] = useState(new Date());
  const [isLoading, setIsLoading] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [testTime, setTestTime] = useState<string>('');
  const [showTestOptions, setShowTestOptions] = useState(false);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, setUser);
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    if (user) fetchData();
  }, [user, viewType, selectedDate]);

  useEffect(() => {
    if (!user) return;
    const interval = setInterval(() => {
      const now = new Date();
      if (now.getMinutes() % 15 === 0) {
        fetchData();
      }
    }, 60000);
    return () => clearInterval(interval);
  }, [user]);

  const getTimeSlotKey = (date: Date): string => {
    const slotEnd = new Date(date);
    const minutes = slotEnd.getMinutes();
    const roundedMinutes = Math.ceil((minutes + 1) / 15) * 15;
    slotEnd.setMinutes(roundedMinutes);
    slotEnd.setSeconds(0);
    slotEnd.setMilliseconds(0);
    return slotEnd.toISOString();
  };

  const formatTimeForDisplay = (dateString: string): string => {
    try {
      const date = new Date(dateString);
      return isNaN(date.getTime())
        ? 'Invalid'
        : date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    } catch {
      return 'Invalid';
    }
  };

  const fetchData = async (customTime?: Date) => {
    if (isLoading) return;
    try {
      setIsLoading(true);
      const dateStr = selectedDate.toISOString().split('T')[0];
      const betsRef = collection(db, 'bets');
      const q = query(
        betsRef,
        where('type', '==', viewType),
        where('date', '==', dateStr),
        orderBy('createdAt', 'desc')
      );

      const snapshot = await getDocs(q);

      const rawData = snapshot.docs.map(doc => {
        const data = doc.data();
        let createdAt: Date;
        try {
          createdAt = data.createdAt?.toDate?.() || new Date(data.createdAt);
          if (isNaN(createdAt.getTime())) throw new Error();
        } catch {
          createdAt = new Date();
        }
        return { ...data, id: doc.id, createdAt } as EntryData;
      });

      const now = customTime || new Date();

      const groupedSlots: Record<string, Record<string, { amount: number, users: Set<string> }>> = {};

      // Modify this part of the fetchData function where you're processing the bets
      rawData.forEach(entry => {
        const slotKey = getTimeSlotKey(entry.createdAt);
        const slotTime = new Date(slotKey);

        if (slotTime <= now) {
          if (!groupedSlots[slotKey]) {
            groupedSlots[slotKey] = {};
          }
          if (!groupedSlots[slotKey][entry.number]) {
            groupedSlots[slotKey][entry.number] = {
              amount: 0,
              users: new Set<string>()
            };
          }
          groupedSlots[slotKey][entry.number].amount += entry.amount;
          if (entry.userId) {
            groupedSlots[slotKey][entry.number].users.add(entry.userId);
          } else {
            // For entries without userId, use a fallback unique ID to still count them as separate users
            groupedSlots[slotKey][entry.number].users.add(`anonymous-${Date.now()}-${Math.random()}`);
          }
        }
      });

      const timeSlotsArray: TimeSlot[] = Object.entries(groupedSlots)
        .map(([timeKey, numberData]) => {
          const entries = Object.entries(numberData).map(([number, data]) => ({
            number,
            amount: data.amount,
            userCount: data.users.size || 1,
            createdAt: new Date(timeKey),
            date: dateStr,
            type: viewType
          } as EntryData & { userCount: number }));

          return {
            timeKey,
            time: formatTimeForDisplay(timeKey),
            entries
          };
        })
        .sort((a, b) => new Date(b.timeKey).getTime() - new Date(a.timeKey).getTime());

      setTimeSlots(timeSlotsArray);
      setLastUpdated(new Date());
    } catch (error) {
      console.error('Error fetching data:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const signIn = async () => {
    const provider = new GoogleAuthProvider();
    await signInWithPopup(auth, provider);
  };

  const handleTestTimeSubmit = () => {
    if (!testTime) return;
    const [hours, minutes] = testTime.split(':').map(Number);
    const testDate = new Date(selectedDate);
    testDate.setHours(hours, minutes, 0, 0);
    fetchData(testDate);
  };

  const toggleTestOptions = () => {
    setShowTestOptions(!showTestOptions);
  };

  if (!user) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-gray-50">
        <div className="p-8 bg-white rounded-lg shadow-sm">
          <h1 className="text-2xl font-semibold text-gray-800 mb-6">Your Game</h1>
          <Button 
            onClick={signIn}
            className="w-full bg-blue-600 hover:bg-blue-700 text-white font-medium py-2 px-4 rounded-md transition-colors"
          >
            Login with Google
          </Button>
        </div>
      </div>
    );
  }

  
  return (
    <div className="bg-blue-50 min-h-screen p-2">
      <div className="bg-blue-600 text-white rounded-xl px-4 py-2 flex items-center justify-between">
        <div>
          <h1 className="text-lg font-bold">Your Game</h1>
          <p className="text-xs">{selectedDate.toISOString().split('T')[0]}</p>
        </div>
        <div className="flex items-center gap-2">
          <select
            className="bg-blue-500 text-white text-sm rounded px-2 py-1"
            value={viewType}
            onChange={(e) => setViewType(e.target.value as 'jodi' | 'single')}
          >
            <option value="jodi">Jodi</option>
            <option value="single">Single</option>
          </select>
          <FaBell />
          <FaSyncAlt onClick={() => fetchData()} className={`cursor-pointer ${isLoading ? 'animate-spin' : ''}`} />
          <FaClock onClick={toggleTestOptions} className="cursor-pointer" />
        </div>
      </div>

      <div className="bg-black text-white text-center p-1 mt-2 text-sm rounded">
        Online Game play ke liye whatsapp kare 98885-66541
      </div>

      <div className="mt-2 flex flex-col gap-2">
        <div className="flex justify-between items-center">
          <input
            type="date"
            value={selectedDate.toISOString().split('T')[0]}
            onChange={(e) => setSelectedDate(new Date(e.target.value))}
            className="text-sm border rounded p-1"
          />
          {lastUpdated && (
            <div className="text-xs text-gray-600">
              Last updated: {lastUpdated.toLocaleTimeString()}
            </div>
          )}
        </div>
        {showTestOptions && (
          <div className="flex gap-2 items-center bg-blue-100 p-2 rounded">
            <label className="text-xs">Test Time:</label>
            <input
              type="time"
              value={testTime}
              onChange={(e) => setTestTime(e.target.value)}
              className="text-sm border rounded p-1"
            />
            <Button onClick={handleTestTimeSubmit}>Apply Time</Button>
          </div>
        )}
      </div>

      <div className="mt-4 bg-white rounded-lg shadow overflow-hidden">
        <div className="grid grid-cols-5 bg-blue-100 font-semibold text-center py-2 text-sm">
          <div>Sr.</div>
          <div>Time</div>
          <div>A</div>
          <div className="text-pink-600">B</div>
          <div className="text-red-500">C</div>
        </div>

        {timeSlots.map((slot, index) => {
         const aggregatedBets: AggregatedBet[] = [];
         const numberUserMap = new Map<string, Set<string>>();
         const numberAmountMap = new Map<string, number>();

         slot.entries.forEach(entry => {
          const { number, amount, userId } = entry;
          if (!numberAmountMap.has(number)) {
            numberAmountMap.set(number, 0);
            numberUserMap.set(number, new Set<string>());
          }
          
          numberAmountMap.set(number, numberAmountMap.get(number)! + amount);
          
          // Use the ID if available, otherwise create a unique ID for this entry
          const userIdentifier = userId || `entry-${entry.id || Date.now()}-${Math.random()}`;
          numberUserMap.get(number)!.add(userIdentifier);
        });

          // After processing all entries, create the aggregated bets
          numberAmountMap.forEach((amount, number) => {
            const userCount = numberUserMap.get(number)!.size;
            console.log(`Number ${number}: Amount=${amount}, Users=${userCount}`);
            
            aggregatedBets.push({
              number,
              amount,
              userCount: userCount
            });
          });



console.log('Aggregated bets before sorting:', aggregatedBets);


const maxNumber = viewType === 'single' ? 9 : 99;
const allNumbersWithBets = Array.from({ length: maxNumber + 1 }, (_, i) => {
  const num = i.toString().padStart(viewType === 'jodi' ? 2 : 1, '0');
  const existingBet = aggregatedBets.find(bet => bet.number === num);
  return existingBet || { number: num, amount: Infinity, userCount: Infinity };
}).filter(item => viewType === 'single' || item.number !== '00');

          // Add after the numberAmountMap forEach loop
          console.log('Aggregated bets before sorting:', aggregatedBets);


          const leastBetNumbers = allNumbersWithBets
          .filter(item => item.amount !== Infinity)
          .sort((a, b) => {
            console.log(`Comparing ${a.number}(₹${a.amount}, ${a.userCount} users) vs ${b.number}(₹${b.amount}, ${b.userCount} users)`);
            
            // Primary sort: by amount (lowest first)
            if (a.amount !== b.amount) {
              return a.amount - b.amount;
            }
            
            console.log(`  Amount tie between ${a.number} and ${b.number}, checking user count`);
            // First tie-breaker: by user count (lowest first)
            if (a.userCount !== b.userCount) {
              return a.userCount - b.userCount;
            }
            
            console.log(`  User count tie between ${a.number} and ${b.number}, using number value`);
            // Second tie-breaker: by number value (lowest first)
            return parseInt(a.number) - parseInt(b.number);
          })
          .slice(0, 3)
          .map(item => item.number);

// If we don't have enough numbers, pad with dashes
while (leastBetNumbers.length < 3) {
  leastBetNumbers.push('-');
}


          // Add after the sorting
          console.log('Sorted least bet numbers:', leastBetNumbers);

          return (
            <div key={slot.timeKey} className={`grid grid-cols-5 text-center text-sm py-2 ${index % 2 === 0 ? 'bg-blue-50' : 'bg-white'}`}>
              <div>{index + 1}</div>
              <div>{slot.time}</div>
              <div>{leastBetNumbers[0] || '-'}</div>
              <div className="text-pink-600">{leastBetNumbers[1] || '-'}</div>
              <div className="text-red-500">{leastBetNumbers[2] || '-'}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}