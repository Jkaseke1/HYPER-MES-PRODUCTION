import { useState } from 'react';
import { Plus, Save, Trash2, Package } from 'lucide-react';
import type { ReconRawMaterial } from '../../types/reconciliation';
import { supabase } from '../../lib/supabase';
import VarianceCell from './VarianceCell';
import SectionHeader from './SectionHeader';

interface Props {
  items: ReconRawMaterial[];
  periodId: string;
  materialType: 'minivits' | 'bulk';
  title: string;
  subtitle: string;
  onUpdate: () => void;
  readOnly?: boolean;
}

const emptyRow = (periodId: string, materialType: 'minivits' | 'bulk'): Partial<ReconRawMaterial> => ({
  period_id: periodId,
  material_type: materialType,
  material_name: '',
  opening_stock: 0,
  stock_receipts: 0,
  total: 0,
  issues: 0,
  physical_stock: 0,
  system_stock: 0,
  material_variance: 0,
  variance_pct: 0,
  comments: '',
});

export default function RawMaterialsReconTable({ items, periodId, materialType, title, subtitle, onUpdate, readOnly }: Props) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<Partial<ReconRawMaterial>>({});
  const [adding, setAdding] = useState(false);
  const [newRow, setNewRow] = useState<Partial<ReconRawMaterial>>(emptyRow(periodId, materialType));
  const [saving, setSaving] = useState(false);

  function calcRow(row: Partial<ReconRawMaterial>) {
    const total = (row.opening_stock || 0) + (row.stock_receipts || 0);
    const variance = (row.physical_stock || 0) - (row.system_stock || 0);
    const pct = (row.system_stock || 0) !== 0 ? (variance / (row.system_stock || 1)) * 100 : 0;
    return { ...row, total, material_variance: variance, variance_pct: pct };
  }

  async function handleSaveNew() {
    setSaving(true);
    const calculated = calcRow(newRow);
    await supabase.from('recon_raw_materials').insert(calculated);
    setSaving(false);
    setAdding(false);
    setNewRow(emptyRow(periodId, materialType));
    onUpdate();
  }

  async function handleSaveEdit() {
    if (!editingId) return;
    setSaving(true);
    const calculated = calcRow(editForm);
    const { id: _id, created_at: _c, updated_at: _u, ...rest } = calculated as ReconRawMaterial;
    await supabase.from('recon_raw_materials').update(rest).eq('id', editingId);
    setSaving(false);
    setEditingId(null);
    onUpdate();
  }

  async function handleDelete(id: string) {
    await supabase.from('recon_raw_materials').delete().eq('id', id);
    onUpdate();
  }

  function startEdit(item: ReconRawMaterial) {
    setEditingId(item.id);
    setEditForm({ ...item });
  }

  const totalOpening = items.reduce((s, i) => s + i.opening_stock, 0);
  const totalReceipts = items.reduce((s, i) => s + i.stock_receipts, 0);
  const totalTotal = items.reduce((s, i) => s + i.total, 0);
  const totalIssues = items.reduce((s, i) => s + i.issues, 0);
  const totalPhysical = items.reduce((s, i) => s + i.physical_stock, 0);
  const totalSystem = items.reduce((s, i) => s + i.system_stock, 0);
  const totalVariance = totalPhysical - totalSystem;

  return (
    <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
      <div className="p-5">
        <SectionHeader
          title={title}
          subtitle={subtitle}
          icon={<Package className="w-5 h-5" />}
          actions={
            !readOnly ? (
              <button
                onClick={() => setAdding(true)}
                className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-white bg-teal-600 rounded-lg hover:bg-teal-700 transition-colors"
              >
                <Plus className="w-4 h-4" /> Add Row
              </button>
            ) : undefined
          }
        />
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-slate-50 border-y border-slate-200">
              {['Material', 'Opening Stock', 'Receipts', 'Total', 'Issues', 'Physical Stock', 'System Stock', 'Variance', 'Variance %', 'Comments', ''].map((h) => (
                <th key={h} className="px-4 py-3 text-left font-semibold text-slate-600 text-xs uppercase tracking-wider whitespace-nowrap">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {items.map((item) => {
              if (editingId === item.id) {
                return (
                  <tr key={item.id} className="bg-teal-50/30">
                    <td className="px-4 py-2">
                      <input type="text" value={editForm.material_name || ''} onChange={(e) => setEditForm({ ...editForm, material_name: e.target.value })} className="w-40 px-2 py-1 border rounded text-sm" />
                    </td>
                    {(['opening_stock', 'stock_receipts', 'total', 'issues', 'physical_stock', 'system_stock'] as const).map((f) => (
                      <td key={f} className="px-4 py-2">
                        {f === 'total' ? (
                          <span className="text-sm font-medium">{((editForm.opening_stock || 0) + (editForm.stock_receipts || 0)).toLocaleString()}</span>
                        ) : (
                          <input
                            type="number"
                            step="0.01"
                            value={editForm[f] || 0}
                            onChange={(e) => setEditForm({ ...editForm, [f]: parseFloat(e.target.value) || 0 })}
                            className="w-24 px-2 py-1 border rounded text-sm text-right"
                          />
                        )}
                      </td>
                    ))}
                    <td className="px-4 py-2"><VarianceCell value={(editForm.physical_stock || 0) - (editForm.system_stock || 0)} /></td>
                    <td className="px-4 py-2"><VarianceCell value={(editForm.system_stock || 0) !== 0 ? (((editForm.physical_stock || 0) - (editForm.system_stock || 0)) / (editForm.system_stock || 1)) * 100 : 0} format="percentage" /></td>
                    <td className="px-4 py-2">
                      <input type="text" value={editForm.comments || ''} onChange={(e) => setEditForm({ ...editForm, comments: e.target.value })} className="w-32 px-2 py-1 border rounded text-sm" />
                    </td>
                    <td className="px-4 py-2">
                      <button onClick={handleSaveEdit} disabled={saving} className="p-1.5 text-teal-600 hover:bg-teal-50 rounded">
                        <Save className="w-4 h-4" />
                      </button>
                    </td>
                  </tr>
                );
              }
              return (
                <tr
                  key={item.id}
                  className="hover:bg-slate-50/50 transition-colors cursor-pointer"
                  onClick={() => !readOnly && startEdit(item)}
                >
                  <td className="px-4 py-3 font-medium text-slate-800">{item.material_name}</td>
                  <td className="px-4 py-3 text-right tabular-nums">{item.opening_stock.toLocaleString()}</td>
                  <td className="px-4 py-3 text-right tabular-nums">{item.stock_receipts.toLocaleString()}</td>
                  <td className="px-4 py-3 text-right tabular-nums font-medium">{item.total.toLocaleString()}</td>
                  <td className="px-4 py-3 text-right tabular-nums">{item.issues.toLocaleString()}</td>
                  <td className="px-4 py-3 text-right tabular-nums">{item.physical_stock.toLocaleString()}</td>
                  <td className="px-4 py-3 text-right tabular-nums">{item.system_stock.toLocaleString()}</td>
                  <td className="px-4 py-3"><VarianceCell value={item.material_variance} /></td>
                  <td className="px-4 py-3"><VarianceCell value={item.variance_pct} format="percentage" /></td>
                  <td className="px-4 py-3 text-slate-500 text-xs max-w-[160px] truncate">{item.comments}</td>
                  <td className="px-4 py-3">
                    {!readOnly && (
                      <button onClick={(e) => { e.stopPropagation(); handleDelete(item.id); }} className="p-1 text-slate-400 hover:text-red-500 rounded hover:bg-red-50">
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}

            {adding && (
              <tr className="bg-teal-50/30">
                <td className="px-4 py-2">
                  <input type="text" value={newRow.material_name || ''} onChange={(e) => setNewRow({ ...newRow, material_name: e.target.value })} className="w-40 px-2 py-1 border rounded text-sm" placeholder="Material name" />
                </td>
                {(['opening_stock', 'stock_receipts', 'total', 'issues', 'physical_stock', 'system_stock'] as const).map((f) => (
                  <td key={f} className="px-4 py-2">
                    {f === 'total' ? (
                      <span className="text-sm font-medium">{((newRow.opening_stock || 0) + (newRow.stock_receipts || 0)).toLocaleString()}</span>
                    ) : (
                      <input
                        type="number"
                        step="0.01"
                        value={newRow[f] || 0}
                        onChange={(e) => setNewRow({ ...newRow, [f]: parseFloat(e.target.value) || 0 })}
                        className="w-24 px-2 py-1 border rounded text-sm text-right"
                      />
                    )}
                  </td>
                ))}
                <td className="px-4 py-2"><VarianceCell value={(newRow.physical_stock || 0) - (newRow.system_stock || 0)} /></td>
                <td className="px-4 py-2"><VarianceCell value={0} format="percentage" /></td>
                <td className="px-4 py-2">
                  <input type="text" value={newRow.comments || ''} onChange={(e) => setNewRow({ ...newRow, comments: e.target.value })} className="w-32 px-2 py-1 border rounded text-sm" />
                </td>
                <td className="px-4 py-2 flex gap-1">
                  <button onClick={handleSaveNew} disabled={saving || !newRow.material_name} className="p-1.5 text-teal-600 hover:bg-teal-100 rounded disabled:opacity-40">
                    <Save className="w-4 h-4" />
                  </button>
                  <button onClick={() => { setAdding(false); setNewRow(emptyRow(periodId, materialType)); }} className="p-1.5 text-slate-400 hover:bg-slate-100 rounded">
                    <Trash2 className="w-4 h-4" />
                  </button>
                </td>
              </tr>
            )}
          </tbody>
          <tfoot>
            <tr className="bg-slate-100 font-semibold text-slate-700 border-t-2 border-slate-300">
              <td className="px-4 py-3">TOTALS</td>
              <td className="px-4 py-3 text-right tabular-nums">{totalOpening.toLocaleString()}</td>
              <td className="px-4 py-3 text-right tabular-nums">{totalReceipts.toLocaleString()}</td>
              <td className="px-4 py-3 text-right tabular-nums">{totalTotal.toLocaleString()}</td>
              <td className="px-4 py-3 text-right tabular-nums">{totalIssues.toLocaleString()}</td>
              <td className="px-4 py-3 text-right tabular-nums">{totalPhysical.toLocaleString()}</td>
              <td className="px-4 py-3 text-right tabular-nums">{totalSystem.toLocaleString()}</td>
              <td className="px-4 py-3"><VarianceCell value={totalVariance} /></td>
              <td className="px-4 py-3" />
              <td className="px-4 py-3" />
              <td className="px-4 py-3" />
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}
