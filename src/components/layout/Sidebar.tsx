import { NavLink, useLocation } from 'react-router-dom';
import { useMemo, useState } from 'react';
import {
  LayoutDashboard,
  Package as PackageIcon,
  PackageCheck,
  ClipboardCheck,
  Beaker,
  ClipboardList,
  Factory,
  Warehouse as WarehouseIcon,
  Truck,
  FileCheck,
  BarChart3 as BarChart3Icon,
  Settings,
  LogOut,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  Wrench,
  AlertTriangle,
  PackagePlus,
  ClipboardType,
  ArrowRightLeft,
  Shield,
  Users,
  Activity,
  FileText,
  Package as PackageIcon2,
  DollarSign,
  BarChart3 as BarChart3Icon2,
  TrendingUp,
  Scale,
  Boxes,
  Clock,
  History,
  Search,
  Calendar,
  Gauge,
  Waypoints,
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { canAccessPath, isFullAccessRole } from '../../lib/roleAccess';

interface NavItem {
  to: string;
  icon: any;
  label: string;
}

interface NavGroup {
  label: string;
  icon: any;
  items: NavItem[];
}

const navGroups: NavGroup[] = [
  {
    label: 'Inventory',
    icon: PackageIcon,
    items: [
      // Inbound workflow
      { to: '/weigh-bridge', icon: Scale, label: 'Weigh Bridge' },
      { to: '/goods-received', icon: PackageCheck, label: 'Goods Received (GRN)' },
      { to: '/sage-posting-review', icon: ClipboardCheck, label: 'Sage Posting Review' },
      { to: '/quality-inspection', icon: ClipboardCheck, label: 'Quality Inspection' },
      { to: '/warehouse', icon: PackageIcon2, label: 'RM Warehouse' },
      { to: '/stock-take', icon: ClipboardList, label: 'Stock Take' },
      { to: '/material-transfer', icon: ArrowRightLeft, label: 'Material Transfer' },
      // Analytics
      { to: '/rm-stock-dashboard', icon: LayoutDashboard, label: 'Stock Dashboard (DRS)' },
      { to: '/rm-receipts-matrix', icon: PackageCheck, label: 'Monthly Receipts' },
      { to: '/rm-issues-matrix', icon: ArrowRightLeft, label: 'Monthly Issues' },
      { to: '/rm-history', icon: History, label: 'Historical Snapshots' },
      { to: '/rm-prices', icon: DollarSign, label: 'RM Prices' },
    ],
  },
  {
    label: 'Production',
    icon: Factory,
    items: [
      // Planning
      { to: '/formulations', icon: Beaker, label: 'Formulations (BOM)' },
      { to: '/production-planning', icon: ClipboardList, label: 'Production Planning' },
      // Execution
      { to: '/production-orders', icon: Factory, label: 'Production Orders' },
      { to: '/production-control', icon: ClipboardCheck, label: 'Production Control Centre' },
      { to: '/production-warehouse', icon: ArrowRightLeft, label: 'Incoming Materials' },
      { to: '/macropack', icon: Beaker, label: 'Macropack Manufacturing' },
      { to: '/production-warehouse', icon: Boxes, label: 'Production Warehouse' },
      { to: '/finished-goods', icon: Boxes, label: 'Finished Goods' },
      // Reporting
      { to: '/shift-reports', icon: ClipboardType, label: 'Shift Reports' },
      { to: '/production-efficiency', icon: Gauge, label: 'Efficiency Dashboard' },
    ],
  },
  {
    label: 'Warehouse & Dispatch',
    icon: WarehouseIcon,
    items: [
      { to: '/warehouse', icon: WarehouseIcon, label: 'Finished Goods Warehouse' },
      { to: '/dispatch', icon: Truck, label: 'Dispatch Orders' },
      { to: '/fleet', icon: Truck, label: 'Fleet & Transport' },
    ],
  },
  {
    label: 'Chicks',
    icon: Truck,
    items: [
      { to: '/chick', icon: LayoutDashboard, label: 'Chick Hub' },
      // Procurement workflow
      { to: '/chick/purchase-orders', icon: FileText, label: 'Purchase Orders' },
      { to: '/chick/night-intake', icon: Activity, label: 'Night Intake' },
      { to: '/chick/delivery-declaration', icon: PackageCheck, label: 'Delivery Declaration' },
      { to: '/chick/invoice-capture', icon: DollarSign, label: 'Invoice Capture' },
      // Distribution
      { to: '/chick-distribution', icon: Truck, label: 'Chick Distribution' },
    ],
  },
  {
    label: 'Reports',
    icon: BarChart3Icon,
    items: [
      // Financial
      { to: '/reports/gross-margin', icon: TrendingUp, label: 'Gross Margin' },
      { to: '/reports/labour', icon: DollarSign, label: 'Labour Cost' },
      // Operational
      { to: '/production-report', icon: BarChart3Icon2, label: 'Production' },
      { to: '/daily-production-report', icon: ClipboardType, label: 'Daily Production Declaration' },
      { to: '/reports/macropack-reconciliation', icon: ClipboardCheck, label: 'Macropack Reconciliation' },
      { to: '/reports/process-loss', icon: BarChart3Icon2, label: 'Process Loss & Yield' },
      { to: '/reports/raw-materials', icon: PackageIcon2, label: 'Raw Materials' },
      // Reconciliation
      { to: '/reconciliation', icon: FileCheck, label: 'Reconciliation' },
      { to: '/reports/rm-reconciliation', icon: PackageIcon2, label: 'RM Reconciliation' },
      { to: '/admin/sync-log', icon: Activity, label: 'Sage Sync Log' },
      { to: '/plant-integrations', icon: Waypoints, label: 'Automation & Integrations' },
      { to: '/management-reporting', icon: Calendar, label: 'Scheduled Reporting' },
      { to: '/reports', icon: FileText, label: 'All Reports' },
    ],
  },
  {
    label: 'Payroll',
    icon: DollarSign,
    items: [
      { to: '/payroll/workers', icon: Users, label: 'Temporary Workers' },
      { to: '/payroll/attendance', icon: Clock, label: 'Attendance' },
      { to: '/payroll/processing', icon: DollarSign, label: 'Payroll Processing' },
      { to: '/payroll/history', icon: History, label: 'Payment History' },
    ],
  },
  {
    label: 'Maintenance',
    icon: Wrench,
    items: [
      { to: '/maintenance/pm-schedules', icon: Calendar, label: 'PM Schedules' },
      { to: '/maintenance/work-orders', icon: Wrench, label: 'Work Orders' },
      { to: '/maintenance/spares', icon: PackagePlus, label: 'Spares Inventory' },
      { to: '/maintenance/transactions', icon: ArrowRightLeft, label: 'Issue/Receive' },
      { to: '/maintenance/low-stock', icon: AlertTriangle, label: 'Low Stock' },
    ],
  },
  {
    label: 'Administration',
    icon: Shield,
    items: [
      { to: '/admin/users', icon: Users, label: 'User Management' },
      { to: '/admin/users?tab=access_logs', icon: Clock, label: 'System Access Logs' },
      { to: '/settings', icon: Settings, label: 'Settings' },
    ],
  },
];

interface SidebarProps {
  collapsed: boolean;
  onToggle: () => void;
  mobileMenuOpen?: boolean;
  onMobileMenuClose?: () => void;
}

export default function Sidebar({ collapsed, onToggle, mobileMenuOpen, onMobileMenuClose }: SidebarProps) {
  const { signOut } = useAuth();
  const location = useLocation();
  const [query, setQuery] = useState('');
  const [expandedGroup, setExpandedGroup] = useState<string | null>(null);

  const toggleGroup = (label: string) => {
    setExpandedGroup((prev) => (prev === label ? null : label));
  };

  const { profile, signOut: doSignOut } = useAuth() as any;
  const isAdminOrMd = isFullAccessRole(profile?.role);

  const normalizedQuery = query.trim().toLowerCase();
  const visibleGroups = useMemo(() => {
    let groups = navGroups
      .filter((group) => isAdminOrMd || group.label !== 'Administration')
      .map((group) => ({ ...group, items: group.items.filter((item) => canAccessPath(profile?.role, item.to)) }))
      .filter((group) => group.items.length > 0);
    if (!normalizedQuery) return groups;
    return groups
      .map((group) => ({
        ...group,
        items: group.items.filter((item) => item.label.toLowerCase().includes(normalizedQuery)),
      }))
      .filter((group) => group.items.length > 0);
  }, [normalizedQuery, isAdminOrMd, profile?.role]);
  const initials = (profile?.full_name || profile?.email || 'U').split(' ').map((s: string) => s[0]).join('').slice(0, 2).toUpperCase();

  return (
    <aside
      className={`fixed left-0 top-0 h-full bg-[#0c1f2e] text-white z-50 transition-all duration-300 flex flex-col ${
        collapsed ? 'w-[68px]' : 'w-[240px]'
      } ${
        mobileMenuOpen ? 'translate-x-0' : '-translate-x-full'
      } lg:translate-x-0`}
    >
      <div className="flex items-center gap-2.5 px-5 pt-5 pb-4 flex-shrink-0">
        <div className="w-9 h-9 bg-[#00d4aa] rounded-md flex items-center justify-center flex-shrink-0">
          <div className="w-[18px] h-[18px] border-2 border-white rounded-sm" />
        </div>
        {!collapsed && (
          <div className="leading-tight overflow-hidden">
            <h1 className="text-[14px] font-semibold tracking-wide text-white">PlantControl</h1>
            <p className="text-[11px] text-white/55 uppercase tracking-wider mt-0.5">Manufacturing System</p>
          </div>
        )}
      </div>

      {!collapsed && (
        <div className="px-3 pb-2">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-white/30" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Find module..."
              className="w-full pl-8 pr-3 py-1.5 rounded border border-white/5 bg-white/5 text-[12px] text-white/80 placeholder:text-white/30 focus:outline-none focus:ring-1 focus:ring-[#00d4aa]/40 focus:border-[#00d4aa]/40"
            />
          </div>
        </div>
      )}

      <nav className="flex-1 px-3 py-2 overflow-y-auto scrollbar-thin">
        {isAdminOrMd && <NavLink
          to="/"
          end
          onClick={onMobileMenuClose}
          className={({ isActive }) =>
            `flex items-center gap-3 px-3 py-2.5 mb-0.5 rounded text-[16px] transition-colors ${
              isActive
                ? 'bg-white/10 text-white font-medium'
                : 'text-white/90 hover:text-white hover:bg-white/[0.04]'
            }`
          }
        >
          {({ isActive }) => (
            <>
              <div className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${isActive ? 'bg-[#00d4aa]' : 'bg-transparent'}`} />
              {!collapsed ? (
                <span>Dashboard</span>
              ) : (
                <LayoutDashboard className={`w-[18px] h-[18px] ${isActive ? 'text-[#00d4aa]' : ''}`} />
              )}
            </>
          )}
        </NavLink>}

        {/* Grouped Navigation */}
        {visibleGroups.map((group) => {
          const containsActive = group.items.some((item) => item.to === location.pathname);
          const isExpanded = normalizedQuery ? true : expandedGroup === group.label || containsActive;
          return (
            <div key={group.label}>
              {!collapsed && (
                <>
                  <div className="my-3 border-t border-white/5" />
                  <button
                    onClick={() => toggleGroup(group.label)}
                    className={`flex items-center justify-between w-full px-3 mb-2 text-[11px] uppercase tracking-[0.1em] font-semibold transition-colors ${
                      containsActive ? 'text-white/70' : 'text-white/45 hover:text-white/65'
                    }`}
                  >
                    <span>{group.label}</span>
                    <ChevronDown className={`w-3.5 h-3.5 transition-transform ${isExpanded ? 'rotate-180' : ''}`} />
                  </button>
                </>
              )}
              {collapsed && <div className="h-px bg-white/5 my-2" />}
              {isExpanded && !collapsed && (
                <div>
                  {group.items.map((item) => (
                    <NavLink
                      key={item.to}
                      to={item.to}
                      onClick={onMobileMenuClose}
                      className={({ isActive }) =>
                        `flex items-center gap-3 px-3 py-2.5 mb-0.5 rounded text-[14px] transition-colors ${
                          isActive
                            ? 'bg-white/10 text-white font-medium'
                            : 'text-white/75 hover:text-white hover:bg-white/[0.04]'
                        }`
                      }
                    >
                      {({ isActive }) => (
                        <>
                          <div className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${isActive ? 'bg-[#00d4aa]' : 'bg-transparent'}`} />
                          <span>{item.label}</span>
                        </>
                      )}
                    </NavLink>
                  ))}
                </div>
              )}
              {isExpanded && collapsed && (
                <div>
                  {group.items.map((item) => (
                    <NavLink
                      key={item.to}
                      to={item.to}
                      onClick={onMobileMenuClose}
                      title={item.label}
                      className={({ isActive }) =>
                        `flex items-center justify-center px-2 py-2 mb-0.5 rounded transition-colors ${
                          isActive ? 'bg-white/5 text-[#00d4aa]' : 'text-white/50 hover:text-white/70'
                        }`
                      }
                    >
                      <item.icon className="w-4 h-4" />
                    </NavLink>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </nav>

      {/* User profile + sign out */}
      <div className="p-3 border-t border-white/5 flex-shrink-0">
        {!collapsed ? (
          <div className="flex items-center gap-2.5 px-3 py-2">
            <div className="w-8 h-8 bg-[#00d4aa]/20 rounded-full flex items-center justify-center text-[12px] font-semibold text-[#00d4aa] flex-shrink-0">
              {initials}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-[13px] font-medium text-white truncate">{profile?.full_name || profile?.email || 'User'}</p>
              <p className="text-[11px] text-white/55 truncate">{profile?.role || 'Operator'}</p>
            </div>
            <button
              onClick={doSignOut || signOut}
              title="Sign out"
              className="text-white/30 hover:text-red-400 transition-colors flex-shrink-0"
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-2">
            <div className="w-7 h-7 bg-[#00d4aa]/20 rounded-full flex items-center justify-center text-[11px] text-[#00d4aa]">
              {initials}
            </div>
            <button
              onClick={doSignOut || signOut}
              title="Sign out"
              className="text-white/30 hover:text-red-400 transition-colors"
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        )}
        <button
          onClick={onToggle}
          className="hidden lg:flex items-center justify-center w-full py-1.5 mt-1 rounded text-white/30 hover:text-white/70 transition-all"
        >
          {collapsed ? <ChevronRight className="w-3.5 h-3.5" /> : <ChevronLeft className="w-3.5 h-3.5" />}
        </button>
      </div>
    </aside>
  );
}
