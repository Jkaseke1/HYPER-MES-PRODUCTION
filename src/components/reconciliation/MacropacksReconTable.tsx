import { useState } from 'react';
import { Plus, Save, Trash2, Layers } from 'lucide-react';
import type { ReconMacropack } from '../../types/reconciliation';
import { supabase } from '../../lib/supabase';
import VarianceCell from './VarianceCell';
import SectionHeader from './SectionHeader';

interface Props {
  items: ReconMacropack[];
  periodId: string;
  onUpdate: () => void;
  readOnly?: boolean;
}

const emptyRow = (periodId: string): Partial<ReconMacropack> => ({
  period_id: periodId,
  macropack_name: '',
  opening_stock: 0,
  manufactured_units: 0,
  total_units: 0,
  converted_units: 0,
  closing_stock: 0,
  system_units: 0,
  material_variance: 0,
  variance_pct: 0,
  comments: '',
});

export default function MacropacksReconTable({ items, periodId, onUpdate, readOnly }: Props) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<Partial<ReconMacropack>>({});
  const [adding, setAdding] = useState(false);
  const [newRow, setNewRow] = useState<Partial<ReconMacropack>>(emptyRow(periodId));
  const [saving, setSaving] = useState(false);

  function calcRow(row: Partial<ReconMacropack>) {
    const total = (row.opening_stock || 0) + (row.manufactured_units || 0);
    const variance = (row.closing_stock || 0) - (row.system_units || 0);
    const pct = (row.system_units || 0) !== 0 ? (variance / (row.system_units || 1)) * 100 : 0;
    return { ...row, total_units: total, material_variance: variance, variance_pct: pct };
  }

  async function handleSaveNew() {
    setSaving(true);
    await supabase.from('recon_macropacks').insert(calcRow(newRow));
    setSaving(false);
    setAdding(false);
    setNewRow(emptyRow(periodId));
    onUpdate();
  }

  async function handleSaveEdit() {
    if (!editingId) return;
    setSaving(true);
    const calculated = calcRow(editForm);
    const { id: _id, created_at: _c, updated_at: _u, ...rest } = calculated as ReconMacropack;
    await supabase.from('recon_macropacks').update(rest).eq('id', editingId);
    setSaving(false);
    setEditingId(null);
    onUpdate();
  }

  async function handleDelete(id: string) {
    await supabase.from('recon_macropacks').delete().eq('id', id);
    onUpdate();
  }

  function startEdit(item: ReconMacropack) {
    setEditingId(item.id);
    setEditForm({ ...item });
  }

  const numFields = ['opening_stock', 'manufactured_units', 'total_units', 'converted_units', 'closing_stock', 'system_units'] as const;
  const headers = ['Macropack', 'Opening', 'Manufactured', 'Total', 'Converted', 'Closing', 'System', 'Variance', 'Var %', 'Comments', ''];

  const totals = numFields.reduce((acc, f) => {
    acc[f] = items.reduce((s, i) => s + i[f], 0);
    return acc;
  }, {} as Record<string, number>);

  return (
    <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
      <div className="p-5">
        <SectionHeader
          title="Macropacks Production"
          subtitle="Macropack manufactured, converted, and stock reconciliation"
          icon={<Layers className="w-5 h-5" />}
          actions={
            !readOnly ? (
              <button onClick={() => setAdding(true)} className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-white bg-teal-600 rounded-lg hover:bg-teal-700 transition-colors">
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
              {headers.map((h) => (
                <th key={h} className="px-4 py-3 text-left font-semibold text-slate-600 text-xs uppercase tracking-wider whitespace-nowrap">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {items.map((item) => {
              if (editingId === item.id) {
                return (
                  <tr key={item.id} className="bg-teal-50/30">
                    <td className="px-4 py-2"><input type="text" value={editForm.macropack_name || ''} onChange={(e) => setEditForm({ ...editForm, macropack_name: e.target.value })} className="w-36 px-2 py-1 border rounded text-sm" /></td>
                    {numFields.map((f) => (
                      <td key={f} className="px-4 py-2">
                        {f === 'total_units' ? (
                          <span className="text-sm font-medium">{((editForm.opening_stock || 0) + (editForm.manufactured_units || 0)).toLocaleString()}</span>
                        ) : (
                          <input type="number" step="0.01" value={editForm[f] || 0} onChange={(e) => setEditForm({ ...editForm, [f]: parseFloat(e.target.value) || 0 })} className="w-22 px-2 py-1 border rounded text-sm text-right" />
                        )}
                      </td>
                    ))}
                    <td className="px-4 py-2"><VarianceCell value={(editForm.closing_stock || 0) - (editForm.system_units || 0)} /></td>
                    <td className="px-4 py-2"><VarianceCell value={(editForm.system_units || 0) !== 0 ? (((editForm.closing_stock || 0) - (editForm.system_units || 0)) / (editForm.system_units || 1)) * 100 : 0} format="percentage" /></td>
                    <td className="px-4 py-2"><input type="text" value={editForm.comments || ''} onChange={(e) => setEditForm({ ...editForm, comments: e.target.value })} className="w-28 px-2 py-1 border rounded text-sm" /></td>
                    <td className="px-4 py-2"><button onClick={handleSaveEdit} disabled={saving} className="p-1.5 text-teal-600 hover:bg-teal-50 rounded"><Save className="w-4 h-4" /></button></td>
                  </tr>
                );
              }
              return (
                <tr key={item.id} className="hover:bg-slate-50/50 transition-colors cursor-pointer" onClick={() => !readOnly && startEdit(item)}>
                  <td className="px-4 py-3 font-medium text-slate-800 whitespace-nowrap">{item.macropack_name}</td>
                  {numFields.map((f) => (
                    <td key={f} className={`px-4 py-3 text-right tabular-nums ${f === 'total_units' ? 'font-medium' : ''}`}>{item[f].toLocaleString()}</td>
                  ))}
                  <td className="px-4 py-3"><VarianceCell value={item.material_variance} /></td>
                  <td className="px-4 py-3"><VarianceCell value={item.variance_pct} format="percentage" /></td>
                  <td className="px-4 py-3 text-slate-500 text-xs max-w-[140px] truncate">{item.comments}</td>
                  <td className="px-4 py-3">
                    {!readOnly && (
                      <button onClick={(e) => { e.stopPropagation(); handleDelete(item.id); }} className="p-1 text-slate-400 hover:text-red-500 rounded hover:bg-red-50"><Trash2 className="w-3.5 h-3.5" /></button>
                    )}
                  </td>
                </tr>
              );
            })}

            {adding && (
              <tr className="bg-teal-50/30">
                <td className="px-4 py-2"><input type="text" value={newRow.macropack_name || ''} onChange={(e) => setNewRow({ ...newRow, macropack_name: e.target.value })} className="w-36 px-2 py-1 border rounded text-sm" placeholder="e.g. BRO STARTER" /></td>
                {numFields.map((f) => (
                  <td key={f} className="px-4 py-2">
                    {f === 'total_units' ? (
                      <span className="text-sm font-medium">{((newRow.opening_stock || 0) + (newRow.manufactured_units || 0)).toLocaleString()}</span>
                    ) : (
                      <input type="number" step="0.01" value={newRow[f] || 0} onChange={(e) => setNewRow({ ...newRow, [f]: parseFloat(e.target.value) || 0 })} className="w-22 px-2 py-1 border rounded text-sm text-right" />
                    )}
                  </td>
                ))}
                <td className="px-4 py-2"><VarianceCell value={0} /></td>
                <td className="px-4 py-2"><VarianceCell value={0} format="percentage" /></td>
                <td className="px-4 py-2"><input type="text" value={newRow.comments || ''} onChange={(e) => setNewRow({ ...newRow, comments: e.target.value })} className="w-28 px-2 py-1 border rounded text-sm" /></td>
                <td className="px-4 py-2 flex gap-1">
                  <button onClick={handleSaveNew} disabled={saving || !newRow.macropack_name} className="p-1.5 text-teal-600 hover:bg-teal-100 rounded disabled:opacity-40"><Save className="w-4 h-4" /></button>
                  <button onClick={() => { setAdding(false); setNewRow(emptyRow(periodId)); }} className="p-1.5 text-slate-400 hover:bg-slate-100 rounded"><Trash2 className="w-4 h-4" /></button>
                </td>
              </tr>
            )}
          </tbody>
          <tfoot>
            <tr className="bg-slate-100 font-semibold text-slate-700 border-t-2 border-slate-300">
              <td className="px-4 py-3">TOTALS</td>
              {numFields.map((f) => (
                <td key={f} className="px-4 py-3 text-right tabular-nums">{(totals[f] || 0).toLocaleString()}</td>
              ))}
              <td className="px-4 py-3"><VarianceCell value={(totals['closing_stock'] || 0) - (totals['system_units'] || 0)} /></td>
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
