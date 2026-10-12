import { canAccessPath, type MesRole } from './roleAccess';

export interface DashboardModule {
  path: string;
  label: string;
  table: string;
  statuses?: string[];
  pending?: string[];
}

const modules: DashboardModule[] = [
  { path: '/weigh-bridge', label: 'Weighbridge tickets', table: 'weigh_bridge_tickets' },
  { path: '/goods-received', label: 'Goods received', table: 'goods_received_notes' },
  { path: '/warehouse', label: 'Raw materials', table: 'raw_materials' },
  { path: '/material-transfer', label: 'Material transfers', table: 'material_transfers', pending: ['pending', 'approved', 'in_transit'] },
  { path: '/formulations', label: 'Formulas', table: 'formulations', pending: ['draft'] },
  { path: '/production-orders', label: 'Production orders', table: 'production_orders', pending: ['pending', 'materials_issued', 'in_progress'] },
  { path: '/production-warehouse', label: 'Incoming production transfers', table: 'material_transfers', statuses: ['in_buffer', 'received'], pending: ['in_buffer'] },
  { path: '/dispatch', label: 'Dispatch orders', table: 'dispatch_orders', pending: ['pending', 'loading'] },
  { path: '/maintenance-procurement', label: 'Maintenance requests', table: 'maintenance_procurement_requests', pending: ['submitted', 'quoting', 'pending_approval'] },
  { path: '/maintenance-work-orders', label: 'Maintenance work orders', table: 'maintenance_work_orders' },
];

export function dashboardModulesForRole(role: MesRole): DashboardModule[] {
  return modules.filter(module => canAccessPath(role, module.path));
}
