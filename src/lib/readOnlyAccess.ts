export const MD_READ_ONLY_MESSAGE = 'Managing Director access is read-only. Changes and approvals are not permitted.';

export function isReadOnlyRole(role: string | null | undefined): boolean {
  return role === 'md';
}

export function isReadOnlyPermission(permission: string): boolean {
  return permission.endsWith('.view') || permission === 'reports.export';
}

// Defence in depth only. Database guards must enforce this independently.
export function mdRequestAllowed(path: string, method: string): boolean {
  const verb = method.toUpperCase();
  if (path.startsWith('/auth/v1/') && !path.includes('/admin/')) return true;
  if (path.startsWith('/rest/v1/rpc/')) {
    return ['grn_input_allowed', 'list_inbound_transporters_for_weighbridge'].includes(path.split('/').pop() || '');
  }
  if (path === '/rest/v1/user_access_logs' && verb === 'POST') return true;
  if (path.startsWith('/storage/v1/object/sign/') || path.startsWith('/storage/v1/object/list/')) {
    return verb === 'POST' || verb === 'GET' || verb === 'HEAD';
  }
  if (path.startsWith('/functions/v1/')) return false;
  return verb === 'GET' || verb === 'HEAD' || verb === 'OPTIONS';
}
