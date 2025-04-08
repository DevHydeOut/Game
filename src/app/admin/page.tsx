'use client';

import { useEffect, useState } from 'react';
import { db } from '@/lib/firebase';
import {
  collection,
  addDoc,
  getDocs,
  query,
  where,
  orderBy,
  DocumentData,
  Timestamp
} from 'firebase/firestore';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Card, CardContent } from '@/components/ui/card';
import { FaSpinner, FaCalendarAlt, FaChartLine } from 'react-icons/fa';

interface SummaryItem {
  number: string;
  total: number;
  userCount: number;
  minAmount?: number;
}
interface TimeSlot {
  startTime: Date;
  endTime: Date;
  formattedTimeRange: string;
  entries: SummaryItem[];
  isCurrent?: boolean;
}

interface EntryData extends DocumentData {
  id?: string;
  number: string;
  amount: number;
  userId?: string;
  createdAt: Date;
  date: string;
  type: 'jodi' | 'single';
  pending?: boolean;
}

const getTimeSlotBoundaries = (dateStr: string) => {
  const slots: { start: Date; end: Date; formatted: string }[] = [];
  const baseDate = new Date(dateStr);
  baseDate.setHours(0, 0, 0, 0);
  
  for (let hour = 0; hour < 24; hour++) {
    for (let minute = 0; minute < 60; minute += 15) {
      const start = new Date(baseDate);
      start.setHours(hour, minute, 0, 0);
      
      const end = new Date(start);
      end.setMinutes(minute + 15);
      
      const formattedStart = start.toLocaleTimeString([], {
        hour: '2-digit',
        minute: '2-digit'
      });
      
      const formattedEnd = end.toLocaleTimeString([], {
        hour: '2-digit',
        minute: '2-digit'
      });
      
      const formatted = `${formattedStart} - ${formattedEnd}`;
      
      slots.push({ start, end, formatted });
    }
  }
  
  return slots.sort((a, b) => b.start.getTime() - a.start.getTime());
};

// Generate all possible numbers for jodi (01-99) or single (1-9)
const generateAllNumbers = (type: 'jodi' | 'single') => {
  if (type === 'single') {
    return Array.from({ length: 9 }, (_, i) => String(i + 1));
  } else {
    return Array.from({ length: 99 }, (_, i) => {
      const num = i + 1;
      return num < 10 ? `0${num}` : String(num);
    });
  }
};

export default function AdminPanel() {
  const [number, setNumber] = useState('');
  const [amount, setAmount] = useState('');
  const [type, setType] = useState<'jodi' | 'single'>('jodi');
  const [date, setDate] = useState(new Date().toISOString().split('T')[0]);
  const [selectedDate, setSelectedDate] = useState(new Date().toISOString().split('T')[0]);
  const [loading, setLoading] = useState(false);
  const [todaySummary, setTodaySummary] = useState<SummaryItem[]>([]);
  const [timeSlots, setTimeSlots] = useState<TimeSlot[]>([]);
  const [fetchingTimeSlots, setFetchingTimeSlots] = useState(false);
  const [pendingEntries, setPendingEntries] = useState<EntryData[]>([]);
  const [currentTimeSlot, setCurrentTimeSlot] = useState<TimeSlot | null>(null);
  const [currentSlotSummary, setCurrentSlotSummary] = useState<SummaryItem[]>([]);
  const [fetchingCurrentSlot, setFetchingCurrentSlot] = useState(false);

  const getCurrentTimeSlot = (): TimeSlot => {
    const now = new Date();
    const minutes = now.getMinutes();
    const slotStart = new Date(now);
    const slotEnd = new Date(now);
    
    const roundedMinutes = Math.floor(minutes / 15) * 15;
    slotStart.setMinutes(roundedMinutes, 0, 0);
    slotEnd.setMinutes(roundedMinutes + 15, 0, 0);
    
    const formattedStart = slotStart.toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit'
    });
    
    const formattedEnd = slotEnd.toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit'
    });
    
    return {
      startTime: slotStart,
      endTime: slotEnd,
      formattedTimeRange: `${formattedStart} - ${formattedEnd}`,
      entries: [],
      isCurrent: true
    };
  };

  useEffect(() => {
    const newTimeSlot = getCurrentTimeSlot();
    setCurrentTimeSlot(newTimeSlot);
    fetchCurrentSlotData(newTimeSlot);
    
    const interval = setInterval(() => {
      const updatedTimeSlot = getCurrentTimeSlot();
      setCurrentTimeSlot(updatedTimeSlot);
      fetchCurrentSlotData(updatedTimeSlot);
    }, 60000);
    
    return () => clearInterval(interval);
  }, [type]);

  const fetchCurrentSlotData = async (slot: TimeSlot) => {
    if (!slot) return;
    
    setFetchingCurrentSlot(true);
    
    try {
      const today = new Date().toISOString().split('T')[0];
      
      const q = query(
        collection(db, 'bets'),
        where('date', '==', today),
        where('type', '==', type),
        where('createdAt', '>=', slot.startTime),
        where('createdAt', '<', slot.endTime)
      );
      
      const snapshot = await getDocs(q);
      const allEntries = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data() as EntryData,
        createdAt: doc.data().createdAt.toDate()
      }));
      
      const numberMap = new Map<string, { total: number; users: Set<string> }>();
      
      // Initialize with all possible numbers
      generateAllNumbers(type).forEach(num => {
        numberMap.set(num, { total: 0, users: new Set() });
      });
      
      // Fill in data from entries
      allEntries.forEach(entry => {
        const number = entry.number;
        const userId = entry.userId || entry.id;
        
        if (!numberMap.has(number)) {
          numberMap.set(number, { total: 0, users: new Set() });
        }
        
        const data = numberMap.get(number)!;
        data.total += Number(entry.amount);
        data.users.add(userId);
      });
      
      const summaryItems = Array.from(numberMap.entries())
        .map(([number, info]) => ({
          number,
          total: info.total,
          userCount: info.users.size
        }));
      
      setCurrentSlotSummary(summaryItems);
    } catch (error) {
      console.error("Error fetching current slot data:", error);
    } finally {
      setFetchingCurrentSlot(false);
    }
  };

  const fetchPendingEntries = async () => {
    try {
      const q = query(
        collection(db, 'bets'),
        where('date', '==', date),
        where('type', '==', type),
        where('pending', '==', true)
      );
      
      const snapshot = await getDocs(q);
      const entries = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data() as EntryData,
        createdAt: doc.data().createdAt.toDate()
      }));
      
      setPendingEntries(entries);
    } catch (error) {
      console.error("Error fetching pending entries:", error);
    }
  };

  const processPendingEntries = async () => {
    if (!currentTimeSlot) return;
    
    try {
      setLoading(true);
      
      const previousSlotStart = new Date(currentTimeSlot.startTime);
      previousSlotStart.setMinutes(previousSlotStart.getMinutes() - 15);
      
      const previousSlotEnd = new Date(currentTimeSlot.startTime);
      
      const q = query(
        collection(db, 'bets'),
        where('date', '==', date),
        where('type', '==', type),
        where('createdAt', '>=', previousSlotStart),
        where('createdAt', '<', previousSlotEnd),
        where('pending', '==', true)
      );
      
      const snapshot = await getDocs(q);
      const batch = snapshot.docs;
      
      for (const doc of batch) {
        await addDoc(collection(db, 'bets'), {
          ...doc.data(),
          pending: false,
          processedAt: Timestamp.now()
        });
      }
      
      fetchSummary();
      fetchTimeSlotData();
      fetchPendingEntries();
      fetchCurrentSlotData(currentTimeSlot);
    } catch (error) {
      console.error("Error processing pending entries:", error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!currentTimeSlot) return;
    
    const now = new Date();
    const minutes = now.getMinutes();
    const seconds = now.getSeconds();
    
    if (minutes % 15 === 0 && seconds < 60) {
      processPendingEntries();
    }
  }, [currentTimeSlot]);

  const fetchSummary = async (fetchDate = selectedDate, fetchType = type) => {
    setLoading(true);
    
    try {
      const q = query(
        collection(db, 'bets'),
        where('date', '==', fetchDate),
        where('type', '==', fetchType),
        where('pending', '==', false)
      );

      const snapshot = await getDocs(q);
      const numberMap = new Map<string, { total: number; users: Set<string>; minAmount: number }>();
      
      // Initialize with all possible numbers
      generateAllNumbers(fetchType).forEach(num => {
        numberMap.set(num, { total: 0, users: new Set(), minAmount: Infinity });
      });

      snapshot.forEach((doc) => {
        const data = doc.data() as EntryData;
        const userId = data.userId || doc.id;
        const key = data.number;

        if (!numberMap.has(key)) {
          numberMap.set(key, { total: 0, users: new Set(), minAmount: Infinity });
        }

        const entry = numberMap.get(key)!;
        entry.total += Number(data.amount);
        entry.users.add(userId);
        if (Number(data.amount) > 0) {
          entry.minAmount = Math.min(entry.minAmount, Number(data.amount));
        }
      });

      const result = Array.from(numberMap.entries())
        .map(([number, info]) => ({
          number,
          total: info.total,
          userCount: info.users.size,
          minAmount: info.minAmount !== Infinity ? info.minAmount : 0
        }));

      setTodaySummary(result);
    } catch (error) {
      console.error("Error fetching summary:", error);
    } finally {
      setLoading(false);
    }
  };

  const fetchTimeSlotData = async (fetchDate = selectedDate, fetchType = type) => {
    setFetchingTimeSlots(true);
    
    try {
      const slots = getTimeSlotBoundaries(fetchDate);
      const results: TimeSlot[] = [];
      
      const q = query(
        collection(db, 'bets'),
        where('date', '==', fetchDate),
        where('type', '==', fetchType),
        where('pending', '==', false),
        orderBy('createdAt', 'asc')
      );
      
      const snapshot = await getDocs(q);
      const allEntries = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data() as EntryData,
        createdAt: doc.data().createdAt.toDate()
      }));
      
      for (const slot of slots) {
        const slotEntries = allEntries.filter(entry => 
          entry.createdAt >= slot.start && entry.createdAt < slot.end
        );
        
        // Create summary for each time slot with all possible numbers
        const numberMap = new Map<string, { total: number; users: Set<string>; minAmount: number }>();
        
        // Initialize with all possible numbers
        generateAllNumbers(fetchType).forEach(num => {
          numberMap.set(num, { total: 0, users: new Set(), minAmount: Infinity });
        });
        
        // Fill in data from entries
        slotEntries.forEach(entry => {
          const number = entry.number;
          const userId = entry.userId || entry.id;
          
          if (!numberMap.has(number)) {
            numberMap.set(number, { total: 0, users: new Set(), minAmount: Infinity });
          }
          
          const data = numberMap.get(number)!;
          data.total += Number(entry.amount);
          data.users.add(userId);
          if (Number(entry.amount) > 0) {
            data.minAmount = Math.min(data.minAmount, Number(entry.amount));
          }
        });
        
        const summaryItems = Array.from(numberMap.entries())
          .map(([number, info]) => ({
            number,
            total: info.total,
            userCount: info.users.size,
            minAmount: info.minAmount !== Infinity ? info.minAmount : 0
          }));
        
        // Only add slots that have at least one entry with value
        if (slotEntries.length > 0) {
          results.push({
            startTime: slot.start,
            endTime: slot.end,
            formattedTimeRange: slot.formatted,
            entries: summaryItems
          });
        }
      }
      
      setTimeSlots(results);
    } catch (error) {
      console.error("Error fetching time slot data:", error);
    } finally {
      setFetchingTimeSlots(false);
    }
  };

  useEffect(() => {
    fetchSummary();
    fetchTimeSlotData();
  }, [selectedDate, type]);

  useEffect(() => {
    fetchPendingEntries();
  }, [date, type]);

  const handleSubmit = async () => {
    if (type === 'single' && !/^[1-9]$/.test(number)) {
      alert('Enter a single number from 1 to 9 without leading zero');
      return;
    }

    if (type === 'jodi' && (!/^[0-9]{2}$/.test(number) || Number(number) < 1 || Number(number) > 99)) {
      alert('Enter a jodi number from 01 to 99 with leading zero if < 10');
      return;
    }

    if (!amount || isNaN(Number(amount)) || Number(amount) <= 0) {
      alert('Enter a valid amount');
      return;
    }

    try {
      setLoading(true);
      await addDoc(collection(db, 'bets'), {
        number,
        amount: Number(amount),
        type,
        date,
        createdAt: Timestamp.now(),
        pending: true
      });
      
      alert('Entry saved and will display at next 15-minute interval');
      setNumber('');
      setAmount('');
      fetchPendingEntries();
      fetchCurrentSlotData(currentTimeSlot!);
    } catch (error) {
      console.error('Error saving entry:', error);
      alert('Error saving entry');
    } finally {
      setLoading(false);
    }
  };

  // Filter active numbers - numbers with bets placed
  const getActiveNumbers = (items: SummaryItem[]) => {
    return items.filter(item => item.total > 0);
  };

  return (
    
    <div className="px-[10%] py-[5%] min-h-screen bg-gradient-to-br from-indigo-50 via-purple-50 to-pink-50">
       <h1 className="text-5xl font-extrabold text-center bg-clip-text text-transparent bg-gradient-to-r from-indigo-600 via-purple-600 to-pink-600 mb-12">
          Admin Dashboard
        </h1>

        <Tabs defaultValue="entry" className="w-full">
          <TabsList className="flex justify-center gap-6 mb-8 bg-white/80 backdrop-blur-sm p-2 rounded-xl shadow-lg">
            <TabsTrigger 
              value="entry" 
              className="px-6 py-3 text-lg font-medium transition-all duration-200 hover:bg-indigo-50 rounded-lg"
            >
              Entry
            </TabsTrigger>
            <TabsTrigger 
              value="current" 
              className="px-6 py-3 text-lg font-medium transition-all duration-200 hover:bg-purple-50 rounded-lg"
            >
              Current Status
            </TabsTrigger>
            <TabsTrigger 
              value="daily" 
              className="px-6 py-3 text-lg font-medium transition-all duration-200 hover:bg-pink-50 rounded-lg"
            >
              Daily Summary
            </TabsTrigger>
          </TabsList>
          
          
          <TabsContent value="entry">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
              {/* Entry Form */}
              <Card className="bg-white/90 backdrop-blur-sm shadow-xl border-0 rounded-2xl overflow-hidden">
                <div className="bg-gradient-to-r from-indigo-600 to-purple-600 text-white p-4">
                  <div className="flex items-center gap-3">
                    <FaChartLine className="text-xl" />
                    <span className="text-xl font-semibold">New Entry</span>
                  </div>
                </div>
                <CardContent className="p-6 space-y-6">
                  <div className="grid grid-cols-2 gap-6">
                    <div className="space-y-2">
                      <label className="block text-sm font-medium text-gray-700">Entry Type</label>
                      <select
                        value={type}
                        onChange={(e) => setType(e.target.value as 'jodi' | 'single')}
                        className="w-full px-4 py-3 rounded-xl border border-gray-200 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 transition-all duration-200"
                      >
                        <option value="jodi" className='text-black'>Jodi (01-99)</option>
                        <option value="single" className='text-black'>Single (1-9)</option>
                      </select>
                    </div>
                    <div className="space-y-2">
                      <label className="block text-sm font-medium text-gray-700">Date</label>
                      <div className="relative">
                        <input
                          type="date"
                          value={date}
                          onChange={(e) => setDate(e.target.value)}
                          className="w-full px-4 py-3 rounded-xl border border-gray-200 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 transition-all duration-200"
                        />
                        <FaCalendarAlt className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-400" />
                      </div>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <label className="block text-sm font-medium text-gray-700">
                      Number {type === 'jodi' ? '(01-99)' : '(1-9)'}
                    </label>
                    <Input
                      type="text"
                      placeholder={type === 'jodi' ? "Enter jodi number (e.g. 07)" : "Enter single number (e.g. 7)"}
                      value={number}
                      onChange={(e) => setNumber(e.target.value)}
                      className="w-full px-4 py-3 rounded-xl text-lg border-gray-200 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 transition-all duration-200"
                    />
                  </div>

                  <div className="space-y-2">
                    <label className="block text-sm font-medium text-gray-700">Amount (₹)</label>
                    <Input
                      type="number"
                      placeholder="Enter amount (e.g. 100)"
                      value={amount}
                      onChange={(e) => setAmount(e.target.value)}
                      className="w-full px-4 py-3 rounded-xl text-lg border-gray-200 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 transition-all duration-200"
                    />
                  </div>

                  <Button 
                    onClick={handleSubmit} 
                    disabled={loading} 
                    className="w-full bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-700 hover:to-purple-700 text-white font-medium py-3 text-lg rounded-xl transition-all duration-200"
                  >
                    {loading ? (
                      <div className="flex items-center justify-center gap-2">
                        <FaSpinner className="animate-spin" /> Saving Entry...
                      </div>
                    ) : 'Save Entry'}
                  </Button>
                </CardContent>
              </Card>

              {/* Pending Entries */}
              <Card className="bg-white/90 backdrop-blur-sm shadow-xl border-0 rounded-2xl overflow-hidden">
                <div className="bg-gradient-to-r from-amber-500 to-orange-500 text-white p-4">
                  <div className="flex items-center justify-between">
                    <span className="text-xl font-semibold">Pending Entries</span>
                    {currentTimeSlot && (
                      <span className="text-sm font-normal bg-white/20 px-3 py-1 rounded-full">
                        Will display at {currentTimeSlot.endTime.toLocaleTimeString([], {hour: '2-digit', minute: '2-digit'})}
                      </span>
                    )}
                  </div>
                </div>
                <CardContent className="p-0">
                  {pendingEntries.length > 0 ? (
                    <div className="divide-y divide-gray-100 max-h-[400px] overflow-y-auto">
                      {pendingEntries
                        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()) // Sort by latest first
                        .map((entry) => (
                          <div key={entry.id} className="grid grid-cols-3 px-6 py-4 hover:bg-gray-50 transition-colors duration-200">
                            <span className="font-medium text-lg text-gray-900">{entry.number}</span>
                            <span className="text-green-600 font-medium">₹{entry.amount}</span>
                            <span className="text-gray-500 text-right">
                              {entry.createdAt.toLocaleTimeString([], {hour: '2-digit', minute: '2-digit'})}
                            </span>
                          </div>
                        ))}
                    </div>
                  ) : (
                    <div className="flex items-center justify-center py-12 text-gray-500">
                      <p className="text-center">No pending entries</p>
                    </div>
                  )}
                </CardContent>
              </Card>

            </div>
          </TabsContent>

          <TabsContent value="current">
            <Card className="bg-white/90 backdrop-blur-sm shadow-xl border-0 rounded-2xl overflow-hidden">
              <div className="bg-gradient-to-r from-indigo-500 to-indigo-600 text-white p-4">
                <div className="flex items-center justify-between">
                  <span className="text-xl font-semibold">Current Status ({currentTimeSlot?.formattedTimeRange})</span>
                  <Button 
                    variant="outline" 
                    onClick={() => currentTimeSlot && fetchCurrentSlotData(currentTimeSlot)}
                    disabled={fetchingCurrentSlot}
                    className="bg-white/20 text-white hover:bg-white/30"
                  >
                    {fetchingCurrentSlot ? (
                      <><FaSpinner className="animate-spin mr-2" /> Refreshing</>
                    ) : 'Refresh'}
                  </Button>
                </div>
              </div>
              <CardContent className="p-0">
                {fetchingCurrentSlot ? (
                  <div className="flex justify-center items-center py-12">
                    <FaSpinner className="animate-spin text-indigo-600 text-2xl" />
                  </div>
                ) : (
                  <div className="p-4">
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                      {/* Active Numbers - numbers with bets */}
                      <Card className="border border-gray-200">
                        <div className="bg-gradient-to-r from-green-500 to-green-600 text-white p-4">
                          <div className="text-base font-semibold">Active Numbers</div>
                        </div>
                        <CardContent className="p-0 max-h-[400px] overflow-y-auto">
                          <table className="w-full">
                            <thead className="bg-gray-50 sticky top-0">
                              <tr>
                                <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Number</th>
                                <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Users</th>
                                <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Amount (₹)</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-200">
                              {getActiveNumbers(currentSlotSummary).length > 0 ? (
                                getActiveNumbers(currentSlotSummary)
                                  .sort((a, b) => b.total - a.total)
                                  .map((item) => (
                                  <tr key={item.number} className="hover:bg-gray-50">
                                    <td className="px-4 py-3 font-medium">{item.number}</td>
                                    <td className="px-4 py-3">{item.userCount}</td>
                                    <td className="px-4 py-3 text-green-600 font-medium">{item.total}</td>
                                  </tr>
                                ))
                              ) : (
                                <tr>
                                  <td colSpan={3} className="px-4 py-3 text-center text-gray-500">No active numbers</td>
                                </tr>
                              )}
                            </tbody>
                          </table>
                        </CardContent>
                      </Card>
                      
                      {/* All Numbers */}
                      <Card className="border border-gray-200 col-span-1 md:col-span-2">
                        <div className="bg-gradient-to-r from-blue-500 to-blue-600 text-white p-4">
                          <div className="text-base font-semibold">All Numbers ({type === 'jodi' ? '01-99' : '1-9'})</div>
                        </div>
                        <CardContent className="p-0 max-h-[400px] overflow-y-auto">
                          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2 p-4">
                            {currentSlotSummary.map((item) => (
                              <div 
                                key={item.number}
                                className={`p-3 border rounded-lg flex justify-between items-center ${
                                  item.total > 0 ? 'bg-blue-50 border-blue-200' : 'bg-gray-50 border-gray-200'
                                }`}
                              >
                                <span className="font-medium">{item.number}</span>
                                <div className="flex gap-4">
                                  <span className="text-gray-600">{item.userCount} users</span>
                                  <span className={`font-medium ${item.total > 0 ? 'text-green-600' : 'text-gray-500'}`}>
                                    ₹{item.total}
                                  </span>
                                </div>
                              </div>
                            ))}
                          </div>
                        </CardContent>
                      </Card>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="daily">
            <Card className="bg-white/90 backdrop-blur-sm shadow-xl border-0 rounded-2xl overflow-hidden">
              <div className="bg-gradient-to-r from-green-500 to-green-600 text-white p-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="text-xl font-semibold">Daily Summary</span>
                    <select
                      value={type}
                      onChange={(e) => setType(e.target.value as 'jodi' | 'single')}
                      className="ml-4 bg-white/20 text-white border-0 rounded-md px-2 py-1 text-sm"
                    >
                      <option value="jodi" className='text-black'>Jodi (01-99)</option>
                      <option value="single" className='text-black'>Single (1-9)</option>
                    </select>
                  </div>
                  <div className="flex items-center gap-2">
                    <input
                      type="date"
                      value={selectedDate}
                      onChange={(e) => setSelectedDate(e.target.value)}
                      className="bg-white/20 text-white border-0 rounded-md px-2 py-1"
                    />
                    <Button 
                      variant="outline" 
                      onClick={() => {
                        fetchSummary();
                      }}
                      disabled={loading}
                      className="bg-white/20 text-white hover:bg-white/30"
                    >
                      {loading ? (
                        <><FaSpinner className="animate-spin mr-2" /> Loading</>
                      ) : 'Refresh'}
                    </Button>
                  </div>
                </div>
              </div>
              
              <CardContent className="p-0">
                {fetchingTimeSlots ? (
                  <div className="flex justify-center items-center py-12">
                    <FaSpinner className="animate-spin text-green-600 text-2xl" />
                  </div>
                ) : timeSlots.length > 0 ? (
                  <div className="p-4 max-h-[70vh] overflow-y-auto">
                    <div className="space-y-8">
                      {timeSlots.map((slot, index) => (
                        <Card key={index} className="border border-gray-200">
                          <div className="bg-gradient-to-r from-purple-500 to-purple-600 text-white p-4">
                            <div className="text-base font-semibold">
                              Numbers for {slot.formattedTimeRange} timeframe
                            </div>
                          </div>
                          <CardContent className="p-4">
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                              {/* Active Numbers in this time slot */}
                              <div className="overflow-x-auto">
                                <h4 className="text-md font-medium mb-2 text-gray-700">Active Numbers</h4>
                                <table className="w-full">
                                  <thead className="bg-gray-50">
                                    <tr>
                                      <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Number</th>
                                      <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Users</th>
                                      <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Amount (₹)</th>
                                    </tr>
                                  </thead>
                                  <tbody className="divide-y divide-gray-200">
                                    {getActiveNumbers(slot.entries).length > 0 ? (
                                      getActiveNumbers(slot.entries)
                                        .sort((a, b) => b.total - a.total)
                                        .map((item) => (
                                        <tr key={item.number} className="hover:bg-gray-50">
                                          <td className="px-3 py-2 font-medium">{item.number}</td>
                                          <td className="px-3 py-2">{item.userCount}</td>
                                          <td className="px-3 py-2 text-green-600 font-medium">₹{item.total}</td>
                                        </tr>
                                      ))
                                    ) : (
                                      <tr>
                                        <td colSpan={3} className="px-3 py-2 text-center text-gray-500">No active numbers</td>
                                      </tr>
                                    )}
                                  </tbody>
                                </table>
                              </div>          
                  {/* All Numbers Distribution */}
                              <div>
                                <h4 className="text-md font-medium mb-2 text-gray-700">Number Distribution</h4>
                                  <div className="grid grid-cols-3 lg:grid-cols-5 gap-2 max-h-[300px] overflow-y-auto">
                                    {getActiveNumbers(todaySummary).map((item) => (
                                      <div 
                                        key={item.number}
                                        className="p-2 border rounded-lg text-center bg-blue-50 border-blue-200"
                                      >
                                        <div className="font-medium">{item.number}</div>
                                        <div className="text-green-600 font-medium">₹{item.total}</div>
                                        <div className="text-xs text-gray-500">{item.userCount} users</div>
                                      </div>
                                    ))}
                                  </div>
                              </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    ) : (
      <div className="flex justify-center items-center py-12 text-gray-500">
        <p>No time slot data available for the selected date</p>
      </div>
    )}
  </CardContent>
</Card>
</TabsContent>
</Tabs>
</div>
)}