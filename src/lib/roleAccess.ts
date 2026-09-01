export type MesRole = string | null | undefined;

const fullAccessRoles = new Set(['admin', 'md']);

const rolePaths: Record<string, string[]> = {
  weighbridge: ['/weigh-bridge'],
  weigh_bridge: ['/weigh-bridge'],
  raw_material_manager: ['/goods-received', '/quality-inspection', '/warehouse', '/stock-take', '/material-transfer', '/rm-stock-dashboard', '/rm-receipts-matrix', '/rm-issues-matrix', '/rm-history', '/rm-prices'],
  warehouse_manager: ['/goods-received', '/quality-inspection', '/warehouse', '/stock-take', '/material-transfer', '/rm-stock-dashboard', '/rm-receipts-matrix', '/rm-issues-matrix', '/rm-history', '/rm-prices'],
  production_manager: ['/formulations', '/production-planning', '/production-orders', '/production-control', '/production-warehouse', '/macropack', '/finished-goods', '/shift-reports', '/daily-production-report', '/production-efficiency', '/production-report', '/reports/process-loss', '/reports/macropack-reconciliation'],
  supervisor: ['/formulations', '/production-planning', '/production-orders', '/production-control', '/production-warehouse', '/macropack', '/finished-goods', '/shift-reports', '/daily-production-report', '/production-efficiency', '/production-report', '/reports/process-loss', '/reports/macropack-reconciliation'],
  operator: ['/formulations', '/production-planning', '/production-orders', '/production-control', '/production-warehouse', '/macropack', '/finished-goods', '/shift-reports', '/daily-production-report', '/production-efficiency', '/production-report', '/reports/process-loss', '/reports/macropack-reconciliation'],
  logistics: ['/dispatch', '/dispatch-planning', '/fleet'],
  finance: ['/goods-received', '/stock-take', '/formulations', '/production-orders', '/production-control', '/production-warehouse', '/finished-goods', '/reports/gross-margin', '/production-report', '/daily-production-report', '/reports/process-loss', '/reports/macropack-reconciliation', '/reports/rm-reconciliation', '/reconciliation'],
  accountant: ['/goods-received', '/stock-take', '/formulations', '/production-orders', '/production-control', '/production-warehouse', '/finished-goods', '/reports/gross-margin', '/production-report', '/daily-production-report', '/reports/process-loss', '/reports/macropack-reconciliation', '/reports/rm-reconciliation', '/reconciliation'],
};

const roleLandingPaths: Record<string, string> = {
  weighbridge: '/weigh-bridge', weigh_bridge: '/weigh-bridge', raw_material_manager: '/warehouse', warehouse_manager: '/warehouse', production_manager: '/production-orders', supervisor: '/production-orders', operator: '/production-orders', logistics: '/dispatch', finance: '/goods-received', accountant: '/goods-received',
};

export function isFullAccessRole(role: MesRole): boolean {
  return fullAccessRoles.has(role ?? '');
}

export function defaultPathForRole(role: MesRole): string {
  return roleLandingPaths[role ?? ''] ?? '/';
}

export function canAccessPath(role: MesRole, path: string): boolean {
  if (isFullAccessRole(role)) return true;
  const cleanPath = path.split('?')[0];
  const allowedPaths = rolePaths[role ?? ''];

  // Unknown legacy roles retain the dashboard until their role is assigned.
  if (!allowedPaths) return cleanPath === '/';

  return allowedPaths.some((allowedPath) => cleanPath === allowedPath || cleanPath.startsWith(`${allowedPath}/`));
}
