-- =====================================================
-- HYPER MES - Role-Based Access Control (RBAC) System
-- =====================================================

-- 1. Create permissions table
CREATE TABLE IF NOT EXISTS permissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  module TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- 2. Create roles table (extends the basic role in profiles)
CREATE TABLE IF NOT EXISTS roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  is_system BOOLEAN DEFAULT false,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- 3. Create role_permissions junction table
CREATE TABLE IF NOT EXISTS role_permissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  role_id UUID NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  permission_id UUID NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(role_id, permission_id)
);

-- 4. Create user_roles table (users can have multiple roles)
CREATE TABLE IF NOT EXISTS user_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  role_id UUID NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  assigned_by UUID REFERENCES profiles(id),
  assigned_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(user_id, role_id)
);

-- 5. Add branch access for users (which branches can they access)
CREATE TABLE IF NOT EXISTS user_branch_access (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  branch_id UUID NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
  access_level TEXT DEFAULT 'read' CHECK (access_level IN ('read', 'write', 'admin')),
  granted_by UUID REFERENCES profiles(id),
  granted_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(user_id, branch_id)
);

-- 6. Insert default permissions
INSERT INTO permissions (code, name, description, module) VALUES
  -- Dashboard
  ('dashboard.view', 'View Dashboard', 'Access to main dashboard', 'dashboard'),
  
  -- Raw Materials
  ('raw_materials.view', 'View Raw Materials', 'View raw materials list', 'raw_materials'),
  ('raw_materials.create', 'Create Raw Materials', 'Add new raw materials', 'raw_materials'),
  ('raw_materials.edit', 'Edit Raw Materials', 'Modify raw materials', 'raw_materials'),
  ('raw_materials.delete', 'Delete Raw Materials', 'Remove raw materials', 'raw_materials'),
  
  -- GRN
  ('grn.view', 'View GRN', 'View goods received notes', 'grn'),
  ('grn.create', 'Create GRN', 'Create new GRN', 'grn'),
  ('grn.approve', 'Approve GRN', 'Approve/reject GRN', 'grn'),
  ('grn.delete', 'Delete GRN', 'Delete GRN', 'grn'),
  
  -- Quality
  ('quality.view', 'View Quality Inspections', 'View quality records', 'quality'),
  ('quality.create', 'Create Inspections', 'Create quality inspections', 'quality'),
  ('quality.approve', 'Approve Inspections', 'Approve quality results', 'quality'),
  
  -- Formulations
  ('formulations.view', 'View Formulations', 'View formulations/BOM', 'formulations'),
  ('formulations.create', 'Create Formulations', 'Create new formulations', 'formulations'),
  ('formulations.edit', 'Edit Formulations', 'Modify formulations', 'formulations'),
  ('formulations.delete', 'Delete Formulations', 'Remove formulations', 'formulations'),
  ('formulations.approve', 'Approve Formulations', 'Approve formulations', 'formulations'),
  
  -- Production Planning
  ('planning.view', 'View Production Plans', 'View production plans', 'planning'),
  ('planning.create', 'Create Plans', 'Create production plans', 'planning'),
  ('planning.edit', 'Edit Plans', 'Modify production plans', 'planning'),
  ('planning.approve', 'Approve Plans', 'Approve production plans', 'planning'),
  
  -- Production Orders
  ('production.view', 'View Production Orders', 'View production orders', 'production'),
  ('production.create', 'Create Orders', 'Create production orders', 'production'),
  ('production.edit', 'Edit Orders', 'Modify production orders', 'production'),
  ('production.start', 'Start Production', 'Start production runs', 'production'),
  ('production.complete', 'Complete Production', 'Complete production orders', 'production'),
  ('production.approve', 'Approve Orders', 'Approve production orders', 'production'),
  
  -- Warehouse
  ('warehouse.view', 'View Warehouse', 'View warehouse stock', 'warehouse'),
  ('warehouse.transfer', 'Transfer Stock', 'Transfer stock between warehouses', 'warehouse'),
  ('warehouse.adjust', 'Adjust Stock', 'Make stock adjustments', 'warehouse'),
  
  -- Dispatch
  ('dispatch.view', 'View Dispatches', 'View dispatch orders', 'dispatch'),
  ('dispatch.create', 'Create Dispatch', 'Create dispatch orders', 'dispatch'),
  ('dispatch.approve', 'Approve Dispatch', 'Approve dispatch orders', 'dispatch'),
  
  -- Sales Orders
  ('sales.view', 'View Sales Orders', 'View sales orders', 'sales'),
  ('sales.create', 'Create Sales Orders', 'Create sales orders', 'sales'),
  ('sales.edit', 'Edit Sales Orders', 'Modify sales orders', 'sales'),
  ('sales.approve', 'Approve Sales Orders', 'Approve sales orders', 'sales'),
  
  -- Maintenance
  ('maintenance.view', 'View Maintenance', 'View work orders and schedules', 'maintenance'),
  ('maintenance.create', 'Create Work Orders', 'Create maintenance work orders', 'maintenance'),
  ('maintenance.edit', 'Edit Work Orders', 'Modify work orders', 'maintenance'),
  ('maintenance.complete', 'Complete Work Orders', 'Complete maintenance tasks', 'maintenance'),
  
  -- Spare Parts
  ('spare_parts.view', 'View Spare Parts', 'View spare parts inventory', 'spare_parts'),
  ('spare_parts.create', 'Create Spare Parts', 'Add spare parts', 'spare_parts'),
  ('spare_parts.edit', 'Edit Spare Parts', 'Modify spare parts', 'spare_parts'),
  
  -- Reports
  ('reports.view', 'View Reports', 'Access reports module', 'reports'),
  ('reports.export', 'Export Reports', 'Export report data', 'reports'),
  
  -- Reconciliation
  ('reconciliation.view', 'View Reconciliation', 'View reconciliation data', 'reconciliation'),
  ('reconciliation.create', 'Create Reconciliation', 'Create reconciliation periods', 'reconciliation'),
  ('reconciliation.approve', 'Approve Reconciliation', 'Approve reconciliation', 'reconciliation'),
  
  -- Settings & Admin
  ('settings.view', 'View Settings', 'Access settings page', 'settings'),
  ('settings.edit', 'Edit Settings', 'Modify system settings', 'settings'),
  ('admin.users', 'Manage Users', 'Create and manage users', 'admin'),
  ('admin.roles', 'Manage Roles', 'Create and manage roles', 'admin'),
  ('admin.permissions', 'Manage Permissions', 'Assign permissions to roles', 'admin'),
  ('admin.branches', 'Manage Branches', 'Manage branch access', 'admin'),
  ('admin.full', 'Full Admin Access', 'Complete system administration', 'admin')
ON CONFLICT (code) DO NOTHING;

-- 7. Insert default roles
INSERT INTO roles (code, name, description, is_system) VALUES
  ('admin', 'Administrator', 'Full system access with all permissions', true),
  ('production_manager', 'Production Manager', 'Manages production operations', true),
  ('warehouse_manager', 'Warehouse Manager', 'Manages warehouse and inventory', true),
  ('supervisor', 'Supervisor', 'Supervises daily operations', true),
  ('operator', 'Operator', 'Production floor operator', true),
  ('finance', 'Finance', 'Finance and costing access', true),
  ('quality_controller', 'Quality Controller', 'Quality inspection and approval', true),
  ('maintenance_tech', 'Maintenance Technician', 'Maintenance operations', true),
  ('viewer', 'Viewer', 'Read-only access to all modules', true)
ON CONFLICT (code) DO NOTHING;

-- 8. Assign all permissions to admin role
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p WHERE r.code = 'admin'
ON CONFLICT DO NOTHING;

-- 9. Assign permissions to production_manager
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p 
WHERE r.code = 'production_manager' 
AND p.code IN (
  'dashboard.view', 
  'raw_materials.view', 
  'formulations.view', 'formulations.create', 'formulations.edit',
  'planning.view', 'planning.create', 'planning.edit', 'planning.approve',
  'production.view', 'production.create', 'production.edit', 'production.start', 'production.complete', 'production.approve',
  'warehouse.view',
  'reports.view', 'reports.export',
  'settings.view'
)
ON CONFLICT DO NOTHING;

-- 10. Assign permissions to warehouse_manager
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p 
WHERE r.code = 'warehouse_manager' 
AND p.code IN (
  'dashboard.view',
  'raw_materials.view', 'raw_materials.create', 'raw_materials.edit',
  'grn.view', 'grn.create', 'grn.approve',
  'warehouse.view', 'warehouse.transfer', 'warehouse.adjust',
  'dispatch.view', 'dispatch.create', 'dispatch.approve',
  'spare_parts.view', 'spare_parts.create', 'spare_parts.edit',
  'reports.view',
  'settings.view'
)
ON CONFLICT DO NOTHING;

-- 11. Assign permissions to supervisor
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p 
WHERE r.code = 'supervisor' 
AND p.code IN (
  'dashboard.view',
  'raw_materials.view',
  'grn.view', 'grn.create',
  'quality.view', 'quality.create',
  'formulations.view',
  'production.view', 'production.create', 'production.start', 'production.complete',
  'warehouse.view',
  'dispatch.view',
  'maintenance.view', 'maintenance.create',
  'reports.view'
)
ON CONFLICT DO NOTHING;

-- 12. Assign permissions to operator
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p 
WHERE r.code = 'operator' 
AND p.code IN (
  'dashboard.view',
  'raw_materials.view',
  'formulations.view',
  'production.view', 'production.start', 'production.complete',
  'warehouse.view',
  'maintenance.view'
)
ON CONFLICT DO NOTHING;

-- 13. Assign permissions to quality_controller
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p 
WHERE r.code = 'quality_controller' 
AND p.code IN (
  'dashboard.view',
  'raw_materials.view',
  'grn.view',
  'quality.view', 'quality.create', 'quality.approve',
  'formulations.view',
  'production.view',
  'reports.view'
)
ON CONFLICT DO NOTHING;

-- 14. Assign permissions to maintenance_tech
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p 
WHERE r.code = 'maintenance_tech' 
AND p.code IN (
  'dashboard.view',
  'maintenance.view', 'maintenance.create', 'maintenance.edit', 'maintenance.complete',
  'spare_parts.view', 'spare_parts.create', 'spare_parts.edit'
)
ON CONFLICT DO NOTHING;

-- 15. Assign permissions to viewer
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p 
WHERE r.code = 'viewer' 
AND p.code LIKE '%.view'
ON CONFLICT DO NOTHING;

-- 16. Create function to check user permission
CREATE OR REPLACE FUNCTION check_user_permission(p_user_id UUID, p_permission_code TEXT)
RETURNS BOOLEAN AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 
    FROM user_roles ur
    JOIN role_permissions rp ON rp.role_id = ur.role_id
    JOIN permissions p ON p.id = rp.permission_id
    WHERE ur.user_id = p_user_id AND p.code = p_permission_code
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 17. Create function to get user permissions
CREATE OR REPLACE FUNCTION get_user_permissions(p_user_id UUID)
RETURNS TABLE(permission_code TEXT, permission_name TEXT, module TEXT) AS $$
BEGIN
  RETURN QUERY
  SELECT DISTINCT p.code, p.name, p.module
  FROM user_roles ur
  JOIN role_permissions rp ON rp.role_id = ur.role_id
  JOIN permissions p ON p.id = rp.permission_id
  WHERE ur.user_id = p_user_id
  ORDER BY p.module, p.code;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 18. Create function to get user roles
CREATE OR REPLACE FUNCTION get_user_roles(p_user_id UUID)
RETURNS TABLE(role_code TEXT, role_name TEXT) AS $$
BEGIN
  RETURN QUERY
  SELECT r.code, r.name
  FROM user_roles ur
  JOIN roles r ON r.id = ur.role_id
  WHERE ur.user_id = p_user_id AND r.is_active = true
  ORDER BY r.name;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 19. Enable RLS
ALTER TABLE permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE role_permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_branch_access ENABLE ROW LEVEL SECURITY;

-- 20. RLS Policies - Allow authenticated users to read
CREATE POLICY "Allow read permissions" ON permissions FOR SELECT TO authenticated USING (true);
CREATE POLICY "Allow read roles" ON roles FOR SELECT TO authenticated USING (true);
CREATE POLICY "Allow read role_permissions" ON role_permissions FOR SELECT TO authenticated USING (true);
CREATE POLICY "Allow read user_roles" ON user_roles FOR SELECT TO authenticated USING (true);
CREATE POLICY "Allow read user_branch_access" ON user_branch_access FOR SELECT TO authenticated USING (true);

-- 21. RLS Policies - Only admins can modify
CREATE POLICY "Admin manage permissions" ON permissions FOR ALL TO authenticated 
  USING (check_user_permission(auth.uid(), 'admin.permissions'));
CREATE POLICY "Admin manage roles" ON roles FOR ALL TO authenticated 
  USING (check_user_permission(auth.uid(), 'admin.roles'));
CREATE POLICY "Admin manage role_permissions" ON role_permissions FOR ALL TO authenticated 
  USING (check_user_permission(auth.uid(), 'admin.permissions'));
CREATE POLICY "Admin manage user_roles" ON user_roles FOR ALL TO authenticated 
  USING (check_user_permission(auth.uid(), 'admin.users'));
CREATE POLICY "Admin manage user_branch_access" ON user_branch_access FOR ALL TO authenticated 
  USING (check_user_permission(auth.uid(), 'admin.branches'));

-- 22. Create indexes
CREATE INDEX IF NOT EXISTS idx_role_permissions_role ON role_permissions(role_id);
CREATE INDEX IF NOT EXISTS idx_role_permissions_permission ON role_permissions(permission_id);
CREATE INDEX IF NOT EXISTS idx_user_roles_user ON user_roles(user_id);
CREATE INDEX IF NOT EXISTS idx_user_roles_role ON user_roles(role_id);
CREATE INDEX IF NOT EXISTS idx_user_branch_access_user ON user_branch_access(user_id);
CREATE INDEX IF NOT EXISTS idx_user_branch_access_branch ON user_branch_access(branch_id);
