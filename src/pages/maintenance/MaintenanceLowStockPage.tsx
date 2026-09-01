import { useState, useEffect } from 'react';
import { AlertTriangle, Download } from 'lucide-react';
import { supabase } from '../../lib/supabase';

export default function MaintenanceLowStockPage() {
  const [lowStockItems, setLowStockItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchLowStock();
  }, []);

  const fetchLowStock = async () => {
    setLoading(true);
    const { data } = await supabase
      .from('maintenance_spares')
      .select('*')
      .or('qty_on_hand.lt.min_stock,qty_on_hand.eq.0')
      .order('sub_group');
    if (data) setLowStockItems(data);
    setLoading(false);
  };

  const exportToCSV = () => {
    const headers = ['Description', 'Machine', 'Category', 'Sub-Group', 'On Hand', 'Min Stock', 'Shortfall', 'Unit'];
    const rows = lowStockItems.map(item => [
      item.description,
      item.machine,
      item.category,
      item.sub_group,
      item.qty_on_hand,
      item.min_stock,
      Math.max(0, item.min_stock - item.qty_on_hand),
      item.unit
    ]);
    
    const csvContent = [headers, ...rows].map(row => row.join(',')).join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'low-stock-report.csv';
    a.click();
  };

  const groupedItems = lowStockItems.reduce((acc, item: any) => {
    if (!acc[item.sub_group]) acc[item.sub_group] = [];
    acc[item.sub_group].push(item);
    return acc;
  }, {} as Record<string, any[]>);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-3">
          <AlertTriangle className="h-8 w-8 text-amber-600" />
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Low Stock Report</h1>
            <p className="text-sm text-gray-500">Items below minimum stock level</p>
          </div>
        </div>
        <button
          onClick={exportToCSV}
          className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 flex items-center space-x-2"
        >
          <Download className="h-4 w-4" />
          <span>Export CSV</span>
        </button>
      </div>

      {loading ? (
        <div className="bg-white rounded-lg shadow p-8 text-center text-gray-500">Loading...</div>
      ) : Object.keys(groupedItems).length === 0 ? (
        <div className="bg-white rounded-lg shadow p-8 text-center text-gray-500">
          No items below minimum stock level
        </div>
      ) : (
        Object.entries(groupedItems).map(([subGroup, items]) => (
          <div key={subGroup} className="bg-white rounded-lg shadow overflow-hidden">
            <div className="px-6 py-4 bg-gray-50 border-b">
              <h2 className="text-lg font-semibold text-gray-900">{subGroup}</h2>
            </div>
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Description</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Machine</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">On Hand</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Min Stock</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Shortfall</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Unit</th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {(items as any[]).map((item) => (
                    <tr key={item.id} className="hover:bg-gray-50">
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">{item.description}</td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{item.machine}</td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">{item.qty_on_hand}</td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{item.min_stock}</td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-red-600">
                        {Math.max(0, item.min_stock - item.qty_on_hand)}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{item.unit}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ))
      )}
    </div>
  );
}
