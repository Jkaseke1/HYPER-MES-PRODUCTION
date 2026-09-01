import { useState, useEffect } from 'react';
import { DollarSign, Calendar, Users, Send, CheckCircle, AlertTriangle, Download } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../context/AuthContext';
import Modal from '../../components/ui/Modal';
import StatusBadge from '../../components/ui/StatusBadge';
import toast from 'react-hot-toast';
import { format, startOfWeek, endOfWeek, addWeeks } from 'date-fns';

interface PayrollPeriod {
  id: string;
  period_number: string;
  period_type: string;
  start_date: string;
  end_date: string;
  status: string;
  total_workers: number;
  total_hours: number;
  total_amount: number;
  approved_at: string | null;
  paid_at: string | null;
}

interface PayrollLine {
  id: string;
  worker_id: string;
  total_hours: number;
  overtime_hours: number;
  hourly_rate: number;
  overtime_rate: number;
  gross_amount: number;
  deductions: number;
  net_amount: number;
  payment_status: string;
  ecocash_number: string;
  temporary_workers?: {
    worker_number: string;
    full_name: string;
    phone_number: string;
  };
}

export default function PayrollProcessingPage() {
  const { profile } = useAuth();
  const [periods, setPeriods] = useState<PayrollPeriod[]>([]);
  const [selectedPeriod, setSelectedPeriod] = useState<PayrollPeriod | null>(null);
  const [payrollLines, setPayrollLines] = useState<PayrollLine[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showPaymentModal, setShowPaymentModal] = useState(false);
  const [processing, setProcessing] = useState(false);
  
  const [newPeriod, setNewPeriod] = useState({
    start_date: format(startOfWeek(new Date(), { weekStartsOn: 1 }), 'yyyy-MM-dd'),
    end_date: format(endOfWeek(new Date(), { weekStartsOn: 1 }), 'yyyy-MM-dd'),
    period_type: 'weekly'
  });

  const HOURLY_RATE = 2.50; // USD per hour
  const OVERTIME_RATE = 3.75; // 1.5x regular rate

  useEffect(() => {
    fetchPeriods();
  }, []);

  useEffect(() => {
    if (selectedPeriod) {
      fetchPayrollLines();
    }
  }, [selectedPeriod]);

  const fetchPeriods = async () => {
    setLoading(true);
    const { data } = await supabase
      .from('payroll_periods')
      .select('*')
      .order('start_date', { ascending: false });
    if (data) setPeriods(data);
    setLoading(false);
  };

  const fetchPayrollLines = async () => {
    if (!selectedPeriod) return;
    
    const { data } = await supabase
      .from('payroll_lines')
      .select('*, temporary_workers(worker_number, full_name, phone_number)')
      .eq('payroll_period_id', selectedPeriod.id)
      .order('net_amount', { ascending: false });
    if (data) setPayrollLines(data);
  };

  const handleCreatePeriod = async () => {
    setProcessing(true);
    try {
      // Generate period number (e.g., "2026-W18")
      const weekNumber = Math.ceil((new Date(newPeriod.start_date).getTime() - new Date(new Date().getFullYear(), 0, 1).getTime()) / (7 * 24 * 60 * 60 * 1000));
      const periodNumber = `${new Date(newPeriod.start_date).getFullYear()}-W${weekNumber}`;

      // Create period
      const { data: period, error: periodError } = await supabase
        .from('payroll_periods')
        .insert({
          period_number: periodNumber,
          period_type: newPeriod.period_type,
          start_date: newPeriod.start_date,
          end_date: newPeriod.end_date,
          status: 'calculating'
        })
        .select()
        .single();

      if (periodError) throw periodError;

      // Calculate payroll from attendance
      const { data: attendance } = await supabase
        .from('worker_attendance')
        .select('worker_id, hours_worked, overtime_hours, temporary_workers(phone_number)')
        .gte('work_date', newPeriod.start_date)
        .lte('work_date', newPeriod.end_date)
        .not('hours_worked', 'is', null);

      if (!attendance || attendance.length === 0) {
        throw new Error('No attendance records found for this period');
      }

      // Group by worker
      const workerTotals = attendance.reduce((acc: any, record: any) => {
        if (!acc[record.worker_id]) {
          acc[record.worker_id] = {
            worker_id: record.worker_id,
            total_hours: 0,
            overtime_hours: 0,
            ecocash_number: record.temporary_workers?.phone_number
          };
        }
        acc[record.worker_id].total_hours += record.hours_worked || 0;
        acc[record.worker_id].overtime_hours += record.overtime_hours || 0;
        return acc;
      }, {});

      // Create payroll lines
      const lines = Object.values(workerTotals).map((worker: any) => {
        const regularPay = worker.total_hours * HOURLY_RATE;
        const overtimePay = worker.overtime_hours * OVERTIME_RATE;
        const grossAmount = regularPay + overtimePay;
        
        return {
          payroll_period_id: period.id,
          worker_id: worker.worker_id,
          total_hours: worker.total_hours,
          overtime_hours: worker.overtime_hours,
          hourly_rate: HOURLY_RATE,
          overtime_rate: OVERTIME_RATE,
          gross_amount: grossAmount,
          deductions: 0,
          net_amount: grossAmount,
          ecocash_number: worker.ecocash_number,
          payment_status: 'pending'
        };
      });

      const { error: linesError } = await supabase
        .from('payroll_lines')
        .insert(lines);

      if (linesError) throw linesError;

      // Update period totals
      const totalWorkers = lines.length;
      const totalHours = lines.reduce((sum, l) => sum + l.total_hours, 0);
      const totalAmount = lines.reduce((sum, l) => sum + l.net_amount, 0);

      await supabase
        .from('payroll_periods')
        .update({
          total_workers: totalWorkers,
          total_hours: totalHours,
          total_amount: totalAmount,
          status: 'review'
        })
        .eq('id', period.id);

      toast.success(`Payroll created: ${totalWorkers} workers, $${totalAmount.toFixed(2)}`);
      setShowCreateModal(false);
      fetchPeriods();
    } catch (error: any) {
      console.error('Error creating payroll:', error);
      toast.error(`Failed to create payroll: ${error.message}`);
    } finally {
      setProcessing(false);
    }
  };

  const handleApprovePeriod = async () => {
    if (!selectedPeriod) return;

    try {
      const { error } = await supabase
        .from('payroll_periods')
        .update({
          status: 'approved',
          approved_by: profile?.id,
          approved_at: new Date().toISOString()
        })
        .eq('id', selectedPeriod.id);

      if (error) throw error;

      toast.success('Payroll approved');
      fetchPeriods();
    } catch (error: any) {
      console.error('Error approving payroll:', error);
      toast.error(`Failed to approve: ${error.message}`);
    }
  };

  const handleProcessPayments = async () => {
    if (!selectedPeriod) return;

    setProcessing(true);
    try {
      // This would call the Supabase Edge Function
      // For now, we'll simulate the process
      
      const { data: lines } = await supabase
        .from('payroll_lines')
        .select('*')
        .eq('payroll_period_id', selectedPeriod.id)
        .eq('payment_status', 'pending');

      if (!lines || lines.length === 0) {
        throw new Error('No pending payments found');
      }

      // Create payment batch
      const batchNumber = `BATCH-${Date.now()}`;
      const { data: batch, error: batchError } = await supabase
        .from('ecocash_payment_batches')
        .insert({
          payroll_period_id: selectedPeriod.id,
          batch_number: batchNumber,
          total_payments: lines.length,
          total_amount: lines.reduce((sum, l) => sum + l.net_amount, 0),
          status: 'processing',
          initiated_by: profile?.id
        })
        .select()
        .single();

      if (batchError) throw batchError;

      // Update payment lines to processing
      await supabase
        .from('payroll_lines')
        .update({ payment_status: 'processing' })
        .eq('payroll_period_id', selectedPeriod.id)
        .eq('payment_status', 'pending');

      // Update period status
      await supabase
        .from('payroll_periods')
        .update({
          status: 'paid',
          paid_by: profile?.id,
          paid_at: new Date().toISOString()
        })
        .eq('id', selectedPeriod.id);

      toast.success(`Payment batch ${batchNumber} created. Processing ${lines.length} payments...`);
      setShowPaymentModal(false);
      fetchPeriods();
      fetchPayrollLines();
    } catch (error: any) {
      console.error('Error processing payments:', error);
      toast.error(`Failed to process payments: ${error.message}`);
    } finally {
      setProcessing(false);
    }
  };

  const exportPayrollCSV = () => {
    if (!selectedPeriod) return;

    const headers = ['Worker #', 'Name', 'Phone', 'Hours', 'Overtime', 'Rate', 'Gross', 'Deductions', 'Net', 'Status'];
    const rows = payrollLines.map(line => [
      line.temporary_workers?.worker_number || '',
      line.temporary_workers?.full_name || '',
      line.ecocash_number,
      line.total_hours.toFixed(2),
      line.overtime_hours.toFixed(2),
      line.hourly_rate.toFixed(2),
      line.gross_amount.toFixed(2),
      line.deductions.toFixed(2),
      line.net_amount.toFixed(2),
      line.payment_status
    ]);

    const csv = [headers, ...rows].map(row => row.join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `payroll-${selectedPeriod.period_number}.csv`;
    a.click();
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-3">
          <DollarSign className="h-8 w-8 text-indigo-600" />
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Payroll Processing</h1>
            <p className="text-sm text-gray-500">Calculate and process worker payments</p>
          </div>
        </div>
        <button
          onClick={() => setShowCreateModal(true)}
          className="flex items-center space-x-2 px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700"
        >
          <Calendar className="h-5 w-5" />
          <span>New Payroll Period</span>
        </button>
      </div>

      {/* Periods List */}
      <div className="bg-white rounded-lg shadow overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-200">
          <h2 className="text-lg font-semibold text-gray-900">Payroll Periods</h2>
        </div>
        {loading ? (
          <div className="p-8 text-center text-gray-500">Loading periods...</div>
        ) : (
          <div className="divide-y divide-gray-200">
            {periods.map((period) => (
              <div
                key={period.id}
                onClick={() => setSelectedPeriod(period)}
                className={`p-4 cursor-pointer hover:bg-gray-50 ${
                  selectedPeriod?.id === period.id ? 'bg-indigo-50' : ''
                }`}
              >
                <div className="flex items-center justify-between">
                  <div className="flex-1">
                    <div className="flex items-center space-x-3">
                      <h3 className="text-lg font-medium text-gray-900">{period.period_number}</h3>
                      <StatusBadge status={period.status} />
                    </div>
                    <div className="mt-1 text-sm text-gray-500">
                      {format(new Date(period.start_date), 'MMM d')} - {format(new Date(period.end_date), 'MMM d, yyyy')}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-lg font-semibold text-gray-900">
                      ${period.total_amount?.toFixed(2) || '0.00'}
                    </div>
                    <div className="text-sm text-gray-500">
                      {period.total_workers} workers · {period.total_hours?.toFixed(1) || '0'} hours
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Selected Period Details */}
      {selectedPeriod && (
        <div className="bg-white rounded-lg shadow">
          <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
            <h2 className="text-lg font-semibold text-gray-900">
              {selectedPeriod.period_number} Details
            </h2>
            <div className="flex items-center space-x-3">
              {selectedPeriod.status === 'review' && (
                <button
                  onClick={handleApprovePeriod}
                  className="flex items-center space-x-2 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700"
                >
                  <CheckCircle className="h-5 w-5" />
                  <span>Approve</span>
                </button>
              )}
              {selectedPeriod.status === 'approved' && (
                <button
                  onClick={() => setShowPaymentModal(true)}
                  className="flex items-center space-x-2 px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700"
                >
                  <Send className="h-5 w-5" />
                  <span>Process Payments</span>
                </button>
              )}
              <button
                onClick={exportPayrollCSV}
                className="flex items-center space-x-2 px-4 py-2 bg-white border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50"
              >
                <Download className="h-5 w-5" />
                <span>Export</span>
              </button>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Worker</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Phone</th>
                  <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Hours</th>
                  <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Overtime</th>
                  <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Rate</th>
                  <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Gross</th>
                  <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Deductions</th>
                  <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Net Pay</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {payrollLines.map((line) => (
                  <tr key={line.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3 whitespace-nowrap">
                      <div className="text-sm font-medium text-gray-900">
                        {line.temporary_workers?.full_name}
                      </div>
                      <div className="text-xs text-gray-500">
                        {line.temporary_workers?.worker_number}
                      </div>
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-900">
                      {line.ecocash_number}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-sm text-right text-gray-900">
                      {line.total_hours.toFixed(2)}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-sm text-right text-amber-600">
                      {line.overtime_hours.toFixed(2)}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-sm text-right text-gray-900">
                      ${line.hourly_rate.toFixed(2)}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-sm text-right text-gray-900">
                      ${line.gross_amount.toFixed(2)}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-sm text-right text-red-600">
                      ${line.deductions.toFixed(2)}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-sm text-right font-semibold text-green-600">
                      ${line.net_amount.toFixed(2)}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <StatusBadge status={line.payment_status} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Create Period Modal */}
      {showCreateModal && (
        <Modal
          open={showCreateModal}
          onClose={() => setShowCreateModal(false)}
          title="Create Payroll Period"
        >
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Period Type</label>
              <select
                value={newPeriod.period_type}
                onChange={(e) => setNewPeriod({ ...newPeriod, period_type: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
              >
                <option value="weekly">Weekly</option>
                <option value="biweekly">Bi-weekly</option>
                <option value="monthly">Monthly</option>
              </select>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Start Date</label>
                <input
                  type="date"
                  value={newPeriod.start_date}
                  onChange={(e) => setNewPeriod({ ...newPeriod, start_date: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">End Date</label>
                <input
                  type="date"
                  value={newPeriod.end_date}
                  onChange={(e) => setNewPeriod({ ...newPeriod, end_date: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                />
              </div>
            </div>

            <div className="bg-amber-50 border border-amber-200 rounded-lg p-4">
              <div className="flex items-start space-x-2">
                <AlertTriangle className="h-5 w-5 text-amber-600 mt-0.5" />
                <div className="text-sm text-amber-800">
                  This will calculate payroll from attendance records between the selected dates.
                  Make sure all attendance is recorded before creating the period.
                </div>
              </div>
            </div>

            <div className="flex justify-end space-x-3 pt-4">
              <button
                onClick={() => setShowCreateModal(false)}
                className="px-4 py-2 text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50"
                disabled={processing}
              >
                Cancel
              </button>
              <button
                onClick={handleCreatePeriod}
                disabled={processing}
                className="px-6 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50"
              >
                {processing ? 'Calculating...' : 'Create Period'}
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* Payment Confirmation Modal */}
      {showPaymentModal && selectedPeriod && (
        <Modal
          open={showPaymentModal}
          onClose={() => setShowPaymentModal(false)}
          title="Process Ecocash Payments"
        >
          <div className="space-y-4">
            <div className="bg-indigo-50 border border-indigo-200 rounded-lg p-4">
              <div className="text-sm text-indigo-900">
                <div className="font-semibold mb-2">Payment Summary</div>
                <div className="space-y-1">
                  <div className="flex justify-between">
                    <span>Total Workers:</span>
                    <span className="font-medium">{selectedPeriod.total_workers}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Total Amount:</span>
                    <span className="font-medium">${selectedPeriod.total_amount.toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Ecocash Fees (~1.5%):</span>
                    <span className="font-medium">${(selectedPeriod.total_amount * 0.015).toFixed(2)}</span>
                  </div>
                </div>
              </div>
            </div>

            <div className="bg-amber-50 border border-amber-200 rounded-lg p-4">
              <div className="flex items-start space-x-2">
                <AlertTriangle className="h-5 w-5 text-amber-600 mt-0.5" />
                <div className="text-sm text-amber-800">
                  This will submit {selectedPeriod.total_workers} payments to Ecocash for processing.
                  Payments cannot be cancelled once submitted.
                </div>
              </div>
            </div>

            <div className="flex justify-end space-x-3 pt-4">
              <button
                onClick={() => setShowPaymentModal(false)}
                className="px-4 py-2 text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50"
                disabled={processing}
              >
                Cancel
              </button>
              <button
                onClick={handleProcessPayments}
                disabled={processing}
                className="px-6 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50"
              >
                {processing ? 'Processing...' : 'Confirm & Process'}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
