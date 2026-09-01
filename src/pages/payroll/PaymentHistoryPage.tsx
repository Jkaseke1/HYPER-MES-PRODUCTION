import { useState, useEffect } from 'react';
import { History, Search, Download, CheckCircle, XCircle, Clock } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import StatusBadge from '../../components/ui/StatusBadge';
import { format } from 'date-fns';

interface PaymentRecord {
  id: string;
  worker_id: string;
  total_hours: number;
  net_amount: number;
  payment_status: string;
  payment_date: string | null;
  ecocash_transaction_id: string | null;
  payment_error: string | null;
  ecocash_number: string;
  created_at: string;
  temporary_workers?: {
    worker_number: string;
    full_name: string;
  };
  payroll_periods?: {
    period_number: string;
    start_date: string;
    end_date: string;
  };
}

interface PaymentBatch {
  id: string;
  batch_number: string;
  total_payments: number;
  total_amount: number;
  successful_payments: number;
  failed_payments: number;
  status: string;
  initiated_at: string;
  completed_at: string | null;
  payroll_periods?: {
    period_number: string;
  };
}

export default function PaymentHistoryPage() {
  const [payments, setPayments] = useState<PaymentRecord[]>([]);
  const [batches, setBatches] = useState<PaymentBatch[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [filterStatus, setFilterStatus] = useState('all');
  const [view, setView] = useState<'payments' | 'batches'>('payments');

  useEffect(() => {
    fetchPayments();
    fetchBatches();
  }, []);

  const fetchPayments = async () => {
    setLoading(true);
    const { data } = await supabase
      .from('payroll_lines')
      .select(`
        *,
        temporary_workers(worker_number, full_name),
        payroll_periods(period_number, start_date, end_date)
      `)
      .not('payment_status', 'eq', 'pending')
      .order('created_at', { ascending: false })
      .limit(200);
    if (data) setPayments(data);
    setLoading(false);
  };

  const fetchBatches = async () => {
    const { data } = await supabase
      .from('ecocash_payment_batches')
      .select('*, payroll_periods(period_number)')
      .order('initiated_at', { ascending: false });
    if (data) setBatches(data);
  };

  const exportPaymentsCSV = () => {
    const headers = ['Date', 'Period', 'Worker #', 'Name', 'Phone', 'Amount', 'Status', 'Transaction ID'];
    const rows = filteredPayments.map(p => [
      p.payment_date ? format(new Date(p.payment_date), 'yyyy-MM-dd HH:mm') : '',
      p.payroll_periods?.period_number || '',
      p.temporary_workers?.worker_number || '',
      p.temporary_workers?.full_name || '',
      p.ecocash_number,
      p.net_amount.toFixed(2),
      p.payment_status,
      p.ecocash_transaction_id || ''
    ]);

    const csv = [headers, ...rows].map(row => row.join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `payment-history-${format(new Date(), 'yyyy-MM-dd')}.csv`;
    a.click();
  };

  const filteredPayments = payments.filter(p => {
    const matchesSearch = searchTerm === '' ||
      p.temporary_workers?.full_name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      p.temporary_workers?.worker_number.toLowerCase().includes(searchTerm.toLowerCase()) ||
      p.ecocash_number.includes(searchTerm);
    const matchesStatus = filterStatus === 'all' || p.payment_status === filterStatus;
    return matchesSearch && matchesStatus;
  });

  const totalPaid = payments.filter(p => p.payment_status === 'paid').reduce((sum, p) => sum + p.net_amount, 0);
  const totalFailed = payments.filter(p => p.payment_status === 'failed').length;
  const totalProcessing = payments.filter(p => p.payment_status === 'processing').length;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-3">
          <History className="h-8 w-8 text-indigo-600" />
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Payment History</h1>
            <p className="text-sm text-gray-500">Track all Ecocash payment transactions</p>
          </div>
        </div>
        <button
          onClick={exportPaymentsCSV}
          className="flex items-center space-x-2 px-4 py-2 bg-white border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50"
        >
          <Download className="h-5 w-5" />
          <span>Export CSV</span>
        </button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-4 gap-4">
        <div className="bg-white rounded-lg shadow p-4">
          <div className="text-sm text-gray-500">Total Payments</div>
          <div className="text-2xl font-bold text-gray-900">{payments.length}</div>
        </div>
        <div className="bg-white rounded-lg shadow p-4">
          <div className="text-sm text-gray-500">Total Paid</div>
          <div className="text-2xl font-bold text-green-600">${totalPaid.toFixed(2)}</div>
        </div>
        <div className="bg-white rounded-lg shadow p-4">
          <div className="text-sm text-gray-500">Processing</div>
          <div className="text-2xl font-bold text-blue-600">{totalProcessing}</div>
        </div>
        <div className="bg-white rounded-lg shadow p-4">
          <div className="text-sm text-gray-500">Failed</div>
          <div className="text-2xl font-bold text-red-600">{totalFailed}</div>
        </div>
      </div>

      {/* View Tabs */}
      <div className="flex space-x-2 border-b border-gray-200">
        <button
          onClick={() => setView('payments')}
          className={`px-4 py-2 font-medium text-sm border-b-2 transition-colors ${
            view === 'payments'
              ? 'border-indigo-600 text-indigo-600'
              : 'border-transparent text-gray-500 hover:text-gray-700'
          }`}
        >
          Individual Payments
        </button>
        <button
          onClick={() => setView('batches')}
          className={`px-4 py-2 font-medium text-sm border-b-2 transition-colors ${
            view === 'batches'
              ? 'border-indigo-600 text-indigo-600'
              : 'border-transparent text-gray-500 hover:text-gray-700'
          }`}
        >
          Payment Batches
        </button>
      </div>

      {view === 'payments' && (
        <>
          {/* Filters */}
          <div className="bg-white rounded-lg shadow p-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Search</label>
                <div className="relative">
                  <Search className="absolute left-3 top-2.5 h-5 w-5 text-gray-400" />
                  <input
                    type="text"
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    placeholder="Name, worker #, or phone..."
                    className="w-full pl-10 pr-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                  />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Status</label>
                <select
                  value={filterStatus}
                  onChange={(e) => setFilterStatus(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                >
                  <option value="all">All Statuses</option>
                  <option value="processing">Processing</option>
                  <option value="paid">Paid</option>
                  <option value="failed">Failed</option>
                </select>
              </div>
            </div>
          </div>

          {/* Payments Table */}
          <div className="bg-white rounded-lg shadow overflow-hidden">
            {loading ? (
              <div className="p-8 text-center text-gray-500">Loading payments...</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-gray-200">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Date</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Period</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Worker</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Phone</th>
                      <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Amount</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Transaction ID</th>
                    </tr>
                  </thead>
                  <tbody className="bg-white divide-y divide-gray-200">
                    {filteredPayments.map((payment) => (
                      <tr key={payment.id} className="hover:bg-gray-50">
                        <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-900">
                          {payment.payment_date ? format(new Date(payment.payment_date), 'MMM d, HH:mm') : '—'}
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-900">
                          {payment.payroll_periods?.period_number}
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap">
                          <div className="text-sm font-medium text-gray-900">
                            {payment.temporary_workers?.full_name}
                          </div>
                          <div className="text-xs text-gray-500">
                            {payment.temporary_workers?.worker_number}
                          </div>
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-900">
                          {payment.ecocash_number}
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap text-sm text-right font-semibold text-gray-900">
                          ${payment.net_amount.toFixed(2)}
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap">
                          <div className="flex items-center space-x-2">
                            {payment.payment_status === 'paid' && <CheckCircle className="h-4 w-4 text-green-600" />}
                            {payment.payment_status === 'failed' && <XCircle className="h-4 w-4 text-red-600" />}
                            {payment.payment_status === 'processing' && <Clock className="h-4 w-4 text-blue-600" />}
                            <StatusBadge status={payment.payment_status} />
                          </div>
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-500">
                          {payment.ecocash_transaction_id || '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}

      {view === 'batches' && (
        <div className="bg-white rounded-lg shadow overflow-hidden">
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Batch #</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Period</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Initiated</th>
                  <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Total Payments</th>
                  <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Amount</th>
                  <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Successful</th>
                  <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Failed</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {batches.map((batch) => (
                  <tr key={batch.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3 whitespace-nowrap text-sm font-medium text-gray-900">
                      {batch.batch_number}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-900">
                      {batch.payroll_periods?.period_number}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-900">
                      {format(new Date(batch.initiated_at), 'MMM d, yyyy HH:mm')}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-sm text-right text-gray-900">
                      {batch.total_payments}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-sm text-right font-semibold text-gray-900">
                      ${batch.total_amount.toFixed(2)}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-sm text-right text-green-600">
                      {batch.successful_payments}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-sm text-right text-red-600">
                      {batch.failed_payments}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <StatusBadge status={batch.status} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
