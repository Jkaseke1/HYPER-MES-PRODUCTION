import { useEffect, useMemo, useState } from 'react';
import { Layers, Plus, Save, Trash2 } from 'lucide-react';
import type { ReconMacropack, ReconMacropackUsage } from '../../types/reconciliation';
import { supabase } from '../../lib/supabase';
import SectionHeader from './SectionHeader';

interface Props {
  macropacks: ReconMacropack[];
  usage: ReconMacropackUsage[];
  onUpdate: () => void;
  readOnly?: boolean;
}

type UsageDraft = Partial<ReconMacropackUsage> & { recon_macropack_id: string };

const defaultDraft = (macropackId: string): UsageDraft => ({
  recon_macropack_id: macropackId,
  ingredient_name: '',
  raw_material_id: null,
  quantity_used: 0,
  unit: 'kg',
});

export default function MacropackUsageTable({ macropacks, usage, onUpdate, readOnly }: Props) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<Partial<ReconMacropackUsage>>({});
  const [drafts, setDrafts] = useState<Record<string, UsageDraft>>({});
  const [savingId, setSavingId] = useState<string | null>(null);
  const [rawMaterials, setRawMaterials] = useState<{ id: string; name: string }[]>([]);

  useEffect(() => {
    let mounted = true;
    supabase
      .from('raw_materials')
      .select('id, name')
      .order('name')
      .then((res) => {
        if (!mounted) return;
        setRawMaterials(res.data || []);
      });
    return () => {
      mounted = false;
    };
  }, []);

  const usageByMacropack = useMemo(() => {
    return macropacks.reduce<Record<string, ReconMacropackUsage[]>>((acc, macro) => {
      acc[macro.id] = usage.filter((u) => u.recon_macropack_id === macro.id);
      return acc;
    }, {});
  }, [macropacks, usage]);

  function startDraft(macropackId: string) {
    setDrafts((prev) => ({ ...prev, [macropackId]: prev[macropackId] || defaultDraft(macropackId) }));
  }

  function cancelDraft(macropackId: string) {
    setDrafts((prev) => {
      const { [macropackId]: _removed, ...rest } = prev;
      return rest;
    });
  }

  async function handleCreate(macropackId: string) {
    const draft = drafts[macropackId];
    if (!draft?.ingredient_name) return;
    setSavingId(`new-${macropackId}`);
    await supabase.from('recon_macropack_usage').insert({
      recon_macropack_id: macropackId,
      ingredient_name: draft.ingredient_name,
      raw_material_id: draft.raw_material_id || null,
      quantity_used: draft.quantity_used || 0,
      unit: draft.unit || 'kg',
    });
    setSavingId(null);
    cancelDraft(macropackId);
    onUpdate();
  }

  function startEdit(item: ReconMacropackUsage) {
    setEditingId(item.id);
    setEditForm({ ...item });
  }

  async function handleSaveEdit() {
    if (!editingId) return;
    setSavingId(editingId);
    const { id: _id, created_at: _c, ...rest } = editForm as ReconMacropackUsage;
    await supabase
      .from('recon_macropack_usage')
      .update({
        ingredient_name: rest.ingredient_name,
        raw_material_id: rest.raw_material_id || null,
        quantity_used: rest.quantity_used || 0,
        unit: rest.unit || 'kg',
      })
      .eq('id', editingId);
    setSavingId(null);
    setEditingId(null);
    onUpdate();
  }

  async function handleDelete(id: string) {
    await supabase.from('recon_macropack_usage').delete().eq('id', id);
    onUpdate();
  }

  function getRMName(id: string | null) {
    if (!id) return null;
    return rawMaterials.find((rm) => rm.id === id)?.name || null;
  }

  return (
    <div className="bg-white rounded-xl border border-slate-200">
      <div className="p-5 border-b border-slate-100">
        <SectionHeader
          title="Macropack Ingredient Usage"
          subtitle="Track actual ingredient draws per macropack"
          icon={<Layers className="w-5 h-5" />}
        />
      </div>

      <div className="divide-y divide-slate-100">
        {macropacks.map((macro) => {
          const rows = usageByMacropack[macro.id] || [];
          const draft = drafts[macro.id];
          const totalQty = rows.reduce((sum, r) => sum + (r.quantity_used || 0), 0) + (draft?.quantity_used || 0);
          return (
            <div key={macro.id} className="p-5">
              <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-2 mb-4">
                <div>
                  <p className="text-sm text-slate-500">Macropack</p>
                  <h4 className="text-lg font-semibold text-slate-800">{macro.macropack_name}</h4>
                </div>
                {!readOnly && (
                  <button
                    onClick={() => startDraft(macro.id)}
                    className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-teal-700 bg-teal-50 border border-teal-200 rounded-lg hover:bg-teal-100 transition-colors"
                  >
                    <Plus className="w-4 h-4" /> Add Ingredient
                  </button>
                )}
              </div>

              <div className="overflow-x-auto rounded-xl border border-slate-200">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-slate-50 text-left text-xs font-semibold text-slate-600 uppercase tracking-wider">
                      <th className="px-4 py-3">Ingredient</th>
                      <th className="px-4 py-3">Quantity Used</th>
                      <th className="px-4 py-3">Unit</th>
                      <th className="px-4 py-3 w-32">Raw Material</th>
                      <th className="px-4 py-3 w-12" />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {rows.map((item) => (
                      <tr key={item.id} className="hover:bg-slate-50/50">
                        {editingId === item.id ? (
                          <>
                            <td className="px-4 py-2">
                              <input
                                type="text"
                                value={editForm.ingredient_name || ''}
                                onChange={(e) => setEditForm({ ...editForm, ingredient_name: e.target.value })}
                                className="w-full px-2 py-1 border rounded"
                              />
                            </td>
                            <td className="px-4 py-2">
                              <input
                                type="number"
                                step="0.01"
                                value={editForm.quantity_used ?? 0}
                                onChange={(e) => setEditForm({ ...editForm, quantity_used: parseFloat(e.target.value) || 0 })}
                                className="w-28 px-2 py-1 border rounded text-right"
                              />
                            </td>
                            <td className="px-4 py-2">
                              <input
                                type="text"
                                value={editForm.unit || 'kg'}
                                onChange={(e) => setEditForm({ ...editForm, unit: e.target.value })}
                                className="w-20 px-2 py-1 border rounded"
                              />
                            </td>
                            <td className="px-4 py-2">
                              <select
                                value={editForm.raw_material_id || ''}
                                onChange={(e) => setEditForm({ ...editForm, raw_material_id: e.target.value || null })}
                                className="w-full px-2 py-1 border rounded text-sm"
                              >
                                <option value="">Unlinked</option>
                                {rawMaterials.map((rm) => (
                                  <option key={rm.id} value={rm.id}>{rm.name}</option>
                                ))}
                              </select>
                            </td>
                            <td className="px-4 py-2 text-right">
                              <button
                                onClick={handleSaveEdit}
                                disabled={savingId === item.id}
                                className="p-1.5 text-teal-600 hover:bg-teal-50 rounded"
                              >
                                <Save className="w-4 h-4" />
                              </button>
                            </td>
                          </>
                        ) : (
                          <>
                            <td className="px-4 py-3 font-medium text-slate-800">
                              {item.ingredient_name}
                              {getRMName(item.raw_material_id) && (
                                <span className="ml-2 text-xs text-slate-500">({getRMName(item.raw_material_id)})</span>
                              )}
                            </td>
                            <td className="px-4 py-3 text-right tabular-nums">{item.quantity_used?.toLocaleString()}</td>
                            <td className="px-4 py-3 text-slate-600">{item.unit}</td>
                            <td className="px-4 py-3 text-slate-500 text-xs">
                              {item.raw_material_id ? getRMName(item.raw_material_id) || 'Linked RM' : 'Unlinked'}
                            </td>
                            <td className="px-4 py-3 text-right">
                              {!readOnly && (
                                <div className="flex items-center justify-end gap-2">
                                  <button onClick={() => startEdit(item)} className="text-slate-400 hover:text-teal-600 text-xs font-medium">Edit</button>
                                  <button onClick={() => handleDelete(item.id)} className="p-1 text-slate-400 hover:text-red-500 rounded hover:bg-red-50">
                                    <Trash2 className="w-3.5 h-3.5" />
                                  </button>
                                </div>
                              )}
                            </td>
                          </>
                        )}
                      </tr>
                    ))}

                    {draft && (
                      <tr className="bg-teal-50/30">
                        <td className="px-4 py-2">
                          <input
                            type="text"
                            value={draft.ingredient_name || ''}
                            onChange={(e) => setDrafts((prev) => ({ ...prev, [macro.id]: { ...draft, ingredient_name: e.target.value } }))}
                            className="w-full px-2 py-1 border rounded"
                            placeholder="Ingredient name"
                          />
                        </td>
                        <td className="px-4 py-2">
                          <input
                            type="number"
                            step="0.01"
                            value={draft.quantity_used ?? 0}
                            onChange={(e) => setDrafts((prev) => ({ ...prev, [macro.id]: { ...draft, quantity_used: parseFloat(e.target.value) || 0 } }))}
                            className="w-28 px-2 py-1 border rounded text-right"
                          />
                        </td>
                        <td className="px-4 py-2">
                          <input
                            type="text"
                            value={draft.unit || 'kg'}
                            onChange={(e) => setDrafts((prev) => ({ ...prev, [macro.id]: { ...draft, unit: e.target.value } }))}
                            className="w-20 px-2 py-1 border rounded"
                          />
                        </td>
                        <td className="px-4 py-2">
                          <select
                            value={draft.raw_material_id || ''}
                            onChange={(e) => setDrafts((prev) => ({ ...prev, [macro.id]: { ...draft, raw_material_id: e.target.value || null } }))}
                            className="w-full px-2 py-1 border rounded text-sm"
                          >
                            <option value="">Unlinked</option>
                            {rawMaterials.map((rm) => (
                              <option key={rm.id} value={rm.id}>{rm.name}</option>
                            ))}
                          </select>
                        </td>
                        <td className="px-4 py-2 text-right">
                          <div className="flex items-center justify-end gap-2">
                            <button
                              onClick={() => handleCreate(macro.id)}
                              disabled={!draft.ingredient_name || savingId === `new-${macro.id}`}
                              className="p-1.5 text-teal-600 hover:bg-teal-100 rounded disabled:opacity-40"
                            >
                              <Save className="w-4 h-4" />
                            </button>
                            <button onClick={() => cancelDraft(macro.id)} className="p-1.5 text-slate-400 hover:bg-slate-100 rounded">
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    )}

                    {!rows.length && !draft && (
                      <tr>
                        <td colSpan={5} className="px-4 py-6 text-center text-slate-400 text-sm">
                          No ingredient usage recorded for this macropack.
                        </td>
                      </tr>
                    )}
                  </tbody>
                  <tfoot>
                    <tr className="bg-slate-50 text-sm font-semibold text-slate-700">
                      <td className="px-4 py-3">Total</td>
                      <td className="px-4 py-3 text-right tabular-nums">{totalQty.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 })}</td>
                      <td className="px-4 py-3">{rows[0]?.unit || draft?.unit || 'kg'}</td>
                      <td colSpan={2} />
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>
          );
        })}

        {!macropacks.length && (
          <div className="p-6 text-center text-slate-400 text-sm">Add macropacks first to track ingredient usage.</div>
        )}
      </div>
    </div>
  );
}
