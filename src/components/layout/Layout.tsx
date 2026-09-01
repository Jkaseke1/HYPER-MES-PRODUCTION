import { useState, useEffect } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import Sidebar from './Sidebar';
import Header from './Header';
import OfflineBanner from '../ui/OfflineBanner';

import { useAuth } from '../../context/AuthContext';
import { logUserAccess } from '../../lib/userAccessLogger';

const pageTitles: Record<string, string> = {
  '/': 'Dashboard',
  '/sales-orders': 'Sales Orders',
  '/formulations': 'Formulations & BOM',
  '/production-planning': 'Production Planning',
  '/raw-materials': 'Raw Materials',
  '/goods-received': 'Goods Received',
  '/quality-inspection': 'Quality Inspection',
  '/material-transfer': 'Material Transfer',
  '/rm-prices': 'Raw Material Prices',
  '/production-orders': 'Production Orders',
  '/production-efficiency': 'Production Efficiency Dashboard',
  '/daily-production-report': 'Daily Production Reports',
  '/macropack': 'Macropack Manufacturing',
  '/warehouse': 'Warehouse Management',
  '/dispatch': 'Dispatch Management',
  '/reconciliation': 'Material Reconciliation',
  '/reports/rm-reconciliation': 'Monthly RM Reconciliation',
  '/reports/gross-margin': 'Gross Margin Report',
  '/reports/process-loss': 'Process Loss & Yield Report',
  '/chick': 'Chick Management',
  '/chick-bookings': 'Chick Bookings',
  '/chick-distribution': 'Chick Distribution',
  '/reports': 'Reports & Analytics',
  '/maintenance-work-orders': 'Maintenance Work Orders',
  '/maintenance-schedules': 'PM Schedules',
  '/spare-parts': 'Spare Parts',
  '/settings': 'Settings',
  '/admin/users': 'User Management',
};

export default function Layout() {
  const [collapsed, setCollapsed] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const location = useLocation();
  const { user, profile } = useAuth();

  const title = pageTitles[location.pathname] || 'PlantControl';

  // Record user access log on page view
  useEffect(() => {
    if (user?.email) {
      logUserAccess({
        user_id: user.id,
        user_email: user.email,
        user_name: profile?.full_name || user.email.split('@')[0],
        role: profile?.role || 'user',
        event_type: 'page_view',
        module: title,
        action_details: `Accessed ${title} page (${location.pathname})`,
      });
    }
  }, [location.pathname, user, profile, title]);

  // Close mobile menu on route change
  useEffect(() => {
    setMobileMenuOpen(false);
  }, [location.pathname]);

  // Close mobile menu on escape key
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMobileMenuOpen(false);
    };
    window.addEventListener('keydown', handleEscape);
    return () => window.removeEventListener('keydown', handleEscape);
  }, []);

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Mobile overlay */}
      {mobileMenuOpen && (
        <div
          className="fixed inset-0 bg-black/50 z-40 lg:hidden"
          onClick={() => setMobileMenuOpen(false)}
        />
      )}

      {/* Sidebar - hidden on mobile, slide in when menu open */}
      <Sidebar
        collapsed={collapsed}
        onToggle={() => setCollapsed(!collapsed)}
        mobileMenuOpen={mobileMenuOpen}
        onMobileMenuClose={() => setMobileMenuOpen(false)}
      />

      {/* Main content */}
      <div
        className={`transition-all duration-300 ${
          collapsed ? 'lg:ml-[68px]' : 'lg:ml-[240px]'
        }`}
      >
        <OfflineBanner />
        <Header
          title={title}
          onMobileMenuToggle={() => setMobileMenuOpen(!mobileMenuOpen)}
        />
        <main className="p-4 sm:p-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
