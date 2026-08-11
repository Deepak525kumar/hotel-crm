"use client";

import { useEffect, useState } from "react";
import { calendarApi, DailyShiftSummary, DailyShiftSummaryPayload } from "@/lib/api";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

interface ShiftSummaryPanelProps {
  hotelId: string;
  dateStr: string; // ISO yyyy-mm-dd or similar to query
  canWrite: boolean;
}

export function ShiftSummaryPanel({ hotelId, dateStr, canWrite }: ShiftSummaryPanelProps) {
  const [summary, setSummary] = useState<DailyShiftSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [editing, setEditing] = useState(false);
  
  const [form, setForm] = useState<DailyShiftSummaryPayload>({
    total_rooms: 0,
    stay_over_rooms: 0,
    checkout_rooms: 0,
    total_people_working: 0,
    notes: "",
  });

  useEffect(() => {
    if (!hotelId || !dateStr) return;
    
    let active = true;
    setLoading(true);
    
    calendarApi.listShiftSummaries(hotelId, dateStr, dateStr)
      .then((res) => {
        if (!active) return;
        if (res.length > 0) {
          setSummary(res[0]);
          setForm({
            total_rooms: res[0].total_rooms,
            stay_over_rooms: res[0].stay_over_rooms,
            checkout_rooms: res[0].checkout_rooms,
            total_people_working: res[0].total_people_working,
            notes: res[0].notes ?? "",
          });
        } else {
          setSummary(null);
        }
      })
      .catch((err) => console.error("Failed to load shift summary:", err))
      .finally(() => {
        if (active) setLoading(false);
      });
      
    return () => { active = false; };
  }, [hotelId, dateStr]);

  const handleSave = async () => {
    if (!hotelId || !dateStr) return;
    try {
      setLoading(true);
      const updated = await calendarApi.upsertShiftSummary(hotelId, dateStr, form);
      setSummary(updated);
      setEditing(false);
    } catch (err) {
      console.error("Failed to save shift summary:", err);
      alert("Failed to save shift summary");
    } finally {
      setLoading(false);
    }
  };

  if (loading && !summary && !editing) {
    return <div className="text-sm text-gray-500">Loading daily summary...</div>;
  }

  if (!editing) {
    return (
      <Card className="p-4 border border-blue-100 bg-blue-50/30 dark:border-blue-900/30 dark:bg-blue-900/10 mb-4">
        <div className="flex justify-between items-center mb-3">
          <h3 className="text-sm font-semibold text-blue-900 dark:text-blue-100">Daily Shift Summary</h3>
          {canWrite && (
            <Button variant="outline" size="sm" onClick={() => setEditing(true)}>
              {summary ? "Edit" : "Add Details"}
            </Button>
          )}
        </div>
        
        {summary ? (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-sm">
            <div>
              <p className="text-gray-500 dark:text-gray-400 text-xs uppercase tracking-wider mb-1">Total Rooms</p>
              <p className="font-medium">{summary.total_rooms}</p>
            </div>
            <div>
              <p className="text-gray-500 dark:text-gray-400 text-xs uppercase tracking-wider mb-1">Stay-over</p>
              <p className="font-medium">{summary.stay_over_rooms}</p>
            </div>
            <div>
              <p className="text-gray-500 dark:text-gray-400 text-xs uppercase tracking-wider mb-1">Checkout</p>
              <p className="font-medium">{summary.checkout_rooms}</p>
            </div>
            <div>
              <p className="text-gray-500 dark:text-gray-400 text-xs uppercase tracking-wider mb-1">Workers</p>
              <p className="font-medium">{summary.total_people_working}</p>
            </div>
            {summary.notes && (
              <div className="col-span-2 sm:col-span-4 mt-2 pt-2 border-t border-blue-100/50 dark:border-blue-800/50">
                <p className="text-gray-500 dark:text-gray-400 text-xs uppercase tracking-wider mb-1">Notes</p>
                <p className="text-gray-700 dark:text-gray-300 whitespace-pre-wrap">{summary.notes}</p>
              </div>
            )}
          </div>
        ) : (
          <p className="text-sm text-gray-500 italic">No summary added for this day.</p>
        )}
      </Card>
    );
  }

  return (
    <Card className="p-4 border-blue-200 bg-white dark:bg-gray-900 mb-4 shadow-sm ring-1 ring-blue-500">
      <h3 className="text-sm font-semibold mb-3">Edit Daily Shift Summary</h3>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4 text-sm">
        <div>
          <label className="block text-xs font-medium mb-1">Total Rooms</label>
          <Input 
            type="number" min={0} value={form.total_rooms} 
            onChange={e => setForm({...form, total_rooms: parseInt(e.target.value) || 0})}
          />
        </div>
        <div>
          <label className="block text-xs font-medium mb-1">Stay-over</label>
          <Input 
            type="number" min={0} value={form.stay_over_rooms} 
            onChange={e => setForm({...form, stay_over_rooms: parseInt(e.target.value) || 0})}
          />
        </div>
        <div>
          <label className="block text-xs font-medium mb-1">Checkout</label>
          <Input 
            type="number" min={0} value={form.checkout_rooms} 
            onChange={e => setForm({...form, checkout_rooms: parseInt(e.target.value) || 0})}
          />
        </div>
        <div>
          <label className="block text-xs font-medium mb-1">Workers</label>
          <Input 
            type="number" min={0} value={form.total_people_working} 
            onChange={e => setForm({...form, total_people_working: parseInt(e.target.value) || 0})}
          />
        </div>
      </div>
      <div className="mb-4">
        <label className="block text-xs font-medium mb-1">Notes (What work was done today?)</label>
        <Textarea 
          rows={3} value={form.notes} 
          onChange={e => setForm({...form, notes: e.target.value})}
        />
      </div>
      <div className="flex gap-2 justify-end">
        <Button variant="outline" size="sm" onClick={() => setEditing(false)} disabled={loading}>
          Cancel
        </Button>
        <Button size="sm" onClick={handleSave} disabled={loading}>
          {loading ? "Saving..." : "Save Summary"}
        </Button>
      </div>
    </Card>
  );
}
