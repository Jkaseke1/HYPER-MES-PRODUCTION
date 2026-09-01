import { useState, useEffect } from 'react';
import { Calendar, Plus, AlertTriangle, CheckCircle, Clock, Wrench, RefreshCw } from 'lucide-react';
import { format, addDays, addWeeks, addMonths, addYears, isPast, isWithinInterval, startOfWeek, endOfWeek } from 'date-fns';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../context/AuthContext';
import Modal from '../../components/ui/Modal';
import StatCard from '../../components/ui/StatCard';
import toast from 'react-hot-toast';

interface PMSchedule {
  id: string;
  schedule_code: string;
  machine_id: string;
  title: string;
  description?: string;
  maintenance_type: 'preventive' | 'inspection' | 'calibration' | 'lubrication' | 'cleaning';
  frequency_type: 'daily' | 'weekly' | 'monthly' | 'quarterly' | 'yearly' | 'hours_based' | 'cycles_based';
  frequency_value: number;
  estimated_duration_minutes: number;
  last_performed_date?: string;
  next_due_date?: string;
  assigned_to?: string;
  priority: 'low' | 'medium' | 'high' | 'critical';
  is_active: boolean;
  created_at: string;
  machines?: { name: string; code: string };
  assigned_to_profile?: { full_name: string };
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

export default function MaintenancePMSchedulesPage() {
  const { profile } = useAuth();
  const [schedules, setSchedules] = useState<PMSchedule[]>([]);
  const [machines, setMachines] = useState<Machine[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddModal, setShowAddModal] = useState(false);
  const [saving, setSaving] = useState(false);
  const [filter, setFilter] = useState<'all' | 'active' | 'overdue' | 'due_soon'>('all');

  const [newSchedule, setNewSchedule] = useState({
    machine_id: '',
    title: '',
    description: '',
    maintenance_type: 'preventive' as const,
    frequency_type: 'monthly' as const,
    frequency_value: 1,
    estimated_duration_minutes: 60,
    next_due_date: format(new Date(), 'yyyy-MM-dd'),
    assigned_to: '',
    priority: 'medium' as const,
  });

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    setLoading(true);
    const [schedulesRes, machinesRes, usersRes] = await Promise.all([
      supabase
        .from('maintenance_schedules')
        .select('*, machines(name, code), assigned_to_profile:assigned_to(full_name)')
        .order('next_due_date', { ascending: true }),
      supabase.from('machines').select('id, name, code').eq('is_active', true).order('name'),
      supabase.from('profiles').select('id, full_name').order('full_name'),
    ]);

    if (schedulesRes.data) setSchedules(schedulesRes.data as PMSchedule[]);
    if (machinesRes.data) setMachines(machinesRes.data);
    if (usersRes.data) setUsers(usersRes.data);
    setLoading(false);
  };

  const handleAddSchedule = async () => {
    if (!newSchedule.machine_id || !newSchedule.title.trim()) {
      toast.error('Please fill in required fields');
      return;
    }

    setSaving(true);
    try {
      const maxCode = schedules.length > 0
        ? Math.max(...schedules.map(s => parseInt(s.schedule_code.replace('PM-', '')) || 0))
        : 0;
      const scheduleCode = `PM-${String(maxCode + 1).padStart(4, '0')}`;

      const { error } = await supabase.from('maintenance_schedules').insert({
        schedule_code: scheduleCode,
        machine_id: newSchedule.machine_id,
        title: newSchedule.title,
        description: newSchedule.description || null,
        maintenance_type: newSchedule.maintenance_type,
        frequency_type: newSchedule.frequency_type,
        frequency_value: newSchedule.frequency_value,
        estimated_duration_minutes: newSchedule.estimated_duration_minutes,
        next_due_date: newSchedule.next_due_date,
        assigned_to: newSchedule.assigned_to || null,
        priority: newSchedule.priority,
        is_active: true,
      });

      if (error) throw error;

      toast.success('PM Schedule created');
      setShowAddModal(false);
      setNewSchedule({
        machine_id: '',
        title: '',
        description: '',
        maintenance_type: 'preventive',
        frequency_type: 'monthly',
        frequency_value: 1,
        estimated_duration_minutes: 60,
        next_due_date: format(new Date(), 'yyyy-MM-dd'),
        assigned_to: '',
        priority: 'medium',
      });
      fetchData();
    } catch (error: any) {
      console.error('Error creating schedule:', error);
      toast.error(`Failed to create schedule: ${error.message}`);
    } finally {
      setSaving(false);
    }
  };

  const handleGenerateWorkOrder = async (schedule: PMSchedule) => {
    setSaving(true);
    try {
      // Get next WO number
      const { data: existingWOs } = await supabase
        .from('maintenance_work_orders')
        .select('wo_number')
        .order('wo_number', { ascending: false })
        .limit(1);

      const maxWO = existingWOs && existingWOs.length > 0
        ? parseInt(existingWOs[0].wo_number.replace('WO-', '')) || 0
        : 0;
      const woNumber = `WO-${String(maxWO + 1).padStart(5, '0')}`;

      // Create work order
      const { error: woError } = await supabase.from('maintenance_work_orders').insert({
        wo_number: woNumber,
        schedule_id: schedule.id,
        machine_id: schedule.machine_id,
        work_type: schedule.maintenance_type === 'preventive' ? 'preventive' : 'inspection',
        priority: schedule.priority,
        status: 'open',
        title: schedule.title,
        description: schedule.description,
        reported_by: profile?.id,
        assigned_to: schedule.assigned_to,
        scheduled_date: schedule.next_due_date,
        estimated_duration_minutes: schedule.estimated_duration_minutes,
      });

      if (woError) throw woError;

      // Update schedule: set last_performed_date to next_due_date, calculate new next_due_date
      const currentDue = new Date(schedule.next_due_date || new Date());
      let newDueDate: Date;

      switch (schedule.frequency_type) {
        case 'daily':
          newDueDate = addDays(currentDue, schedule.frequency_value);
          break;
        case 'weekly':
          newDueDate = addWeeks(currentDue, schedule.frequency_value);
          break;
        case 'monthly':
          newDueDate = addMonths(currentDue, schedule.frequency_value);
          break;
        case 'quarterly':
          newDueDate = addMonths(currentDue, schedule.frequency_value * 3);
          break;
        case 'yearly':
          newDueDate = addYears(currentDue, schedule.frequency_value);
          break;
        default:
          newDueDate = addMonths(currentDue, 1);
      }

      const { error: updateError } = await supabase
        .from('maintenance_schedules')
        .update({
          last_performed_date: schedule.next_due_date,
          next_due_date: format(newDueDate, 'yyyy-MM-dd'),
        })
        .eq('id', schedule.id);

      if (updateError) throw updateError;

      toast.success(`Work Order ${woNumber} created`);
      fetchData();
    } catch (error: any) {
      console.error('Error generating work order:', error);
      toast.error(`Failed to generate work order: ${error.message}`);
    } finally {
      setSaving(false);
    }
  };

  const handleToggleActive = async (id: string, currentActive: boolean) => {
    const { error } = await supabase
      .from('maintenance_schedules')
      .update({ is_active: !currentActive })
      .eq('id', id);

    if (error) {
      toast.error('Failed to update schedule');
    } else {
      toast.success(currentActive ? 'Schedule deactivated' : 'Schedule activated');
      fetchData();
    }
  };

  const getScheduleStatus = (schedule: PMSchedule) => {
    if (!schedule.is_active) return 'inactive';
    if (!schedule.next_due_date) return 'no_date';

    const dueDate = new Date(schedule.next_due_date);
    const today = new Date();
    const weekRange = { start: startOfWeek(today), end: endOfWeek(today) };

    if (isPast(dueDate) && format(dueDate, 'yyyy-MM-dd') !== format(today, 'yyyy-MM-dd')) {
      return 'overdue';
    }
    if (isWithinInterval(dueDate, weekRange)) {
      return 'due_soon';
    }
    return 'active';
  };

  const filteredSchedules = schedules.filter(s => {
    const status = getScheduleStatus(s);
    if (filter === 'all') return true;
    if (filter === 'active') return s.is_active;
    if (filter === 'overdue') return status === 'overdue';
    if (filter === 'due_soon') return status === 'due_soon';
    return true;
  });

  const activeCount = schedules.filter(s => s.is_active).length;
  const overdueCount = schedules.filter(s => getScheduleStatus(s) === 'overdue').length;
  const dueSoonCount = schedules.filter(s => getScheduleStatus(s) === 'due_soon').length;

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
          <h1 className="text-2xl font-bold text-gray-900">PM Schedules</h1>
          <p className="text-sm text-gray-500 mt-1">Preventive Maintenance Scheduling</p>
        </div>
        <button
          onClick={() => setShowAddModal(true)}
          className="px-4 py-2 bg-teal-600 text-white rounded-lg hover:bg-teal-700 transition-colors flex items-center space-x-2"
        >
          <Plus className="h-4 w-4" />
          <span>New Schedule</span>
        </button>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <StatCard
          icon={Calendar}
          title="Active Schedules"
          value={activeCount}
          subtitle="Running on schedule"
          color="blue"
        />
        <StatCard
          icon={AlertTriangle}
          title="Overdue"
          value={overdueCount}
          subtitle="Past due date"
          color="red"
        />
        <StatCard
          icon={Clock}
          title="Due This Week"
          value={dueSoonCount}
          subtitle="Coming up soon"
          color="amber"
        />
        <StatCard
          icon={CheckCircle}
          title="Total Schedules"
          value={schedules.length}
          subtitle="All PM plans"
          color="teal"
        />
      </div>

      {/* Filters */}
      <div className="flex items-center space-x-2">
        <button
          onClick={() => setFilter('all')}
          className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
            filter === 'all' ? 'bg-teal-600 text-white' : 'bg-white text-gray-700 border border-gray-300 hover:bg-gray-50'
          }`}
        >
          All ({schedules.length})
        </button>
        <button
          onClick={() => setFilter('active')}
          className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
            filter === 'active' ? 'bg-teal-600 text-white' : 'bg-white text-gray-700 border border-gray-300 hover:bg-gray-50'
          }`}
        >
          Active ({activeCount})
        </button>
        <button
          onClick={() => setFilter('overdue')}
          className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
            filter === 'overdue' ? 'bg-teal-600 text-white' : 'bg-white text-gray-700 border border-gray-300 hover:bg-gray-50'
          }`}
        >
          Overdue ({overdueCount})
        </button>
        <button
          onClick={() => setFilter('due_soon')}
          className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
            filter === 'due_soon' ? 'bg-teal-600 text-white' : 'bg-white text-gray-700 border border-gray-300 hover:bg-gray-50'
          }`}
        >
          Due This Week ({dueSoonCount})
        </button>
      </div>

      {/* Schedules Table */}
      <div className="bg-white rounded-lg shadow overflow-hidden">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Code</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Title</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Machine</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Type</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Frequency</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Next Due</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Assigned To</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Status</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Actions</th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {filteredSchedules.length === 0 ? (
                <tr>
                  <td colSpan={9} className="px-6 py-8 text-center text-gray-500">
                    No PM schedules found
                  </td>
                </tr>
              ) : (
                filteredSchedules.map((schedule) => {
                  const status = getScheduleStatus(schedule);
                  return (
                    <tr key={schedule.id} className={status === 'overdue' ? 'bg-red-50' : ''}>
                      <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                        {schedule.schedule_code}
                      </td>
                      <td className="px-6 py-4 text-sm text-gray-900">
                        <div>
                          <p className="font-medium">{schedule.title}</p>
                          {schedule.description && (
                            <p className="text-xs text-gray-500 mt-0.5">{schedule.description}</p>
                          )}
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                        {schedule.machines?.name || '—'}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 capitalize">
                        {schedule.maintenance_type}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 capitalize">
                        {schedule.frequency_value > 1 && `${schedule.frequency_value}x `}
                        {schedule.frequency_type}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm">
                        {schedule.next_due_date ? (
                          <span className={status === 'overdue' ? 'text-red-600 font-semibold' : 'text-gray-900'}>
                            {format(new Date(schedule.next_due_date), 'dd MMM yyyy')}
                          </span>
                        ) : (
                          '—'
                        )}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                        {schedule.assigned_to_profile?.full_name || 'Unassigned'}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        {status === 'overdue' && (
                          <span className="px-2 py-1 text-xs font-medium rounded-full bg-red-100 text-red-800">
                            Overdue
                          </span>
                        )}
                        {status === 'due_soon' && (
                          <span className="px-2 py-1 text-xs font-medium rounded-full bg-amber-100 text-amber-800">
                            Due Soon
                          </span>
                        )}
                        {status === 'active' && (
                          <span className="px-2 py-1 text-xs font-medium rounded-full bg-green-100 text-green-800">
                            Active
                          </span>
                        )}
                        {status === 'inactive' && (
                          <span className="px-2 py-1 text-xs font-medium rounded-full bg-gray-100 text-gray-800">
                            Inactive
                          </span>
                        )}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm space-x-2">
                        {schedule.is_active && (
                          <button
                            onClick={() => handleGenerateWorkOrder(schedule)}
                            disabled={saving}
                            className="text-teal-600 hover:text-teal-900 disabled:opacity-50"
                            title="Generate Work Order"
                          >
                            <Wrench className="h-4 w-4" />
                          </button>
                        )}
                        <button
                          onClick={() => handleToggleActive(schedule.id, schedule.is_active)}
                          className={schedule.is_active ? 'text-gray-600 hover:text-gray-900' : 'text-green-600 hover:text-green-900'}
                          title={schedule.is_active ? 'Deactivate' : 'Activate'}
                        >
                          <RefreshCw className="h-4 w-4" />
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Add Schedule Modal */}
      {showAddModal && (
        <Modal
          open={showAddModal}
          onClose={() => setShowAddModal(false)}
          title="New PM Schedule"
          size="lg"
        >
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Machine <span className="text-red-600">*</span>
                </label>
                <select
                  value={newSchedule.machine_id}
                  onChange={(e) => setNewSchedule({ ...newSchedule, machine_id: e.target.value })}
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
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Maintenance Type
                </label>
                <select
                  value={newSchedule.maintenance_type}
                  onChange={(e) => setNewSchedule({ ...newSchedule, maintenance_type: e.target.value as any })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-teal-500"
                >
                  <option value="preventive">Preventive</option>
                  <option value="inspection">Inspection</option>
                  <option value="calibration">Calibration</option>
                  <option value="lubrication">Lubrication</option>
                  <option value="cleaning">Cleaning</option>
                </select>
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Title <span className="text-red-600">*</span>
              </label>
              <input
                type="text"
                value={newSchedule.title}
                onChange={(e) => setNewSchedule({ ...newSchedule, title: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-teal-500"
                placeholder="e.g., Monthly bearing lubrication"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Description</label>
              <textarea
                value={newSchedule.description}
                onChange={(e) => setNewSchedule({ ...newSchedule, description: e.target.value })}
                rows={2}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-teal-500"
                placeholder="Additional details..."
              />
            </div>

            <div className="grid grid-cols-3 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Frequency Type</label>
                <select
                  value={newSchedule.frequency_type}
                  onChange={(e) => setNewSchedule({ ...newSchedule, frequency_type: e.target.value as any })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-teal-500"
                >
                  <option value="daily">Daily</option>
                  <option value="weekly">Weekly</option>
                  <option value="monthly">Monthly</option>
                  <option value="quarterly">Quarterly</option>
                  <option value="yearly">Yearly</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Frequency Value</label>
                <input
                  type="number"
                  min="1"
                  value={newSchedule.frequency_value}
                  onChange={(e) => setNewSchedule({ ...newSchedule, frequency_value: parseInt(e.target.value) || 1 })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-teal-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Duration (min)</label>
                <input
                  type="number"
                  min="1"
                  value={newSchedule.estimated_duration_minutes}
                  onChange={(e) => setNewSchedule({ ...newSchedule, estimated_duration_minutes: parseInt(e.target.value) || 60 })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-teal-500"
                />
              </div>
            </div>

            <div className="grid grid-cols-3 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Next Due Date</label>
                <input
                  type="date"
                  value={newSchedule.next_due_date}
                  onChange={(e) => setNewSchedule({ ...newSchedule, next_due_date: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-teal-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Assigned To</label>
                <select
                  value={newSchedule.assigned_to}
                  onChange={(e) => setNewSchedule({ ...newSchedule, assigned_to: e.target.value })}
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
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Priority</label>
                <select
                  value={newSchedule.priority}
                  onChange={(e) => setNewSchedule({ ...newSchedule, priority: e.target.value as any })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-teal-500"
                >
                  <option value="low">Low</option>
                  <option value="medium">Medium</option>
                  <option value="high">High</option>
                  <option value="critical">Critical</option>
                </select>
              </div>
            </div>

            <div className="flex justify-end space-x-3 pt-4">
              <button
                onClick={() => setShowAddModal(false)}
                className="px-4 py-2 text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                onClick={handleAddSchedule}
                disabled={saving}
                className="px-4 py-2 bg-teal-600 text-white rounded-lg hover:bg-teal-700 disabled:opacity-50"
              >
                {saving ? 'Creating...' : 'Create Schedule'}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
