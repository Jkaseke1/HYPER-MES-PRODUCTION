export interface ReconciliationPeriod {
  id: string;
  month: number;
  year: number;
  branch_id: string | null;
  status: 'draft' | 'in_progress' | 'completed' | 'approved';
  received_raw_materials_t: number;
  transferred_rm_to_prod_t: number;
  exp_production_via_bulks_t: number;
  exp_production_via_macropacks_t: number;
  exp_production_via_packaging_t: number;
  actual_declared_production_t: number;
  transferred_prod_to_dispatch_t: number;
  expected_dispatched_t: number;
  actual_dispatched_t: number;
  notes: string;
  created_by: string | null;
  approved_by: string | null;
  created_at: string;
  updated_at: string;
  branches?: { name: string };
}

export interface ReconRawMaterial {
  id: string;
  period_id: string;
  material_type: 'minivits' | 'bulk';
  material_name: string;
  raw_material_id: string | null;
  opening_stock: number;
  stock_receipts: number;
  total: number;
  issues: number;
  physical_stock: number;
  system_stock: number;
  material_variance: number;
  variance_pct: number;
  comments: string;
  created_at: string;
  updated_at: string;
}

export interface ReconProduction {
  id: string;
  period_id: string;
  production_type: 'bulk' | 'packaging';
  product_name: string;
  formulation_id: string | null;
  opening_stock: number;
  stock_received: number;
  total: number;
  expected_production: number;
  conversion_produced: number;
  wastage: number;
  closing_stock: number;
  physical_stock: number;
  system_stock: number;
  material_variance: number;
  variance_pct: number;
  bag_size_kg: number;
  expected_bags: number;
  physical_bags: number;
  system_bags: number;
  bag_variance: number;
  bag_variance_pct: number;
  comments: string;
  created_at: string;
  updated_at: string;
}

export interface ReconMacropack {
  id: string;
  period_id: string;
  macropack_name: string;
  formulation_id: string | null;
  opening_stock: number;
  manufactured_units: number;
  total_units: number;
  converted_units: number;
  closing_stock: number;
  system_units: number;
  material_variance: number;
  variance_pct: number;
  comments: string;
  created_at: string;
  updated_at: string;
}

export interface ReconMacropackUsage {
  id: string;
  recon_macropack_id: string;
  ingredient_name: string;
  raw_material_id: string | null;
  quantity_used: number;
  unit: string;
  created_at: string;
}

export interface ReconFinishedGood {
  id: string;
  period_id: string;
  product_name: string;
  formulation_id: string | null;
  opening_stock: number;
  receipt_from_production: number;
  total: number;
  dispatched: number;
  closing_stock: number;
  physical_stock: number;
  system_stock: number;
  material_variance: number;
  variance_pct: number;
  bag_size_kg: number;
  dispatched_bags: number;
  physical_bags: number;
  system_bags: number;
  bag_variance: number;
  bag_variance_pct: number;
  comments: string;
  created_at: string;
  updated_at: string;
}

export interface ReconObservation {
  id: string;
  period_id: string;
  section: 'statistics' | 'bulks' | 'packaging' | 'macropacks' | 'finished_goods';
  observation: string;
  severity: 'info' | 'warning' | 'critical';
  created_by: string | null;
  created_at: string;
}

export const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
] as const;

export type ReconSection = 'overview' | 'minivits' | 'bulk_rm' | 'bulk_production' | 'packaging' | 'macropacks' | 'finished_goods';
