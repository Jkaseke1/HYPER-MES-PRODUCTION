import { useState, useEffect } from 'react';
import { CheckCircle, AlertCircle, TrendingUp, TrendingDown, Truck, Building2, Search } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../context/AuthContext';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card';
import { Badge } from '../../components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../../components/ui/table';
import { Label } from '../../components/ui/label';
import { Textarea } from '../../components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../components/ui/select';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '../../components/ui/dialog';
import toast from 'react-hot-toast';
import { format } from 'date-fns';

interface DeliveryNote {
  id: string;
  dnote_number: string;
  branch_code: string;
  delivery_type: 'LOCAL' | 'BRANCH';
  chick_type: 'STANDARD' | 'HUBBARD';
  quantity_allocated: number;
  quantity_received: number | null;
  variance: number | null;
  status: string;
  driver_name: string | null;
  vehicle_reg: string | null;
  condition_notes: string | null;
  declared_at: string | null;
  consignment: {
    supplier: {
      name: string;
    };
    hatch_night: {
      hatch_date: string;
    };
  };
}

export default function ChickDeliveryDeclaration() {
  const { profile } = useAuth();
  const [deliveryNotes, setDeliveryNotes] = useState<DeliveryNote[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterType, setFilterType] = useState<'ALL' | 'LOCAL' | 'BRANCH'>('ALL');
  const [search, setSearch] = useState('');
  const [declaringId, setDeclaringId] = useState<string | null>(null);
  const [receivedQty, setReceivedQty] = useState<number>(0);
  const [conditionNotes, setConditionNotes] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetchDeliveryNotes();
  }, []);

  async function fetchDeliveryNotes() {
    setLoading(true);
    const { data } = await supabase
      .from('chick_delivery_notes')
      .select(`
        *,
        consignment:chick_supplier_consignments!inner (
          supplier:chick_suppliers!inner (
            name
          ),
          hatch_night:chick_hatch_nights!inner (
            hatch_date
          )
        )
      `)
      .in('status', ['PENDING', 'VARIANCE'])
      .order('created_at', { ascending: false });

    setDeliveryNotes(data || []);
    setLoading(false);
  }

  function openDeclarationModal(dnote: DeliveryNote) {
    setDeclaringId(dnote.id);
    setReceivedQty(dnote.quantity_allocated); // Default to allocated
    setConditionNotes('');
  }

  function closeDeclarationModal() {
    setDeclaringId(null);
    setReceivedQty(0);
    setConditionNotes('');
  }

  async function handleDeclareDelivery() {
    if (!declaringId) return;

    setSaving(true);
    try {
      const variance = receivedQty - (deliveryNotes.find(d => d.id === declaringId)?.quantity_allocated || 0);
      const newStatus = variance === 0 ? 'DELIVERED' : 'VARIANCE';

      const { error } = await supabase
        .from('chick_delivery_notes')
        .update({
          quantity_received: receivedQty,
          status: newStatus,
          condition_notes: conditionNotes || null,
          declared_by: profile?.id,
          declared_at: new Date().toISOString(),
        })
        .eq('id', declaringId);

      if (error) throw error;

      toast.success('Delivery declared successfully');
      closeDeclarationModal();
      fetchDeliveryNotes();
    } catch (error: any) {
      console.error('Error declaring delivery:', error);
      toast.error(`Failed to declare: ${error.message}`);
    } finally {
      setSaving(false);
    }
  }

  async function handleBulkDeclareLocal() {
    const localNotes = filteredNotes.filter(d => d.delivery_type === 'LOCAL' && d.status === 'PENDING');
    if (localNotes.length === 0) {
      toast.error('No LOCAL deliveries to declare');
      return;
    }

    const confirmed = window.confirm(
      `Declare ${localNotes.length} LOCAL deliveries as received with allocated quantities?`
    );
    if (!confirmed) return;

    setSaving(true);
    try {
      const updates = localNotes.map(dnote => ({
        id: dnote.id,
        quantity_received: dnote.quantity_allocated,
        status: 'DELIVERED',
        declared_by: profile?.id,
        declared_at: new Date().toISOString(),
      }));

      for (const update of updates) {
        await supabase
          .from('chick_delivery_notes')
          .update(update)
          .eq('id', update.id);
      }

      toast.success(`${updates.length} LOCAL deliveries declared`);
      fetchDeliveryNotes();
    } catch (error: any) {
      console.error('Error bulk declaring:', error);
      toast.error(`Failed to bulk declare: ${error.message}`);
    } finally {
      setSaving(false);
    }
  }

  function getVarianceBadge(variance: number | null) {
    if (variance === null) return null;
    if (variance === 0) {
      return <Badge variant="default" className="bg-green-600">Perfect</Badge>;
    }
    if (variance < 0) {
      return (
        <Badge variant="destructive" className="flex items-center gap-1">
          <TrendingDown className="w-3 h-3" />
          {variance}
        </Badge>
      );
    }
    return (
      <Badge variant="secondary" className="bg-amber-100 text-amber-700 flex items-center gap-1">
        <TrendingUp className="w-3 h-3" />
        +{variance}
      </Badge>
    );
  }

  const filteredNotes = deliveryNotes.filter(d => {
    const matchesSearch =
      d.branch_code.toLowerCase().includes(search.toLowerCase()) ||
      d.dnote_number.toLowerCase().includes(search.toLowerCase()) ||
      (d.consignment?.supplier?.name || '').toLowerCase().includes(search.toLowerCase());
    const matchesType = filterType === 'ALL' || d.delivery_type === filterType;
    return matchesSearch && matchesType;
  });

  const stats = {
    pending: deliveryNotes.filter(d => d.status === 'PENDING').length,
    local: deliveryNotes.filter(d => d.delivery_type === 'LOCAL' && d.status === 'PENDING').length,
    branch: deliveryNotes.filter(d => d.delivery_type === 'BRANCH' && d.status === 'PENDING').length,
  };

  const declaringNote = deliveryNotes.find(d => d.id === declaringId);

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
            <CheckCircle className="w-8 h-8 text-emerald-600" />
            Delivery Declaration
          </h1>
          <p className="text-muted-foreground mt-1">Confirm chick deliveries and record received quantities</p>
        </div>
        <Button onClick={handleBulkDeclareLocal} disabled={saving || stats.local === 0}>
          <Truck className="w-4 h-4 mr-2" />
          Bulk Declare LOCAL ({stats.local})
        </Button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-4">
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-amber-100 rounded-lg flex items-center justify-center">
                <AlertCircle className="w-5 h-5 text-amber-600" />
              </div>
              <div>
                <p className="text-xs text-slate-500 font-medium">Pending</p>
                <p className="text-2xl font-bold text-slate-800">{stats.pending}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-blue-100 rounded-lg flex items-center justify-center">
                <Truck className="w-5 h-5 text-blue-600" />
              </div>
              <div>
                <p className="text-xs text-slate-500 font-medium">LOCAL Pending</p>
                <p className="text-2xl font-bold text-slate-800">{stats.local}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-purple-100 rounded-lg flex items-center justify-center">
                <Building2 className="w-5 h-5 text-purple-600" />
              </div>
              <div>
                <p className="text-xs text-slate-500 font-medium">BRANCH Pending</p>
                <p className="text-2xl font-bold text-slate-800">{stats.branch}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Filter */}
      <Card>
        <CardHeader>
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <CardTitle>Pending Deliveries</CardTitle>
            <div className="flex items-center gap-2 flex-1 max-w-md">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search branch, dnote, or supplier..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="pl-9 h-9"
                />
              </div>
              <Select value={filterType} onValueChange={(val: any) => setFilterType(val)}>
                <SelectTrigger className="w-[140px] h-9">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL">All Types</SelectItem>
                  <SelectItem value="LOCAL">LOCAL Only</SelectItem>
                  <SelectItem value="BRANCH">BRANCH Only</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {filteredNotes.length === 0 ? (
            <p className="text-center text-slate-400 py-8">No pending deliveries</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Hatch Date</TableHead>
                  <TableHead>Supplier</TableHead>
                  <TableHead>DNOTE</TableHead>
                  <TableHead>Branch</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead className="text-right">Allocated</TableHead>
                  <TableHead className="text-right">Received</TableHead>
                  <TableHead>Variance</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredNotes.map((dnote) => (
                  <TableRow key={dnote.id}>
                    <TableCell className="text-sm">
                      {format(new Date(dnote.consignment.hatch_night.hatch_date), 'PP')}
                    </TableCell>
                    <TableCell className="text-sm font-medium">
                      {dnote.consignment.supplier.name}
                    </TableCell>
                    <TableCell className="font-mono text-xs text-slate-600">
                      {dnote.dnote_number}
                    </TableCell>
                    <TableCell className="text-sm">{dnote.branch_code}</TableCell>
                    <TableCell>
                      <Badge variant={dnote.delivery_type === 'LOCAL' ? 'default' : 'secondary'}>
                        {dnote.delivery_type}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right font-semibold">
                      {dnote.quantity_allocated.toLocaleString()}
                    </TableCell>
                    <TableCell className="text-right">
                      {dnote.quantity_received !== null ? dnote.quantity_received.toLocaleString() : '-'}
                    </TableCell>
                    <TableCell>
                      {getVarianceBadge(dnote.variance)}
                    </TableCell>
                    <TableCell>
                      <Badge variant={dnote.status === 'PENDING' ? 'secondary' : 'outline'}>
                        {dnote.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        size="sm"
                        onClick={() => openDeclarationModal(dnote)}
                        disabled={dnote.status !== 'PENDING'}
                      >
                        Declare
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Declaration Modal */}
      <Dialog open={declaringId !== null} onOpenChange={(open) => !open && closeDeclarationModal()}>
        <DialogContent className="sm:max-w-lg flex flex-col p-0">
          <DialogHeader className="px-6 pt-6 pb-4 border-b">
            <DialogTitle>Declare Delivery</DialogTitle>
            <DialogDescription>
              Record the actual quantity received for DNOTE {declaringNote?.dnote_number}
            </DialogDescription>
          </DialogHeader>

          {declaringNote && (
            <div className="px-6 py-4 space-y-4">
              <div className="bg-slate-50 rounded-lg p-4 space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-slate-500">Supplier:</span>
                  <span className="font-semibold">{declaringNote.consignment.supplier.name}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Branch:</span>
                  <span className="font-semibold">{declaringNote.branch_code}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Allocated Qty:</span>
                  <span className="font-semibold">{declaringNote.quantity_allocated.toLocaleString()}</span>
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="received_qty">Received Quantity *</Label>
                <Input
                  id="received_qty"
                  type="number"
                  value={receivedQty}
                  onChange={(e) => setReceivedQty(parseInt(e.target.value) || 0)}
                  className="text-lg font-semibold"
                />
                {receivedQty !== declaringNote.quantity_allocated && (
                  <p className="text-sm text-amber-600 flex items-center gap-1">
                    <AlertCircle className="w-3 h-3" />
                    Variance: {receivedQty - declaringNote.quantity_allocated > 0 ? '+' : ''}
                    {receivedQty - declaringNote.quantity_allocated}
                  </p>
                )}
              </div>

              <div className="space-y-2">
                <Label htmlFor="condition_notes">Condition Notes</Label>
                <Textarea
                  id="condition_notes"
                  value={conditionNotes}
                  onChange={(e) => setConditionNotes(e.target.value)}
                  placeholder="Any issues or observations..."
                  rows={3}
                />
              </div>
            </div>
          )}

          <div className="px-6 py-4 border-t bg-slate-50 flex justify-end gap-2">
            <Button variant="outline" onClick={closeDeclarationModal} disabled={saving}>
              Cancel
            </Button>
            <Button onClick={handleDeclareDelivery} disabled={saving}>
              {saving ? 'Declaring...' : 'Confirm Delivery'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
