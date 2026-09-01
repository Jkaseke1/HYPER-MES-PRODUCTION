export interface Profile {
  id: string;
  full_name: string;
  role: 'md' | 'production_manager' | 'supervisor' | 'warehouse_manager' | 'logistics' | 'operator' | 'finance' | 'admin' | 'raw_material_manager' | 'accountant' | string;
  email: string;
  phone: string;
  created_at: string;
  updated_at: string;
}

export interface Branch {
  id: string;
  name: string;
  code: string;
  sage_code?: string | null;
  sage_warehouse_code?: string | null;
  sage_warehouse_id?: number | null;
  address: string;
  contact_person: string;
  phone: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface Warehouse {
  id: string;
  name: string;
  code: string;
  sage_warehouse_code?: string | null;
  sage_warehouse_id?: number | null;
  type: 'raw_material' | 'finished_goods';
  branch_id: string | null;
  location: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  branches?: Branch;
}

export interface Machine {
  id: string;
  name: string;
  code: string;
  type: string;
  capacity_per_hour: number;
  capacity_unit: string;
  status: 'operational' | 'maintenance' | 'breakdown' | 'decommissioned';
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface Supplier {
  id: string;
  name: string;
  code: string;
  sage_code: string | null;
  contact_person: string;
  email: string;
  phone: string;
  address: string;
  payment_terms: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface RawMaterial {
  id: string;
  name: string;
  code: string;
  category: string;
  unit: string;
  cost_per_unit: number;
  currency_code: string;
  cost_per_unit_usd: number;
  reorder_level: number;
  production_reorder_level: number;
  current_stock: number;
  alert_threshold_pct: number;
  days_of_cover_target: number;
  alert_channels: string[];
  warehouse_id: string | null;
  description: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  warehouses?: Warehouse;
}

export interface InventoryForecastRow {
  raw_material_id: string;
  name: string;
  code: string;
  current_stock: number;
  avg_daily_usage: number;
  days_to_depletion: number | null;
}

export interface MonthlyTrendRow {
  month: string;
  consumption_t: number;
  production_t: number;
  dispatch_t: number;
}

export interface GoodsReceivedNote {
  id: string;
  grn_number: string;
  supplier_id: string | null;
  warehouse_id: string | null;
  weigh_bridge_ticket_id?: string | null;
  received_date: string;
  weigh_bridge_ticket_no?: string | null;
  weigh_bridge_ticket_date?: string | null;
  weigh_bridge_ticket_weight?: number | null;
  weigh_bridge_ticket_unit?: string | null;
  weigh_bridge_ticket_driver_name?: string | null;
  weigh_bridge_ticket_vehicle_number?: string | null;
  weigh_bridge_ticket_gross_weight?: number | null;
  weigh_bridge_ticket_tare_weight?: number | null;
  weigh_bridge_ticket_net_weight?: number | null;
  supplier_invoice_no?: string | null;
  supplier_delivery_note_no?: string | null;
  supplier_order_no?: string | null;
  external_reference?: string | null;
  vat_mode?: 'pending_finance' | 'exclusive' | 'inclusive' | 'no_vat' | null;
  vat_tax_type_id?: number | null;
  vat_code?: string | null;
  vat_rate?: number | null;
  vat_reviewed_by?: string | null;
  vat_reviewed_at?: string | null;
  status: 'pending' | 'rm_approved' | 'approved' | 'rejected' | 'inspecting';
  notes: string;
  received_by: string | null;
  total_value: number;
  approval_step?: string | null;
  rm_approved_by?: string | null;
  rm_approved_at?: string | null;
  accountant_approved_by?: string | null;
  accountant_approved_at?: string | null;
  approved_by?: string | null;
  approved_at?: string | null;
  rejection_reason?: string | null;
  wb_transaction_no?: string | null;
  wb_vehicle_reg?: string | null;
  wb_haulier_code?: string | null;
  wb_product_code?: string | null;
  wb_comment?: string | null;
  wb_trailer_number?: string | null;
  wb_driver_name?: string | null;
  wb_driver_id?: string | null;
  wb_time_in?: string | null;
  wb_first_mass?: number | null;
  wb_time_out?: string | null;
  wb_second_mass?: number | null;
  wb_nett_mass?: number | null;
  wb_driver_signed?: boolean;
  created_at: string;
  updated_at: string;
  suppliers?: Supplier;
  warehouses?: Warehouse;
}

export interface GRNItem {
  id: string;
  grn_id: string;
  raw_material_id: string;
  ordered_qty: number;
  received_qty: number;
  unit_cost: number;
  batch_number: string;
  expiry_date: string | null;
  line_total: number;
  created_at: string;
  raw_materials?: RawMaterial;
}

export interface Formulation {
  id: string;
  name: string;
  code: string;
  sage_code: string;
  version: number;
  category: string;
  description: string;
  batch_size: number;
  batch_unit: string;
  unit_size_variants: Array<{ size: string; batch_size: number }> | null;
  target_protein: number;
  target_fat: number;
  target_fiber: number;
  target_moisture: number;
  estimated_cost_per_unit: number;
  nominal_speed: number;
  status: 'draft' | 'active' | 'archived';
  created_by: string | null;
  approved_by: string | null;
  created_at: string;
  updated_at: string;
  current_stock: number;
}

export interface FormulationIngredient {
  id: string;
  formulation_id: string;
  raw_material_id: string;
  quantity: number;
  unit: string;
  percentage: number;
  is_critical: boolean;
  notes: string;
  sort_order: number;
  created_at: string;
  raw_materials?: RawMaterial;
}

export interface ProductionPlan {
  id: string;
  plan_number: string;
  plan_date: string;
  start_date: string;
  end_date: string;
  status: 'draft' | 'confirmed' | 'in_progress' | 'completed' | 'cancelled';
  notes: string;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface ProductionPlanItem {
  id: string;
  plan_id: string;
  formulation_id: string;
  planned_qty: number;
  unit: string;
  priority: number;
  notes: string;
  created_at: string;
  formulations?: Formulation;
}

export interface ProductionOrder {
  id: string;
  batch_number: string;
  plan_id: string | null;
  formulation_id: string | null;
  machine_id: string | null;
  planned_qty: number;
  planned_bags?: number | null;
  actual_qty: number;
  actual_bags?: number | null;
  rejected_qty: number;
  rejected_bags?: number | null;
  wastage_qty: number;
  wastage_bags?: number | null;
  unit: string;
  unit_size?: string | null;
  status: 'pending' | 'materials_issued' | 'in_progress' | 'completed' | 'cancelled';
  priority: 'low' | 'normal' | 'high' | 'urgent';
  planned_start: string | null;
  planned_end: string | null;
  actual_start: string | null;
  actual_end: string | null;
  operator_id: string | null;
  supervisor_id: string | null;
  raw_material_cost: number;
  labour_cost: number;
  machine_cost: number;
  overhead_cost: number;
  total_cost: number;
  cost_per_unit: number;
  notes: string;
  approved_by?: string | null;
  approved_at?: string | null;
  rejection_reason?: string | null;
  created_at: string;
  updated_at: string;
  formulations?: Formulation;
  machines?: Machine;
  profiles?: Profile;
}

export interface ProductionOrderMaterial {
  id: string;
  production_order_id: string;
  raw_material_id: string;
  planned_qty: number;
  actual_qty: number;
  wastage_qty: number;
  unit: string;
  unit_cost: number;
  total_cost: number;
  issued: boolean;
  issued_at: string | null;
  issued_by: string | null;
  created_at: string;
  raw_materials?: RawMaterial;
}

export interface ProductionLog {
  id: string;
  production_order_id: string;
  machine_id: string | null;
  operator_id: string | null;
  log_type: 'start' | 'stop' | 'pause' | 'resume' | 'downtime' | 'issue' | 'info';
  description: string;
  started_at: string;
  ended_at: string | null;
  duration_minutes: number;
  created_at: string;
}

export interface StockMovement {
  id: string;
  movement_type: string;
  reference_type: string;
  reference_id: string | null;
  raw_material_id: string | null;
  formulation_id: string | null;
  warehouse_id: string | null;
  quantity: number;
  unit: string;
  batch_number: string;
  movement_date: string;
  performed_by: string | null;
  notes: string;
  created_at: string;
  raw_materials?: RawMaterial;
  formulations?: Formulation;
  warehouses?: Warehouse;
}

export interface DispatchOrder {
  id: string;
  dispatch_number: string;
  dispatch_type?: 'branch_transfer' | 'customer_direct';
  customer_name?: string;
  customer_code?: string;
  physical_dnote_number?: string;
  hfdn_reference?: string;
  order_number?: string;
  vat_number?: string;
  branch_id: string | null;
  warehouse_id: string | null;
  dispatch_date: string;
  status: 'pending' | 'loading' | 'dispatched' | 'in_transit' | 'delivered' | 'cancelled';
  vehicle_number: string;
  driver_name: string;
  driver_phone?: string;
  is_hired_truck?: boolean;
  transporter_name?: string;
  trailer_number?: string;
  total_weight: number;
  total_value: number;
  prepared_by: string | null;
  approved_by: string | null;
  approved_at?: string | null;
  rejection_reason?: string | null;
  delivery_notes: string;
  delivered_at: string | null;
  branch_confirmed_by?: string | null;
  branch_confirmed_at?: string | null;
  branch_confirmation_notes?: string;
  branch_confirmation_status?: 'pending' | 'confirmed' | 'rejected';
  accounts_approved_by?: string | null;
  accounts_approved_at?: string | null;
  accounts_approval_notes?: string;
  accounts_posting_status?: 'pending' | 'approved' | 'rejected';
  created_at: string;
  updated_at: string;
  branches?: Branch;
  warehouses?: Warehouse;
}

export interface DispatchItem {
  id: string;
  dispatch_order_id: string;
  formulation_id: string | null;
  batch_number: string;
  quantity: number;
  quantity_bags?: number | null;
  bag_size_kg?: number | null;
  unit: string;
  unit_price: number;
  line_total: number;
  created_at: string;
  formulations?: Formulation;
}

/* ── Fleet & Logistics Types ── */
export interface FleetVehicle {
  id: string;
  registration_number: string;
  make_model: string;
  vehicle_type: 'rigid_truck' | 'horse_trailer' | 'flatbed' | 'tipper' | 'van' | 'hired_truck';
  ownership: 'owned' | 'hired' | 'contracted';
  capacity_tons: number;
  current_odometer_km: number;
  status: 'available' | 'allocated' | 'in_transit' | 'maintenance' | 'breakdown' | 'decommissioned';
  assigned_driver_name?: string;
  driver_phone?: string;
  fuel_tank_capacity_l?: number;
  avg_fuel_consumption_kml?: number;
  service_interval_km?: number;
  last_service_odometer_km?: number;
  last_service_date?: string;
  next_service_due_km?: number;
  license_expiry_date?: string;
  insurance_expiry_date?: string;
  transporter_vendor_name?: string;
  hire_rate_per_ton?: number;
  created_at: string;
  updated_at?: string;
}

export interface FleetAllocation {
  id: string;
  allocation_number: string;
  vehicle_id: string;
  driver_name: string;
  driver_phone?: string;
  allocation_type: 'dispatch_delivery' | 'material_transfer' | 'rm_pickup' | 'customer_delivery' | 'other';
  reference_order_number?: string;
  destination: string;
  planned_tonnage: number;
  start_odometer_km: number;
  end_odometer_km?: number;
  fuel_issued_liters?: number;
  fuel_cost_usd?: number;
  dispatch_time?: string;
  expected_return_time?: string;
  actual_return_time?: string;
  status: 'allocated' | 'loading' | 'in_transit' | 'delivered' | 'returned' | 'cancelled';
  notes?: string;
  created_at: string;
  vehicles?: FleetVehicle;
}

export interface FleetMaintenanceRecord {
  id: string;
  maintenance_number: string;
  vehicle_id: string;
  service_type: 'preventative' | 'corrective' | 'tire_replacement' | 'brake_service' | 'major_overhaul' | 'inspection';
  description: string;
  work_done_by: string;
  odometer_reading_km: number;
  cost_usd: number;
  parts_replaced?: string;
  service_date: string;
  completion_date?: string;
  status: 'scheduled' | 'in_progress' | 'completed' | 'cancelled';
  notes?: string;
  created_at: string;
  vehicles?: FleetVehicle;
}

export interface FleetBreakdown {
  id: string;
  incident_number: string;
  vehicle_id: string;
  driver_name: string;
  incident_date_time: string;
  location: string;
  nature_of_breakdown: 'engine_failure' | 'tire_blowout' | 'brake_system' | 'gearbox_transmission' | 'electrical' | 'accident' | 'other';
  description: string;
  cargo_status: 'intact' | 'partially_damaged' | 'transshipped' | 'lost';
  rescue_vehicle_id?: string;
  downtime_hours?: number;
  repair_cost_usd?: number;
  status: 'reported' | 'mechanic_dispatched' | 'towed' | 'repaired_on_site' | 'resolved';
  resolved_at?: string;
  resolution_notes?: string;
  created_at: string;
  vehicles?: FleetVehicle;
  rescue_vehicle?: FleetVehicle;
}

export interface FleetHiredTruck {
  id: string;
  vendor_name: string;
  contact_person: string;
  phone: string;
  email?: string;
  truck_registration: string;
  capacity_tons: number;
  rate_per_ton_usd: number;
  rate_per_trip_usd?: number;
  active_contract: boolean;
  notes?: string;
  created_at: string;
}


