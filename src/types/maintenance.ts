// Plant Maintenance Module Types

export interface SparePart {
  id: string;
  code: string;
  name: string;
  description?: string;
  category: 'mechanical' | 'electrical' | 'consumable' | 'lubricant' | 'safety' | 'other';
  unit: string;
  unit_cost: number;
  currency_code: string;
  reorder_level: number;
  current_stock: number;
  warehouse_id?: string;
  supplier_id?: string;
  lead_time_days: number;
  is_critical: boolean;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface MaintenanceSchedule {
  id: string;
  schedule_code: string;
  machine_id: string;
  title: string;
  description?: string;
  maintenance_type: 'preventive' | 'inspection' | 'calibration' | 'lubrication' | 'cleaning';
  frequency_type: 'daily' | 'weekly' | 'monthly' | 'quarterly' | 'yearly' | 'hours_based' | 'cycles_based';
  frequency_value: number;
  estimated_duration_minutes: number;
  last_performed_date?: string;
  next_due_date?: string;
  assigned_to?: string;
  priority: 'low' | 'medium' | 'high' | 'critical';
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface MaintenanceWorkOrder {
  id: string;
  wo_number: string;
  schedule_id?: string;
  machine_id: string;
  branch_id?: string;
  work_type: 'preventive' | 'corrective' | 'breakdown' | 'inspection' | 'calibration' | 'modification';
  priority: 'low' | 'medium' | 'high' | 'critical';
  status: 'open' | 'assigned' | 'in_progress' | 'on_hold' | 'completed' | 'cancelled';
  title: string;
  description?: string;
  reported_by?: string;
  assigned_to?: string;
  scheduled_date?: string;
  started_at?: string;
  completed_at?: string;
  estimated_duration_minutes?: number;
  actual_duration_minutes?: number;
  downtime_minutes: number;
  production_impact_qty: number;
  root_cause?: string;
  corrective_action?: string;
  labor_cost: number;
  parts_cost: number;
  total_cost: number;
  notes?: string;
  created_at: string;
  updated_at: string;
}

export interface MaintenanceTask {
  id: string;
  work_order_id: string;
  task_number: number;
  description: string;
  is_completed: boolean;
  completed_by?: string;
  completed_at?: string;
  notes?: string;
  created_at: string;
}

export interface SparePartUsage {
  id: string;
  work_order_id: string;
  spare_part_id: string;
  quantity_used: number;
  unit_cost: number;
  line_total: number;
  batch_number?: string;
  notes?: string;
  created_at: string;
}

export interface EquipmentDowntimeLog {
  id: string;
  machine_id: string;
  work_order_id?: string;
  downtime_type: 'planned' | 'unplanned' | 'breakdown' | 'changeover' | 'waiting_parts' | 'waiting_technician';
  started_at: string;
  ended_at?: string;
  duration_minutes?: number;
  production_order_id?: string;
  planned_output_qty: number;
  actual_output_qty: number;
  output_loss_qty: number;
  description?: string;
  reported_by?: string;
  created_at: string;
  updated_at: string;
}

// Extended types with joined data for UI display
export interface MaintenanceWorkOrderWithDetails extends MaintenanceWorkOrder {
  machine?: {
    id: string;
    name: string;
    code: string;
  };
  branch?: {
    id: string;
    name: string;
    code: string;
  };
  assigned_user?: {
    id: string;
    full_name: string;
    email: string;
  };
  reported_user?: {
    id: string;
    full_name: string;
    email: string;
  };
}

export interface MaintenanceScheduleWithDetails extends MaintenanceSchedule {
  machine?: {
    id: string;
    name: string;
    code: string;
  };
  assigned_user?: {
    id: string;
    full_name: string;
    email: string;
  };
}

export interface SparePartUsageWithDetails extends SparePartUsage {
  spare_part?: {
    id: string;
    name: string;
    code: string;
    unit: string;
  };
}

export const SPARE_PART_CATEGORIES = [
  { value: 'mechanical', label: 'Mechanical' },
  { value: 'electrical', label: 'Electrical' },
  { value: 'consumable', label: 'Consumable' },
  { value: 'lubricant', label: 'Lubricant' },
  { value: 'safety', label: 'Safety' },
  { value: 'other', label: 'Other' }
] as const;

export const MAINTENANCE_TYPES = [
  { value: 'preventive', label: 'Preventive' },
  { value: 'inspection', label: 'Inspection' },
  { value: 'calibration', label: 'Calibration' },
  { value: 'lubrication', label: 'Lubrication' },
  { value: 'cleaning', label: 'Cleaning' }
] as const;

export const WORK_ORDER_TYPES = [
  { value: 'preventive', label: 'Preventive' },
  { value: 'corrective', label: 'Corrective' },
  { value: 'breakdown', label: 'Breakdown' },
  { value: 'inspection', label: 'Inspection' },
  { value: 'calibration', label: 'Calibration' },
  { value: 'modification', label: 'Modification' }
] as const;

export const WORK_ORDER_STATUSES = [
  { value: 'open', label: 'Open', color: 'bg-gray-100 text-gray-800' },
  { value: 'assigned', label: 'Assigned', color: 'bg-blue-100 text-blue-800' },
  { value: 'in_progress', label: 'In Progress', color: 'bg-yellow-100 text-yellow-800' },
  { value: 'on_hold', label: 'On Hold', color: 'bg-orange-100 text-orange-800' },
  { value: 'completed', label: 'Completed', color: 'bg-green-100 text-green-800' },
  { value: 'cancelled', label: 'Cancelled', color: 'bg-red-100 text-red-800' }
] as const;

export const PRIORITY_LEVELS = [
  { value: 'low', label: 'Low', color: 'bg-gray-100 text-gray-800' },
  { value: 'medium', label: 'Medium', color: 'bg-blue-100 text-blue-800' },
  { value: 'high', label: 'High', color: 'bg-orange-100 text-orange-800' },
  { value: 'critical', label: 'Critical', color: 'bg-red-100 text-red-800' }
] as const;

export const FREQUENCY_TYPES = [
  { value: 'daily', label: 'Daily' },
  { value: 'weekly', label: 'Weekly' },
  { value: 'monthly', label: 'Monthly' },
  { value: 'quarterly', label: 'Quarterly' },
  { value: 'yearly', label: 'Yearly' },
  { value: 'hours_based', label: 'Hours Based' },
  { value: 'cycles_based', label: 'Cycles Based' }
] as const;

export const DOWNTIME_TYPES = [
  { value: 'planned', label: 'Planned' },
  { value: 'unplanned', label: 'Unplanned' },
  { value: 'breakdown', label: 'Breakdown' },
  { value: 'changeover', label: 'Changeover' },
  { value: 'waiting_parts', label: 'Waiting Parts' },
  { value: 'waiting_technician', label: 'Waiting Technician' }
] as const;
