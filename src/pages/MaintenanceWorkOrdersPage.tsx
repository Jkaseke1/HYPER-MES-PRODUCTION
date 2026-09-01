import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { Plus, Search, Wrench, Clock, CheckCircle2, AlertTriangle, Trash2, CreditCard as Edit2 } from 'lucide-react';
import type { MaintenanceWorkOrder, MaintenanceWorkOrderWithDetails } from '../types/maintenance';
import type { Machine, Branch, Profile } from '../types/database';
import { WORK_ORDER_TYPES, WORK_ORDER_STATUSES, PRIORITY_LEVELS } from '../types/maintenance';
import Modal from '../components/ui/Modal';
import StatCard from '../components/ui/StatCard';

export default function MaintenanceWorkOrdersPage() {
  const [workOrders, setWorkOrders] = useState<MaintenanceWorkOrderWithDetails[]>([]);
  const [machines, setMachines] = useState<Machine[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [users, setUsers] = useState<Profile[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [filterStatus, setFilterStatus] = useState<string>('all');
  const [filterPriority, setFilterPriority] = useState<string>('all');

  const [form, setForm] = useState<{
    wo_number: string;
    machine_id: string;
    branch_id: string;
    work_type: 'preventive' | 'corrective' | 'breakdown' | 'inspection' | 'calibration' | 'modification';
    priority: 'low' | 'medium' | 'high' | 'critical';
    status: 'open' | 'assigned' | 'in_progress' | 'on_hold' | 'completed' | 'cancelled';
    title: string;
    description: string;
    assigned_to: string;
    scheduled_date: string;
    estimated_duration_minutes: number;
    downtime_minutes: number;
    production_impact_qty: number;
    root_cause: string;
    corrective_action: string;
    labor_cost: number;
    parts_cost: number;
    notes: string;
  }>({
    wo_number: '',
    machine_id: '',
    branch_id: '',
    work_type: 'corrective',
    priority: 'medium',
    status: 'open',
    title: '',
    description: '',
    assigned_to: '',
    scheduled_date: '',
    estimated_duration_minutes: 60,
    downtime_minutes: 0,
    production_impact_qty: 0,
    root_cause: '',
    corrective_action: '',
    labor_cost: 0,
    parts_cost: 0,
    notes: ''
  });

  useEffect(() => {
    fetchData();
  }, []);

  async function fetchData() {
    setLoading(true);
    try {
      const [woRes, machinesRes, branchesRes, usersRes] = await Promise.all([
        supabase.from('maintenance_work_orders').select('*').order('created_at', { ascending: false }),
        supabase.from('machines').select('*').eq('is_active', true),
        supabase.from('branches').select('*').eq('is_active', true),
        supabase.from('profiles').select('*')
      ]);

      if (woRes.data) {
        const enriched = woRes.data.map(wo => ({
          ...wo,
          machine: machinesRes.data?.find(m => m.id === wo.machine_id),
          branch: branchesRes.data?.find(b => b.id === wo.branch_id),
          assigned_user: usersRes.data?.find(u => u.id === wo.assigned_to),
          reported_user: usersRes.data?.find(u => u.id === wo.reported_by)
        }));
        setWorkOrders(enriched);
      }
      if (machinesRes.data) setMachines(machinesRes.data);
      if (branchesRes.data) setBranches(branchesRes.data);
      if (usersRes.data) setUsers(usersRes.data);
    } catch (error) {
      console.error('Error fetching data:', error);
    } finally {
      setLoading(false);
    }
  }

  function openCreate() {
    const nextNum = (workOrders.length + 1).toString().padStart(5, '0');
    setForm({
      wo_number: `WO-${new Date().getFullYear()}-${nextNum}`,
      machine_id: '',
      branch_id: '',
      work_type: 'corrective',
      priority: 'medium',
      status: 'open',
      title: '',
      description: '',
      assigned_to: '',
      scheduled_date: '',
      estimated_duration_minutes: 60,
      downtime_minutes: 0,
      production_impact_qty: 0,
      root_cause: '',
      corrective_action: '',
      labor_cost: 0,
      parts_cost: 0,
      notes: ''
    });
    setEditingId(null);
    setShowModal(true);
  }

  function openEdit(wo: MaintenanceWorkOrder) {
    setForm({
      wo_number: wo.wo_number,
      machine_id: wo.machine_id,
      branch_id: wo.branch_id || '',
      work_type: wo.work_type,
      priority: wo.priority,
      status: wo.status,
      title: wo.title,
      description: wo.description || '',
      assigned_to: wo.assigned_to || '',
      scheduled_date: wo.scheduled_date || '',
      estimated_duration_minutes: wo.estimated_duration_minutes || 60,
      downtime_minutes: wo.downtime_minutes,
      production_impact_qty: wo.production_impact_qty,
      root_cause: wo.root_cause || '',
      corrective_action: wo.corrective_action || '',
      labor_cost: wo.labor_cost,
      parts_cost: wo.parts_cost,
      notes: wo.notes || ''
    });
    setEditingId(wo.id);
    setShowModal(true);
  }

  async function handleSave() {
    if (!form.wo_number || !form.machine_id || !form.title) {
      alert('Please fill in all required fields');
      return;
    }

    const total_cost = form.labor_cost + form.parts_cost;
    const payload = { ...form, total_cost };

    try {
      if (editingId) {
        await supabase.from('maintenance_work_orders').update(payload).eq('id', editingId);
      } else {
        await supabase.from('maintenance_work_orders').insert([payload]);
      }
      setShowModal(false);
      fetchData();
    } catch (error) {
      console.error('Error saving work order:', error);
      alert('Failed to save work order');
    }
  }

  async function handleDelete(id: string) {
    if (!confirm('Delete this work order?')) return;
    try {
      await supabase.from('maintenance_work_orders').delete().eq('id', id);
      fetchData();
    } catch (error) {
      console.error('Error deleting work order:', error);
    }
  }

  const filteredOrders = workOrders.filter(wo => {
    const matchesSearch = wo.wo_number.toLowerCase().includes(searchTerm.toLowerCase()) ||
                          wo.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
                          wo.machine?.name.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesStatus = filterStatus === 'all' || wo.status === filterStatus;
    const matchesPriority = filterPriority === 'all' || wo.priority === filterPriority;
    return matchesSearch && matchesStatus && matchesPriority;
  });

  const getStatusBadge = (status: string) => {
    const s = WORK_ORDER_STATUSES.find(st => st.value === status);
    return s ? <span className={`px-2 py-1 rounded text-xs font-medium ${s.color}`}>{s.label}</span> : status;
  };

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
          <h1 className="text-2xl font-bold text-slate-800">Maintenance Work Orders</h1>
          <p className="text-sm text-slate-500 mt-1">Manage preventive and corrective maintenance tasks</p>
        </div>
        <button onClick={openCreate} className="flex items-center gap-2 px-4 py-2.5 bg-teal-600 hover:bg-teal-700 text-white rounded-lg text-sm font-semibold transition-colors">
          <Plus className="w-4 h-4" /> New Work Order
        </button>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard title="Total Work Orders" value={workOrders.length} icon={Wrench} color="teal" />
        <StatCard title="Open / In Progress" value={workOrders.filter(w => ['open', 'in_progress', 'assigned'].includes(w.status)).length} icon={Clock} color="amber" />
        <StatCard title="Completed" value={workOrders.filter(w => w.status === 'completed').length} icon={CheckCircle2} color="emerald" />
        <StatCard title="Critical Priority" value={workOrders.filter(w => w.priority === 'critical').length} icon={AlertTriangle} color="red" />
      </div>

      <div className="bg-white rounded-xl border border-slate-200 p-4">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div className="relative">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input type="text" placeholder="Search work orders..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} className="w-full pl-10 pr-4 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500" />
          </div>
          <select value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)} className={sCls}>
            <option value="all">All Statuses</option>
            {WORK_ORDER_STATUSES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>
          <select value={filterPriority} onChange={(e) => setFilterPriority(e.target.value)} className={sCls}>
            <option value="all">All Priorities</option>
            {PRIORITY_LEVELS.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
          </select>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200">
                {['WO Number', 'Title', 'Machine', 'Type', 'Priority', 'Status', 'Assigned', 'Scheduled', 'Actions'].map(h => (
                  <th key={h} className="px-5 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredOrders.map(wo => (
                <tr key={wo.id} className="hover:bg-slate-50 transition-colors">
                  <td className="px-5 py-3 font-mono text-xs text-slate-600 font-medium">{wo.wo_number}</td>
                  <td className="px-5 py-3 text-slate-800 font-medium max-w-[180px] truncate">{wo.title}</td>
                  <td className="px-5 py-3 text-slate-600">{wo.machine?.name || '—'}</td>
                  <td className="px-5 py-3"><span className="px-2 py-0.5 bg-slate-100 text-slate-600 rounded text-xs font-medium capitalize">{wo.work_type.replace(/_/g, ' ')}</span></td>
                  <td className="px-5 py-3">{getPriorityBadge(wo.priority)}</td>
                  <td className="px-5 py-3">{getStatusBadge(wo.status)}</td>
                  <td className="px-5 py-3 text-slate-600">{wo.assigned_user?.full_name || '—'}</td>
                  <td className="px-5 py-3 text-slate-500 text-xs">{wo.scheduled_date || '—'}</td>
                  <td className="px-5 py-3">
                    <div className="flex items-center gap-1">
                      <button onClick={() => openEdit(wo)} className="flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-teal-700 bg-teal-50 hover:bg-teal-100 rounded-lg transition-colors"><Edit2 className="w-3 h-3" /> Edit</button>
                      <button onClick={() => handleDelete(wo.id)} className="flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-red-700 bg-red-50 hover:bg-red-100 rounded-lg transition-colors"><Trash2 className="w-3 h-3" /> Delete</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {filteredOrders.length === 0 && (
            <div className="text-center py-16">
              <Wrench className="w-10 h-10 text-slate-300 mx-auto mb-3" />
              <p className="text-slate-400 text-sm">No work orders found</p>
            </div>
          )}
        </div>
      </div>

      <Modal open={showModal} onClose={() => setShowModal(false)} title={editingId ? 'Edit Work Order' : 'New Work Order'} size="xl">
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div><label className="block text-xs font-medium text-slate-600 mb-1">WO Number *</label><input type="text" value={form.wo_number} onChange={(e) => setForm({...form, wo_number: e.target.value})} className={iCls} /></div>
            <div><label className="block text-xs font-medium text-slate-600 mb-1">Machine *</label><select value={form.machine_id} onChange={(e) => setForm({...form, machine_id: e.target.value})} className={sCls}><option value="">Select machine</option>{machines.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}</select></div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div><label className="block text-xs font-medium text-slate-600 mb-1">Branch</label><select value={form.branch_id} onChange={(e) => setForm({...form, branch_id: e.target.value})} className={sCls}><option value="">Select branch</option>{branches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}</select></div>
            <div><label className="block text-xs font-medium text-slate-600 mb-1">Work Type *</label><select value={form.work_type} onChange={(e) => setForm({...form, work_type: e.target.value as any})} className={sCls}>{WORK_ORDER_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}</select></div>
          </div>
          <div className="grid grid-cols-3 gap-4">
            <div><label className="block text-xs font-medium text-slate-600 mb-1">Priority *</label><select value={form.priority} onChange={(e) => setForm({...form, priority: e.target.value as any})} className={sCls}>{PRIORITY_LEVELS.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}</select></div>
            <div><label className="block text-xs font-medium text-slate-600 mb-1">Status *</label><select value={form.status} onChange={(e) => setForm({...form, status: e.target.value as any})} className={sCls}>{WORK_ORDER_STATUSES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}</select></div>
            <div><label className="block text-xs font-medium text-slate-600 mb-1">Scheduled Date</label><input type="date" value={form.scheduled_date} onChange={(e) => setForm({...form, scheduled_date: e.target.value})} className={iCls} /></div>
          </div>
          <div><label className="block text-xs font-medium text-slate-600 mb-1">Title *</label><input type="text" value={form.title} onChange={(e) => setForm({...form, title: e.target.value})} placeholder="Brief description of work" className={iCls} /></div>
          <div><label className="block text-xs font-medium text-slate-600 mb-1">Description</label><textarea value={form.description} onChange={(e) => setForm({...form, description: e.target.value})} rows={2} placeholder="Detailed description" className={`${iCls} resize-none`}></textarea></div>
          <div><label className="block text-xs font-medium text-slate-600 mb-1">Assigned To</label><select value={form.assigned_to} onChange={(e) => setForm({...form, assigned_to: e.target.value})} className={sCls}><option value="">Unassigned</option>{users.map(u => <option key={u.id} value={u.id}>{u.full_name}</option>)}</select></div>
          <div className="grid grid-cols-3 gap-4">
            <div><label className="block text-xs font-medium text-slate-600 mb-1">Est. Duration (min)</label><input type="number" value={form.estimated_duration_minutes} onChange={(e) => setForm({...form, estimated_duration_minutes: parseInt(e.target.value) || 0})} className={iCls} /></div>
            <div><label className="block text-xs font-medium text-slate-600 mb-1">Downtime (min)</label><input type="number" value={form.downtime_minutes} onChange={(e) => setForm({...form, downtime_minutes: parseInt(e.target.value) || 0})} className={iCls} /></div>
            <div><label className="block text-xs font-medium text-slate-600 mb-1">Production Impact (kg)</label><input type="number" value={form.production_impact_qty} onChange={(e) => setForm({...form, production_impact_qty: parseFloat(e.target.value) || 0})} className={iCls} /></div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div><label className="block text-xs font-medium text-slate-600 mb-1">Labor Cost</label><input type="number" step="0.01" value={form.labor_cost} onChange={(e) => setForm({...form, labor_cost: parseFloat(e.target.value) || 0})} className={iCls} /></div>
            <div><label className="block text-xs font-medium text-slate-600 mb-1">Parts Cost</label><input type="number" step="0.01" value={form.parts_cost} onChange={(e) => setForm({...form, parts_cost: parseFloat(e.target.value) || 0})} className={iCls} /></div>
          </div>
          <div><label className="block text-xs font-medium text-slate-600 mb-1">Root Cause</label><textarea value={form.root_cause} onChange={(e) => setForm({...form, root_cause: e.target.value})} rows={2} className={`${iCls} resize-none`}></textarea></div>
          <div><label className="block text-xs font-medium text-slate-600 mb-1">Corrective Action</label><textarea value={form.corrective_action} onChange={(e) => setForm({...form, corrective_action: e.target.value})} rows={2} className={`${iCls} resize-none`}></textarea></div>
          <div><label className="block text-xs font-medium text-slate-600 mb-1">Notes</label><textarea value={form.notes} onChange={(e) => setForm({...form, notes: e.target.value})} rows={2} className={`${iCls} resize-none`}></textarea></div>
          <div className="flex justify-end gap-3 pt-3 border-t border-slate-200">
            <button onClick={() => setShowModal(false)} className="px-4 py-2 text-sm font-medium text-slate-600 bg-slate-100 rounded-lg hover:bg-slate-200 transition-colors">Cancel</button>
            <button onClick={handleSave} className="px-5 py-2 text-sm font-semibold text-white bg-teal-600 rounded-lg hover:bg-teal-700 transition-colors">Save Work Order</button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
