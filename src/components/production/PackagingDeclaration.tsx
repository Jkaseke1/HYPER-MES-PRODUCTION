import { useState, useEffect } from 'react';
import { Package, AlertTriangle, CheckCircle2, Plus, Trash2, Loader2, Sparkles } from 'lucide-react';
import { supabase } from '../../lib/supabase';

interface PackagingSKU {
  id: string;
  sku_code: string;
  description: string;
  bag_size_kg: number;
  is_active: boolean;
}

interface PackagingLine {
  id: string;
  packaging_sku_id: string;
  bags_used: number;
  implied_tonnes: number;
}

interface PackagingDeclarationProps {
  actualOutputQty: number; // in tonnes
  formulationId?: string;
  unitSize?: string; // e.g. "50", "50kg", "25"
  formulationName?: string; // e.g. "Broiler Starter/Grower 50kg"
  onSave: (lines: PackagingLine[]) => Promise<void>;
  disabled?: boolean;
}

// Extract target bag size (in kg) dynamically from unitSize or formulationName
function extractTargetBagSize(unitSize?: string, formulationName?: string): number {
  if (unitSize) {
    const match = unitSize.match(/(\d+)/);
    if (match) return parseInt(match[1], 10);
  }
  if (formulationName) {
    const match = formulationName.match(/(\d+)\s*kg/i);
    if (match) return parseInt(match[1], 10);
  }
  return 50; // Default to standard 50kg bag
}

export default function PackagingDeclaration({
  actualOutputQty,
  formulationId,
  unitSize,
  formulationName,
  onSave,
  disabled = false
}: PackagingDeclarationProps) {
  const [skus, setSkus] = useState<PackagingSKU[]>([]);
  const [lines, setLines] = useState<PackagingLine[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const targetBagSizeKg = extractTargetBagSize(unitSize, formulationName);

  useEffect(() => {
    fetchSkus();
  }, [actualOutputQty, formulationId, unitSize, formulationName]);

  async function fetchSkus() {
    try {
      setLoading(true);
      const { data, error: err } = await supabase
        .from('packaging_skus')
        .select('*')
        .eq('is_active', true);

      if (err) throw err;
      
      // Sort SKUs dynamically: closest bag size to formulation target first
      const available = (data || []).sort((a, b) => {
        const diffA = Math.abs((Number(a.bag_size_kg) || 0) - targetBagSizeKg);
        const diffB = Math.abs((Number(b.bag_size_kg) || 0) - targetBagSizeKg);
        return diffA - diffB;
      });

      setSkus(available);
      await autoPopulateLines(available);
    } catch (err) {
      console.error('Failed to fetch packaging SKUs:', err);
      setError('Failed to load packaging SKUs');
    } finally {
      setLoading(false);
    }
  }

  async function autoPopulateLines(availableSkus: PackagingSKU[]) {
    if (availableSkus.length === 0) return;

    const initial: PackagingLine[] = [];
    const outputInKg = Math.max(0, actualOutputQty * 1000);

    // 1. Try to match formulation BOM packaging items from database
    if (formulationId) {
      try {
        const { data: bomItems, error: bomErr } = await supabase
          .from('production_bom_packaging')
          .select('*')
          .eq('formulation_id', formulationId);

        if (!bomErr && bomItems && bomItems.length > 0) {
          for (const item of bomItems) {
            const sku = availableSkus.find(
              (s) =>
                s.id === item.packaging_sku_id ||
                s.sku_code?.toLowerCase() === (item.item_code || '').toLowerCase()
            );

            if (sku && sku.bag_size_kg > 0) {
              const bags = outputInKg > 0 ? Math.max(1, Math.round(outputInKg / sku.bag_size_kg)) : 0;
              initial.push({
                id: `bom-${sku.id}-${Date.now()}-${Math.random()}`,
                packaging_sku_id: sku.id,
                bags_used: bags,
                implied_tonnes: (bags * sku.bag_size_kg) / 1000,
              });
            }
          }
        }
      } catch (err) {
        console.error('BOM packaging lookup failed:', err);
      }
    }

    // 2. Dynamic matching from Formulation Name & Unit Size
    if (initial.length === 0) {
      const matchingSizeSkus = availableSkus.filter(
        (s) => Number(s.bag_size_kg) === targetBagSizeKg
      );

      const candidatePool = matchingSizeSkus.length > 0 ? matchingSizeSkus : availableSkus;
      let matchedSku: PackagingSKU | undefined;

      if (formulationName) {
        const cleanName = formulationName.toLowerCase();
        
        // Extract meaningful words (length >= 3, excluding generic size tokens)
        const words = cleanName
          .replace(/\d+\s*kg/gi, '')
          .split(/[\s/_-]+/)
          .filter(w => w.length >= 3 && !['feed', 'bags', 'bag', 'mesh'].includes(w));

        // Derive formulation acronym/initials (e.g. Broiler Finisher Pellets -> BFP)
        const initials = words.map(w => w[0]).join('');

        let bestScore = -999;

        for (const sku of candidatePool) {
          let score = 0;
          const skuCode = (sku.sku_code || '').toLowerCase();
          const skuDesc = (sku.description || '').toLowerCase();
          const combined = `${skuCode} ${skuDesc}`;

          // A. Acronym/Code Prefix Match
          if (skuCode.startsWith(initials)) {
            score += 50;
          }

          // B. Keyword Match Count
          for (const word of words) {
            if (combined.includes(word)) {
              score += 20;
            }
          }

          // C. Stage / Product Category Penalties for Mismatches
          const productStages = [
            'starter', 'grower', 'finisher', 'developer', 'layer', 
            'pig', 'road', 'runner', 'rabbit', 'crumbs', 'pellets', 
            'mash', 'concentrate', 'creep', 'weaner', 'boar', 'sow', 'dairy', 'beef'
          ];

          for (const stage of productStages) {
            const formHasStage = cleanName.includes(stage);
            const skuHasStage = combined.includes(stage);
            if (formHasStage && !skuHasStage) {
              score -= 15; // SKU lacks a stage specified in formulation
            } else if (!formHasStage && skuHasStage) {
              score -= 10; // SKU has a stage not in formulation
            }
          }

          // D. Bag Size Exact Match Bonus
          if (Number(sku.bag_size_kg) === targetBagSizeKg) {
            score += 15;
          }

          if (score > bestScore) {
            bestScore = score;
            matchedSku = sku;
          }
        }
      }

      if (!matchedSku) {
        matchedSku = candidatePool[0] || availableSkus[0];
      }

      if (matchedSku && matchedSku.bag_size_kg > 0) {
        const bags = outputInKg > 0 ? Math.max(1, Math.round(outputInKg / matchedSku.bag_size_kg)) : 0;
        initial.push({
          id: `dynamic-${matchedSku.id}-${Date.now()}`,
          packaging_sku_id: matchedSku.id,
          bags_used: bags,
          implied_tonnes: (bags * matchedSku.bag_size_kg) / 1000,
        });
      }
    }

    if (initial.length > 0) {
      setLines(initial);
    }
  }

  function updateLine(id: string, field: keyof PackagingLine, value: any) {
    setLines(
      lines.map((l) => {
        if (l.id !== id) return l;

        const updated = { ...l, [field]: value };

        if (field === 'packaging_sku_id') {
          const sku = skus.find((s) => s.id === updated.packaging_sku_id);
          if (sku && sku.bag_size_kg > 0) {
            if (actualOutputQty > 0) {
              updated.bags_used = Math.max(1, Math.round((actualOutputQty * 1000) / sku.bag_size_kg));
            }
            updated.implied_tonnes = (updated.bags_used * sku.bag_size_kg) / 1000;
          } else {
            updated.implied_tonnes = 0;
          }
        }

        if (field === 'bags_used') {
          const sku = skus.find((s) => s.id === updated.packaging_sku_id);
          if (sku && sku.bag_size_kg > 0) {
            updated.implied_tonnes = (updated.bags_used * sku.bag_size_kg) / 1000;
          } else {
            updated.implied_tonnes = 0;
          }
        }

        return updated;
      })
    );
  }

  function addLine() {
    const defaultSku = skus.find(s => Number(s.bag_size_kg) === targetBagSizeKg) || skus[0];
    if (!defaultSku) return;

    const bags = actualOutputQty > 0 ? Math.max(1, Math.round((actualOutputQty * 1000) / defaultSku.bag_size_kg)) : 0;
    setLines([
      ...lines,
      {
        id: `custom-${Date.now()}`,
        packaging_sku_id: defaultSku.id,
        bags_used: bags,
        implied_tonnes: (bags * defaultSku.bag_size_kg) / 1000,
      },
    ]);
  }

  function removeLine(id: string) {
    if (lines.length <= 1) return;
    setLines(lines.filter((l) => l.id !== id));
  }

  // Calculate total implied tonnes
  const totalImpliedTonnes = lines.reduce((sum, l) => sum + l.implied_tonnes, 0);

  // Calculate total bags
  const totalBags = lines.reduce((sum, l) => sum + (l.bags_used || 0), 0);

  // Calculate variance percentage
  const variance =
    actualOutputQty > 0
      ? Math.abs((totalImpliedTonnes - actualOutputQty) / actualOutputQty) * 100
      : 0;

  const showVarianceWarning = variance > 2;

  async function handleSave() {
    if (lines.length === 0) {
      setError('At least one packaging SKU must be declared');
      return;
    }

    const invalidLine = lines.find((l) => !l.packaging_sku_id || l.bags_used <= 0);
    if (invalidLine) {
      setError('All packaging lines must have a valid SKU and bag count > 0');
      return;
    }

    setSaving(true);
    setError(null);

    try {
      await onSave(lines);
    } catch (err: any) {
      console.error('Save failed:', err);
      setError(err.message || 'Failed to save packaging declaration');
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-slate-500">
        <Loader2 className="w-8 h-8 text-emerald-500 animate-spin mb-2" />
        <p className="text-sm font-medium">Reading formulation & auto-matching {targetBagSizeKg}kg packaging SKU...</p>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* Header Banner */}
      <div className="bg-gradient-to-r from-slate-900 via-slate-800 to-emerald-950 p-5 rounded-2xl text-white shadow-lg relative overflow-hidden">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-emerald-500/20 border border-emerald-500/30 rounded-xl flex items-center justify-center">
              <Package className="w-5 h-5 text-emerald-400" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-lg font-extrabold tracking-tight">Declare Packaging Used</h3>
                <span className="inline-flex items-center gap-1 bg-emerald-500/20 text-emerald-300 text-[10px] font-bold px-2 py-0.5 rounded-full border border-emerald-500/30">
                  <Sparkles className="w-3 h-3" /> Formulated for {targetBagSizeKg}kg
                </span>
              </div>
              <p className="text-xs text-slate-300 mt-0.5">
                Dynamic SKU matching from formulation <span className="font-semibold text-white">({formulationName || 'Custom Formulation'})</span> & unit size ({targetBagSizeKg}kg).
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* KPI Cards Summary */}
      <div className="grid grid-cols-3 gap-3">
        <div className="p-3.5 bg-slate-50 border border-slate-200 rounded-xl">
          <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Actual Output</span>
          <p className="text-lg font-extrabold text-slate-900 mt-0.5">{actualOutputQty.toFixed(3)} <span className="text-xs font-normal text-slate-500">tonnes</span></p>
          <span className="text-[10px] text-slate-400 font-mono">{(actualOutputQty * 1000).toLocaleString()} kg</span>
        </div>
        <div className="p-3.5 bg-emerald-50/50 border border-emerald-200 rounded-xl">
          <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-700">Auto Bag Count ({targetBagSizeKg}kg)</span>
          <p className="text-lg font-extrabold text-emerald-900 mt-0.5">{totalBags.toLocaleString()} <span className="text-xs font-normal text-emerald-600">bags</span></p>
          <span className="text-[10px] text-emerald-600 font-mono">Implied: {totalImpliedTonnes.toFixed(3)} t</span>
        </div>
        <div className={`p-3.5 border rounded-xl ${showVarianceWarning ? 'bg-amber-50 border-amber-200' : 'bg-blue-50/50 border-blue-200'}`}>
          <span className={`text-[10px] font-bold uppercase tracking-wider ${showVarianceWarning ? 'text-amber-700' : 'text-blue-700'}`}>Output Variance</span>
          <p className={`text-lg font-extrabold mt-0.5 ${showVarianceWarning ? 'text-amber-900' : 'text-blue-900'}`}>
            {variance.toFixed(1)}%
          </p>
          <span className={`text-[10px] ${showVarianceWarning ? 'text-amber-600' : 'text-blue-600'}`}>
            {showVarianceWarning ? 'Differs > 2%' : 'Within tolerance'}
          </span>
        </div>
      </div>

      {/* Variance Warning Alert */}
      {showVarianceWarning && (
        <div className="flex items-start gap-3 p-3 bg-amber-50 border border-amber-200 rounded-xl text-xs text-amber-800">
          <AlertTriangle className="w-4 h-4 text-amber-600 mt-0.5 shrink-0" />
          <div>
            <span className="font-bold">Packaging Variance Alert:</span> Implied output from declared bags ({totalImpliedTonnes.toFixed(3)}t) differs by {variance.toFixed(1)}% from actual output ({actualOutputQty.toFixed(3)}t). Please check bag quantities.
          </div>
        </div>
      )}

      {/* Packaging Lines */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <label className="text-xs font-bold text-slate-700 uppercase tracking-wide">Packaging Lines & SKUs</label>
          <button
            type="button"
            onClick={addLine}
            disabled={disabled || saving}
            className="inline-flex items-center gap-1 text-xs font-bold text-teal-700 bg-teal-50 border border-teal-200 hover:bg-teal-100 px-3 py-1.5 rounded-lg transition-colors"
          >
            <Plus className="w-3.5 h-3.5" /> Add SKU Line
          </button>
        </div>

        {lines.length === 0 ? (
          <div className="p-6 text-center bg-slate-50 border border-slate-200 rounded-xl">
            <p className="text-xs text-amber-600 font-medium">No packaging SKUs configured. Click "Add SKU Line" above.</p>
          </div>
        ) : (
          lines.map((line, idx) => {
            return (
              <div key={line.id} className="p-3.5 bg-white border border-slate-200 rounded-xl shadow-sm space-y-3">
                <div className="flex items-center justify-between border-b border-slate-100 pb-2">
                  <span className="text-xs font-bold text-slate-600 font-mono">Line #{idx + 1}</span>
                  {lines.length > 1 && (
                    <button
                      type="button"
                      onClick={() => removeLine(line.id)}
                      className="text-xs text-red-500 hover:text-red-700 p-1"
                      title="Remove Line"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>

                <div className="grid grid-cols-1 md:grid-cols-12 gap-3 items-center">
                  <div className="md:col-span-6 space-y-1">
                    <label className="block text-[11px] font-bold text-slate-500 uppercase">Packaging SKU</label>
                    <select
                      value={line.packaging_sku_id}
                      onChange={(e) => updateLine(line.id, 'packaging_sku_id', e.target.value)}
                      disabled={disabled || saving}
                      className="w-full px-3 py-2 border border-slate-300 rounded-lg text-xs font-medium focus:outline-none focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500 bg-white"
                    >
                      <option value="">Select Packaging SKU...</option>
                      {skus.map((sku) => (
                        <option key={sku.id} value={sku.id}>
                          {sku.sku_code} — {sku.description} ({sku.bag_size_kg} kg/bag)
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="md:col-span-3 space-y-1">
                    <label className="block text-[11px] font-bold text-emerald-700 uppercase">Bags Used ({targetBagSizeKg}kg)</label>
                    <input
                      type="number"
                      min="1"
                      value={line.bags_used || ''}
                      onChange={(e) => updateLine(line.id, 'bags_used', parseInt(e.target.value) || 0)}
                      disabled={disabled || saving}
                      className="w-full px-3 py-2 border border-emerald-300 rounded-lg text-xs font-extrabold focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 bg-emerald-50/50 text-emerald-900"
                      placeholder="0"
                    />
                  </div>

                  <div className="md:col-span-3 space-y-1">
                    <label className="block text-[11px] font-bold text-slate-500 uppercase">Implied Output</label>
                    <div className="px-3 py-2 bg-slate-100 border border-slate-200 rounded-lg text-xs font-mono font-bold text-slate-800">
                      {line.implied_tonnes.toFixed(3)} tonnes
                    </div>
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Error Display */}
      {error && (
        <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-xs text-red-700 font-medium">
          {error}
        </div>
      )}

      {/* Completion Action */}
      <button
        onClick={handleSave}
        disabled={disabled || saving || lines.length === 0}
        className="w-full py-3.5 bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-600 hover:to-teal-700 text-white rounded-xl text-sm font-bold shadow-lg shadow-emerald-500/20 transition-all flex items-center justify-center gap-2 disabled:opacity-50"
      >
        {saving ? (
          <>
            <Loader2 className="w-4 h-4 animate-spin" /> Completing Order & Posting Sync...
          </>
        ) : (
          <>
            <CheckCircle2 className="w-4 h-4" /> Approve Packaging & Complete Production Order
          </>
        )}
      </button>
    </div>
  );
}
