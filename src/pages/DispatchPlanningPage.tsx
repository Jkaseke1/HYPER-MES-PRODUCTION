import { useState, useEffect } from 'react';
import { Plus, Search, Eye, Calendar, Package, Truck, CheckCircle2, DollarSign, Clock, AlertTriangle } from 'lucide-react';
import { format } from 'date-fns';
import { supabase } from '../lib/supabase';
import Modal from '../components/ui/Modal';
import StatusBadge from '../components/ui/StatusBadge';
import StatCard from '../components/ui/StatCard';

interface DispatchOrder {
  id: string;
  order_number: string;
  customer_name: string;
  delivery_location: string;
  order_date: string;
  expected_dispatch_date: string;
  total_tonnage: number;
  total_value: number;
  status: 'pending' | 'planned' | 'loaded' | 'dispatched' | 'delivered' | 'cancelled';
  priority: 'normal' | 'urgent';
  notes: string;
  vehicle_id: string;
  driver_name: string;
  created_by: string;
  created_at: string;
  updated_at: string;
}

interface DispatchItem {
  id: string;
  dispatch_order_id: string;
  formulation_id: string;
  product_code: string;
  product_name: string;
  quantity: number;
  unit: string;
  unit_price: number;
  line_total: number;
}

const DISPATCH_WORKFLOW: { status: DispatchOrder['status']; label: string; btnLabel: string; btnColor: string; next: DispatchOrder['status'] | null }[] = [
  { status: 'pending',    label: 'Pending',    btnLabel: 'Plan Dispatch',      btnColor: 'bg-teal-600 hover:bg-teal-700',   next: 'planned' },
  { status: 'planned',   label: 'Planned',    btnLabel: 'Mark as Loaded',     btnColor: 'bg-amber-600 hover:bg-amber-700',  next: 'loaded' },
  { status: 'loaded',    label: 'Loaded',     btnLabel: 'Dispatch Now',       btnColor: 'bg-teal-600 hover:bg-teal-700',   next: 'dispatched' },
  { status: 'dispatched',label: 'Dispatched', btnLabel: 'Confirm Delivery',   btnColor: 'bg-emerald-600 hover:bg-emerald-700', next: 'delivered' },
  { status: 'delivered', label: 'Delivered',  btnLabel: '',                   btnColor: '',                                 next: null },
];

export default function DispatchPage() {
  const [orders, setOrders] = useState<DispatchOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [workflowError, setWorkflowError] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [viewOrder, setViewOrder] = useState<DispatchOrder | null>(null);
  const [viewItems, setViewItems] = useState<DispatchItem[]>([]);
  const [activeTab, setActiveTab] = useState<'general' | 'items' | 'logistics'>('general');

  useEffect(() => {
    fetchOrders();
  }, []);

  async function fetchOrders() {
    setLoading(true);
    const { data } = await supabase
      .from('dispatch_orders')
      .select('*')
      .order('expected_dispatch_date', { ascending: true });
    
    if (data) setOrders(data);
    setLoading(false);
  }

  async function openView(order: DispatchOrder) {
    setWorkflowError(null);
    setViewOrder(order);
    const { data } = await supabase
      .from('dispatch_items')
      .select('*')
      .eq('dispatch_order_id', order.id);
    
    if (data) setViewItems(data);
  }

  async function updateDispatchStatus(nextStatus: DispatchOrder['status']) {
    if (!viewOrder) return;
    setSaving(true);
    setWorkflowError(null);
    try {
      const updates: Record<string, any> = { status: nextStatus };
      if (nextStatus === 'dispatched') updates.dispatched_at = new Date().toISOString();
      if (nextStatus === 'delivered') updates.delivered_at = new Date().toISOString();

      const { error } = await supabase
        .from('dispatch_orders')
        .update(updates)
        .eq('id', viewOrder.id);

      if (error) throw error;

      const updated = { ...viewOrder, ...updates };
      setViewOrder(updated as DispatchOrder);
      setOrders(prev => prev.map(o => o.id === viewOrder.id ? updated as DispatchOrder : o));
    } catch (err: any) {
      setWorkflowError(err.message);
    } finally {
      setSaving(false);
    }
  }

  const filteredOrders = orders.filter((order) => {
    const matchesSearch = 
      order.order_number.toLowerCase().includes(searchTerm.toLowerCase()) ||
      order.customer_name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      order.delivery_location.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesStatus = statusFilter === 'all' || order.status === statusFilter;
    return matchesSearch && matchesStatus;
  });

  const statusCounts = {
    all: orders.length,
    pending: orders.filter(o => o.status === 'pending').length,
    planned: orders.filter(o => o.status === 'planned').length,
    loaded: orders.filter(o => o.status === 'loaded').length,
    dispatched: orders.filter(o => o.status === 'dispatched').length,
    delivered: orders.filter(o => o.status === 'delivered').length,
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="w-8 h-8 border-2 border-slate-200 border-t-teal-600 rounded-full animate-spin" />
      </div>
    );
  }

  const totalValue = orders.reduce((sum, o) => sum + (o.total_value || 0), 0);
  const totalTonnage = orders.reduce((sum, o) => sum + (o.total_tonnage || 0), 0);

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">Dispatch Management</h1>
          <p className="text-sm text-slate-500 mt-1">Plan and manage customer deliveries</p>
        </div>
        <button className="flex items-center gap-2 px-4 py-2.5 bg-teal-600 hover:bg-teal-700 text-white rounded-lg text-sm font-semibold transition-colors">
          <Plus className="w-4 h-4" />
          New Dispatch Order
        </button>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard title="Total Orders" value={orders.length} icon={Package} color="teal" />
        <StatCard title="Pending Planning" value={statusCounts.pending} icon={Clock} color="amber" />
        <StatCard title="Ready to Dispatch" value={statusCounts.loaded} icon={Truck} color="blue" />
        <StatCard title="Total Tonnage" value={`${totalTonnage.toLocaleString()}t`} icon={Package} color="slate" />
      </div>

      <div className="flex items-center gap-4">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <input
            type="text"
            placeholder="Search by order number, customer name, or delivery location..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-9 pr-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500 bg-white"
          />
        </div>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500 bg-white min-w-[180px]"
        >
            <option value="all">All Status ({statusCounts.all})</option>
            <option value="pending">Pending Planning ({statusCounts.pending})</option>
            <option value="planned">Planned ({statusCounts.planned})</option>
            <option value="loaded">Loaded ({statusCounts.loaded})</option>
            <option value="dispatched">Dispatched ({statusCounts.dispatched})</option>
            <option value="delivered">Delivered ({statusCounts.delivered})</option>
        </select>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr>
                {['Order #', 'Customer', 'Delivery Location', 'Expected Date', 'Tonnage', 'Value', 'Status', 'Priority', 'Actions'].map((header) => (
                  <th key={header} className="px-4 py-3 text-left text-xs font-medium text-slate-600">
                    {header}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {filteredOrders.length === 0 ? (
                <tr>
                  <td colSpan={9} className="px-4 py-20 text-center text-sm text-slate-500">
                    No dispatch orders found
                  </td>
                </tr>
              ) : (
                filteredOrders.map((order) => (
                  <tr key={order.id} className="hover:bg-slate-50 transition-colors cursor-pointer" onClick={() => openView(order)}>
                    <td className="px-4 py-3">
                      <span className="font-mono text-sm font-medium text-teal-600">{order.order_number}</span>
                    </td>
                    <td className="px-4 py-3">
                      <p className="text-sm text-slate-800">{order.customer_name}</p>
                    </td>
                    <td className="px-4 py-3 text-sm text-slate-600">{order.delivery_location}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1.5 text-xs text-slate-600">
                        <Calendar className="w-3.5 h-3.5 text-slate-400" />
                        {format(new Date(order.expected_dispatch_date), 'dd/MM/yyyy')}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-sm text-slate-700">
                      <Package className="w-4 h-4 inline mr-1 text-slate-400" />
                      {order.total_tonnage}t
                    </td>
                    <td className="px-4 py-3 text-sm text-slate-700">
                      ${order.total_value.toLocaleString()}
                    </td>
                    <td className="px-4 py-3">
                      <StatusBadge status={order.status} />
                    </td>
                    <td className="px-4 py-3">
                      {order.priority === 'urgent' ? (
                        <span className="inline-flex items-center px-2 py-1 bg-red-100 text-red-700 text-xs font-medium rounded">URGENT</span>
                      ) : (
                        <span className="inline-flex items-center px-2 py-1 bg-slate-100 text-slate-600 text-xs font-medium rounded">Normal</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <button
                        onClick={(e) => { e.stopPropagation(); openView(order); }}
                        className="p-1.5 hover:bg-slate-200 rounded transition-colors"
                        title="View details"
                      >
                        <Eye className="w-4 h-4 text-slate-600" />
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      <Modal
        open={viewOrder !== null}
        onClose={() => { setViewOrder(null); setActiveTab('general'); }}
        title={`Dispatch Order: ${viewOrder?.order_number}`}
      >
        {viewOrder && (
          <div className="space-y-3">
            {/* Workflow Bar */}
            {(() => {
              const step = DISPATCH_WORKFLOW.find(s => s.status === viewOrder.status);
              const stepIndex = DISPATCH_WORKFLOW.findIndex(s => s.status === viewOrder.status);
              return (
                <div className="bg-slate-50 border border-slate-200 rounded-lg px-4 py-3 space-y-2">
                  <div className="flex items-center gap-1 flex-wrap text-xs">
                    {DISPATCH_WORKFLOW.map((s, i) => (
                      <span key={s.status} className="flex items-center gap-1">
                        <span className={`px-2 py-0.5 rounded-full font-medium ${
                          i < stepIndex ? 'bg-emerald-100 text-emerald-700' :
                          i === stepIndex ? 'bg-teal-600 text-white' :
                          'bg-slate-100 text-slate-400'
                        }`}>{s.label}</span>
                        {i < DISPATCH_WORKFLOW.length - 1 && <span className="text-slate-300">→</span>}
                      </span>
                    ))}
                  </div>
                  {workflowError && (
                    <p className="text-xs text-red-600 font-medium">{workflowError}</p>
                  )}
                  {step?.next && (
                    <button
                      onClick={() => updateDispatchStatus(step.next!)}
                      disabled={saving}
                      className={`flex items-center gap-2 px-4 py-1.5 text-white text-sm font-medium rounded-lg transition-colors disabled:opacity-50 ${step.btnColor}`}
                    >
                      <Truck className="w-4 h-4" />
                      {saving ? 'Updating…' : step.btnLabel}
                    </button>
                  )}
                  {viewOrder.status === 'delivered' && (
                    <span className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-700">
                      <CheckCircle2 className="w-4 h-4" /> Delivered — order complete
                    </span>
                  )}
                </div>
              );
            })()}
            {/* Tabs */}
            <div className="flex border-b border-slate-200 -mx-6 px-6">
              <button
                onClick={() => setActiveTab('general')}
                className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
                  activeTab === 'general'
                    ? 'border-teal-600 text-teal-600'
                    : 'border-transparent text-slate-600 hover:text-slate-800'
                }`}
              >
                <div className="flex items-center gap-2">
                  <Package className="w-4 h-4" />
                  General
                </div>
              </button>
              <button
                onClick={() => setActiveTab('items')}
                className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
                  activeTab === 'items'
                    ? 'border-teal-600 text-teal-600'
                    : 'border-transparent text-slate-600 hover:text-slate-800'
                }`}
              >
                <div className="flex items-center gap-2">
                  <Package className="w-4 h-4" />
                  Items ({viewItems.length})
                </div>
              </button>
              <button
                onClick={() => setActiveTab('logistics')}
                className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
                  activeTab === 'logistics'
                    ? 'border-teal-600 text-teal-600'
                    : 'border-transparent text-slate-600 hover:text-slate-800'
                }`}
              >
                <div className="flex items-center gap-2">
                  <Truck className="w-4 h-4" />
                  Logistics
                </div>
              </button>
            </div>

            {/* General Tab */}
            {activeTab === 'general' && (
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-3 p-3 bg-slate-50 rounded border border-slate-200">
                  <div>
                    <p className="text-xs text-slate-500 mb-0.5">Customer</p>
                    <p className="text-sm font-semibold text-slate-800">{viewOrder.customer_name}</p>
                  </div>
                  <div>
                    <p className="text-xs text-slate-500 mb-0.5">Delivery Location</p>
                    <p className="text-sm font-semibold text-slate-800">{viewOrder.delivery_location}</p>
                  </div>
                  <div>
                    <p className="text-xs text-slate-500 mb-0.5">Status</p>
                    <StatusBadge status={viewOrder.status} />
                  </div>
                  <div>
                    <p className="text-xs text-slate-500 mb-0.5">Order Date</p>
                    <p className="text-sm font-semibold text-slate-800">{format(new Date(viewOrder.order_date), 'dd/MM/yyyy')}</p>
                  </div>
                  <div>
                    <p className="text-xs text-slate-500 mb-0.5">Expected Dispatch</p>
                    <p className="text-sm font-semibold text-slate-800">{format(new Date(viewOrder.expected_dispatch_date), 'dd/MM/yyyy')}</p>
                  </div>
                  <div>
                    <p className="text-xs text-slate-500 mb-0.5">Priority</p>
                    <p className="text-sm font-semibold text-slate-800">{viewOrder.priority === 'urgent' ? '🔴 URGENT' : 'Normal'}</p>
                  </div>
                  <div>
                    <p className="text-xs text-slate-500 mb-0.5">Total Tonnage</p>
                    <p className="text-sm font-semibold text-slate-800">{viewOrder.total_tonnage}t</p>
                  </div>
                  <div>
                    <p className="text-xs text-slate-500 mb-0.5">Total Value</p>
                    <p className="text-sm font-semibold text-slate-800">${viewOrder.total_value.toLocaleString()}</p>
                  </div>
                </div>

                {viewOrder.notes && (
                  <div className="p-3 bg-amber-50 border border-amber-200 rounded">
                    <p className="text-xs font-semibold text-amber-800 mb-1">Notes</p>
                    <p className="text-sm text-amber-700">{viewOrder.notes}</p>
                  </div>
                )}
              </div>
            )}

            {/* Items Tab */}
            {activeTab === 'items' && (
              <div>
                <table className="w-full text-sm border border-slate-200 rounded overflow-hidden">
                  <thead className="bg-slate-100">
                    <tr>
                      {['Product Code', 'Product Name', 'Quantity', 'Unit', 'Unit Price', 'Total'].map((h) => (
                        <th key={h} className="text-left px-3 py-2 text-xs font-semibold text-slate-700">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200">
                    {viewItems.map((item) => (
                      <tr key={item.id} className="hover:bg-slate-50">
                        <td className="px-3 py-2 font-mono text-xs text-teal-600">{item.product_code}</td>
                        <td className="px-3 py-2 text-slate-700 font-medium">{item.product_name}</td>
                        <td className="px-3 py-2 text-slate-600 text-right">{item.quantity.toLocaleString()}</td>
                        <td className="px-3 py-2 text-slate-600">{item.unit}</td>
                        <td className="px-3 py-2 text-slate-600 text-right">${item.unit_price.toLocaleString()}</td>
                        <td className="px-3 py-2 text-slate-700 font-semibold text-right">${item.line_total.toLocaleString()}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {/* Logistics Tab */}
            {activeTab === 'logistics' && (
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-3 p-3 bg-slate-50 rounded border border-slate-200">
                  <div>
                    <p className="text-xs text-slate-500 mb-0.5">Vehicle</p>
                    <p className="text-sm font-semibold text-slate-800">{viewOrder.vehicle_id || 'Not assigned'}</p>
                  </div>
                  <div>
                    <p className="text-xs text-slate-500 mb-0.5">Driver</p>
                    <p className="text-sm font-semibold text-slate-800">{viewOrder.driver_name || 'Not assigned'}</p>
                  </div>
                </div>
                <div className="text-center py-6 text-sm text-slate-500">
                  <AlertTriangle className="w-4 h-4 mx-auto mb-2 text-amber-500" />
                  <p>Logistics details will be available when vehicle and driver are assigned</p>
                </div>
              </div>
            )}

            <div className="flex justify-end pt-3 border-t border-slate-200">
              <button
                onClick={() => { setViewOrder(null); setActiveTab('general'); setWorkflowError(null); }}
                className="px-4 py-1.5 text-sm font-medium text-slate-700 bg-white border border-slate-300 rounded hover:bg-slate-50 transition-colors"
              >
                Close
              </button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
