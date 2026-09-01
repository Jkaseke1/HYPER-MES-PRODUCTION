import { useState, useEffect } from 'react';
import { Clock, Calendar, Users, CheckCircle, XCircle, Download } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../context/AuthContext';
import Modal from '../../components/ui/Modal';
import toast from 'react-hot-toast';
import { format } from 'date-fns';

interface Worker {
  id: string;
  worker_number: string;
  full_name: string;
  department: string;
}

interface Attendance {
  id: string;
  worker_id: string;
  work_date: string;
  clock_in: string | null;
  clock_out: string | null;
  hours_worked: number | null;
  overtime_hours: number;
  department: string;
  notes: string | null;
  temporary_workers?: Worker;
}

export default function WorkerAttendancePage() {
  const { profile } = useAuth();
  const [workers, setWorkers] = useState<Worker[]>([]);
  const [attendance, setAttendance] = useState<Attendance[]>([]);
  const [selectedDate, setSelectedDate] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [loading, setLoading] = useState(true);
  const [showClockInModal, setShowClockInModal] = useState(false);
  const [selectedWorker, setSelectedWorker] = useState<string>('');
  const [clockInTime, setClockInTime] = useState(format(new Date(), 'HH:mm'));
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetchWorkers();
    fetchAttendance();
  }, [selectedDate]);

  const fetchWorkers = async () => {
    const { data } = await supabase
      .from('temporary_workers')
      .select('*')
      .eq('status', 'active')
      .order('worker_number');
    if (data) setWorkers(data);
  };

  const fetchAttendance = async () => {
    setLoading(true);
    const { data } = await supabase
      .from('worker_attendance')
      .select('*, temporary_workers(worker_number, full_name, department)')
      .eq('work_date', selectedDate)
      .order('clock_in', { ascending: false });
    if (data) setAttendance(data);
    setLoading(false);
  };

  const handleClockIn = async () => {
    if (!selectedWorker) {
      toast.error('Please select a worker');
      return;
    }

    setSaving(true);
    try {
      const clockInDateTime = new Date(`${selectedDate}T${clockInTime}:00`);
      const worker = workers.find(w => w.id === selectedWorker);

      const { error } = await supabase
        .from('worker_attendance')
        .insert({
          worker_id: selectedWorker,
          work_date: selectedDate,
          clock_in: clockInDateTime.toISOString(),
          department: worker?.department,
          supervisor_id: profile?.id
        });

      if (error) throw error;

      toast.success('Worker clocked in');
      setShowClockInModal(false);
      setSelectedWorker('');
      fetchAttendance();
    } catch (error: any) {
      console.error('Error clocking in:', error);
      toast.error(`Failed to clock in: ${error.message}`);
    } finally {
      setSaving(false);
    }
  };

  const handleClockOut = async (attendanceId: string, clockInTime: string) => {
    const clockOutTime = new Date();
    const clockIn = new Date(clockInTime);
    const hoursWorked = (clockOutTime.getTime() - clockIn.getTime()) / (1000 * 60 * 60);
    const regularHours = Math.min(hoursWorked, 8);
    const overtimeHours = Math.max(0, hoursWorked - 8);

    try {
      const { error } = await supabase
        .from('worker_attendance')
        .update({
          clock_out: clockOutTime.toISOString(),
          hours_worked: regularHours,
          overtime_hours: overtimeHours
        })
        .eq('id', attendanceId);

      if (error) throw error;

      toast.success('Worker clocked out');
      fetchAttendance();
    } catch (error: any) {
      console.error('Error clocking out:', error);
      toast.error(`Failed to clock out: ${error.message}`);
    }
  };

  const handleBulkClockIn = async () => {
    const unclocked = workers.filter(w => 
      !attendance.some(a => a.worker_id === w.id)
    );

    if (unclocked.length === 0) {
      toast.error('All active workers already clocked in');
      return;
    }

    setSaving(true);
    try {
      const clockInDateTime = new Date(`${selectedDate}T08:00:00`);
      const records = unclocked.map(w => ({
        worker_id: w.id,
        work_date: selectedDate,
        clock_in: clockInDateTime.toISOString(),
        department: w.department,
        supervisor_id: profile?.id
      }));

      const { error } = await supabase
        .from('worker_attendance')
        .insert(records);

      if (error) throw error;

      toast.success(`${unclocked.length} workers clocked in`);
      fetchAttendance();
    } catch (error: any) {
      console.error('Error bulk clock in:', error);
      toast.error(`Failed to bulk clock in: ${error.message}`);
    } finally {
      setSaving(false);
    }
  };

  const exportToCSV = () => {
    const headers = ['Worker #', 'Name', 'Department', 'Clock In', 'Clock Out', 'Hours', 'Overtime'];
    const rows = attendance.map(a => [
      a.temporary_workers?.worker_number || '',
      a.temporary_workers?.full_name || '',
      a.department,
      a.clock_in ? format(new Date(a.clock_in), 'HH:mm') : '',
      a.clock_out ? format(new Date(a.clock_out), 'HH:mm') : '',
      a.hours_worked?.toFixed(2) || '',
      a.overtime_hours?.toFixed(2) || ''
    ]);

    const csv = [headers, ...rows].map(row => row.join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `attendance-${selectedDate}.csv`;
    a.click();
  };

  const clockedIn = attendance.filter(a => a.clock_in && !a.clock_out).length;
  const clockedOut = attendance.filter(a => a.clock_out).length;
  const totalHours = attendance.reduce((sum, a) => sum + (a.hours_worked || 0), 0);
  const totalOvertime = attendance.reduce((sum, a) => sum + (a.overtime_hours || 0), 0);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-3">
          <Clock className="h-8 w-8 text-indigo-600" />
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Worker Attendance</h1>
            <p className="text-sm text-gray-500">Track daily worker clock in/out</p>
          </div>
        </div>
        <div className="flex items-center space-x-3">
          <button
            onClick={exportToCSV}
            className="flex items-center space-x-2 px-4 py-2 bg-white border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50"
          >
            <Download className="h-5 w-5" />
            <span>Export CSV</span>
          </button>
          <button
            onClick={handleBulkClockIn}
            disabled={saving}
            className="flex items-center space-x-2 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50"
          >
            <Users className="h-5 w-5" />
            <span>Bulk Clock In</span>
          </button>
          <button
            onClick={() => setShowClockInModal(true)}
            className="flex items-center space-x-2 px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700"
          >
            <CheckCircle className="h-5 w-5" />
            <span>Clock In Worker</span>
          </button>
        </div>
      </div>

      {/* Date Selector */}
      <div className="bg-white rounded-lg shadow p-4">
        <div className="flex items-center space-x-4">
          <Calendar className="h-5 w-5 text-gray-400" />
          <input
            type="date"
            value={selectedDate}
            onChange={(e) => setSelectedDate(e.target.value)}
            className="px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
          />
          <div className="flex-1" />
          <div className="text-sm text-gray-500">
            {format(new Date(selectedDate), 'EEEE, MMMM d, yyyy')}
          </div>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-4 gap-4">
        <div className="bg-white rounded-lg shadow p-4">
          <div className="text-sm text-gray-500">Total Workers</div>
          <div className="text-2xl font-bold text-gray-900">{attendance.length}</div>
        </div>
        <div className="bg-white rounded-lg shadow p-4">
          <div className="text-sm text-gray-500">Clocked In</div>
          <div className="text-2xl font-bold text-green-600">{clockedIn}</div>
        </div>
        <div className="bg-white rounded-lg shadow p-4">
          <div className="text-sm text-gray-500">Total Hours</div>
          <div className="text-2xl font-bold text-indigo-600">{totalHours.toFixed(1)}</div>
        </div>
        <div className="bg-white rounded-lg shadow p-4">
          <div className="text-sm text-gray-500">Overtime Hours</div>
          <div className="text-2xl font-bold text-amber-600">{totalOvertime.toFixed(1)}</div>
        </div>
      </div>

      {/* Attendance Table */}
      <div className="bg-white rounded-lg shadow overflow-hidden">
        {loading ? (
          <div className="p-8 text-center text-gray-500">Loading attendance...</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Worker #</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Name</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Department</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Clock In</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Clock Out</th>
                  <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Hours</th>
                  <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Overtime</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Actions</th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {attendance.map((record) => (
                  <tr key={record.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3 whitespace-nowrap text-sm font-medium text-gray-900">
                      {record.temporary_workers?.worker_number}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-900">
                      {record.temporary_workers?.full_name}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-900">
                      {record.department}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-900">
                      {record.clock_in ? format(new Date(record.clock_in), 'HH:mm') : '—'}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-900">
                      {record.clock_out ? format(new Date(record.clock_out), 'HH:mm') : '—'}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-sm text-right text-gray-900">
                      {record.hours_worked?.toFixed(2) || '—'}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-sm text-right text-amber-600">
                      {record.overtime_hours?.toFixed(2) || '—'}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      {record.clock_out ? (
                        <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-green-100 text-green-800">
                          <CheckCircle className="h-3 w-3 mr-1" />
                          Complete
                        </span>
                      ) : (
                        <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-blue-100 text-blue-800">
                          <Clock className="h-3 w-3 mr-1" />
                          Working
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-sm">
                      {!record.clock_out && (
                        <button
                          onClick={() => handleClockOut(record.id, record.clock_in!)}
                          className="text-indigo-600 hover:text-indigo-900"
                        >
                          Clock Out
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Clock In Modal */}
      {showClockInModal && (
        <Modal
          open={showClockInModal}
          onClose={() => setShowClockInModal(false)}
          title="Clock In Worker"
        >
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Worker</label>
              <select
                value={selectedWorker}
                onChange={(e) => setSelectedWorker(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
              >
                <option value="">Select worker...</option>
                {workers
                  .filter(w => !attendance.some(a => a.worker_id === w.id))
                  .map(worker => (
                    <option key={worker.id} value={worker.id}>
                      {worker.worker_number} - {worker.full_name} ({worker.department})
                    </option>
                  ))}
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Clock In Time</label>
              <input
                type="time"
                value={clockInTime}
                onChange={(e) => setClockInTime(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
              />
            </div>

            <div className="flex justify-end space-x-3 pt-4">
              <button
                onClick={() => setShowClockInModal(false)}
                className="px-4 py-2 text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50"
                disabled={saving}
              >
                Cancel
              </button>
              <button
                onClick={handleClockIn}
                disabled={saving}
                className="px-6 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50"
              >
                {saving ? 'Clocking In...' : 'Clock In'}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
