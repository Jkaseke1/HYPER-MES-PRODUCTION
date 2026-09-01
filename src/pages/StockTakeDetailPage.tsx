import { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { 
  ArrowLeft, Lock, Unlock, AlertTriangle, CheckCircle, 
  Download, FileSpreadsheet, Loader2, Flag, ThumbsUp,
  EyeOff, Users, Clock,
  BarChart3, PieChart, TrendingUp, TrendingDown, Minus,
  CheckCircle2, XCircle, Activity, Package, RefreshCw
} from 'lucide-react';
import {
  ResponsiveContainer, PieChart as RePieChart, Pie, Cell,
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend
} from 'recharts';
import { format } from 'date-fns';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import Modal from '../components/ui/Modal';
import StatusBadge from '../components/ui/StatusBadge';
import toast from 'react-hot-toast';
import jsPDF from 'jspdf';
import * as XLSX from 'xlsx';

interface StockTake {
  id: string;
  take_number: string;
  status: 'OPEN' | 'FROZEN' | 'CLOSED';
  started_by: string;
  started_at: string;
  frozen_by?: string;
  frozen_at?: string;
  closed_by?: string;
  closed_at?: string;
  notes?: string;
  blind_mode: boolean;
  started_by_profile?: { full_name: string };
  frozen_by_profile?: { full_name: string };
  closed_by_profile?: { full_name: string };
  baseline_source?: 'sage_sdk' | 'legacy_mes';
  baseline_snapshot_at?: string;
  baseline_sync_status?: 'SYNCING' | 'READY' | 'FAILED';
  baseline_sync_message?: string;
}

interface StockTakeLine {
  id: string;
  stock_take_id: string;
  raw_material_id: string;
  assigned_to?: string;
  system_qty: number;
  counted_qty?: number;
  recount_qty?: number;
  variance: number;
  unit: string;
  is_mandatory: boolean;
  is_locked: boolean;
  needs_recount: boolean;
  recount_reason?: string;
  counted_by?: string;
  counted_at?: string;
  approved_by?: string;
  approved_at?: string;
  variance_reason?: string;
  notes?: string;
  raw_materials?: {
    code: string;
    name: string;
    sage_code: string;
    location?: string;
  };
  assigned_to_profile?: { full_name: string };
  counted_by_profile?: { full_name: string };
  approved_by_profile?: { full_name: string };
}

interface User {
  id: string;
  full_name: string;
  email: string;
}

export default function StockTakeDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { profile } = useAuth();

  // Guard against missing ID
  if (!id) {
    return (
      <div className="text-center py-12">
        <AlertTriangle className="h-12 w-12 text-gray-400 mx-auto mb-3" />
        <p className="text-gray-500">Invalid stock take ID</p>
        <button
          onClick={() => navigate('/stock-take')}
          className="mt-4 px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700"
        >
          Back to Stock Takes
        </button>
      </div>
    );
  }
  
  const [loading, setLoading] = useState(true);
  const [stockTake, setStockTake] = useState<StockTake | null>(null);
  const [lines, setLines] = useState<StockTakeLine[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [filter, setFilter] = useState<'all' | 'zero' | 'low' | 'high' | 'pending'>('all');
  const [showAssignPanel, setShowAssignPanel] = useState(false);
  const [showFreezeModal, setShowFreezeModal] = useState(false);
  const [showCloseModal, setShowCloseModal] = useState(false);
  const [showRecountModal, setShowRecountModal] = useState(false);
  const [showVarianceApprovalModal, setShowVarianceApprovalModal] = useState(false);
  const [selectedLine, setSelectedLine] = useState<StockTakeLine | null>(null);
  const [inputValues, setInputValues] = useState<Record<string, string>>({});
  const [recountReason, setRecountReason] = useState('');
  const [varianceApprovalReason, setVarianceApprovalReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [showAuditTrail, setShowAuditTrail] = useState(false);
  const [auditLog, setAuditLog] = useState<any[]>([]);
  const [auditLoading, setAuditLoading] = useState(false);

  useEffect(() => {
    if (id) {
      fetchStockTake();
      // A Sage snapshot can take longer than one normal screen refresh. Poll
      // the header too so the counter sees the bridge result without reload.
      const interval = setInterval(() => {
        void fetchStockTake({ silent: true });
      }, 10000);
      return () => clearInterval(interval);
    }
  }, [id]);

  useEffect(() => {
    if (showAuditTrail && id) {
      fetchAuditLog();
    }
  }, [showAuditTrail, id]);

  const fetchStockTake = async ({ silent = false }: { silent?: boolean } = {}) => {
    if (!id) return;
    if (!silent) setLoading(true);
    try {
      const { data: take, error: takeError } = await supabase
        .from('stock_takes')
        .select(`
          *,
          started_by_profile:started_by(full_name),
          frozen_by_profile:frozen_by(full_name),
          closed_by_profile:closed_by(full_name)
        `)
        .eq('id', id)
        .single();

      if (takeError) throw takeError;
      setStockTake(take);

      await fetchLines();

      if (!silent) {
        const { data: usersData } = await supabase
          .from('profiles')
          .select('id, full_name, email')
          .order('full_name');
        if (usersData) setUsers(usersData);
      }

    } catch (error: any) {
      console.error('Error fetching stock take:', error);
      if (!silent) toast.error(`Failed to load stock take: ${error.message}`);
    } finally {
      if (!silent) setLoading(false);
    }
  };

  const fetchLines = async () => {
    if (!id) return;
    const { data: linesData, error: linesError } = await supabase
      .from('stock_take_lines')
      .select(`
        *,
        raw_materials(code, name, sage_code),
        assigned_to_profile:assigned_to(full_name),
        counted_by_profile:counted_by(full_name),
        approved_by_profile:approved_by(full_name)
      `)
      .eq('stock_take_id', id)
      .order('raw_materials(code)');

    if (linesError) {
      console.error('Error fetching lines:', linesError);
    } else if (linesData) {
      setLines(linesData);
    }
  };

  const fetchAuditLog = async () => {
    if (!id) return;
    setAuditLoading(true);
    try {
      const { data, error } = await supabase
        .from('stock_take_audit_log')
        .select(`
          *,
          line:line_id(raw_materials:raw_material_id(code, name)),
          changed_by_profile:changed_by(full_name)
        `)
        .eq('stock_take_id', id)
        .order('changed_at', { ascending: false });

      if (error) throw error;
      setAuditLog(data || []);
    } catch (error) {
      console.error('Error fetching audit log:', error);
    } finally {
      setAuditLoading(false);
    }
  };

  const handleUpdateCountedQty = async (lineId: string, value: string) => {
    const qty = value === '' ? null : parseFloat(value);

    if (qty !== null && (!Number.isFinite(qty) || qty < 0)) {
      toast.error('Counted quantity must be zero or greater.');
      return;
    }

    const line = lines.find((candidate) => candidate.id === lineId);
    const requiresRecount = qty !== null
      && (line?.system_qty || 0) > 0
      && Math.abs((qty - (line?.system_qty || 0)) / (line?.system_qty || 1)) > 0.05;
    
    try {
      const { error } = await supabase
        .from('stock_take_lines')
        .update({ 
          counted_qty: qty,
          counted_by: profile?.id,
          counted_at: new Date().toISOString(),
          approved_by: null,
          approved_at: null,
          variance_reason: null,
          is_locked: false,
          needs_recount: Boolean(line?.needs_recount || requiresRecount),
          recount_reason: requiresRecount && !line?.needs_recount
            ? 'Automatically required because the first count differs from system stock by more than 5%.'
            : line?.recount_reason || null
        })
        .eq('id', lineId);

      if (error) throw error;

      // Log audit trail
      await supabase.from('stock_take_audit_log').insert({
        stock_take_id: id,
        line_id: lineId,
        action: 'counted_qty_updated',
        new_value: qty,
        changed_by: profile?.id,
        notes: `Count entered by ${profile?.full_name}`
      });

      await fetchLines();
      // Removed toast notification to avoid annoying popups during typing
    } catch (error: any) {
      console.error('Error updating count:', error);
      toast.error(`Failed to save count: ${error.message}`);
    }
  };

  const handleUpdateRecountQty = async (lineId: string, value: string) => {
    const qty = value === '' ? null : parseFloat(value);

    if (qty !== null && (!Number.isFinite(qty) || qty < 0)) {
      toast.error('Recount quantity must be zero or greater.');
      return;
    }
    
    try {
      const { error } = await supabase
        .from('stock_take_lines')
        .update({
          recount_qty: qty,
          approved_by: null,
          approved_at: null,
          variance_reason: null,
          is_locked: false
        })
        .eq('id', lineId);

      if (error) throw error;

      await supabase.from('stock_take_audit_log').insert({
        stock_take_id: id,
        line_id: lineId,
        action: 'recount_qty_updated',
        new_value: qty,
        changed_by: profile?.id
      });

      await fetchLines();
      // Removed toast notification to avoid annoying popups during typing
    } catch (error: any) {
      console.error('Error updating recount:', error);
      toast.error(`Failed to save recount: ${error.message}`);
    }
  };

  const handleFlagForRecount = async () => {
    if (!selectedLine || !recountReason.trim()) {
      toast.error('Please provide a reason for recount');
      return;
    }

    setSaving(true);
    try {
      const { error } = await supabase
        .from('stock_take_lines')
        .update({ 
          needs_recount: true,
          recount_reason: recountReason,
          approved_by: null,
          approved_at: null,
          variance_reason: null,
          is_locked: false
        })
        .eq('id', selectedLine.id);

      if (error) throw error;

      await supabase.from('stock_take_audit_log').insert({
        stock_take_id: id,
        line_id: selectedLine.id,
        action: 'flagged_for_recount',
        changed_by: profile?.id,
        notes: recountReason
      });

      await fetchLines();
      toast.success('Line flagged for recount');
      setShowRecountModal(false);
      setRecountReason('');
      setSelectedLine(null);
    } catch (error: any) {
      console.error('Error flagging for recount:', error);
      toast.error(`Failed to flag for recount: ${error.message}`);
    } finally {
      setSaving(false);
    }
  };

  const handleApproveLine = async () => {
    if (!selectedLine || !varianceApprovalReason.trim()) {
      toast.error('Provide the reason for this stock variance.');
      return;
    }

    setSaving(true);
    try {
      const { error } = await supabase.rpc('review_stock_take_variance', {
        p_line_id: selectedLine.id,
        p_reason: varianceApprovalReason.trim(),
      });

      if (error) throw error;

      await fetchLines();
      toast.success('Variance approved and line locked');
      setShowVarianceApprovalModal(false);
      setVarianceApprovalReason('');
      setSelectedLine(null);
    } catch (error: any) {
      console.error('Error approving line:', error);
      toast.error(`Failed to approve variance: ${error.message}`);
    } finally {
      setSaving(false);
    }
  };

  const handleRetrySageSnapshot = async () => {
    if (!stockTake || stockTake.baseline_sync_status === 'SYNCING') return;
    setSaving(true);
    try {
      const { data: previousEvent } = await supabase
        .from('sync_log')
        .select('details')
        .eq('event_type', 'stock_take_sage_snapshot')
        .eq('reference_id', stockTake.id)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      const { error: takeError } = await supabase
        .from('stock_takes')
        .update({ baseline_sync_status: 'SYNCING', baseline_sync_message: 'Retry queued to read live Sage RM stock.' })
        .eq('id', stockTake.id);
      if (takeError) throw takeError;

      const { error: eventError } = await supabase
        .from('sync_log')
        .insert({
          event_type: 'stock_take_sage_snapshot',
          reference_id: stockTake.id,
          reference_type: 'stock_take',
          status: 'pending',
          message: 'Retry queued to read live Sage RM stock for stock take.',
          details: previousEvent?.details || { requestedBy: profile?.id, warehouse: 'RM' },
        });
      if (eventError) throw eventError;

      toast.success('Live Sage snapshot retry queued. This page will update automatically.');
      await fetchStockTake();
    } catch (error: any) {
      toast.error(`Could not retry the Sage snapshot: ${error.message}`);
    } finally {
      setSaving(false);
    }
  };

  const handleLockLine = async (lineId: string, lock: boolean) => {
    try {
      const { error } = await supabase
        .from('stock_take_lines')
        .update({ is_locked: lock })
        .eq('id', lineId);

      if (error) throw error;

      await supabase.from('stock_take_audit_log').insert({
        stock_take_id: id,
        line_id: lineId,
        action: lock ? 'line_locked' : 'line_unlocked',
        changed_by: profile?.id
      });

      await fetchLines();
      toast.success(lock ? 'Line locked' : 'Line unlocked');
    } catch (error: any) {
      console.error('Error locking line:', error);
      toast.error(`Failed to ${lock ? 'lock' : 'unlock'} line: ${error.message}`);
    }
  };

  const handleAssignUser = async (lineId: string, userId: string | null) => {
    try {
      const { error } = await supabase
        .from('stock_take_lines')
        .update({ assigned_to: userId })
        .eq('id', lineId);

      if (error) throw error;

      await supabase.from('stock_take_audit_log').insert({
        stock_take_id: id,
        line_id: lineId,
        action: userId ? 'user_assigned' : 'assignment_cleared',
        changed_by: profile?.id,
        notes: userId ? `Assigned to user ${userId}` : 'Assignment cleared'
      });

      await fetchLines();
      toast.success(userId ? 'User assigned' : 'Assignment cleared');
    } catch (error: any) {
      console.error('Error assigning user:', error);
      toast.error(`Failed to assign user: ${error.message}`);
    }
  };

  const handleAutoAssign = async () => {
    if (users.length === 0) {
      toast.error('No users available for assignment');
      return;
    }

    try {
      const unassignedLines = lines.filter(l => !l.assigned_to);
      if (unassignedLines.length === 0) {
        toast.error('All lines are already assigned');
        return;
      }

      // Round-robin assignment
      const updates = unassignedLines.map((line, index) => ({
        id: line.id,
        assigned_to: users[index % users.length].id
      }));

      for (const update of updates) {
        await supabase
          .from('stock_take_lines')
          .update({ assigned_to: update.assigned_to })
          .eq('id', update.id);

        await supabase.from('stock_take_audit_log').insert({
          stock_take_id: id,
          line_id: update.id,
          action: 'auto_assigned',
          changed_by: profile?.id,
          notes: `Auto-assigned to user ${update.assigned_to}`
        });
      }

      await fetchLines();
      toast.success(`Auto-assigned ${unassignedLines.length} lines to ${users.length} users`);
    } catch (error: any) {
      console.error('Error auto-assigning:', error);
      toast.error(`Failed to auto-assign: ${error.message}`);
    }
  };

  const handleExportPDF = () => {
    if (!stockTake) return;

    const doc = new jsPDF();
    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();
    let yPos = 20;
    let pageNum = 1;

    // Helper to add new page
    const addNewPage = () => {
      doc.addPage();
      pageNum++;
      yPos = 20;
      addHeader();
      addFooter();
    };

    // Header
    const addHeader = () => {
      doc.setFontSize(16);
      doc.setFont('helvetica', 'bold');
      doc.text('Hyperfeeds Animal Nutrition', pageWidth / 2, yPos, { align: 'center' });
      yPos += 7;
      doc.setFontSize(12);
      doc.text(`Stock Take ${stockTake.take_number}`, pageWidth / 2, yPos, { align: 'center' });
      yPos += 5;
      doc.setFontSize(10);
      doc.setFont('helvetica', 'normal');
      doc.text(format(new Date(), 'PPP'), pageWidth / 2, yPos, { align: 'center' });
      yPos += 10;
    };

    // Footer
    const addFooter = () => {
      doc.setFontSize(8);
      doc.text(`Page ${pageNum}`, pageWidth / 2, pageHeight - 10, { align: 'center' });
      doc.text(`Prepared by ${profile?.full_name || 'Unknown'} | ${format(new Date(), 'PPp')}`, 14, pageHeight - 10);
    };

    addHeader();
    addFooter();

    // Group lines by assigned user
    const grouped: Record<string, StockTakeLine[]> = {};
    lines.forEach(line => {
      const key = line.assigned_to_profile?.full_name || 'Unassigned';
      if (!grouped[key]) grouped[key] = [];
      grouped[key].push(line);
    });

    // Table header
    const drawTableHeader = () => {
      doc.setFontSize(8);
      doc.setFont('helvetica', 'bold');
      const headers = ['#', 'Code', 'Description', 'Unit', stockTake.blind_mode ? '' : 'System Qty', 'Counted Qty', 'Variance', 'Signature'];
      const colWidths = [10, 25, 60, 15, stockTake.blind_mode ? 0 : 20, 20, 20, 25];
      let xPos = 14;
      headers.forEach((header, i) => {
        if (colWidths[i] > 0) {
          doc.text(header, xPos, yPos);
          xPos += colWidths[i];
        }
      });
      yPos += 5;
      doc.setFont('helvetica', 'normal');
    };

    Object.entries(grouped).forEach(([counter, counterLines]) => {
      // Counter section header
      if (yPos > pageHeight - 40) addNewPage();
      doc.setFontSize(10);
      doc.setFont('helvetica', 'bold');
      doc.text(`${counter} (${counterLines.length} items)`, 14, yPos);
      yPos += 7;
      doc.setFont('helvetica', 'normal');

      drawTableHeader();

      counterLines.forEach((line, idx) => {
        if (yPos > pageHeight - 20) {
          addNewPage();
          drawTableHeader();
        }

        doc.setFontSize(7);
        const rowData = [
          `${idx + 1}`,
          line.raw_materials?.code || '',
          (line.raw_materials?.name || '').substring(0, 35),
          line.unit,
          stockTake.blind_mode ? '' : line.system_qty.toFixed(2),
          '', // Blank for paper entry
          '',
          ''
        ];
        const colWidths = [10, 25, 60, 15, stockTake.blind_mode ? 0 : 20, 20, 20, 25];
        let xPos = 14;
        rowData.forEach((data, i) => {
          if (colWidths[i] > 0) {
            doc.text(data, xPos, yPos);
            xPos += colWidths[i];
          }
        });
        yPos += 5;
      });

      yPos += 5;
    });

    // Total items on last page
    if (yPos > pageHeight - 30) addNewPage();
    doc.setFontSize(10);
    doc.setFont('helvetica', 'bold');
    doc.text(`Total Items: ${lines.length}`, 14, yPos);

    doc.save(`StockTake-${stockTake.take_number}-${format(new Date(), 'yyyy-MM-dd')}.pdf`);
    toast.success('PDF exported successfully');
  };

  const handleExportExcel = async () => {
    if (!stockTake) return;

    // Fetch fresh audit log if not already loaded
    if (auditLog.length === 0) {
      await fetchAuditLog();
    }

    // Sheet 1: Count Lines
    const linesData = lines.map(line => ({
      'Code': line.raw_materials?.code || '',
      'Description': line.raw_materials?.name || '',
      'Unit': line.unit,
      'System Qty': line.system_qty,
      'Counted Qty': line.counted_qty ?? '',
      'Recount Qty': line.recount_qty ?? '',
      'Variance': line.variance,
      'Var %': line.system_qty > 0 ? ((line.variance / line.system_qty) * 100).toFixed(2) : '',
      'Status': getLineStatus(line),
      'Assigned To': line.assigned_to_profile?.full_name || '',
      'Counted By': line.counted_by_profile?.full_name || '',
      'Counted At': line.counted_at ? format(new Date(line.counted_at), 'PPp') : '',
      'Notes': line.notes || ''
    }));

    const ws1 = XLSX.utils.json_to_sheet(linesData);
    
    // Apply styling to variance column (red if negative, amber if positive)
    const range = XLSX.utils.decode_range(ws1['!ref'] || 'A1');
    for (let R = range.s.r + 1; R <= range.e.r; ++R) {
      const varianceCell = XLSX.utils.encode_cell({ r: R, c: 6 }); // Variance column
      if (ws1[varianceCell]) {
        const val = parseFloat(ws1[varianceCell].v);
        if (val < 0) {
          ws1[varianceCell].s = { fill: { fgColor: { rgb: 'FFCCCC' } } };
        } else if (val > 0) {
          ws1[varianceCell].s = { fill: { fgColor: { rgb: 'FFFFCC' } } };
        }
      }
    }

    // Sheet 2: Audit Log
    const auditData = auditLog.map(entry => ({
      'Time': format(new Date(entry.changed_at), 'PPp'),
      'Raw Material Code': entry.line?.raw_materials?.code || '',
      'Raw Material Name': entry.line?.raw_materials?.name || '',
      'Action': entry.action.replace(/_/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase()),
      'Old Value': entry.old_value ?? '',
      'New Value': entry.new_value ?? '',
      'Changed By': entry.changed_by_profile?.full_name || '',
      'Notes': entry.notes || ''
    }));

    const ws2 = XLSX.utils.json_to_sheet(auditData);

    // Sheet 3: Summary
    const summaryData = [{
      'Take Number': stockTake.take_number,
      'Status': stockTake.status,
      'Started By': stockTake.started_by_profile?.full_name || '',
      'Started At': format(new Date(stockTake.started_at), 'PPp'),
      'Closed By': stockTake.closed_by_profile?.full_name || '',
      'Closed At': stockTake.closed_at ? format(new Date(stockTake.closed_at), 'PPp') : '',
      'Total Lines': lines.length,
      'Counted': countedLines,
      'Pending': pendingLines,
      'Total Variance (kg)': totalVariance.toFixed(2)
    }];

    const ws3 = XLSX.utils.json_to_sheet(summaryData);

    // Create workbook
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws1, 'Count Lines');
    XLSX.utils.book_append_sheet(wb, ws2, 'Audit Log');
    XLSX.utils.book_append_sheet(wb, ws3, 'Summary');

    // Auto-size columns
    const wscols = [
      { wch: 12 }, { wch: 35 }, { wch: 8 }, { wch: 12 }, { wch: 12 }, 
      { wch: 12 }, { wch: 10 }, { wch: 8 }, { wch: 15 }, { wch: 20 }, 
      { wch: 20 }, { wch: 20 }, { wch: 30 }
    ];
    ws1['!cols'] = wscols;
    ws2['!cols'] = wscols;
    ws3['!cols'] = wscols;

    XLSX.writeFile(wb, `StockTake-${stockTake.take_number}-${format(new Date(), 'yyyy-MM-dd')}.xlsx`);
    toast.success('Excel exported successfully');
  };

  const handleFreezeStock = async () => {
    if (!stockTake) return;
    if (!hasReadySageSnapshot) {
      toast.error('Wait for the live Sage SDK snapshot before freezing this stock take.');
      return;
    }
    setSaving(true);
    try {
      const { error } = await supabase
        .from('stock_takes')
        .update({ 
          status: 'FROZEN',
          frozen_by: profile?.id,
          frozen_at: new Date().toISOString()
        })
        .eq('id', stockTake.id);

      if (error) throw error;

      toast.success('Stock take frozen — please pause receipts and issues');
      setShowFreezeModal(false);
      await fetchStockTake();
    } catch (error: any) {
      console.error('Error freezing stock take:', error);
      toast.error(`Failed to freeze stock take: ${error.message}`);
    } finally {
      setSaving(false);
    }
  };

  const handleReopenStock = async () => {
    if (!stockTake) return;
    setSaving(true);
    try {
      const { error } = await supabase
        .from('stock_takes')
        .update({ 
          status: 'OPEN',
          frozen_by: null,
          frozen_at: null
        })
        .eq('id', stockTake.id);

      if (error) throw error;

      toast.success('Stock take reopened');
      await fetchStockTake();
    } catch (error: any) {
      console.error('Error reopening stock take:', error);
      toast.error(`Failed to reopen stock take: ${error.message}`);
    } finally {
      setSaving(false);
    }
  };

  const handleCloseStock = async () => {
    if (!stockTake) return;
    if (!hasReadySageSnapshot) {
      toast.error('This stock take has no ready Sage SDK snapshot.');
      return;
    }

    const uncountedLines = lines.filter(l => l.counted_qty === null);
    if (uncountedLines.length > 0) {
      toast.error(`Cannot close — ${uncountedLines.length} item(s) have not been counted.`);
      return;
    }

    const unresolvedRecounts = lines.filter(l => l.needs_recount);
    if (unresolvedRecounts.length > 0) {
      toast.error(`Cannot close — ${unresolvedRecounts.length} line(s) still require recount review.`);
      return;
    }

    const unapprovedVariances = lines.filter(l => l.counted_qty !== null && l.variance !== 0 && !l.approved_by);
    if (unapprovedVariances.length > 0) {
      toast.error(`Cannot close — ${unapprovedVariances.length} variance line(s) still require Finance approval.`);
      return;
    }

    setSaving(true);
    try {
      const { error } = await supabase.rpc('finalize_stock_take', {
        p_stock_take_id: stockTake.id,
      });

      if (error) throw error;

      toast.success(`Stock take ${stockTake.take_number} closed. Sage stock was not adjusted automatically.`);
      setShowCloseModal(false);
      navigate('/stock-take');
    } catch (error: any) {
      console.error('Error closing stock take:', error);
      toast.error(`Failed to close stock take: ${error.message}`);
    } finally {
      setSaving(false);
    }
  };

  const getLineStatus = (line: StockTakeLine): string => {
    if (line.approved_by) return 'APPROVED';
    if (line.is_locked) return 'LOCKED';
    if (line.needs_recount) return 'NEEDS_RECOUNT';
    if (line.counted_qty !== null) return 'COUNTED';
    return 'PENDING';
  };

  const getLineStatusBadge = (status: string) => {
    const statusMap: Record<string, string> = {
      'PENDING': 'pending',
      'COUNTED': 'confirmed',
      'NEEDS_RECOUNT': 'conditional',
      'APPROVED': 'approved',
      'LOCKED': 'archived'
    };
    return <StatusBadge status={statusMap[status] || status.toLowerCase()} />;
  };

  const getFilteredLines = () => {
    switch (filter) {
      case 'zero':
        return lines.filter(l => l.variance === 0);
      case 'low':
        return lines.filter(l => l.counted_qty !== null && Math.abs(l.variance / l.system_qty) > 0 && Math.abs(l.variance / l.system_qty) <= 0.05);
      case 'high':
        return lines.filter(l => l.counted_qty !== null && Math.abs(l.variance / l.system_qty) > 0.05);
      case 'pending':
        return lines.filter(l => l.counted_qty === null);
      default:
        return lines;
    }
  };

  const canManage = ['admin', 'md', 'warehouse_manager', 'raw_material_manager'].includes(profile?.role || '');
  const canApproveVariance = ['admin', 'md', 'finance', 'accountant'].includes(profile?.role || '');
  const hasReadySageSnapshot = stockTake?.baseline_source === 'sage_sdk' && stockTake?.baseline_sync_status === 'READY' && Boolean(stockTake?.baseline_snapshot_at);
  const canEdit = hasReadySageSnapshot && (stockTake?.status === 'OPEN' || stockTake?.status === 'FROZEN');
  const showSystemQty = canManage || !stockTake?.blind_mode || stockTake?.status === 'CLOSED';

  const countedLines = lines.filter(l => l.counted_qty !== null).length;
  const pendingLines = lines.filter(l => l.counted_qty === null).length;
  const recountLines = lines.filter(l => l.needs_recount).length;
  const approvedLines = lines.filter(l => l.approved_by).length;
  const totalVariance = lines.reduce((sum, l) => sum + (l.variance || 0), 0);
  const progressPercent = lines.length > 0 ? Math.round((countedLines / lines.length) * 100) : 0;
  const varianceReviewLines = lines.filter(line =>
    line.counted_qty !== null && (line.needs_recount || (line.variance !== 0 && !line.approved_by))
  );
  const readyToClose = pendingLines === 0 && recountLines === 0 && varianceReviewLines.length === 0;
  const remainingControlItems = pendingLines + varianceReviewLines.length;

  // ---- Reporting & Analytics computed stats ----
  const countedLinesData = lines.filter(l => l.counted_qty !== null);
  const zeroVariance = countedLinesData.filter(l => l.variance === 0).length;
  const positiveVariance = countedLinesData.filter(l => l.variance > 0).length;
  const negativeVariance = countedLinesData.filter(l => l.variance < 0).length;
  const criticalVariance = countedLinesData.filter(l => l.system_qty > 0 && Math.abs(l.variance / l.system_qty) > 0.10).length;
  const highVarianceCount = countedLinesData.filter(l => l.system_qty > 0 && Math.abs(l.variance / l.system_qty) > 0.05 && Math.abs(l.variance / l.system_qty) <= 0.10).length;
  const lowVarianceCount = countedLinesData.filter(l => l.system_qty > 0 && Math.abs(l.variance / l.system_qty) > 0 && Math.abs(l.variance / l.system_qty) <= 0.05).length;
  const absTotalVariance = countedLinesData.reduce((sum, l) => sum + Math.abs(l.variance || 0), 0);
  const avgVariance = countedLinesData.length > 0 ? absTotalVariance / countedLinesData.length : 0;

  // Top 10 variances for bar chart
  const topVariances = [...countedLinesData]
    .sort((a, b) => Math.abs(b.variance) - Math.abs(a.variance))
    .slice(0, 10)
    .map(l => ({
      code: l.raw_materials?.code || 'Unknown',
      name: l.raw_materials?.name || 'Unknown',
      variance: l.variance,
      absVariance: Math.abs(l.variance),
      systemQty: l.system_qty,
    }));

  // Variance distribution for pie chart
  const varianceDistribution = [
    { name: 'Zero Variance', value: zeroVariance, color: '#10b981' },
    { name: 'Low (0-5%)', value: lowVarianceCount, color: '#3b82f6' },
    { name: 'High (5-10%)', value: highVarianceCount, color: '#f59e0b' },
    { name: 'Critical (>10%)', value: criticalVariance, color: '#ef4444' },
    { name: 'Not Counted', value: pendingLines, color: '#9ca3af' },
  ].filter(d => d.value > 0);

  // Counting by user
  const countingByUser = countedLinesData.reduce<Record<string, { name: string; count: number; lines: number }>>((acc, l) => {
    const name = l.counted_by_profile?.full_name || 'Unknown';
    if (!acc[name]) acc[name] = { name, count: 0, lines: 0 };
    acc[name].count += Math.abs(l.variance || 0);
    acc[name].lines += 1;
    return acc;
  }, {});
  const userStats = Object.values(countingByUser).sort((a, b) => b.lines - a.lines).slice(0, 8);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-indigo-600" />
      </div>
    );
  }

  if (!stockTake) {
    return (
      <div className="text-center py-12">
        <AlertTriangle className="h-12 w-12 text-gray-400 mx-auto mb-3" />
        <p className="text-gray-500">Stock take not found</p>
        <button
          onClick={() => navigate('/stock-take')}
          className="mt-4 px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700"
        >
          Back to Stock Takes
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-5 pb-8">
      {/* Header */}
      <section className="overflow-hidden rounded-xl bg-[#0B0B34] shadow-lg">
        <div className="flex flex-col gap-5 px-5 py-5 lg:flex-row lg:items-center lg:justify-between lg:px-7">
          <div className="flex min-w-0 items-start gap-4">
          <button
            onClick={() => navigate('/stock-take')}
            className="mt-0.5 rounded-lg border border-white/15 bg-white/10 p-2 text-white transition-colors hover:bg-white/20"
            title="Back to Stock Takes"
          >
            <ArrowLeft className="h-5 w-5" />
          </button>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-full border border-orange-300/40 bg-orange-400/15 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide text-orange-200">Inventory Control</span>
              <span className="text-xs text-white/55">Physical count and variance review</span>
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-3">
              <h1 className="font-mono text-2xl font-bold text-white">{stockTake.take_number}</h1>
              <StatusBadge status={stockTake.status.toLowerCase()} className={stockTake.status === 'FROZEN' ? 'animate-pulse' : ''} />
              {stockTake.blind_mode && (
                <div className="flex items-center rounded-md border border-amber-300/30 bg-amber-300/10 px-2 py-1 text-xs text-amber-100">
                  <EyeOff className="mr-1 h-4 w-4" />
                  Blind Mode
                </div>
              )}
            </div>
            <p className="mt-2 text-sm text-white/65">
              Started by {stockTake.started_by_profile?.full_name} on {format(new Date(stockTake.started_at), 'PPp')}
            </p>
            {stockTake.notes && (
              <p className="mt-1 text-sm italic text-white/50">"{stockTake.notes}"</p>
            )}
          </div>
          </div>

        <div className="flex flex-wrap items-center gap-2">
          {stockTake.status === 'OPEN' && canManage && hasReadySageSnapshot && (
            <>
              <button
                onClick={() => setShowFreezeModal(true)}
                className="flex items-center gap-2 rounded-lg bg-orange-500 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-orange-600"
              >
                <Lock className="h-4 w-4" />
                <span>Freeze Stock</span>
              </button>
              <button
                onClick={() => navigate('/stock-take')}
                className="rounded-lg border border-white/20 px-4 py-2.5 text-sm font-semibold text-white/85 transition-colors hover:bg-white/10"
              >
                Back to Stock Takes
              </button>
            </>
          )}
          {stockTake.status === 'FROZEN' && canManage && hasReadySageSnapshot && (
            <>
              <button
                onClick={handleReopenStock}
                className="flex items-center gap-2 rounded-lg border border-white/20 px-4 py-2.5 text-sm font-semibold text-white/85 transition-colors hover:bg-white/10"
              >
                <Unlock className="h-4 w-4" />
                <span>Reopen</span>
              </button>
              <button
                onClick={() => setShowCloseModal(true)}
                className="flex items-center gap-2 rounded-lg bg-emerald-500 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-emerald-600"
              >
                <CheckCircle className="h-4 w-4" />
                <span>Close Stock Take</span>
              </button>
            </>
          )}
          <button 
            onClick={handleExportPDF}
            className="flex items-center gap-2 rounded-lg border border-white/20 px-3 py-2.5 text-sm font-medium text-white/85 transition-colors hover:bg-white/10"
          >
            <Download className="h-4 w-4" />
            <span>Export PDF</span>
          </button>
          <button 
            onClick={handleExportExcel}
            className="flex items-center gap-2 rounded-lg border border-white/20 px-3 py-2.5 text-sm font-medium text-white/85 transition-colors hover:bg-white/10"
          >
            <FileSpreadsheet className="h-4 w-4" />
            <span>Export Excel</span>
          </button>
        </div>
        </div>
      </section>

      {!hasReadySageSnapshot && stockTake.status !== 'CLOSED' && (
        <section className={`flex flex-col gap-4 rounded-xl border px-5 py-4 shadow-sm sm:flex-row sm:items-center sm:justify-between ${
          stockTake.baseline_sync_status === 'FAILED'
            ? 'border-red-200 bg-red-50'
            : 'border-cyan-200 bg-cyan-50'
        }`}>
          <div className="flex items-start gap-3">
            <div className={`mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${stockTake.baseline_sync_status === 'FAILED' ? 'bg-red-100 text-red-700' : 'bg-cyan-100 text-cyan-700'}`}>
              {stockTake.baseline_sync_status === 'FAILED' ? <AlertTriangle className="h-5 w-5" /> : <Loader2 className="h-5 w-5 animate-spin" />}
            </div>
            <div>
              <p className={`text-sm font-bold ${stockTake.baseline_sync_status === 'FAILED' ? 'text-red-900' : 'text-cyan-900'}`}>
                {stockTake.baseline_sync_status === 'FAILED' ? 'Live Sage snapshot failed' : 'Reading live Sage RM stock'}
              </p>
              <p className="mt-1 text-sm text-slate-600">{stockTake.baseline_sync_message || 'The bridge is preparing the count baseline from Sage.'}</p>
              <p className="mt-1 text-xs font-medium text-slate-500">Counting, freezing, and closing remain unavailable until a complete Sage SDK snapshot is ready.</p>
            </div>
          </div>
          {stockTake.baseline_sync_status === 'FAILED' && canManage && (
            <button
              onClick={handleRetrySageSnapshot}
              disabled={saving}
              className="inline-flex shrink-0 items-center justify-center gap-2 rounded-lg bg-red-600 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-60"
            >
              <RefreshCw className={`h-4 w-4 ${saving ? 'animate-spin' : ''}`} /> Retry live Sage snapshot
            </button>
          )}
        </section>
      )}

      {/* Control state */}
      <section className="grid gap-px overflow-hidden rounded-xl border border-slate-200 bg-slate-200 shadow-sm lg:grid-cols-[1.4fr_1fr]">
        <div className="bg-white px-5 py-4">
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Count Progress</p>
              <p className="mt-1 text-sm font-medium text-slate-800">{countedLines} of {lines.length} lines counted</p>
            </div>
            <span className="font-mono text-xl font-bold text-[#0B0B34]">{progressPercent}%</span>
          </div>
          <div className="mt-3 h-2 overflow-hidden rounded-full bg-slate-100">
            <div className="h-full rounded-full bg-teal-500 transition-all duration-300" style={{ width: `${progressPercent}%` }} />
          </div>
        </div>
        <div className={readyToClose ? 'bg-emerald-50 px-5 py-4' : 'bg-amber-50 px-5 py-4'}>
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Closure Readiness</p>
          <p className={readyToClose ? 'mt-1 text-sm font-semibold text-emerald-800' : 'mt-1 text-sm font-semibold text-amber-800'}>
            {readyToClose ? 'Ready for controlled close' : `${remainingControlItems} control item(s) remain`}
          </p>
          <p className="mt-1 text-xs text-slate-600">{readyToClose ? 'All counts and variance reviews are complete.' : 'Complete counts, recounts, and Finance reviews before closing.'}</p>
        </div>
      </section>

      {/* Professional Summary Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4">
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-xs font-medium text-slate-500 uppercase tracking-wide">Total Lines</p>
              <p className="text-2xl font-bold text-slate-800 mt-1">{lines.length}</p>
              <p className="text-xs text-slate-400 mt-1">raw materials</p>
            </div>
            <div className="p-2 bg-slate-100 rounded-lg"><Package className="w-5 h-5 text-slate-600" /></div>
          </div>
        </div>
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-xs font-medium text-slate-500 uppercase tracking-wide">Counted</p>
              <p className="text-2xl font-bold text-blue-600 mt-1">{countedLines}</p>
              <p className="text-xs text-slate-400 mt-1">{progressPercent}% complete</p>
            </div>
            <div className="p-2 bg-blue-50 rounded-lg"><CheckCircle2 className="w-5 h-5 text-blue-600" /></div>
          </div>
        </div>
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-xs font-medium text-slate-500 uppercase tracking-wide">Pending</p>
              <p className="text-2xl font-bold text-slate-600 mt-1">{pendingLines}</p>
              <p className="text-xs text-slate-400 mt-1">not yet counted</p>
            </div>
            <div className="p-2 bg-slate-100 rounded-lg"><Clock className="w-5 h-5 text-slate-500" /></div>
          </div>
        </div>
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-xs font-medium text-slate-500 uppercase tracking-wide">Needs Recount</p>
              <p className="text-2xl font-bold text-amber-600 mt-1">{recountLines}</p>
              <p className="text-xs text-slate-400 mt-1">flagged items</p>
            </div>
            <div className="p-2 bg-amber-50 rounded-lg"><Flag className="w-5 h-5 text-amber-600" /></div>
          </div>
        </div>
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-xs font-medium text-slate-500 uppercase tracking-wide">Approved</p>
              <p className="text-2xl font-bold text-emerald-600 mt-1">{approvedLines}</p>
              <p className="text-xs text-slate-400 mt-1">high variance ok</p>
            </div>
            <div className="p-2 bg-emerald-50 rounded-lg"><ThumbsUp className="w-5 h-5 text-emerald-600" /></div>
          </div>
        </div>
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-xs font-medium text-slate-500 uppercase tracking-wide">Total Variance</p>
              <p className={`text-2xl font-bold mt-1 ${
                totalVariance === 0 ? 'text-emerald-600' :
                totalVariance > 0 ? 'text-amber-600' : 'text-red-600'
              }`}>
                {totalVariance > 0 ? '+' : ''}{totalVariance.toFixed(2)} <span className="text-sm">kg</span>
              </p>
              <p className="text-xs text-slate-400 mt-1">
                {positiveVariance > 0 && `${positiveVariance} up`}
                {positiveVariance > 0 && negativeVariance > 0 && ' / '}
                {negativeVariance > 0 && `${negativeVariance} down`}
                {positiveVariance === 0 && negativeVariance === 0 && 'all matching'}
              </p>
            </div>
            <div className={`p-2 rounded-lg ${
              totalVariance === 0 ? 'bg-emerald-50' :
              totalVariance > 0 ? 'bg-amber-50' : 'bg-red-50'
            }`}>
              <Activity className={`w-5 h-5 ${
                totalVariance === 0 ? 'text-emerald-600' :
                totalVariance > 0 ? 'text-amber-600' : 'text-red-600'
              }`} />
            </div>
          </div>
        </div>
      </div>

      {/* Variance review desk */}
      <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="flex flex-col gap-4 border-b border-slate-100 px-5 py-4 md:flex-row md:items-center md:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Variance Review Desk</p>
            <h2 className="mt-1 text-lg font-bold text-[#0B0B34]">Resolve exceptions before stock is closed</h2>
          </div>
          <span className={readyToClose ? 'w-fit rounded-full bg-emerald-50 px-3 py-1.5 text-xs font-semibold text-emerald-700' : 'w-fit rounded-full bg-orange-50 px-3 py-1.5 text-xs font-semibold text-orange-700'}>
            {readyToClose ? 'No outstanding exceptions' : `${varianceReviewLines.length} line(s) in review`}
          </span>
        </div>
        <div className="grid divide-y divide-slate-100 md:grid-cols-3 md:divide-x md:divide-y-0">
          <div className="px-5 py-4">
            <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Recounts Required</p>
            <p className="mt-1 font-mono text-2xl font-bold text-orange-600">{recountLines}</p>
            <p className="mt-1 text-xs text-slate-500">A second physical count is needed.</p>
          </div>
          <div className="px-5 py-4">
            <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Finance Reviews</p>
            <p className="mt-1 font-mono text-2xl font-bold text-rose-600">{lines.filter(line => line.counted_qty !== null && line.variance !== 0 && !line.approved_by && !line.needs_recount).length}</p>
            <p className="mt-1 text-xs text-slate-500">Written reason and approval required.</p>
          </div>
          <div className="px-5 py-4">
            <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Approved Variances</p>
            <p className="mt-1 font-mono text-2xl font-bold text-emerald-600">{approvedLines}</p>
            <p className="mt-1 text-xs text-slate-500">Locked with reviewer audit history.</p>
          </div>
        </div>
      </section>

      {/* ---- Reports & Analytics Section ---- */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-200 flex items-center gap-2.5">
          <BarChart3 className="w-5 h-5 text-slate-600" />
          <h2 className="text-lg font-bold text-slate-800">Stock Take Analytics</h2>
          <span className="text-xs text-slate-400 ml-auto">{stockTake.take_number}</span>
        </div>

        <div className="p-6 space-y-6">
          {/* Variance Magnitude Breakdown Cards */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <div className="rounded-lg border border-red-200 bg-red-50/40 p-4">
              <div className="flex items-center gap-2 mb-2">
                <XCircle className="w-4 h-4 text-red-600" />
                <span className="text-xs font-semibold text-red-700 uppercase tracking-wide">Critical Variance</span>
              </div>
              <p className="text-2xl font-bold text-red-700">{criticalVariance}</p>
              <p className="text-xs text-red-600 mt-1">items &gt;10% deviation</p>
            </div>
            <div className="rounded-lg border border-amber-200 bg-amber-50/40 p-4">
              <div className="flex items-center gap-2 mb-2">
                <AlertTriangle className="w-4 h-4 text-amber-600" />
                <span className="text-xs font-semibold text-amber-700 uppercase tracking-wide">High Variance</span>
              </div>
              <p className="text-2xl font-bold text-amber-700">{highVarianceCount}</p>
              <p className="text-xs text-amber-600 mt-1">items 5-10% deviation</p>
            </div>
            <div className="rounded-lg border border-blue-200 bg-blue-50/40 p-4">
              <div className="flex items-center gap-2 mb-2">
                <TrendingUp className="w-4 h-4 text-blue-600" />
                <span className="text-xs font-semibold text-blue-700 uppercase tracking-wide">Low Variance</span>
              </div>
              <p className="text-2xl font-bold text-blue-700">{lowVarianceCount}</p>
              <p className="text-xs text-blue-600 mt-1">items 0-5% deviation</p>
            </div>
            <div className="rounded-lg border border-emerald-200 bg-emerald-50/40 p-4">
              <div className="flex items-center gap-2 mb-2">
                <CheckCircle className="w-4 h-4 text-emerald-600" />
                <span className="text-xs font-semibold text-emerald-700 uppercase tracking-wide">Zero Variance</span>
              </div>
              <p className="text-2xl font-bold text-emerald-700">{zeroVariance}</p>
              <p className="text-xs text-emerald-600 mt-1">perfectly matching</p>
            </div>
          </div>

          {/* Summary Metrics Row */}
          <div className="grid grid-cols-3 gap-4">
            <div className="bg-slate-50 rounded-lg p-4 border border-slate-200">
              <p className="text-xs font-medium text-slate-500 uppercase">Absolute Total Variance</p>
              <p className="text-xl font-bold text-slate-800 mt-1">{absTotalVariance.toFixed(2)} kg</p>
              <p className="text-xs text-slate-400">sum of all absolute variances</p>
            </div>
            <div className="bg-slate-50 rounded-lg p-4 border border-slate-200">
              <p className="text-xs font-medium text-slate-500 uppercase">Average Variance per Line</p>
              <p className="text-xl font-bold text-slate-800 mt-1">{avgVariance.toFixed(2)} kg</p>
              <p className="text-xs text-slate-400">across {countedLinesData.length} counted items</p>
            </div>
            <div className="bg-slate-50 rounded-lg p-4 border border-slate-200">
              <p className="text-xs font-medium text-slate-500 uppercase">Net Variance Direction</p>
              <div className="flex items-center gap-2 mt-1">
                {totalVariance > 0 ? (
                  <>
                    <TrendingUp className="w-5 h-5 text-amber-600" />
                    <span className="text-xl font-bold text-amber-600">Over-counted</span>
                  </>
                ) : totalVariance < 0 ? (
                  <>
                    <TrendingDown className="w-5 h-5 text-red-600" />
                    <span className="text-xl font-bold text-red-600">Under-counted</span>
                  </>
                ) : (
                  <>
                    <Minus className="w-5 h-5 text-emerald-600" />
                    <span className="text-xl font-bold text-emerald-600">Balanced</span>
                  </>
                )}
              </div>
              <p className="text-xs text-slate-400">
                {positiveVariance} up / {negativeVariance} down
              </p>
            </div>
          </div>

          {/* Charts Row */}
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
            {/* Variance Distribution Pie Chart */}
            <div className="bg-white rounded-lg border border-slate-100 p-4">
              <h3 className="text-sm font-semibold text-slate-800 mb-4 flex items-center gap-2">
                <PieChart className="w-4 h-4 text-slate-500" />
                Variance Distribution
              </h3>
              {varianceDistribution.length > 0 ? (
                <ResponsiveContainer width="100%" height={260}>
                  <RePieChart>
                    <Pie
                      data={varianceDistribution}
                      cx="50%"
                      cy="50%"
                      innerRadius={60}
                      outerRadius={90}
                      paddingAngle={3}
                      dataKey="value"
                      label={({ value }) => `${value}`}
                      labelLine={false}
                    >
                      {varianceDistribution.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={entry.color} />
                      ))}
                    </Pie>
                    <Tooltip contentStyle={{ borderRadius: '8px', border: '1px solid #e2e8f0', fontSize: '13px' }} />
                    <Legend verticalAlign="bottom" height={36} iconType="circle" />
                  </RePieChart>
                </ResponsiveContainer>
              ) : (
                <div className="h-[260px] flex items-center justify-center text-sm text-slate-400">No data yet</div>
              )}
            </div>

            {/* Top 10 Variances Bar Chart */}
            <div className="bg-white rounded-lg border border-slate-100 p-4">
              <h3 className="text-sm font-semibold text-slate-800 mb-4 flex items-center gap-2">
                <TrendingUp className="w-4 h-4 text-slate-500" />
                Top 10 Largest Variances (kg)
              </h3>
              {topVariances.length > 0 ? (
                <ResponsiveContainer width="100%" height={260}>
                  <BarChart data={topVariances} layout="vertical" margin={{ left: 40, right: 20 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" horizontal={false} />
                    <XAxis type="number" tick={{ fontSize: 11 }} />
                    <YAxis dataKey="code" type="category" width={70} tick={{ fontSize: 11 }} />
                    <Tooltip contentStyle={{ borderRadius: '8px', border: '1px solid #e2e8f0', fontSize: '13px' }} />
                    <Bar dataKey="variance" radius={[0, 4, 4, 0]}>
                      {topVariances.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={entry.variance > 0 ? '#f59e0b' : '#ef4444'} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <div className="h-[260px] flex items-center justify-center text-sm text-slate-400">No variances recorded yet</div>
              )}
            </div>
          </div>

          {/* Counting Activity by User */}
          {userStats.length > 0 && (
            <div className="rounded-lg border border-slate-200 p-4">
              <h3 className="text-sm font-semibold text-slate-800 mb-3 flex items-center gap-2">
                <Users className="w-4 h-4 text-slate-500" />
                Counting Activity by User
              </h3>
              <div className="overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-100">
                      <th className="text-left py-2 px-3 text-xs font-medium text-slate-500 uppercase">Counter</th>
                      <th className="text-right py-2 px-3 text-xs font-medium text-slate-500 uppercase">Lines Counted</th>
                      <th className="text-right py-2 px-3 text-xs font-medium text-slate-500 uppercase">Total Absolute Variance</th>
                      <th className="text-right py-2 px-3 text-xs font-medium text-slate-500 uppercase">Avg Variance / Line</th>
                    </tr>
                  </thead>
                  <tbody>
                    {userStats.map((u) => (
                      <tr key={u.name} className="border-b border-slate-50 last:border-0">
                        <td className="py-2 px-3 font-medium text-slate-700">{u.name}</td>
                        <td className="py-2 px-3 text-right text-slate-600">{u.lines}</td>
                        <td className="py-2 px-3 text-right text-slate-600">{u.count.toFixed(2)} kg</td>
                        <td className="py-2 px-3 text-right text-slate-600">{u.lines > 0 ? (u.count / u.lines).toFixed(2) : '0.00'} kg</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Top Variances Detail Table */}
          {topVariances.length > 0 && (
            <div className="rounded-lg border border-slate-200 p-4">
              <h3 className="text-sm font-semibold text-slate-800 mb-3 flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-slate-500" />
                Top 10 Variance Details
              </h3>
              <div className="overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-100">
                      <th className="text-left py-2 px-3 text-xs font-medium text-slate-500 uppercase">Code</th>
                      <th className="text-left py-2 px-3 text-xs font-medium text-slate-500 uppercase">Material</th>
                      <th className="text-right py-2 px-3 text-xs font-medium text-slate-500 uppercase">System Qty</th>
                      <th className="text-right py-2 px-3 text-xs font-medium text-slate-500 uppercase">Counted Qty</th>
                      <th className="text-right py-2 px-3 text-xs font-medium text-slate-500 uppercase">Variance</th>
                      <th className="text-right py-2 px-3 text-xs font-medium text-slate-500 uppercase">Var %</th>
                      <th className="text-center py-2 px-3 text-xs font-medium text-slate-500 uppercase">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {topVariances.map((item) => {
                      const matchedLine = lines.find(l => l.raw_materials?.code === item.code);
                      const countedQty = matchedLine?.counted_qty ?? 0;
                      const varPct = item.systemQty > 0 ? ((item.variance / item.systemQty) * 100).toFixed(1) : '0.0';
                      const isApproved = matchedLine?.approved_by;
                      return (
                        <tr key={item.code} className="border-b border-slate-50 last:border-0">
                          <td className="py-2 px-3 font-medium text-slate-700">{item.code}</td>
                          <td className="py-2 px-3 text-slate-600">{item.name}</td>
                          <td className="py-2 px-3 text-right text-slate-600">{item.systemQty.toFixed(2)}</td>
                          <td className="py-2 px-3 text-right text-slate-600">{countedQty.toFixed(2)}</td>
                          <td className={`py-2 px-3 text-right font-medium ${
                            item.variance > 0 ? 'text-amber-600' : 'text-red-600'
                          }`}>
                            {item.variance > 0 ? '+' : ''}{item.variance.toFixed(2)} kg
                          </td>
                          <td className={`py-2 px-3 text-right ${
                            Math.abs(parseFloat(varPct)) > 5 ? 'text-red-600 font-medium' : 'text-slate-600'
                          }`}>
                            {varPct}%
                          </td>
                          <td className="py-2 px-3 text-center">
                            {isApproved ? (
                              <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-full">
                                <CheckCircle className="w-3 h-3" /> Approved
                              </span>
                            ) : Math.abs(parseFloat(varPct)) > 5 ? (
                              <span className="inline-flex items-center gap-1 text-xs font-medium text-red-600 bg-red-50 px-2 py-0.5 rounded-full">
                                <AlertTriangle className="w-3 h-3" /> Needs Approval
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 text-xs font-medium text-slate-500 bg-slate-50 px-2 py-0.5 rounded-full">
                                <Minus className="w-3 h-3" /> OK
                              </span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Assign Counters Panel */}
      {canEdit && canManage && (
        <div className="bg-white rounded-lg shadow">
          <button
            onClick={() => setShowAssignPanel(!showAssignPanel)}
            className="w-full px-6 py-4 flex items-center justify-between text-left hover:bg-gray-50 transition-colors"
          >
            <div className="flex items-center space-x-3">
              <Users className="h-5 w-5 text-gray-600" />
              <span className="font-medium text-gray-900">Assign Counters</span>
            </div>
            <span className="text-sm text-gray-500">{showAssignPanel ? 'Hide' : 'Show'}</span>
          </button>
          {showAssignPanel && (
            <div className="px-6 pb-4 border-t border-gray-200">
              <div className="flex items-center justify-between mb-4 mt-4">
                <p className="text-sm text-gray-500">Assign users to count specific materials</p>
                <button
                  onClick={handleAutoAssign}
                  className="px-4 py-2 bg-indigo-600 text-white text-sm rounded-lg hover:bg-indigo-700 transition-colors"
                >
                  Auto-assign evenly
                </button>
              </div>
              <div className="overflow-x-auto max-h-96">
                <table className="min-w-full divide-y divide-gray-200">
                  <thead className="bg-gray-50 sticky top-0">
                    <tr>
                      <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Raw Material</th>
                      <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Assigned To</th>
                      <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Action</th>
                    </tr>
                  </thead>
                  <tbody className="bg-white divide-y divide-gray-200">
                    {lines.map((line) => (
                      <tr key={line.id}>
                        <td className="px-4 py-2 text-sm text-gray-900">
                          {line.raw_materials?.code} - {line.raw_materials?.name}
                        </td>
                        <td className="px-4 py-2 text-sm">
                          <select
                            value={line.assigned_to || ''}
                            onChange={(e) => handleAssignUser(line.id, e.target.value || null)}
                            className="w-full px-2 py-1 border border-gray-300 rounded text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                          >
                            <option value="">Unassigned</option>
                            {users.map((user) => (
                              <option key={user.id} value={user.id}>
                                {user.full_name}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td className="px-4 py-2 text-sm">
                          {line.assigned_to && (
                            <button
                              onClick={() => handleAssignUser(line.id, null)}
                              className="text-red-600 hover:text-red-900 text-xs"
                            >
                              Clear
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Count register filters */}
      <div className="flex flex-wrap items-center gap-2">
        <button
          onClick={() => setFilter('all')}
          className={`rounded-full px-3 py-1.5 text-sm font-medium transition-colors ${
            filter === 'all' ? 'bg-[#0B0B34] text-white' : 'border border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
          }`}
        >
          All ({lines.length})
        </button>
        <button
          onClick={() => setFilter('zero')}
          className={`rounded-full px-3 py-1.5 text-sm font-medium transition-colors ${
            filter === 'zero' ? 'bg-emerald-600 text-white' : 'border border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
          }`}
        >
          Zero Variance ({lines.filter(l => l.variance === 0).length})
        </button>
        <button
          onClick={() => setFilter('low')}
          className={`rounded-full px-3 py-1.5 text-sm font-medium transition-colors ${
            filter === 'low' ? 'bg-orange-500 text-white' : 'border border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
          }`}
        >
          Low Variance (&lt;5%) ({lines.filter(l => l.counted_qty !== null && Math.abs(l.variance / l.system_qty) > 0 && Math.abs(l.variance / l.system_qty) <= 0.05).length})
        </button>
        <button
          onClick={() => setFilter('high')}
          className={`rounded-full px-3 py-1.5 text-sm font-medium transition-colors ${
            filter === 'high' ? 'bg-rose-600 text-white' : 'border border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
          }`}
        >
          High Variance (&gt;5%) ({lines.filter(l => l.counted_qty !== null && Math.abs(l.variance / l.system_qty) > 0.05).length})
        </button>
        <button
          onClick={() => setFilter('pending')}
          className={`rounded-full px-3 py-1.5 text-sm font-medium transition-colors ${
            filter === 'pending' ? 'bg-slate-700 text-white' : 'border border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
          }`}
        >
          Not Counted ({pendingLines})
        </button>
      </div>

      {/* Count Entry Table */}
      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-5 py-4">
          <div>
            <h2 className="text-base font-bold text-[#0B0B34]">Count Register</h2>
            <p className="mt-1 text-xs text-slate-500">Enter physical counts, resolve recounts, then route variances to Finance.</p>
          </div>
          <span className="rounded-md bg-slate-100 px-2.5 py-1 font-mono text-xs font-semibold text-slate-600">{getFilteredLines().length} shown</span>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-slate-200">
            <thead className="bg-slate-50">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Code</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Raw Material</th>
                {showSystemQty && (
                  <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">System Qty (kg)</th>
                )}
                <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Counted Qty (kg)</th>
                {lines.some(l => l.needs_recount) && (
                  <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Recount Qty (kg)</th>
                )}
                {showSystemQty && (
                  <>
                    <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Variance (kg)</th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Var %</th>
                  </>
                )}
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Status</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Counted By</th>
                {(canManage || canApproveVariance) && (
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Actions</th>
                )}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 bg-white">
              {getFilteredLines().map((line) => {
                const status = getLineStatus(line);
                const variancePercent = line.system_qty > 0 ? (line.variance / line.system_qty) * 100 : 0;
                const canEditLine = canEdit && !line.is_locked && (canManage || !line.assigned_to || line.assigned_to === profile?.id);

                return (
                  <tr key={line.id} className={line.is_mandatory ? 'bg-orange-50/50' : 'hover:bg-slate-50/70'}>
                    <td className="px-4 py-3 whitespace-nowrap text-sm font-medium text-gray-900">
                      {line.is_mandatory && <span className="text-red-600 mr-1">🔴</span>}
                      {line.raw_materials?.code}
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-900">{line.raw_materials?.name}</td>
                    {showSystemQty && (
                      <td className="px-4 py-3 whitespace-nowrap text-sm text-right text-gray-900">{line.system_qty.toFixed(2)}</td>
                    )}
                    <td className="px-4 py-3 whitespace-nowrap text-sm text-right">
                      {canEditLine ? (
                        <input
                          type="number"
                          step="0.01"
                          value={inputValues[line.id] ?? (line.counted_qty?.toString() ?? '')}
                          onChange={(e) => setInputValues({ ...inputValues, [line.id]: e.target.value })}
                          onBlur={(e) => {
                            handleUpdateCountedQty(line.id, e.target.value);
                            setInputValues(prev => {
                              const next = { ...prev };
                              delete next[line.id];
                              return next;
                            });
                          }}
                          className="w-24 px-2 py-1 border border-gray-300 rounded text-right focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                          placeholder="0.00"
                        />
                      ) : (
                        <span className="text-gray-900">{line.counted_qty?.toFixed(2) ?? '—'}</span>
                      )}
                    </td>
                    {lines.some(l => l.needs_recount) && (
                      <td className="px-4 py-3 whitespace-nowrap text-sm text-right">
                        {line.needs_recount && canEditLine ? (
                          <input
                            type="number"
                            step="0.01"
                            value={inputValues[`recount_${line.id}`] ?? (line.recount_qty?.toString() ?? '')}
                            onChange={(e) => setInputValues({ ...inputValues, [`recount_${line.id}`]: e.target.value })}
                            onBlur={(e) => {
                              handleUpdateRecountQty(line.id, e.target.value);
                              setInputValues(prev => {
                                const next = { ...prev };
                                delete next[`recount_${line.id}`];
                                return next;
                              });
                            }}
                            className="w-24 px-2 py-1 border border-amber-300 rounded text-right focus:ring-2 focus:ring-amber-500 focus:border-amber-500"
                            placeholder="0.00"
                          />
                        ) : (
                          <span className="text-gray-900">{line.recount_qty?.toFixed(2) ?? '—'}</span>
                        )}
                      </td>
                    )}
                    {showSystemQty && (
                      <>
                        <td className={`px-4 py-3 whitespace-nowrap text-sm text-right font-medium ${
                          line.variance === 0 ? 'text-green-600' :
                          line.variance > 0 ? 'text-amber-600' : 'text-red-600'
                        }`}>
                          {line.counted_qty !== null ? `${line.variance > 0 ? '+' : ''}${line.variance.toFixed(2)}` : '—'}
                        </td>
                        <td className={`px-4 py-3 whitespace-nowrap text-sm text-right ${
                          Math.abs(variancePercent) === 0 ? 'text-green-600' :
                          Math.abs(variancePercent) > 5 ? 'text-red-600' : 'text-amber-600'
                        }`}>
                          {line.counted_qty !== null ? `${variancePercent > 0 ? '+' : ''}${variancePercent.toFixed(1)}%` : '—'}
                        </td>
                      </>
                    )}
                    <td className="px-4 py-3 whitespace-nowrap">
                      {getLineStatusBadge(status)}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-500">
                      {line.counted_by_profile?.full_name || '—'}
                    </td>
                    {(canManage || canApproveVariance) && (
                      <td className="px-4 py-3 whitespace-nowrap text-sm space-x-2">
                        {canManage && !line.approved_by && line.counted_qty !== null && (
                          <>
                            <button
                              onClick={() => {
                                setSelectedLine(line);
                                setShowRecountModal(true);
                              }}
                              className="text-amber-600 hover:text-amber-900"
                              title="Flag for recount"
                            >
                              <Flag className="h-4 w-4" />
                            </button>
                          </>
                        )}
                        {canApproveVariance && !line.approved_by && line.counted_qty !== null && line.variance !== 0 && (
                          <button
                            onClick={() => {
                              setSelectedLine(line);
                              setShowVarianceApprovalModal(true);
                            }}
                            className="text-green-600 hover:text-green-900"
                            title="Finance review and approve variance"
                          >
                            <ThumbsUp className="h-4 w-4" />
                          </button>
                        )}
                        {canManage && (
                          <button
                            onClick={() => handleLockLine(line.id, !line.is_locked)}
                            className={line.is_locked ? 'text-gray-600 hover:text-gray-900' : 'text-indigo-600 hover:text-indigo-900'}
                            title={line.is_locked ? 'Unlock line' : 'Lock line'}
                          >
                            {line.is_locked ? <Unlock className="h-4 w-4" /> : <Lock className="h-4 w-4" />}
                          </button>
                        )}
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Freeze Modal */}
      {showFreezeModal && (
        <Modal
          open={showFreezeModal}
          onClose={() => setShowFreezeModal(false)}
          title="Freeze Stock Take"
        >
          <div className="space-y-4">
            <div className="flex items-start space-x-3 p-4 bg-amber-50 rounded-lg border border-amber-200">
              <AlertTriangle className="h-5 w-5 text-amber-600 mt-0.5" />
              <div className="flex-1">
                <p className="text-sm text-gray-900 font-medium">Freezing will warn all users that stock movements should pause</p>
                <p className="text-sm text-gray-600 mt-1">This is a UI warning only — no hard block will be enforced</p>
              </div>
            </div>
            <p className="text-sm text-gray-600">Continue?</p>
            <div className="flex justify-end space-x-3">
              <button
                onClick={() => setShowFreezeModal(false)}
                className="px-4 py-2 text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                onClick={handleFreezeStock}
                disabled={saving}
                className="px-4 py-2 bg-amber-600 text-white rounded-lg hover:bg-amber-700 disabled:opacity-50"
              >
                {saving ? 'Freezing...' : 'Freeze Stock Take'}
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* Close Modal */}
      {showCloseModal && (
        <Modal
          open={showCloseModal}
          onClose={() => setShowCloseModal(false)}
          title="Close Stock Take"
          size="lg"
        >
          <div className="space-y-4">
            <div className="grid grid-cols-4 gap-4 p-4 bg-gray-50 rounded-lg">
              <div>
                <div className="text-sm text-gray-500">Counted</div>
                <div className="text-xl font-bold text-blue-600">{countedLines}</div>
              </div>
              <div>
                <div className="text-sm text-gray-500">Not Counted</div>
                <div className="text-xl font-bold text-gray-600">{pendingLines}</div>
              </div>
              <div>
                <div className="text-sm text-gray-500">Needs Recount</div>
                <div className="text-xl font-bold text-amber-600">{recountLines}</div>
              </div>
              <div>
                <div className="text-sm text-gray-500">Total Variance</div>
                <div className={`text-xl font-bold ${
                  totalVariance === 0 ? 'text-green-600' :
                  totalVariance > 0 ? 'text-amber-600' : 'text-red-600'
                }`}>
                  {totalVariance > 0 ? '+' : ''}{totalVariance.toFixed(2)} kg
                </div>
              </div>
            </div>

            {lines.filter(l => l.counted_qty !== null && Math.abs(l.variance) > 0).slice(0, 5).length > 0 && (
              <div>
                <h4 className="text-sm font-medium text-gray-900 mb-2">Top 5 Variances:</h4>
                <ul className="space-y-1 text-sm text-gray-600">
                  {lines
                    .filter(l => l.counted_qty !== null && Math.abs(l.variance) > 0)
                    .sort((a, b) => Math.abs(b.variance) - Math.abs(a.variance))
                    .slice(0, 5)
                    .map(l => (
                      <li key={l.id}>
                        {l.raw_materials?.code}: {l.variance > 0 ? '+' : ''}{l.variance.toFixed(2)} kg
                      </li>
                    ))}
                </ul>
              </div>
            )}

            <div className="flex items-start space-x-3 p-4 bg-red-50 rounded-lg border border-red-200">
              <AlertTriangle className="h-5 w-5 text-red-600 mt-0.5" />
              <div className="flex-1">
                <p className="text-sm text-gray-900 font-medium">This closes the controlled stock-take record after Finance has reviewed every variance.</p>
                <p className="text-sm text-gray-600 mt-1">It does not automatically adjust Sage or MES on-hand stock. Any inventory adjustment remains a separately approved Finance process.</p>
              </div>
            </div>

            <div className="flex items-center space-x-2">
              <input
                type="checkbox"
                id="confirmClose"
                className="h-4 w-4 text-indigo-600 focus:ring-indigo-500 border-gray-300 rounded"
              />
              <label htmlFor="confirmClose" className="text-sm text-gray-900">
                I confirm this stock take is complete and accurate
              </label>
            </div>

            <div className="flex justify-end space-x-3 pt-4">
              <button
                onClick={() => setShowCloseModal(false)}
                className="px-4 py-2 text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                onClick={handleCloseStock}
                disabled={saving}
                className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50 flex items-center space-x-2"
              >
                {saving ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    <span>Closing...</span>
                  </>
                ) : (
                  <>
                    <CheckCircle className="h-4 w-4" />
                    <span>Close Stock Take</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* Finance variance review */}
      {showVarianceApprovalModal && selectedLine && (
        <Modal
          open={showVarianceApprovalModal}
          onClose={() => {
            setShowVarianceApprovalModal(false);
            setVarianceApprovalReason('');
            setSelectedLine(null);
          }}
          title="Review Stock Variance"
        >
          <div className="space-y-4">
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-4">
              <p className="font-medium text-slate-900">
                {selectedLine.raw_materials?.code} - {selectedLine.raw_materials?.name}
              </p>
              <div className="mt-2 grid grid-cols-3 gap-3 text-sm">
                <div><p className="text-slate-500">System</p><p className="font-semibold">{selectedLine.system_qty.toFixed(2)} kg</p></div>
                <div><p className="text-slate-500">Final count</p><p className="font-semibold">{(selectedLine.recount_qty ?? selectedLine.counted_qty ?? 0).toFixed(2)} kg</p></div>
                <div><p className="text-slate-500">Variance</p><p className={`font-semibold ${selectedLine.variance < 0 ? 'text-red-700' : 'text-amber-700'}`}>{selectedLine.variance > 0 ? '+' : ''}{selectedLine.variance.toFixed(2)} kg</p></div>
              </div>
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">
                Finance review reason <span className="text-red-600">*</span>
              </label>
              <textarea
                value={varianceApprovalReason}
                onChange={(event) => setVarianceApprovalReason(event.target.value)}
                rows={3}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500"
                placeholder="Explain the cause, evidence checked, and agreed treatment."
              />
            </div>
            <p className="text-xs text-slate-500">Approval locks this line and records the reviewer, date, final variance, and reason. It does not post a Sage adjustment.</p>
            <div className="flex justify-end gap-3">
              <button onClick={() => setShowVarianceApprovalModal(false)} className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-slate-700 hover:bg-slate-50">Cancel</button>
              <button onClick={handleApproveLine} disabled={saving || !varianceApprovalReason.trim()} className="rounded-lg bg-emerald-600 px-4 py-2 text-white hover:bg-emerald-700 disabled:opacity-50">
                {saving ? 'Approving...' : 'Approve Variance'}
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* Recount Modal */}
      {showRecountModal && selectedLine && (
        <Modal
          open={showRecountModal}
          onClose={() => {
            setShowRecountModal(false);
            setRecountReason('');
            setSelectedLine(null);
          }}
          title="Flag for Recount"
        >
          <div className="space-y-4">
            <div>
              <p className="text-sm text-gray-900 font-medium">
                {selectedLine.raw_materials?.code} - {selectedLine.raw_materials?.name}
              </p>
              <p className="text-sm text-gray-500 mt-1">
                Counted: {selectedLine.counted_qty?.toFixed(2)} kg | Variance: {selectedLine.variance > 0 ? '+' : ''}{selectedLine.variance.toFixed(2)} kg
              </p>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Reason for Recount <span className="text-red-600">*</span>
              </label>
              <textarea
                value={recountReason}
                onChange={(e) => setRecountReason(e.target.value)}
                rows={3}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                placeholder="e.g., High variance, unclear count, damaged packaging"
              />
            </div>
            <div className="flex justify-end space-x-3">
              <button
                onClick={() => {
                  setShowRecountModal(false);
                  setRecountReason('');
                  setSelectedLine(null);
                }}
                className="px-4 py-2 text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                onClick={handleFlagForRecount}
                disabled={saving || !recountReason.trim()}
                className="px-4 py-2 bg-amber-600 text-white rounded-lg hover:bg-amber-700 disabled:opacity-50"
              >
                {saving ? 'Flagging...' : 'Flag for Recount'}
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* Audit Trail Section */}
      <div className="bg-white rounded-lg shadow">
        <button
          onClick={() => {
            setShowAuditTrail(!showAuditTrail);
            if (!showAuditTrail && auditLog.length === 0) fetchAuditLog();
          }}
          className="w-full px-6 py-4 flex items-center justify-between text-left hover:bg-gray-50 transition-colors"
        >
          <div className="flex items-center space-x-3">
            <Clock className="h-5 w-5 text-gray-600" />
            <span className="font-medium text-gray-900">View Audit Trail ({auditLog.length} entries)</span>
          </div>
          <span className="text-sm text-gray-500">{showAuditTrail ? 'Hide' : 'Show'}</span>
        </button>
        {showAuditTrail && (
          <div className="px-6 pb-4 border-t border-gray-200">
            {auditLoading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-6 w-6 animate-spin text-indigo-600" />
              </div>
            ) : auditLog.length === 0 ? (
              <p className="text-sm text-gray-500 py-4 text-center">No audit entries yet</p>
            ) : (
              <div className="overflow-x-auto mt-4">
                <table className="min-w-full divide-y divide-gray-200">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Time</th>
                      <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Raw Material</th>
                      <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Action</th>
                      <th className="px-4 py-2 text-right text-xs font-medium text-gray-500 uppercase">Old Value</th>
                      <th className="px-4 py-2 text-right text-xs font-medium text-gray-500 uppercase">New Value</th>
                      <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Changed By</th>
                      <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Notes</th>
                    </tr>
                  </thead>
                  <tbody className="bg-white divide-y divide-gray-200">
                    {auditLog.map((entry) => (
                      <tr key={entry.id}>
                        <td className="px-4 py-2 whitespace-nowrap text-sm text-gray-500">
                          {format(new Date(entry.changed_at), 'PPp')}
                        </td>
                        <td className="px-4 py-2 text-sm text-gray-900">
                          {entry.line?.raw_materials?.code || '—'}
                        </td>
                        <td className="px-4 py-2 text-sm text-gray-900">
                          {entry.action.replace(/_/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase())}
                        </td>
                        <td className="px-4 py-2 whitespace-nowrap text-sm text-right text-gray-500">
                          {entry.old_value !== null ? entry.old_value : '—'}
                        </td>
                        <td className="px-4 py-2 whitespace-nowrap text-sm text-right text-gray-900">
                          {entry.new_value !== null ? entry.new_value : '—'}
                        </td>
                        <td className="px-4 py-2 text-sm text-gray-500">
                          {entry.changed_by_profile?.full_name || '—'}
                        </td>
                        <td className="px-4 py-2 text-sm text-gray-500">
                          {entry.notes || '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
