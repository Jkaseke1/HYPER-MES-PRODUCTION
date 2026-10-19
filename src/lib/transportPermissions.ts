export function canEditGrnTransport(role: string | undefined, grnStatus: string, claimStatus?: string | null) {
  return ['admin', 'raw_material_manager', 'rm_manager', 'warehouse_manager'].includes(role || '')
    && ['pending', 'pending_costing', 'pending_finance'].includes(grnStatus)
    && (claimStatus == null || ['draft', 'rejected'].includes(claimStatus));
}
