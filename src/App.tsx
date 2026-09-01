import { lazy, Suspense } from 'react';
import { HashRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import Layout from './components/layout/Layout';
import LoginPage from './pages/LoginPage';
import { Loader2 } from 'lucide-react';
import { Toaster } from 'react-hot-toast';
import ErrorBoundary from './components/ErrorBoundary';
import LiveDataUpdates from './components/system/LiveDataUpdates';

const DashboardPage = lazy(() => import('./pages/DashboardPage'));
const RawMaterialsPage = lazy(() => import('./pages/RawMaterialsPage'));
const GoodsReceivedPage = lazy(() => import('./pages/GoodsReceivedPage'));
const QualityInspectionPage = lazy(() => import('./pages/QualityInspectionPage'));
const FormulationsPage = lazy(() => import('./pages/FormulationsPage'));
const ProductionPlanningPage = lazy(() => import('./pages/ProductionPlanningPage'));
const ProductionOrdersPage = lazy(() => import('./pages/ProductionOrdersPage'));
const WarehousePage = lazy(() => import('./pages/WarehousePage'));
const DispatchPage = lazy(() => import('./pages/DispatchPage'));
const ReconciliationPage = lazy(() => import('./pages/ReconciliationPage'));
const SyncLogPage = lazy(() => import('./pages/SyncLogPage'));
const ProductionReportPage = lazy(() => import('./pages/ProductionReportPage'));
const RawMaterialsReportPage = lazy(() => import('./pages/RawMaterialsReportPage'));
const LabourCostReportPage = lazy(() => import('./pages/LabourCostReportPage'));
const DispatchPlanningPage = lazy(() => import('./pages/DispatchPlanningPage'));
const DailyProductionReportPage = lazy(() => import('./pages/DailyProductionReportPage'));
const MaterialTransferPage = lazy(() => import('./pages/MaterialTransferPage'));
const RMCostRegisterPage = lazy(() => import('./pages/RMCostRegisterPage'));
const MonthlyRMReconciliationPage = lazy(() => import('./pages/MonthlyRMReconciliationPage'));
const GrossMarginReportPage = lazy(() => import('./pages/GrossMarginReportPage'));
const MacropackManufacturingPage = lazy(() => import('./pages/MacropackManufacturingPage'));
const RMStockDashboardPage = lazy(() => import('./pages/RMStockDashboardPage'));
const RMReceiptsMatrixPage = lazy(() => import('./pages/RMReceiptsMatrixPage'));
const RMIssuesMatrixPage = lazy(() => import('./pages/RMIssuesMatrixPage'));
const RMHistoryPage = lazy(() => import('./pages/RMHistoryPage'));
const ShiftReportsPage = lazy(() => import('./pages/ShiftReportsPage'));
const ProductionEfficiencyDashboardPage = lazy(() => import('./pages/ProductionEfficiencyDashboardPage'));
const ReportsPage = lazy(() => import('./pages/ReportsPage'));
const SettingsPage = lazy(() => import('./pages/SettingsPage'));
const AdminUsersPage = lazy(() => import('./pages/AdminUsersPage'));
const WeighBridgePage = lazy(() => import('./pages/WeighBridgePage'));
const FinishedGoodsPage = lazy(() => import('./pages/FinishedGoodsPage'));
const ProductionWarehousePage = lazy(() => import('./pages/ProductionWarehousePage'));
const ProcessLossReportPage = lazy(() => import('./pages/ProcessLossReportPage'));
const ChickDistributionPage = lazy(() => import('./pages/ChickDistributionPage'));
const ChickHubPage = lazy(() => import('./pages/ChickHubPage'));
const ChickPurchaseOrders = lazy(() => import('./pages/chick/ChickPurchaseOrders'));
const ChickNightIntake = lazy(() => import('./pages/chick/ChickNightIntake'));
const ChickDeliveryDeclaration = lazy(() => import('./pages/chick/ChickDeliveryDeclaration'));
const ChickInvoiceCapture = lazy(() => import('./pages/chick/ChickInvoiceCapture'));
const FleetManagementPage = lazy(() => import('./pages/FleetManagementPage'));
const ChickReconciliationPage = lazy(() => import('./pages/chick/ChickReconciliationPage'));
const StockTakePage = lazy(() => import('./pages/StockTakePage'));
const StockTakeDetailPage = lazy(() => import('./pages/StockTakeDetailPage'));
const MaintenanceSparesPage = lazy(() => import('./pages/maintenance/MaintenanceSparesPage'));
const MaintenanceTransactionsPage = lazy(() => import('./pages/maintenance/MaintenanceTransactionsPage'));
const MaintenanceLowStockPage = lazy(() => import('./pages/maintenance/MaintenanceLowStockPage'));
const MaintenanceWorkOrdersPage = lazy(() => import('./pages/maintenance/MaintenanceWorkOrdersPage'));
const MaintenancePMSchedulesPage = lazy(() => import('./pages/maintenance/MaintenancePMSchedulesPage'));
const TempWorkersPage = lazy(() => import('./pages/payroll/TempWorkersPage'));
const WorkerAttendancePage = lazy(() => import('./pages/payroll/WorkerAttendancePage'));
const PayrollProcessingPage = lazy(() => import('./pages/payroll/PayrollProcessingPage'));
const PaymentHistoryPage = lazy(() => import('./pages/payroll/PaymentHistoryPage'));
const PlantIntegrationHubPage = lazy(() => import('./pages/PlantIntegrationHubPage'));
const ManagementReportingPage = lazy(() => import('./pages/ManagementReportingPage'));
const ProductionControlCentrePage = lazy(() => import('./pages/ProductionControlCentrePage'));
const MacropackReconciliationReportPage = lazy(() => import('./pages/MacropackReconciliationReportPage'));
import { canAccessPath, defaultPathForRole } from './lib/roleAccess';

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { user, profile, loading } = useAuth();
  const location = useLocation();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <Loader2 className="w-8 h-8 animate-spin text-teal-600" />
      </div>
    );
  }

  if (!user) return <Navigate to="/login" replace />;
  if (!canAccessPath(profile?.role, location.pathname)) {
    return <Navigate to={defaultPathForRole(profile?.role)} replace />;
  }
  return <>{children}</>;
}

function PublicRoute({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-900">
        <Loader2 className="w-8 h-8 animate-spin text-teal-500" />
      </div>
    );
  }

  if (user) return <Navigate to="/" replace />;
  return <>{children}</>;
}

export default function App() {
  return (
    <ErrorBoundary>
      <AuthProvider>
        <HashRouter>
          <Toaster position="top-right" />
          <LiveDataUpdates />
          <Suspense
            fallback={
              <div className="min-h-screen flex items-center justify-center bg-slate-50">
                <Loader2 className="w-8 h-8 animate-spin text-teal-600" />
              </div>
            }
          >
          <Routes>
            <Route
              path="/login"
              element={
                <PublicRoute>
                  <LoginPage />
                </PublicRoute>
              }
            />
            <Route
              path="/"
              element={
                <ProtectedRoute>
                  <Layout />
                </ProtectedRoute>
              }
            >
              <Route index element={<DashboardPage />} />
              <Route path="sales-orders" element={<Navigate to="/" replace />} />
              <Route path="formulations" element={<FormulationsPage />} />
              <Route path="production-planning" element={<ProductionPlanningPage />} />
              <Route path="raw-materials" element={<RawMaterialsPage />} />
              <Route path="goods-received" element={<GoodsReceivedPage />} />
              <Route path="quality-inspection" element={<QualityInspectionPage />} />
              <Route path="material-transfer" element={<MaterialTransferPage />} />
              <Route path="rm-prices" element={<RMCostRegisterPage />} />
              <Route path="production-orders" element={<ProductionOrdersPage />} />
              <Route path="production-control" element={<ProductionControlCentrePage />} />
              <Route path="production-efficiency" element={<ProductionEfficiencyDashboardPage />} />
              <Route path="daily-production-report" element={<DailyProductionReportPage />} />
              <Route path="macropack" element={<MacropackManufacturingPage />} />
              <Route path="warehouse" element={<WarehousePage />} />
              <Route path="dispatch" element={<DispatchPage />} />
              <Route path="fleet" element={<FleetManagementPage />} />
              <Route path="reconciliation" element={<ReconciliationPage />} />
              <Route path="sync-log" element={<SyncLogPage />} />
              <Route path="production-report" element={<ProductionReportPage />} />
              <Route path="rm-report" element={<RawMaterialsReportPage />} />
              <Route path="labour-cost" element={<LabourCostReportPage />} />
              <Route path="dispatch-planning" element={<DispatchPlanningPage />} />
              <Route path="reports/rm-reconciliation" element={<MonthlyRMReconciliationPage />} />
              <Route path="reports/gross-margin" element={<GrossMarginReportPage />} />
              <Route path="reports/process-loss" element={<ProcessLossReportPage />} />
              <Route path="reports/macropack-reconciliation" element={<MacropackReconciliationReportPage />} />
              <Route path="rm-stock-dashboard" element={<RMStockDashboardPage />} />
              <Route path="rm-receipts-matrix" element={<RMReceiptsMatrixPage />} />
              <Route path="rm-issues-matrix" element={<RMIssuesMatrixPage />} />
              <Route path="rm-history" element={<RMHistoryPage />} />
              <Route path="shift-reports" element={<ShiftReportsPage />} />
              <Route path="reports" element={<ReportsPage />} />
              <Route path="settings" element={<SettingsPage />} />
              <Route path="admin/users" element={<AdminUsersPage />} />
              <Route path="weigh-bridge" element={<WeighBridgePage />} />
              <Route path="finished-goods" element={<FinishedGoodsPage />} />
              <Route path="production-warehouse" element={<ProductionWarehousePage />} />
              <Route path="chick" element={<ChickHubPage />} />
              <Route path="chick-bookings" element={<ChickPurchaseOrders />} />
              <Route path="chick-distribution" element={<ChickDistributionPage />} />
              <Route path="chick/night-intake" element={<ChickNightIntake />} />
              <Route path="chick/delivery-declaration" element={<ChickDeliveryDeclaration />} />
              <Route path="chick/invoice-capture" element={<ChickInvoiceCapture />} />
              <Route path="chick/reconciliation" element={<ChickReconciliationPage />} />
              <Route path="stock-take" element={<StockTakePage />} />
              <Route path="stock-take/:id" element={<StockTakeDetailPage />} />
              <Route path="spare-parts" element={<MaintenanceSparesPage />} />
              <Route path="maintenance-transactions" element={<MaintenanceTransactionsPage />} />
              <Route path="maintenance-low-stock" element={<MaintenanceLowStockPage />} />
              <Route path="maintenance-work-orders" element={<MaintenanceWorkOrdersPage />} />
              <Route path="maintenance-schedules" element={<MaintenancePMSchedulesPage />} />
              <Route path="payroll/temp-workers" element={<TempWorkersPage />} />
              <Route path="payroll/attendance" element={<WorkerAttendancePage />} />
              <Route path="payroll/processing" element={<PayrollProcessingPage />} />
              <Route path="payroll/history" element={<PaymentHistoryPage />} />
              <Route path="plant-integrations" element={<PlantIntegrationHubPage />} />
              <Route path="management-reporting" element={<ManagementReportingPage />} />
            </Route>
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
          </Suspense>
        </HashRouter>
      </AuthProvider>
    </ErrorBoundary>
  );
}
