import { useState, useEffect } from 'react';
import { Plus, Search, Eye, Package, Calendar, Clock, FileText, CheckCircle, AlertCircle } from 'lucide-react';
import { format } from 'date-fns';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import { GoodsReceivedNote, Supplier, RawMaterial } from '../types/database';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';
import { Badge } from '../components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../components/ui/table';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '../components/ui/dialog';
import { Label } from '../components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { Textarea } from '../components/ui/textarea';
import StatCard from '../components/ui/StatCard';
import StockTakeFrozenBanner from '../components/stock/StockTakeFrozenBanner';
import toast from 'react-hot-toast';

interface GRNItem {
  raw_material_id: string;
  ordered_qty: number;
  received_qty: number;
  unit_cost: number;
  batch_number: string;
  expiry_date: string;
}

interface SageSyncStatus {
  status: string;
  message?: string;
  sage_response?: any;
  error_details?: any;
  updated_at?: string;
}

const emptyItem: GRNItem = {
  raw_material_id: '',
  ordered_qty: 0,
  received_qty: 0,
  unit_cost: 0,
  batch_number: '',
  expiry_date: '',
};

const localDateInputValue = () => format(new Date(), 'yyyy-MM-dd');

export default function GoodsReceivedPageV2() {
  const { profile } = useAuth();
  const [grns, setGrns] = useState<GoodsReceivedNote[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [materials, setMaterials] = useState<RawMaterial[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [viewModalOpen, setViewModalOpen] = useState(false);
  const [viewing, setViewing] = useState<GoodsReceivedNote | null>(null);
  const [viewItems, setViewItems] = useState<any[]>([]);
  const [syncByGrnId, setSyncByGrnId] = useState<Record<string, SageSyncStatus>>({});
  const [saving, setSaving] = useState(false);
  const [wbTickets, setWbTickets] = useState<any[]>([]);
  
  // Form state
  const [supplierId, setSupplierId] = useState('');
  const [receivedDate, setReceivedDate] = useState(localDateInputValue);
  const [notes, setNotes] = useState('');
  const [weighBridgeTicketId, setWeighBridgeTicketId] = useState('');
  const [items, setItems] = useState<GRNItem[]>([emptyItem]);

  async function fetchData() {
    setLoading(true);
    const [grnsRes, suppliersRes, materialsRes, wbRes] = await Promise.all([
      supabase.from('goods_received_notes').select('*, suppliers(name, code, sage_code), warehouses(name)').order('created_at', { ascending: false }),
      supabase.from('suppliers').select('*').eq('is_active', true).order('name'),
      supabase.from('raw_materials').select('*').eq('is_active', true).order('name'),
      supabase.from('weigh_bridge_tickets').select('*').eq('status', 'open').order('created_at', { ascending: false }),
    ]);
    setGrns(grnsRes.data || []);
    setSuppliers(suppliersRes.data || []);
    setMaterials(materialsRes.data || []);
    setWbTickets(wbRes.data || []);

    const grnIds = (grnsRes.data || []).map((grn: GoodsReceivedNote) => grn.id);
    if (grnIds.length > 0) {
      const { data: syncRows } = await supabase
        .from('sync_log')
        .select('reference_id, status, message, sage_response, error_details, updated_at')
        .eq('event_type', 'grn_confirmed')
        .in('reference_id', grnIds)
        .order('updated_at', { ascending: false });

      const latestByGrn: Record<string, SageSyncStatus> = {};
      (syncRows || []).forEach((row: any) => {
        if (!latestByGrn[row.reference_id]) {
          latestByGrn[row.reference_id] = row;
        }
      });
      setSyncByGrnId(latestByGrn);
    } else {
      setSyncByGrnId({});
    }

    setLoading(false);
  }

  useEffect(() => {
    fetchData();
  }, []);

  const generateGRNNumber = async () => {
    const year = new Date().getFullYear();
    const { data: existing } = await supabase
      .from('goods_received_notes')
      .select('grn_number')
      .like('grn_number', `GRN-${year}-%`)
      .order('grn_number', { ascending: false })
      .limit(1);

    let nextNum = 1;
    if (existing && existing.length > 0) {
      const lastNum = parseInt(existing[0].grn_number.split('-')[2]);
      nextNum = lastNum + 1;
    }

    return `GRN-${year}-${String(nextNum).padStart(3, '0')}`;
  };

  const handleSaveGRN = async () => {
    if (!supplierId || items.length === 0 || !items[0].raw_material_id) {
      toast.error('Please fill in all required fields');
      return;
    }

    setSaving(true);
    try {
      const grnNumber = await generateGRNNumber();
      
      // Get warehouse ID
      const { data: warehouse } = await supabase
        .from('warehouses')
        .select('id')
        .eq('code', 'RM')
        .single();

      // Create GRN header
      const grnData: any = {
        grn_number: grnNumber,
        supplier_id: supplierId,
        warehouse_id: warehouse?.id,
        received_date: receivedDate,
        status: 'pending',
        notes: notes || null,
        received_by: profile?.id,
      };
      
      if (weighBridgeTicketId) {
        grnData.weigh_bridge_ticket_id = weighBridgeTicketId;
      }

      const { data: grn, error: grnError } = await supabase
        .from('goods_received_notes')
        .insert(grnData)
        .select()
        .single();

      if (grnError) throw grnError;

      // Create GRN items
      const grnItems = items.map(item => ({
        grn_id: grn.id,
        raw_material_id: item.raw_material_id,
        ordered_qty: item.ordered_qty,
        received_qty: item.received_qty,
        unit_cost: item.unit_cost,
        batch_number: item.batch_number || null,
        expiry_date: item.expiry_date || null,
      }));

      const { error: itemsError } = await supabase
        .from('grn_items')
        .insert(grnItems);

      if (itemsError) throw itemsError;

      toast.success('GRN created successfully');
      setModalOpen(false);
      resetForm();
      fetchData();
    } catch (error: any) {
      console.error('Error creating GRN:', error);
      toast.error(`Failed to create GRN: ${error.message}`);
    } finally {
      setSaving(false);
    }
  };

  const resetForm = () => {
    setSupplierId('');
    setReceivedDate(localDateInputValue());
    setNotes('');
    setItems([emptyItem]);
  };

  const handleViewGRN = async (grn: GoodsReceivedNote) => {
    setViewing(grn);
    const { data } = await supabase
      .from('grn_items')
      .select('*, raw_materials(code, name)')
      .eq('grn_id', grn.id);
    setViewItems(data || []);
    setViewModalOpen(true);
  };

  const addItem = () => {
    setItems([...items, { ...emptyItem }]);
  };

  const removeItem = (index: number) => {
    setItems(items.filter((_, i) => i !== index));
  };

  const updateItem = (index: number, field: keyof GRNItem, value: any) => {
    const newItems = [...items];
    newItems[index] = { ...newItems[index], [field]: value };
    setItems(newItems);
  };

  const getStatusBadge = (status: string) => {
    const variants: Record<string, 'default' | 'secondary' | 'destructive' | 'outline'> = {
      pending: 'secondary',
      approved: 'default',
      rejected: 'destructive',
    };
    return <Badge variant={variants[status] || 'outline'}>{status}</Badge>;
  };

  const getSageGrvNumber = (sync?: SageSyncStatus) => {
    if (!sync?.sage_response) return '';
    return sync.sage_response.grvNumber ||
      sync.sage_response.documentNumber ||
      sync.sage_response.goodsReceipt?.grvNumber ||
      sync.sage_response.goodsReceipt?.documentNumber ||
      '';
  };

  const getSageBadge = (grnId: string) => {
    const sync = syncByGrnId[grnId];
    if (!sync) {
      return <Badge variant="outline">Not queued</Badge>;
    }

    if (sync.status === 'success') {
      const grvNumber = getSageGrvNumber(sync);
      return (
        <Badge className="bg-emerald-50 text-emerald-700 border-emerald-200">
          <CheckCircle className="h-3 w-3 mr-1" />
          {grvNumber ? `GRV ${grvNumber}` : 'Posted'}
        </Badge>
      );
    }

    if (sync.status === 'failed') {
      return (
        <Badge variant="destructive">
          <AlertCircle className="h-3 w-3 mr-1" />
          Failed
        </Badge>
      );
    }

    return <Badge variant="secondary">{sync.status}</Badge>;
  };

  const supplierLabel = (supplier?: Supplier | null) => {
    if (!supplier) return '';
    const code = supplier.sage_code || supplier.code;
    return code ? `${code} - ${supplier.name}` : supplier.name;
  };

  const filteredGRNs = grns.filter(grn =>
    grn.grn_number.toLowerCase().includes(search.toLowerCase()) ||
    grn.suppliers?.name.toLowerCase().includes(search.toLowerCase()) ||
    grn.suppliers?.code?.toLowerCase().includes(search.toLowerCase()) ||
    grn.suppliers?.sage_code?.toLowerCase().includes(search.toLowerCase())
  );

  const stats = {
    total: grns.length,
    pending: grns.filter(g => g.status === 'pending').length,
    approved: grns.filter(g => g.status === 'approved').length,
    thisMonth: grns.filter(g => {
      const grnDate = new Date(g.created_at);
      const now = new Date();
      return grnDate.getMonth() === now.getMonth() && grnDate.getFullYear() === now.getFullYear();
    }).length,
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-gray-500">Loading...</div>
      </div>
    );
  }

  return (
    <div className="space-y-6 p-6">
      <StockTakeFrozenBanner />
      
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Goods Received Notes</h1>
          <p className="text-muted-foreground mt-1">Manage incoming raw material deliveries</p>
        </div>
        <Button onClick={() => setModalOpen(true)} size="lg">
          <Plus className="mr-2 h-4 w-4" />
          New GRN
        </Button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <StatCard icon={Package} title="Total GRNs" value={stats.total} subtitle="All time" color="blue" />
        <StatCard icon={Clock} title="Pending" value={stats.pending} subtitle="Awaiting approval" color="amber" />
        <StatCard icon={FileText} title="Approved" value={stats.approved} subtitle="Ready to receive" color="emerald" />
        <StatCard icon={Calendar} title="This Month" value={stats.thisMonth} subtitle="Current period" color="teal" />
      </div>

      {/* Search */}
      <div className="flex items-center space-x-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search by GRN number, supplier, or Sage code..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-10"
          />
        </div>
      </div>

      {/* GRNs Table */}
      <Card>
        <CardHeader>
          <CardTitle>Recent GRNs</CardTitle>
          <CardDescription>View and manage all goods received notes</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>GRN Number</TableHead>
                <TableHead>Supplier</TableHead>
                <TableHead>Received Date</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Sage</TableHead>
                <TableHead>Created By</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredGRNs.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-center text-muted-foreground py-8">
                    No GRNs found
                  </TableCell>
                </TableRow>
              ) : (
                filteredGRNs.map((grn) => (
                  <TableRow key={grn.id}>
                    <TableCell className="font-medium">{grn.grn_number}</TableCell>
                    <TableCell>{supplierLabel(grn.suppliers)}</TableCell>
                    <TableCell>{format(new Date(grn.received_date), 'PPP')}</TableCell>
                    <TableCell>{getStatusBadge(grn.status)}</TableCell>
                    <TableCell>{getSageBadge(grn.id)}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {format(new Date(grn.created_at), 'PPp')}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleViewGRN(grn)}
                      >
                        <Eye className="h-4 w-4 mr-1" />
                        View
                      </Button>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Create GRN Modal */}
      <Dialog open={modalOpen} onOpenChange={setModalOpen}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Create New GRN</DialogTitle>
            <DialogDescription>Add a new goods received note for incoming materials</DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            {/* Header Section */}
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="supplier">Supplier *</Label>
                <Select value={supplierId} onValueChange={setSupplierId}>
                  <SelectTrigger className="bg-white">
                    <SelectValue placeholder="Select supplier" />
                  </SelectTrigger>
                  <SelectContent className="z-[100]">
                    {suppliers.map((supplier) => (
                      <SelectItem key={supplier.id} value={supplier.id}>
                        {supplierLabel(supplier)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="received_date">Received Date *</Label>
                <Input
                  id="received_date"
                  type="date"
                  value={receivedDate}
                  onChange={(e) => setReceivedDate(e.target.value)}
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="weigh_bridge">Weigh Bridge Ticket</Label>
              <Select value={weighBridgeTicketId} onValueChange={setWeighBridgeTicketId}>
                <SelectTrigger className="bg-white">
                  <SelectValue placeholder="Select weigh bridge ticket (optional)" />
                </SelectTrigger>
                <SelectContent className="z-[100]">
                  {wbTickets.map((ticket) => (
                    <SelectItem key={ticket.id} value={ticket.id}>
                      {ticket.ticket_no} - {ticket.vehicle_reg || 'N/A'}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="notes">Notes</Label>
              <Textarea
                id="notes"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Additional notes or comments..."
                rows={3}
              />
            </div>

            {/* Items Section */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <Label className="text-base">Line Items</Label>
                <Button type="button" variant="outline" size="sm" onClick={addItem}>
                  <Plus className="h-4 w-4 mr-1" />
                  Add Item
                </Button>
              </div>

              {items.map((item, index) => (
                <Card key={index}>
                  <CardContent className="pt-4">
                    <div className="grid grid-cols-3 gap-3">
                      <div className="col-span-3 space-y-2">
                        <Label>Raw Material *</Label>
                        <Select
                          value={item.raw_material_id}
                          onValueChange={(value) => updateItem(index, 'raw_material_id', value)}
                        >
                          <SelectTrigger className="bg-white">
                            <SelectValue placeholder="Select material" />
                          </SelectTrigger>
                          <SelectContent className="z-[100]">
                            {materials.map((material) => (
                              <SelectItem key={material.id} value={material.id}>
                                {material.code} - {material.name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>

                      <div className="space-y-2">
                        <Label>Ordered Qty</Label>
                        <Input
                          type="number"
                          value={item.ordered_qty}
                          onChange={(e) => updateItem(index, 'ordered_qty', Number(e.target.value))}
                          step="0.01"
                        />
                      </div>

                      <div className="space-y-2">
                        <Label>Received Qty *</Label>
                        <Input
                          type="number"
                          value={item.received_qty}
                          onChange={(e) => updateItem(index, 'received_qty', Number(e.target.value))}
                          step="0.01"
                        />
                      </div>

                      <div className="space-y-2">
                        <Label>Unit Cost</Label>
                        <Input
                          type="number"
                          value={item.unit_cost}
                          onChange={(e) => updateItem(index, 'unit_cost', Number(e.target.value))}
                          step="0.01"
                        />
                      </div>

                      <div className="space-y-2">
                        <Label>Batch Number</Label>
                        <Input
                          value={item.batch_number}
                          onChange={(e) => updateItem(index, 'batch_number', e.target.value)}
                        />
                      </div>

                      <div className="space-y-2">
                        <Label>Expiry Date</Label>
                        <Input
                          type="date"
                          value={item.expiry_date}
                          onChange={(e) => updateItem(index, 'expiry_date', e.target.value)}
                        />
                      </div>

                      <div className="flex items-end">
                        {items.length > 1 && (
                          <Button
                            type="button"
                            variant="destructive"
                            size="sm"
                            onClick={() => removeItem(index)}
                          >
                            Remove
                          </Button>
                        )}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>

            {/* Actions */}
            <div className="flex justify-end space-x-2 pt-4">
              <Button variant="outline" onClick={() => setModalOpen(false)} disabled={saving}>
                Cancel
              </Button>
              <Button onClick={handleSaveGRN} disabled={saving}>
                {saving ? 'Creating...' : 'Create GRN'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* View GRN Modal */}
      <Dialog open={viewModalOpen} onOpenChange={setViewModalOpen}>
        <DialogContent className="max-w-5xl max-h-[95vh] flex flex-col p-6">
          <DialogHeader className="pb-4 border-b">
            <div className="flex justify-between items-start">
              <div>
                <DialogTitle className="text-2xl">{viewing?.grn_number}</DialogTitle>
                <DialogDescription className="mt-2">
                  {supplierLabel(viewing?.suppliers)} | {viewing && format(new Date(viewing.received_date), 'PPP')}
                </DialogDescription>
              </div>
              <Badge variant={viewing?.status === 'approved' ? 'default' : 'secondary'}>
                {viewing?.status?.toUpperCase()}
              </Badge>
            </div>
          </DialogHeader>

          <div className="space-y-4 overflow-y-auto flex-1 pr-4">
            {viewing && syncByGrnId[viewing.id] && (
              <div className="bg-emerald-50 border border-emerald-200 p-4 rounded-lg">
                <Label className="text-sm font-semibold mb-2 block text-emerald-800">Sage Posting</Label>
                <div className="flex flex-wrap items-center gap-2 text-sm text-emerald-800">
                  {getSageBadge(viewing.id)}
                  <span>{syncByGrnId[viewing.id].message}</span>
                </div>
              </div>
            )}

            {viewing?.notes && (
              <div>
                <Label>Notes</Label>
                <p className="text-sm text-muted-foreground mt-1">{viewing.notes}</p>
              </div>
            )}

            <div className="bg-slate-50 p-4 rounded-lg">
              <Label className="text-sm font-semibold mb-3 block">Line Items</Label>
              <div className="border rounded-md overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-slate-100 border-b">
                    <tr>
                      <th className="text-left px-3 py-2 font-semibold w-[35%]">Material</th>
                      <th className="text-right px-3 py-2 font-semibold w-[15%]">Ordered</th>
                      <th className="text-right px-3 py-2 font-semibold w-[15%]">Received</th>
                      <th className="text-right px-3 py-2 font-semibold w-[15%]">Unit Cost</th>
                      <th className="text-left px-3 py-2 font-semibold w-[20%]">Batch</th>
                    </tr>
                  </thead>
                  <tbody>
                    {viewItems.map((item, index) => (
                      <tr key={index} className="border-b hover:bg-slate-50">
                        <td className="px-3 py-2 w-[35%]">
                          <div className="truncate text-xs" title={`${item.raw_materials?.code} - ${item.raw_materials?.name}`}>
                            {item.raw_materials?.code} - {item.raw_materials?.name}
                          </div>
                        </td>
                        <td className="text-right px-3 py-2 w-[15%]">{item.ordered_qty.toLocaleString()} kg</td>
                        <td className="text-right px-3 py-2 font-medium w-[15%]">{item.received_qty.toLocaleString()} kg</td>
                        <td className="text-right px-3 py-2 w-[15%]">${item.unit_cost.toFixed(2)}</td>
                        <td className="px-3 py-2 w-[20%] text-xs">{item.batch_number || '-'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
