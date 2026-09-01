import { useState, useEffect } from 'react';
import { Users, Plus, Search, Phone, Calendar, Edit2, Trash2 } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import Modal from '../../components/ui/Modal';
import StatusBadge from '../../components/ui/StatusBadge';
import toast from 'react-hot-toast';

interface TempWorker {
  id: string;
  worker_number: string;
  full_name: string;
  phone_number: string;
  national_id?: string;
  department: string;
  status: string;
  hire_date: string;
  notes?: string;
}

export default function TempWorkersPage() {
  const [workers, setWorkers] = useState<TempWorker[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddModal, setShowAddModal] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [filterDepartment, setFilterDepartment] = useState('all');
  const [filterStatus, setFilterStatus] = useState('all');
  const [saving, setSaving] = useState(false);
  
  const [newWorker, setNewWorker] = useState({
    full_name: '',
    phone_number: '',
    national_id: '',
    department: 'Production',
    notes: ''
  });

  const departments = ['Production', 'Packing', 'Warehouse', 'Maintenance', 'Cleaning', 'General'];

  useEffect(() => {
    fetchWorkers();
  }, []);

  const fetchWorkers = async () => {
    setLoading(true);
    const { data } = await supabase
      .from('temporary_workers')
      .select('*')
      .order('worker_number', { ascending: false });
    if (data) setWorkers(data);
    setLoading(false);
  };

  const handleAddWorker = async () => {
    if (!newWorker.full_name.trim() || !newWorker.phone_number.trim()) {
      toast.error('Name and phone number are required');
      return;
    }

    setSaving(true);
    try {
      // Generate worker number
      const maxWorkerNo = workers.length > 0 
        ? Math.max(...workers.map(w => parseInt(w.worker_number.replace('TW-', '')) || 0))
        : 0;
      const workerNumber = `TW-${String(maxWorkerNo + 1).padStart(4, '0')}`;

      const { error } = await supabase
        .from('temporary_workers')
        .insert({
          worker_number: workerNumber,
          full_name: newWorker.full_name,
          phone_number: newWorker.phone_number,
          national_id: newWorker.national_id || null,
          department: newWorker.department,
          notes: newWorker.notes || null,
          status: 'active'
        });

      if (error) throw error;

      toast.success('Worker added successfully');
      setShowAddModal(false);
      setNewWorker({
        full_name: '',
        phone_number: '',
        national_id: '',
        department: 'Production',
        notes: ''
      });
      fetchWorkers();
    } catch (error: any) {
      console.error('Error adding worker:', error);
      toast.error(`Failed to add worker: ${error.message}`);
    } finally {
      setSaving(false);
    }
  };

  const handleUpdateStatus = async (workerId: string, newStatus: string) => {
    try {
      const { error } = await supabase
        .from('temporary_workers')
        .update({ status: newStatus })
        .eq('id', workerId);

      if (error) throw error;

      toast.success('Status updated');
      fetchWorkers();
    } catch (error: any) {
      console.error('Error updating status:', error);
      toast.error(`Failed to update status: ${error.message}`);
    }
  };

  const filteredWorkers = workers.filter(w => {
    const matchesSearch = searchTerm === '' || 
      w.full_name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      w.worker_number.toLowerCase().includes(searchTerm.toLowerCase()) ||
      w.phone_number.includes(searchTerm);
    const matchesDept = filterDepartment === 'all' || w.department === filterDepartment;
    const matchesStatus = filterStatus === 'all' || w.status === filterStatus;
    return matchesSearch && matchesDept && matchesStatus;
  });

  const activeWorkers = workers.filter(w => w.status === 'active').length;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-3">
          <Users className="h-8 w-8 text-indigo-600" />
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Temporary Workers</h1>
            <p className="text-sm text-gray-500">Manage casual production workers</p>
          </div>
        </div>
        <button
          onClick={() => setShowAddModal(true)}
          className="flex items-center space-x-2 px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700"
        >
          <Plus className="h-5 w-5" />
          <span>Add Worker</span>
        </button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-4 gap-4">
        <div className="bg-white rounded-lg shadow p-4">
          <div className="text-sm text-gray-500">Total Workers</div>
          <div className="text-2xl font-bold text-gray-900">{workers.length}</div>
        </div>
        <div className="bg-white rounded-lg shadow p-4">
          <div className="text-sm text-gray-500">Active</div>
          <div className="text-2xl font-bold text-green-600">{activeWorkers}</div>
        </div>
        <div className="bg-white rounded-lg shadow p-4">
          <div className="text-sm text-gray-500">Inactive</div>
          <div className="text-2xl font-bold text-gray-600">
            {workers.filter(w => w.status === 'inactive').length}
          </div>
        </div>
        <div className="bg-white rounded-lg shadow p-4">
          <div className="text-sm text-gray-500">Suspended</div>
          <div className="text-2xl font-bold text-red-600">
            {workers.filter(w => w.status === 'suspended').length}
          </div>
        </div>
      </div>

      {/* Filters */}
      <div className="bg-white rounded-lg shadow p-4">
        <div className="grid grid-cols-3 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Search</label>
            <div className="relative">
              <Search className="absolute left-3 top-2.5 h-5 w-5 text-gray-400" />
              <input
                type="text"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="Name, number, or phone..."
                className="w-full pl-10 pr-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
              />
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Department</label>
            <select
              value={filterDepartment}
              onChange={(e) => setFilterDepartment(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
            >
              <option value="all">All Departments</option>
              {departments.map(dept => (
                <option key={dept} value={dept}>{dept}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Status</label>
            <select
              value={filterStatus}
              onChange={(e) => setFilterStatus(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
            >
              <option value="all">All Statuses</option>
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
              <option value="suspended">Suspended</option>
            </select>
          </div>
        </div>
      </div>

      {/* Workers Table */}
      <div className="bg-white rounded-lg shadow overflow-hidden">
        {loading ? (
          <div className="p-8 text-center text-gray-500">Loading workers...</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Worker #</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Full Name</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Phone</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">National ID</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Department</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Hire Date</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Actions</th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {filteredWorkers.map((worker) => (
                  <tr key={worker.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3 whitespace-nowrap text-sm font-medium text-gray-900">
                      {worker.worker_number}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-900">
                      {worker.full_name}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-900">
                      <div className="flex items-center space-x-1">
                        <Phone className="h-4 w-4 text-gray-400" />
                        <span>{worker.phone_number}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-900">
                      {worker.national_id || '—'}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-900">
                      {worker.department}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-900">
                      <div className="flex items-center space-x-1">
                        <Calendar className="h-4 w-4 text-gray-400" />
                        <span>{new Date(worker.hire_date).toLocaleDateString()}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <StatusBadge status={worker.status} />
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-sm">
                      <div className="flex items-center space-x-2">
                        <button className="text-indigo-600 hover:text-indigo-900">
                          <Edit2 className="h-4 w-4" />
                        </button>
                        {worker.status === 'active' && (
                          <button
                            onClick={() => handleUpdateStatus(worker.id, 'inactive')}
                            className="text-amber-600 hover:text-amber-900"
                          >
                            Deactivate
                          </button>
                        )}
                        {worker.status === 'inactive' && (
                          <button
                            onClick={() => handleUpdateStatus(worker.id, 'active')}
                            className="text-green-600 hover:text-green-900"
                          >
                            Activate
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Add Worker Modal */}
      {showAddModal && (
        <Modal
          open={showAddModal}
          onClose={() => setShowAddModal(false)}
          title="Add Temporary Worker"
        >
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Full Name *</label>
              <input
                type="text"
                value={newWorker.full_name}
                onChange={(e) => setNewWorker({ ...newWorker, full_name: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                placeholder="John Doe"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Phone Number (Ecocash) *</label>
              <input
                type="tel"
                value={newWorker.phone_number}
                onChange={(e) => setNewWorker({ ...newWorker, phone_number: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                placeholder="0771234567"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">National ID</label>
              <input
                type="text"
                value={newWorker.national_id}
                onChange={(e) => setNewWorker({ ...newWorker, national_id: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                placeholder="63-123456X12"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Department</label>
              <select
                value={newWorker.department}
                onChange={(e) => setNewWorker({ ...newWorker, department: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
              >
                {departments.map(dept => (
                  <option key={dept} value={dept}>{dept}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Notes</label>
              <textarea
                value={newWorker.notes}
                onChange={(e) => setNewWorker({ ...newWorker, notes: e.target.value })}
                rows={2}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                placeholder="Additional information..."
              />
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
                onClick={handleAddWorker}
                disabled={saving}
                className="px-6 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50"
              >
                {saving ? 'Adding...' : 'Add Worker'}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
