type Role = { id: string; code: string; name: string; is_active: boolean };

export function roleIdsIncludingPrimary(primary: string, selectedIds: string[], roles: Role[]) {
  const role = roles.find(item => item.code === primary && item.is_active);
  if (!role) throw new Error('The primary role is missing or inactive. Reload the role list before saving.');
  return [...new Set([...selectedIds, role.id])];
}

export function userRoleLabels(primary: string, assigned: { roles?: { code: string; name: string } | null }[], roles: Role[]) {
  const labels = new Map<string, { code: string; name: string; source: string }>();
  if (primary) labels.set(primary, { code: primary, name: roles.find(role => role.code === primary)?.name || primary, source: 'Primary profile role' });
  for (const entry of assigned) {
    if (entry.roles && !labels.has(entry.roles.code)) {
      labels.set(entry.roles.code, { ...entry.roles, source: 'Additional assigned role' });
    }
  }
  return [...labels.values()];
}

export function userAccessSaveError(error: { message?: string; code?: string }) {
  if (error.code === '23505' && error.message?.includes('uq_profiles_sage_agent_name')) {
    return 'That Sage agent name is already linked to another user. No profile, role or branch changes were saved.';
  }
  return error.message || 'User changes were not confirmed. Reload and check the account before trying again.';
}
