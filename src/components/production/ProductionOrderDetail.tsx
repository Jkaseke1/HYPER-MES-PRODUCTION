import { useState } from 'react';
import { CheckCircle2, Circle, Clock, Package, AlertCircle, TrendingUp } from 'lucide-react';
import { format } from 'date-fns';
import StatusBadge from '../ui/StatusBadge';

interface Milestone {
  id: string;
  name: string;
  status: 'completed' | 'in_progress' | 'pending' | 'delayed';
  startTime?: string;
  endTime?: string;
  duration?: number;
}

interface Component {
  id: string;
  material: string;
  quantity: number;
  unit: string;
  status: 'available' | 'partial' | 'unavailable';
  plannedQty: number;
  actualQty: number;
  variance: number;
}

interface ProductionOrderDetailProps {
  order: any;
  materials: any[];
  onClose: () => void;
}

export default function ProductionOrderDetail({ order, materials, onClose }: ProductionOrderDetailProps) {
  const [activeTab, setActiveTab] = useState<'components' | 'schedule' | 'milestones' | 'quality'>('components');

  // Mock milestones data - in real app, fetch from database
  const milestones: Milestone[] = [
    { id: '1', name: 'Material Preparation', status: 'completed', startTime: '08:00', endTime: '08:45', duration: 45 },
    { id: '2', name: 'Mixing', status: 'completed', startTime: '08:45', endTime: '10:15', duration: 90 },
    { id: '3', name: 'Processing', status: 'in_progress', startTime: '10:15', duration: 120 },
    { id: '4', name: 'Quality Check', status: 'pending' },
    { id: '5', name: 'Packaging', status: 'pending' },
  ];

  const components: Component[] = materials.map(m => ({
    id: m.id,
    material: m.raw_materials?.name || 'Unknown',
    quantity: m.planned_qty,
    unit: m.unit,
    plannedQty: m.planned_qty,
    actualQty: m.actual_qty || 0,
    variance: (m.actual_qty || 0) - m.planned_qty,
    status: m.issued ? 'available' : 'unavailable',
  }));

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'completed': return 'bg-emerald-500';
      case 'in_progress': return 'bg-blue-500';
      case 'delayed': return 'bg-red-500';
      case 'available': return 'bg-emerald-500';
      case 'partial': return 'bg-amber-500';
      case 'unavailable': return 'bg-red-500';
      default: return 'bg-slate-300';
    }
  };

  const getProgressPercentage = () => {
    const completed = milestones.filter(m => m.status === 'completed').length;
    return (completed / milestones.length) * 100;
  };

  return (
    <div className="space-y-4">
      {/* Header with Order Info */}
      <div className="bg-slate-50 border border-slate-200 rounded p-4">
        <div className="flex items-center justify-between mb-3">
          <div>
            <h2 className="text-lg font-semibold text-slate-800">{order.batch_number}</h2>
            <p className="text-sm text-slate-600">{order.formulations?.name}</p>
          </div>
          <div className="flex items-center gap-2">
            <StatusBadge status={order.status} />
            <StatusBadge status={order.priority} />
          </div>
        </div>
        
        <div className="grid grid-cols-4 gap-4 text-sm">
          <div>
            <span className="text-slate-500">Planned Qty</span>
            <p className="font-semibold text-slate-800">{order.planned_qty} {order.unit}</p>
          </div>
          <div>
            <span className="text-slate-500">Actual Qty</span>
            <p className="font-semibold text-slate-800">{order.actual_qty || 0} {order.unit}</p>
          </div>
          <div>
            <span className="text-slate-500">Production Line</span>
            <p className="font-semibold text-slate-800">{order.machines?.name || '-'}</p>
          </div>
          <div>
            <span className="text-slate-500">Progress</span>
            <p className="font-semibold text-slate-800">{getProgressPercentage().toFixed(0)}%</p>
          </div>
        </div>
      </div>

      {/* Milestones Timeline */}
      <div className="bg-white border border-slate-200 rounded p-4">
        <h3 className="text-sm font-semibold text-slate-700 mb-3">Production Milestones</h3>
        <div className="space-y-3">
          {milestones.map((milestone, index) => (
            <div key={milestone.id} className="flex items-center gap-3">
              <div className="flex flex-col items-center">
                {milestone.status === 'completed' ? (
                  <CheckCircle2 className="w-6 h-6 text-emerald-500" />
                ) : milestone.status === 'in_progress' ? (
                  <Circle className="w-6 h-6 text-blue-500 fill-blue-500" />
                ) : milestone.status === 'delayed' ? (
                  <AlertCircle className="w-6 h-6 text-red-500" />
                ) : (
                  <Circle className="w-6 h-6 text-slate-300" />
                )}
                {index < milestones.length - 1 && (
                  <div className={`w-0.5 h-8 ${milestone.status === 'completed' ? 'bg-emerald-500' : 'bg-slate-200'}`} />
                )}
              </div>
              
              <div className="flex-1">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-slate-800">{milestone.name}</p>
                    {milestone.startTime && (
                      <p className="text-xs text-slate-500">
                        {milestone.startTime} {milestone.endTime && `- ${milestone.endTime}`}
                        {milestone.duration && ` (${milestone.duration} min)`}
                      </p>
                    )}
                  </div>
                  {milestone.status === 'in_progress' && milestone.duration && (
                    <div className="w-32">
                      <div className="h-2 bg-slate-200 rounded-full overflow-hidden">
                        <div className="h-full bg-blue-500 rounded-full" style={{ width: '65%' }} />
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Tabbed Content */}
      <div className="bg-white border border-slate-200 rounded overflow-hidden">
        {/* Tabs */}
        <div className="flex border-b border-slate-200 bg-slate-50">
          {[
            { key: 'components', label: 'Components', count: components.length },
            { key: 'schedule', label: 'Order Schedule' },
            { key: 'milestones', label: 'Configuration' },
            { key: 'quality', label: 'Inspection' },
          ].map((tab) => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key as any)}
              className={`px-4 py-3 text-sm font-medium border-b-2 transition-colors ${
                activeTab === tab.key
                  ? 'border-blue-600 text-blue-600 bg-white'
                  : 'border-transparent text-slate-600 hover:text-slate-800 hover:bg-slate-100'
              }`}
            >
              {tab.label}
              {tab.count !== undefined && (
                <span className="ml-1.5 text-xs">({tab.count})</span>
              )}
            </button>
          ))}
        </div>

        {/* Tab Content */}
        <div className="p-4">
          {activeTab === 'components' && (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-200">
                    <th className="px-3 py-2 text-left text-xs font-semibold text-slate-600 uppercase">Material</th>
                    <th className="px-3 py-2 text-left text-xs font-semibold text-slate-600 uppercase">Quantity</th>
                    <th className="px-3 py-2 text-left text-xs font-semibold text-slate-600 uppercase">Unit</th>
                    <th className="px-3 py-2 text-left text-xs font-semibold text-slate-600 uppercase">Status</th>
                    <th className="px-3 py-2 text-right text-xs font-semibold text-slate-600 uppercase">Availability</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {components.map((component) => (
                    <tr key={component.id} className="hover:bg-slate-50">
                      <td className="px-3 py-3">
                        <div className="flex items-center gap-2">
                          <Package className="w-4 h-4 text-slate-400" />
                          <span className="font-medium text-slate-800">{component.material}</span>
                        </div>
                      </td>
                      <td className="px-3 py-3 text-slate-700">{component.quantity.toLocaleString()}</td>
                      <td className="px-3 py-3 text-slate-600">{component.unit}</td>
                      <td className="px-3 py-3">
                        <div className="flex items-center gap-2">
                          <div className={`w-2 h-2 rounded-full ${getStatusColor(component.status)}`} />
                          <span className="text-xs text-slate-600 capitalize">{component.status}</span>
                        </div>
                      </td>
                      <td className="px-3 py-3 text-right">
                        <div className="flex items-center justify-end gap-2">
                          <div className="w-24 h-2 bg-slate-200 rounded-full overflow-hidden">
                            <div
                              className={`h-full rounded-full ${
                                component.status === 'available' ? 'bg-emerald-500' :
                                component.status === 'partial' ? 'bg-amber-500' : 'bg-red-500'
                              }`}
                              style={{ width: component.status === 'available' ? '100%' : component.status === 'partial' ? '50%' : '0%' }}
                            />
                          </div>
                          <span className="text-xs font-medium text-slate-700">
                            {component.status === 'available' ? '100%' : component.status === 'partial' ? '50%' : '0%'}
                          </span>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {activeTab === 'schedule' && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="p-3 bg-slate-50 rounded border border-slate-200">
                  <div className="flex items-center gap-2 mb-2">
                    <Clock className="w-4 h-4 text-slate-500" />
                    <span className="text-xs font-semibold text-slate-600 uppercase">Planned Start</span>
                  </div>
                  <p className="text-sm font-medium text-slate-800">
                    {order.planned_start ? format(new Date(order.planned_start), 'dd MMM yyyy HH:mm') : 'Not scheduled'}
                  </p>
                </div>
                <div className="p-3 bg-slate-50 rounded border border-slate-200">
                  <div className="flex items-center gap-2 mb-2">
                    <Clock className="w-4 h-4 text-slate-500" />
                    <span className="text-xs font-semibold text-slate-600 uppercase">Planned End</span>
                  </div>
                  <p className="text-sm font-medium text-slate-800">
                    {order.planned_end ? format(new Date(order.planned_end), 'dd MMM yyyy HH:mm') : 'Not scheduled'}
                  </p>
                </div>
                <div className="p-3 bg-blue-50 rounded border border-blue-200">
                  <div className="flex items-center gap-2 mb-2">
                    <TrendingUp className="w-4 h-4 text-blue-600" />
                    <span className="text-xs font-semibold text-blue-700 uppercase">Actual Start</span>
                  </div>
                  <p className="text-sm font-medium text-blue-800">
                    {order.actual_start ? format(new Date(order.actual_start), 'dd MMM yyyy HH:mm') : 'Not started'}
                  </p>
                </div>
                <div className="p-3 bg-emerald-50 rounded border border-emerald-200">
                  <div className="flex items-center gap-2 mb-2">
                    <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                    <span className="text-xs font-semibold text-emerald-700 uppercase">Actual End</span>
                  </div>
                  <p className="text-sm font-medium text-emerald-800">
                    {order.actual_end ? format(new Date(order.actual_end), 'dd MMM yyyy HH:mm') : 'In progress'}
                  </p>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'milestones' && (
            <div className="space-y-3">
              <p className="text-sm text-slate-600">Configuration and process parameters for this production order.</p>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-xs font-medium text-slate-500 uppercase">Batch Size</label>
                  <p className="text-sm font-semibold text-slate-800 mt-1">{order.planned_qty} {order.unit}</p>
                </div>
                <div>
                  <label className="text-xs font-medium text-slate-500 uppercase">Formulation</label>
                  <p className="text-sm font-semibold text-slate-800 mt-1">{order.formulations?.name}</p>
                </div>
                <div>
                  <label className="text-xs font-medium text-slate-500 uppercase">Production Line</label>
                  <p className="text-sm font-semibold text-slate-800 mt-1">{order.machines?.name || 'Not assigned'}</p>
                </div>
                <div>
                  <label className="text-xs font-medium text-slate-500 uppercase">Operator</label>
                  <p className="text-sm font-semibold text-slate-800 mt-1">{order.profiles?.full_name || 'Not assigned'}</p>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'quality' && (
            <div className="text-center py-8 text-slate-400">
              <p className="text-sm">Quality inspection data will appear here</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
