import { useState, useEffect } from 'react';
import { Plus, Search, Eye, FileText, CheckCircle, Trash2, Send, Pencil } from 'lucide-react';
// Force rebuild - v2.5 - null-safe supplier access
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../context/AuthContext';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../components/ui/card';
import { Badge } from '../../components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../../components/ui/table';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '../../components/ui/dialog';
import { Label } from '../../components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../components/ui/select';
import { Textarea } from '../../components/ui/textarea';
import StatCard from '../../components/ui/StatCard';
import toast from 'react-hot-toast';
import { format } from 'date-fns';

interface Supplier {
  id: string;
  name: string;
}

interface Branch {
  branch_code: string;
  branch_name: string;
  delivery_type: 'LOCAL' | 'BRANCH';
}

interface POLine {
  id: string;
  branch_code: string;
  delivery_type: 'LOCAL' | 'BRANCH';
  booked_qty: number;
  wish_qty: number;
  chick_type: 'STANDARD' | 'HUBBARD';
  notes: string;
}

interface PurchaseOrder {
  id: string;
  po_number: string;
  supplier: {
    name: string;
  };
  expected_delivery_date: string;
  chick_type: 'STANDARD' | 'HUBBARD';
  status: string;
  notes: string | null;
  created_at: string;
  approved_at: string | null;
  lines: POLine[];
}

export default function ChickPurchaseOrders() {
  const { profile } = useAuth();
  const [pos, setPos] = useState<PurchaseOrder[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filterStatus, setFilterStatus] = useState<string>('ALL');
  const [modalOpen, setModalOpen] = useState(false);
  const [viewModalOpen, setViewModalOpen] = useState(false);
  const [viewing, setViewing] = useState<PurchaseOrder | null>(null);
  const [saving, setSaving] = useState(false);
  const [adjustModalOpen, setAdjustModalOpen] = useState(false);
  const [adjustingPO, setAdjustingPO] = useState<PurchaseOrder | null>(null);
  const [adjustLines, setAdjustLines] = useState<POLine[]>([]);

  // Form state
  const [supplierId, setSupplierId] = useState('');
  const [expectedDate, setExpectedDate] = useState('');
  const [chickType, setChickType] = useState<'STANDARD' | 'HUBBARD'>('STANDARD');
  const [notes, setNotes] = useState('');
  const [lines, setLines] = useState<Omit<POLine, 'id'>[]>([]);

  useEffect(() => {
    fetchData();
  }, []);

  async function fetchData() {
    setLoading(true);
    const [posRes, suppliersRes, branchesRes] = await Promise.all([
      supabase
        .from('chick_purchase_orders')
        .select(`
          *,
          supplier:chick_suppliers (
            name
          ),
          lines:chick_po_lines (
            id,
            branch_code,
            delivery_type,
            booked_qty,
            wish_qty,
            chick_type,
            notes
          )
        `)
        .order('created_at', { ascending: false }),
      supabase.from('chick_suppliers').select('*').eq('is_active', true).order('name'),
      supabase.from('chick_branches').select('*').eq('is_active', true).order('branch_name'),
    ]);

    if (suppliersRes.error) {
      console.error('chick_suppliers fetch error:', suppliersRes.error);
    }
    console.log('Loaded suppliers:', suppliersRes.data);

    if (branchesRes.error) {
      console.error('chick_branches fetch error:', branchesRes.error);
      toast.error('Failed to load branches: ' + branchesRes.error.message);
    }
    if ((branchesRes.data || []).length === 0) {
      console.warn('No branches found — run migration: 20260518_chick_seed_data.sql');
    }

    // Transform data
    const transformedPos = (posRes.data || []).map((po: any) => ({
      ...po,
      supplier: Array.isArray(po.supplier) ? po.supplier[0] : po.supplier,
      lines: po.lines || [],
    }));

    setPos(transformedPos);
    setSuppliers(suppliersRes.data || []);
    setBranches(branchesRes.data || []);
    setLoading(false);
  }

  async function fetchSuppliersOnly() {
    const { data, error } = await supabase
      .from('chick_suppliers')
      .select('*')
      .eq('is_active', true)
      .order('name');
    if (error) {
      console.error('Error fetching suppliers:', error);
    } else {
      console.log('Fresh suppliers fetched:', data);
      setSuppliers(data || []);
    }
  }

  async function generatePONumber() {
    const year = new Date().getFullYear();
    const { data: existing } = await supabase
      .from('chick_purchase_orders')
      .select('po_number')
      .like('po_number', `CPO-${year}-%`)
      .order('po_number', { ascending: false })
      .limit(1);

    let nextNum = 1;
    if (existing && existing.length > 0) {
      const lastNum = parseInt(existing[0].po_number.split('-')[2]);
      nextNum = lastNum + 1;
    }

    return `CPO-${year}-${String(nextNum).padStart(3, '0')}`;
  }

  function addLine() {
    setLines([
      ...lines,
      {
        branch_code: '',
        delivery_type: 'LOCAL',
        booked_qty: 0,
        wish_qty: 0,
        chick_type: chickType,
        notes: '',
      },
    ]);
  }

  function removeLine(index: number) {
    setLines(lines.filter((_, i) => i !== index));
  }

  function updateLine(index: number, field: keyof Omit<POLine, 'id'>, value: any) {
    setLines(
      lines.map((line, i) => {
        if (i === index) {
          if (field === 'branch_code') {
            const branch = branches.find(b => b.branch_code === value);
            return { ...line, branch_code: value, delivery_type: branch?.delivery_type || 'LOCAL' };
          }
          return { ...line, [field]: value };
        }
        return line;
      })
    );
  }

  async function handleSavePO() {
    if (!supplierId || !expectedDate || lines.length === 0) {
      toast.error('Please fill in all required fields and add at least one branch');
      return;
    }

    console.log('Saving PO with supplierId:', supplierId, 'suppliers loaded:', suppliers.map(s => ({ id: s.id, name: s.name })));

    // Validate supplier exists in loaded data
    const selectedSupplier = suppliers.find(s => s.id === supplierId);
    if (!selectedSupplier) {
      toast.error('Selected supplier not found. Please re-select from dropdown.');
      setSupplierId('');
      return;
    }

    setSaving(true);
    try {
      const poNumber = await generatePONumber();

      const { data: po, error: poError } = await supabase
        .from('chick_purchase_orders')
        .insert({
          po_number: poNumber,
          supplier_id: supplierId,
          expected_delivery_date: expectedDate,
          chick_type: chickType,
          status: 'DRAFT',
          notes: notes || null,
          created_by: profile?.id,
        })
        .select()
        .single();

      if (poError) throw poError;

      const poLines = lines.map(line => ({
        po_id: po.id,
        branch_code: line.branch_code,
        delivery_type: line.delivery_type,
        booked_qty: line.booked_qty,
        wish_qty: line.wish_qty,
        chick_type: line.chick_type,
        notes: line.notes || null,
      }));

      const { error: linesError } = await supabase.from('chick_po_lines').insert(poLines);

      if (linesError) throw linesError;

      toast.success('Purchase order created successfully');
      resetForm();
      setModalOpen(false);
      fetchData();
    } catch (error: any) {
      console.error('Error creating PO:', error);
      toast.error(`Failed to create PO: ${error.message}`);
    } finally {
      setSaving(false);
    }
  }

  async function handleSubmitForApproval(poId: string) {
    setSaving(true);
    try {
      const { error } = await supabase
        .from('chick_purchase_orders')
        .update({ status: 'SUBMITTED' })
        .eq('id', poId);

      if (error) throw error;

      toast.success('PO submitted for approval');
      fetchData();
    } catch (error: any) {
      console.error('Error submitting PO:', error);
      toast.error(`Failed to submit: ${error.message}`);
    } finally {
      setSaving(false);
    }
  }

  async function handleApprovePO(poId: string) {
    setSaving(true);
    try {
      const { error } = await supabase
        .from('chick_purchase_orders')
        .update({
          status: 'APPROVED',
          approved_by: profile?.id,
          approved_at: new Date().toISOString(),
        })
        .eq('id', poId);

      if (error) throw error;

      toast.success('PO approved');
      setViewModalOpen(false);
      fetchData();
    } catch (error: any) {
      console.error('Error approving PO:', error);
      toast.error(`Failed to approve: ${error.message}`);
    } finally {
      setSaving(false);
    }
  }

  async function handleSaveAdjustment() {
    if (!adjustingPO) return;
    setSaving(true);
    try {
      // Update each line's booked_qty
      for (const line of adjustLines) {
        const { error } = await supabase
          .from('chick_po_lines')
          .update({ booked_qty: line.booked_qty })
          .eq('id', line.id);
        if (error) throw error;
      }

      toast.success('PO quantities adjusted successfully');
      setAdjustModalOpen(false);
      setAdjustingPO(null);
      fetchData();
    } catch (error: any) {
      console.error('Error adjusting PO:', error);
      toast.error(`Failed to adjust: ${error.message}`);
    } finally {
      setSaving(false);
    }
  }

  function resetForm() {
    setSupplierId('');
    setExpectedDate('');
    setChickType('STANDARD');
    setNotes('');
    setLines([]);
  }

  function getStatusBadge(status: string) {
    const variants: Record<string, { variant: any; className?: string }> = {
      DRAFT: { variant: 'outline' },
      SUBMITTED: { variant: 'secondary', className: 'bg-blue-100 text-blue-700' },
      APPROVED: { variant: 'default', className: 'bg-green-600' },
      DISPATCHED: { variant: 'default', className: 'bg-teal-600' },
      DELIVERED: { variant: 'default', className: 'bg-purple-600' },
      INVOICED: { variant: 'default', className: 'bg-slate-800' },
    };
    const config = variants[status] || { variant: 'outline' };
    return (
      <Badge variant={config.variant} className={config.className}>
        {status}
      </Badge>
    );
  }

  const filteredPOs = pos.filter(po => {
    const matchesSearch =
      po.po_number.toLowerCase().includes(search.toLowerCase()) ||
      (po.supplier?.name || '').toLowerCase().includes(search.toLowerCase());
    const matchesStatus = filterStatus === 'ALL' || po.status === filterStatus;
    return matchesSearch && matchesStatus;
  });

  const stats = {
    total: pos.length,
    draft: pos.filter(p => p.status === 'DRAFT').length,
    submitted: pos.filter(p => p.status === 'SUBMITTED').length,
    approved: pos.filter(p => p.status === 'APPROVED').length,
  };

  const totalBooked = lines.reduce((sum, line) => sum + (line.booked_qty || 0), 0);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-gray-500">Loading...</div>
      </div>
    );
  }

  return (
    <div className="space-y-6 p-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight flex items-center gap-2">
            <FileText className="w-8 h-8 text-blue-600" />
            Chick Purchase Orders
          </h1>
          <p className="text-muted-foreground mt-1">Manage chick bookings and supplier orders</p>
        </div>
        <Button onClick={async () => { resetForm(); await fetchSuppliersOnly(); setModalOpen(true); }} size="lg">
          <Plus className="mr-2 h-4 w-4" />
          New PO
        </Button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-4 gap-4">
        <StatCard icon={FileText} title="Total POs" value={stats.total} subtitle="All time" color="blue" />
        <StatCard icon={FileText} title="Draft" value={stats.draft} subtitle="Not submitted" color="slate" />
        <StatCard icon={Send} title="Submitted" value={stats.submitted} subtitle="Awaiting approval" color="amber" />
        <StatCard icon={CheckCircle} title="Approved" value={stats.approved} subtitle="Ready to dispatch" color="emerald" />
      </div>

      {/* Filters */}
      <div className="flex items-center gap-4">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search by PO number or supplier..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-10"
          />
        </div>
        <Select value={filterStatus} onValueChange={setFilterStatus}>
          <SelectTrigger className="w-[180px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">All Status</SelectItem>
            <SelectItem value="DRAFT">Draft</SelectItem>
            <SelectItem value="SUBMITTED">Submitted</SelectItem>
            <SelectItem value="APPROVED">Approved</SelectItem>
            <SelectItem value="DISPATCHED">Dispatched</SelectItem>
            <SelectItem value="DELIVERED">Delivered</SelectItem>
            <SelectItem value="INVOICED">Invoiced</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* POs Table */}
      <Card>
        <CardHeader>
          <CardTitle>Purchase Orders</CardTitle>
          <CardDescription>View and manage chick purchase orders</CardDescription>
        </CardHeader>
        <CardContent>
          {filteredPOs.length === 0 ? (
            <p className="text-center text-slate-400 py-8">No purchase orders found</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>PO Number</TableHead>
                  <TableHead>Supplier</TableHead>
                  <TableHead>Expected Date</TableHead>
                  <TableHead>Chick Type</TableHead>
                  <TableHead>Total Booked</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredPOs.map((po) => (
                  <TableRow key={po.id}>
                    <TableCell className="font-mono text-sm font-semibold text-blue-600">
                      {po.po_number}
                    </TableCell>
                    <TableCell className="font-medium">{po.supplier?.name || 'Unknown'}</TableCell>
                    <TableCell>{format(new Date(po.expected_delivery_date), 'PP')}</TableCell>
                    <TableCell>
                      <Badge variant="outline">{po.chick_type}</Badge>
                    </TableCell>
                    <TableCell className="font-semibold">
                      {po.lines.reduce((sum, line) => sum + line.booked_qty, 0).toLocaleString()}
                    </TableCell>
                    <TableCell>{getStatusBadge(po.status)}</TableCell>
                    <TableCell className="text-sm text-slate-500">
                      {format(new Date(po.created_at), 'PP')}
                    </TableCell>
                    <TableCell className="text-right space-x-2">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          setViewing(po);
                          setViewModalOpen(true);
                        }}
                      >
                        <Eye className="h-4 w-4 mr-1" />
                        View
                      </Button>
                      {po.status === 'DRAFT' && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleSubmitForApproval(po.id)}
                          disabled={saving}
                        >
                          <Send className="h-4 w-4 mr-1" />
                          Submit
                        </Button>
                      )}
                      {(po.status === 'APPROVED' || po.status === 'DISPATCHED' || po.status === 'DELIVERED') && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => {
                            setAdjustingPO(po);
                            setAdjustLines(po.lines.map(l => ({ ...l })));
                            setAdjustModalOpen(true);
                          }}
                          disabled={saving}
                        >
                          <Pencil className="h-4 w-4 mr-1" />
                          Adjust
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Create PO Modal */}
      <Dialog open={modalOpen} onOpenChange={setModalOpen}>
        <DialogContent className="sm:max-w-6xl h-[85vh] flex flex-col p-0">
          <DialogHeader className="px-6 pt-6 pb-4 border-b">
            <DialogTitle>Create New Purchase Order</DialogTitle>
            <DialogDescription>Book chicks from a supplier for expected delivery</DialogDescription>
          </DialogHeader>

          <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
            <div className="grid grid-cols-3 gap-4">
              <div className="space-y-2">
                <Label htmlFor="supplier">Supplier *</Label>
                <Select value={supplierId} onValueChange={setSupplierId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select supplier" />
                  </SelectTrigger>
                  <SelectContent>
                    {suppliers.map((sup) => (
                      <SelectItem key={sup.id} value={sup.id}>
                        {sup.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="expected_date">Expected Delivery Date *</Label>
                <Input
                  id="expected_date"
                  type="date"
                  value={expectedDate}
                  onChange={(e) => setExpectedDate(e.target.value)}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="chick_type">Chick Type *</Label>
                <Select value={chickType} onValueChange={(val: any) => setChickType(val)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="STANDARD">Standard</SelectItem>
                    <SelectItem value="HUBBARD">Hubbard</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="notes">Notes</Label>
              <Textarea
                id="notes"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Additional notes..."
                rows={2}
              />
            </div>

            {/* Branch Demand Lines */}
            <div className="space-y-3">
              {branches.length === 0 && (
                <div className="bg-red-50 border border-red-200 rounded p-3 text-sm text-red-700">
                  <p className="font-semibold">No branches available</p>
                  <p>Run the seed migration in Supabase SQL Editor:</p>
                  <code className="block mt-1 bg-red-100 rounded px-2 py-1 text-xs font-mono">20260518_chick_seed_data.sql</code>
                </div>
              )}
              <div className="flex items-center justify-between">
                <Label className="text-base font-semibold">Branch Demand</Label>
                <Button type="button" variant="outline" size="sm" onClick={addLine} disabled={branches.length === 0}>
                  <Plus className="h-4 w-4 mr-1" />
                  Add Branch
                </Button>
              </div>

              {lines.length === 0 ? (
                <p className="text-sm text-slate-400 text-center py-4">
                  No branches added yet. Click "Add Branch" to start.
                </p>
              ) : (
                <div className="border rounded-lg overflow-hidden">
                  <div className="max-h-[300px] overflow-y-auto">
                    <Table>
                      <TableHeader className="sticky top-0 bg-slate-50 z-10">
                        <TableRow className="bg-slate-50">
                          <TableHead className="w-[180px]">Branch *</TableHead>
                          <TableHead className="w-[110px] text-right">Booked Qty *</TableHead>
                          <TableHead className="w-[100px] text-right">Wish Qty</TableHead>
                          <TableHead className="w-[110px]">Chick Type</TableHead>
                          <TableHead className="w-[100px]">Delivery</TableHead>
                          <TableHead className="w-[200px]">Notes</TableHead>
                          <TableHead className="w-[50px]"></TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                      {lines.map((line, index) => (
                        <TableRow key={index}>
                          <TableCell>
                            <Select
                              value={line.branch_code}
                              onValueChange={(val) => updateLine(index, 'branch_code', val)}
                            >
                              <SelectTrigger className="h-8">
                                <SelectValue placeholder="Select" />
                              </SelectTrigger>
                              <SelectContent>
                                {branches.map((br) => (
                                  <SelectItem key={br.branch_code} value={br.branch_code}>
                                    {br.branch_name}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </TableCell>
                          <TableCell>
                            <Input
                              type="number"
                              value={line.booked_qty || ''}
                              onChange={(e) => updateLine(index, 'booked_qty', parseInt(e.target.value) || 0)}
                              className="h-8 text-right"
                            />
                          </TableCell>
                          <TableCell>
                            <Input
                              type="number"
                              value={line.wish_qty || ''}
                              onChange={(e) => updateLine(index, 'wish_qty', parseInt(e.target.value) || 0)}
                              className="h-8 text-right"
                            />
                          </TableCell>
                          <TableCell>
                            <Select
                              value={line.chick_type}
                              onValueChange={(val) => updateLine(index, 'chick_type', val)}
                            >
                              <SelectTrigger className="h-8">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="STANDARD">Standard</SelectItem>
                                <SelectItem value="HUBBARD">Hubbard</SelectItem>
                              </SelectContent>
                            </Select>
                          </TableCell>
                          <TableCell>
                            <Badge variant={line.delivery_type === 'LOCAL' ? 'default' : 'secondary'}>
                              {line.delivery_type}
                            </Badge>
                          </TableCell>
                          <TableCell>
                            <Input
                              value={line.notes}
                              onChange={(e) => updateLine(index, 'notes', e.target.value)}
                              placeholder="Optional"
                              className="h-8"
                            />
                          </TableCell>
                          <TableCell>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => removeLine(index)}
                              className="h-8 w-8 p-0 text-red-600"
                            >
                              <Trash2 className="w-3 h-3" />
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                  </div>
                </div>
              )}

              {lines.length > 0 && (
                <div className="bg-slate-900 text-white rounded p-3 flex justify-between items-center">
                  <span className="font-semibold">Total Booked:</span>
                  <span className="text-2xl font-bold">{totalBooked.toLocaleString()} chicks</span>
                </div>
              )}
            </div>
          </div>

          <div className="px-6 py-4 border-t bg-slate-50 flex justify-end gap-2">
            <Button variant="outline" onClick={() => { resetForm(); setModalOpen(false); }} disabled={saving}>
              Cancel
            </Button>
            <Button onClick={handleSavePO} disabled={saving}>
              {saving ? 'Creating...' : 'Create PO'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* View PO Modal */}
      <Dialog open={viewModalOpen} onOpenChange={setViewModalOpen}>
        <DialogContent className="sm:max-w-5xl h-[85vh] flex flex-col p-0">
          <DialogHeader className="px-6 pt-6 pb-4 border-b">
            <div className="flex items-center justify-between">
              <div>
                <DialogTitle className="text-2xl">{viewing?.po_number}</DialogTitle>
                <DialogDescription>Purchase order details</DialogDescription>
              </div>
              {viewing && getStatusBadge(viewing.status)}
            </div>
          </DialogHeader>

          {viewing && (
            <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
              <div className="grid grid-cols-3 gap-4 text-sm">
                <div>
                  <p className="text-slate-500">Supplier</p>
                  <p className="font-semibold text-lg">{viewing?.supplier?.name || 'Unknown'}</p>
                </div>
                <div>
                  <p className="text-slate-500">Expected Delivery</p>
                  <p className="font-medium">{format(new Date(viewing.expected_delivery_date), 'PPP')}</p>
                </div>
                <div>
                  <p className="text-slate-500">Chick Type</p>
                  <Badge variant="outline">{viewing.chick_type}</Badge>
                </div>
              </div>

              {viewing.notes && (
                <div className="bg-amber-50 rounded p-3">
                  <p className="text-xs font-semibold text-amber-700 mb-1">Notes</p>
                  <p className="text-sm text-slate-700">{viewing.notes}</p>
                </div>
              )}

              <div>
                <h3 className="font-semibold mb-3">Branch Demand</h3>
                <Table>
                  <TableHeader>
                    <TableRow className="bg-slate-50">
                      <TableHead>Branch</TableHead>
                      <TableHead className="text-right">Booked Qty</TableHead>
                      <TableHead className="text-right">Wish Qty</TableHead>
                      <TableHead>Chick Type</TableHead>
                      <TableHead>Delivery</TableHead>
                      <TableHead>Notes</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {viewing.lines.map((line) => (
                      <TableRow key={line.id}>
                        <TableCell className="font-medium">{line.branch_code}</TableCell>
                        <TableCell className="text-right font-semibold">{line.booked_qty.toLocaleString()}</TableCell>
                        <TableCell className="text-right text-slate-500">{line.wish_qty.toLocaleString()}</TableCell>
                        <TableCell>
                          <Badge variant="outline" className="text-xs">{line.chick_type}</Badge>
                        </TableCell>
                        <TableCell>
                          <Badge variant={line.delivery_type === 'LOCAL' ? 'default' : 'secondary'} className="text-xs">
                            {line.delivery_type}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-sm text-slate-600">{line.notes || '-'}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>

              <div className="bg-slate-900 text-white rounded p-4 flex justify-between items-center">
                <span className="font-semibold">Total Booked:</span>
                <span className="text-2xl font-bold">
                  {viewing.lines.reduce((sum, line) => sum + line.booked_qty, 0).toLocaleString()} chicks
                </span>
              </div>
            </div>
          )}

          {viewing && viewing.status === 'SUBMITTED' && profile?.role === 'admin' && (
            <div className="px-6 py-4 border-t bg-slate-50 flex justify-end gap-2">
              <Button variant="outline" onClick={() => setViewModalOpen(false)}>
                Close
              </Button>
              <Button onClick={() => handleApprovePO(viewing.id)} disabled={saving}>
                <CheckCircle className="w-4 h-4 mr-2" />
                {saving ? 'Approving...' : 'Approve PO'}
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Adjust PO Modal */}
      <Dialog open={adjustModalOpen} onOpenChange={setAdjustModalOpen}>
        <DialogContent className="sm:max-w-5xl h-[85vh] flex flex-col p-0">
          <DialogHeader className="px-6 pt-6 pb-4 border-b">
            <div className="flex items-center justify-between">
              <div>
                <DialogTitle className="text-2xl">Adjust PO</DialogTitle>
                <DialogDescription>
                  Modify quantities for {adjustingPO?.po_number}
                </DialogDescription>
              </div>
              {adjustingPO && getStatusBadge(adjustingPO.status)}
            </div>
          </DialogHeader>

          {adjustingPO && (
            <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
              <div className="bg-amber-50 border border-amber-200 rounded p-3 text-sm text-amber-800">
                <p><strong>Tip:</strong> Adjust the Booked Qty to reflect actual/revised quantities.
                Original total: <strong>{adjustingPO.lines.reduce((s, l) => s + l.booked_qty, 0).toLocaleString()}</strong> chicks</p>
              </div>

              <Table>
                <TableHeader>
                  <TableRow className="bg-slate-50">
                    <TableHead>Branch</TableHead>
                    <TableHead className="text-right">Booked Qty</TableHead>
                    <TableHead className="text-right">Wish Qty</TableHead>
                    <TableHead>Chick Type</TableHead>
                    <TableHead>Delivery</TableHead>
                    <TableHead>Notes</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {adjustLines.map((line, idx) => (
                    <TableRow key={line.id}>
                      <TableCell className="font-medium">{line.branch_code}</TableCell>
                      <TableCell className="text-right">
                        <input
                          type="number"
                          min={0}
                          value={line.booked_qty}
                          onChange={(e) => {
                            const val = parseInt(e.target.value) || 0;
                            setAdjustLines(prev => prev.map((l, i) => i === idx ? { ...l, booked_qty: val } : l));
                          }}
                          className="w-24 px-2 py-1 text-right border rounded text-sm focus:ring-2 focus:ring-teal-500 focus:border-teal-500"
                        />
                      </TableCell>
                      <TableCell className="text-right text-slate-500">{line.wish_qty.toLocaleString()}</TableCell>
                      <TableCell>
                        <Badge variant="outline" className="text-xs">{line.chick_type}</Badge>
                      </TableCell>
                      <TableCell>
                        <Badge variant={line.delivery_type === 'LOCAL' ? 'default' : 'secondary'} className="text-xs">
                          {line.delivery_type}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-sm text-slate-600">{line.notes || '-'}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>

              <div className="bg-slate-900 text-white rounded p-4 flex justify-between items-center">
                <span className="font-semibold">Adjusted Total:</span>
                <span className="text-2xl font-bold">
                  {adjustLines.reduce((sum, line) => sum + line.booked_qty, 0).toLocaleString()} chicks
                </span>
              </div>
            </div>
          )}

          <div className="px-6 py-4 border-t bg-slate-50 flex justify-end gap-2">
            <Button variant="outline" onClick={() => setAdjustModalOpen(false)} disabled={saving}>
              Cancel
            </Button>
            <Button onClick={handleSaveAdjustment} disabled={saving}>
              {saving ? 'Saving...' : 'Save Adjustment'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
