import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { Plus, Search, Calendar, Clock, AlertTriangle, CheckCircle2, Trash2, CreditCard as Edit2 } from 'lucide-react';
import type { MaintenanceSchedule, MaintenanceScheduleWithDetails } from '../types/maintenance';
import type { Machine, Profile } from '../types/database';
import { MAINTENANCE_TYPES, FREQUENCY_TYPES, PRIORITY_LEVELS } from '../types/maintenance';
import Modal from '../components/ui/Modal';
import StatCard from '../components/ui/StatCard';

export default function MaintenanceSchedulePage() {
  const [schedules, setSchedules] = useState<MaintenanceScheduleWithDetails[]>([]);
  const [machines, setMachines] = useState<Machine[]>([]);
  const [users, setUsers] = useState<Profile[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');

  const [form, setForm] = useState<{
    schedule_code: string;
    machine_id: string;
    title: string;
    description: string;
    maintenance_type: 'preventive' | 'inspection' | 'calibration' | 'lubrication' | 'cleaning';
    frequency_type: 'daily' | 'weekly' | 'monthly' | 'quarterly' | 'yearly' | 'hours_based' | 'cycles_based';
    frequency_value: number;
    estimated_duration_minutes: number;
    next_due_date: string;
    assigned_to: string;
    priority: 'low' | 'medium' | 'high' | 'critical';
    is_active: boolean;
  }>({
    schedule_code: '',
    machine_id: '',
    title: '',
    description: '',
    maintenance_type: 'preventive',
    frequency_type: 'monthly',
    frequency_value: 1,
    estimated_duration_minutes: 60,
    next_due_date: '',
    assigned_to: '',
    priority: 'medium',
    is_active: true
  });

  useEffect(() => {
    fetchData();
  }, []);

  async function fetchData() {
    setLoading(true);
    try {
      const [schedulesRes, machinesRes, usersRes] = await Promise.all([
        supabase.from('maintenance_schedules').select('*').order('next_due_date'),
        supabase.from('machines').select('*').eq('is_active', true),
        supabase.from('profiles').select('*')
      ]);

      if (schedulesRes.data) {
        const enriched = schedulesRes.data.map(s => ({
          ...s,
          machine: machinesRes.data?.find(m => m.id === s.machine_id),
          assigned_user: usersRes.data?.find(u => u.id === s.assigned_to)
        }));
        setSchedules(enriched);
      }
      if (machinesRes.data) setMachines(machinesRes.data);
      if (usersRes.data) setUsers(usersRes.data);
    } catch (error) {
      console.error('Error fetching data:', error);
    } finally {
      setLoading(false);
    }
  }

  function openCreate() {
    const nextNum = (schedules.length + 1).toString().padStart(4, '0');
    setForm({
      schedule_code: `SCH-${nextNum}`,
      machine_id: '',
      title: '',
      description: '',
      maintenance_type: 'preventive',
      frequency_type: 'monthly',
      frequency_value: 1,
      estimated_duration_minutes: 60,
      next_due_date: '',
      assigned_to: '',
      priority: 'medium',
      is_active: true
    });
    setEditingId(null);
    setShowModal(true);
  }

  function openEdit(schedule: MaintenanceSchedule) {
    setForm({
      schedule_code: schedule.schedule_code,
      machine_id: schedule.machine_id,
      title: schedule.title,
      description: schedule.description || '',
      maintenance_type: schedule.maintenance_type,
      frequency_type: schedule.frequency_type,
      frequency_value: schedule.frequency_value,
      estimated_duration_minutes: schedule.estimated_duration_minutes,
      next_due_date: schedule.next_due_date || '',
      assigned_to: schedule.assigned_to || '',
      priority: schedule.priority,
      is_active: schedule.is_active
    });
    setEditingId(schedule.id);
    setShowModal(true);
  }

  async function handleSave() {
    if (!form.schedule_code || !form.machine_id || !form.title) {
      alert('Please fill in all required fields');
      return;
    }

    try {
      if (editingId) {
        await supabase.from('maintenance_schedules').update(form).eq('id', editingId);
      } else {
        await supabase.from('maintenance_schedules').insert([form]);
      }
      setShowModal(false);
      fetchData();
    } catch (error) {
      console.error('Error saving schedule:', error);
      alert('Failed to save schedule');
    }
  }

  async function handleDelete(id: string) {
    if (!confirm('Delete this schedule?')) return;
    try {
      await supabase.from('maintenance_schedules').delete().eq('id', id);
      fetchData();
    } catch (error) {
      console.error('Error deleting schedule:', error);
    }
  }

  const filteredSchedules = schedules.filter(s => {
    const matchesSearch = s.schedule_code.toLowerCase().includes(searchTerm.toLowerCase()) ||
                          s.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
                          s.machine?.name.toLowerCase().includes(searchTerm.toLowerCase());
    return matchesSearch;
  });

  const dueSoon = schedules.filter(s => {
    if (!s.next_due_date || !s.is_active) return false;
    const dueDate = new Date(s.next_due_date);
    const today = new Date();
    const daysUntilDue = Math.ceil((dueDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
    return daysUntilDue >= 0 && daysUntilDue <= 7;
  });

  const overdue = schedules.filter(s => {
    if (!s.next_due_date || !s.is_active) return false;
    const dueDate = new Date(s.next_due_date);
    const today = new Date();
    return dueDate < today;
  });

  const getPriorityBadge = (priority: string) => {
    const p = PRIORITY_LEVELS.find(pr => pr.value === priority);
    return p ? <span className={`px-2 py-1 rounded text-xs font-medium ${p.color}`}>{p.label}</span> : priority;
  };

  const iCls = 'w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500';
  const sCls = `${iCls} bg-white`;

  if (loading) return (
    <div className="flex items-center justify-center h-96">
      <div className="w-8 h-8 border-2 border-slate-200 border-t-teal-600 rounded-full animate-spin" />
    </div>
  );

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">Maintenance Schedules</h1>
          <p className="text-sm text-slate-500 mt-1">Preventive maintenance planning and scheduling</p>
        </div>
        <button onClick={openCreate} className="flex items-center gap-2 px-4 py-2.5 bg-teal-600 hover:bg-teal-700 text-white rounded-lg text-sm font-semibold transition-colors">
          <Plus className="w-4 h-4" /> New Schedule
        </button>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard title="Active Schedules" value={schedules.filter(s => s.is_active).length} icon={Calendar} color="teal" />
        <StatCard title="Due This Week" value={dueSoon.length} icon={Clock} color="amber" />
        <StatCard title="Overdue" value={overdue.length} icon={AlertTriangle} color="red" />
        <StatCard title="Completed (Inactive)" value={schedules.filter(s => !s.is_active).length} icon={CheckCircle2} color="emerald" />
      </div>

      <div className="bg-white rounded-xl border border-slate-200 p-4">
        <div className="relative max-w-sm">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input type="text" placeholder="Search schedules..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} className="w-full pl-10 pr-4 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500" />
        </div>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200">
                {['Code', 'Title', 'Machine', 'Type', 'Frequency', 'Next Due', 'Priority', 'Assigned', 'Actions'].map(h => (
                  <th key={h} className="px-5 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredSchedules.map(schedule => {
                const isOverdue = schedule.next_due_date && new Date(schedule.next_due_date) < new Date();
                const isDueSoon = schedule.next_due_date && !isOverdue &&
                  Math.ceil((new Date(schedule.next_due_date).getTime() - new Date().getTime()) / (1000 * 60 * 60 * 24)) <= 7;
                return (
                  <tr key={schedule.id} className={`hover:bg-slate-50 transition-colors ${isOverdue ? 'bg-red-50/50' : isDueSoon ? 'bg-amber-50/50' : ''}`}>
                    <td className="px-5 py-3 font-mono text-xs text-slate-600 font-medium">{schedule.schedule_code}</td>
                    <td className="px-5 py-3 text-slate-800 font-medium max-w-[180px] truncate">{schedule.title}</td>
                    <td className="px-5 py-3 text-slate-600">{schedule.machine?.name || '—'}</td>
                    <td className="px-5 py-3"><span className="px-2 py-0.5 bg-slate-100 text-slate-600 rounded text-xs font-medium capitalize">{schedule.maintenance_type}</span></td>
                    <td className="px-5 py-3 text-slate-600 text-xs">{schedule.frequency_value} {schedule.frequency_type.replace(/_/g, ' ')}</td>
                    <td className="px-5 py-3 text-xs">
                      {schedule.next_due_date
                        ? <span className={`font-medium ${isOverdue ? 'text-red-600' : isDueSoon ? 'text-amber-600' : 'text-slate-700'}`}>{schedule.next_due_date}</span>
                        : <span className="text-slate-400">—</span>}
                    </td>
                    <td className="px-5 py-3">{getPriorityBadge(schedule.priority)}</td>
                    <td className="px-5 py-3 text-slate-600">{schedule.assigned_user?.full_name || '—'}</td>
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-1">
                        <button onClick={() => openEdit(schedule)} className="flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-teal-700 bg-teal-50 hover:bg-teal-100 rounded-lg transition-colors"><Edit2 className="w-3 h-3" /> Edit</button>
                        <button onClick={() => handleDelete(schedule.id)} className="flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-red-700 bg-red-50 hover:bg-red-100 rounded-lg transition-colors"><Trash2 className="w-3 h-3" /> Delete</button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {filteredSchedules.length === 0 && (
            <div className="text-center py-16">
              <Calendar className="w-10 h-10 text-slate-300 mx-auto mb-3" />
              <p className="text-slate-400 text-sm">No schedules found</p>
            </div>
          )}
        </div>
      </div>

      <Modal open={showModal} onClose={() => setShowModal(false)} title={editingId ? 'Edit Schedule' : 'New Schedule'} size="lg">
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div><label className="block text-xs font-medium text-slate-600 mb-1">Schedule Code *</label><input type="text" value={form.schedule_code} onChange={(e) => setForm({...form, schedule_code: e.target.value})} className={iCls} /></div>
            <div><label className="block text-xs font-medium text-slate-600 mb-1">Machine *</label><select value={form.machine_id} onChange={(e) => setForm({...form, machine_id: e.target.value})} className={sCls}><option value="">Select machine</option>{machines.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}</select></div>
          </div>
          <div><label className="block text-xs font-medium text-slate-600 mb-1">Title *</label><input type="text" value={form.title} onChange={(e) => setForm({...form, title: e.target.value})} placeholder="e.g., Monthly mixer blade inspection" className={iCls} /></div>
          <div><label className="block text-xs font-medium text-slate-600 mb-1">Description</label><textarea value={form.description} onChange={(e) => setForm({...form, description: e.target.value})} rows={2} className={`${iCls} resize-none`}></textarea></div>
          <div className="grid grid-cols-2 gap-4">
            <div><label className="block text-xs font-medium text-slate-600 mb-1">Maintenance Type *</label><select value={form.maintenance_type} onChange={(e) => setForm({...form, maintenance_type: e.target.value as any})} className={sCls}>{MAINTENANCE_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}</select></div>
            <div><label className="block text-xs font-medium text-slate-600 mb-1">Priority *</label><select value={form.priority} onChange={(e) => setForm({...form, priority: e.target.value as any})} className={sCls}>{PRIORITY_LEVELS.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}</select></div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div><label className="block text-xs font-medium text-slate-600 mb-1">Frequency Type *</label><select value={form.frequency_type} onChange={(e) => setForm({...form, frequency_type: e.target.value as any})} className={sCls}>{FREQUENCY_TYPES.map(f => <option key={f.value} value={f.value}>{f.label}</option>)}</select></div>
            <div><label className="block text-xs font-medium text-slate-600 mb-1">Frequency Value *</label><input type="number" value={form.frequency_value} onChange={(e) => setForm({...form, frequency_value: parseInt(e.target.value) || 1})} min="1" className={iCls} /></div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div><label className="block text-xs font-medium text-slate-600 mb-1">Est. Duration (min)</label><input type="number" value={form.estimated_duration_minutes} onChange={(e) => setForm({...form, estimated_duration_minutes: parseInt(e.target.value) || 0})} className={iCls} /></div>
            <div><label className="block text-xs font-medium text-slate-600 mb-1">Next Due Date</label><input type="date" value={form.next_due_date} onChange={(e) => setForm({...form, next_due_date: e.target.value})} className={iCls} /></div>
          </div>
          <div><label className="block text-xs font-medium text-slate-600 mb-1">Assigned To</label><select value={form.assigned_to} onChange={(e) => setForm({...form, assigned_to: e.target.value})} className={sCls}><option value="">Unassigned</option>{users.map(u => <option key={u.id} value={u.id}>{u.full_name}</option>)}</select></div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={form.is_active} onChange={(e) => setForm({...form, is_active: e.target.checked})} className="rounded border-slate-300 text-teal-600 focus:ring-teal-500" />
            <span className="font-medium text-slate-700">Active</span>
          </label>
          <div className="flex justify-end gap-3 pt-3 border-t border-slate-200">
            <button onClick={() => setShowModal(false)} className="px-4 py-2 text-sm font-medium text-slate-600 bg-slate-100 rounded-lg hover:bg-slate-200 transition-colors">Cancel</button>
            <button onClick={handleSave} className="px-5 py-2 text-sm font-semibold text-white bg-teal-600 rounded-lg hover:bg-teal-700 transition-colors">Save Schedule</button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
