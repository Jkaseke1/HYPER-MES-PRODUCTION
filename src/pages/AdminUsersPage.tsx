import { useState, useEffect, useCallback, useMemo } from 'react';
import { useLocation } from 'react-router-dom';
import { Plus, Search, Shield, Users, Building2, Edit2, Trash2, Key, Clock, Activity, FileText, Globe, Laptop, RefreshCw, CheckCircle2, Filter, Sparkles, Zap, Radio } from 'lucide-react';
import { format } from 'date-fns';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import { usePermissions } from '../hooks/usePermissions';
import Modal from '../components/ui/Modal';
import StatCard from '../components/ui/StatCard';
import toast from 'react-hot-toast';
import type { Profile, Branch } from '../types/database';
import type { Role, Permission, UserRole, UserBranchAccess } from '../types/permissions';
import { APP_VERSION, APP_BUILD_TIME } from '../config/version';
import { broadcastSystemUpdate, fetchRecentSystemUpdates, fetchGitHubCommits, computeUpdateStatus, getNextVersion, SystemUpdateLogRecord, GitHubCommitRecord } from '../lib/updateManager';

interface UserWithDetails extends Profile {
  user_roles: (UserRole & { roles: Role })[];
  user_branch_access: (UserBranchAccess & { branches: Branch })[];
}

export default function AdminUsersPage() {
  const location = useLocation();
  const { loading: authLoading } = useAuth();
  const { isAdmin, hasPermission, loading: permissionsLoading } = usePermissions();
  const { profile } = useAuth();
  const [users, setUsers] = useState<UserWithDetails[]>([]);
  const [roles, setRoles] = useState<Role[]>([]);
  const [permissions, setPermissions] = useState<Permission[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [activeTab, setActiveTab] = useState<'users' | 'roles' | 'access_logs' | 'system_updates'>('users');
  
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const tabParam = params.get('tab');
    if (tabParam === 'access_logs' || tabParam === 'roles' || tabParam === 'users' || tabParam === 'system_updates') {
      setActiveTab(tabParam as any);
    }
  }, [location.search]);
  
  // Access Logs state
  const [accessLogs, setAccessLogs] = useState<any[]>([]);
  const [logFilter, setLogFilter] = useState<'all' | 'login' | 'page_view' | 'action'>('all');
  const [logSearch, setLogSearch] = useState('');

  // System Updates Broadcast state
  const [updateVersion, setUpdateVersion] = useState(getNextVersion(APP_VERSION));
  const [updateNotes, setUpdateNotes] = useState('New manufacturing features, BOM optimizations, and performance enhancements.');
  const [broadcasting, setBroadcasting] = useState(false);
  const [softBroadcastSent, setSoftBroadcastSent] = useState<string | null>(null);
  const [forceBroadcastSent, setForceBroadcastSent] = useState<string | null>(null);
  const [updateHistory, setUpdateHistory] = useState<SystemUpdateLogRecord[]>([]);
  const [githubCommits, setGithubCommits] = useState<GitHubCommitRecord[]>([]);

  const loadUpdateHistory = useCallback(async () => {
    const records = await fetchRecentSystemUpdates();
    setUpdateHistory(records);
    const commits = await fetchGitHubCommits();
    setGithubCommits(commits);
  }, []);

  useEffect(() => {
    if (activeTab === 'system_updates') {
      loadUpdateHistory();
    }
  }, [activeTab, loadUpdateHistory]);

  const cleanCurrentVer = (updateVersion || '').trim().toLowerCase().replace('v', '');

  const isSoftAlreadySent = useMemo(() => {
    if (!cleanCurrentVer) return false;
    const foundInHistory = updateHistory.some(
      (r) => r.type === 'soft_update' && (r.version || '').trim().toLowerCase().replace('v', '') === cleanCurrentVer
    );
    const foundInStorage = localStorage.getItem(`broadcast_sent_soft_${cleanCurrentVer}`) === 'true';
    return foundInHistory || foundInStorage || (softBroadcastSent || '').trim().toLowerCase().replace('v', '') === cleanCurrentVer;
  }, [cleanCurrentVer, updateHistory, softBroadcastSent]);

  const isForceAlreadySent = useMemo(() => {
    if (!cleanCurrentVer) return false;
    const foundInHistory = updateHistory.some(
      (r) => r.type === 'force_update' && (r.version || '').trim().toLowerCase().replace('v', '') === cleanCurrentVer
    );
    const foundInStorage = localStorage.getItem(`broadcast_sent_force_${cleanCurrentVer}`) === 'true';
    return foundInHistory || foundInStorage || (forceBroadcastSent || '').trim().toLowerCase().replace('v', '') === cleanCurrentVer;
  }, [cleanCurrentVer, updateHistory, forceBroadcastSent]);

  async function handleSoftUpdate() {
    if (!updateVersion.trim()) {
      toast.error('Please enter a version number.');
      return;
    }
    if (isSoftAlreadySent) {
      toast.error(`Update announcement (${updateVersion}) has already been broadcasted.`);
      return;
    }
    setBroadcasting(true);
    try {
      await broadcastSystemUpdate('soft_update', updateVersion, updateNotes, profile?.email || 'admin@hyperfeeds.co.zw');
      setSoftBroadcastSent(updateVersion);
      try {
        localStorage.setItem(`broadcast_sent_soft_${cleanCurrentVer}`, 'true');
      } catch (e) {}
      toast.success(`Soft update broadcasted! Active users will see the "Update Now" banner.`);
      loadUpdateHistory();
    } catch (e: any) {
      toast.error(`Broadcast failed: ${e.message}`);
    } finally {
      setBroadcasting(false);
    }
  }

  async function handleForceUpdate() {
    if (isForceAlreadySent) {
      toast.error(`Critical update (${updateVersion}) has already been force-pushed.`);
      return;
    }
    if (!confirm(`Are you sure you want to FORCE PUSH update (${updateVersion}) to ALL active users? This will automatically refresh their browsers in 5 seconds.`)) return;
    
    setBroadcasting(true);
    try {
      await broadcastSystemUpdate('force_update', updateVersion, updateNotes, profile?.email || 'admin@hyperfeeds.co.zw');
      setForceBroadcastSent(updateVersion);
      try {
        localStorage.setItem(`broadcast_sent_force_${cleanCurrentVer}`, 'true');
      } catch (e) {}
      toast.success(`FORCE UPDATE PUSHED! All active user sessions are now refreshing.`);
      loadUpdateHistory();
    } catch (e: any) {
      toast.error(`Force broadcast failed: ${e.message}`);
    } finally {
      setBroadcasting(false);
    }
  }
  
  // User modal state
  const [userModal, setUserModal] = useState(false);
  const [selectedUser, setSelectedUser] = useState<UserWithDetails | null>(null);
  const [userRoles, setUserRoles] = useState<string[]>([]);
  const [userBranches, setUserBranches] = useState<{ branch_id: string; access_level: string }[]>([]);
  const [userProfile, setUserProfile] = useState({
    full_name: '',
    email: '',
    phone: '',
    role: 'operator' as Profile['role']
  });
  
  // Create user modal state
  const [createUserModal, setCreateUserModal] = useState(false);
  const [userForm, setUserForm] = useState({
    email: '',
    password: '',
    full_name: '',
    phone: '',
    role: 'operator' as Profile['role'],
  });
  const [deleteModal, setDeleteModal] = useState(false);
  const [userToDelete, setUserToDelete] = useState<UserWithDetails | null>(null);
  
  // Role modal state
  const [roleModal, setRoleModal] = useState(false);
  const [selectedRole, setSelectedRole] = useState<Role | null>(null);
  const [rolePermissions, setRolePermissions] = useState<string[]>([]);
  const [roleForm, setRoleForm] = useState({ code: '', name: '', description: '' });
  
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetchData();
  }, []);

  async function fetchData() {
    setLoading(true);
    try {
      const [usersRes, rolesRes, permsRes, branchesRes, userRolesRes, userBranchRes, accessLogsRes, auditLogsRes] = await Promise.all([
        supabase.from('profiles').select('*').order('full_name'),
        supabase.from('roles').select('*').order('name'),
        supabase.from('permissions').select('*').order('module, code'),
        supabase.from('branches').select('*').eq('is_active', true).order('name'),
        supabase.from('user_roles').select('*, roles(*)'),
        supabase.from('user_branch_access').select('*, branches(*)'),
        supabase.from('user_access_logs').select('*').order('created_at', { ascending: false }).limit(200),
        supabase.from('approval_audit_log').select('*').order('created_at', { ascending: false }).limit(100),
      ]);
      
      if (usersRes.error) console.error('Users fetch error:', usersRes.error);
      if (rolesRes.error) console.error('Roles fetch error:', rolesRes.error);
      if (permsRes.error) console.error('Permissions fetch error:', permsRes.error);
      if (branchesRes.error) console.error('Branches fetch error:', branchesRes.error);
      
      // Combine user data with roles and branch access
      const usersWithDetails = (usersRes.data || []).map(user => ({
        ...user,
        user_roles: (userRolesRes.data || []).filter(ur => ur.user_id === user.id),
        user_branch_access: (userBranchRes.data || []).filter(uba => uba.user_id === user.id),
      }));
      
      setUsers(usersWithDetails);
      setRoles(rolesRes.data || []);
      setPermissions(permsRes.data || []);
      setBranches(branchesRes.data || []);

      // Build & synthesize access logs
      const rawDbLogs = accessLogsRes.data || [];
      const auditItems = (auditLogsRes.data || []).map((a: any) => ({
        id: a.id,
        user_email: a.user_email || 'system@hyperfeeds.co.zw',
        user_name: a.user_name || 'System User',
        role: a.user_role || 'user',
        event_type: 'action',
        module: a.action_type || 'System Action',
        action_details: `Approved/Actioned: ${a.reference_number || a.entity_type || 'System Event'}`,
        ip_address: '127.0.0.1',
        created_at: a.created_at || a.action_date || new Date().toISOString(),
      }));

      const profileLogs = (usersRes.data || []).flatMap((u: any) => [
        {
          id: `login_${u.id}`,
          user_email: u.email || 'user@hyperfeeds.co.zw',
          user_name: u.full_name || u.email?.split('@')[0],
          role: u.role || 'user',
          event_type: 'login',
          module: 'Authentication',
          action_details: `User session active (${u.email})`,
          ip_address: '127.0.0.1',
          created_at: u.updated_at || u.created_at || new Date().toISOString(),
        },
        {
          id: `reg_${u.id}`,
          user_email: u.email || 'user@hyperfeeds.co.zw',
          user_name: u.full_name || u.email?.split('@')[0],
          role: u.role || 'user',
          event_type: 'action',
          module: 'User Management',
          action_details: `Account registered/updated for ${u.full_name || u.email}`,
          ip_address: '127.0.0.1',
          created_at: u.created_at || new Date().toISOString(),
        }
      ]);

      const mergedLogs = [...rawDbLogs, ...auditItems, ...profileLogs].sort(
        (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
      );

      setAccessLogs(mergedLogs);
    } catch (error) {
      console.error('FetchData error:', error);
    } finally {
      setLoading(false);
    }
  }

  function openUserModal(user: UserWithDetails) {
    setSelectedUser(user);
    setUserRoles(user.user_roles?.map(ur => ur.role_id) || []);
    setUserBranches(user.user_branch_access?.map(uba => ({ 
      branch_id: uba.branch_id, 
      access_level: uba.access_level 
    })) || []);
    setUserProfile({
      full_name: user.full_name || '',
      email: user.email || '',
      phone: user.phone || '',
      role: user.role || 'operator'
    });
    setUserModal(true);
  }

  async function saveUserProfile() {
    if (!selectedUser) return;
    setSaving(true);
    
    try {
      // Update user profile
      const { error } = await supabase
        .from('profiles')
        .update({
          full_name: userProfile.full_name,
          email: userProfile.email,
          phone: userProfile.phone,
          role: userProfile.role
        })
        .eq('id', selectedUser.id);

      if (error) throw error;
    } catch (error: any) {
      console.error('Error updating user profile:', error);
      alert('Failed to update user profile: ' + error.message);
      setSaving(false);
      return;
    }
  }

  async function saveUserRoles() {
    if (!selectedUser) return;
    setSaving(true);
    
    try {
      // Update user profile first
      await saveUserProfile();
      
      // Delete existing roles and add new ones
      await supabase.from('user_roles').delete().eq('user_id', selectedUser.id);
      if (userRoles.length > 0) {
        await supabase.from('user_roles').insert(
          userRoles.map(roleId => ({ user_id: selectedUser.id, role_id: roleId }))
        );
      }
      
      // Delete existing branch access and add new ones
      await supabase.from('user_branch_access').delete().eq('user_id', selectedUser.id);
      if (userBranches.length > 0) {
        await supabase.from('user_branch_access').insert(
          userBranches.map(ba => ({ 
            user_id: selectedUser.id, 
            branch_id: ba.branch_id, 
            access_level: ba.access_level 
          }))
        );
      }
    } catch (error: any) {
      console.error('Error saving user roles and access:', error);
      alert('Failed to save user roles and access: ' + error.message);
    }
    
    setSaving(false);
    setUserModal(false);
    fetchData();
  }

  function openCreateUserModal() {
    setUserForm({
      email: '',
      password: '',
      full_name: '',
      phone: '',
      role: 'operator',
    });
    setUserRoles([]);
    setUserBranches([]);
    setCreateUserModal(true);
  }

  async function createUser() {
    if (!userForm.email || !userForm.password || !userForm.full_name) {
      toast.error('Please fill in all required fields');
      return;
    }

    const cleanEmail = userForm.email.trim().toLowerCase();
    const isExactAdmin = cleanEmail === 'admin@hyperfeeds.com';
    const isOfficialDomain = cleanEmail.endsWith('@hyperfeeds.co.zw') || cleanEmail.endsWith('@hyperfeedsnutrition.co.zw');
    if (!isExactAdmin && !isOfficialDomain) {
      toast.error('Access restricted: Only official @hyperfeeds.co.zw email addresses or admin@hyperfeeds.com are allowed.');
      return;
    }

    setSaving(true);
    try {
      // Create auth user
      const { data: authData, error: authError } = await supabase.auth.signUp({
        email: cleanEmail,
        password: userForm.password,
        options: {
          data: {
            full_name: userForm.full_name,
            role: userForm.role,
          },
        },
      });

      if (authError) {
        if (authError.message?.includes('Database error') || (authError as any).status === 500) {
          throw new Error('Database trigger issue on user creation. Please run the SQL fix script in Supabase SQL Editor.');
        }
        throw authError;
      }

      if (authData.user) {
        const userId = authData.user.id;
        // Try to insert profile first, if it exists due to trigger, update it
        const { error: profileError } = await supabase
          .from('profiles')
          .upsert({
            id: userId,
            full_name: userForm.full_name,
            phone: userForm.phone,
            role: userForm.role,
            email: userForm.email,
          }, {
            onConflict: 'id'
          });
        
        if (profileError) {
          console.error('Profile creation error:', profileError);
          throw profileError;
        }

        // Assign roles
        if (userRoles.length > 0) {
          await supabase.from('user_roles').insert(
            userRoles.map(roleId => ({ user_id: userId, role_id: roleId }))
          );
        }

        // Assign branch access
        if (userBranches.length > 0) {
          await supabase.from('user_branch_access').insert(
            userBranches.map(ub => ({
              user_id: userId,
              branch_id: ub.branch_id,
              access_level: ub.access_level,
            }))
          );
        }

        toast.success('User created successfully!');
        setCreateUserModal(false);
        fetchData();
      }
    } catch (error: any) {
      toast.error(`Error creating user: ${error.message}`);
    } finally {
      setSaving(false);
    }
  }

  
  function openDeleteModal(user: UserWithDetails) {
    setUserToDelete(user);
    setDeleteModal(true);
  }

  async function deleteUser() {
    if (!userToDelete) return;
    setSaving(true);
    try {
      // Delete user roles and branch access first
      await supabase.from('user_roles').delete().eq('user_id', userToDelete.id);
      await supabase.from('user_branch_access').delete().eq('user_id', userToDelete.id);
      
      // Note: We can't delete auth users via client SDK, only profiles
      // Admin should use Supabase dashboard to fully delete auth users
      await supabase.from('profiles').delete().eq('id', userToDelete.id);

      toast.success('User profile deleted successfully!');
      setDeleteModal(false);
      setUserToDelete(null);
      fetchData();
    } catch (error: any) {
      toast.error(`Error deleting user: ${error.message}`);
    } finally {
      setSaving(false);
    }
  }

  function openRoleModal(role?: Role) {
    if (role) {
      setSelectedRole(role);
      setRoleForm({ code: role.code, name: role.name, description: role.description || '' });
      // Load role permissions
      supabase.from('role_permissions')
        .select('permission_id')
        .eq('role_id', role.id)
        .then(({ data }) => {
          setRolePermissions(data?.map(rp => rp.permission_id) || []);
        });
    } else {
      setSelectedRole(null);
      setRoleForm({ code: '', name: '', description: '' });
      setRolePermissions([]);
    }
    setRoleModal(true);
  }

  async function saveRole() {
    setSaving(true);
    
    let roleId = selectedRole?.id;
    
    if (selectedRole) {
      // Update existing role
      await supabase.from('roles')
        .update({ name: roleForm.name, description: roleForm.description })
        .eq('id', selectedRole.id);
    } else {
      // Create new role
      const { data } = await supabase.from('roles')
        .insert({ code: roleForm.code, name: roleForm.name, description: roleForm.description })
        .select()
        .single();
      roleId = data?.id;
    }
    
    if (roleId) {
      // Update permissions
      await supabase.from('role_permissions').delete().eq('role_id', roleId);
      if (rolePermissions.length > 0) {
        await supabase.from('role_permissions').insert(
          rolePermissions.map(permId => ({ role_id: roleId, permission_id: permId }))
        );
      }
    }
    
    setSaving(false);
    setRoleModal(false);
    fetchData();
  }

  async function deleteRole(roleId: string) {
    if (!confirm('Are you sure you want to delete this role?')) return;
    await supabase.from('roles').delete().eq('id', roleId);
    fetchData();
  }

  function toggleUserRole(roleId: string) {
    setUserRoles(prev => 
      prev.includes(roleId) 
        ? prev.filter(id => id !== roleId)
        : [...prev, roleId]
    );
  }

  function toggleRolePermission(permId: string) {
    setRolePermissions(prev => 
      prev.includes(permId) 
        ? prev.filter(id => id !== permId)
        : [...prev, permId]
    );
  }

  function addBranchAccess() {
    const availableBranches = branches.filter(b => !userBranches.some(ub => ub.branch_id === b.id));
    if (availableBranches.length > 0) {
      setUserBranches([...userBranches, { branch_id: availableBranches[0].id, access_level: 'read' }]);
    }
  }

  function removeBranchAccess(branchId: string) {
    setUserBranches(userBranches.filter(ub => ub.branch_id !== branchId));
  }

  function updateBranchAccess(branchId: string, field: 'branch_id' | 'access_level', value: string) {
    setUserBranches(userBranches.map(ub => 
      ub.branch_id === branchId ? { ...ub, [field]: value } : ub
    ));
  }

  const filteredUsers = users.filter(u => 
    u.full_name?.toLowerCase().includes(search.toLowerCase()) ||
    u.email?.toLowerCase().includes(search.toLowerCase())
  );

  const filteredAccessLogs = accessLogs.filter((log) => {
    const matchesFilter = logFilter === 'all' || log.event_type === logFilter;
    const matchesSearch = !logSearch || 
      log.user_name?.toLowerCase().includes(logSearch.toLowerCase()) ||
      log.user_email?.toLowerCase().includes(logSearch.toLowerCase()) ||
      log.module?.toLowerCase().includes(logSearch.toLowerCase()) ||
      log.action_details?.toLowerCase().includes(logSearch.toLowerCase());
    return matchesFilter && matchesSearch;
  });

  const permissionsByModule = permissions.reduce((acc, p) => {
    if (!acc[p.module]) acc[p.module] = [];
    acc[p.module].push(p);
    return acc;
  }, {} as Record<string, Permission[]>);

  // Stats
  const totalUsers = users.length;
  const adminCount = users.filter(u => u.user_roles?.some(ur => ur.roles?.code === 'admin')).length;
  const activeRoles = roles.filter(r => r.is_active).length;

  if (loading || permissionsLoading || authLoading) {
    return (
      <div className="flex flex-col items-center justify-center h-96 text-slate-500">
        <div className="w-8 h-8 border-2 border-slate-200 border-t-teal-600 rounded-full animate-spin mb-3" />
        <p className="text-xs font-semibold text-slate-600">Loading User Management & Access Control...</p>
      </div>
    );
  }

  if (!isAdmin() && !hasPermission('admin.users')) {
    return (
      <div className="p-6">
        <div className="bg-red-50 border border-red-200 rounded-xl p-6 text-center">
          <Shield className="w-12 h-12 text-red-400 mx-auto mb-3" />
          <h2 className="text-lg font-semibold text-red-800">Access Denied</h2>
          <p className="text-sm text-red-600 mt-1">You don't have permission to access this page.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">User & Access Management</h1>
          <p className="text-sm text-slate-500 mt-1">Manage users, roles, and permissions</p>
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard title="Total Users" value={totalUsers} icon={Users} color="teal" />
        <StatCard title="Administrators" value={adminCount} icon={Shield} color="red" />
        <StatCard title="Active Roles" value={activeRoles} icon={Key} color="amber" />
        <StatCard title="Branches" value={branches.length} icon={Building2} color="slate" />
      </div>

      {/* Tabs */}
      <div className="flex border-b border-slate-200">
        {[
          { key: 'users', label: 'Users', icon: Users },
          { key: 'roles', label: 'Roles & Permissions', icon: Shield },
          { key: 'access_logs', label: 'System Access Logs', icon: Clock },
          { key: 'system_updates', label: 'System Updates & Version Control', icon: Sparkles },
        ].map(tab => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key as any)}
            className={`flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 transition-colors ${
              activeTab === tab.key
                ? 'border-teal-600 text-teal-600'
                : 'border-transparent text-slate-500 hover:text-slate-700'
            }`}
          >
            <tab.icon className="w-4 h-4" />
            {tab.label}
          </button>
        ))}
      </div>

      {/* Users Tab */}
      {activeTab === 'users' && (
        <div className="space-y-4">
          <div className="flex items-center gap-4">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <input
                type="text"
                placeholder="Search users..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full pl-9 pr-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500"
              />
            </div>
            <button
              onClick={openCreateUserModal}
              className="flex items-center gap-2 px-4 py-2 bg-teal-600 hover:bg-teal-700 text-white rounded-lg text-sm font-medium transition-colors"
            >
              <Plus className="w-4 h-4" />
              Create User
            </button>
          </div>

          <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 border-b border-slate-200">
                <tr>
                  {['User', 'Email', 'Roles', 'Branch Access', 'Actions'].map(h => (
                    <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-slate-600">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredUsers.map(user => (
                  <tr key={user.id} className="hover:bg-slate-50">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 bg-teal-100 rounded-full flex items-center justify-center">
                          <span className="text-sm font-medium text-teal-700">
                            {user.full_name?.charAt(0) || '?'}
                          </span>
                        </div>
                        <div>
                          <p className="font-medium text-slate-800">{user.full_name || 'No name'}</p>
                          <p className="text-xs text-slate-500">{user.role}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-slate-600">{user.email}</td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-1">
                        {user.user_roles?.length > 0 ? (
                          user.user_roles.map(ur => (
                            <span key={ur.id} className="px-2 py-0.5 bg-teal-50 text-teal-700 text-xs rounded-full">
                              {ur.roles?.name}
                            </span>
                          ))
                        ) : (
                          <span className="text-xs text-slate-400">No roles assigned</span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-1">
                        {user.user_branch_access?.length > 0 ? (
                          user.user_branch_access.map(uba => (
                            <span key={uba.id} className="px-2 py-0.5 bg-slate-100 text-slate-600 text-xs rounded-full">
                              {uba.branches?.name} ({uba.access_level})
                            </span>
                          ))
                        ) : (
                          <span className="text-xs text-slate-400">All branches</span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => openUserModal(user)}
                          className="p-1.5 hover:bg-slate-100 rounded-lg transition-colors"
                          title="Edit user access"
                        >
                          <Edit2 className="w-4 h-4 text-slate-500" />
                        </button>
                        <button
                          onClick={() => openDeleteModal(user)}
                          className="p-1.5 hover:bg-red-50 rounded-lg transition-colors"
                          title="Delete user"
                        >
                          <Trash2 className="w-4 h-4 text-red-500" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Roles Tab */}
      {activeTab === 'roles' && (
        <div className="space-y-4">
          <div className="flex justify-end">
            <button
              onClick={() => openRoleModal()}
              className="flex items-center gap-2 px-4 py-2 bg-teal-600 hover:bg-teal-700 text-white rounded-lg text-sm font-medium transition-colors"
            >
              <Plus className="w-4 h-4" />
              New Role
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {roles.map(role => (
              <div key={role.id} className="bg-white rounded-xl border border-slate-200 p-4">
                <div className="flex items-start justify-between mb-3">
                  <div>
                    <h3 className="font-semibold text-slate-800">{role.name}</h3>
                    <p className="text-xs text-slate-500 font-mono">{role.code}</p>
                  </div>
                  {!role.is_system && (
                    <div className="flex gap-1">
                      <button
                        onClick={() => openRoleModal(role)}
                        className="p-1.5 hover:bg-slate-100 rounded transition-colors"
                      >
                        <Edit2 className="w-4 h-4 text-slate-500" />
                      </button>
                      <button
                        onClick={() => deleteRole(role.id)}
                        className="p-1.5 hover:bg-red-50 rounded transition-colors"
                      >
                        <Trash2 className="w-4 h-4 text-red-500" />
                      </button>
                    </div>
                  )}
                </div>
                <p className="text-sm text-slate-600 mb-3">{role.description || 'No description'}</p>
                <div className="flex items-center justify-between text-xs">
                  <span className={`px-2 py-1 rounded ${role.is_system ? 'bg-amber-50 text-amber-700' : 'bg-slate-100 text-slate-600'}`}>
                    {role.is_system ? 'System Role' : 'Custom Role'}
                  </span>
                  <span className={`px-2 py-1 rounded ${role.is_active ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'}`}>
                    {role.is_active ? 'Active' : 'Inactive'}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* System Access Logs & Audit Trail Tab */}
      {activeTab === 'access_logs' && (
        <div className="space-y-4">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-white p-4 rounded-2xl border border-slate-200 shadow-sm">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-teal-50 text-teal-600 flex items-center justify-center font-bold">
                <Clock className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-sm font-extrabold text-slate-800 uppercase tracking-wider">System Access Logs & Audit Trail</h3>
                <p className="text-xs text-slate-500">Track user logins, page views, and operational actions</p>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                <input
                  type="text"
                  placeholder="Search logs by user, module, details..."
                  value={logSearch}
                  onChange={(e) => setLogSearch(e.target.value)}
                  className="pl-9 pr-3 py-1.5 text-xs border border-slate-200 rounded-xl w-64 focus:outline-none focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500"
                />
              </div>

              <div className="flex items-center gap-1 bg-slate-100 p-1 rounded-xl">
                {[
                  { id: 'all', label: 'All Events' },
                  { id: 'login', label: '🔑 Logins' },
                  { id: 'page_view', label: '📄 Page Views' },
                  { id: 'action', label: '⚡ Actions' },
                ].map((f) => (
                  <button
                    key={f.id}
                    onClick={() => setLogFilter(f.id as any)}
                    className={`px-2.5 py-1 text-xs font-bold rounded-lg transition-all ${
                      logFilter === f.id ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'
                    }`}
                  >
                    {f.label}
                  </button>
                ))}
              </div>

              <button
                onClick={fetchData}
                className="p-2 bg-slate-100 hover:bg-slate-200 text-slate-600 rounded-xl text-xs transition-colors"
                title="Refresh logs"
              >
                <RefreshCw className="w-4 h-4" />
              </button>
            </div>
          </div>

          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="bg-slate-900 text-white uppercase tracking-wider font-semibold">
                  <tr>
                    <th className="px-4 py-3 text-left">Timestamp</th>
                    <th className="px-4 py-3 text-left">User & Role</th>
                    <th className="px-4 py-3 text-left">Event Type</th>
                    <th className="px-4 py-3 text-left">Module</th>
                    <th className="px-4 py-3 text-left">Action & Details</th>
                    <th className="px-4 py-3 text-right">IP / Environment</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filteredAccessLogs.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="px-4 py-12 text-center text-slate-400 space-y-1">
                        <Clock className="w-10 h-10 text-slate-300 mx-auto mb-2" />
                        <p className="text-sm font-bold text-slate-700">No system access logs match your filter</p>
                        <p className="text-xs text-slate-400">Try adjusting your search query or event filter.</p>
                      </td>
                    </tr>
                  ) : (
                    filteredAccessLogs.map((log, idx) => {
                      let typeBadge = 'bg-slate-100 text-slate-700 border-slate-200';
                      if (log.event_type === 'login') typeBadge = 'bg-blue-50 text-blue-800 border-blue-200 font-extrabold';
                      if (log.event_type === 'page_view') typeBadge = 'bg-teal-50 text-teal-800 border-teal-200';
                      if (log.event_type === 'action') typeBadge = 'bg-purple-50 text-purple-800 border-purple-200 font-bold';

                      return (
                        <tr key={log.id || idx} className="hover:bg-slate-50/80 transition-colors">
                          <td className="px-4 py-3 font-mono text-slate-500 whitespace-nowrap">
                            {format(new Date(log.created_at), 'dd MMM yyyy HH:mm:ss')}
                          </td>
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-2">
                              <div className="w-6 h-6 rounded-full bg-slate-100 border border-slate-200 flex items-center justify-center font-bold text-[10px] text-slate-700 shrink-0">
                                {log.user_name?.charAt(0) || log.user_email?.charAt(0) || 'U'}
                              </div>
                              <div>
                                <p className="font-extrabold text-slate-900 leading-tight">{log.user_name || 'System User'}</p>
                                <p className="text-[10px] text-slate-400 font-mono">{log.user_email}</p>
                              </div>
                              <span className="text-[9px] uppercase font-bold text-slate-600 bg-slate-100 px-1.5 py-0.5 rounded border border-slate-200 ml-1">
                                {log.role || 'user'}
                              </span>
                            </div>
                          </td>
                          <td className="px-4 py-3">
                            <span className={`inline-flex items-center gap-1 text-[9.5px] uppercase px-2 py-0.5 rounded-full border ${typeBadge}`}>
                              {log.event_type === 'login' && <Key className="w-3 h-3 text-blue-600" />}
                              {log.event_type === 'page_view' && <Eye className="w-3 h-3 text-teal-600" />}
                              {log.event_type === 'action' && <Activity className="w-3 h-3 text-purple-600" />}
                              {log.event_type}
                            </span>
                          </td>
                          <td className="px-4 py-3">
                            <span className="text-[10px] font-bold text-slate-700 bg-slate-100 border border-slate-200 px-2 py-0.5 rounded-md">
                              {log.module || 'General'}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-slate-800 font-medium">
                            {log.action_details}
                          </td>
                          <td className="px-4 py-3 text-right">
                            <span className="inline-flex items-center gap-1 font-mono text-[10px] text-slate-500 bg-slate-50 border border-slate-200 px-2 py-0.5 rounded">
                              <Laptop className="w-3 h-3 text-slate-400" />
                              {log.ip_address || '127.0.0.1'}
                            </span>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* System Updates & Version Control Tab */}
      {activeTab === 'system_updates' && (
        <div className="space-y-6">
          {/* Top Banner */}
          <div className="bg-slate-900 text-white p-6 rounded-2xl flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 shadow-xl">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-teal-500/20 text-teal-400 flex items-center justify-center font-bold">
                <Sparkles className="w-6 h-6" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="text-lg font-black text-white">System Version Control & Release Log</h3>
                  <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 flex items-center gap-1">
                    <Radio className="w-3 h-3 text-emerald-400 animate-pulse" /> LIVE PRODUCTION
                  </span>
                </div>
                <p className="text-xs text-slate-300 mt-1">
                  Code changes and new builds are compiled automatically. Users install updates directly via the top screen header menu.
                </p>
              </div>
            </div>

            <div className="bg-slate-800/80 border border-slate-700 px-5 py-3 rounded-2xl font-mono text-xs shadow-inner flex items-center gap-3">
              <div>
                <p className="text-[10px] text-slate-400 uppercase font-bold">Installed Production Build</p>
                <p className="text-lg font-black text-emerald-400">{APP_VERSION}</p>
              </div>
              <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-ping" />
            </div>
          </div>

          {/* Version Info & Self-Installation Guidance Cards */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm space-y-2">
              <div className="flex items-center gap-2 text-teal-700 font-extrabold text-xs">
                <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                Automated Update Distribution
              </div>
              <p className="text-xs text-slate-600 leading-relaxed">
                When new software builds are committed to GitHub main branch, the PWA service worker automatically registers the new assets.
              </p>
            </div>

            <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm space-y-2">
              <div className="flex items-center gap-2 text-purple-700 font-extrabold text-xs">
                <Sparkles className="w-4 h-4 text-purple-600" />
                User-Initiated Self Installation
              </div>
              <p className="text-xs text-slate-600 leading-relaxed">
                Users can click the top header pill <strong>[ MES {APP_VERSION} ]</strong> at any time to inspect release notes and trigger an instant 1-click update.
              </p>
            </div>

            <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm space-y-2">
              <div className="flex items-center gap-2 text-blue-700 font-extrabold text-xs">
                <Globe className="w-4 h-4 text-blue-600" />
                Zero Downtime Deployments
              </div>
              <p className="text-xs text-slate-600 leading-relaxed">
                Operators can safely finish active manufacturing batches before installing updates without losing work or interrupting active sessions.
              </p>
            </div>
          </div>

          {/* GitHub Commits & Deployment Stream */}
          {githubCommits.length > 0 && (
            <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5 space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="w-7 h-7 rounded-lg bg-purple-50 text-purple-600 flex items-center justify-center font-bold">
                    <Globe className="w-4 h-4" />
                  </div>
                  <div>
                    <h4 className="text-sm font-extrabold text-slate-800">GitHub Code Commits & Deployment Pushes</h4>
                    <p className="text-xs text-slate-500">Live feed of recent GitHub main branch updates ready for broadcast</p>
                  </div>
                </div>
                <span className="text-[11px] font-mono font-bold text-purple-700 bg-purple-50 border border-purple-200 px-2.5 py-0.5 rounded-full">
                  Repository: Jkaseke1/HYPER-MES
                </span>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 pt-1">
                {githubCommits.map((cmt) => (
                  <div key={cmt.sha} className="p-3 bg-slate-50 border border-slate-200 rounded-xl hover:border-teal-300 transition-all flex flex-col justify-between space-y-2">
                    <div>
                      <div className="flex items-center justify-between text-[11px] mb-1">
                        <span className="font-mono font-bold bg-slate-200 px-1.5 py-0.5 rounded text-slate-800">
                          #{cmt.shortSha}
                        </span>
                        <span className="text-slate-400 font-mono">
                          {format(new Date(cmt.date), 'dd MMM HH:mm')}
                        </span>
                      </div>
                      <p className="text-xs font-extrabold text-slate-800 line-clamp-2 leading-snug">
                        {cmt.message}
                      </p>
                      <p className="text-[10px] text-slate-500 mt-1">Author: {cmt.author}</p>
                    </div>

                    <div className="pt-2 border-t border-slate-200 flex items-center justify-between text-[11px]">
                      <span className="font-bold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200 flex items-center gap-1">
                        <CheckCircle2 className="w-3 h-3 text-emerald-600" /> Deployed to Production
                      </span>
                      <span className="text-[10px] text-slate-400">Available to Users</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* System Version Release & Audit Trail */}
          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
            <div className="p-4 border-b border-slate-200 bg-slate-50/50 flex items-center justify-between">
              <div>
                <h4 className="text-sm font-extrabold text-slate-800 flex items-center gap-2">
                  <Activity className="w-4 h-4 text-teal-600" />
                  System Version Release & Audit Trail
                </h4>
                <p className="text-xs text-slate-500">Live log of all soft update announcements and critical force pushes across branches</p>
              </div>
              <button
                onClick={loadUpdateHistory}
                className="px-3 py-1.5 bg-white border border-slate-200 hover:bg-slate-50 rounded-lg text-xs font-semibold text-slate-700 transition-colors flex items-center gap-1.5"
              >
                <RefreshCw className="w-3.5 h-3.5 text-slate-500" /> Refresh Log
              </button>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-xs text-left">
                <thead className="bg-slate-100/70 text-slate-600 font-bold uppercase tracking-wider">
                  <tr>
                    <th className="px-4 py-3">Timestamp</th>
                    <th className="px-4 py-3">Version</th>
                    <th className="px-4 py-3">Push Mode State</th>
                    <th className="px-4 py-3">Admin</th>
                    <th className="px-4 py-3">Release Details / Reason</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {updateHistory.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="px-4 py-6 text-center text-slate-400">
                        No update broadcasts recorded yet.
                      </td>
                    </tr>
                  ) : (
                    updateHistory.map((rec) => (
                      <tr key={rec.id} className="hover:bg-slate-50/80 transition-colors">
                        <td className="px-4 py-3 font-mono text-slate-500 whitespace-nowrap">
                          {format(new Date(rec.timestamp), 'dd MMM yyyy HH:mm:ss')}
                        </td>
                        <td className="px-4 py-3 font-black text-slate-800 font-mono">
                          v{rec.version}
                        </td>
                        <td className="px-4 py-3">
                          <span className={`px-2.5 py-1 text-[11px] rounded-full font-extrabold inline-flex items-center gap-1 border ${
                            rec.type === 'force_update'
                              ? 'bg-red-50 text-red-700 border-red-200'
                              : 'bg-teal-50 text-teal-700 border-teal-200'
                          }`}>
                            {rec.type === 'force_update' ? (
                              <>
                                <Zap className="w-3 h-3 text-red-600" /> Force Reload Pushed
                              </>
                            ) : (
                              <>
                                <Sparkles className="w-3 h-3 text-teal-600" /> Soft Update Banner
                              </>
                            )}
                          </span>
                        </td>
                        <td className="px-4 py-3 font-medium text-slate-700">
                          {rec.admin_email}
                        </td>
                        <td className="px-4 py-3 text-slate-800 font-medium">
                          {rec.message}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* User Edit Modal */}
      <Modal open={userModal} onClose={() => setUserModal(false)} title={`Edit User: ${selectedUser?.full_name}`} size="lg">
        <div className="space-y-6">
          {/* User Profile Section */}
          <div>
            <h3 className="text-sm font-semibold text-slate-700 mb-3 flex items-center gap-2">
              <Users className="w-4 h-4" />
              User Profile
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Full Name</label>
                <input
                  type="text"
                  value={userProfile.full_name}
                  onChange={(e) => setUserProfile({ ...userProfile, full_name: e.target.value })}
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Email</label>
                <input
                  type="email"
                  value={userProfile.email}
                  onChange={(e) => setUserProfile({ ...userProfile, email: e.target.value })}
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Phone</label>
                <input
                  type="tel"
                  value={userProfile.phone}
                  onChange={(e) => setUserProfile({ ...userProfile, phone: e.target.value })}
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Primary Role</label>
                <select
                  value={userProfile.role}
                  onChange={(e) => setUserProfile({ ...userProfile, role: e.target.value as Profile['role'] })}
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500"
                >
                  <option value="operator">Operator</option>
                  <option value="weighbridge">Weighbridge Operator</option>
                  <option value="supervisor">Supervisor</option>
                  <option value="production_manager">Production Manager</option>
                  <option value="warehouse_manager">Warehouse Manager</option>
                  <option value="raw_material_manager">Raw Materials Manager</option>
                  <option value="logistics">Logistics Officer</option>
                  <option value="finance">Finance / Accountant</option>
                  <option value="md">Managing Director (MD)</option>
                  <option value="admin">Administrator</option>
                </select>
              </div>
            </div>
          </div>

          {/* Roles Section */}
          <div>
            <h3 className="text-sm font-semibold text-slate-700 mb-3 flex items-center gap-2">
              <Shield className="w-4 h-4" />
              Assign Roles
            </h3>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
              {roles.filter(r => r.is_active).map(role => (
                <label
                  key={role.id}
                  className={`flex items-center gap-2 p-3 rounded-lg border cursor-pointer transition-colors ${
                    userRoles.includes(role.id)
                      ? 'bg-teal-50 border-teal-300'
                      : 'bg-white border-slate-200 hover:border-slate-300'
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={userRoles.includes(role.id)}
                    onChange={() => toggleUserRole(role.id)}
                    className="w-4 h-4 text-teal-600 rounded focus:ring-teal-500"
                  />
                  <div>
                    <p className="text-sm font-medium text-slate-700">{role.name}</p>
                    <p className="text-xs text-slate-500">{role.code}</p>
                  </div>
                </label>
              ))}
            </div>
          </div>

          {/* Branch Access Section */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold text-slate-700 flex items-center gap-2">
                <Building2 className="w-4 h-4" />
                Branch Access
              </h3>
              <button
                onClick={addBranchAccess}
                className="text-xs text-teal-600 hover:text-teal-700 font-medium"
              >
                + Add Branch
              </button>
            </div>
            {userBranches.length === 0 ? (
              <p className="text-sm text-slate-500 italic">No branch restrictions (access to all branches)</p>
            ) : (
              <div className="space-y-2">
                {userBranches.map((ub, idx) => (
                  <div key={idx} className="flex items-center gap-2">
                    <select
                      value={ub.branch_id}
                      onChange={(e) => updateBranchAccess(ub.branch_id, 'branch_id', e.target.value)}
                      className="flex-1 px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500/20"
                    >
                      {branches.map(b => (
                        <option key={b.id} value={b.id}>{b.name}</option>
                      ))}
                    </select>
                    <select
                      value={ub.access_level}
                      onChange={(e) => updateBranchAccess(ub.branch_id, 'access_level', e.target.value)}
                      className="w-32 px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500/20"
                    >
                      <option value="read">Read</option>
                      <option value="write">Write</option>
                      <option value="admin">Admin</option>
                    </select>
                    <button
                      onClick={() => removeBranchAccess(ub.branch_id)}
                      className="p-2 hover:bg-red-50 rounded-lg transition-colors"
                    >
                      <Trash2 className="w-4 h-4 text-red-500" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="flex justify-end gap-3 pt-4 border-t border-slate-200">
            <button
              onClick={() => setUserModal(false)}
              className="px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100 rounded-lg transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={saveUserRoles}
              disabled={saving}
              className="px-4 py-2 bg-teal-600 hover:bg-teal-700 text-white rounded-lg text-sm font-medium transition-colors disabled:opacity-50"
            >
              {saving ? 'Saving...' : 'Save Changes'}
            </button>
          </div>
        </div>
      </Modal>

      {/* Role Edit Modal */}
      <Modal open={roleModal} onClose={() => setRoleModal(false)} title={selectedRole ? `Edit Role: ${selectedRole.name}` : 'Create New Role'} size="xl">
        <div className="space-y-6">
          {/* Role Details */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Role Code</label>
              <input
                type="text"
                value={roleForm.code}
                onChange={(e) => setRoleForm({ ...roleForm, code: e.target.value })}
                disabled={!!selectedRole}
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500/20 disabled:bg-slate-50"
                placeholder="e.g., quality_manager"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Role Name</label>
              <input
                type="text"
                value={roleForm.name}
                onChange={(e) => setRoleForm({ ...roleForm, name: e.target.value })}
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500/20"
                placeholder="e.g., Quality Manager"
              />
            </div>
            <div className="col-span-2">
              <label className="block text-sm font-medium text-slate-700 mb-1">Description</label>
              <input
                type="text"
                value={roleForm.description}
                onChange={(e) => setRoleForm({ ...roleForm, description: e.target.value })}
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500/20"
                placeholder="Brief description of this role"
              />
            </div>
          </div>

          {/* Permissions */}
          <div>
            <h3 className="text-sm font-semibold text-slate-700 mb-3">Permissions</h3>
            <div className="max-h-96 overflow-y-auto space-y-4 border border-slate-200 rounded-lg p-4">
              {Object.entries(permissionsByModule).map(([module, perms]) => (
                <div key={module}>
                  <h4 className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">
                    {module.replace('_', ' ')}
                  </h4>
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                    {perms.map(perm => (
                      <label
                        key={perm.id}
                        className={`flex items-center gap-2 p-2 rounded border cursor-pointer transition-colors text-sm ${
                          rolePermissions.includes(perm.id)
                            ? 'bg-teal-50 border-teal-300'
                            : 'bg-white border-slate-200 hover:border-slate-300'
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={rolePermissions.includes(perm.id)}
                          onChange={() => toggleRolePermission(perm.id)}
                          className="w-4 h-4 text-teal-600 rounded focus:ring-teal-500"
                        />
                        <span className="text-slate-700">{perm.name}</span>
                      </label>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="flex justify-end gap-3 pt-4 border-t border-slate-200">
            <button
              onClick={() => setRoleModal(false)}
              className="px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100 rounded-lg transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={saveRole}
              disabled={saving || !roleForm.code || !roleForm.name}
              className="px-4 py-2 bg-teal-600 hover:bg-teal-700 text-white rounded-lg text-sm font-medium transition-colors disabled:opacity-50"
            >
              {saving ? 'Saving...' : selectedRole ? 'Update Role' : 'Create Role'}
            </button>
          </div>
        </div>
      </Modal>

      {/* Create User Modal */}
      <Modal open={createUserModal} onClose={() => setCreateUserModal(false)} title="Create New User" size="lg">
        <div className="space-y-6">
          {/* User Details */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Full Name *</label>
              <input
                type="text"
                value={userForm.full_name}
                onChange={(e) => setUserForm({ ...userForm, full_name: e.target.value })}
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500/20"
                placeholder="John Doe"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Email *</label>
              <input
                type="email"
                value={userForm.email}
                onChange={(e) => setUserForm({ ...userForm, email: e.target.value })}
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500/20"
                placeholder="john@example.com"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Password *</label>
              <input
                type="password"
                value={userForm.password}
                onChange={(e) => setUserForm({ ...userForm, password: e.target.value })}
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500/20"
                placeholder="••••••••"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Phone</label>
              <input
                type="tel"
                value={userForm.phone}
                onChange={(e) => setUserForm({ ...userForm, phone: e.target.value })}
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500/20"
                placeholder="+1234567890"
              />
            </div>
            <div className="col-span-2">
              <label className="block text-sm font-medium text-slate-700 mb-1">Default Role</label>
              <select
                value={userForm.role}
                onChange={(e) => setUserForm({ ...userForm, role: e.target.value as Profile['role'] })}
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500/20"
              >
                <option value="md">Managing Director (MD)</option>
                <option value="production_manager">Production Manager</option>
                <option value="warehouse_manager">Warehouse Manager</option>
                <option value="logistics">Logistics Officer</option>
                <option value="finance">Finance / Accountant</option>
                <option value="supervisor">Supervisor</option>
                <option value="operator">Operator</option>
                <option value="weighbridge">Weighbridge Operator</option>
                <option value="admin">Administrator</option>
                <option value="raw_material_manager">Raw Materials Manager</option>
              </select>
            </div>
          </div>

          {/* Roles Section */}
          <div>
            <h3 className="text-sm font-semibold text-slate-700 mb-3 flex items-center gap-2">
              <Shield className="w-4 h-4" />
              Assign Additional Roles
            </h3>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
              {roles.filter(r => r.is_active).map(role => (
                <label
                  key={role.id}
                  className={`flex items-center gap-2 p-3 rounded-lg border cursor-pointer transition-colors ${
                    userRoles.includes(role.id)
                      ? 'bg-teal-50 border-teal-300'
                      : 'bg-white border-slate-200 hover:border-slate-300'
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={userRoles.includes(role.id)}
                    onChange={() => toggleUserRole(role.id)}
                    className="w-4 h-4 text-teal-600 rounded focus:ring-teal-500"
                  />
                  <div>
                    <p className="text-sm font-medium text-slate-700">{role.name}</p>
                    <p className="text-xs text-slate-500">{role.code}</p>
                  </div>
                </label>
              ))}
            </div>
          </div>

          {/* Branch Access Section */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold text-slate-700 flex items-center gap-2">
                <Building2 className="w-4 h-4" />
                Branch Access
              </h3>
              <button
                onClick={addBranchAccess}
                className="text-xs text-teal-600 hover:text-teal-700 font-medium"
              >
                + Add Branch
              </button>
            </div>
            {userBranches.length === 0 ? (
              <p className="text-sm text-slate-500 italic">No branch restrictions (access to all branches)</p>
            ) : (
              <div className="space-y-2">
                {userBranches.map((ub, idx) => (
                  <div key={idx} className="flex items-center gap-2">
                    <select
                      value={ub.branch_id}
                      onChange={(e) => updateBranchAccess(ub.branch_id, 'branch_id', e.target.value)}
                      className="flex-1 px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500/20"
                    >
                      {branches.map(b => (
                        <option key={b.id} value={b.id}>{b.name}</option>
                      ))}
                    </select>
                    <select
                      value={ub.access_level}
                      onChange={(e) => updateBranchAccess(ub.branch_id, 'access_level', e.target.value)}
                      className="w-32 px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500/20"
                    >
                      <option value="read">Read</option>
                      <option value="write">Write</option>
                      <option value="admin">Admin</option>
                    </select>
                    <button
                      onClick={() => removeBranchAccess(ub.branch_id)}
                      className="p-2 hover:bg-red-50 rounded-lg transition-colors"
                    >
                      <Trash2 className="w-4 h-4 text-red-500" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="flex justify-end gap-3 pt-4 border-t border-slate-200">
            <button
              onClick={() => setCreateUserModal(false)}
              className="px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100 rounded-lg transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={createUser}
              disabled={saving || !userForm.email || !userForm.password || !userForm.full_name}
              className="px-4 py-2 bg-teal-600 hover:bg-teal-700 text-white rounded-lg text-sm font-medium transition-colors disabled:opacity-50"
            >
              {saving ? 'Creating...' : 'Create User'}
            </button>
          </div>
        </div>
      </Modal>

      {/* Delete User Modal */}
      <Modal open={deleteModal} onClose={() => setDeleteModal(false)} title="Delete User" size="sm">
        <div className="space-y-4">
          <div className="bg-red-50 border border-red-200 rounded-lg p-4">
            <p className="text-sm text-red-800">
              Are you sure you want to delete <strong>{userToDelete?.full_name}</strong>?
            </p>
            <p className="text-xs text-red-600 mt-2">
              This will remove the user profile and all associated roles and permissions. 
              The authentication account will remain in Supabase and needs to be deleted manually from the dashboard.
            </p>
          </div>
          
          <div className="flex justify-end gap-3">
            <button
              onClick={() => setDeleteModal(false)}
              className="px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100 rounded-lg transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={deleteUser}
              disabled={saving}
              className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg text-sm font-medium transition-colors disabled:opacity-50"
            >
              {saving ? 'Deleting...' : 'Delete User'}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
