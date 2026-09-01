import { useState, useEffect } from 'react';
import { Plus, Save, CheckCircle, AlertTriangle, Trash2, Moon, Package } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../context/AuthContext';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../components/ui/card';
import { Badge } from '../../components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../../components/ui/table';
import { Label } from '../../components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../components/ui/select';
import { Textarea } from '../../components/ui/textarea';
import toast from 'react-hot-toast';

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
  booked_qty: number;
  wish_qty: number;
  chick_type: 'STANDARD' | 'HUBBARD';
  delivery_type: 'LOCAL' | 'BRANCH';
}

interface PO {
  id: string;
  po_number: string;
  supplier_id: string;
  chick_type: 'STANDARD' | 'HUBBARD';
  expected_delivery_date?: string;
  lines: POLine[];
}

interface AllocationLine {
  id: string;
  branch_code: string;
  po_booked_qty: number;
  allocated_qty: number;
  dnote_number: string;
  chick_type: 'STANDARD' | 'HUBBARD';
  delivery_type: 'LOCAL' | 'BRANCH';
  driver_name: string;
  po_line_id?: string;
}

interface SupplierSection {
  id: string;
  supplier_id: string;
  po_id: string;
  po_number: string;
  lines: AllocationLine[];
}

export default function ChickNightIntake() {
  const { profile } = useAuth();
  const [hatchDate, setHatchDate] = useState(new Date().toISOString().split('T')[0]);
  const [hatchStatus, setHatchStatus] = useState<'COMPLETE' | 'IN_PROGRESS'>('IN_PROGRESS');
  const [notes, setNotes] = useState('');
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [approvedPOs, setApprovedPOs] = useState<PO[]>([]);
  const [supplierSections, setSupplierSections] = useState<SupplierSection[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetchData();
  }, []);

  useEffect(() => {
    if (hatchDate) {
      fetchApprovedPOs();
    }
  }, [hatchDate]);

  async function fetchData() {
    const [suppliersRes, branchesRes] = await Promise.all([
      supabase.from('chick_suppliers').select('*').eq('is_active', true).order('name'),
      supabase.from('chick_branches').select('*').eq('is_active', true).order('branch_name'),
    ]);
    setSuppliers(suppliersRes.data || []);
    setBranches(branchesRes.data || []);
  }

  async function fetchApprovedPOs() {
    const { data } = await supabase
      .from('chick_purchase_orders')
      .select(`
        id,
        po_number,
        supplier_id,
        chick_type,
        expected_delivery_date,
        chick_po_lines (
          id,
          branch_code,
          booked_qty,
          wish_qty,
          chick_type,
          delivery_type
        )
      `)
      .eq('status', 'APPROVED');

    const pos: PO[] = (data || []).map((po: any) => ({
      id: po.id,
      po_number: po.po_number,
      supplier_id: po.supplier_id,
      chick_type: po.chick_type,
      expected_delivery_date: po.expected_delivery_date,
      lines: po.chick_po_lines || [],
    }));

    setApprovedPOs(pos);
  }

  function addSupplierSection() {
    const newSection: SupplierSection = {
      id: crypto.randomUUID(),
      supplier_id: '',
      po_id: '',
      po_number: '',
      lines: [],
    };
    setSupplierSections([...supplierSections, newSection]);
  }

  function removeSupplierSection(sectionId: string) {
    setSupplierSections(supplierSections.filter(s => s.id !== sectionId));
  }

  function updateSupplierSection(sectionId: string, field: keyof SupplierSection, value: any) {
    setSupplierSections(supplierSections.map(s => {
      if (s.id === sectionId) {
        if (field === 'supplier_id') {
          // Find PO for this supplier and date
          const po = approvedPOs.find(p => p.supplier_id === value);
          if (po) {
            // Pre-populate lines from PO
            const lines: AllocationLine[] = po.lines.map((line) => ({
              id: crypto.randomUUID(),
              branch_code: line.branch_code,
              po_booked_qty: line.booked_qty,
              allocated_qty: 0,
              dnote_number: '',
              chick_type: line.chick_type,
              delivery_type: line.delivery_type,
              driver_name: '',
              po_line_id: line.id,
            }));
            return { ...s, supplier_id: value, po_id: po.id, po_number: po.po_number, lines };
          }
        }
        return { ...s, [field]: value };
      }
      return s;
    }));
  }

  function addLineToSection(sectionId: string) {
    setSupplierSections(supplierSections.map(s => {
      if (s.id === sectionId) {
        const newLine: AllocationLine = {
          id: crypto.randomUUID(),
          branch_code: '',
          po_booked_qty: 0,
          allocated_qty: 0,
          dnote_number: '',
          chick_type: 'STANDARD',
          delivery_type: 'LOCAL',
          driver_name: '',
        };
        return { ...s, lines: [...s.lines, newLine] };
      }
      return s;
    }));
  }

  function removeLineFromSection(sectionId: string, lineId: string) {
    setSupplierSections(supplierSections.map(s => {
      if (s.id === sectionId) {
        return { ...s, lines: s.lines.filter(l => l.id !== lineId) };
      }
      return s;
    }));
  }

  function updateLine(sectionId: string, lineId: string, field: keyof AllocationLine, value: any) {
    setSupplierSections(supplierSections.map(s => {
      if (s.id === sectionId) {
        return {
          ...s,
          lines: s.lines.map(l => {
            if (l.id === lineId) {
              if (field === 'branch_code') {
                const branch = branches.find(b => b.branch_code === value);
                return { ...l, branch_code: value, delivery_type: branch?.delivery_type || 'LOCAL' };
              }
              return { ...l, [field]: value };
            }
            return l;
          }),
        };
      }
      return s;
    }));
  }

  function getSupplierTotal(section: SupplierSection): number {
    return section.lines.reduce((sum, line) => sum + (line.allocated_qty || 0), 0);
  }

  function getGrandTotal(): number {
    return supplierSections.reduce((sum, section) => sum + getSupplierTotal(section), 0);
  }

  async function handleSaveDraft() {
    setSaving(true);
    try {
      // Create hatch night
      const { data: hatchNight, error: hnError } = await supabase
        .from('chick_hatch_nights')
        .insert({
          hatch_date: hatchDate,
          status: 'DRAFT',
          hatch_completion_status: hatchStatus,
          notes: notes || null,
          created_by: profile?.id,
        })
        .select()
        .single();

      if (hnError) throw hnError;

      // Create consignments and delivery notes
      for (const section of supplierSections) {
        if (!section.supplier_id) continue;

        const { data: consignment, error: consError } = await supabase
          .from('chick_supplier_consignments')
          .insert({
            hatch_night_id: hatchNight.id,
            po_id: section.po_id || null,
            supplier_id: section.supplier_id,
            hatch_completion_status: hatchStatus,
            created_by: profile?.id,
          })
          .select()
          .single();

        if (consError) throw consError;

        // Create delivery notes
        const dnotes = section.lines
          .filter(line => line.branch_code && line.dnote_number)
          .map(line => ({
            consignment_id: consignment.id,
            po_line_id: line.po_line_id || null,
            dnote_number: line.dnote_number,
            branch_code: line.branch_code,
            delivery_type: line.delivery_type,
            chick_type: line.chick_type,
            quantity_allocated: line.allocated_qty,
            driver_name: line.driver_name || null,
            status: 'PENDING',
          }));

        if (dnotes.length > 0) {
          const { error: dnotesError } = await supabase
            .from('chick_delivery_notes')
            .insert(dnotes);

          if (dnotesError) throw dnotesError;
        }
      }

      toast.success('Hatch night saved as draft');
      resetForm();
    } catch (error: any) {
      console.error('Error saving hatch night:', error);
      toast.error(`Failed to save: ${error.message}`);
    } finally {
      setSaving(false);
    }
  }

  async function handleConfirmNight() {
    setSaving(true);
    try {
      // Create hatch night
      const { data: hatchNight, error: hnError } = await supabase
        .from('chick_hatch_nights')
        .insert({
          hatch_date: hatchDate,
          status: 'CONFIRMED',
          hatch_completion_status: hatchStatus,
          notes: notes || null,
          created_by: profile?.id,
          confirmed_by: profile?.id,
          confirmed_at: new Date().toISOString(),
        })
        .select()
        .single();

      if (hnError) throw hnError;

      // Create consignments and delivery notes
      for (const section of supplierSections) {
        if (!section.supplier_id) continue;

        const { data: consignment, error: consError } = await supabase
          .from('chick_supplier_consignments')
          .insert({
            hatch_night_id: hatchNight.id,
            po_id: section.po_id || null,
            supplier_id: section.supplier_id,
            hatch_completion_status: hatchStatus,
            confirmed_by: profile?.id,
            confirmed_at: new Date().toISOString(),
          })
          .select()
          .single();

        if (consError) throw consError;

        // Create delivery notes
        const dnotes = section.lines
          .filter(line => line.branch_code && line.dnote_number)
          .map(line => ({
            consignment_id: consignment.id,
            po_line_id: line.po_line_id || null,
            dnote_number: line.dnote_number,
            branch_code: line.branch_code,
            delivery_type: line.delivery_type,
            chick_type: line.chick_type,
            quantity_allocated: line.allocated_qty,
            driver_name: line.driver_name || null,
            status: 'PENDING',
          }));

        if (dnotes.length > 0) {
          const { error: dnotesError } = await supabase
            .from('chick_delivery_notes')
            .insert(dnotes);

          if (dnotesError) throw dnotesError;
        }

        // Update PO status to DISPATCHED
        if (section.po_id) {
          await supabase
            .from('chick_purchase_orders')
            .update({ status: 'DISPATCHED' })
            .eq('id', section.po_id);
        }
      }

      toast.success('Hatch night confirmed and POs dispatched');
      resetForm();
    } catch (error: any) {
      console.error('Error confirming hatch night:', error);
      toast.error(`Failed to confirm: ${error.message}`);
    } finally {
      setSaving(false);
    }
  }

  function resetForm() {
    setHatchDate(new Date().toISOString().split('T')[0]);
    setHatchStatus('IN_PROGRESS');
    setNotes('');
    setSupplierSections([]);
  }

  return (
    <div className="space-y-6 p-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight flex items-center gap-2">
            <Moon className="w-8 h-8 text-indigo-600" />
            Hatch Night Intake
          </h1>
          <p className="text-muted-foreground mt-1">Record tonight's hatch allocations and delivery notes</p>
        </div>
      </div>

      {/* Warning Banner for IN_PROGRESS */}
      {hatchStatus === 'IN_PROGRESS' && (
        <div className="bg-amber-50 border-l-4 border-amber-400 p-4 rounded-lg">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-5 h-5 text-amber-600" />
            <p className="text-sm font-semibold text-amber-800">
              Hatch still in progress — quantities are provisional
            </p>
          </div>
        </div>
      )}

      {/* Main Form */}
      <Card>
        <CardHeader>
          <CardTitle>Hatch Details</CardTitle>
          <CardDescription>Set the hatch date and completion status</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-3 gap-4">
            <div className="space-y-2">
              <Label htmlFor="hatch_date">Hatch Date *</Label>
              <Input
                id="hatch_date"
                type="date"
                value={hatchDate}
                onChange={(e) => setHatchDate(e.target.value)}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="hatch_status">Hatch Completion Status *</Label>
              <Select value={hatchStatus} onValueChange={(val: any) => setHatchStatus(val)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="IN_PROGRESS">In Progress</SelectItem>
                  <SelectItem value="COMPLETE">Complete</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Approved POs for this date</Label>
              <div className="text-sm text-slate-600 bg-slate-50 rounded px-3 py-2">
                {approvedPOs.length} PO(s) found
              </div>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="notes">Notes</Label>
            <Textarea
              id="notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="General notes about tonight's hatch..."
              rows={2}
            />
          </div>
        </CardContent>
      </Card>

      {/* Supplier Sections */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-bold">Supplier Allocations</h2>
          <Button onClick={addSupplierSection} variant="outline">
            <Plus className="w-4 h-4 mr-2" />
            Add Supplier
          </Button>
        </div>

        {supplierSections.map((section) => (
          <Card key={section.id} className="border-l-4 border-l-indigo-500">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-4 flex-1">
                  <div className="flex-1 max-w-xs">
                    <Label className="text-xs">Supplier *</Label>
                    <Select
                      value={section.supplier_id}
                      onValueChange={(val) => updateSupplierSection(section.id, 'supplier_id', val)}
                    >
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
                  {section.po_number && (
                    <div>
                      <Label className="text-xs">Linked PO</Label>
                      <div className="text-sm font-mono text-indigo-600 bg-indigo-50 px-3 py-1.5 rounded">
                        {section.po_number}
                      </div>
                    </div>
                  )}
                  <div>
                    <Label className="text-xs">Supplier Total</Label>
                    <div className="text-lg font-bold text-slate-800">
                      {getSupplierTotal(section).toLocaleString()}
                    </div>
                  </div>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => removeSupplierSection(section.id)}
                  className="text-red-600 hover:text-red-700"
                >
                  <Trash2 className="w-4 h-4" />
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <Label className="text-sm font-semibold">Branch Allocations</Label>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => addLineToSection(section.id)}
                  >
                    <Plus className="w-3 h-3 mr-1" />
                    Add Branch
                  </Button>
                </div>

                {section.lines.length === 0 ? (
                  <p className="text-sm text-slate-400 text-center py-4">
                    No allocations yet. Add a branch or select a supplier with an approved PO.
                  </p>
                ) : (
                  <div className="border rounded-lg overflow-hidden">
                    <Table>
                      <TableHeader>
                        <TableRow className="bg-slate-50">
                          <TableHead className="w-[180px]">Branch</TableHead>
                          <TableHead className="w-[100px] text-right">PO Booked</TableHead>
                          <TableHead className="w-[120px] text-right">Allocated Qty *</TableHead>
                          <TableHead className="w-[140px]">DNOTE No *</TableHead>
                          <TableHead className="w-[120px]">Chick Type</TableHead>
                          <TableHead className="w-[120px]">Delivery</TableHead>
                          <TableHead className="w-[140px]">Driver (LOCAL)</TableHead>
                          <TableHead className="w-[60px]"></TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {section.lines.map((line) => (
                          <TableRow key={line.id}>
                            <TableCell>
                              <Select
                                value={line.branch_code}
                                onValueChange={(val) => updateLine(section.id, line.id, 'branch_code', val)}
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
                            <TableCell className="text-right text-sm text-slate-500">
                              {line.po_booked_qty || '-'}
                            </TableCell>
                            <TableCell>
                              <Input
                                type="number"
                                value={line.allocated_qty || ''}
                                onChange={(e) => updateLine(section.id, line.id, 'allocated_qty', parseInt(e.target.value) || 0)}
                                className="h-8 text-right"
                              />
                            </TableCell>
                            <TableCell>
                              <Input
                                value={line.dnote_number}
                                onChange={(e) => updateLine(section.id, line.id, 'dnote_number', e.target.value)}
                                placeholder="33514"
                                className="h-8"
                              />
                            </TableCell>
                            <TableCell>
                              <Select
                                value={line.chick_type}
                                onValueChange={(val) => updateLine(section.id, line.id, 'chick_type', val)}
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
                              <Badge variant={line.delivery_type === 'LOCAL' ? 'default' : 'secondary'} className="text-xs">
                                {line.delivery_type}
                              </Badge>
                            </TableCell>
                            <TableCell>
                              {line.delivery_type === 'LOCAL' && (
                                <Input
                                  value={line.driver_name}
                                  onChange={(e) => updateLine(section.id, line.id, 'driver_name', e.target.value)}
                                  placeholder="Driver name"
                                  className="h-8"
                                />
                              )}
                            </TableCell>
                            <TableCell>
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => removeLineFromSection(section.id, line.id)}
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
                )}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Grand Total */}
      <Card className="bg-slate-900 text-white">
        <CardContent className="p-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Package className="w-6 h-6" />
              <span className="text-lg font-semibold">Grand Total Allocated</span>
            </div>
            <div className="text-3xl font-bold">
              {getGrandTotal().toLocaleString()} chicks
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Action Buttons */}
      <div className="flex justify-end gap-3">
        <Button variant="outline" onClick={resetForm} disabled={saving}>
          Cancel
        </Button>
        <Button variant="secondary" onClick={handleSaveDraft} disabled={saving}>
          <Save className="w-4 h-4 mr-2" />
          {saving ? 'Saving...' : 'Save Draft'}
        </Button>
        <Button onClick={handleConfirmNight} disabled={saving}>
          <CheckCircle className="w-4 h-4 mr-2" />
          {saving ? 'Confirming...' : 'Confirm Night'}
        </Button>
      </div>
    </div>
  );
}
