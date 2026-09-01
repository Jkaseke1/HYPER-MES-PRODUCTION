import { useState, useEffect } from 'react';
import { Plus, Search, Eye, CheckCircle2, XCircle, TrendingUp, BarChart2, FlaskConical, LockKeyhole, ShieldCheck } from 'lucide-react';
import { format } from 'date-fns';
import { supabase } from '../lib/supabase';
import Modal from '../components/ui/Modal';
import StatusBadge from '../components/ui/StatusBadge';
import ApprovalButtons from '../components/approval/ApprovalButtons';
import ApprovalHistory from '../components/approval/ApprovalHistory';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, Legend,
} from 'recharts';

interface QualityInspection {
  id: string;
  grn_id: string;
  raw_material_id: string;
  batch_number: string;
  inspection_date: string;
  result: string;
  status: string;
  moisture_content: number | null;
  protein_content: number | null;
  fat_content: number | null;
  fiber_content: number | null;
  remarks: string;
  approved_by?: string | null;
  approved_at?: string | null;
  rejection_reason?: string | null;
  goods_received_notes?: { grn_number: string };
  raw_materials?: { name: string };
}

interface GRN {
  id: string;
  grn_number: string;
}

interface GRNItem {
  id: string;
  grn_id: string;
  raw_material_id: string;
  batch_number: string;
  raw_materials?: any;
}

interface QualityLotControl {
  id: string;
  source_id: string | null;
  raw_material_id: string | null;
  batch_number: string;
  received_qty: number;
  disposition: 'hold' | 'released' | 'conditional' | 'rejected';
  quantity: number;
  unit: string;
  hold_reason?: string | null;
  released_at?: string | null;
}

const lotKey = (grnId: string | null | undefined, materialId: string | null | undefined, batchNumber: string) =>
  `${grnId || ''}:${materialId || ''}:${batchNumber || ''}`;

const dispositionStyle: Record<QualityLotControl['disposition'], string> = {
  hold: 'bg-amber-50 text-amber-700 border-amber-200',
  released: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  conditional: 'bg-blue-50 text-blue-700 border-blue-200',
  rejected: 'bg-red-50 text-red-700 border-red-200',
};

const emptyForm = {
  grn_id: '',
  raw_material_id: '',
  batch_number: '',
  inspection_date: new Date().toISOString().split('T')[0],
  result: 'pending',
  moisture_content: '',
  protein_content: '',
  fat_content: '',
  fiber_content: '',
  remarks: '',
};

export default function QualityInspectionPage() {
  const [inspections, setInspections] = useState<QualityInspection[]>([]);
  const [grns, setGrns] = useState<GRN[]>([]);
  const [grnItems, setGrnItems] = useState<GRNItem[]>([]);
  const [lotControls, setLotControls] = useState<Record<string, QualityLotControl>>({});
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [viewModalOpen, setViewModalOpen] = useState(false);
  const [viewing, setViewing] = useState<QualityInspection | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);

  async function fetchData() {
    setLoading(true);
    const [inspectionsRes, grnsRes, controlsRes] = await Promise.all([
      supabase
        .from('quality_inspections')
        .select('*, goods_received_notes(grn_number), raw_materials(name)')
        .order('created_at', { ascending: false }),
      supabase
        .from('goods_received_notes')
        .select('id, grn_number')
        .order('grn_number'),
      supabase
        .from('quality_lot_controls')
        .select('id, source_id, raw_material_id, batch_number, disposition, quantity, unit, hold_reason, released_at')
        .eq('source_type', 'grn'),
    ]);
    setInspections(inspectionsRes.data || []);
    setGrns(grnsRes.data || []);
    setLotControls(Object.fromEntries(((controlsRes.data || []) as QualityLotControl[]).map((control) => [lotKey(control.source_id, control.raw_material_id, control.batch_number), control])));
    setLoading(false);
  }

  useEffect(() => {
    fetchData();
  }, []);

  async function handleGrnChange(grnId: string) {
    setForm({ ...form, grn_id: grnId, raw_material_id: '', batch_number: '' });
    
    if (grnId) {
      const { data } = await supabase
        .from('grn_items')
        .select('id, grn_id, raw_material_id, batch_number, received_qty, raw_materials(id, name)')
        .eq('grn_id', grnId);
      setGrnItems(data || []);
    } else {
      setGrnItems([]);
    }
  }

  function handleMaterialChange(materialId: string) {
    const item = grnItems.find(i => i.raw_material_id === materialId);
    setForm({ ...form, raw_material_id: materialId, batch_number: item?.batch_number || '' });
  }

  function openAdd() {
    setForm(emptyForm);
    setGrnItems([]);
    setModalOpen(true);
  }

  function openView(inspection: QualityInspection) {
    setViewing(inspection);
    setViewModalOpen(true);
  }

  async function upsertLotControl(input: {
    grnId: string; materialId: string; batchNumber: string; quantity: number;
    disposition: QualityLotControl['disposition']; reason?: string | null;
  }) {
    const current = lotControls[lotKey(input.grnId, input.materialId, input.batchNumber)];
    const { data: authData } = await supabase.auth.getUser();
    const userId = authData.user?.id || null;
    const isReleased = input.disposition === 'released' || input.disposition === 'conditional';
    const { data, error } = await supabase
      .from('quality_lot_controls')
      .upsert({
        source_type: 'grn', source_id: input.grnId, raw_material_id: input.materialId,
        batch_number: input.batchNumber, quantity: input.quantity, unit: 'kg',
        disposition: input.disposition,
        hold_reason: input.disposition === 'hold' ? (input.reason || 'Awaiting quality approval') : input.disposition === 'rejected' ? input.reason : null,
        released_by: isReleased ? userId : null,
        released_at: isReleased ? new Date().toISOString() : null,
        release_notes: isReleased || input.disposition === 'rejected' ? input.reason || null : null,
      }, { onConflict: 'source_type,source_id,raw_material_id,batch_number' })
      .select('id')
      .single();
    if (error) throw error;
    if (!current || current.disposition !== input.disposition) {
      const action = input.disposition === 'released' ? 'released' : input.disposition === 'conditional' ? 'conditional_release' : input.disposition === 'rejected' ? 'rejected' : 'held';
      const { error: actionError } = await supabase.from('quality_lot_actions').insert({
        quality_lot_control_id: data.id, action, previous_disposition: current?.disposition || null,
        new_disposition: input.disposition, reason: input.reason || null, performed_by: userId,
      });
      if (actionError) console.warn('Lot action could not be logged:', actionError.message);
    }
  }

  async function syncViewingLot() {
    if (!viewing) return;
    const { data: inspection, error } = await supabase
      .from('quality_inspections').select('status, rejection_reason, remarks')
      .eq('id', viewing.id).single();
    if (error || !inspection) return;
    const disposition: QualityLotControl['disposition'] = inspection.status === 'passed' ? 'released' : inspection.status === 'conditional' ? 'conditional' : inspection.status === 'failed' ? 'rejected' : 'hold';
    const existing = lotControls[lotKey(viewing.grn_id, viewing.raw_material_id, viewing.batch_number)];
    try {
      await upsertLotControl({
        grnId: viewing.grn_id, materialId: viewing.raw_material_id, batchNumber: viewing.batch_number,
        quantity: Number(existing?.quantity || grnItems.find((item) => item.raw_material_id === viewing.raw_material_id && item.batch_number === viewing.batch_number)?.received_qty || 0),
        disposition, reason: inspection.rejection_reason || inspection.remarks,
      });
    } catch (syncError) {
      console.error('Unable to update lot disposition:', syncError);
    }
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);

    try {
      const data = {
        grn_id: form.grn_id,
        raw_material_id: form.raw_material_id,
        batch_number: form.batch_number,
        inspection_date: form.inspection_date,
        result: form.result,
        moisture_content: form.moisture_content ? parseFloat(form.moisture_content) : null,
        protein_content: form.protein_content ? parseFloat(form.protein_content) : null,
        fat_content: form.fat_content ? parseFloat(form.fat_content) : null,
        fiber_content: form.fiber_content ? parseFloat(form.fiber_content) : null,
        remarks: form.remarks,
      };

      const { error } = await supabase.from('quality_inspections').insert(data);

      if (error) {
        console.error('Error saving inspection:', error);
        alert(`Error: ${error.message}`);
        setSaving(false);
        return;
      }

      const sourceItem = grnItems.find((item) => item.raw_material_id === form.raw_material_id && item.batch_number === form.batch_number);
      try {
        await upsertLotControl({
          grnId: form.grn_id, materialId: form.raw_material_id, batchNumber: form.batch_number,
          quantity: Number(sourceItem?.received_qty || 0), disposition: 'hold', reason: 'Awaiting quality approval',
        });
      } catch (lotError: any) {
        console.error('Quality inspection saved, but lot hold failed:', lotError);
        alert(`Inspection saved, but the lot hold could not be created: ${lotError.message}`);
      }

      setSaving(false);
      setModalOpen(false);
      fetchData();
    } catch (error) {
      console.error('Unexpected error:', error);
      alert('An unexpected error occurred. Please try again.');
      setSaving(false);
    }
  }

  const filtered = inspections.filter((i) => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return (
      i.goods_received_notes?.grn_number.toLowerCase().includes(q) ||
      i.raw_materials?.name.toLowerCase().includes(q) ||
      i.batch_number.toLowerCase().includes(q)
    );
  });

  const inputClass = 'w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500 transition-colors';

  const passed = inspections.filter(i => i.status === 'passed' || i.result === 'passed').length;
  const failed = inspections.filter(i => i.status === 'failed' || i.result === 'failed').length;
  const pending = inspections.filter(i => i.status === 'pending' || i.result === 'pending').length;
  const passRate = inspections.length > 0 ? Math.round((passed / inspections.length) * 100) : 0;
  const heldLots = Object.values(lotControls).filter((control) => control.disposition === 'hold').length;

  const resultChartData = [
    { name: 'Passed', value: passed, color: '#0d9488' },
    { name: 'Failed', value: failed, color: '#ef4444' },
    { name: 'Pending', value: pending, color: '#f59e0b' },
  ].filter(d => d.value > 0);

  const materialChartData = Object.entries(
    inspections.reduce((acc, i) => {
      const name = i.raw_materials?.name?.split(' ').slice(0, 2).join(' ') || 'Unknown';
      acc[name] = (acc[name] || 0) + 1;
      return acc;
    }, {} as Record<string, number>)
  ).slice(0, 8).map(([name, count]) => ({ name, count }));

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">Quality Inspections</h1>
          <p className="text-sm text-slate-500 mt-1">Inspect and verify incoming raw materials</p>
        </div>
        <button onClick={openAdd} className="flex items-center gap-2 px-4 py-2.5 bg-teal-600 text-white rounded-lg hover:bg-teal-700 transition-colors font-medium shadow-sm">
          <Plus className="w-4 h-4" />
          Create Inspection
        </button>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
        <div className="bg-white rounded-xl border border-slate-200 p-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-medium text-slate-500 uppercase tracking-wide">Total Inspections</span>
            <FlaskConical className="w-4 h-4 text-slate-400" />
          </div>
          <p className="text-3xl font-bold text-slate-800">{inspections.length}</p>
          <p className="text-xs text-slate-500 mt-1">All time</p>
        </div>
        <div className="bg-white rounded-xl border border-amber-200 p-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-medium text-slate-500 uppercase tracking-wide">Lots on Hold</span>
            <LockKeyhole className="w-4 h-4 text-amber-500" />
          </div>
          <p className="text-3xl font-bold text-amber-600">{heldLots}</p>
          <p className="text-xs text-slate-500 mt-1">Awaiting quality release</p>
        </div>
        <div className="bg-white rounded-xl border border-slate-200 p-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-medium text-slate-500 uppercase tracking-wide">Passed</span>
            <CheckCircle2 className="w-4 h-4 text-teal-500" />
          </div>
          <p className="text-3xl font-bold text-teal-600">{passed}</p>
          <p className="text-xs text-slate-500 mt-1">Quality approved</p>
        </div>
        <div className="bg-white rounded-xl border border-slate-200 p-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-medium text-slate-500 uppercase tracking-wide">Failed</span>
            <XCircle className="w-4 h-4 text-red-500" />
          </div>
          <p className="text-3xl font-bold text-red-600">{failed}</p>
          <p className="text-xs text-slate-500 mt-1">Rejected materials</p>
        </div>
        <div className="bg-white rounded-xl border border-slate-200 p-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-medium text-slate-500 uppercase tracking-wide">Pass Rate</span>
            <TrendingUp className="w-4 h-4 text-teal-500" />
          </div>
          <p className="text-3xl font-bold text-slate-800">{passRate}%</p>
          <div className="mt-2 h-2 bg-slate-100 rounded-full overflow-hidden">
            <div className="h-full bg-teal-500 rounded-full transition-all" style={{ width: `${passRate}%` }} />
          </div>
        </div>
      </div>

      {/* Charts Row */}
      {inspections.length > 0 && (
        <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
          <div className="xl:col-span-2 bg-white rounded-xl border border-slate-200 p-5">
            <div className="flex items-center gap-2 mb-4">
              <BarChart2 className="w-4 h-4 text-slate-500" />
              <h2 className="text-sm font-semibold text-slate-800">Inspections by Material</h2>
            </div>
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={materialChartData} margin={{ top: 0, right: 0, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                <XAxis dataKey="name" tick={{ fontSize: 11, fill: '#64748b' }} />
                <YAxis tick={{ fontSize: 11, fill: '#64748b' }} allowDecimals={false} />
                <Tooltip contentStyle={{ fontSize: '12px', borderRadius: '8px', border: '1px solid #e2e8f0' }} />
                <Bar dataKey="count" fill="#0d9488" radius={[4, 4, 0, 0]} name="Inspections" />
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div className="bg-white rounded-xl border border-slate-200 p-5">
            <div className="flex items-center gap-2 mb-4">
              <CheckCircle2 className="w-4 h-4 text-slate-500" />
              <h2 className="text-sm font-semibold text-slate-800">Results Distribution</h2>
            </div>
            <ResponsiveContainer width="100%" height={200}>
              <PieChart>
                <Pie data={resultChartData} cx="50%" cy="50%" innerRadius={50} outerRadius={80} paddingAngle={3} dataKey="value">
                  {resultChartData.map((entry, index) => (
                    <Cell key={index} fill={entry.color} />
                  ))}
                </Pie>
                <Tooltip contentStyle={{ fontSize: '12px', borderRadius: '8px' }} />
                <Legend iconSize={10} iconType="circle" wrapperStyle={{ fontSize: '12px' }} />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      <div className="bg-white rounded-xl shadow-sm border border-slate-200">
        <div className="p-4 border-b border-slate-200">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <input
              type="text"
              placeholder="Search by GRN number, material, or batch..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-10 pr-4 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500"
            />
          </div>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-12">
            <div className="text-slate-500">Loading inspections...</div>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 border-b border-slate-200">
                <tr>
                  <th className="text-left px-4 py-3 font-semibold text-slate-600">GRN Number</th>
                  <th className="text-left px-4 py-3 font-semibold text-slate-600">Material</th>
                  <th className="text-left px-4 py-3 font-semibold text-slate-600">Batch</th>
                  <th className="text-left px-4 py-3 font-semibold text-slate-600">Inspection Date</th>
                  <th className="text-left px-4 py-3 font-semibold text-slate-600">Result</th>
                  <th className="text-left px-4 py-3 font-semibold text-slate-600">Lot Control</th>
                  <th className="text-left px-4 py-3 font-semibold text-slate-600"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filtered.map((inspection) => (
                  <tr key={inspection.id} className="hover:bg-slate-50/50 transition-colors">
                    <td className="px-4 py-3 font-mono text-xs text-slate-500">{inspection.goods_received_notes?.grn_number || '-'}</td>
                    <td className="px-4 py-3 font-medium text-slate-800">{inspection.raw_materials?.name || '-'}</td>
                    <td className="px-4 py-3 font-mono text-xs text-slate-600">{inspection.batch_number}</td>
                    <td className="px-4 py-3 text-slate-600">{format(new Date(inspection.inspection_date), 'dd MMM yyyy')}</td>
                    <td className="px-4 py-3"><StatusBadge status={inspection.status || inspection.result} /></td>
                    <td className="px-4 py-3">{(() => { const control = lotControls[lotKey(inspection.grn_id, inspection.raw_material_id, inspection.batch_number)]; return control ? <span className={`inline-flex rounded-full border px-2 py-0.5 text-xs font-semibold ${dispositionStyle[control.disposition]}`}>{control.disposition === 'hold' ? 'On hold' : control.disposition}</span> : <span className="text-xs text-slate-400">Pending setup</span>; })()}</td>
                    <td className="px-4 py-3">
                      <button onClick={() => openView(inspection)} className="p-1.5 rounded-lg text-slate-400 hover:text-teal-600 hover:bg-teal-50 transition-colors" title="View Details">
                        <Eye className="w-4 h-4" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div className="px-4 py-3 border-t border-slate-200 bg-slate-50/50">
          <p className="text-xs text-slate-500">{filtered.length} inspection{filtered.length !== 1 ? 's' : ''} shown</p>
        </div>
      </div>

      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title="Create Quality Inspection" size="lg">
        <form onSubmit={handleSave} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">GRN Number</label>
              <select required value={form.grn_id} onChange={(e) => handleGrnChange(e.target.value)} className={inputClass}>
                <option value="">Select GRN</option>
                {grns.map((g) => <option key={g.id} value={g.id}>{g.grn_number}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">Material</label>
              <select required value={form.raw_material_id} onChange={(e) => handleMaterialChange(e.target.value)} className={inputClass} disabled={!form.grn_id}>
                <option value="">Select Material</option>
                {grnItems.map((item) => <option key={item.id} value={item.raw_material_id}>{item.raw_materials?.name}</option>)}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">Batch Number</label>
              <input type="text" required value={form.batch_number} onChange={(e) => setForm({ ...form, batch_number: e.target.value })} className={inputClass} readOnly />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">Inspection Date</label>
              <input type="date" required value={form.inspection_date} onChange={(e) => setForm({ ...form, inspection_date: e.target.value })} className={inputClass} />
            </div>
          </div>

          <div className="border-t border-slate-200 pt-4">
            <h3 className="text-sm font-semibold text-slate-700 mb-3">Quality Parameters</h3>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1.5">Moisture Content (%)</label>
                <input type="number" step="0.1" value={form.moisture_content} onChange={(e) => setForm({ ...form, moisture_content: e.target.value })} className={inputClass} placeholder="e.g. 12.5" />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1.5">Protein Content (%)</label>
                <input type="number" step="0.1" value={form.protein_content} onChange={(e) => setForm({ ...form, protein_content: e.target.value })} className={inputClass} placeholder="e.g. 8.2" />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1.5">Fat Content (%)</label>
                <input type="number" step="0.1" value={form.fat_content} onChange={(e) => setForm({ ...form, fat_content: e.target.value })} className={inputClass} placeholder="Optional" />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1.5">Fiber Content (%)</label>
                <input type="number" step="0.1" value={form.fiber_content} onChange={(e) => setForm({ ...form, fiber_content: e.target.value })} className={inputClass} placeholder="Optional" />
              </div>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5">Result</label>
            <select required value={form.result} onChange={(e) => setForm({ ...form, result: e.target.value })} className={inputClass}>
              <option value="pending">Pending</option>
              <option value="passed">Passed</option>
              <option value="failed">Failed</option>
              <option value="conditional">Conditional</option>
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5">Remarks</label>
            <textarea rows={3} value={form.remarks} onChange={(e) => setForm({ ...form, remarks: e.target.value })} className={inputClass} placeholder="Quality observations and notes..." />
          </div>

          <div className="flex justify-end gap-3 pt-4 border-t border-slate-200">
            <button type="button" onClick={() => setModalOpen(false)} className="px-4 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 transition-colors">Cancel</button>
            <button type="submit" disabled={saving} className="px-4 py-2 text-sm font-semibold text-white bg-teal-600 rounded-lg hover:bg-teal-700 transition-colors disabled:opacity-50">{saving ? 'Saving...' : 'Create Inspection'}</button>
          </div>
        </form>
      </Modal>

      <Modal open={viewModalOpen} onClose={() => { setViewModalOpen(false); fetchData(); }} title="Inspection Details" size="md">
        {viewing && (
          <div className="space-y-6">
            <div className="grid grid-cols-2 gap-4 p-4 bg-slate-50 rounded-lg">
              <div>
                <p className="text-xs text-slate-500 mb-1">GRN Number</p>
                <p className="text-sm font-semibold text-slate-800">{viewing.goods_received_notes?.grn_number || '-'}</p>
              </div>
              {(() => { const control = lotControls[lotKey(viewing.grn_id, viewing.raw_material_id, viewing.batch_number)]; return control ? <div className="col-span-2 rounded-lg border border-slate-200 bg-white p-3"><div className="flex items-center justify-between gap-3"><div className="flex items-center gap-2"><ShieldCheck className="h-4 w-4 text-teal-600" /><span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Lot disposition</span></div><span className={`rounded-full border px-2 py-0.5 text-xs font-semibold ${dispositionStyle[control.disposition]}`}>{control.disposition === 'hold' ? 'On hold' : control.disposition}</span></div><p className="mt-2 text-xs text-slate-600">{Number(control.quantity || 0).toLocaleString()} {control.unit} · {control.hold_reason || (control.disposition === 'released' ? 'Released for use' : 'Controlled by quality workflow')}</p></div> : null; })()}
              <div>
                <p className="text-xs text-slate-500 mb-1">Material</p>
                <p className="text-sm text-slate-700">{viewing.raw_materials?.name || '-'}</p>
              </div>
              <div>
                <p className="text-xs text-slate-500 mb-1">Batch Number</p>
                <p className="text-sm font-mono text-slate-700">{viewing.batch_number}</p>
              </div>
              <div>
                <p className="text-xs text-slate-500 mb-1">Inspection Date</p>
                <p className="text-sm text-slate-700">{format(new Date(viewing.inspection_date), 'dd MMM yyyy')}</p>
              </div>
              <div>
                <p className="text-xs text-slate-500 mb-1">Result</p>
                <StatusBadge status={viewing.status || viewing.result} />
              </div>
            </div>

            <div className="border-t border-slate-200 pt-4">
              <h3 className="text-sm font-semibold text-slate-700 mb-3">Quality Parameters</h3>
              <div className="grid grid-cols-2 gap-4">
                {viewing.moisture_content !== null && (
                  <div className="flex items-center justify-between p-3 bg-slate-50 rounded-lg">
                    <span className="text-sm text-slate-600">Moisture Content</span>
                    <span className="text-sm font-semibold text-slate-800">{viewing.moisture_content}%</span>
                  </div>
                )}
                {viewing.protein_content !== null && (
                  <div className="flex items-center justify-between p-3 bg-slate-50 rounded-lg">
                    <span className="text-sm text-slate-600">Protein Content</span>
                    <span className="text-sm font-semibold text-slate-800">{viewing.protein_content}%</span>
                  </div>
                )}
                {viewing.fat_content !== null && (
                  <div className="flex items-center justify-between p-3 bg-slate-50 rounded-lg">
                    <span className="text-sm text-slate-600">Fat Content</span>
                    <span className="text-sm font-semibold text-slate-800">{viewing.fat_content}%</span>
                  </div>
                )}
                {viewing.fiber_content !== null && (
                  <div className="flex items-center justify-between p-3 bg-slate-50 rounded-lg">
                    <span className="text-sm text-slate-600">Fiber Content</span>
                    <span className="text-sm font-semibold text-slate-800">{viewing.fiber_content}%</span>
                  </div>
                )}
              </div>
            </div>

            {viewing.remarks && (
              <div className="border-t border-slate-200 pt-4">
                <p className="text-xs text-slate-500 mb-2">Remarks</p>
                <p className="text-sm text-slate-700">{viewing.remarks}</p>
              </div>
            )}

            {viewing.rejection_reason && (
              <div className="bg-red-50 border border-red-200 rounded-lg p-3">
                <p className="text-xs font-semibold text-red-800 mb-1">Rejection Reason</p>
                <p className="text-sm text-red-700">{viewing.rejection_reason}</p>
              </div>
            )}

            {viewing.status === 'pending' && (
              <div className="border-t border-slate-200 pt-4">
                <ApprovalButtons
                  entityType="quality_inspection"
                  entityId={viewing.id}
                  currentStatus={viewing.status}
                  approveStatus="passed"
                  rejectStatus="failed"
                  onApproved={() => {
                    void syncViewingLot();
                    setViewModalOpen(false);
                    fetchData();
                  }}
                  onRejected={() => {
                    void syncViewingLot();
                    setViewModalOpen(false);
                    fetchData();
                  }}
                />
              </div>
            )}

            <div className="border-t border-slate-200 pt-4">
              <ApprovalHistory entityType="quality_inspection" entityId={viewing.id} />
            </div>

            <div className="flex justify-end pt-2 border-t border-slate-200">
              <button onClick={() => setViewModalOpen(false)} className="px-4 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 transition-colors">Close</button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
