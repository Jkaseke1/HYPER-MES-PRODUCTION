import { useState } from 'react';
import { Plus, Save, Trash2, Factory } from 'lucide-react';
import type { ReconProduction } from '../../types/reconciliation';
import { supabase } from '../../lib/supabase';
import VarianceCell from './VarianceCell';
import SectionHeader from './SectionHeader';

interface Props {
  items: ReconProduction[];
  periodId: string;
  productionType: 'bulk' | 'packaging';
  title: string;
  subtitle: string;
  onUpdate: () => void;
  readOnly?: boolean;
}

const emptyRow = (periodId: string, productionType: 'bulk' | 'packaging'): Partial<ReconProduction> => ({
  period_id: periodId,
  production_type: productionType,
  product_name: '',
  opening_stock: 0,
  stock_received: 0,
  total: 0,
  expected_production: 0,
  conversion_produced: 0,
  wastage: 0,
  closing_stock: 0,
  physical_stock: 0,
  system_stock: 0,
  material_variance: 0,
  variance_pct: 0,
  bag_size_kg: 0,
  expected_bags: 0,
  physical_bags: 0,
  system_bags: 0,
  bag_variance: 0,
  bag_variance_pct: 0,
  comments: '',
});

export default function ProductionReconTable({ items, periodId, productionType, title, subtitle, onUpdate, readOnly }: Props) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<Partial<ReconProduction>>({});
  const [adding, setAdding] = useState(false);
  const [newRow, setNewRow] = useState<Partial<ReconProduction>>(emptyRow(periodId, productionType));
  const [saving, setSaving] = useState(false);

  const trackBags = productionType === 'packaging';

  function calcRow(row: Partial<ReconProduction>) {
    const total = (row.opening_stock || 0) + (row.stock_received || 0);
    const variance = (row.physical_stock || 0) - (row.system_stock || 0);
    const pct = (row.system_stock || 0) !== 0 ? (variance / (row.system_stock || 1)) * 100 : 0;
    const bagVariance = (row.physical_bags || 0) - (row.system_bags || 0);
    const bagVariancePct = (row.system_bags || 0) !== 0 ? (bagVariance / (row.system_bags || 1)) * 100 : 0;
    return {
      ...row,
      total,
      material_variance: variance,
      variance_pct: pct,
      bag_variance: trackBags ? bagVariance : 0,
      bag_variance_pct: trackBags ? bagVariancePct : 0,
    };
  }

  async function handleSaveNew() {
    setSaving(true);
    const calculated = calcRow(newRow);
    await supabase.from('recon_production').insert(calculated);
    setSaving(false);
    setAdding(false);
    setNewRow(emptyRow(periodId, productionType));
    onUpdate();
  }

  async function handleSaveEdit() {
    if (!editingId) return;
    setSaving(true);
    const calculated = calcRow(editForm);
    const { id: _id, created_at: _c, updated_at: _u, ...rest } = calculated as ReconProduction;
    await supabase.from('recon_production').update(rest).eq('id', editingId);
    setSaving(false);
    setEditingId(null);
    onUpdate();
  }

  async function handleDelete(id: string) {
    await supabase.from('recon_production').delete().eq('id', id);
    onUpdate();
  }

  function startEdit(item: ReconProduction) {
    setEditingId(item.id);
    setEditForm({ ...item });
  }

  const numFields = ['opening_stock', 'stock_received', 'total', 'expected_production', 'conversion_produced', 'wastage', 'closing_stock', 'physical_stock', 'system_stock'] as const;
  const bagValueFields = trackBags ? ['expected_bags', 'physical_bags', 'system_bags'] as const : [];
  const headers = [
    'Product', 'Opening', 'Received', 'Total', 'Expected', 'Produced', 'Wastage', 'Closing', 'Physical (T)', 'System (T)',
    'Variance', 'Var %',
    ...(trackBags ? ['Bag Size (kg)', 'Exp Bags', 'Physical Bags', 'System Bags', 'Bag Var', 'Bag Var %'] : []),
    'Comments', '',
  ];

  const totals = [...numFields, ...bagValueFields].reduce((acc, f) => {
    acc[f] = items.reduce((s, i) => s + i[f], 0);
    return acc;
  }, {} as Record<string, number>);

  return (
    <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
      <div className="p-5">
        <SectionHeader
          title={title}
          subtitle={subtitle}
          icon={<Factory className="w-5 h-5" />}
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
                <th key={h} className="px-3 py-3 text-left font-semibold text-slate-600 text-xs uppercase tracking-wider whitespace-nowrap">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {items.map((item) => {
              if (editingId === item.id) {
                return (
                  <tr key={item.id} className="bg-teal-50/30">
                    <td className="px-3 py-2">
                      <input type="text" value={editForm.product_name || ''} onChange={(e) => setEditForm({ ...editForm, product_name: e.target.value })} className="w-36 px-2 py-1 border rounded text-sm" />
                    </td>
                    {numFields.map((f) => (
                      <td key={f} className="px-3 py-2">
                        {f === 'total' ? (
                          <span className="text-sm font-medium">{((editForm.opening_stock || 0) + (editForm.stock_received || 0)).toLocaleString()}</span>
                        ) : (
                          <input type="number" step="0.01" value={editForm[f] || 0} onChange={(e) => setEditForm({ ...editForm, [f]: parseFloat(e.target.value) || 0 })} className="w-20 px-2 py-1 border rounded text-sm text-right" />
                        )}
                      </td>
                    ))}
                    <td className="px-3 py-2"><VarianceCell value={(editForm.physical_stock || 0) - (editForm.system_stock || 0)} /></td>
                    <td className="px-3 py-2"><VarianceCell value={(editForm.system_stock || 0) !== 0 ? (((editForm.physical_stock || 0) - (editForm.system_stock || 0)) / (editForm.system_stock || 1)) * 100 : 0} format="percentage" /></td>
                    {trackBags && (
                      <>
                        <td className="px-3 py-2"><input type="number" step="0.01" value={editForm.bag_size_kg || 0} onChange={(e) => setEditForm({ ...editForm, bag_size_kg: parseFloat(e.target.value) || 0 })} className="w-20 px-2 py-1 border rounded text-sm text-right" /></td>
                        {bagValueFields.map((f) => (
                          <td key={f} className="px-3 py-2">
                            <input type="number" step="0.01" value={editForm[f] || 0} onChange={(e) => setEditForm({ ...editForm, [f]: parseFloat(e.target.value) || 0 })} className="w-20 px-2 py-1 border rounded text-sm text-right" />
                          </td>
                        ))}
                        <td className="px-3 py-2"><VarianceCell value={(editForm.physical_bags || 0) - (editForm.system_bags || 0)} /></td>
                        <td className="px-3 py-2"><VarianceCell value={(editForm.system_bags || 0) !== 0 ? (((editForm.physical_bags || 0) - (editForm.system_bags || 0)) / (editForm.system_bags || 1)) * 100 : 0} format="percentage" /></td>
                      </>
                    )}
                    <td className="px-3 py-2"><input type="text" value={editForm.comments || ''} onChange={(e) => setEditForm({ ...editForm, comments: e.target.value })} className="w-28 px-2 py-1 border rounded text-sm" /></td>
                    <td className="px-3 py-2">
                      <button onClick={handleSaveEdit} disabled={saving} className="p-1.5 text-teal-600 hover:bg-teal-50 rounded"><Save className="w-4 h-4" /></button>
                    </td>
                  </tr>
                );
              }
              return (
                <tr key={item.id} className="hover:bg-slate-50/50 transition-colors cursor-pointer" onClick={() => !readOnly && startEdit(item)}>
                  <td className="px-3 py-3 font-medium text-slate-800 whitespace-nowrap">{item.product_name}</td>
                  {numFields.map((f) => (
                    <td key={f} className={`px-3 py-3 text-right tabular-nums ${f === 'total' ? 'font-medium' : ''}`}>{item[f].toLocaleString()}</td>
                  ))}
                  <td className="px-3 py-3"><VarianceCell value={item.material_variance} /></td>
                  <td className="px-3 py-3"><VarianceCell value={item.variance_pct} format="percentage" /></td>
                  {trackBags && (
                    <>
                      <td className="px-3 py-3 text-right tabular-nums text-slate-600">{item.bag_size_kg?.toLocaleString()}</td>
                      {bagValueFields.map((f) => (
                        <td key={f} className="px-3 py-3 text-right tabular-nums">{item[f].toLocaleString()}</td>
                      ))}
                      <td className="px-3 py-3"><VarianceCell value={item.bag_variance} /></td>
                      <td className="px-3 py-3"><VarianceCell value={item.bag_variance_pct} format="percentage" /></td>
                    </>
                  )}
                  <td className="px-3 py-3 text-slate-500 text-xs max-w-[140px] truncate">{item.comments}</td>
                  <td className="px-3 py-3">
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
                <td className="px-3 py-2">
                  <input type="text" value={newRow.product_name || ''} onChange={(e) => setNewRow({ ...newRow, product_name: e.target.value })} className="w-36 px-2 py-1 border rounded text-sm" placeholder="Product name" />
                </td>
                {numFields.map((f) => (
                  <td key={f} className="px-3 py-2">
                    {f === 'total' ? (
                      <span className="text-sm font-medium">{((newRow.opening_stock || 0) + (newRow.stock_received || 0)).toLocaleString()}</span>
                    ) : (
                      <input type="number" step="0.01" value={newRow[f] || 0} onChange={(e) => setNewRow({ ...newRow, [f]: parseFloat(e.target.value) || 0 })} className="w-20 px-2 py-1 border rounded text-sm text-right" />
                    )}
                  </td>
                ))}
                <td className="px-3 py-2"><VarianceCell value={0} /></td>
                <td className="px-3 py-2"><VarianceCell value={0} format="percentage" /></td>
                {trackBags && (
                  <>
                    <td className="px-3 py-2"><input type="number" step="0.01" value={newRow.bag_size_kg || 0} onChange={(e) => setNewRow({ ...newRow, bag_size_kg: parseFloat(e.target.value) || 0 })} className="w-20 px-2 py-1 border rounded text-sm text-right" /></td>
                    {bagValueFields.map((f) => (
                      <td key={f} className="px-3 py-2">
                        <input type="number" step="0.01" value={newRow[f] || 0} onChange={(e) => setNewRow({ ...newRow, [f]: parseFloat(e.target.value) || 0 })} className="w-20 px-2 py-1 border rounded text-sm text-right" />
                      </td>
                    ))}
                    <td className="px-3 py-2"><VarianceCell value={0} /></td>
                    <td className="px-3 py-2"><VarianceCell value={0} format="percentage" /></td>
                  </>
                )}
                <td className="px-3 py-2"><input type="text" value={newRow.comments || ''} onChange={(e) => setNewRow({ ...newRow, comments: e.target.value })} className="w-28 px-2 py-1 border rounded text-sm" /></td>
                <td className="px-3 py-2 flex gap-1">
                  <button onClick={handleSaveNew} disabled={saving || !newRow.product_name} className="p-1.5 text-teal-600 hover:bg-teal-100 rounded disabled:opacity-40"><Save className="w-4 h-4" /></button>
                  <button onClick={() => { setAdding(false); setNewRow(emptyRow(periodId, productionType)); }} className="p-1.5 text-slate-400 hover:bg-slate-100 rounded"><Trash2 className="w-4 h-4" /></button>
                </td>
              </tr>
            )}
          </tbody>
          <tfoot>
            <tr className="bg-slate-100 font-semibold text-slate-700 border-t-2 border-slate-300">
              <td className="px-3 py-3">TOTALS</td>
              {numFields.map((f) => (
                <td key={f} className="px-3 py-3 text-right tabular-nums">{(totals[f] || 0).toLocaleString()}</td>
              ))}
              <td className="px-3 py-3"><VarianceCell value={(totals['physical_stock'] || 0) - (totals['system_stock'] || 0)} /></td>
              <td className="px-3 py-3" />
              {trackBags && (
                <>
                  <td className="px-3 py-3 text-xs text-slate-500">—</td>
                  {bagValueFields.map((f) => (
                    <td key={f} className="px-3 py-3 text-right tabular-nums">{(totals[f] || 0).toLocaleString()}</td>
                  ))}
                  <td className="px-3 py-3"><VarianceCell value={(totals['physical_bags'] || 0) - (totals['system_bags'] || 0)} /></td>
                  <td className="px-3 py-3" />
                </>
              )}
              <td className="px-3 py-3" />
              <td className="px-3 py-3" />
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}
