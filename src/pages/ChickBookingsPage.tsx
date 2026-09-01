import { useState, useEffect } from 'react';
import {
  Plus, Search, Eye, Package, Calendar, FileText, Truck, Hash, Clock,
  DollarSign, Scale, CheckCircle, XCircle, CreditCard
} from 'lucide-react';
import { format } from 'date-fns';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import { Supplier } from '../types/database';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Card, CardContent } from '../components/ui/card';
import { Badge } from '../components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../components/ui/dialog';
import { Label } from '../components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { Textarea } from '../components/ui/textarea';
import StatCard from '../components/ui/StatCard';
import toast from 'react-hot-toast';

interface ChickPO {
  id: string;
  po_number: string;
  supplier_id: string | null;
  supplier_name: string;
  ordered_qty: number;
  delivered_qty: number;
  remaining_qty: number;
  unit_price: number;
  total_value: number;
  currency: string;
  status: string;
  finance_verified_by: string | null;
  finance_verified_at: string | null;
  finance_notes: string | null;
  md_approved_by: string | null;
  md_approved_at: string | null;
  md_notes: string | null;
  payment_date: string | null;
  payment_reference: string | null;
  payment_amount: number;
  payment_method: string;
  invoice_received: boolean;
  invoice_number: string | null;
  invoice_date: string | null;
  invoice_amount: number;
  expected_delivery_date: string | null;
  delivery_instructions: string;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

interface ChickDelivery {
  id: string;
  po_id: string;
  delivery_number: string | null;
  delivery_date: string;
  qty_received: number;
  qty_rejected: number;
  qty_accepted: number;
  batch_notes: string | null;
  received_by: string | null;
  created_at: string;
}

export default function ChickBookingsPage() {
  const { profile } = useAuth();
  const [pos, setPos] = useState<ChickPO[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [viewModalOpen, setViewModalOpen] = useState(false);
  const [deliveryModalOpen, setDeliveryModalOpen] = useState(false);
  const [viewing, setViewing] = useState<ChickPO | null>(null);
  const [deliveries, setDeliveries] = useState<ChickDelivery[]>([]);
  const [saving, setSaving] = useState(false);
  const [rejectModalOpen, setRejectModalOpen] = useState(false);
  const [rejectReason, setRejectReason] = useState('');
  const [paymentModalOpen, setPaymentModalOpen] = useState(false);

  // Create form state
  const [supplierId, setSupplierId] = useState('');
  const [orderedQty, setOrderedQty] = useState('');
  const [unitPrice, setUnitPrice] = useState('');
  const [expectedDate, setExpectedDate] = useState('');
  const [deliveryNotes, setDeliveryNotes] = useState('');

  // Delivery form state
  const [deliveryQty, setDeliveryQty] = useState('');
  const [rejectedQty, setRejectedQty] = useState('');
  const [deliveryDate, setDeliveryDate] = useState(new Date().toISOString().split('T')[0]);
  const [deliveryNote, setDeliveryNote] = useState('');

  // Payment form state
  const [paymentAmount, setPaymentAmount] = useState('');
  const [paymentRef, setPaymentRef] = useState('');
  const [paymentMethod, setPaymentMethod] = useState('bank_transfer');
  const [paymentDt, setPaymentDt] = useState(new Date().toISOString().split('T')[0]);

  const isFinance = profile?.role === 'accountant' || profile?.role === 'finance' || profile?.role === 'admin';
  const isMD = profile?.role === 'admin';
  const isPurchase = profile?.role === 'raw_material_manager' || profile?.role === 'finance' || profile?.role === 'admin';

  async function fetchData() {
    setLoading(true);
    const [posRes, suppliersRes] = await Promise.all([
      supabase.from('chick_purchase_orders').select('*').order('created_at', { ascending: false }),
      supabase.from('suppliers').select('*').eq('is_active', true).order('name'),
    ]);
    setPos(posRes.data || []);
    setSuppliers(suppliersRes.data || []);
    setLoading(false);
  }

  useEffect(() => {
    fetchData();
  }, []);

  async function handleCreatePO() {
    if (!supplierId || !orderedQty || !unitPrice) {
      toast.error('Please fill in all required fields');
      return;
    }
    setSaving(true);

    const supplier = suppliers.find(s => s.id === supplierId);
    const nextNum = await getNextPONumber();

    const { error } = await supabase.from('chick_purchase_orders').insert({
      po_number: nextNum,
      supplier_id: supplierId,
      supplier_name: supplier?.name || '',
      ordered_qty: parseFloat(orderedQty),
      unit_price: parseFloat(unitPrice),
      expected_delivery_date: expectedDate || null,
      delivery_instructions: deliveryNotes,
      status: 'draft',
      created_by: profile?.id,
    });

    setSaving(false);
    if (error) {
      toast.error('Failed to create PO: ' + error.message);
      return;
    }

    toast.success('Purchase Order created');
    resetCreateForm();
    setCreateModalOpen(false);
    fetchData();
  }

  async function getNextPONumber(): Promise<string> {
    const { data } = await supabase
      .from('chick_purchase_orders')
      .select('po_number')
      .order('created_at', { ascending: false })
      .limit(1);
    if (!data?.length) return 'CHICK-0001';
    const last = data[0].po_number;
    const match = last.match(/(\d+)$/);
    const num = match ? parseInt(match[1]) + 1 : 1;
    return `CHICK-${String(num).padStart(4, '0')}`;
  }

  function resetCreateForm() {
    setSupplierId('');
    setOrderedQty('');
    setUnitPrice('');
    setExpectedDate('');
    setDeliveryNotes('');
  }

  async function handleViewPO(po: ChickPO) {
    setViewing(po);
    const { data } = await supabase
      .from('chick_deliveries')
      .select('*')
      .eq('po_id', po.id)
      .order('delivery_date', { ascending: true });
    setDeliveries(data || []);
    setViewModalOpen(true);
  }

  async function handleFinanceVerify() {
    if (!viewing) return;
    setSaving(true);
    const { error } = await supabase
      .from('chick_purchase_orders')
      .update({
        status: 'finance_verified',
        finance_verified_by: profile?.id,
        finance_verified_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', viewing.id);
    setSaving(false);
    if (error) {
      toast.error('Failed to verify: ' + error.message);
      return;
    }
    toast.success('Finance verification completed');
    setViewModalOpen(false);
    fetchData();
  }

  async function handleMDApprove() {
    if (!viewing) return;
    setSaving(true);
    const { error } = await supabase
      .from('chick_purchase_orders')
      .update({
        status: 'md_approved',
        md_approved_by: profile?.id,
        md_approved_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', viewing.id);
    setSaving(false);
    if (error) {
      toast.error('Failed to approve: ' + error.message);
      return;
    }
    toast.success('MD approval granted');
    setViewModalOpen(false);
    fetchData();
  }

  async function handleReject() {
    if (!viewing || !rejectReason.trim()) {
      toast.error('Please provide a rejection reason');
      return;
    }
    setSaving(true);
    const { error } = await supabase
      .from('chick_purchase_orders')
      .update({
        status: 'rejected',
        md_notes: rejectReason,
        updated_at: new Date().toISOString(),
      })
      .eq('id', viewing.id);
    setSaving(false);
    if (error) {
      toast.error('Failed to reject: ' + error.message);
      return;
    }
    toast.success('PO rejected');
    setRejectModalOpen(false);
    setRejectReason('');
    setViewModalOpen(false);
    fetchData();
  }

  async function handleRecordPayment() {
    if (!viewing || !paymentAmount || !paymentRef) {
      toast.error('Please fill payment amount and reference');
      return;
    }
    setSaving(true);
    const { error } = await supabase
      .from('chick_purchase_orders')
      .update({
        status: 'paid',
        payment_date: paymentDt,
        payment_reference: paymentRef,
        payment_amount: parseFloat(paymentAmount),
        payment_method: paymentMethod,
        updated_at: new Date().toISOString(),
      })
      .eq('id', viewing.id);
    setSaving(false);
    if (error) {
      toast.error('Failed to record payment: ' + error.message);
      return;
    }
    toast.success('Payment recorded');
    setPaymentModalOpen(false);
    resetPaymentForm();
    setViewModalOpen(false);
    fetchData();
  }

  function resetPaymentForm() {
    setPaymentAmount('');
    setPaymentRef('');
    setPaymentMethod('bank_transfer');
    setPaymentDt(new Date().toISOString().split('T')[0]);
  }

  async function handleAddDelivery() {
    if (!viewing || !deliveryQty) {
      toast.error('Please enter quantity received');
      return;
    }
    const rec = parseFloat(deliveryQty);
    const rej = parseFloat(rejectedQty) || 0;
    if (rec <= 0) {
      toast.error('Quantity must be greater than 0');
      return;
    }
    if (rec + viewing.delivered_qty > viewing.ordered_qty) {
      toast.error(`Cannot exceed ordered quantity (${viewing.ordered_qty.toLocaleString()})`);
      return;
    }

    setSaving(true);
    const nextDelNum = await getNextDeliveryNumber(viewing.id);
    const { error } = await supabase.from('chick_deliveries').insert({
      po_id: viewing.id,
      delivery_number: nextDelNum,
      delivery_date: deliveryDate,
      qty_received: rec,
      qty_rejected: rej,
      batch_notes: deliveryNote,
      received_by: profile?.id,
    });
    setSaving(false);
    if (error) {
      toast.error('Failed to record delivery: ' + error.message);
      return;
    }

    toast.success('Delivery recorded');
    resetDeliveryForm();
    setDeliveryModalOpen(false);
    handleViewPO({ ...viewing, status: viewing.status }); // refresh view
    fetchData();
  }

  async function getNextDeliveryNumber(poId: string): Promise<string> {
    const { data } = await supabase
      .from('chick_deliveries')
      .select('delivery_number')
      .eq('po_id', poId)
      .order('created_at', { ascending: false })
      .limit(1);
    if (!data?.length) return 'DEL-001';
    const last = data[0].delivery_number || 'DEL-000';
    const match = last.match(/(\d+)$/);
    const num = match ? parseInt(match[1]) + 1 : 1;
    return `DEL-${String(num).padStart(3, '0')}`;
  }

  function resetDeliveryForm() {
    setDeliveryQty('');
    setRejectedQty('');
    setDeliveryDate(new Date().toISOString().split('T')[0]);
    setDeliveryNote('');
  }

  const filtered = pos.filter(p =>
    p.po_number.toLowerCase().includes(search.toLowerCase()) ||
    (p.supplier_name || '').toLowerCase().includes(search.toLowerCase()) ||
    p.status.toLowerCase().includes(search.toLowerCase())
  );

  const stats = {
    total: pos.length,
    pending: pos.filter(p => p.status === 'draft' || p.status === 'finance_verified').length,
    totalOrdered: pos.reduce((s, p) => s + (p.ordered_qty || 0), 0),
    totalDelivered: pos.reduce((s, p) => s + (p.delivered_qty || 0), 0),
  };

  const getStatusBadge = (status: string) => {
    const variants: Record<string, any> = {
      draft: { label: 'Draft', className: 'bg-slate-100 text-slate-700 hover:bg-slate-100' },
      finance_verified: { label: 'Finance Verified', className: 'bg-blue-100 text-blue-700 hover:bg-blue-100' },
      md_approved: { label: 'MD Approved', className: 'bg-purple-100 text-purple-700 hover:bg-purple-100' },
      paid: { label: 'Paid', className: 'bg-amber-100 text-amber-700 hover:bg-amber-100' },
      partially_delivered: { label: 'Partially Delivered', className: 'bg-orange-100 text-orange-700 hover:bg-orange-100' },
      fully_delivered: { label: 'Fully Delivered', className: 'bg-emerald-100 text-emerald-700 hover:bg-emerald-100' },
      closed: { label: 'Closed', className: 'bg-slate-100 text-slate-600 hover:bg-slate-100' },
      rejected: { label: 'Rejected', className: 'bg-red-100 text-red-700 hover:bg-red-100' },
    };
    const v = variants[status] || variants.draft;
    return <Badge className={v.className}>{v.label}</Badge>;
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">Chick Bookings</h1>
          <p className="text-slate-500">Purchase orders, approvals & batch deliveries</p>
        </div>
        {isPurchase && (
          <Button onClick={() => setCreateModalOpen(true)}>
            <Plus className="h-4 w-4 mr-2" />
            New PO
          </Button>
        )}
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <StatCard icon={Package} title="Total POs" value={stats.total} subtitle="All time" color="blue" />
        <StatCard icon={Clock} title="Pending Approval" value={stats.pending} subtitle="Awaiting approval" color="amber" />
        <StatCard icon={Scale} title="Total Ordered" value={stats.totalOrdered.toLocaleString()} subtitle="Chicks" color="emerald" />
        <StatCard icon={CheckCircle} title="Total Delivered" value={stats.totalDelivered.toLocaleString()} subtitle="Chicks received" color="teal" />
      </div>

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
        <Input
          placeholder="Search PO number, supplier, status..."
          className="pl-10"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      {/* Table */}
      <div className="border rounded-lg overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow className="bg-slate-50">
              <TableHead className="text-xs font-semibold">PO Number</TableHead>
              <TableHead className="text-xs font-semibold">Supplier</TableHead>
              <TableHead className="text-xs font-semibold text-right">Ordered</TableHead>
              <TableHead className="text-xs font-semibold text-right">Delivered</TableHead>
              <TableHead className="text-xs font-semibold text-right">Remaining</TableHead>
              <TableHead className="text-xs font-semibold text-right">Unit Price</TableHead>
              <TableHead className="text-xs font-semibold">Status</TableHead>
              <TableHead className="text-xs font-semibold">Created</TableHead>
              <TableHead className="text-xs font-semibold w-[80px]">Action</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading && (
              <TableRow>
                <TableCell colSpan={9} className="text-center py-8">
                  <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-slate-600 mx-auto" />
                </TableCell>
              </TableRow>
            )}
            {!loading && filtered.map((po) => (
              <TableRow key={po.id} className="cursor-pointer hover:bg-slate-50" onClick={() => handleViewPO(po)}>
                <TableCell className="font-medium text-sm">{po.po_number}</TableCell>
                <TableCell className="text-sm">{po.supplier_name || '-'}</TableCell>
                <TableCell className="text-sm text-right font-medium">{po.ordered_qty.toLocaleString()}</TableCell>
                <TableCell className="text-sm text-right">{po.delivered_qty.toLocaleString()}</TableCell>
                <TableCell className="text-sm text-right">
                  <span className={po.remaining_qty > 0 ? 'text-amber-600 font-medium' : 'text-emerald-600 font-medium'}>
                    {po.remaining_qty.toLocaleString()}
                  </span>
                </TableCell>
                <TableCell className="text-sm text-right">${po.unit_price.toFixed(2)}</TableCell>
                <TableCell>{getStatusBadge(po.status)}</TableCell>
                <TableCell className="text-xs text-slate-500">{format(new Date(po.created_at), 'PP')}</TableCell>
                <TableCell>
                  <Button variant="ghost" size="sm" onClick={(e) => { e.stopPropagation(); handleViewPO(po); }}>
                    <Eye className="h-4 w-4" />
                  </Button>
                </TableCell>
              </TableRow>
            ))}
            {!loading && filtered.length === 0 && (
              <TableRow>
                <TableCell colSpan={9} className="text-center py-8 text-slate-400">
                  No purchase orders found
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      {/* Create PO Modal */}
      <Dialog open={createModalOpen} onOpenChange={setCreateModalOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>New Chick Purchase Order</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div>
              <Label>Supplier *</Label>
              <Select value={supplierId} onValueChange={setSupplierId}>
                <SelectTrigger><SelectValue placeholder="Select supplier" /></SelectTrigger>
                <SelectContent>
                  {suppliers.map(s => (
                    <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Quantity (chicks) *</Label>
                <Input type="number" value={orderedQty} onChange={(e) => setOrderedQty(e.target.value)} />
              </div>
              <div>
                <Label>Unit Price (USD) *</Label>
                <Input type="number" step="0.01" value={unitPrice} onChange={(e) => setUnitPrice(e.target.value)} />
              </div>
            </div>
            {orderedQty && unitPrice && (
              <div className="bg-slate-50 p-3 rounded-lg text-sm">
                <span className="text-slate-500">Total Value:</span>{' '}
                <span className="font-bold text-slate-800">
                  ${(parseFloat(orderedQty) * parseFloat(unitPrice)).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </span>
              </div>
            )}
            <div>
              <Label>Expected Delivery Date</Label>
              <Input type="date" value={expectedDate} onChange={(e) => setExpectedDate(e.target.value)} />
            </div>
            <div>
              <Label>Delivery Instructions</Label>
              <Textarea value={deliveryNotes} onChange={(e) => setDeliveryNotes(e.target.value)} rows={2} />
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setCreateModalOpen(false)}>Cancel</Button>
            <Button onClick={handleCreatePO} disabled={saving}>
              {saving ? 'Creating...' : 'Create PO'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* View PO Modal */}
      <Dialog open={viewModalOpen} onOpenChange={setViewModalOpen}>
        <DialogContent className="max-w-[1000px] w-[95vw] max-h-[90vh] overflow-y-auto p-0">
          {/* Header */}
          <div className="bg-slate-900 text-white px-8 py-6 rounded-t-lg">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 bg-emerald-500 rounded-lg flex items-center justify-center shadow-lg">
                  <Package className="w-6 h-6 text-white" />
                </div>
                <div>
                  <h2 className="text-2xl font-bold tracking-tight">{viewing?.po_number}</h2>
                  <p className="text-slate-400 text-sm mt-0.5">
                    <Calendar className="w-3.5 h-3.5 inline mr-1" />
                    Expected {viewing?.expected_delivery_date ? format(new Date(viewing.expected_delivery_date), 'PPP') : 'Not set'}
                  </p>
                </div>
              </div>
              {viewing && getStatusBadge(viewing.status)}
            </div>
          </div>

          <div className="px-8 py-6 space-y-6">
            {/* Info Cards */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              <Card className="border-l-4 border-l-blue-500 shadow-sm">
                <CardContent className="p-3">
                  <p className="text-[11px] text-slate-500 font-medium uppercase tracking-wide">Supplier</p>
                  <p className="text-sm font-semibold text-slate-800 mt-0.5 truncate">{viewing?.supplier_name || 'N/A'}</p>
                </CardContent>
              </Card>
              <Card className="border-l-4 border-l-emerald-500 shadow-sm">
                <CardContent className="p-3">
                  <p className="text-[11px] text-slate-500 font-medium uppercase tracking-wide">Ordered</p>
                  <p className="text-sm font-semibold text-slate-800 mt-0.5">{viewing?.ordered_qty.toLocaleString()} <span className="text-xs font-normal text-slate-500">chicks</span></p>
                </CardContent>
              </Card>
              <Card className="border-l-4 border-l-amber-500 shadow-sm">
                <CardContent className="p-3">
                  <p className="text-[11px] text-slate-500 font-medium uppercase tracking-wide">Delivered</p>
                  <p className="text-sm font-semibold text-slate-800 mt-0.5">{viewing?.delivered_qty.toLocaleString()} <span className="text-xs font-normal text-slate-500">chicks</span></p>
                </CardContent>
              </Card>
              <Card className="border-l-4 border-l-purple-500 shadow-sm">
                <CardContent className="p-3">
                  <p className="text-[11px] text-slate-500 font-medium uppercase tracking-wide">Remaining</p>
                  <p className="text-sm font-semibold text-slate-800 mt-0.5">{viewing?.remaining_qty.toLocaleString()} <span className="text-xs font-normal text-slate-500">chicks</span></p>
                </CardContent>
              </Card>
            </div>

            {/* Pricing */}
            <div className="bg-slate-50 rounded-lg p-4 flex items-center justify-between">
              <div className="flex items-center gap-6">
                <div className="flex items-center gap-2">
                  <DollarSign className="w-4 h-4 text-slate-400" />
                  <span className="text-sm text-slate-600">Unit Price: <strong className="text-slate-800">${viewing?.unit_price.toFixed(2)}</strong></span>
                </div>
                <div className="w-px h-5 bg-slate-300" />
                <div className="flex items-center gap-2">
                  <Hash className="w-4 h-4 text-slate-400" />
                  <span className="text-sm text-slate-600">Total Value: <strong className="text-slate-800">${viewing?.total_value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</strong></span>
                </div>
              </div>
              {viewing?.invoice_received && (
                <Badge variant="outline" className="text-emerald-600 border-emerald-200">
                  <FileText className="w-3 h-3 mr-1" /> Invoice {viewing.invoice_number}
                </Badge>
              )}
            </div>

            {/* Approval Workflow Section */}
            <div className="space-y-3">
              <h3 className="text-sm font-bold text-slate-700 uppercase tracking-wide">Approval Workflow</h3>
              <div className="flex items-center gap-2">
                {['draft', 'finance_verified', 'md_approved', 'paid', 'partially_delivered', 'fully_delivered', 'closed'].map((step, idx) => {
                  const isActive = viewing && getStepIndex(viewing.status) >= idx;
                  const isCurrent = viewing?.status === step;
                  const labels: Record<string, string> = {
                    draft: 'Draft', finance_verified: 'Finance', md_approved: 'MD Approve',
                    paid: 'Paid', partially_delivered: 'Delivering', fully_delivered: 'Delivered', closed: 'Closed'
                  };
                  return (
                    <div key={step} className="flex items-center gap-1">
                      <div className={`px-2 py-1 rounded text-xs font-medium ${
                        isActive ? (isCurrent ? 'bg-emerald-100 text-emerald-700 ring-2 ring-emerald-300' : 'bg-emerald-50 text-emerald-600') :
                        'bg-slate-100 text-slate-400'
                      }`}>
                        {labels[step]}
                      </div>
                      {idx < 6 && <ChevronRight className="w-3 h-3 text-slate-300" />}
                    </div>
                  );
                })}
              </div>

              {/* Action Buttons */}
              {viewing?.status === 'draft' && isFinance && (
                <div className="p-3 bg-blue-50 border border-blue-200 rounded-lg flex items-center justify-between">
                  <p className="text-sm text-blue-800 font-medium">Finance Verification Required</p>
                  <Button size="sm" onClick={handleFinanceVerify} disabled={saving}>
                    <CheckCircle className="w-4 h-4 mr-1" /> Verify
                  </Button>
                </div>
              )}

              {viewing?.status === 'finance_verified' && isMD && (
                <div className="p-3 bg-purple-50 border border-purple-200 rounded-lg">
                  <p className="text-sm text-purple-800 font-medium mb-2">MD Approval Required</p>
                  <div className="flex items-center gap-2">
                    <Button size="sm" onClick={handleMDApprove} disabled={saving}>
                      <CheckCircle className="w-4 h-4 mr-1" /> Approve
                    </Button>
                    <Button size="sm" variant="destructive" onClick={() => setRejectModalOpen(true)}>
                      <XCircle className="w-4 h-4 mr-1" /> Reject
                    </Button>
                  </div>
                </div>
              )}

              {viewing?.status === 'md_approved' && isMD && (
                <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg flex items-center justify-between">
                  <p className="text-sm text-amber-800 font-medium">Record Payment to proceed</p>
                  <Button size="sm" onClick={() => setPaymentModalOpen(true)}>
                    <CreditCard className="w-4 h-4 mr-1" /> Record Payment
                  </Button>
                </div>
              )}

              {(viewing?.status === 'paid' || viewing?.status === 'partially_delivered') && (
                <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-lg flex items-center justify-between">
                  <p className="text-sm text-emerald-800 font-medium">
                    Remaining: {viewing.remaining_qty.toLocaleString()} chicks
                  </p>
                  <Button size="sm" onClick={() => setDeliveryModalOpen(true)}>
                    <Truck className="w-4 h-4 mr-1" /> Add Delivery
                  </Button>
                </div>
              )}

              {viewing?.status === 'rejected' && (
                <div className="p-3 bg-red-50 border border-red-200 rounded-lg">
                  <p className="text-sm text-red-800 font-medium">Rejected</p>
                  {viewing.md_notes && <p className="text-sm text-red-600 mt-1">{viewing.md_notes}</p>}
                </div>
              )}
            </div>

            {/* Payment Details */}
            {viewing?.payment_date && (
              <div className="bg-amber-50/50 border border-amber-200 rounded-lg p-4">
                <p className="text-xs font-medium text-amber-700 uppercase tracking-wide mb-2">Payment Details</p>
                <div className="grid grid-cols-3 gap-4 text-sm">
                  <div>
                    <span className="text-slate-500">Amount:</span>{' '}
                    <strong className="text-slate-800">${viewing.payment_amount.toFixed(2)}</strong>
                  </div>
                  <div>
                    <span className="text-slate-500">Reference:</span>{' '}
                    <strong className="text-slate-800">{viewing.payment_reference}</strong>
                  </div>
                  <div>
                    <span className="text-slate-500">Method:</span>{' '}
                    <strong className="text-slate-800 capitalize">{viewing.payment_method.replace('_', ' ')}</strong>
                  </div>
                  <div>
                    <span className="text-slate-500">Date:</span>{' '}
                    <strong className="text-slate-800">{format(new Date(viewing.payment_date), 'PPP')}</strong>
                  </div>
                </div>
              </div>
            )}

            {/* Deliveries Table */}
            <div>
              <div className="flex items-center gap-2 mb-3">
                <Truck className="w-4 h-4 text-slate-600" />
                <h3 className="text-sm font-bold text-slate-700 uppercase tracking-wide">Delivery Batches</h3>
                <span className="text-xs text-slate-500 bg-slate-100 px-2 py-0.5 rounded-full">{deliveries.length} batch{deliveries.length !== 1 ? 'es' : ''}</span>
              </div>
              {deliveries.length > 0 ? (
                <div className="border border-slate-200 rounded-xl overflow-hidden">
                  <Table>
                    <TableHeader>
                      <TableRow className="bg-slate-50">
                        <TableHead className="text-xs font-bold">Delivery #</TableHead>
                        <TableHead className="text-xs font-bold">Date</TableHead>
                        <TableHead className="text-xs font-bold text-right">Received</TableHead>
                        <TableHead className="text-xs font-bold text-right">Rejected</TableHead>
                        <TableHead className="text-xs font-bold text-right">Accepted</TableHead>
                        <TableHead className="text-xs font-bold">Notes</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {deliveries.map((d) => (
                        <TableRow key={d.id}>
                          <TableCell className="text-sm font-medium">{d.delivery_number}</TableCell>
                          <TableCell className="text-sm">{format(new Date(d.delivery_date), 'PP')}</TableCell>
                          <TableCell className="text-sm text-right">{d.qty_received.toLocaleString()}</TableCell>
                          <TableCell className="text-sm text-right text-red-600">{d.qty_rejected.toLocaleString()}</TableCell>
                          <TableCell className="text-sm text-right font-semibold text-emerald-700">{d.qty_accepted.toLocaleString()}</TableCell>
                          <TableCell className="text-sm text-slate-600">{d.batch_notes || '-'}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              ) : (
                <div className="text-center py-6 text-slate-400 border border-dashed border-slate-200 rounded-xl">
                  <Truck className="w-6 h-6 mx-auto mb-1" />
                  <p className="text-sm">No deliveries recorded yet</p>
                </div>
              )}
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Delivery Modal */}
      <Dialog open={deliveryModalOpen} onOpenChange={setDeliveryModalOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Record Delivery Batch</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="bg-slate-50 p-3 rounded-lg text-sm">
              <span className="text-slate-500">Ordered:</span>{' '}
              <strong>{viewing?.ordered_qty.toLocaleString()}</strong>{' '}
              <span className="text-slate-500 ml-2">Already delivered:</span>{' '}
              <strong>{viewing?.delivered_qty.toLocaleString()}</strong>{' '}
              <span className="text-slate-500 ml-2">Remaining:</span>{' '}
              <strong className="text-emerald-600">{viewing?.remaining_qty.toLocaleString()}</strong>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Qty Received *</Label>
                <Input type="number" value={deliveryQty} onChange={(e) => setDeliveryQty(e.target.value)} />
              </div>
              <div>
                <Label>Qty Rejected (DOA)</Label>
                <Input type="number" value={rejectedQty} onChange={(e) => setRejectedQty(e.target.value)} />
              </div>
            </div>
            <div>
              <Label>Delivery Date</Label>
              <Input type="date" value={deliveryDate} onChange={(e) => setDeliveryDate(e.target.value)} />
            </div>
            <div>
              <Label>Notes</Label>
              <Textarea value={deliveryNote} onChange={(e) => setDeliveryNote(e.target.value)} rows={2} placeholder="Batch condition, mortality rate, etc." />
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setDeliveryModalOpen(false)}>Cancel</Button>
            <Button onClick={handleAddDelivery} disabled={saving}>
              {saving ? 'Recording...' : 'Record Delivery'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Payment Modal */}
      <Dialog open={paymentModalOpen} onOpenChange={setPaymentModalOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Record Payment</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="bg-slate-50 p-3 rounded-lg text-sm">
              <span className="text-slate-500">PO Total:</span>{' '}
              <strong>${viewing?.total_value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</strong>
            </div>
            <div>
              <Label>Payment Amount *</Label>
              <Input type="number" step="0.01" value={paymentAmount} onChange={(e) => setPaymentAmount(e.target.value)} />
            </div>
            <div>
              <Label>Payment Reference *</Label>
              <Input value={paymentRef} onChange={(e) => setPaymentRef(e.target.value)} placeholder="Bank ref, Ecocash ref, etc." />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Payment Method</Label>
                <Select value={paymentMethod} onValueChange={setPaymentMethod}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="bank_transfer">Bank Transfer</SelectItem>
                    <SelectItem value="cash">Cash</SelectItem>
                    <SelectItem value="ecocash">Ecocash</SelectItem>
                    <SelectItem value="other">Other</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Payment Date</Label>
                <Input type="date" value={paymentDt} onChange={(e) => setPaymentDt(e.target.value)} />
              </div>
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setPaymentModalOpen(false)}>Cancel</Button>
            <Button onClick={handleRecordPayment} disabled={saving}>
              <CreditCard className="w-4 h-4 mr-1" />
              {saving ? 'Recording...' : 'Record Payment'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Reject Modal */}
      <Dialog open={rejectModalOpen} onOpenChange={setRejectModalOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Reject Purchase Order</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <p className="text-sm text-slate-600">Please provide a reason for rejecting this PO:</p>
            <Textarea
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              rows={4}
              placeholder="Enter rejection reason..."
            />
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => { setRejectModalOpen(false); setRejectReason(''); }}>Cancel</Button>
            <Button variant="destructive" onClick={handleReject} disabled={saving || !rejectReason.trim()}>
              <XCircle className="w-4 h-4 mr-1" />
              {saving ? 'Rejecting...' : 'Confirm Rejection'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function ChevronRight({ className }: { className?: string }) {
  return (
    <svg className={className} width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="9 18 15 12 9 6" />
    </svg>
  );
}

function getStepIndex(status: string): number {
  const steps = ['draft', 'finance_verified', 'md_approved', 'paid', 'partially_delivered', 'fully_delivered', 'closed'];
  return steps.indexOf(status);
}
