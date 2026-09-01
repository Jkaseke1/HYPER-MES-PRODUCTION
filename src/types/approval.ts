// Approval Workflow Types

export interface ApprovalHistory {
  id: string;
  entity_type: 'grn' | 'quality_inspection' | 'production_order' | 'dispatch_order' | 'work_order' | 'reconciliation_period' | 'material_transfer' | 'macropack_order' | 'chick_booking' | 'weigh_bridge_ticket';
  entity_id: string;
  action: 'submitted' | 'approved' | 'rejected' | 'cancelled' | 'reopened';
  previous_status?: string;
  new_status: string;
  approved_by?: string;
  comments?: string;
  created_at: string;
}

export interface PendingApproval {
  entity_type: 'grn' | 'quality_inspection' | 'production_order' | 'dispatch_order' | 'work_order' | 'reconciliation_period' | 'material_transfer' | 'macropack_order' | 'chick_booking' | 'weigh_bridge_ticket';
  entity_id: string;
  entity_number: string;
  entity_name: string;
  status: string;
  created_at: string;
  created_by?: string;
  branch_id?: string;
}

export interface ApprovalHistoryWithUser extends ApprovalHistory {
  approver?: {
    id: string;
    full_name: string;
    email: string;
  };
}

export const APPROVAL_PERMISSIONS = {
  grn: ['finance', 'accountant', 'admin'],  // Single approver: Finance only
  quality_inspection: ['supervisor', 'production_manager', 'admin'],
  production_order: ['production_manager', 'finance', 'accountant', 'admin'],
  dispatch_order: ['warehouse_manager', 'logistics', 'admin'],
  work_order: ['supervisor', 'admin'],
  reconciliation_period: ['production_manager', 'finance', 'admin'],
  material_transfer: ['production_manager', 'supervisor', 'logistics', 'admin'],  // Only Production/Logistics approves final acceptance
  material_transfer_step2: ['production_manager', 'supervisor', 'logistics', 'admin', 'finance'],  // Step 2: Buffer → Production
  weigh_bridge_ticket: ['warehouse_manager', 'logistics', 'procurement', 'admin'],
  macropack_order: ['procurement', 'supervisor', 'production_manager', 'admin'],
  chick_booking: ['finance', 'accountant', 'logistics', 'admin'],
} as const;

// GRN uses single-step approval: Finance approves directly (pending → approved)

// Material Transfer workflow:
// - On creation: stock auto-moves from RM Warehouse to Buffer Warehouse (status = in_buffer)
// - Final step: in_buffer → received (stock moves to Production Floor). Production/Supervisor/Admin/Finance can approve.
export const TWO_STEP_MATERIAL_TRANSFER = {
  step2: { 
    roles: ['production_manager', 'supervisor', 'admin', 'finance'], 
    fromStatus: 'in_buffer', 
    toStatus: 'received', 
    label: 'Accept to Production' 
  },
} as const;

export function canApprove(entityType: keyof typeof APPROVAL_PERMISSIONS, userRole: string): boolean {
  return APPROVAL_PERMISSIONS[entityType].includes(userRole as any);
}

export function getApprovalActionLabel(entityType: string): { approve: string; reject: string } {
  const labels: Record<string, { approve: string; reject: string }> = {
    grn: { approve: 'Approve Receipt', reject: 'Reject Receipt' },
    quality_inspection: { approve: 'Pass Inspection', reject: 'Fail Inspection' },
    production_order: { approve: 'Approve Order', reject: 'Reject Order' },
    dispatch_order: { approve: 'Approve Dispatch', reject: 'Reject Dispatch' },
    work_order: { approve: 'Approve Work', reject: 'Reject Work' },
    reconciliation_period: { approve: 'Approve Period', reject: 'Reject Period' },
    material_transfer: { approve: 'Approve Transfer', reject: 'Reject Transfer' },
    weigh_bridge_ticket: { approve: 'Link to GRN', reject: 'Cancel Ticket' },
    macropack_order: { approve: 'Approve Macropack Order', reject: 'Reject Macropack Order' },
    chick_booking: { approve: 'Approve Chick PO', reject: 'Reject Chick PO' },
  };
  return labels[entityType] || { approve: 'Approve', reject: 'Reject' };
}
