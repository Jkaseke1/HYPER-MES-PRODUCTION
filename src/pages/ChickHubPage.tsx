import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Truck, Moon, CheckCircle, DollarSign, AlertCircle, FileText, BarChart3 } from 'lucide-react';
import { Card, CardContent } from '../components/ui/card';
import { Badge } from '../components/ui/badge';
import { supabase } from '../lib/supabase';

const chickModules = [
  {
    title: 'Purchase Orders',
    description: 'Create and manage chick purchase orders with branch demand and supplier bookings.',
    icon: FileText,
    to: '/chick/purchase-orders',
    color: 'bg-blue-500',
  },
  {
    title: 'Night Intake',
    description: 'Record hatch night allocations and delivery notes for tonight\'s deliveries.',
    icon: Moon,
    to: '/chick/night-intake',
    color: 'bg-indigo-500',
  },
  {
    title: 'Delivery Declaration',
    description: 'Confirm chick deliveries and record received quantities with variance tracking.',
    icon: CheckCircle,
    to: '/chick/delivery-declaration',
    color: 'bg-emerald-500',
  },
  {
    title: 'Invoice Capture',
    description: 'Capture supplier invoices and generate Sage posting worksheet for Owen.',
    icon: DollarSign,
    to: '/chick/invoice-capture',
    color: 'bg-green-600',
  },
  {
    title: 'Reconciliation',
    description: 'Ordered vs Received vs Sage GRV vs Sold. Margin analysis. READ-ONLY toward Sage.',
    icon: BarChart3,
    to: '/chick/reconciliation',
    color: 'bg-rose-500',
  },
  {
    title: 'Chick Distribution',
    description: 'Weekly delivery schedules by route and customer. Replace the manual Excel spreadsheet.',
    icon: Truck,
    to: '/chick-distribution',
    color: 'bg-teal-500',
  },
];

export default function ChickHubPage() {
  const navigate = useNavigate();
  const [stats, setStats] = useState({
    pendingDeliveries: 0,
    pendingInvoices: 0,
    pendingApprovals: 0,
    inProgressHatches: 0,
  });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchStats();
  }, []);

  async function fetchStats() {
    try {
      const [deliveriesRes, consignmentsRes, posRes, hatchesRes] = await Promise.all([
        supabase.from('chick_delivery_notes').select('id', { count: 'exact', head: true }).eq('status', 'PENDING'),
        supabase.from('chick_supplier_consignments').select('id, invoice:chick_supplier_invoices(id)', { count: 'exact' }),
        supabase.from('chick_purchase_orders').select('id', { count: 'exact', head: true }).eq('status', 'SUBMITTED'),
        supabase.from('chick_hatch_nights').select('id', { count: 'exact', head: true }).eq('hatch_completion_status', 'IN_PROGRESS'),
      ]);

      // Count consignments without invoices
      const pendingInvoices = (consignmentsRes.data || []).filter((c: any) => 
        !c.invoice || c.invoice.length === 0
      ).length;

      setStats({
        pendingDeliveries: deliveriesRes.count || 0,
        pendingInvoices,
        pendingApprovals: posRes.count || 0,
        inProgressHatches: hatchesRes.count || 0,
      });
    } catch (error) {
      console.error('Error fetching stats:', error);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-3xl font-bold text-slate-800">Chick Management Hub</h1>
        <p className="text-sm text-slate-500 mt-1">
          Full end-to-end workflow: POs → Hatch Night → Delivery → Invoice → Sage
        </p>
      </div>

      {/* Live Dashboard Stats */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card 
          className="border-l-4 border-l-amber-500 cursor-pointer hover:shadow-md transition-shadow"
          onClick={() => navigate('/chick/delivery-declaration')}
        >
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-slate-500 font-medium uppercase">Pending Deliveries</p>
                <p className="text-3xl font-bold text-slate-800 mt-1">
                  {loading ? '...' : stats.pendingDeliveries}
                </p>
                <p className="text-xs text-slate-400 mt-1">Awaiting declaration</p>
              </div>
              <AlertCircle className="w-8 h-8 text-amber-500" />
            </div>
          </CardContent>
        </Card>

        <Card 
          className="border-l-4 border-l-green-500 cursor-pointer hover:shadow-md transition-shadow"
          onClick={() => navigate('/chick/invoice-capture')}
        >
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-slate-500 font-medium uppercase">Pending Invoices</p>
                <p className="text-3xl font-bold text-slate-800 mt-1">
                  {loading ? '...' : stats.pendingInvoices}
                </p>
                <p className="text-xs text-slate-400 mt-1">Awaiting Owen's review</p>
              </div>
              <DollarSign className="w-8 h-8 text-green-500" />
            </div>
          </CardContent>
        </Card>

        <Card 
          className="border-l-4 border-l-blue-500 cursor-pointer hover:shadow-md transition-shadow"
          onClick={() => navigate('/chick/purchase-orders')}
        >
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-slate-500 font-medium uppercase">POs Awaiting Approval</p>
                <p className="text-3xl font-bold text-slate-800 mt-1">
                  {loading ? '...' : stats.pendingApprovals}
                </p>
                <p className="text-xs text-slate-400 mt-1">Submitted for approval</p>
              </div>
              <FileText className="w-8 h-8 text-blue-500" />
            </div>
          </CardContent>
        </Card>

        <Card 
          className="border-l-4 border-l-indigo-500 cursor-pointer hover:shadow-md transition-shadow"
          onClick={() => navigate('/chick/night-intake')}
        >
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-slate-500 font-medium uppercase">Hatches In Progress</p>
                <p className="text-3xl font-bold text-slate-800 mt-1">
                  {loading ? '...' : stats.inProgressHatches}
                </p>
                <p className="text-xs text-slate-400 mt-1">Provisional quantities</p>
              </div>
              <Moon className="w-8 h-8 text-indigo-500" />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Module Cards */}
      <div>
        <h2 className="text-lg font-semibold text-slate-700 mb-4">Workflow Modules</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {chickModules.map((mod) => (
            <Card
              key={mod.to}
              className="cursor-pointer hover:shadow-lg transition-shadow border-0 shadow-md overflow-hidden"
              onClick={() => navigate(mod.to)}
            >
              <div className={`h-2 ${mod.color}`} />
              <CardContent className="p-5">
                <div className="flex items-start gap-3">
                  <div className={`w-10 h-10 ${mod.color} rounded-lg flex items-center justify-center flex-shrink-0`}>
                    <mod.icon className="w-5 h-5 text-white" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <h3 className="text-base font-bold text-slate-800">{mod.title}</h3>
                    <p className="text-xs text-slate-500 mt-1 leading-relaxed">{mod.description}</p>
                    <div className="mt-3">
                      <Badge variant="outline" className="text-xs">
                        Click to open →
                      </Badge>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </div>
  );
}
