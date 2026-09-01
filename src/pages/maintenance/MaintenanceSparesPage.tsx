import { useState, useEffect } from 'react';
import { Package, Plus, AlertTriangle, Search, Star, DollarSign } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import Modal from '../../components/ui/Modal';
import StatCard from '../../components/ui/StatCard';
import toast from 'react-hot-toast';

interface SparePart {
  id: string;
  code: string;
  name: string;
  description?: string;
  category: 'mechanical' | 'electrical' | 'consumable' | 'lubricant' | 'safety' | 'other';
  unit: string;
  unit_cost: number;
  currency_code: string;
  reorder_level: number;
  current_stock: number;
  is_critical: boolean;
  is_active: boolean;
  created_at: string;
}

export default function MaintenanceSparesPage() {
  const [spares, setSpares] = useState<SparePart[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddModal, setShowAddModal] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [filterCategory, setFilterCategory] = useState('all');
  const [filterStatus, setFilterStatus] = useState('all');
  const [saving, setSaving] = useState(false);
  const [newSpare, setNewSpare] = useState({
    code: '',
    name: '',
    description: '',
    category: 'mechanical' as const,
    unit: 'pcs',
    unit_cost: 0,
    reorder_level: 0,
    current_stock: 0,
    is_critical: false,
  });

  const categories: Array<'mechanical' | 'electrical' | 'consumable' | 'lubricant' | 'safety' | 'other'> = 
    ['mechanical', 'electrical', 'consumable', 'lubricant', 'safety', 'other'];

  useEffect(() => {
    fetchSpares();
  }, []);

  const fetchSpares = async () => {
    setLoading(true);
    const { data } = await supabase
      .from('spare_parts')
      .select('*')
      .eq('is_active', true)
      .order('code');
    if (data) setSpares(data as SparePart[]);
    setLoading(false);
  };

  const handleAddSpare = async () => {
    if (!newSpare.code.trim() || !newSpare.name.trim()) {
      toast.error('Please fill in required fields');
      return;
    }
    
    setSaving(true);
    try {
      const { error } = await supabase
        .from('spare_parts')
        .insert({
          code: newSpare.code,
          name: newSpare.name,
          description: newSpare.description || null,
          category: newSpare.category,
          unit: newSpare.unit,
          unit_cost: Number(newSpare.unit_cost),
          currency_code: 'USD',
          reorder_level: Number(newSpare.reorder_level),
          current_stock: Number(newSpare.current_stock),
          is_critical: newSpare.is_critical,
          is_active: true,
        });
      
      if (error) throw error;
      
      toast.success('Spare part added');
      setNewSpare({
        code: '',
        name: '',
        description: '',
        category: 'mechanical',
        unit: 'pcs',
        unit_cost: 0,
        reorder_level: 0,
        current_stock: 0,
        is_critical: false,
      });
      setShowAddModal(false);
      fetchSpares();
    } catch (error: any) {
      console.error('Error adding spare:', error);
      toast.error(`Failed to add spare: ${error.message}`);
    } finally {
      setSaving(false);
    }
  };

  const getStatus = (spare: SparePart) => {
    if (spare.reorder_level === 0) return { label: 'No Min Set', color: 'bg-gray-100 text-gray-700' };
    if (spare.current_stock === 0) return { label: 'Out of Stock', color: 'bg-red-100 text-red-700' };
    if (spare.current_stock < spare.reorder_level) return { label: 'Low Stock', color: 'bg-amber-100 text-amber-700' };
    return { label: 'OK', color: 'bg-green-100 text-green-700' };
  };

  const filteredSpares = spares.filter(s => {
    if (filterCategory !== 'all' && s.category !== filterCategory) return false;
    if (filterStatus !== 'all' && getStatus(s).label.toLowerCase() !== filterStatus.toLowerCase()) return false;
    if (searchTerm && !s.code.toLowerCase().includes(searchTerm.toLowerCase()) && 
        !s.name.toLowerCase().includes(searchTerm.toLowerCase())) return false;
    return true;
  });

  const stats = {
    total: spares.length,
    critical: spares.filter(s => s.is_critical).length,
    outOfStock: spares.filter(s => s.current_stock === 0).length,
    lowStock: spares.filter(s => s.current_stock > 0 && s.current_stock < s.reorder_level).length,
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Spare Parts Inventory</h1>
          <p className="text-sm text-gray-500 mt-1">Maintenance spare parts management</p>
        </div>
        <button
          onClick={() => setShowAddModal(true)}
          className="px-4 py-2 bg-teal-600 text-white rounded-lg hover:bg-teal-700 transition-colors flex items-center space-x-2"
        >
          <Plus className="h-4 w-4" />
          <span>Add Spare Part</span>
        </button>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <StatCard icon={Package} title="Total Parts" value={stats.total} subtitle="Active inventory" color="blue" />
        <StatCard icon={Star} title="Critical Parts" value={stats.critical} subtitle="Essential items" color="amber" />
        <StatCard icon={AlertTriangle} title="Out of Stock" value={stats.outOfStock} subtitle="Need ordering" color="red" />
        <StatCard icon={AlertTriangle} title="Low Stock" value={stats.lowStock} subtitle="Below reorder level" color="amber" />
      </div>

      {/* Filters */}
      <div className="flex items-center space-x-4">
        <div className="flex-1 relative">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
          <input
            type="text"
            placeholder="Search code or name..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-teal-500"
          />
        </div>
        <select
          value={filterCategory}
          onChange={(e) => setFilterCategory(e.target.value)}
          className="px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-teal-500"
        >
          <option value="all">All Categories</option>
          {categories.map(cat => (
            <option key={cat} value={cat}>{cat.charAt(0).toUpperCase() + cat.slice(1)}</option>
          ))}
        </select>
        <select
          value={filterStatus}
          onChange={(e) => setFilterStatus(e.target.value)}
          className="px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-teal-500"
        >
          <option value="all">All Status</option>
          <option value="out of stock">Out of Stock</option>
          <option value="low stock">Low Stock</option>
          <option value="ok">OK</option>
        </select>
      </div>

      {/* Table */}
      <div className="bg-white rounded-lg shadow overflow-hidden">
        {loading ? (
          <div className="p-8 text-center text-gray-500">Loading...</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Code</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Name</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Category</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Current Stock</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Reorder Level</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Unit Cost</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Status</th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {filteredSpares.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-6 py-8 text-center text-gray-500">
                      No spare parts found
                    </td>
                  </tr>
                ) : (
                  filteredSpares.map((spare) => (
                    <tr key={spare.id} className="hover:bg-gray-50">
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="flex items-center space-x-2">
                          <span className="text-sm font-medium text-gray-900">{spare.code}</span>
                          {spare.is_critical && (
                            <span title="Critical Part" className="inline-flex">
                              <Star className="h-4 w-4 text-amber-500 fill-amber-500" />
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-6 py-4 text-sm text-gray-900">
                        <div>
                          <p className="font-medium">{spare.name}</p>
                          {spare.description && (
                            <p className="text-xs text-gray-500 mt-0.5">{spare.description}</p>
                          )}
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 capitalize">{spare.category}</td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                        {spare.current_stock} {spare.unit}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                        {spare.reorder_level} {spare.unit}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                        ${spare.unit_cost.toFixed(2)}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <span className={`px-2 py-1 text-xs font-medium rounded-full ${getStatus(spare).color}`}>
                          {getStatus(spare).label}
                        </span>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Add Spare Modal */}
      {showAddModal && (
        <Modal
          open={showAddModal}
          onClose={() => setShowAddModal(false)}
          title="Add New Spare Part"
          size="lg"
        >
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Code <span className="text-red-600">*</span>
                </label>
                <input
                  type="text"
                  value={newSpare.code}
                  onChange={(e) => setNewSpare({ ...newSpare, code: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-teal-500"
                  placeholder="e.g., BRG-32217"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Name <span className="text-red-600">*</span>
                </label>
                <input
                  type="text"
                  value={newSpare.name}
                  onChange={(e) => setNewSpare({ ...newSpare, name: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-teal-500"
                  placeholder="e.g., Bearing 32217"
                />
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Description</label>
              <textarea
                value={newSpare.description}
                onChange={(e) => setNewSpare({ ...newSpare, description: e.target.value })}
                rows={2}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-teal-500"
                placeholder="Additional details..."
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Category</label>
                <select
                  value={newSpare.category}
                  onChange={(e) => setNewSpare({ ...newSpare, category: e.target.value as any })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-teal-500"
                >
                  {categories.map(cat => (
                    <option key={cat} value={cat}>{cat.charAt(0).toUpperCase() + cat.slice(1)}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Unit</label>
                <select
                  value={newSpare.unit}
                  onChange={(e) => setNewSpare({ ...newSpare, unit: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-teal-500"
                >
                  <option value="pcs">pcs</option>
                  <option value="m">m</option>
                  <option value="L">L</option>
                  <option value="kg">kg</option>
                  <option value="sets">sets</option>
                </select>
              </div>
            </div>

            <div className="grid grid-cols-3 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Current Stock</label>
                <input
                  type="number"
                  value={newSpare.current_stock}
                  onChange={(e) => setNewSpare({ ...newSpare, current_stock: Number(e.target.value) })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-teal-500"
                  min="0"
                  step="0.1"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Reorder Level</label>
                <input
                  type="number"
                  value={newSpare.reorder_level}
                  onChange={(e) => setNewSpare({ ...newSpare, reorder_level: Number(e.target.value) })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-teal-500"
                  min="0"
                  step="0.1"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Unit Cost (USD)</label>
                <input
                  type="number"
                  value={newSpare.unit_cost}
                  onChange={(e) => setNewSpare({ ...newSpare, unit_cost: Number(e.target.value) })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-teal-500"
                  min="0"
                  step="0.01"
                />
              </div>
            </div>

            <div className="flex items-center">
              <input
                type="checkbox"
                id="is_critical"
                checked={newSpare.is_critical}
                onChange={(e) => setNewSpare({ ...newSpare, is_critical: e.target.checked })}
                className="h-4 w-4 text-teal-600 focus:ring-teal-500 border-gray-300 rounded"
              />
              <label htmlFor="is_critical" className="ml-2 block text-sm text-gray-900">
                Mark as <strong>Critical Part</strong> (essential for operations)
              </label>
            </div>

            <div className="flex justify-end space-x-3 pt-4">
              <button
                onClick={() => setShowAddModal(false)}
                className="px-4 py-2 text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50"
                disabled={saving}
              >
                Cancel
              </button>
              <button
                onClick={handleAddSpare}
                disabled={saving}
                className="px-6 py-2 bg-teal-600 text-white rounded-lg hover:bg-teal-700 disabled:opacity-50"
              >
                {saving ? 'Adding...' : 'Add Spare Part'}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
