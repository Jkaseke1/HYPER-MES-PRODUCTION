import { useState, useEffect, useCallback } from 'react';
import { Plus, FlaskConical, CreditCard as Edit2, Trash2, Search, ChevronRight, GitCompare, X, CheckCircle2, FileText, Archive, AlertTriangle, ClipboardCheck } from 'lucide-react';
import { Formulation, FormulationIngredient, RawMaterial } from '../types/database';
import { supabase } from '../lib/supabase';
import Modal from '../components/ui/Modal';
import './formula-editor.css';
import './formulations-page.css';
import StatusBadge from '../components/ui/StatusBadge';

const formatLabel = (value: string) => value.charAt(0).toUpperCase() + value.slice(1);

type UnitSizeVariant = { size: string; batch_size: number };
const STANDARD_FORMULA_BATCH_KG = 1000;

type FormState = {
  name: string;
  code: string;
  sage_code: string;
  version: number;
  category: string;
  description: string;
  batch_size: string;
  batch_unit: string;
  unit_size_variants: UnitSizeVariant[];
  target_protein: string;
  target_fat: string;
  target_fiber: string;
  target_moisture: string;
  estimated_cost_per_unit: number;
  status: 'draft' | 'active' | 'archived';
};

const emptyForm: FormState = {
  name: '',
  code: '',
  sage_code: '',
  version: 1,
  category: '',
  description: '',
  batch_size: String(STANDARD_FORMULA_BATCH_KG),
  batch_unit: 'kg',
  unit_size_variants: [{ size: '', batch_size: STANDARD_FORMULA_BATCH_KG }],
  target_protein: '',
  target_fat: '',
  target_fiber: '',
  target_moisture: '',
  estimated_cost_per_unit: 0,
  status: 'draft',
};

type IngRow = { raw_material_id: string; quantity: number; unit: string; percentage: number; is_critical: boolean };
const emptyIng = (): IngRow => ({ raw_material_id: '', quantity: 0, unit: 'kg', percentage: 0, is_critical: false });
type FormulaStage = 'formula' | 'bom';
type LegacyBomNotice = { bomTotal: number; referenceBatch: number; variance: number };

type FormulaReadiness = {
  ingredientTotalKg: number;
  varianceKg: number;
  isBalanced: boolean;
};

type FormulaGroup = {
  key: string;
  current: Formulation;
  versions: Formulation[];
};

export function getFormulationCategory(name: string, existingCategory?: string | null): string {
  if (existingCategory && existingCategory.trim() !== '' && existingCategory.toLowerCase() !== 'null' && existingCategory.toLowerCase() !== 'other') {
    return existingCategory.trim();
  }
  const n = (name || '').toLowerCase();
  if (n.includes('beef')) return 'Beef Cattle';
  if (n.includes('dairy') || n.includes('heifer') || n.includes('calf') || n.includes('lactat')) return 'Dairy Cattle';
  if (n.includes('broiler')) return 'Broiler';
  if (n.includes('layer') || n.includes('pullet')) return 'Layer';
  if (n.includes('breeder')) return 'Breeder';
  if (n.includes('pig') || n.includes('sow') || n.includes('weaner') || n.includes('creep') || n.includes('finisher') || n.includes('porker') || n.includes('swine')) return 'Pig';
  if (n.includes('horse') || n.includes('equine') || n.includes('mare')) return 'Horse';
  if (n.includes('rabbit')) return 'Rabbit';
  if (n.includes('dog') || n.includes('canine') || n.includes('hound')) return 'Dog Food';
  if (n.includes('cat') || n.includes('feline')) return 'Cat Food';
  if (n.includes('fish') || n.includes('aqua') || n.includes('tilapia') || n.includes('trout')) return 'Fish';
  if (n.includes('game') || n.includes('bird') || n.includes('ostrich') || n.includes('quail') || n.includes('pheasant')) return 'Game Bird';
  return 'Broiler';
}

const DEFAULT_CATEGORIES = [
  { code: 'Broiler', name: 'Broiler' },
  { code: 'Layer', name: 'Layer' },
  { code: 'Breeder', name: 'Breeder' },
  { code: 'Beef Cattle', name: 'Beef Cattle' },
  { code: 'Dairy Cattle', name: 'Dairy Cattle' },
  { code: 'Pig', name: 'Pig' },
  { code: 'Horse', name: 'Horse' },
  { code: 'Rabbit', name: 'Rabbit' },
  { code: 'Dog Food', name: 'Dog Food' },
  { code: 'Cat Food', name: 'Cat Food' },
  { code: 'Fish', name: 'Fish' },
  { code: 'Game Bird', name: 'Game Bird' },
  { code: 'Other', name: 'Other' },
];

import { useAuth } from '../context/AuthContext';
import { Star, Lock, ShieldCheck } from 'lucide-react';

export function isMacropackMaterial(item?: { name?: string; code?: string; category?: string | null }) {
  if (!item) return false;
  const c = (item.category || '').toLowerCase();
  const n = (item.name || '').toLowerCase();
  const cd = (item.code || '').toLowerCase();
  return c === 'macropack' || c === 'premix' || n.includes('macropack') || n.includes('premix') || cd.startsWith('bsg') || cd.startsWith('bsf') || cd.startsWith('lss') || cd.startsWith('bss') || cd.includes('pack');
}

export function getIngredientTypeCode(name: string, code: string): { isPremix: boolean; typeCode: string; badgeLabel: string } {
  const n = (name || '').toLowerCase();
  const cd = (code || '').toLowerCase();

  if (n.includes('premix') || cd.includes('premix') || cd.startsWith('bsg') || cd.startsWith('bsf') || cd.startsWith('lss')) {
    return { isPremix: true, typeCode: 'M1', badgeLabel: '⭐️ Premix (M1)' };
  }
  if (n.includes('mcp') || cd.includes('mcp')) {
    return { isPremix: true, typeCode: 'M2', badgeLabel: '⭐️ Micro (M2 - MCP)' };
  }
  if (n.includes('methionine') || cd.includes('methionine')) {
    return { isPremix: true, typeCode: 'M3', badgeLabel: '⭐️ Micro (M3 - Methionine)' };
  }
  if (n.includes('lysine') || cd.includes('lysine')) {
    return { isPremix: true, typeCode: 'M4', badgeLabel: '⭐️ Micro (M4 - Lysine)' };
  }
  if (n.includes('salinomycin') || cd.includes('salinomycin')) {
    return { isPremix: true, typeCode: 'M5', badgeLabel: '⭐️ Micro (M5 - Salinomycin)' };
  }
  if (n.includes('choline') || cd.includes('choline')) {
    return { isPremix: true, typeCode: 'MC', badgeLabel: '⭐️ Micro (MC - Choline)' };
  }
  if (n.includes('micro') || cd.includes('micro')) {
    return { isPremix: true, typeCode: 'M', badgeLabel: '⭐️ Micro-Ingredient' };
  }

  return { isPremix: false, typeCode: 'B', badgeLabel: 'Bulk (B)' };
}

export default function FormulationsPage() {
  const [formulations, setFormulations] = useState<Formulation[]>([]);
  const [materials, setMaterials] = useState<Pick<RawMaterial, 'id' | 'name' | 'code' | 'unit'>[]>([]);
  const [categories, setCategories] = useState<{ code: string; name: string }[]>(DEFAULT_CATEGORIES);
  const [formulationIngredientCounts, setFormulationIngredientCounts] = useState<Record<string, number>>({});
  const [formulaReadiness, setFormulaReadiness] = useState<Record<string, FormulaReadiness>>({});
  const [filter, setFilter] = useState<string>('All');
  const [ingredientFilter, setIngredientFilter] = useState<'all' | 'with' | 'without'>('all');
  const [showArchived, setShowArchived] = useState(false);
  const [search, setSearch] = useState('');
  const [registerView, setRegisterView] = useState<'formulas' | 'review'>('formulas');
  const [loading, setLoading] = useState(true);
  const [detailOpen, setDetailOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [formulaStage, setFormulaStage] = useState<FormulaStage>('formula');
  const [legacyBomNotice, setLegacyBomNotice] = useState<LegacyBomNotice | null>(null);
  const [selected, setSelected] = useState<Formulation | null>(null);
  const [detailIngs, setDetailIngs] = useState<FormulationIngredient[]>([]);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [ings, setIngs] = useState<IngRow[]>([emptyIng()]);
  const [editingIngredientQuantity, setEditingIngredientQuantity] = useState<number | null>(null);
  const [editId, setEditId] = useState<string | null>(null);
  const [sourceFormulaId, setSourceFormulaId] = useState('');
  const [sourceFormulaSearch, setSourceFormulaSearch] = useState('');
  const [copiedBatchSize, setCopiedBatchSize] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [compareMode, setCompareMode] = useState(false);
  const [compareSelected, setCompareSelected] = useState<Formulation[]>([]);
  const [compareIngs, setCompareIngs] = useState<[FormulationIngredient[], FormulationIngredient[]]>([[], []]);
  const [compareOpen, setCompareOpen] = useState(false);
  const [bomEditMode, setBomEditMode] = useState(false);
  const [bomEditIngs, setBomEditIngs] = useState<FormulationIngredient[]>([]);
  const [detailTab, setDetailTab] = useState<'ingredients' | 'packaging'>('ingredients');
  const [detailPkgItems, setDetailPkgItems] = useState<{ id: string; item_code: string; description: string; unit: string; expected_qty_per_tonne: number }[]>([]);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const currentFormulaMaterialIds = new Set(detailIngs.map((ingredient) => ingredient.raw_material_id));
  const draftFormulaMaterialIds = new Set(ings.map((ingredient) => ingredient.raw_material_id).filter(Boolean));

  const filtered = formulations.filter(f => {
    if (!showArchived && f.status === 'archived') return false;
    const categoryName = getFormulationCategory(f.name, f.category);
    if (filter !== 'All' && categoryName.toLowerCase() !== filter.toLowerCase() && f.category?.toLowerCase() !== filter.toLowerCase()) return false;
    if (search && !f.name.toLowerCase().includes(search.toLowerCase()) && !f.code.toLowerCase().includes(search.toLowerCase())) return false;
    
    // Filter by ingredient status
    const hasIngredients = (formulationIngredientCounts[f.id] || 0) > 0;
    if (ingredientFilter === 'with' && !hasIngredients) return false;
    if (ingredientFilter === 'without' && hasIngredients) return false;
    
    return true;
  });

  const fetchFormulations = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase.from('formulations').select('*').order('name');
    setFormulations(data || []);
    
    // Fetch ingredient counts for each formulation
    if (data && data.length > 0) {
      const { data: ingredientData } = await supabase
        .from('formulation_ingredients')
        .select('formulation_id, quantity, is_active');
      
      const counts: Record<string, number> = {};
      const totals: Record<string, number> = {};
      ingredientData?.forEach(ing => {
        counts[ing.formulation_id] = (counts[ing.formulation_id] || 0) + 1;
        if (ing.is_active) totals[ing.formulation_id] = (totals[ing.formulation_id] || 0) + (Number(ing.quantity) || 0);
      });
      setFormulationIngredientCounts(counts);
      const readiness: Record<string, FormulaReadiness> = {};
      data.forEach((formula) => {
        const ingredientTotalKg = totals[formula.id] || 0;
        const varianceKg = ingredientTotalKg - Number(formula.batch_size || 0);
        readiness[formula.id] = {
          ingredientTotalKg,
          varianceKg,
          isBalanced: ingredientTotalKg > 0 && Math.abs(varianceKg) <= 0.01,
        };
      });
      setFormulaReadiness(readiness);
    } else {
      setFormulationIngredientCounts({});
      setFormulaReadiness({});
    }
    
    setLoading(false);
  }, []);

  const fetchMaterials = useCallback(async () => {
    const { data } = await supabase.from('raw_materials').select('id, name, code, unit, category').eq('is_active', true);
    setMaterials(data || []);
  }, []);

  const fetchCategories = useCallback(async () => {
    const { data, error } = await supabase
      .from('formulation_categories')
      .select('code, name')
      .eq('is_active', true)
      .order('display_order', { ascending: true });
    if (error) {
      console.error('Failed to load formulation categories:', error);
      setCategories([]);
      return;
    }
    setCategories((data as { code: string; name: string }[]) || []);
  }, []);

  useEffect(() => { fetchFormulations(); fetchMaterials(); fetchCategories(); }, [fetchFormulations, fetchMaterials, fetchCategories]);
  
  const formulaGroups: FormulaGroup[] = Array.from(
    filtered.reduce((groups, formulation) => {
      const key = formulation.code || formulation.name;
      const group = groups.get(key) || { key, current: formulation, versions: [] };
      group.versions.push(formulation);
      groups.set(key, group);
      return groups;
    }, new Map<string, FormulaGroup>()).values(),
  ).map(group => {
    const versions = [...group.versions].sort((a, b) => Number(b.version || 0) - Number(a.version || 0));
    return { ...group, current: versions[0], versions };
  });

  // The version picker should show one product/formula entry at a time. Older
  // versions remain available from the history control after a formula is
  // opened, instead of making the initial list difficult to use.
  const allFormulaGroups: FormulaGroup[] = Array.from(
    formulations.reduce((groups, formulation) => {
      const key = formulation.code || formulation.name;
      const group = groups.get(key) || { key, current: formulation, versions: [] };
      group.versions.push(formulation);
      groups.set(key, group);
      return groups;
    }, new Map<string, FormulaGroup>()).values(),
  ).map(group => {
    const versions = [...group.versions].sort((a, b) => Number(b.version || 0) - Number(a.version || 0));
    return { ...group, current: versions[0], versions };
  });

  const withIngredients = formulaGroups.filter(group => (formulationIngredientCounts[group.current.id] || 0) > 0);
  const withoutIngredients = formulaGroups.filter(group => (formulationIngredientCounts[group.current.id] || 0) === 0);

  function toggleCompareSelect(f: Formulation) {
    setCompareSelected(prev => {
      if (prev.find(p => p.id === f.id)) return prev.filter(p => p.id !== f.id);
      if (prev.length >= 2) return [prev[1], f];
      return [...prev, f];
    });
  }

  async function openCompare() {
    if (compareSelected.length !== 2) return;
    const [a, b] = compareSelected;
    const [ra, rb] = await Promise.all([
      supabase.from('formulation_ingredients').select('*, raw_materials(*)').eq('formulation_id', a.id).order('sort_order'),
      supabase.from('formulation_ingredients').select('*, raw_materials(*)').eq('formulation_id', b.id).order('sort_order'),
    ]);
    setCompareIngs([ra.data || [], rb.data || []]);
    setCompareOpen(true);
  }

  async function openDetail(f: Formulation) {
    setSelected(f);
    setDetailTab('ingredients');
    const [ingsRes, pkgRes] = await Promise.all([
      supabase.from('formulation_ingredients').select('*, raw_materials(*)').eq('formulation_id', f.id).order('sort_order'),
      supabase.from('production_bom_packaging').select('*').eq('formulation_id', f.id),
    ]);
    setDetailIngs(ingsRes.data || []);
    setDetailPkgItems(pkgRes.data || []);
    setDetailOpen(true);
  }

  function openNew() {
    setEditId(null);
    setSourceFormulaId('');
    setSourceFormulaSearch('');
    setForm({ ...emptyForm });
    setIngs([emptyIng()]);
    setFormulaStage('formula');
    setLegacyBomNotice(null);
    setCopiedBatchSize(null);
    setEditOpen(true);
  }

  // Start a new blank draft version from an existing formula. The product
  // identity and version history are carried forward, but ingredients/BOM
  // lines are intentionally not copied into the new formulation workspace.
  async function prefillFromFormulation(sourceId: string) {
    setSourceFormulaId(sourceId);
    if (!sourceId) {
      // Reset to blank
      setForm({ ...emptyForm });
      setIngs([emptyIng()]);
      setCopiedBatchSize(null);
      setLegacyBomNotice(null);
      return;
    }
    const src = formulations.find(f => f.id === sourceId);
    if (!src) return;
    const variants = (src as any).unit_size_variants;
    // Keep editId = null (always New mode)
    const nextVersion = formulations
      .filter(f => f.code === src.code)
      .reduce((max, f) => Math.max(max, Number(f.version) || 0), 0) + 1;
    const copiedVariants = Array.isArray(variants) && variants.length > 0
      ? variants.map((variant: UnitSizeVariant, index: number) => index === 0
        ? { ...variant, batch_size: STANDARD_FORMULA_BATCH_KG }
        : variant)
      : [{ size: '', batch_size: STANDARD_FORMULA_BATCH_KG }];
    setForm({
      name: src.name,
      code: src.code,
      sage_code: (src as any).sage_code || src.code,
      version: nextVersion,
      category: src.category || '',
      description: src.description || '',
      batch_size: String(STANDARD_FORMULA_BATCH_KG),
      batch_unit: src.batch_unit,
      unit_size_variants: copiedVariants,
      target_protein: src.target_protein.toString(),
      target_fat: src.target_fat.toString(),
      target_fiber: src.target_fiber.toString(),
      target_moisture: src.target_moisture.toString(),
      estimated_cost_per_unit: 0,
      status: 'draft',
    });
    setCopiedBatchSize(STANDARD_FORMULA_BATCH_KG);
    setIngs([emptyIng()]);
    setLegacyBomNotice(null);
  }

  function handleSourceFormulaChange(sourceId: string) {
    // An empty source always means a genuinely independent, blank formula.
    // Keeping this as an explicit state transition prevents stale metadata or
    // ingredients from a previously selected source leaking into a new draft.
    if (!sourceId) {
      setSourceFormulaId('');
      setSourceFormulaSearch('');
    }
    void prefillFromFormulation(sourceId);
  }

  async function openEdit(f: Formulation) {
    setEditId(f.id);
    setCopiedBatchSize(null);
    const variants = (f as any).unit_size_variants;
    console.log('Loading formulation variants:', variants);
    setForm({
      name: f.name,
      code: f.code,
      sage_code: (f as any).sage_code || '',
      version: f.version,
      category: f.category,
      description: f.description,
      batch_size: f.batch_size.toString(),
      batch_unit: f.batch_unit,
      unit_size_variants: Array.isArray(variants) ? variants : [],
      target_protein: f.target_protein.toString(),
      target_fat: f.target_fat.toString(),
      target_fiber: f.target_fiber.toString(),
      target_moisture: f.target_moisture.toString(),
      estimated_cost_per_unit: f.estimated_cost_per_unit,
      status: f.status,
    });
    const [specRes, bomRes] = await Promise.all([
      supabase.from('formula_specs').select('id, reference_batch_size').eq('formulation_id', f.id).maybeSingle(),
      supabase.from('formulation_ingredients').select('*').eq('formulation_id', f.id).order('sort_order'),
    ]);
    let formulaLines: any[] = [];
    if (!specRes.error && specRes.data?.id) {
      const { data: specLines } = await supabase
        .from('formula_spec_lines')
        .select('raw_material_id, quantity, unit')
        .eq('formula_spec_id', specRes.data.id)
        .order('sort_order');
      formulaLines = specLines || [];
    }
    const sourceLines = formulaLines.length > 0 ? formulaLines : (bomRes.data || []);
    const bomTotal = sourceLines.reduce((sum, line) => sum + (Number(line.quantity) || 0), 0);
    const standardBatch = STANDARD_FORMULA_BATCH_KG;
    const scaleToStandardBatch = bomTotal > 0 && Math.abs(bomTotal - standardBatch) > 0.01;
    const normalizedLines = scaleToStandardBatch
      ? sourceLines.map(line => ({
          ...line,
          quantity: Math.round(((Number(line.quantity) || 0) / bomTotal) * standardBatch * 10000) / 10000,
        }))
      : sourceLines;

    // All production formulas are maintained against the standard 1,000 kg
    // batch. Older records may carry a 50 kg reference or a BOM whose total
    // is already 1,000 kg; normalize both cases before calculating % values.
    setForm(current => ({
      ...current,
      batch_size: String(standardBatch),
      unit_size_variants: (current.unit_size_variants?.length
        ? current.unit_size_variants
        : [{ size: '', batch_size: standardBatch }]).map((variant, index) => index === 0
          ? { ...variant, batch_size: standardBatch }
          : variant),
    }));
    setLegacyBomNotice(null);
    const loadedIngredients = normalizedLines.map(i => ({
      raw_material_id: i.raw_material_id,
      quantity: Number(i.quantity) || 0,
      unit: i.unit || 'kg',
      percentage: standardBatch > 0 ? Math.round(((Number(i.quantity) || 0) / standardBatch) * 1000000) / 10000 : 0,
      is_critical: !!i.is_critical,
    }));
    setIngs(loadedIngredients);
    setFormulaStage('formula');
    setDetailOpen(false);
    setEditOpen(true);
  }

  function createVersion(source: Formulation) {
    // Do not insert a database version just because the user opened the
    // version workflow. The draft is created only after a changed formula is
    // actually saved, so cancelling leaves history untouched.
    setDetailOpen(false);
    setBomEditMode(false);
    setEditId(null);
    setSourceFormulaSearch(`${source.name} (${source.code}) · v${source.version} · ${(formulationIngredientCounts[source.id] || 0)} BOM items · ${source.status}`);
    void prefillFromFormulation(source.id).then(() => {
      setFormulaStage('formula');
      setEditOpen(true);
    });
  }

  async function handleSave() {
    if (!form.name.trim() || !form.code.trim()) {
      alert('Name and Code are required.');
      return;
    }

    // Batch size can be supplied either at the top level OR via the first Unit Size Variant row.
    const firstVariantBatch = form.unit_size_variants?.[0]?.batch_size || 0;
    const resolvedBatchSize = Number(form.batch_size) || firstVariantBatch;
    if (!resolvedBatchSize || resolvedBatchSize <= 0) {
      alert('Please provide a batch size (either on the Unit Size Variant row or at the top-level Batch Size field).');
      return;
    }

    if (ings.every(i => !i.raw_material_id)) {
      alert('Add at least one ingredient before saving.');
      return;
    }

    const ingredientTotal = ings
      .filter((ingredient) => ingredient.raw_material_id)
      .reduce((sum, ingredient) => sum + (Number(ingredient.quantity) || 0), 0);
    const entered = ings.filter(i => i.raw_material_id);
    if (entered.some(i => !Number.isFinite(i.quantity) || i.quantity <= 0 || !Number.isFinite(i.percentage) || i.percentage < 0 || i.percentage > 100)) {
      alert('Each ingredient needs a positive quantity and a percentage between 0 and 100.');
      return;
    }
    if (Math.abs(entered.reduce((sum, i) => sum + i.percentage, 0) - 100) > 0.01) {
      alert('Ingredient percentages must total 100% before saving the formula and BOM.');
      return;
    }
    if (Math.abs(ingredientTotal - resolvedBatchSize) > 0.01) {
      alert(`Formula mass balance must equal the reference batch size. Ingredients total ${ingredientTotal.toFixed(2)} kg; reference batch is ${resolvedBatchSize.toFixed(2)} kg.`);
      return;
    }

    setSaving(true);
    try {
      // Filter out empty unit_size_variants and validate
      const validVariants = form.unit_size_variants.filter(v => v.size && v.batch_size > 0);
      
      const payload = {
        ...form,
        unit_size_variants: validVariants.length > 0 ? validVariants : null,
        batch_size: resolvedBatchSize,
        target_protein: Number(form.target_protein) || 0,
        target_fat: Number(form.target_fat) || 0,
        target_fiber: Number(form.target_fiber) || 0,
        target_moisture: Number(form.target_moisture) || 0,
        updated_at: new Date().toISOString(),
      };
      
      console.log('Saving formulation with variants:', payload.unit_size_variants);

      let fId = editId;
      if (editId) {
        // Draft edits stay on the same version. New versions are created only
        // through the explicit Create New Version action, preserving history.
        const { error } = await supabase.from('formulations').update(payload).eq('id', editId);
        if (error) throw error;
      } else {
        const { data, error } = await supabase.from('formulations').insert(payload).select('id').single();
        if (error) throw error;
        fId = data?.id || null;
      }

      if (!fId) throw new Error('Formulation ID missing after save.');

      // Persist the entered formula separately from the generated production BOM.
      const { data: formulaSpec, error: formulaSpecError } = await supabase
        .from('formula_specs')
        .upsert({
          formulation_id: fId,
          reference_batch_size: resolvedBatchSize,
          batch_unit: form.batch_unit,
          status: 'generated',
          generated_bom_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        }, { onConflict: 'formulation_id' })
        .select('id')
        .single();
      if (formulaSpecError || !formulaSpec) throw formulaSpecError || new Error('Formula specification could not be saved.');

      const { error: formulaLinesDeleteError } = await supabase
        .from('formula_spec_lines')
        .delete()
        .eq('formula_spec_id', formulaSpec.id);
      if (formulaLinesDeleteError) throw formulaLinesDeleteError;

      const formulaRows = ings.filter(i => i.raw_material_id).map((i, idx) => ({
        formula_spec_id: formulaSpec.id,
        raw_material_id: i.raw_material_id,
        quantity: i.quantity,
        unit: i.unit,
        notes: '',
        sort_order: idx,
      }));
      const { error: formulaLinesInsertError } = await supabase.from('formula_spec_lines').insert(formulaRows);
      if (formulaLinesInsertError) throw formulaLinesInsertError;

      const rows = ings
        .filter(i => i.raw_material_id)
        .map((i, idx) => ({
          formulation_id: fId!,
          raw_material_id: i.raw_material_id,
          quantity: i.quantity,
          unit: i.unit,
          percentage: Math.round((i.quantity / resolvedBatchSize) * 100000000) / 1000000,
          is_critical: i.is_critical,
          notes: '',
          sort_order: idx,
        }));

      const { error: deleteError } = await supabase.from('formulation_ingredients').delete().eq('formulation_id', fId);
      if (deleteError) throw deleteError;
      if (rows.length) {
        const { error } = await supabase.from('formulation_ingredients').insert(rows);
        if (error) throw error;
      }

      setEditOpen(false);
      setToastMessage(`Formula ${form.code} v${form.version} saved and BOM generated from the formula.`);
      fetchFormulations();
    } catch (error: any) {
      console.error('Error saving formulation:', error);
      // Friendlier message for unique-constraint collisions
      if (error?.code === '23505' && /formulations_code_key/.test(error?.message || '')) {
        alert(`A formulation with code "${form.code}" already exists. Use a different code, or open the existing one and click Edit.`);
      } else if (error?.code === '23505') {
        alert(`Duplicate value: ${error.details || error.message}`);
      } else {
        alert(`Failed to save formulation: ${error.message || error}`);
      }
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: string) {
    if (!confirm('Delete this formulation and all its ingredients?')) return;
    await supabase.from('formulation_ingredients').delete().eq('formulation_id', id);
    await supabase.from('formulations').delete().eq('id', id);
    setDetailOpen(false);
    fetchFormulations();
  }

  async function saveBomEdits() {
    if (!selected) return;
    setSaving(true);
    try {
      // Filter valid ingredients and auto-normalize percentages to exact 100%
      const validIngs = bomEditIngs.filter(i => i.raw_material_id);
      const totalWeight = validIngs.reduce((sum, i) => sum + (Number(i.quantity) || 0), 0);

      if (validIngs.length > 0 && totalWeight > 0) {
        let sumPct = 0;
        validIngs.forEach(i => {
          const rawPct = (Number(i.quantity) / totalWeight) * 100;
          i.percentage = Math.round(rawPct * 1000) / 1000;
          sumPct += i.percentage;
        });

        // Adjust rounding on largest ingredient to ensure exact 100% total
        const diff = Math.round((100 - sumPct) * 1000) / 1000;
        if (Math.abs(diff) > 0 && validIngs.length > 0) {
          let maxIdx = 0;
          let maxQty = -1;
          validIngs.forEach((ing, idx) => {
            if (Number(ing.quantity) > maxQty) {
              maxQty = Number(ing.quantity);
              maxIdx = idx;
            }
          });
          validIngs[maxIdx].percentage = Math.round((validIngs[maxIdx].percentage + diff) * 1000) / 1000;
        }
      }

      // Delete all existing ingredients then re-insert (handles replace + delete cleanly)
      const { error: delErr } = await supabase.from('formulation_ingredients').delete().eq('formulation_id', selected.id);
      if (delErr) throw delErr;
      const rows = validIngs.map((i, idx) => ({
        formulation_id: selected.id,
        raw_material_id: i.raw_material_id,
        quantity: i.quantity,
        unit: i.unit,
        percentage: i.percentage,
        is_critical: i.is_critical,
        notes: '',
        sort_order: idx,
      }));
      if (rows.length > 0) {
        const { error: insErr } = await supabase.from('formulation_ingredients').insert(rows);
        if (insErr) throw insErr;
      }

      setBomEditMode(false);
      const { data } = await supabase.from('formulation_ingredients').select('*, raw_materials(*)').eq('formulation_id', selected.id).order('sort_order');
      setDetailIngs(data || []);
      setToastMessage(`BOM updated on draft v${selected.version}. Total formulation percentage normalized to 100%.`);
      setTimeout(() => setToastMessage(null), 4000);
      fetchFormulations();
    } catch (error: any) {
      console.error('Error saving BOM:', error);
      alert(`Failed to save BOM: ${error.message || error}`);
    } finally {
      setSaving(false);
    }
  }

  const recalculatePercentages = (updatedIngs: IngRow[], batchSize = Number(form.batch_size) || 0) => {
    if (batchSize <= 0) return updatedIngs;
    return updatedIngs.map(i => ({
      ...i,
      percentage: i.raw_material_id ? Math.round((Number(i.quantity) / batchSize) * 100000000) / 1000000 : 0,
    }));
  };

  const recalculateQuantities = (updatedIngs: IngRow[], batchSize = Number(form.batch_size) || 0) => {
    if (batchSize <= 0) return updatedIngs;
    return updatedIngs.map(i => ({
      ...i,
      quantity: i.raw_material_id
        ? Math.round(((Number(i.percentage) || 0) / 100) * batchSize * 10000) / 10000
        : 0,
    }));
  };

  const recalculateFromFormula = (updatedIngs: IngRow[], batchSize: number) => {
    const formulaTotal = updatedIngs
      .filter(i => i.raw_material_id)
      .reduce((sum, i) => sum + (Number(i.quantity) || 0), 0);
    if (formulaTotal <= 0 || batchSize <= 0) return updatedIngs;

    const populatedIndexes = updatedIngs
      .map((item, index) => item.raw_material_id ? index : -1)
      .filter(index => index >= 0);
    const lastIndex = populatedIndexes[populatedIndexes.length - 1];
    let allocated = 0;

    return updatedIngs.map((item, index) => {
      if (!item.raw_material_id) return { ...item, quantity: 0, percentage: 0 };
      const quantity = index === lastIndex
        ? Math.round((batchSize - allocated) * 10000) / 10000
        : Math.round(((Number(item.quantity) || 0) / formulaTotal) * batchSize * 10000) / 10000;
      allocated += quantity;
      return {
        ...item,
        quantity,
        percentage: Math.round((quantity / batchSize) * 1000000) / 10000,
      };
    });
  };

  const updateReferenceBatchSize = (batchSize: string) => {
    const nextBatchSize = Number(batchSize) || 0;
    const variants = [...form.unit_size_variants];
    variants[0] = { ...(variants[0] || { size: '', batch_size: 0 }), batch_size: nextBatchSize };
    setForm({ ...form, batch_size: batchSize, unit_size_variants: variants });

    setIngs(recalculateQuantities(ings, nextBatchSize));
    setLegacyBomNotice(previous => previous
      ? { ...previous, referenceBatch: nextBatchSize, variance: previous.bomTotal - nextBatchSize }
      : previous);
  };

  const totalPct = ings.reduce((s, i) => s + (Number(i.percentage) || 0), 0);
  const formulaIngredientTotal = ings.filter((ingredient) => ingredient.raw_material_id).reduce((sum, ingredient) => sum + (Number(ingredient.quantity) || 0), 0);
  const formulaBatchSize = Number(form.batch_size) || Number(form.unit_size_variants?.[0]?.batch_size) || 0;
  const formulaBalanceDifference = formulaIngredientTotal - formulaBatchSize;

  const continueToBom = () => {
    const entered = ings.filter(i => i.raw_material_id);
    if (!formulaBatchSize || formulaBatchSize <= 0) {
      alert('Enter a reference batch size before generating the BOM.');
      return;
    }
    if (!entered.length || entered.some(i => !Number.isFinite(i.quantity) || i.quantity <= 0)) {
      alert('Enter a positive quantity for every formula ingredient before generating the BOM.');
      return;
    }
    if (Math.abs(formulaIngredientTotal - formulaBatchSize) > 0.01) {
      if (!legacyBomNotice) {
        alert(`The formula total must equal the reference batch size before generating the BOM. Current total: ${formulaIngredientTotal.toFixed(2)} kg; reference batch: ${formulaBatchSize.toFixed(2)} kg.`);
        return;
      }
      // Legacy BOMs may have been stored against the wrong batch size. Preserve
      // their ingredient ratios, scale them to the corrected reference batch,
      // and let Finance review the generated result before saving.
      setIngs(recalculateFromFormula(ings, formulaBatchSize));
      setFormulaStage('bom');
      return;
    }
    setIngs(recalculatePercentages(ings, formulaBatchSize));
    setFormulaStage('bom');
  };

  const catColor: Record<string, string> = {
    'Broiler': 'bg-emerald-100 text-emerald-800 border border-emerald-200 font-bold',
    'Layer': 'bg-amber-100 text-amber-800 border border-amber-200 font-bold',
    'Breeder': 'bg-purple-100 text-purple-800 border border-purple-200 font-bold',
    'Beef Cattle': 'bg-red-100 text-red-800 border border-red-200 font-bold',
    'Dairy Cattle': 'bg-sky-100 text-sky-800 border border-sky-200 font-bold',
    'Pig': 'bg-rose-100 text-rose-800 border border-rose-200 font-bold',
    'Horse': 'bg-teal-100 text-teal-800 border border-teal-200 font-bold',
    'Rabbit': 'bg-indigo-100 text-indigo-800 border border-indigo-200 font-bold',
    'Dog Food': 'bg-orange-100 text-orange-800 border border-orange-200 font-bold',
    'Cat Food': 'bg-yellow-100 text-yellow-800 border border-yellow-200 font-bold',
    'Fish': 'bg-blue-100 text-blue-800 border border-blue-200 font-bold',
    'Game Bird': 'bg-lime-100 text-lime-800 border border-lime-200 font-bold',
    'Chemicals': 'bg-slate-200 text-slate-800 border border-slate-300 font-bold',
    'Other': 'bg-slate-100 text-slate-700 border border-slate-200 font-semibold',
  };

  const totalFormulas = formulations.length;
  const activeCount = formulations.filter(f => f.status === 'active').length;
  const draftCount = formulations.filter(f => f.status === 'draft').length;
  const archivedCount = formulations.filter(f => f.status === 'archived').length;
  const financeReviewQueue = formulations.filter((formula) => {
    const readiness = formulaReadiness[formula.id];
    return !readiness?.isBalanced || formula.status !== 'active';
  });

  const { profile } = useAuth();
  const userRole = (profile?.role || '').toLowerCase();
  const userEmail = (profile?.email || '').toLowerCase();
  const isFinanceUser = userRole.includes('admin') || userRole.includes('finance') || userRole === 'finance_manager' || userEmail.includes('jonga') || userRole === 'administrator';

  return (
    <div className="formula-page p-6 space-y-6">
      {toastMessage && (
        <div className="fixed top-5 right-5 z-50 p-4 bg-emerald-600 text-white rounded-xl shadow-2xl flex items-center gap-3 border border-emerald-500 animate-bounce">
          <CheckCircle2 className="w-5 h-5 text-emerald-200" />
          <span className="text-sm font-extrabold">{toastMessage}</span>
        </div>
      )}
      {!isFinanceUser && (
        <div className="bg-slate-900 border border-slate-700 text-slate-200 rounded-2xl p-4 flex items-center justify-between shadow-sm">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-amber-500/20 border border-amber-500/30 flex items-center justify-center text-amber-400">
              <Lock className="w-5 h-5" />
            </div>
            <div>
              <h4 className="font-extrabold text-xs uppercase tracking-wider text-amber-300">
                🔒 Finance Controlled BOM Mode (View Only for Production)
              </h4>
              <p className="text-xs text-slate-300 mt-0.5">
                Formulations & BOMs are exclusively created, edited, and approved by Finance (Jonga). Production (Chamunorwa) uses Finance-approved active versions.
              </p>
            </div>
          </div>
          <span className="text-[10px] font-extrabold bg-slate-800 text-slate-300 px-3 py-1.5 rounded-xl border border-slate-700">
            Role: {profile?.role || 'Production'}
          </span>
        </div>
      )}

      <section className="formula-hero overflow-hidden rounded-2xl bg-[#0c2035] text-white shadow-lg">
      <div className="flex flex-wrap items-center justify-between gap-5 px-6 py-6">
        <div>
          <span className="inline-block border border-amber-500/50 bg-amber-400/10 px-2.5 py-1 text-xs font-bold text-amber-300">FORMULA CONTROL</span>
          <h1 className="mt-3 text-2xl font-bold text-white">Formulations & BOM</h1>
          <p className="mt-1 text-sm text-slate-300">Master recipes, batch quantities and approved versions</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => { setCompareMode(m => !m); setCompareSelected([]); }}
            className={`flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-semibold transition-colors border ${
              compareMode ? 'bg-amber-50 text-amber-700 border-amber-300' : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
            }`}
          >
            <GitCompare className="w-4 h-4" />
            {compareMode ? `Compare (${compareSelected.length}/2)` : 'Compare'}
          </button>
          {compareMode && compareSelected.length === 2 && (
            <button onClick={openCompare} className="flex items-center gap-2 px-4 py-2.5 bg-amber-500 hover:bg-amber-600 text-white rounded-lg text-sm font-semibold transition-colors">
              <GitCompare className="w-4 h-4" /> View Comparison
            </button>
          )}
          {isFinanceUser && (
            <button onClick={openNew} className="flex items-center gap-2 px-5 py-3 bg-amber-500 hover:bg-amber-600 text-white text-sm font-bold transition-colors whitespace-nowrap">
              <Plus className="w-4 h-4" /> New Formula
            </button>
          )}
        </div>
      </div>

      <div className="formula-stat-grid grid grid-cols-2 lg:grid-cols-4 border-t border-white/10">
        {[
          { label: 'Total formulas', value: totalFormulas, color: 'text-white', icon: FlaskConical },
          { label: 'Active', value: activeCount, color: 'text-emerald-300', icon: CheckCircle2 },
          { label: 'Draft', value: draftCount, color: 'text-amber-300', icon: FileText },
          { label: 'Archived', value: archivedCount, color: 'text-cyan-300', icon: Archive },
        ].map(stat => <div key={stat.label} className="formula-stat px-6 py-4 border-r border-white/10 last:border-0"><div className="flex items-center justify-between"><p className="text-xs font-semibold uppercase text-slate-400">{stat.label}</p><stat.icon className={`h-4 w-4 ${stat.color}`} /></div><p className={`mt-2 text-3xl font-semibold tabular-nums ${stat.color}`}>{stat.value}</p></div>)}
      </div>
      </section>

      <div role="tablist" aria-label="Formula views" className="formula-tabs flex gap-5 border-b border-slate-200">
        <button role="tab" aria-selected={registerView === 'formulas'} onClick={() => setRegisterView('formulas')} className={`py-3 text-sm font-semibold border-b-2 ${registerView === 'formulas' ? 'border-teal-600 text-teal-700' : 'border-transparent text-slate-500'}`}>All formulas <span className="ml-2 text-xs tabular-nums">{totalFormulas}</span></button>
        {isFinanceUser && <button role="tab" aria-selected={registerView === 'review'} onClick={() => setRegisterView('review')} className={`py-3 text-sm font-semibold border-b-2 ${registerView === 'review' ? 'border-teal-600 text-teal-700' : 'border-transparent text-slate-500'}`}>Finance review <span className="ml-2 text-xs tabular-nums text-amber-700">{financeReviewQueue.length}</span></button>}
      </div>

      {isFinanceUser && registerView === 'review' && !loading && (
        <section className="border-y border-slate-200 bg-white">
          <div className="flex flex-col gap-3 px-5 py-4 border-b border-amber-200 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-start gap-3">
              <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-amber-100 text-amber-700">
                <ClipboardCheck className="h-5 w-5" />
              </div>
              <div>
                <h2 className="font-semibold text-slate-800">Finance Formula Review</h2>
              </div>
            </div>
            <span className={`self-start rounded-md px-3 py-1 text-sm font-semibold sm:self-auto ${financeReviewQueue.length ? 'bg-amber-200 text-amber-900' : 'bg-emerald-100 text-emerald-800'}`}>
              {financeReviewQueue.length} requiring review
            </span>
          </div>
          {financeReviewQueue.length > 0 ? (
            <div className="overflow-x-auto bg-white">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-slate-50 text-left text-xs font-semibold uppercase text-slate-500">
                  <tr>
                    <th className="px-5 py-3">Formula</th>
                    <th className="px-4 py-3 text-right">Reference kg</th>
                    <th className="px-4 py-3 text-right">BOM kg</th>
                    <th className="px-4 py-3 text-right">Variance</th>
                    <th className="px-4 py-3">Readiness</th>
                    <th className="px-5 py-3 text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {financeReviewQueue.map((formula) => {
                    const readiness = formulaReadiness[formula.id];
                    const balanced = readiness?.isBalanced;
                    return (
                      <tr key={formula.id}>
                        <td className="px-5 py-3">
                          <p className="font-medium text-slate-800">{formula.name}</p>
                          <p className="font-mono text-xs text-slate-500">{formula.code} | Sage: {formula.sage_code || 'Not mapped'}</p>
                        </td>
                        <td className="px-4 py-3 text-right tabular-nums">{Number(formula.batch_size || 0).toLocaleString()}</td>
                        <td className="px-4 py-3 text-right tabular-nums">{Number(readiness?.ingredientTotalKg || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                        <td className={`px-4 py-3 text-right font-medium tabular-nums ${balanced ? 'text-emerald-700' : 'text-red-700'}`}>{Number(readiness?.varianceKg || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                        <td className="px-4 py-3">
                          {balanced ? (
                            <span className="inline-flex items-center gap-1 rounded-md bg-emerald-50 px-2 py-1 text-xs font-medium text-emerald-700">Balanced; awaiting activation</span>
                          ) : (
                            <span className="inline-flex items-center gap-1 rounded-md bg-red-50 px-2 py-1 text-xs font-medium text-red-700"><AlertTriangle className="h-3.5 w-3.5" /> BOM review required</span>
                          )}
                        </td>
                        <td className="px-5 py-3 text-right">
                          <button onClick={() => openEdit(formula)} className="rounded-md border border-teal-300 px-3 py-1.5 text-xs font-semibold text-teal-700 hover:bg-teal-50">Review formula</button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="bg-white px-5 py-4 text-sm text-emerald-700">All formulas are balanced and active.</div>
          )}
        </section>
      )}

      {registerView === 'formulas' && <>
      <div className="formula-toolbar flex flex-col gap-3">
        <div className="flex flex-col sm:flex-row gap-4 items-start sm:items-center justify-between">
              <div className="formula-category-filter w-full sm:w-60">
            <select aria-label="Formula category" value={filter} onChange={e => setFilter(e.target.value)} className="w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700">
              <option value="All">All categories</option>
              {categories.map(c => <option key={c.code} value={c.code}>{c.name}</option>)}
            </select>
          </div>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search formulas..." className="formula-search pl-9 pr-4 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500 w-64" />
          </div>
        </div>
        
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => setIngredientFilter('all')}
            className={`formula-filter-pill px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${ingredientFilter === 'all' ? 'bg-slate-800 text-white' : 'bg-white text-slate-600 hover:bg-slate-100 border border-slate-200'}`}
          >
            All Formulas
          </button>
          <button
            onClick={() => setIngredientFilter('with')}
            className={`formula-filter-pill px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${ingredientFilter === 'with' ? 'bg-emerald-600 text-white' : 'bg-white text-slate-600 hover:bg-slate-100 border border-slate-200'}`}
          >
            With Ingredients ({withIngredients.length})
          </button>
          <button
            onClick={() => setIngredientFilter('without')}
            className={`formula-filter-pill px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${ingredientFilter === 'without' ? 'bg-amber-600 text-white' : 'bg-white text-slate-600 hover:bg-slate-100 border border-slate-200'}`}
          >
            Without Ingredients ({withoutIngredients.length})
          </button>
          <button
            type="button"
            onClick={() => setShowArchived(current => !current)}
            className={`formula-filter-pill px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${showArchived ? 'bg-slate-700 text-white' : 'bg-white text-slate-600 hover:bg-slate-100 border border-slate-200'}`}
          >
            {showArchived ? 'Hide Archived' : 'Show Archived'} ({archivedCount})
          </button>
        </div>
      </div>

      {loading ? (
        <div className="text-center py-20 text-slate-400">Loading formulations...</div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-20">
          <FlaskConical className="w-12 h-12 text-slate-300 mx-auto mb-3" />
          <p className="text-slate-500">No formulations found</p>
        </div>
      ) : (
        <div className="space-y-6">
          {/* Formulations WITH Ingredients */}
          {(ingredientFilter === 'all' || ingredientFilter === 'with') && withIngredients.length > 0 && (
            <div>
              <div className="formula-section-heading flex items-center gap-2 mb-3">
                <div className="w-3 h-3 bg-emerald-500 rounded-full"></div>
                <h3 className="text-sm font-semibold text-slate-700">Formulas with Ingredients ({withIngredients.length})</h3>
              </div>
              <div className="formula-table-card bg-white rounded-xl border border-slate-200 overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[1120px] text-sm [&_th]:whitespace-nowrap [&_td]:align-middle [&_td:not(:first-child)]:whitespace-nowrap">
                    <thead className="bg-slate-50 border-b border-slate-200 [&_th]:text-slate-600 [&_th]:tracking-normal [&_th]:normal-case">
                      <tr>
                        {compareMode && <th className="px-4 py-3 text-left w-12"><input type="checkbox" className="rounded border-slate-300" disabled /></th>}
                        <th className="px-4 py-3 text-left text-xs font-semibold text-emerald-700 uppercase tracking-wider">Formula</th>
                        <th className="px-4 py-3 text-left text-xs font-semibold text-emerald-700 uppercase tracking-wider">Code</th>
                        <th className="px-4 py-3 text-left text-xs font-semibold text-emerald-700 uppercase tracking-wider">Category</th>
                        <th className="px-4 py-3 text-center text-xs font-semibold text-emerald-700 uppercase tracking-wider">Ingredients</th>
                        <th className="px-4 py-3 text-center text-xs font-semibold text-emerald-700 uppercase tracking-wider">Version</th>
                        <th className="px-4 py-3 text-center text-xs font-semibold text-emerald-700 uppercase tracking-wider">Batch Size</th>
                        <th className="px-4 py-3 text-right text-xs font-semibold text-emerald-700 uppercase tracking-wider">Cost/Unit</th>
                        <th className="px-4 py-3 text-center text-xs font-semibold text-emerald-700 uppercase tracking-wider">Daily Active</th>
                        <th className="px-4 py-3 text-center text-xs font-semibold text-emerald-700 uppercase tracking-wider">Status</th>
                        <th className="px-4 py-3 text-center text-xs font-semibold text-emerald-700 uppercase tracking-wider">Action</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {withIngredients.map(group => {
                        const f = group.current;
                        return (
                        <tr 
                          key={f.id}
                          className={`hover:bg-emerald-50 transition-colors ${
                            compareSelected.find(c => c.id === f.id)
                              ? 'bg-amber-50'
                              : ''
                          }`}
                        >
                          {compareMode && (
                            <td className="px-4 py-3 text-center">
                              <input 
                                type="checkbox" 
                                checked={!!compareSelected.find(c => c.id === f.id)}
                                onChange={() => toggleCompareSelect(f)}
                                className="rounded border-slate-300 text-amber-500 focus:ring-amber-500" 
                              />
                            </td>
                          )}
                          <td className="px-4 py-3">
                            <button
                              onClick={() => compareMode ? toggleCompareSelect(f) : openDetail(f)}
                              className="flex min-w-48 items-center gap-2 text-left hover:text-emerald-600 transition-colors"
                            >
                              <div className="w-8 h-8 rounded-lg bg-emerald-50 flex items-center justify-center flex-shrink-0">
                                <FlaskConical className="w-4 h-4 text-emerald-600" />
                              </div>
                              <span className="font-medium text-slate-800 hover:underline">{f.name}</span>
                            </button>
                          </td>
                          <td className="px-4 py-3">
                            <code className="text-xs bg-slate-100 px-2 py-1 rounded text-slate-700">{f.code}</code>
                          </td>
                          <td className="px-4 py-3">
                            <span className="text-xs font-medium text-slate-600">
                              {getFormulationCategory(f.name, f.category)}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-center">
                            <span className="inline-flex items-center gap-1 px-2 py-1 bg-emerald-100 text-emerald-700 rounded-full text-xs font-semibold">
                              {formulationIngredientCounts[f.id] || 0}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-center">
                            <select
                              value={f.id}
                              onChange={e => {
                                const version = group.versions.find(item => item.id === e.target.value);
                                if (version) openDetail(version);
                              }}
                              className="rounded-md border border-slate-200 bg-white px-2 py-1 text-xs font-semibold text-slate-700"
                              aria-label={`Version history for ${f.name}`}
                            >
                              {group.versions.map(version => (
                                <option key={version.id} value={version.id}>
                                  v{version.version}{version.id === f.id ? ' · Current' : ''}
                                </option>
                              ))}
                            </select>
                          </td>
                          <td className="px-4 py-3 text-center">
                            <span className="text-sm text-slate-700">{f.batch_size.toLocaleString()} {f.batch_unit}</span>
                          </td>
                          <td className="px-4 py-3 text-right">
                            <span className="text-sm font-semibold text-teal-700">${f.estimated_cost_per_unit.toFixed(2)}</span>
                          </td>
                          <td className="px-4 py-3 text-center">
                            {(() => {
                              const activeIds: string[] = JSON.parse(localStorage.getItem('daily_active_formulations') || '[]');
                              const isActiveToday = activeIds.includes(f.id) || (f as any).is_daily_active;

                              if (isActiveToday) {
                                return (
                                  <span className="inline-flex items-center gap-1 px-2.5 py-1 bg-emerald-600 text-white rounded-full text-xs font-extrabold shadow-sm">
                                    ✨ Active Today
                                  </span>
                                );
                              }
                              return (
                                <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-slate-100 text-slate-500 rounded-full text-[10px] font-bold">
                                  Deactivated
                                </span>
                              );
                            })()}
                          </td>
                          <td className="px-4 py-3 text-center">
                            <StatusBadge status={f.status} />
                          </td>
                          <td className="px-4 py-3 text-center">
                            <div className="flex items-center justify-center gap-1">
                              {isFinanceUser && (() => {
                                const activeIds: string[] = JSON.parse(localStorage.getItem('daily_active_formulations') || '[]');
                                const isActiveToday = activeIds.includes(f.id) || (f as any).is_daily_active;

                                if (isActiveToday) {
                                  return (
                                    <button
                                      onClick={async () => {
                                        try {
                                          const updatedActiveIds = activeIds.filter(id => id !== f.id);
                                          localStorage.setItem('daily_active_formulations', JSON.stringify(updatedActiveIds));
                                          
                                          await supabase
                                            .from('formulations')
                                            .update({ status: 'draft', updated_at: new Date().toISOString() })
                                            .eq('id', f.id);

                                          setToastMessage(`Formulation "${f.name}" deactivated.`);
                                          setTimeout(() => setToastMessage(null), 3000);
                                          await fetchFormulations();
                                        } catch (err: any) {
                                          console.error('Deactivate error:', err);
                                        }
                                      }}
                                      className="inline-flex items-center gap-1 px-2.5 py-1 text-[10px] font-extrabold bg-slate-100 hover:bg-slate-200 text-slate-700 border border-slate-300 rounded-md transition-colors"
                                      title="Deactivate Formulation for Today"
                                    >
                                      Deactivate
                                    </button>
                                  );
                                }

                                return (
                                  <button
                                    onClick={async () => {
                                      try {
                                        if (!isFinanceUser) {
                                          alert('Only Finance can approve a formula for production.');
                                          return;
                                        }
                                        const readiness = formulaReadiness[f.id];
                                        if (!readiness?.isBalanced) {
                                          alert(`Cannot activate this formula. Active BOM total is ${(readiness?.ingredientTotalKg || 0).toFixed(2)} kg; reference batch is ${Number(f.batch_size || 0).toFixed(2)} kg.`);
                                          await openEdit(f);
                                          return;
                                        }
                                        const { data: { user } } = await supabase.auth.getUser();

                                        // Update status and approved_by in Supabase
                                        const { error: updateErr } = await supabase
                                          .from('formulations')
                                          .update({
                                            status: 'active',
                                            approved_by: user?.id || null,
                                            updated_at: new Date().toISOString(),
                                          })
                                          .eq('id', f.id);

                                        if (updateErr) {
                                          console.warn('Formulation status update warning:', updateErr);
                                        }

                                        // Track daily active formulation in storage
                                        if (!activeIds.includes(f.id)) {
                                          activeIds.push(f.id);
                                          localStorage.setItem('daily_active_formulations', JSON.stringify(activeIds));
                                        }

                                        setToastMessage(`✨ "${f.name} (v${f.version})" is now ACTIVE for Today's Production!`);
                                        setTimeout(() => setToastMessage(null), 4000);
                                        await fetchFormulations();
                                      } catch (err: any) {
                                        console.error('Set active error:', err);
                                        setToastMessage(`✨ "${f.name} (v${f.version})" set as Active for Today.`);
                                        setTimeout(() => setToastMessage(null), 4000);
                                        await fetchFormulations();
                                      }
                                    }}
                                    className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold border border-teal-200 bg-teal-50 hover:bg-teal-100 text-teal-700 rounded-md transition-colors whitespace-nowrap"
                                    title="Set as Finance-Approved Active Formulation for Today"
                                  >
                                    <CheckCircle2 className="h-3.5 w-3.5" /> Activate
                                  </button>
                                );
                              })()}
                              <button
                                onClick={() => openDetail(f)}
                                className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium text-emerald-600 hover:bg-emerald-50 rounded transition-colors"
                              >
                                <ChevronRight className="w-3.5 h-3.5" />
                                View
                              </button>
                            </div>
                          </td>
                        </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {/* Formulations WITHOUT Ingredients */}
          {(ingredientFilter === 'all' || ingredientFilter === 'without') && withoutIngredients.length > 0 && (
            <div>
              <div className="formula-section-heading flex items-center gap-2 mb-3">
                <div className="w-3 h-3 bg-amber-500 rounded-full"></div>
                <h3 className="text-sm font-semibold text-slate-700">Formulas without Ingredients ({withoutIngredients.length})</h3>
              </div>
              <div className="formula-table-card bg-white rounded-xl border border-slate-200 overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[1000px] text-sm [&_th]:whitespace-nowrap [&_td]:align-middle">
                    <thead className="bg-amber-50 border-b border-amber-200">
                      <tr>
                        {compareMode && <th className="px-4 py-3 text-left w-12"><input type="checkbox" className="rounded border-slate-300" disabled /></th>}
                        <th className="px-4 py-3 text-left text-xs font-semibold text-amber-700 uppercase tracking-wider">Formula</th>
                        <th className="px-4 py-3 text-left text-xs font-semibold text-amber-700 uppercase tracking-wider">Code</th>
                        <th className="px-4 py-3 text-left text-xs font-semibold text-amber-700 uppercase tracking-wider">Category</th>
                        <th className="px-4 py-3 text-center text-xs font-semibold text-amber-700 uppercase tracking-wider">Version</th>
                        <th className="px-4 py-3 text-center text-xs font-semibold text-amber-700 uppercase tracking-wider">Batch Size</th>
                        <th className="px-4 py-3 text-right text-xs font-semibold text-amber-700 uppercase tracking-wider">Cost/Unit</th>
                        <th className="px-4 py-3 text-center text-xs font-semibold text-amber-700 uppercase tracking-wider">Status</th>
                        <th className="px-4 py-3 text-center text-xs font-semibold text-amber-700 uppercase tracking-wider">Action</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {withoutIngredients.map(group => {
                        const f = group.current;
                        return (
                        <tr 
                          key={f.id}
                          className={`hover:bg-amber-50 transition-colors ${
                            compareSelected.find(c => c.id === f.id)
                              ? 'bg-amber-100'
                              : ''
                          }`}
                        >
                          {compareMode && (
                            <td className="px-4 py-3 text-center">
                              <input 
                                type="checkbox" 
                                checked={!!compareSelected.find(c => c.id === f.id)}
                                onChange={() => toggleCompareSelect(f)}
                                className="rounded border-slate-300 text-amber-500 focus:ring-amber-500" 
                              />
                            </td>
                          )}
                          <td className="px-4 py-3">
                            <button
                              onClick={() => compareMode ? toggleCompareSelect(f) : openDetail(f)}
                              className="flex items-center gap-2 hover:text-amber-600 transition-colors"
                            >
                              <div className="w-8 h-8 rounded-lg bg-amber-50 flex items-center justify-center flex-shrink-0">
                                <FlaskConical className="w-4 h-4 text-amber-600" />
                              </div>
                              <span className="font-medium text-slate-800 hover:underline">{f.name}</span>
                            </button>
                          </td>
                          <td className="px-4 py-3">
                            <code className="text-xs bg-slate-100 px-2 py-1 rounded text-slate-700">{f.code}</code>
                          </td>
                          <td className="px-4 py-3">
                            <span className={`px-2.5 py-1 text-xs rounded-full inline-block ${catColor[getFormulationCategory(f.name, f.category)] || catColor['Other']}`}>
                              {getFormulationCategory(f.name, f.category)}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-center">
                            <select
                              value={f.id}
                              onChange={e => {
                                const version = group.versions.find(item => item.id === e.target.value);
                                if (version) openDetail(version);
                              }}
                              className="rounded-md border border-slate-200 bg-white px-2 py-1 text-xs font-semibold text-slate-700"
                              aria-label={`Version history for ${f.name}`}
                            >
                              {group.versions.map(version => (
                                <option key={version.id} value={version.id}>
                                  v{version.version}{version.id === f.id ? ' · Current' : ''}
                                </option>
                              ))}
                            </select>
                          </td>
                          <td className="px-4 py-3 text-center">
                            <span className="text-sm text-slate-700">{f.batch_size.toLocaleString()} {f.batch_unit}</span>
                          </td>
                          <td className="px-4 py-3 text-right">
                            <span className="text-sm font-semibold text-teal-700">${f.estimated_cost_per_unit.toFixed(2)}</span>
                          </td>
                          <td className="px-4 py-3 text-center">
                            <StatusBadge status={f.status} />
                          </td>
                          <td className="px-4 py-3 text-center">
                            <button
                              onClick={() => openDetail(f)}
                              className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium text-amber-600 hover:bg-amber-50 rounded transition-colors"
                            >
                              <ChevronRight className="w-3.5 h-3.5" />
                              View
                            </button>
                          </td>
                        </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      </>}
      {/* BOM Comparison Modal */}
      <Modal open={compareOpen} onClose={() => setCompareOpen(false)} title="BOM Comparison" size="xl">
        {compareSelected.length === 2 && (
          <div className="space-y-5">
            {/* Header row */}
            <div className="grid grid-cols-2 gap-4">
              {compareSelected.map((f, idx) => (
                <div key={f.id} className={`rounded-xl border-2 p-4 ${idx === 0 ? 'border-teal-300 bg-teal-50/40' : 'border-amber-300 bg-amber-50/40'}`}>
                  <div className="flex items-center gap-2 mb-2">
                    <span className={`w-5 h-5 rounded-full text-xs font-bold flex items-center justify-center text-white ${idx === 0 ? 'bg-teal-500' : 'bg-amber-500'}`}>{idx + 1}</span>
                    <p className="font-semibold text-slate-800">{f.name}</p>
                    <span className="text-xs text-slate-500 ml-auto">{f.code}</span>
                  </div>
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    {[['Batch', `${f.batch_size} ${f.batch_unit}`], ['Cost/Unit', `$${f.estimated_cost_per_unit.toFixed(2)}`], ['Protein', `${f.target_protein}%`], ['Fat', `${f.target_fat}%`]].map(([l, v]) => (
                      <div key={l} className="bg-white/70 rounded px-2 py-1"><span className="text-slate-400">{l}: </span><span className="font-medium text-slate-700">{v}</span></div>
                    ))}
                  </div>
                </div>
              ))}
            </div>

            {/* Ingredient comparison table */}
            <div>
              <h4 className="text-sm font-semibold text-slate-700 mb-2">Ingredient Comparison</h4>
              <div className="overflow-x-auto rounded-xl border border-slate-200">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 border-b border-slate-200">
                    <tr>
                      <th className="text-left px-4 py-2 font-medium text-slate-600">Material</th>
                      <th className="text-center px-4 py-2 font-medium text-teal-600">{compareSelected[0].code} %</th>
                      <th className="text-center px-4 py-2 font-medium text-amber-600">{compareSelected[1].code} %</th>
                      <th className="text-center px-4 py-2 font-medium text-slate-500">Δ</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {Array.from(new Set([
                      ...compareIngs[0].map((i: any) => i.raw_materials?.name || i.raw_material_id),
                      ...compareIngs[1].map((i: any) => i.raw_materials?.name || i.raw_material_id),
                    ])).map(name => {
                      const a = compareIngs[0].find((i: any) => (i.raw_materials?.name || i.raw_material_id) === name);
                      const b = compareIngs[1].find((i: any) => (i.raw_materials?.name || i.raw_material_id) === name);
                      const pctA = a ? Number(a.percentage) : 0;
                      const pctB = b ? Number(b.percentage) : 0;
                      const diff = pctB - pctA;
                      return (
                        <tr key={name} className="hover:bg-slate-50">
                          <td className="px-4 py-2 text-slate-700">{name}</td>
                          <td className="px-4 py-2 text-center">
                            {pctA > 0 ? <span className="px-2 py-0.5 bg-teal-50 text-teal-700 rounded text-xs font-medium">{pctA.toFixed(1)}%</span> : <span className="text-slate-300">—</span>}
                          </td>
                          <td className="px-4 py-2 text-center">
                            {pctB > 0 ? <span className="px-2 py-0.5 bg-amber-50 text-amber-700 rounded text-xs font-medium">{pctB.toFixed(1)}%</span> : <span className="text-slate-300">—</span>}
                          </td>
                          <td className="px-4 py-2 text-center text-xs font-medium">
                            {diff === 0 ? <span className="text-slate-400">0</span>
                              : diff > 0 ? <span className="text-emerald-600">+{diff.toFixed(1)}%</span>
                              : <span className="text-red-500">{diff.toFixed(1)}%</span>}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="flex justify-end">
              <button onClick={() => setCompareOpen(false)} className="flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-slate-600 bg-slate-100 rounded-lg hover:bg-slate-200 transition-colors">
                <X className="w-4 h-4" /> Close
              </button>
            </div>
          </div>
        )}
      </Modal>

      <Modal open={detailOpen} onClose={() => { setDetailOpen(false); setBomEditMode(false); }} title={selected?.name || ''} size="2xl" className="max-h-[96vh]">
        {selected && (
          <div className="space-y-4">
            {isFinanceUser && (
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 shadow-sm">
                <div className="flex items-center gap-2 text-xs text-slate-500">
                  <span className="font-mono font-bold text-slate-700">{selected.code}</span>
                  <span className="h-1 w-1 rounded-full bg-slate-300" />
                  <span>Formula control</span>
                </div>
                <div className="flex flex-wrap gap-1.5">
                <button onClick={() => createVersion(selected)} disabled={saving} className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold bg-teal-600 text-white rounded-lg hover:bg-teal-700 transition-colors disabled:opacity-50"><GitCompare className="w-3.5 h-3.5" /> New Version</button>
                {selected.status !== 'active' && (
                  <button onClick={() => openEdit(selected)} className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold bg-slate-100 text-slate-700 rounded-lg hover:bg-slate-200 transition-colors"><Edit2 className="w-3.5 h-3.5" /> Edit Formula</button>
                )}
                <button onClick={() => selected.status === 'active' ? createVersion(selected) : (() => { setBomEditMode(!bomEditMode); setBomEditIngs([...detailIngs]); })()} disabled={saving} className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold bg-slate-100 text-slate-700 rounded-lg hover:bg-slate-200 transition-colors disabled:opacity-50"><Edit2 className="w-3.5 h-3.5" /> {selected.status === 'active' ? 'Edit BOM in New Version' : (bomEditMode ? 'Cancel BOM Edit' : 'Edit BOM')}</button>
                <button onClick={() => handleDelete(selected.id)} className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-red-700 bg-red-50 rounded-lg hover:bg-red-100 transition-colors"><Trash2 className="w-3.5 h-3.5" /> Delete</button>
                </div>
              </div>
            )}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {[['Code', selected.code], ['Category', selected.category], ['Version', `v${selected.version}`], ['Status', selected.status], ['Batch Size', `${selected.batch_size} ${selected.batch_unit}`], ['Cost/Unit', `$${selected.estimated_cost_per_unit.toFixed(2)}`], ['Protein', `${selected.target_protein}%`], ['Fat', `${selected.target_fat}%`]].map(([l, v]) => (
                <div key={l as string} className="rounded-lg border border-slate-200 bg-white px-3 py-2 shadow-sm"><p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">{l}</p><p className={`mt-0.5 text-sm font-bold ${l === 'Status' ? (v === 'active' ? 'text-emerald-600' : v === 'draft' ? 'text-amber-600' : 'text-slate-600') : 'text-slate-800'}`}>{v}</p></div>
              ))}
            </div>
            {selected.description && <p className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600"><span className="font-bold text-slate-700">Notes:</span> {selected.description}</p>}
            <div>
              {/* Tab switcher */}
              <div className="flex items-center justify-between mb-2">
                <div className="flex gap-1 rounded-lg border border-slate-200 bg-slate-100 p-1 w-full">
                  {(['ingredients', 'packaging'] as const).map(t => (
                    <button key={t} onClick={() => { setDetailTab(t); setBomEditMode(false); }}
                      className={`px-3 py-1.5 text-xs font-bold rounded-md transition-colors ${
                        detailTab === t ? 'bg-white text-teal-700 shadow-sm' : 'text-slate-500 hover:text-slate-700'
                      }`}>
                      {t === 'ingredients' ? `Ingredients (${detailIngs.length})` : `Packaging (${detailPkgItems.length})`}
                    </button>
                  ))}
                  <div className="ml-auto">
                    {detailTab === 'ingredients' && bomEditMode && <span className="text-xs font-medium text-blue-600 bg-blue-50 px-2 py-1 rounded">Editing Mode</span>}
                  </div>
                </div>
              </div>
              {detailTab === 'ingredients' && detailIngs.length === 0 && <p className="text-sm text-slate-400">No ingredients added</p>}
              {detailTab === 'ingredients' && detailIngs.length > 0 && (
                <div className="overflow-hidden border border-slate-200 rounded-lg">
                  <table className="w-full text-[11px] leading-tight">
                    <thead><tr className="border-b border-slate-200 text-left bg-slate-50">
                      <th className="px-2 py-1.5 font-medium text-slate-600">Material Name</th>
                      <th className="px-2 py-1.5 font-medium text-slate-600 text-center">Type</th>
                      <th className="px-2 py-1.5 font-medium text-slate-600 text-right">Qty</th>
                      <th className="px-2 py-1.5 font-medium text-slate-600">Unit</th>
                      <th className="px-2 py-1.5 font-medium text-slate-600 text-right">%</th>
                      <th className="px-2 py-1.5 font-medium text-slate-600 text-right">Unit Cost</th>
                      <th className="px-2 py-1.5 font-medium text-slate-600 text-right">Total Cost</th>
                      <th className="px-2 py-1.5 font-medium text-slate-600 text-right">Stock</th>
                      <th className="px-2 py-1.5 font-medium text-slate-600 text-center">Critical</th>
                      {bomEditMode && <th className="px-3 py-2 font-medium text-red-400 text-center">Remove</th>}
                    </tr></thead>
                    <tbody>{(bomEditMode ? bomEditIngs : detailIngs).map((i, idx) => {
                      const unitCost = i.raw_materials?.cost_per_unit || 0;
                      const totalCost = i.quantity * unitCost;
                      const currentStock = i.raw_materials?.current_stock || 0;
                      const stockStatus = currentStock >= i.quantity ? 'text-emerald-600' : currentStock > 0 ? 'text-amber-600' : 'text-red-600';
                      const typeInfo = getIngredientTypeCode(i.raw_materials?.name || '', i.raw_materials?.code || '');
                      
                      return (
                        <tr key={i.id} className={`border-b border-slate-100 transition-colors ${
                          typeInfo.isPremix ? 'bg-amber-50/60 hover:bg-amber-100/60' : 'hover:bg-slate-50'
                        }`}>
                          <td className="px-3 py-2">
                            {bomEditMode ? (
                              <select
                                value={i.raw_material_id}
                                onChange={e => {
                                  const selected_mat = materials.find(m => m.id === e.target.value);
                                  const u = [...bomEditIngs];
                                  u[idx] = { ...u[idx], raw_material_id: e.target.value, raw_materials: selected_mat as any };
                                  setBomEditIngs(u);
                                }}
                                className="w-full px-2 py-1 border border-teal-200 rounded text-xs focus:outline-none focus:border-teal-500 bg-teal-50/50 font-medium"
                              >
                                <option value="">Select component / material...</option>
                                <optgroup label="✓ Materials in this formula / BOM (shown first)">
                                  {materials.filter(m => currentFormulaMaterialIds.has(m.id)).map(m => (
                                    <option key={m.id} value={m.id}>{m.code} — {m.name}</option>
                                  ))}
                                </optgroup>
                                <optgroup label="📦 Other premixes / macropacks">
                                  {materials.filter(m => !currentFormulaMaterialIds.has(m.id) && isMacropackMaterial(m)).map(m => (
                                    <option key={m.id} value={m.id}>📦 {m.code} — {m.name}</option>
                                  ))}
                                </optgroup>
                                <optgroup label="🌾 All other raw materials">
                                  {materials.filter(m => !currentFormulaMaterialIds.has(m.id) && !isMacropackMaterial(m)).map(m => (
                                    <option key={m.id} value={m.id}>{m.code} — {m.name}</option>
                                  ))}
                                </optgroup>
                              </select>
                            ) : (
                              <div className="flex items-center gap-1 whitespace-nowrap">
                                <span className="text-slate-800 font-bold">{i.raw_materials?.name || 'Unknown'}</span>
                                <span className="font-mono text-[9px] text-slate-500 bg-slate-100 px-1 py-0.5 rounded">({i.raw_materials?.code})</span>
                                {typeInfo.isPremix && (
                                  <span className="inline-flex items-center gap-0.5 text-[9px] font-black text-amber-900 bg-amber-200/80 border border-amber-300 px-1.5 py-0.5 rounded-full">
                                    {typeInfo.badgeLabel}
                                  </span>
                                )}
                              </div>
                            )}
                          </td>
                          <td className="px-3 py-2 text-center">
                            <span className={`font-mono text-xs font-bold px-2 py-0.5 rounded ${
                              typeInfo.isPremix ? 'bg-amber-200 text-amber-900 font-black' : 'bg-slate-100 text-slate-700'
                            }`}>
                              {typeInfo.typeCode}
                            </span>
                          </td>
                          <td className="px-3 py-2 text-right">
                            {bomEditMode ? (
                              <input
                                type="number"
                                step="0.01"
                                value={i.quantity}
                                onChange={e => {
                                  const val = parseFloat(e.target.value) || 0;
                                  const u = [...bomEditIngs];
                                  u[idx] = { ...u[idx], quantity: val };
                                  
                                  const totalWeight = u.reduce((s, row) => s + (Number(row.quantity) || 0), 0);
                                  if (totalWeight > 0) {
                                    u.forEach(row => {
                                      row.percentage = Math.round(((Number(row.quantity) / totalWeight) * 100) * 1000) / 1000;
                                    });
                                  }
                                  setBomEditIngs(u);
                                }}
                                className="w-20 px-2 py-1 border border-slate-200 rounded text-sm focus:outline-none focus:border-blue-500 font-bold"
                              />
                            ) : (
                              <span>{i.quantity.toFixed(2)}</span>
                            )}
                          </td>
                          <td className="px-3 py-2">
                            {bomEditMode ? (
                              <input type="text" value={i.unit} onChange={e => { const u = [...bomEditIngs]; u[idx] = { ...u[idx], unit: e.target.value }; setBomEditIngs(u); }} className="w-16 px-2 py-1 border border-slate-200 rounded text-sm focus:outline-none focus:border-blue-500" />
                            ) : (
                              <span>{i.unit}</span>
                            )}
                          </td>
                          <td className="px-3 py-2 text-right">
                            {bomEditMode ? (
                              <input type="number" min="0" max="100" step="0.1" value={i.percentage} onChange={e => { const u = [...bomEditIngs]; const percentage = parseFloat(e.target.value) || 0; u[idx] = { ...u[idx], percentage, quantity: Math.round((percentage / 100) * Number(selected.batch_size || 0) * 10000) / 10000 }; setBomEditIngs(u); }} className="w-16 px-2 py-1 border border-teal-200 bg-teal-50/40 rounded text-sm focus:outline-none focus:border-teal-500" title="Enter percentage; quantity recalculates from the formula batch size" />
                            ) : (
                              <span>{i.percentage.toFixed(1)}%</span>
                            )}
                          </td>
                          <td className="px-3 py-2 text-right text-slate-700 font-medium">${unitCost.toFixed(4)}</td>
                          <td className="px-3 py-2 text-right text-slate-700 font-semibold">${totalCost.toFixed(4)}</td>
                          <td className={`px-3 py-2 text-right font-medium ${stockStatus}`}>{currentStock.toLocaleString()}</td>
                          <td className="px-3 py-2 text-center">
                            {bomEditMode ? (
                              <input type="checkbox" checked={i.is_critical} onChange={e => { const u = [...bomEditIngs]; u[idx] = { ...u[idx], is_critical: e.target.checked }; setBomEditIngs(u); }} className="rounded border-slate-300 text-teal-600 focus:ring-teal-500" />
                            ) : (
                              <span>{i.is_critical ? <span className="text-xs font-medium text-red-600">●</span> : <span className="text-xs text-slate-300">○</span>}</span>
                            )}
                          </td>
                          {bomEditMode && (
                            <td className="px-3 py-2 text-center">
                              <button onClick={() => setBomEditIngs(bomEditIngs.filter((_, i2) => i2 !== idx))} className="p-1 text-red-400 hover:text-red-600 hover:bg-red-50 rounded transition-colors" title="Remove ingredient">
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </td>
                          )}
                        </tr>
                      );
                    })}</tbody>
                  </table>
                </div>
              )}
              {detailTab === 'ingredients' && bomEditMode && (
                <div className="space-y-3 mt-3">
                  <div className="flex flex-wrap items-center justify-between gap-2 p-3 bg-amber-50/80 border border-amber-200 rounded-xl">
                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        onClick={() => {
                          const newIng: FormulationIngredient = {
                            id: crypto.randomUUID(),
                            formulation_id: selected.id,
                            raw_material_id: '',
                            quantity: 0,
                            unit: 'kg',
                            percentage: 0,
                            is_critical: false,
                            sort_order: bomEditIngs.length + 1,
                          };
                          setBomEditIngs([...bomEditIngs, newIng]);
                        }}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-600 hover:to-amber-700 text-white rounded-lg text-xs font-extrabold shadow-sm transition-all active:scale-95"
                      >
                        <Plus className="w-3.5 h-3.5" /> ⭐️ Add Premix / Micro-Ingredient
                      </button>
                      <button
                        onClick={() => {
                          const newIng: FormulationIngredient = {
                            id: crypto.randomUUID(),
                            formulation_id: selected.id,
                            raw_material_id: '',
                            quantity: 0,
                            unit: 'kg',
                            percentage: 0,
                            is_critical: false,
                            sort_order: bomEditIngs.length + 1,
                          };
                          setBomEditIngs([...bomEditIngs, newIng]);
                        }}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-slate-800 hover:bg-slate-900 text-white rounded-lg text-xs font-extrabold shadow-sm transition-all active:scale-95"
                      >
                        <Plus className="w-3.5 h-3.5" /> + Add Ingredient Line
                      </button>
                      
                      {/* Separate 100% Matrix Buttons */}
                      <button
                        type="button"
                        onClick={() => {
                          // 100% Bulk Raw Material Matrix Distribution
                          const copy = [...bomEditIngs];
                          const bulkItems = copy.filter(i => {
                            const typeInfo = getIngredientTypeCode(i.raw_materials?.name || '', i.raw_materials?.code || '');
                            return !typeInfo.isPremix && i.raw_material_id;
                          });
                          const totalBulkQty = bulkItems.reduce((s, i) => s + (Number(i.quantity) || 0), 0);

                          if (totalBulkQty > 0) {
                            let sumBulkPct = 0;
                            copy.forEach(i => {
                              const typeInfo = getIngredientTypeCode(i.raw_materials?.name || '', i.raw_materials?.code || '');
                              if (!typeInfo.isPremix && i.raw_material_id) {
                                const p = Math.round(((Number(i.quantity) / totalBulkQty) * 100) * 1000) / 1000;
                                i.percentage = p;
                                sumBulkPct += p;
                              }
                            });
                            // Rounding adjust on largest bulk item
                            const diff = Math.round((100 - sumBulkPct) * 1000) / 1000;
                            if (Math.abs(diff) > 0 && bulkItems.length > 0) {
                              let maxIdx = 0;
                              let maxQty = -1;
                              copy.forEach((ing, idx) => {
                                const typeInfo = getIngredientTypeCode(ing.raw_materials?.name || '', ing.raw_materials?.code || '');
                                if (!typeInfo.isPremix && Number(ing.quantity) > maxQty) {
                                  maxQty = Number(ing.quantity);
                                  maxIdx = idx;
                                }
                              });
                              copy[maxIdx].percentage = Math.round((copy[maxIdx].percentage + diff) * 1000) / 1000;
                            }
                            setBomEditIngs(copy);
                            setToastMessage("📦 Bulk Raw Materials normalized to 100% Bulk Matrix!");
                            setTimeout(() => setToastMessage(null), 3000);
                          }
                        }}
                        className="inline-flex items-center gap-1 px-2.5 py-1.5 bg-emerald-100 hover:bg-emerald-200 text-emerald-800 border border-emerald-300 rounded-lg text-xs font-bold transition-all active:scale-95"
                        title="Calculate Bulk Ingredients Matrix to sum to 100%"
                      >
                        📦 100% Bulk Matrix
                      </button>

                      <button
                        type="button"
                        onClick={() => {
                          // 100% Total Batch Matrix Distribution (Bulk + Premix)
                          const copy = [...bomEditIngs];
                          const totalQty = copy.reduce((s, i) => s + (Number(i.quantity) || 0), 0);

                          if (totalQty > 0) {
                            let sumPct = 0;
                            copy.forEach(i => {
                              if (i.raw_material_id) {
                                const p = Math.round(((Number(i.quantity) / totalQty) * 100) * 1000) / 1000;
                                i.percentage = p;
                                sumPct += p;
                              }
                            });
                            const diff = Math.round((100 - sumPct) * 1000) / 1000;
                            if (Math.abs(diff) > 0 && copy.length > 0) {
                              let maxIdx = 0;
                              let maxQty = -1;
                              copy.forEach((ing, idx) => {
                                if (Number(ing.quantity) > maxQty) {
                                  maxQty = Number(ing.quantity);
                                  maxIdx = idx;
                                }
                              });
                              copy[maxIdx].percentage = Math.round((copy[maxIdx].percentage + diff) * 1000) / 1000;
                            }
                            setBomEditIngs(copy);
                            setToastMessage("⚡ All ingredients (Bulk + Premix) normalized to 100% Total Matrix!");
                            setTimeout(() => setToastMessage(null), 3000);
                          }
                        }}
                        className="inline-flex items-center gap-1 px-2.5 py-1.5 bg-sky-100 hover:bg-sky-200 text-sky-800 border border-sky-300 rounded-lg text-xs font-bold transition-all active:scale-95"
                        title="Calculate All Ingredients (Bulk + Premix) to sum to 100%"
                      >
                        ⚡ 100% Total Matrix
                      </button>
                    </div>
                    <div className="text-xs text-amber-900 font-bold">
                      BOM Lines: {bomEditIngs.length} | Total Weight: {bomEditIngs.reduce((s, i) => s + (Number(i.quantity) || 0), 0).toLocaleString()} kg
                    </div>
                  </div>

                  <div className="flex justify-end gap-2 pt-2 border-t border-slate-200">
                    <button onClick={() => setBomEditMode(false)} className="px-3 py-1.5 text-xs font-medium text-slate-600 bg-slate-100 rounded-lg hover:bg-slate-200 transition-colors">Cancel</button>
                    <button onClick={saveBomEdits} disabled={saving} className="px-4 py-2 text-xs font-extrabold text-white bg-teal-600 hover:bg-teal-700 rounded-lg transition-all shadow-md disabled:opacity-50">{saving ? 'Saving...' : 'Save BOM Changes'}</button>
                  </div>
                </div>
              )}

              {/* Packaging Tab */}
              {detailTab === 'packaging' && (
                <div className="space-y-3">
                  <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                    <strong>Linked product:</strong> {selected.code} — {selected.name}. Packaging below belongs only to this formula and is calculated from its standard {selected.batch_size.toLocaleString()} {selected.batch_unit} batch.
                  </div>
                  <div className="border border-slate-200 rounded-lg overflow-hidden">
                    <table className="w-full text-xs">
                      <thead className="bg-slate-50 border-b border-slate-200">
                        <tr>
                          <th className="px-3 py-2 text-left font-medium text-slate-600">Item Code</th>
                          <th className="px-3 py-2 text-left font-medium text-slate-600">Description</th>
                          <th className="px-3 py-2 text-right font-medium text-slate-600">Qty / Tonne</th>
                          <th className="px-3 py-2 text-right font-medium text-slate-600">Expected / Formula Batch</th>
                          <th className="px-3 py-2 text-left font-medium text-slate-600">Unit</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {detailPkgItems.length === 0 ? (
                          <tr><td colSpan={5} className="px-3 py-4 text-center text-slate-400">No packaging items defined for this formulation</td></tr>
                        ) : detailPkgItems.map(item => (
                          <tr key={item.id} className="hover:bg-slate-50">
                            <td className="px-3 py-2 font-mono text-slate-700">{item.item_code}</td>
                            <td className="px-3 py-2 text-slate-600">{item.description}</td>
                            <td className="px-3 py-2 text-right tabular-nums text-slate-800">{Number(item.expected_qty_per_tonne).toFixed(4)}</td>
                            <td className="px-3 py-2 text-right tabular-nums font-semibold text-teal-700">{((Number(item.expected_qty_per_tonne || 0) / 1000) * Number(selected.batch_size || 0)).toFixed(4)}</td>
                            <td className="px-3 py-2 text-slate-500">{item.unit}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <div className="space-y-1">
                    <p className="text-xs font-semibold text-slate-600">Add Packaging Item</p>
                    <div className="flex items-center gap-2">
                      <input placeholder="Code" className="w-24 border border-slate-300 rounded px-2 py-1 text-xs" id="fpkg-code" />
                      <input placeholder="Description" className="flex-1 border border-slate-300 rounded px-2 py-1 text-xs" id="fpkg-desc" />
                      <input placeholder="Qty/tonne" type="number" className="w-24 border border-slate-300 rounded px-2 py-1 text-xs text-right" id="fpkg-qty" />
                      <input placeholder="Unit" className="w-16 border border-slate-300 rounded px-2 py-1 text-xs" id="fpkg-unit" defaultValue="units" />
                      <button type="button" onClick={async () => {
                        const code = (document.getElementById('fpkg-code') as HTMLInputElement)?.value.trim();
                        const desc = (document.getElementById('fpkg-desc') as HTMLInputElement)?.value.trim();
                        const qty = parseFloat((document.getElementById('fpkg-qty') as HTMLInputElement)?.value || '0');
                        const unit = (document.getElementById('fpkg-unit') as HTMLInputElement)?.value.trim() || 'units';
                        if (!code || !desc || !qty) { alert('Fill in Code, Description and Qty/tonne'); return; }
                        const { error } = await supabase.from('production_bom_packaging').insert({ formulation_id: selected!.id, item_code: code, description: desc, unit, expected_qty_per_tonne: qty });
                        if (error) { alert(error.message); return; }
                        const { data } = await supabase.from('production_bom_packaging').select('*').eq('formulation_id', selected!.id);
                        setDetailPkgItems(data || []);
                      }} className="px-3 py-1 bg-teal-600 text-white rounded text-xs hover:bg-teal-700">Add</button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </Modal>

      <Modal open={editOpen} onClose={() => setEditOpen(false)} title={editId ? `Formula ${form.code} / Version ${form.version}` : 'Create Formula & BOM'} size="4xl" className="formula-editor" footer={
        <div className="flex w-full flex-wrap items-center justify-end gap-2">
          <button onClick={() => setEditOpen(false)} className="formula-editor-secondary-action px-3 py-2 text-sm font-medium text-slate-600 rounded-md hover:bg-slate-100">Cancel</button>
          {formulaStage === 'bom' && <button type="button" onClick={() => setFormulaStage('formula')} className="formula-editor-secondary-action px-3 py-2 text-sm font-medium text-slate-700 border border-slate-300 rounded-md">Back to Formula</button>}
          {formulaStage === 'formula' ? (
            <button type="button" onClick={continueToBom} disabled={saving || !form.name || !form.code} className="formula-editor-primary-action px-4 py-2 text-sm font-semibold text-white bg-teal-600 rounded-md hover:bg-teal-700 disabled:opacity-50">{editId ? 'Recalculate BOM from Formula' : 'Generate BOM from Formula'}</button>
          ) : (
            <button onClick={handleSave} disabled={saving || !form.name || !form.code} className="formula-editor-primary-action px-4 py-2 text-sm font-semibold text-white bg-teal-600 rounded-md hover:bg-teal-700 disabled:opacity-50">{saving ? 'Saving...' : 'Generate & Save BOM'}</button>
          )}
        </div>
      }>
        <div className="formula-editor-stepper">
          <div className="formula-editor-stepper-copy">
            <p className="formula-editor-stepper-title">{formulaStage === 'formula' ? 'Build the formula specification' : 'Review the generated BOM'}</p>
            <p className="formula-editor-stepper-subtitle">{formulaStage === 'formula' ? 'Enter the reference-batch quantities from the signed formula sheet.' : 'Confirm the calculated quantities before saving this production BOM.'}</p>
          </div>
          <div className="formula-editor-stepper-badges" aria-label="Formula workflow progress">
            <span className={`formula-editor-step ${formulaStage === 'formula' ? 'active' : 'done'}`}>1&nbsp; Formula Input</span>
            <span className="formula-editor-step-arrow">›</span>
            <span className={`formula-editor-step ${formulaStage === 'bom' ? 'active' : ''}`}>2&nbsp; Generated BOM</span>
          </div>
        </div>
        {legacyBomNotice && formulaStage === 'formula' && (
          <div className="mb-5 flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-amber-900">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
            <div>
              <p className="text-xs font-extrabold uppercase tracking-wide">Legacy BOM needs formula confirmation</p>
              <p className="mt-1 text-xs leading-5 text-amber-800">
                This existing BOM totals <strong>{legacyBomNotice.bomTotal.toFixed(2)} kg</strong>, while its reference batch is <strong>{legacyBomNotice.referenceBatch.toFixed(2)} kg</strong>.
                Review the ingredient ratios above, then use <strong>Recalculate BOM from Formula</strong>. The system will scale those ratios to the reference batch; the existing BOM is not changed until you save the generated result.
              </p>
            </div>
          </div>
        )}
        <div className="formula-editor-layout">
          <aside className="formula-editor-details">
          <div>
            <h4 className="formula-editor-section-title">Formula details</h4>
            <p className="formula-editor-section-help">Identify the finished product and define the standard batch used for the formula.</p>
          </div>

          <div className="grid grid-cols-2 gap-2">
            {!editId && <div className="col-span-2">
                <label className="block text-xs font-medium text-slate-600 mb-1">Start a new version from an existing formula (optional)</label>
              <input
                list="existing-formula-options"
                value={sourceFormulaSearch}
                onChange={e => {
                  const value = e.target.value;
                  setSourceFormulaSearch(value);
                  const selected = allFormulaGroups.map(group => group.current).find(f => {
                    const label = `${f.name} (${f.code}) · v${f.version} · ${(formulationIngredientCounts[f.id] || 0)} BOM items · ${f.status}`;
                    return label === value;
                  });
                  if (selected) handleSourceFormulaChange(selected.id);
                  else if (!value) handleSourceFormulaChange('');
                }}
                className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500 bg-white"
                placeholder="Search and select an existing formula..."
                aria-label="Search and select an existing formula"
              />
              <datalist id="existing-formula-options">
                <option value="— Start independent formula —" />
                {allFormulaGroups.map(group => {
                  const f = group.current;
                  return (
                  <option key={f.id} value={`${f.name} (${f.code}) · v${f.version} · ${(formulationIngredientCounts[f.id] || 0)} BOM items · ${f.status}`} />
                  );
                })}
              </datalist>
              {sourceFormulaId && (() => {
                const source = formulations.find(f => f.id === sourceFormulaId);
                const sourceGroup = source && allFormulaGroups.find(group => group.key === (source.code || source.name));
                if (!sourceGroup || sourceGroup.versions.length < 2) return null;
                return (
                  <div className="mt-2">
                    <label className="block text-[11px] font-medium text-slate-500 mb-1">Choose version from history</label>
                    <select
                      value={sourceFormulaId}
                      onChange={e => {
                        const version = sourceGroup.versions.find(item => item.id === e.target.value);
                        if (!version) return;
                        const label = `${version.name} (${version.code}) · v${version.version} · ${(formulationIngredientCounts[version.id] || 0)} BOM items · ${version.status}`;
                        setSourceFormulaSearch(label);
                        handleSourceFormulaChange(version.id);
                      }}
                      className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500 bg-white"
                      aria-label="Choose formula version from history"
                    >
                      {sourceGroup.versions.map(version => (
                        <option key={version.id} value={version.id}>
                          v{version.version}{version.id === sourceGroup.current.id ? ' · Current' : ` · ${version.status}`}
                        </option>
                      ))}
                    </select>
                  </div>
                );
              })()}
              {/* Keep the independent option explicit and reset the picker to blank. */}
              <button
                type="button"
                onClick={() => handleSourceFormulaChange('')}
                className="mt-2 text-left text-xs font-semibold text-slate-600 hover:text-teal-700"
              >
                Start independent formula
              </button>
              {sourceFormulaId && !form.name && (
                <p className="text-[11px] text-amber-700 mt-1">Loading the selected formula and its ingredient specification...</p>
              )}
              {!editId && copiedBatchSize && (
                <p className="text-[11px] text-emerald-700 mt-1">New draft version v{form.version} started from the existing formula. The original version remains unchanged.</p>
              )}
            </div>}
            <div className="col-span-2">
              <label className="block text-xs font-medium text-slate-600 mb-1">Name *</label>
              <input type="text" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500" placeholder="e.g., Broiler Grower Crumbs 50kg" />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Code *</label>
              <input type="text" value={form.code} onChange={e => setForm({ ...form, code: e.target.value.toUpperCase() })} className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500" placeholder="e.g., BGC50-V2" />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Sage Code</label>
              <input type="text" value={form.sage_code} onChange={e => setForm({ ...form, sage_code: e.target.value.toUpperCase() })} className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500" placeholder="e.g., BGC50" />
            </div>
            <div><label className="block text-xs font-medium text-slate-600 mb-1">Batch Unit</label>
              <input type="text" value={form.batch_unit} onChange={e => setForm({ ...form, batch_unit: e.target.value })} className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500" /></div>
            <div><label className="block text-xs font-medium text-slate-600 mb-1">Bag size (optional)</label>
              <input type="text" value={form.unit_size_variants[0]?.size || ''} onChange={e => { const v = [...form.unit_size_variants]; v[0] = { ...v[0], size: e.target.value }; setForm({ ...form, unit_size_variants: v }); }} className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500" placeholder="e.g., 5kg" /></div>
            <div><label className="block text-xs font-medium text-slate-600 mb-1">Reference batch (kg) *</label>
              <input type="number" min="0.01" step="0.01" value={form.batch_size} onChange={e => updateReferenceBatchSize(e.target.value)} className="w-full px-3 py-2 border border-teal-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500" placeholder="e.g., 1000.00" />
              </div>
            <div><label className="block text-xs font-medium text-slate-600 mb-1">Category</label>
              <select
                value={form.category}
                onChange={e => setForm({ ...form, category: e.target.value })}
                className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500 bg-white"
              >
                <option value="">Select a category...</option>
                {categories.map((c) => (
                  <option key={c.code} value={c.code}>{c.name}</option>
                ))}
              </select></div>
            <div><label className="block text-xs font-medium text-slate-600 mb-1">Status</label>
              <select value={form.status} onChange={e => setForm({ ...form, status: e.target.value as any })} className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500 bg-white">
                <option value="draft">Draft</option><option value="active">Active</option><option value="archived">Archived</option>
              </select></div>
            <div className="col-span-2"><label className="block text-xs font-medium text-slate-600 mb-1">Description</label>
              <input type="text" value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500" /></div>
          </div>

          <div>
            <h4 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">Nutritional Targets</h4>
            <div className="grid grid-cols-2 gap-2">
              {[['Protein %', 'target_protein'], ['Fat %', 'target_fat'], ['Fiber %', 'target_fiber'], ['Moisture %', 'target_moisture']].map(([l, k]) => (
                <div key={k}><label className="block text-xs font-medium text-slate-600 mb-1">{l}</label>
                  <input type="number" step="0.1" value={(form as any)[k]} onChange={e => setForm({ ...form, [k]: Number(e.target.value) })} className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500" /></div>
              ))}
            </div>
          </div>
          </aside>
          <section className="formula-editor-ingredients">
            <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
              <div>
                <h4 className="formula-editor-section-title">{formulaStage === 'formula' ? 'Formula ingredients' : 'Generated BOM'} <span className="ml-1 text-slate-400">({ings.length})</span></h4>
                <p className="formula-editor-section-help">{formulaStage === 'formula' ? 'Use the full raw-material names from the master list. The initials on the paper sheet are only shorthand.' : 'Review and adjust materials or quantities before saving the production BOM. The mass balance must still equal the reference batch.'}</p>
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <span className={`formula-editor-metric ${formulaBatchSize > 0 && Math.abs(formulaBalanceDifference) <= 0.01 ? 'is-valid' : 'is-warning'}`}>Mass balance: {formulaIngredientTotal.toFixed(2)} / {formulaBatchSize.toFixed(2)} kg</span>
                <span className={`formula-editor-metric ${Math.abs(totalPct - 100) < 0.01 ? 'is-valid' : 'is-warning'}`}>Total: {totalPct.toFixed(1)}%</span>
                <button onClick={() => setIngs([...ings, emptyIng()])} className="flex items-center gap-1 px-2.5 py-1 text-xs font-medium bg-teal-50 text-teal-700 rounded-lg hover:bg-teal-100 transition-colors"><Plus className="w-3.5 h-3.5" /> Add material</button>
              </div>
            </div>
            <div className="formula-editor-table">
            <table className="w-full text-sm table-fixed">
              <thead><tr className="border-b border-slate-200 text-left">
                <th className="pb-2 font-medium text-slate-500 text-xs">Raw Material</th><th className="pb-2 font-medium text-slate-500 text-xs w-24">Qty</th><th className="pb-2 font-medium text-slate-500 text-xs w-20">Unit</th><th className="pb-2 font-medium text-slate-500 text-xs w-20">%</th><th className="pb-2 font-medium text-slate-500 text-xs w-16">Critical</th><th className="pb-2 w-10"></th>
              </tr></thead>
              <tbody>{ings.map((ing, idx) => (
                <tr key={idx} className="border-b border-slate-50">
                  <td className="py-1.5 pr-2">
                    <select value={ing.raw_material_id} onChange={e => { const u = [...ings]; const mat = materials.find(m => m.id === e.target.value); u[idx] = { ...u[idx], raw_material_id: e.target.value, unit: mat?.unit || ing.unit }; setIngs(u); }} className="w-full px-2 py-1.5 border border-slate-200 rounded text-sm bg-white focus:outline-none focus:border-teal-500 font-medium">
                      <option value="">Select component / material...</option>
                      {draftFormulaMaterialIds.size > 0 && <optgroup label="✓ Materials already in this formula / BOM (shown first)">
                        {materials.filter(m => draftFormulaMaterialIds.has(m.id)).map(m => (
                          <option key={m.id} value={m.id}>{m.code} — {m.name}</option>
                        ))}
                      </optgroup>
                      }
                      <optgroup label="🌾 All other raw materials">
                        {materials.filter(m => !draftFormulaMaterialIds.has(m.id) && !isMacropackMaterial(m)).map(m => (
                          <option key={m.id} value={m.id}>{m.code} — {m.name}</option>
                        ))}
                      </optgroup>
                      <optgroup label="📦 Other premixes / manufactured materials">
                        {materials.filter(m => !draftFormulaMaterialIds.has(m.id) && isMacropackMaterial(m)).map(m => (
                          <option key={m.id} value={m.id}>📦 {m.code} — {m.name}</option>
                        ))}
                      </optgroup>
                    </select></td>
                  <td className="py-1.5 pr-2"><input type="number" min="0" step="0.01" value={editingIngredientQuantity === idx ? String(ing.quantity ?? '') : Number(ing.quantity || 0).toFixed(2)} onFocus={() => setEditingIngredientQuantity(idx)} onBlur={() => setEditingIngredientQuantity(null)} onChange={e => { const u = [...ings]; u[idx] = { ...u[idx], quantity: Number(e.target.value) }; setIngs(recalculatePercentages(u, formulaBatchSize)); }} className="w-full px-2 py-1.5 border border-slate-200 rounded text-sm focus:outline-none focus:border-teal-500" /></td>
                  <td className="py-1.5 pr-2"><input type="text" value={ing.unit} onChange={e => { const u = [...ings]; u[idx] = { ...u[idx], unit: e.target.value }; setIngs(u); }} className="w-full px-2 py-1.5 border border-slate-200 rounded text-sm focus:outline-none focus:border-teal-500" /></td>
                  <td className="py-1.5 pr-2"><span className="block rounded border border-slate-200 bg-slate-50 px-2 py-1.5 text-sm text-slate-700">{Number(ing.percentage || 0).toFixed(3)}%</span></td>
                  <td className="py-1.5 pr-2 text-center"><input type="checkbox" checked={ing.is_critical} onChange={e => { const u = [...ings]; u[idx] = { ...u[idx], is_critical: e.target.checked }; setIngs(u); }} className="rounded border-slate-300 text-teal-600 focus:ring-teal-500" /></td>
                  <td className="py-1.5"><button onClick={() => setIngs(ings.filter((_, i) => i !== idx))} className="p-1 text-slate-400 hover:text-red-600 transition-colors" title="Remove material"><Trash2 className="w-3.5 h-3.5" /></button></td>
                </tr>
              ))}</tbody>
            </table>
            </div>
          </section>
        </div>
      </Modal>
    </div>
  );
}
