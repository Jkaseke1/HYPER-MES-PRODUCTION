import { useState, useEffect } from 'react';
// Force rebuild - v2.2 - Payment alerts
import { DollarSign, FileText, CheckCircle, Download, Printer, AlertCircle, Bell, Mail, MessageCircle } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../context/AuthContext';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../components/ui/card';
import { Badge } from '../../components/ui/badge';
import { Label } from '../../components/ui/label';
import { Textarea } from '../../components/ui/textarea';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '../../components/ui/dialog';
import toast from 'react-hot-toast';
import { format } from 'date-fns';
import * as XLSX from 'xlsx';

interface Consignment {
  id: string;
  supplier: {
    name: string;
  };
  hatch_night: {
    hatch_date: string;
  };
  po: {
    id: string;
    po_number: string;
  } | null;
  delivery_notes: Array<{
    id: string;
    dnote_number: string;
    branch_code: string;
    chick_type: string;
    quantity_allocated: number;
    quantity_received: number | null;
    variance: number | null;
  }>;
  invoice: {
    id: string;
    invoice_number: string;
    invoice_date: string;
    invoice_amount: number;
    quantity_invoiced: number;
    unit_cost: number;
    status: string;
    sage_posting_ref: string | null;
    notes: string | null;
  } | null;
}

interface WorksheetRow {
  supplier: string;
  dnote: string;
  invoice_no: string;
  invoice_date: string;
  branch: string;
  chick_type: string;
  qty_delivered: number;
  qty_invoiced: number;
  unit_cost: number;
  total: number;
  variance: number;
  sage_ref: string;
  notes: string;
}

export default function ChickInvoiceCapture() {
  const { profile } = useAuth();
  const [consignments, setConsignments] = useState<Consignment[]>([]);
  const [loading, setLoading] = useState(true);
  const [capturingId, setCapturingId] = useState<string | null>(null);
  const [invoiceNumber, setInvoiceNumber] = useState('');
  const [invoiceDate, setInvoiceDate] = useState(new Date().toISOString().split('T')[0]);
  const [invoiceAmount, setInvoiceAmount] = useState<number>(0);
  const [quantityInvoiced, setQuantityInvoiced] = useState<number>(0);
  const [invoiceNotes, setInvoiceNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [showWorksheet, setShowWorksheet] = useState(false);
  const [alertsMap, setAlertsMap] = useState<Record<string, any[]>>({});
  const [sendingReminder, setSendingReminder] = useState<string | null>(null);

  useEffect(() => {
    fetchConsignments();
    fetchAlerts();
  }, []);

  async function fetchAlerts() {
    const { data } = await supabase
      .from('chick_payment_alerts')
      .select('*')
      .order('created_at', { ascending: false });
    if (data) {
      const map: Record<string, any[]> = {};
      for (const alert of data) {
        if (!map[alert.invoice_id]) map[alert.invoice_id] = [];
        map[alert.invoice_id].push(alert);
      }
      setAlertsMap(map);
    }
  }

  async function sendPaymentReminder(invoiceId: string, consignment: Consignment) {
    setSendingReminder(invoiceId);
    try {
      // Get finance/admin users
      const { data: recipients } = await supabase
        .from('profiles')
        .select('id, full_name, email, whatsapp_number, role')
        .in('role', ['finance', 'admin', 'accountant'])
        .eq('notify_email', true);

      const inv = consignment.invoice;
      if (!inv) return;

      for (const r of recipients || []) {
        const { error } = await supabase.from('chick_payment_alerts').insert({
          invoice_id: invoiceId,
          alert_type: 'REMINDER',
          channel: r.whatsapp_number ? 'BOTH' : 'EMAIL',
          recipient_email: r.email,
          recipient_phone: r.whatsapp_number,
          recipient_name: r.full_name,
          recipient_role: r.role,
          message_subject: `REMINDER: Payment for Invoice ${inv.invoice_number} from ${consignment.supplier.name}`,
          message_body: `REMINDER: Invoice ${inv.invoice_number} from ${consignment.supplier.name}\nAmount: $${inv.invoice_amount.toFixed(2)}\nStatus: ${inv.status}\nPlease process payment.`,
          status: 'PENDING',
          triggered_by: profile?.id,
        });
        if (error) console.error('Insert alert error:', error);
      }

      toast.success('Payment reminder queued for finance team');
      fetchAlerts();
    } catch (e: any) {
      toast.error('Failed to send reminder: ' + e.message);
    } finally {
      setSendingReminder(null);
    }
  }

  async function fetchConsignments() {
    setLoading(true);
    const { data } = await supabase
      .from('chick_supplier_consignments')
      .select(`
        id,
        supplier:chick_suppliers (
          name
        ),
        hatch_night:chick_hatch_nights (
          hatch_date
        ),
        po:chick_purchase_orders (
          id,
          po_number
        ),
        delivery_notes:chick_delivery_notes (
          id,
          dnote_number,
          branch_code,
          chick_type,
          quantity_allocated,
          quantity_received,
          variance
        ),
        invoice:chick_supplier_invoices (
          id,
          invoice_number,
          invoice_date,
          invoice_amount,
          quantity_invoiced,
          unit_cost,
          status,
          sage_posting_ref,
          notes
        )
      `)
      .order('created_at', { ascending: false });

    // Transform data to match interface
    const transformed = (data || []).map((item: any) => ({
      id: item.id,
      supplier: Array.isArray(item.supplier) ? item.supplier[0] : item.supplier,
      hatch_night: Array.isArray(item.hatch_night) ? item.hatch_night[0] : item.hatch_night,
      po: Array.isArray(item.po) ? item.po[0] : item.po,
      delivery_notes: item.delivery_notes || [],
      invoice: Array.isArray(item.invoice) ? item.invoice[0] : item.invoice,
    }));

    setConsignments(transformed);
    setLoading(false);
  }

  function openCaptureModal(consignment: Consignment) {
    setCapturingId(consignment.id);
    const totalReceived = consignment.delivery_notes.reduce(
      (sum, dn) => sum + (dn.quantity_received || 0),
      0
    );
    setQuantityInvoiced(totalReceived);
    setInvoiceNumber('');
    setInvoiceDate(new Date().toISOString().split('T')[0]);
    setInvoiceAmount(0);
    setInvoiceNotes('');
  }

  function closeCaptureModal() {
    setCapturingId(null);
    setInvoiceNumber('');
    setInvoiceDate(new Date().toISOString().split('T')[0]);
    setInvoiceAmount(0);
    setQuantityInvoiced(0);
    setInvoiceNotes('');
  }

  async function handleSaveInvoice() {
    if (!capturingId || !invoiceNumber || !invoiceAmount || !quantityInvoiced) {
      toast.error('Please fill in all required fields');
      return;
    }

    setSaving(true);
    try {
      const { error } = await supabase
        .from('chick_supplier_invoices')
        .insert({
          consignment_id: capturingId,
          invoice_number: invoiceNumber,
          invoice_date: invoiceDate,
          invoice_amount: invoiceAmount,
          quantity_invoiced: quantityInvoiced,
          status: 'PENDING',
          notes: invoiceNotes || null,
        });

      if (error) throw error;

      toast.success('Invoice captured successfully');
      closeCaptureModal();
      fetchConsignments();
    } catch (error: any) {
      console.error('Error saving invoice:', error);
      toast.error(`Failed to save: ${error.message}`);
    } finally {
      setSaving(false);
    }
  }

  async function handleVerifyInvoice(invoiceId: string) {
    setSaving(true);
    try {
      const { error } = await supabase
        .from('chick_supplier_invoices')
        .update({
          status: 'VERIFIED',
          verified_by: profile?.id,
          verified_at: new Date().toISOString(),
        })
        .eq('id', invoiceId);

      if (error) throw error;

      toast.success('Invoice verified');
      fetchConsignments();
    } catch (error: any) {
      console.error('Error verifying invoice:', error);
      toast.error(`Failed to verify: ${error.message}`);
    } finally {
      setSaving(false);
    }
  }

  async function handleMarkPosted(invoiceId: string) {
    const sageRef = prompt('Enter Sage Posting Reference (journal/batch number):');
    if (!sageRef) return;

    setSaving(true);
    try {
      const { error } = await supabase
        .from('chick_supplier_invoices')
        .update({
          status: 'POSTED',
          posted_by: profile?.id,
          posted_at: new Date().toISOString(),
          sage_posting_ref: sageRef,
        })
        .eq('id', invoiceId);

      if (error) throw error;

      // Update PO status to INVOICED
      const consignment = consignments.find(c => c.invoice?.id === invoiceId);
      if (consignment?.po) {
        await supabase
          .from('chick_purchase_orders')
          .update({ status: 'INVOICED' })
          .eq('id', consignment.po.id);
      }

      toast.success('Invoice marked as posted');
      fetchConsignments();
    } catch (error: any) {
      console.error('Error marking posted:', error);
      toast.error(`Failed to mark posted: ${error.message}`);
    } finally {
      setSaving(false);
    }
  }

  function generateWorksheetData(): WorksheetRow[] {
    const rows: WorksheetRow[] = [];

    consignments.forEach((consignment) => {
      if (!consignment.invoice) return;

      consignment.delivery_notes.forEach((dn) => {
        rows.push({
          supplier: consignment.supplier.name,
          dnote: dn.dnote_number,
          invoice_no: consignment.invoice!.invoice_number,
          invoice_date: format(new Date(consignment.invoice!.invoice_date), 'yyyy-MM-dd'),
          branch: dn.branch_code,
          chick_type: dn.chick_type,
          qty_delivered: dn.quantity_received || 0,
          qty_invoiced: consignment.invoice!.quantity_invoiced,
          unit_cost: consignment.invoice!.unit_cost,
          total: (dn.quantity_received || 0) * consignment.invoice!.unit_cost,
          variance: dn.variance || 0,
          sage_ref: consignment.invoice!.sage_posting_ref || '',
          notes: consignment.invoice!.notes || '',
        });
      });
    });

    return rows;
  }

  function exportToExcel() {
    const data = generateWorksheetData();
    const ws = XLSX.utils.json_to_sheet(data.map(row => ({
      'Supplier': row.supplier,
      'DNOTE': row.dnote,
      'Invoice No': row.invoice_no,
      'Invoice Date': row.invoice_date,
      'Branch': row.branch,
      'Chick Type': row.chick_type,
      'Qty Delivered': row.qty_delivered,
      'Qty Invoiced': row.qty_invoiced,
      'Unit Cost': row.unit_cost.toFixed(4),
      'Total': row.total.toFixed(2),
      'Variance': row.variance,
      'Sage Ref': row.sage_ref,
      'Notes': row.notes,
    })));

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Chick Invoices');
    XLSX.writeFile(wb, `Chick_Invoice_Worksheet_${format(new Date(), 'yyyy-MM-dd')}.xlsx`);
    toast.success('Worksheet exported to Excel');
  }

  function printWorksheet() {
    setShowWorksheet(true);
    setTimeout(() => {
      window.print();
    }, 100);
  }

  const capturingConsignment = consignments.find(c => c.id === capturingId);
  const totalReceived = capturingConsignment?.delivery_notes.reduce(
    (sum, dn) => sum + (dn.quantity_received || 0),
    0
  ) || 0;
  const variance = quantityInvoiced - totalReceived;

  const stats = {
    pending: consignments.filter(c => !c.invoice).length,
    verified: consignments.filter(c => c.invoice?.status === 'VERIFIED').length,
    posted: consignments.filter(c => c.invoice?.status === 'POSTED').length,
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
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight flex items-center gap-2">
            <DollarSign className="w-8 h-8 text-green-600" />
            Invoice Capture
          </h1>
          <p className="text-muted-foreground mt-1">Capture supplier invoices and generate Sage posting worksheet</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={exportToExcel}>
            <Download className="w-4 h-4 mr-2" />
            Export Excel
          </Button>
          <Button variant="outline" onClick={printWorksheet}>
            <Printer className="w-4 h-4 mr-2" />
            Print Worksheet
          </Button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-4">
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-amber-100 rounded-lg flex items-center justify-center">
                <FileText className="w-5 h-5 text-amber-600" />
              </div>
              <div>
                <p className="text-xs text-slate-500 font-medium">Pending Invoices</p>
                <p className="text-2xl font-bold text-slate-800">{stats.pending}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-blue-100 rounded-lg flex items-center justify-center">
                <CheckCircle className="w-5 h-5 text-blue-600" />
              </div>
              <div>
                <p className="text-xs text-slate-500 font-medium">Verified</p>
                <p className="text-2xl font-bold text-slate-800">{stats.verified}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-green-100 rounded-lg flex items-center justify-center">
                <DollarSign className="w-5 h-5 text-green-600" />
              </div>
              <div>
                <p className="text-xs text-slate-500 font-medium">Posted to Sage</p>
                <p className="text-2xl font-bold text-slate-800">{stats.posted}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Consignments List */}
      <Card>
        <CardHeader>
          <CardTitle>Supplier Consignments</CardTitle>
          <CardDescription>Capture invoices for delivered consignments</CardDescription>
        </CardHeader>
        <CardContent>
          {consignments.length === 0 ? (
            <p className="text-center text-slate-400 py-8">No consignments found</p>
          ) : (
            <div className="space-y-4">
              {consignments.map((consignment) => (
                <Card key={consignment.id} className="border-l-4 border-l-blue-500">
                  <CardContent className="p-4">
                    <div className="space-y-3">
                      {/* Header */}
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-4">
                          <div>
                            <p className="text-sm text-slate-500">Supplier</p>
                            <p className="font-semibold text-lg">{consignment.supplier.name}</p>
                          </div>
                          <div>
                            <p className="text-sm text-slate-500">Hatch Date</p>
                            <p className="font-medium">
                              {format(new Date(consignment.hatch_night.hatch_date), 'PP')}
                            </p>
                          </div>
                          {consignment.po && (
                            <div>
                              <p className="text-sm text-slate-500">PO</p>
                              <p className="font-mono text-sm text-blue-600">{consignment.po.po_number}</p>
                            </div>
                          )}
                        </div>
                        {consignment.invoice ? (
                          <Badge
                            variant={
                              consignment.invoice.status === 'POSTED'
                                ? 'default'
                                : consignment.invoice.status === 'VERIFIED'
                                ? 'secondary'
                                : 'outline'
                            }
                          >
                            {consignment.invoice.status}
                          </Badge>
                        ) : (
                          <Button size="sm" onClick={() => openCaptureModal(consignment)}>
                            Capture Invoice
                          </Button>
                        )}
                      </div>

                      {/* Delivery Notes Summary */}
                      <div className="bg-slate-50 rounded p-3">
                        <p className="text-xs font-semibold text-slate-600 mb-2">Delivery Notes</p>
                        <div className="grid grid-cols-4 gap-2 text-sm">
                          {consignment.delivery_notes.map((dn) => (
                            <div key={dn.id} className="flex items-center justify-between">
                              <span className="font-mono text-xs text-slate-600">{dn.dnote_number}</span>
                              <span className="font-semibold">{dn.quantity_received || 0}</span>
                            </div>
                          ))}
                        </div>
                        <div className="mt-2 pt-2 border-t border-slate-200 flex justify-between font-semibold">
                          <span>Total Received:</span>
                          <span>
                            {consignment.delivery_notes.reduce(
                              (sum, dn) => sum + (dn.quantity_received || 0),
                              0
                            ).toLocaleString()}
                          </span>
                        </div>
                      </div>

                      {/* Invoice Details */}
                      {consignment.invoice && (
                        <div className="bg-green-50 rounded p-3 space-y-2">
                          <div className="flex items-center justify-between">
                            <div className="grid grid-cols-4 gap-4 text-sm flex-1">
                              <div>
                                <p className="text-xs text-slate-500">Invoice No</p>
                                <p className="font-semibold">{consignment.invoice.invoice_number}</p>
                              </div>
                              <div>
                                <p className="text-xs text-slate-500">Date</p>
                                <p className="font-medium">
                                  {format(new Date(consignment.invoice.invoice_date), 'PP')}
                                </p>
                              </div>
                              <div>
                                <p className="text-xs text-slate-500">Amount</p>
                                <p className="font-semibold">${consignment.invoice.invoice_amount.toFixed(2)}</p>
                              </div>
                              <div>
                                <p className="text-xs text-slate-500">Unit Cost</p>
                                <p className="font-semibold">${consignment.invoice.unit_cost.toFixed(4)}</p>
                              </div>
                            </div>
                            <div className="flex gap-2">
                              {consignment.invoice.status === 'PENDING' && (
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={() => handleVerifyInvoice(consignment.invoice!.id)}
                                  disabled={saving}
                                >
                                  Verify
                                </Button>
                              )}
                              {consignment.invoice.status === 'VERIFIED' && (
                                <Button
                                  size="sm"
                                  onClick={() => handleMarkPosted(consignment.invoice!.id)}
                                  disabled={saving}
                                >
                                  Mark Posted
                                </Button>
                              )}
                            </div>
                          </div>
                          {consignment.invoice.sage_posting_ref && (
                            <p className="text-xs text-slate-600">
                              Sage Ref: <span className="font-mono">{consignment.invoice.sage_posting_ref}</span>
                            </p>
                          )}

                          {/* Payment Alerts */}
                          {alertsMap[consignment.invoice.id]?.length > 0 && (
                            <div className="mt-2 pt-2 border-t border-green-200">
                              <p className="text-xs font-semibold text-slate-600 mb-1 flex items-center gap-1">
                                <Bell className="w-3 h-3" /> Payment Alerts
                              </p>
                              <div className="space-y-1">
                                {alertsMap[consignment.invoice.id].slice(0, 3).map((alert: any) => (
                                  <div key={alert.id} className="flex items-center gap-2 text-xs">
                                    <Badge
                                      variant={alert.status === 'SENT' ? 'default' : alert.status === 'FAILED' ? 'destructive' : 'outline'}
                                      className="text-[10px] h-4"
                                    >
                                      {alert.status}
                                    </Badge>
                                    <span className="text-slate-500">{alert.alert_type}</span>
                                    <span className="text-slate-400">to {alert.recipient_name || alert.recipient_role}</span>
                                    {alert.channel === 'BOTH' ? (
                                      <span className="flex items-center gap-0.5 text-slate-400"><Mail className="w-3 h-3" /><MessageCircle className="w-3 h-3" /></span>
                                    ) : alert.channel === 'EMAIL' ? (
                                      <Mail className="w-3 h-3 text-slate-400" />
                                    ) : (
                                      <MessageCircle className="w-3 h-3 text-slate-400" />
                                    )}
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}

                          {/* Send Reminder Button */}
                          {(consignment.invoice.status === 'VERIFIED' || consignment.invoice.status === 'POSTED') && (
                            <div className="mt-2 pt-2 border-t border-green-200">
                              <Button
                                size="sm"
                                variant="outline"
                                className="text-xs h-7"
                                onClick={() => sendPaymentReminder(consignment.invoice!.id, consignment)}
                                disabled={sendingReminder === consignment.invoice.id}
                              >
                                <Bell className="w-3 h-3 mr-1" />
                                {sendingReminder === consignment.invoice.id ? 'Sending...' : 'Send Payment Reminder'}
                              </Button>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Capture Invoice Modal */}
      <Dialog open={capturingId !== null} onOpenChange={(open) => !open && closeCaptureModal()}>
        <DialogContent className="sm:max-w-2xl flex flex-col p-0">
          <DialogHeader className="px-6 pt-6 pb-4 border-b">
            <DialogTitle>Capture Supplier Invoice</DialogTitle>
            <DialogDescription>
              Enter invoice details for {capturingConsignment?.supplier.name}
            </DialogDescription>
          </DialogHeader>

          {capturingConsignment && (
            <div className="px-6 py-4 space-y-4">
              <div className="bg-slate-50 rounded p-3 text-sm space-y-1">
                <div className="flex justify-between">
                  <span className="text-slate-500">Total Received:</span>
                  <span className="font-semibold">{totalReceived.toLocaleString()} chicks</span>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="invoice_number">Invoice Number *</Label>
                  <Input
                    id="invoice_number"
                    value={invoiceNumber}
                    onChange={(e) => setInvoiceNumber(e.target.value)}
                    placeholder="INV-12345"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="invoice_date">Invoice Date *</Label>
                  <Input
                    id="invoice_date"
                    type="date"
                    value={invoiceDate}
                    onChange={(e) => setInvoiceDate(e.target.value)}
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="invoice_amount">Invoice Amount (USD) *</Label>
                  <Input
                    id="invoice_amount"
                    type="number"
                    step="0.01"
                    value={invoiceAmount || ''}
                    onChange={(e) => setInvoiceAmount(parseFloat(e.target.value) || 0)}
                    placeholder="0.00"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="quantity_invoiced">Quantity Invoiced *</Label>
                  <Input
                    id="quantity_invoiced"
                    type="number"
                    value={quantityInvoiced || ''}
                    onChange={(e) => setQuantityInvoiced(parseInt(e.target.value) || 0)}
                  />
                  {variance !== 0 && (
                    <p className="text-xs text-red-600 flex items-center gap-1">
                      <AlertCircle className="w-3 h-3" />
                      Variance: {variance > 0 ? '+' : ''}{variance}
                    </p>
                  )}
                </div>
              </div>

              {invoiceAmount > 0 && quantityInvoiced > 0 && (
                <div className="bg-blue-50 rounded p-3">
                  <p className="text-sm text-slate-600">
                    Unit Cost: <span className="font-semibold text-blue-700">
                      ${(invoiceAmount / quantityInvoiced).toFixed(4)}
                    </span>
                  </p>
                </div>
              )}

              <div className="space-y-2">
                <Label htmlFor="invoice_notes">Notes</Label>
                <Textarea
                  id="invoice_notes"
                  value={invoiceNotes}
                  onChange={(e) => setInvoiceNotes(e.target.value)}
                  placeholder="Additional notes..."
                  rows={2}
                />
              </div>
            </div>
          )}

          <div className="px-6 py-4 border-t bg-slate-50 flex justify-end gap-2">
            <Button variant="outline" onClick={closeCaptureModal} disabled={saving}>
              Cancel
            </Button>
            <Button onClick={handleSaveInvoice} disabled={saving}>
              {saving ? 'Saving...' : 'Save Invoice'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Worksheet Print View */}
      {showWorksheet && (
        <div className="print-only fixed inset-0 bg-white p-8 overflow-auto">
          <h1 className="text-2xl font-bold mb-6">Chick Invoice Posting Worksheet</h1>
          <p className="text-sm text-slate-600 mb-4">
            Generated: {format(new Date(), 'PPpp')}
          </p>
          <table className="w-full border-collapse border border-slate-300 text-sm">
            <thead>
              <tr className="bg-slate-100">
                <th className="border border-slate-300 p-2 text-left">Supplier</th>
                <th className="border border-slate-300 p-2 text-left">DNOTE</th>
                <th className="border border-slate-300 p-2 text-left">Invoice No</th>
                <th className="border border-slate-300 p-2 text-left">Date</th>
                <th className="border border-slate-300 p-2 text-left">Branch</th>
                <th className="border border-slate-300 p-2 text-left">Type</th>
                <th className="border border-slate-300 p-2 text-right">Qty Delivered</th>
                <th className="border border-slate-300 p-2 text-right">Qty Invoiced</th>
                <th className="border border-slate-300 p-2 text-right">Unit Cost</th>
                <th className="border border-slate-300 p-2 text-right">Total</th>
                <th className="border border-slate-300 p-2 text-right">Variance</th>
                <th className="border border-slate-300 p-2 text-left">Sage Ref</th>
              </tr>
            </thead>
            <tbody>
              {generateWorksheetData().map((row, idx) => (
                <tr key={idx}>
                  <td className="border border-slate-300 p-2">{row.supplier}</td>
                  <td className="border border-slate-300 p-2">{row.dnote}</td>
                  <td className="border border-slate-300 p-2">{row.invoice_no}</td>
                  <td className="border border-slate-300 p-2">{row.invoice_date}</td>
                  <td className="border border-slate-300 p-2">{row.branch}</td>
                  <td className="border border-slate-300 p-2">{row.chick_type}</td>
                  <td className="border border-slate-300 p-2 text-right">{row.qty_delivered}</td>
                  <td className="border border-slate-300 p-2 text-right">{row.qty_invoiced}</td>
                  <td className="border border-slate-300 p-2 text-right">${row.unit_cost.toFixed(4)}</td>
                  <td className="border border-slate-300 p-2 text-right">${row.total.toFixed(2)}</td>
                  <td className="border border-slate-300 p-2 text-right">{row.variance}</td>
                  <td className="border border-slate-300 p-2">{row.sage_ref}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <style>{`
        @media print {
          body * {
            visibility: hidden;
          }
          .print-only, .print-only * {
            visibility: visible;
          }
          .print-only {
            position: absolute;
            left: 0;
            top: 0;
          }
        }
      `}</style>
    </div>
  );
}
