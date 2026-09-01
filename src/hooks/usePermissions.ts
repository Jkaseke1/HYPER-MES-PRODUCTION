import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import type { PermissionCode } from '../types/permissions';

interface UserPermissions {
  permissions: Set<string>;
  roles: string[];
  loading: boolean;
}

export function usePermissions() {
  const { user, profile } = useAuth();
  const [state, setState] = useState<UserPermissions>({
    permissions: new Set(),
    roles: [],
    loading: true,
  });

  useEffect(() => {
    if (!user) {
      setState({ permissions: new Set(), roles: [], loading: false });
      return;
    }

    async function loadPermissions() {
      if (!user) return;
      try {
        // Get user roles
        const { data: userRoles } = await supabase
          .from('user_roles')
          .select('roles(code, name)')
          .eq('user_id', user.id);

        const roles = userRoles?.map((ur: any) => ur.roles?.code).filter(Boolean) || [];

        // If user has no roles assigned, check profile.role and assign default
        if (roles.length === 0 && profile?.role) {
          // Fallback to legacy role system
          const legacyPermissions = getLegacyPermissions(profile.role);
          setState({
            permissions: new Set(legacyPermissions),
            roles: [profile.role],
            loading: false,
          });
          return;
        }

        // Get permissions for user's roles
        const { data: permissions } = await supabase
          .from('user_roles')
          .select(`
            roles!inner(
              role_permissions(
                permissions(code)
              )
            )
          `)
          .eq('user_id', user.id);

        const permSet = new Set<string>();
        permissions?.forEach((ur: any) => {
          ur.roles?.role_permissions?.forEach((rp: any) => {
            if (rp.permissions?.code) {
              permSet.add(rp.permissions.code);
            }
          });
        });

        setState({
          permissions: permSet,
          roles,
          loading: false,
        });
      } catch (error) {
        console.error('Error loading permissions:', error);
        // Fallback to legacy role
        if (profile?.role) {
          const legacyPermissions = getLegacyPermissions(profile.role);
          setState({
            permissions: new Set(legacyPermissions),
            roles: [profile.role],
            loading: false,
          });
        } else {
          setState({ permissions: new Set(), roles: [], loading: false });
        }
      }
    }

    loadPermissions();
  }, [user, profile]);

  const hasPermission = useCallback(
    (permission: PermissionCode | PermissionCode[]): boolean => {
      if (state.loading) return false;
      
      // Admin has all permissions
      if (state.roles.includes('admin') || state.permissions.has('admin.full')) {
        return true;
      }

      if (Array.isArray(permission)) {
        return permission.some((p) => state.permissions.has(p));
      }
      return state.permissions.has(permission);
    },
    [state]
  );

  const hasRole = useCallback(
    (role: string | string[]): boolean => {
      if (state.loading) return false;
      if (Array.isArray(role)) {
        return role.some((r) => state.roles.includes(r));
      }
      return state.roles.includes(role);
    },
    [state]
  );

  const hasAnyPermission = useCallback(
    (permissions: PermissionCode[]): boolean => {
      return permissions.some((p) => hasPermission(p));
    },
    [hasPermission]
  );

  const hasAllPermissions = useCallback(
    (permissions: PermissionCode[]): boolean => {
      return permissions.every((p) => hasPermission(p));
    },
    [hasPermission]
  );

  const isAdmin = useCallback((): boolean => {
    return hasRole('admin') || hasPermission('admin.full');
  }, [hasRole, hasPermission]);

  return {
    ...state,
    hasPermission,
    hasRole,
    hasAnyPermission,
    hasAllPermissions,
    isAdmin,
  };
}

// Legacy permission mapping for backward compatibility
function getLegacyPermissions(role: string): string[] {
  const basePermissions = ['dashboard.view'];
  
  switch (role) {
    case 'admin':
      return ['admin.full']; // Admin gets everything

    case 'md':
      return [
        ...basePermissions,
        'raw_materials.view',
        'formulations.view',
        'planning.view',
        'production.view',
        'warehouse.view',
        'dispatch.view',
        'sales.view',
        'reports.view', 'reports.export',
        'reconciliation.view',
        'quality.view',
        'maintenance.view',
        'payroll.view',
        'chick.view',
        'settings.view',
      ];
    
    case 'production_manager':
      return [
        ...basePermissions,
        'raw_materials.view',
        'formulations.view', 'formulations.create', 'formulations.edit',
        'planning.view', 'planning.create', 'planning.edit', 'planning.approve',
        'production.view', 'production.create', 'production.edit', 'production.start', 'production.complete', 'production.approve',
        'warehouse.view',
        'reports.view', 'reports.export',
        'settings.view',
      ];
    
    case 'warehouse_manager':
      return [
        ...basePermissions,
        'raw_materials.view', 'raw_materials.create', 'raw_materials.edit',
        'grn.view', 'grn.create', 'grn.approve',
        'warehouse.view', 'warehouse.transfer', 'warehouse.adjust',
        'dispatch.view', 'dispatch.create', 'dispatch.approve',
        'spare_parts.view', 'spare_parts.create', 'spare_parts.edit',
        'reports.view',
        'settings.view',
      ];
    
    case 'supervisor':
      return [
        ...basePermissions,
        'raw_materials.view',
        'grn.view', 'grn.create',
        'quality.view', 'quality.create',
        'formulations.view',
        'production.view', 'production.create', 'production.start', 'production.complete',
        'warehouse.view',
        'dispatch.view',
        'maintenance.view', 'maintenance.create',
        'reports.view',
      ];
    
    case 'operator':
      return [
        ...basePermissions,
        'raw_materials.view',
        'formulations.view',
        'production.view', 'production.start', 'production.complete',
        'warehouse.view',
        'maintenance.view',
      ];
    
    case 'finance':
      return [
        ...basePermissions,
        'raw_materials.view',
        'grn.view',
        'production.view',
        'dispatch.view',
        'sales.view',
        'reports.view', 'reports.export',
        'reconciliation.view', 'reconciliation.create',
      ];
    
    case 'logistics':
      return [
        ...basePermissions,
        'dispatch.view', 'dispatch.create', 'dispatch.approve',
        'warehouse.view', 'warehouse.transfer',
        'grn.view', 'grn.create',
        'raw_materials.view',
        'chick.view',
        'reports.view', 'reports.export',
      ];
    
    default:
      return basePermissions;
  }
}
