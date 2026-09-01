import { useState, useEffect } from 'react';
import { Wrench, Plus, AlertTriangle, Clock, DollarSign, CheckCircle, Eye, Edit2 } from 'lucide-react';
import { format } from 'date-fns';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../context/AuthContext';
import Modal from '../../components/ui/Modal';
import StatCard from '../../components/ui/StatCard';
import toast from 'react-hot-toast';

interface WorkOrder {
  id: string;
  wo_number: string;
  schedule_id?: string;
  machine_id: string;
  work_type: 'preventive' | 'corrective' | 'breakdown' | 'inspection' | 'calibration' | 'modification';
  priority: 'low' | 'medium' | 'high' | 'critical';
  status: 'open' | 'assigned' | 'in_progress' | 'on_hold' | 'completed' | 'cancelled';
  title: string;
  description?: string;
  reported_by?: string;
  assigned_to?: string;
  scheduled_date?: string;
  started_at?: string;
  completed_at?: string;
  estimated_duration_minutes?: number;
  actual_duration_minutes?: number;
  downtime_minutes: number;
  production_impact_qty: number;
  root_cause?: string;
  corrective_action?: string;
  labor_cost: number;
  parts_cost: number;
  total_cost: number;
  notes?: string;
  created_at: string;
  machines?: { name: string; code: string };
  assigned_to_profile?: { full_name: string };
  reported_by_profile?: { full_name: string };
}

interface Machine {
  id: string;
  name: string;
  code: string;
}

interface User {
  id: string;
  full_name: string;
}

export default function MaintenanceWorkOrdersPage() {
  const { profile } = useAuth();
  const [workOrders, setWorkOrders] = useState<WorkOrder[]>([]);
  const [machines, setMachines] = useState<Machine[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddModal, setShowAddModal] = useState(false);
  const [showDetailModal, setShowDetailModal] = useState(false);
  const [selectedWO, setSelectedWO] = useState<WorkOrder | null>(null);
  const [saving, setSaving] = useState(false);
  const [filterStatus, setFilterStatus] = useState('all');
  const [filterPriority, setFilterPriority] = useState('all');

  const [newWO, setNewWO] = useState({
    machine_id: '',
    work_type: 'corrective' as const,
    priority: 'medium' as const,
    title: '',
    description: '',
    assigned_to: '',
    scheduled_date: format(new Date(), 'yyyy-MM-dd'),
    estimated_duration_minutes: 60,
  });

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    setLoading(true);
    const [woRes, machinesRes, usersRes] = await Promise.all([
      supabase
        .from('maintenance_work_orders')
        .select('*, machines(name, code), assigned_to_profile:assigned_to(full_name), reported_by_profile:reported_by(full_name)')
        .order('created_at', { ascending: false }),
      supabase.from('machines').select('id, name, code').eq('is_active', true).order('name'),
      supabase.from('profiles').select('id, full_name').order('full_name'),
    ]);

    if (woRes.data) setWorkOrders(woRes.data as WorkOrder[]);
    if (machinesRes.data) setMachines(machinesRes.data);
    if (usersRes.data) setUsers(usersRes.data);
    setLoading(false);
  };

  const handleAddWO = async () => {
    if (!newWO.machine_id || !newWO.title.trim()) {
      toast.error('Please fill in required fields');
      return;
    }

    setSaving(true);
    try {
      const maxWO = workOrders.length > 0
        ? Math.max(...workOrders.map(w => parseInt(w.wo_number.replace('WO-', '')) || 0))
        : 0;
      const woNumber = `WO-${String(maxWO + 1).padStart(5, '0')}`;

      const { error } = await supabase.from('maintenance_work_orders').insert({
        wo_number: woNumber,
        machine_id: newWO.machine_id,
        work_type: newWO.work_type,
        priority: newWO.priority,
        status: 'open',
        title: newWO.title,
        description: newWO.description || null,
        reported_by: profile?.id,
        assigned_to: newWO.assigned_to || null,
        scheduled_date: newWO.scheduled_date,
        estimated_duration_minutes: newWO.estimated_duration_minutes,
        downtime_minutes: 0,
        production_impact_qty: 0,
        labor_cost: 0,
        parts_cost: 0,
        total_cost: 0,
      });

      if (error) throw error;

      toast.success('Work Order created');
      setShowAddModal(false);
      setNewWO({
        machine_id: '',
        work_type: 'corrective',
        priority: 'medium',
        title: '',
        description: '',
        assigned_to: '',
        scheduled_date: format(new Date(), 'yyyy-MM-dd'),
        estimated_duration_minutes: 60,
      });
      fetchData();
    } catch (error: any) {
      console.error('Error creating work order:', error);
      toast.error(`Failed to create work order: ${error.message}`);
    } finally {
      setSaving(false);
    }
  };

  const handleUpdateWO = async (updates: Partial<WorkOrder>) => {
    if (!selectedWO) return;

    setSaving(true);
    try {
      const { error } = await supabase
        .from('maintenance_work_orders')
        .update(updates)
        .eq('id', selectedWO.id);

      if (error) throw error;

      toast.success('Work Order updated');
      setShowDetailModal(false);
      setSelectedWO(null);
      fetchData();
    } catch (error: any) {
      console.error('Error updating work order:', error);
      toast.error(`Failed to update work order: ${error.message}`);
    } finally {
      setSaving(false);
    }
  };

  const handleChangeStatus = async (id: string, newStatus: WorkOrder['status']) => {
    const updates: any = { status: newStatus };
    if (newStatus === 'in_progress' && !workOrders.find(w => w.id === id)?.started_at) {
      updates.started_at = new Date().toISOString();
    }
    if (newStatus === 'completed') {
      updates.completed_at = new Date().toISOString();
    }

    const { error } = await supabase
      .from('maintenance_work_orders')
      .update(updates)
      .eq('id', id);

    if (error) {
      toast.error('Failed to update status');
    } else {
      toast.success('Status updated');
      fetchData();
    }
  };

  const filteredWOs = workOrders.filter(wo => {
    if (filterStatus !== 'all' && wo.status !== filterStatus) return false;
    if (filterPriority !== 'all' && wo.priority !== filterPriority) return false;
    return true;
  });

  const openCount = workOrders.filter(w => w.status === 'open').length;
  const inProgressCount = workOrders.filter(w => w.status === 'in_progress').length;
  const criticalCount = workOrders.filter(w => w.priority === 'critical' && w.status !== 'completed').length;
  const completedCount = workOrders.filter(w => w.status === 'completed').length;

  const getPriorityColor = (priority: string) => {
    switch (priority) {
      case 'critical': return 'bg-red-100 text-red-800';
      case 'high': return 'bg-orange-100 text-orange-800';
      case 'medium': return 'bg-yellow-100 text-yellow-800';
      case 'low': return 'bg-gray-100 text-gray-800';
      default: return 'bg-gray-100 text-gray-800';
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'open': return 'bg-blue-100 text-blue-800';
      case 'assigned': return 'bg-indigo-100 text-indigo-800';
      case 'in_progress': return 'bg-amber-100 text-amber-800';
      case 'on_hold': return 'bg-gray-100 text-gray-800';
      case 'completed': return 'bg-green-100 text-green-800';
      case 'cancelled': return 'bg-red-100 text-red-800';
      default: return 'bg-gray-100 text-gray-800';
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="w-8 h-8 border-2 border-slate-200 border-t-teal-600 rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Work Orders</h1>
          <p className="text-sm text-gray-500 mt-1">Maintenance work order management</p>
        </div>
        <button
          onClick={() => setShowAddModal(true)}
          className="px-4 py-2 bg-teal-600 text-white rounded-lg hover:bg-teal-700 transition-colors flex items-center space-x-2"
        >
          <Plus className="h-4 w-4" />
          <span>New Work Order</span>
        </button>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <StatCard icon={Wrench} title="Open" value={openCount} subtitle="Awaiting assignment" color="blue" />
        <StatCard icon={Clock} title="In Progress" value={inProgressCount} subtitle="Active work" color="amber" />
        <StatCard icon={AlertTriangle} title="Critical Priority" value={criticalCount} subtitle="Urgent attention" color="red" />
        <StatCard icon={CheckCircle} title="Completed" value={completedCount} subtitle="Finished work" color="teal" />
      </div>

      {/* Filters */}
      <div className="flex items-center space-x-4">
        <div className="flex items-center space-x-2">
          <span className="text-sm font-medium text-gray-700">Status:</span>
          <select
            value={filterStatus}
            onChange={(e) => setFilterStatus(e.target.value)}
            className="px-3 py-1.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-teal-500 focus:border-teal-500"
          >
            <option value="all">All</option>
            <option value="open">Open</option>
            <option value="assigned">Assigned</option>
            <option value="in_progress">In Progress</option>
            <option value="on_hold">On Hold</option>
            <option value="completed">Completed</option>
          </select>
        </div>
        <div className="flex items-center space-x-2">
          <span className="text-sm font-medium text-gray-700">Priority:</span>
          <select
            value={filterPriority}
            onChange={(e) => setFilterPriority(e.target.value)}
            className="px-3 py-1.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-teal-500 focus:border-teal-500"
          >
            <option value="all">All</option>
            <option value="critical">Critical</option>
            <option value="high">High</option>
            <option value="medium">Medium</option>
            <option value="low">Low</option>
          </select>
        </div>
      </div>

      {/* Work Orders Table */}
      <div className="bg-white rounded-lg shadow overflow-hidden">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">WO Number</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Title</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Machine</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Type</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Priority</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Status</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Scheduled</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Assigned To</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Actions</th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {filteredWOs.length === 0 ? (
                <tr>
                  <td colSpan={9} className="px-6 py-8 text-center text-gray-500">
                    No work orders found
                  </td>
                </tr>
              ) : (
                filteredWOs.map((wo) => (
                  <tr key={wo.id} className="hover:bg-gray-50">
                    <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                      {wo.wo_number}
                    </td>
                    <td className="px-6 py-4 text-sm text-gray-900">
                      <div>
                        <p className="font-medium">{wo.title}</p>
                        {wo.description && (
                          <p className="text-xs text-gray-500 mt-0.5 line-clamp-1">{wo.description}</p>
                        )}
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                      {wo.machines?.name || '—'}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 capitalize">
                      {wo.work_type}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span className={`px-2 py-1 text-xs font-medium rounded-full ${getPriorityColor(wo.priority)}`}>
                        {wo.priority.charAt(0).toUpperCase() + wo.priority.slice(1)}
                      </span>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span className={`px-2 py-1 text-xs font-medium rounded-full ${getStatusColor(wo.status)}`}>
                        {wo.status.replace('_', ' ').charAt(0).toUpperCase() + wo.status.replace('_', ' ').slice(1)}
                      </span>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                      {wo.scheduled_date ? format(new Date(wo.scheduled_date), 'dd MMM yyyy') : '—'}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                      {wo.assigned_to_profile?.full_name || 'Unassigned'}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm space-x-2">
                      <button
                        onClick={() => {
                          setSelectedWO(wo);
                          setShowDetailModal(true);
                        }}
                        className="text-teal-600 hover:text-teal-900"
                        title="View Details"
                      >
                        <Eye className="h-4 w-4" />
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Add WO Modal */}
      {showAddModal && (
        <Modal
          open={showAddModal}
          onClose={() => setShowAddModal(false)}
          title="New Work Order"
          size="lg"
        >
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Machine <span className="text-red-600">*</span>
                </label>
                <select
                  value={newWO.machine_id}
                  onChange={(e) => setNewWO({ ...newWO, machine_id: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-teal-500"
                >
                  <option value="">Select machine...</option>
                  {machines.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name} ({m.code})
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Work Type</label>
                <select
                  value={newWO.work_type}
                  onChange={(e) => setNewWO({ ...newWO, work_type: e.target.value as any })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-teal-500"
                >
                  <option value="preventive">Preventive</option>
                  <option value="corrective">Corrective</option>
                  <option value="breakdown">Breakdown</option>
                  <option value="inspection">Inspection</option>
                </select>
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Title <span className="text-red-600">*</span>
              </label>
              <input
                type="text"
                value={newWO.title}
                onChange={(e) => setNewWO({ ...newWO, title: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-teal-500"
                placeholder="Brief description of work"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Description</label>
              <textarea
                value={newWO.description}
                onChange={(e) => setNewWO({ ...newWO, description: e.target.value })}
                rows={3}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-teal-500"
                placeholder="Detailed description..."
              />
            </div>

            <div className="grid grid-cols-3 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Priority</label>
                <select
                  value={newWO.priority}
                  onChange={(e) => setNewWO({ ...newWO, priority: e.target.value as any })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-teal-500"
                >
                  <option value="low">Low</option>
                  <option value="medium">Medium</option>
                  <option value="high">High</option>
                  <option value="critical">Critical</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Scheduled Date</label>
                <input
                  type="date"
                  value={newWO.scheduled_date}
                  onChange={(e) => setNewWO({ ...newWO, scheduled_date: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-teal-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Est. Duration (min)</label>
                <input
                  type="number"
                  min="1"
                  value={newWO.estimated_duration_minutes}
                  onChange={(e) => setNewWO({ ...newWO, estimated_duration_minutes: parseInt(e.target.value) || 60 })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-teal-500"
                />
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Assigned To</label>
              <select
                value={newWO.assigned_to}
                onChange={(e) => setNewWO({ ...newWO, assigned_to: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-teal-500"
              >
                <option value="">Unassigned</option>
                {users.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.full_name}
                  </option>
                ))}
              </select>
            </div>

            <div className="flex justify-end space-x-3 pt-4">
              <button
                onClick={() => setShowAddModal(false)}
                className="px-4 py-2 text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                onClick={handleAddWO}
                disabled={saving}
                className="px-4 py-2 bg-teal-600 text-white rounded-lg hover:bg-teal-700 disabled:opacity-50"
              >
                {saving ? 'Creating...' : 'Create Work Order'}
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* Detail/Edit Modal */}
      {showDetailModal && selectedWO && (
        <Modal
          open={showDetailModal}
          onClose={() => {
            setShowDetailModal(false);
            setSelectedWO(null);
          }}
          title={`Work Order ${selectedWO.wo_number}`}
          size="xl"
        >
          <div className="space-y-6">
            {/* Header Info */}
            <div className="grid grid-cols-3 gap-4 p-4 bg-gray-50 rounded-lg">
              <div>
                <p className="text-xs text-gray-500">Machine</p>
                <p className="text-sm font-medium text-gray-900">{selectedWO.machines?.name}</p>
              </div>
              <div>
                <p className="text-xs text-gray-500">Work Type</p>
                <p className="text-sm font-medium text-gray-900 capitalize">{selectedWO.work_type}</p>
              </div>
              <div>
                <p className="text-xs text-gray-500">Priority</p>
                <span className={`inline-block px-2 py-1 text-xs font-medium rounded-full ${getPriorityColor(selectedWO.priority)}`}>
                  {selectedWO.priority.charAt(0).toUpperCase() + selectedWO.priority.slice(1)}
                </span>
              </div>
            </div>

            {/* Status Change */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Status</label>
              <div className="flex items-center space-x-2">
                {['open', 'assigned', 'in_progress', 'on_hold', 'completed'].map((status) => (
                  <button
                    key={status}
                    onClick={() => handleChangeStatus(selectedWO.id, status as any)}
                    className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${
                      selectedWO.status === status
                        ? 'bg-teal-600 text-white'
                        : 'bg-white text-gray-700 border border-gray-300 hover:bg-gray-50'
                    }`}
                  >
                    {status.replace('_', ' ').charAt(0).toUpperCase() + status.replace('_', ' ').slice(1)}
                  </button>
                ))}
              </div>
            </div>

            {/* Completion Details (if completed) */}
            {selectedWO.status === 'completed' && (
              <div className="space-y-4 p-4 bg-green-50 rounded-lg border border-green-200">
                <h3 className="text-sm font-semibold text-green-900">Completion Details</h3>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-medium text-gray-700 mb-1">Actual Duration (min)</label>
                    <input
                      type="number"
                      value={selectedWO.actual_duration_minutes || ''}
                      onChange={(e) => setSelectedWO({ ...selectedWO, actual_duration_minutes: parseInt(e.target.value) || undefined })}
                      className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded focus:ring-2 focus:ring-teal-500"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-700 mb-1">Downtime (min)</label>
                    <input
                      type="number"
                      value={selectedWO.downtime_minutes}
                      onChange={(e) => setSelectedWO({ ...selectedWO, downtime_minutes: parseInt(e.target.value) || 0 })}
                      className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded focus:ring-2 focus:ring-teal-500"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-700 mb-1">Labor Cost (USD)</label>
                    <input
                      type="number"
                      step="0.01"
                      value={selectedWO.labor_cost}
                      onChange={(e) => setSelectedWO({ ...selectedWO, labor_cost: parseFloat(e.target.value) || 0 })}
                      className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded focus:ring-2 focus:ring-teal-500"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-700 mb-1">Parts Cost (USD)</label>
                    <input
                      type="number"
                      step="0.01"
                      value={selectedWO.parts_cost}
                      onChange={(e) => setSelectedWO({ ...selectedWO, parts_cost: parseFloat(e.target.value) || 0 })}
                      className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded focus:ring-2 focus:ring-teal-500"
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">Root Cause</label>
                  <textarea
                    value={selectedWO.root_cause || ''}
                    onChange={(e) => setSelectedWO({ ...selectedWO, root_cause: e.target.value })}
                    rows={2}
                    className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded focus:ring-2 focus:ring-teal-500"
                    placeholder="What caused the issue?"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">Corrective Action</label>
                  <textarea
                    value={selectedWO.corrective_action || ''}
                    onChange={(e) => setSelectedWO({ ...selectedWO, corrective_action: e.target.value })}
                    rows={2}
                    className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded focus:ring-2 focus:ring-teal-500"
                    placeholder="What was done to fix it?"
                  />
                </div>
              </div>
            )}

            {/* Notes */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Notes</label>
              <textarea
                value={selectedWO.notes || ''}
                onChange={(e) => setSelectedWO({ ...selectedWO, notes: e.target.value })}
                rows={3}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-teal-500"
                placeholder="Additional notes..."
              />
            </div>

            <div className="flex justify-end space-x-3 pt-4 border-t">
              <button
                onClick={() => {
                  setShowDetailModal(false);
                  setSelectedWO(null);
                }}
                className="px-4 py-2 text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50"
              >
                Close
              </button>
              <button
                onClick={() => handleUpdateWO(selectedWO)}
                disabled={saving}
                className="px-4 py-2 bg-teal-600 text-white rounded-lg hover:bg-teal-700 disabled:opacity-50"
              >
                {saving ? 'Saving...' : 'Save Changes'}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
