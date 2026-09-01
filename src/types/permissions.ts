export interface Permission {
  id: string;
  code: string;
  name: string;
  description: string;
  module: string;
  created_at: string;
}

export interface Role {
  id: string;
  code: string;
  name: string;
  description: string;
  is_system: boolean;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface RolePermission {
  id: string;
  role_id: string;
  permission_id: string;
  created_at: string;
  permissions?: Permission;
  roles?: Role;
}

export interface UserRole {
  id: string;
  user_id: string;
  role_id: string;
  assigned_by: string | null;
  assigned_at: string;
  roles?: Role;
  profiles?: { full_name: string; email: string };
}

export interface UserBranchAccess {
  id: string;
  user_id: string;
  branch_id: string;
  access_level: 'read' | 'write' | 'admin';
  granted_by: string | null;
  granted_at: string;
  branches?: { name: string; code: string };
}

export interface UserWithRoles {
  id: string;
  full_name: string;
  email: string;
  phone: string;
  role: string;
  created_at: string;
  user_roles: UserRole[];
  user_branch_access: UserBranchAccess[];
}

// Permission codes for type safety
export type PermissionCode =
  | 'dashboard.view'
  | 'raw_materials.view' | 'raw_materials.create' | 'raw_materials.edit' | 'raw_materials.delete'
  | 'grn.view' | 'grn.create' | 'grn.approve' | 'grn.delete'
  | 'quality.view' | 'quality.create' | 'quality.approve'
  | 'formulations.view' | 'formulations.create' | 'formulations.edit' | 'formulations.delete' | 'formulations.approve'
  | 'planning.view' | 'planning.create' | 'planning.edit' | 'planning.approve'
  | 'production.view' | 'production.create' | 'production.edit' | 'production.start' | 'production.complete' | 'production.approve'
  | 'warehouse.view' | 'warehouse.transfer' | 'warehouse.adjust'
  | 'dispatch.view' | 'dispatch.create' | 'dispatch.approve'
  | 'sales.view' | 'sales.create' | 'sales.edit' | 'sales.approve'
  | 'maintenance.view' | 'maintenance.create' | 'maintenance.edit' | 'maintenance.complete'
  | 'spare_parts.view' | 'spare_parts.create' | 'spare_parts.edit'
  | 'reports.view' | 'reports.export'
  | 'reconciliation.view' | 'reconciliation.create' | 'reconciliation.approve'
  | 'settings.view' | 'settings.edit'
  | 'admin.users' | 'admin.roles' | 'admin.permissions' | 'admin.branches' | 'admin.full';

// Module groupings for UI
export const PERMISSION_MODULES = {
  dashboard: 'Dashboard',
  raw_materials: 'Raw Materials',
  grn: 'Goods Received',
  quality: 'Quality Inspection',
  formulations: 'Formulations',
  planning: 'Production Planning',
  production: 'Production Orders',
  warehouse: 'Warehouse',
  dispatch: 'Dispatch',
  sales: 'Sales Orders',
  maintenance: 'Maintenance',
  spare_parts: 'Spare Parts',
  reports: 'Reports',
  reconciliation: 'Reconciliation',
  settings: 'Settings',
  admin: 'Administration',
} as const;
