import { useState, useEffect } from 'react';
import { Plus, Search, Eye, Calendar, Package, FileText, Clock, CheckCircle2, DollarSign, Truck } from 'lucide-react';
import { format } from 'date-fns';
import { supabase } from '../lib/supabase';
import Modal from '../components/ui/Modal';
import StatusBadge from '../components/ui/StatusBadge';
import StatCard from '../components/ui/StatCard';

interface SalesOrder {
  id: string;
  order_number: string;
  customer_name: string;
  customer_location: string;
  order_date: string;
  expected_delivery_date: string;
  total_tonnage: number;
  total_value: number;
  status: 'pending' | 'confirmed' | 'in_production' | 'ready' | 'dispatched' | 'delivered' | 'cancelled';
  priority: 'normal' | 'urgent';
  notes: string;
  branch_id: string;
  created_by: string;
  created_at: string;
  updated_at: string;
}

interface SalesOrderItem {
  id: string;
  sales_order_id: string;
  formulation_id: string;
  product_code: string;
  product_name: string;
  quantity: number;
  unit: string;
  unit_price: number;
  line_total: number;
}

export default function SalesOrdersPage() {
  const [orders, setOrders] = useState<SalesOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [viewOrder, setViewOrder] = useState<SalesOrder | null>(null);
  const [viewItems, setViewItems] = useState<SalesOrderItem[]>([]);
  const [activeTab, setActiveTab] = useState<'general' | 'items' | 'history'>('general');

  useEffect(() => {
    fetchOrders();
  }, []);

  async function fetchOrders() {
    setLoading(true);
    const { data } = await supabase
      .from('sales_orders')
      .select('*')
      .order('expected_delivery_date', { ascending: true });
    
    if (data) setOrders(data);
    setLoading(false);
  }

  async function openView(order: SalesOrder) {
    setViewOrder(order);
    const { data } = await supabase
      .from('sales_order_items')
      .select('*')
      .eq('sales_order_id', order.id);
    
    if (data) setViewItems(data);
  }

  const filteredOrders = orders.filter((order) => {
    const matchesSearch = 
      order.order_number.toLowerCase().includes(searchTerm.toLowerCase()) ||
      order.customer_name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      order.customer_location.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesStatus = statusFilter === 'all' || order.status === statusFilter;
    return matchesSearch && matchesStatus;
  });

  const statusCounts = {
    all: orders.length,
    pending: orders.filter(o => o.status === 'pending').length,
    confirmed: orders.filter(o => o.status === 'confirmed').length,
    in_production: orders.filter(o => o.status === 'in_production').length,
    ready: orders.filter(o => o.status === 'ready').length,
    dispatched: orders.filter(o => o.status === 'dispatched').length,
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
          <h1 className="text-2xl font-bold text-slate-800">Sales Orders</h1>
          <p className="text-sm text-slate-500 mt-1">Manage customer orders and track deliveries</p>
        </div>
        <button className="flex items-center gap-2 px-4 py-2.5 bg-teal-600 hover:bg-teal-700 text-white rounded-lg text-sm font-semibold transition-colors">
          <Plus className="w-4 h-4" />
          New Order
        </button>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard title="Total Orders" value={orders.length} icon={FileText} color="teal" />
        <StatCard title="Pending" value={statusCounts.pending} icon={Clock} color="amber" />
        <StatCard title="Total Tonnage" value={`${totalTonnage.toLocaleString()}t`} icon={Truck} color="slate" />
        <StatCard title="Total Value" value={`$${totalValue.toLocaleString(undefined, {maximumFractionDigits: 0})}`} icon={DollarSign} color="emerald" />
      </div>

      <div className="flex items-center gap-4">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <input
            type="text"
            placeholder="Search by order number, customer name, or location..."
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
            <option value="pending">Pending ({statusCounts.pending})</option>
            <option value="confirmed">Confirmed ({statusCounts.confirmed})</option>
            <option value="in_production">In Production ({statusCounts.in_production})</option>
            <option value="ready">Ready ({statusCounts.ready})</option>
            <option value="dispatched">Dispatched ({statusCounts.dispatched})</option>
        </select>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr>
                {['Order #', 'Customer', 'Location', 'Expected Date', 'Tonnage', 'Value', 'Status', 'Priority', 'Actions'].map((header) => (
                  <th key={header} className="px-4 py-3 text-left text-xs font-medium text-slate-600">
                    {header}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {filteredOrders.length === 0 ? (
                <tr>
                  <td colSpan={9} className="px-3 py-6 text-center text-sm text-slate-500">
                    No sales orders found
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
                    <td className="px-4 py-3 text-sm text-slate-600">{order.customer_location}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1.5 text-xs text-slate-600">
                        <Calendar className="w-3.5 h-3.5 text-slate-400" />
                        {format(new Date(order.expected_delivery_date), 'dd/MM/yyyy')}
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
        title={`Sales Order: ${viewOrder?.order_number}`}
      >
        {viewOrder && (
          <div className="space-y-3">
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
                  <FileText className="w-4 h-4" />
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
                onClick={() => setActiveTab('history')}
                className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
                  activeTab === 'history'
                    ? 'border-teal-600 text-teal-600'
                    : 'border-transparent text-slate-600 hover:text-slate-800'
                }`}
              >
                <div className="flex items-center gap-2">
                  <Clock className="w-4 h-4" />
                  History
                </div>
              </button>
            </div>

            {/* General Tab */}
            {activeTab === 'general' && (
              <div className="space-y-3">
                <div className="grid grid-cols-3 gap-3 p-3 bg-slate-50 rounded border border-slate-200">
                  <div>
                    <p className="text-xs text-slate-500 mb-0.5">Customer</p>
                    <p className="text-sm font-semibold text-slate-800">{viewOrder.customer_name}</p>
                  </div>
                  <div>
                    <p className="text-xs text-slate-500 mb-0.5">Location</p>
                    <p className="text-sm font-semibold text-slate-800">{viewOrder.customer_location}</p>
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
                    <p className="text-xs text-slate-500 mb-0.5">Expected Delivery</p>
                    <p className="text-sm font-semibold text-slate-800">{format(new Date(viewOrder.expected_delivery_date), 'dd/MM/yyyy')}</p>
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
                  <div>
                    <p className="text-xs text-slate-500 mb-0.5">Items</p>
                    <p className="text-sm font-semibold text-slate-800">{viewItems.length} products</p>
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

            {/* History Tab */}
            {activeTab === 'history' && (
              <div className="space-y-3">
                <div className="flex items-start gap-3 p-3 bg-slate-50 border border-slate-200 rounded">
                  <div className="p-2 bg-green-100 rounded">
                    <CheckCircle2 className="w-4 h-4 text-green-600" />
                  </div>
                  <div className="flex-1">
                    <p className="text-sm font-medium text-slate-800">Order Created</p>
                    <p className="text-xs text-slate-500 mt-0.5">{format(new Date(viewOrder.created_at), 'dd/MM/yyyy HH:mm')}</p>
                  </div>
                </div>
                <div className="text-center py-6 text-sm text-slate-500">
                  No additional history available
                </div>
              </div>
            )}

            <div className="flex justify-end gap-2 pt-3 border-t border-slate-200">
              <button
                onClick={() => { setViewOrder(null); setActiveTab('general'); }}
                className="px-4 py-1.5 text-sm font-medium text-slate-700 bg-white border border-slate-300 rounded hover:bg-slate-50 transition-colors"
              >
                Close
              </button>
              <button className="px-4 py-1.5 text-sm font-medium text-white bg-teal-600 rounded-lg hover:bg-teal-700 transition-colors">
                Edit Order
              </button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
