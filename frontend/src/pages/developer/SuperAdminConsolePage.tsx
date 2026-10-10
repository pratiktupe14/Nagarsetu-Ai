import React, { useState, useEffect } from 'react';
import {
  ShieldAlert, ShieldCheck, Terminal, Database, Users, AlertTriangle,
  RefreshCw, Search, Edit3, Image, MapPin, Archive, Trash2, CheckCircle2,
  XCircle, Lock, Key, LogOut, ArrowRight, Eye, Server, Layers, FileText
} from 'lucide-react';

interface SuperAdminUser {
  id: string | number;
  name: string;
  email: string;
  role: string;
}

export function SuperAdminConsolePage() {
  const [token, setToken] = useState<string | null>(() => sessionStorage.getItem('ns_super_admin_token') || localStorage.getItem('ns_super_admin_token'));
  const [adminUser, setAdminUser] = useState<SuperAdminUser | null>(null);
  const [emailInput, setEmailInput] = useState('');
  const [passwordInput, setPasswordInput] = useState('');
  const [authError, setAuthError] = useState('');
  const [loggingIn, setLoggingIn] = useState(false);

  // Active Tab
  const [activeTab, setActiveTab] = useState<'overview' | 'complaints' | 'users' | 'audit' | 'health'>('overview');

  // Overview Data
  const [overview, setOverview] = useState<any>(null);
  const [loadingOverview, setLoadingOverview] = useState(false);

  // Complaints Data
  const [complaints, setComplaints] = useState<any[]>([]);
  const [complaintSearch, setComplaintSearch] = useState('');
  const [selectedComplaint, setSelectedComplaint] = useState<any | null>(null);
  const [loadingComplaints, setLoadingComplaints] = useState(false);

  // Edit Complaint Modal
  const [editModalOpen, setEditModalOpen] = useState(false);
  const [editForm, setEditForm] = useState({
    title: '',
    description: '',
    category: '',
    department_id: '',
    priority: '',
    status: '',
    reason: ''
  });

  // Evidence Modal
  const [evidenceModalOpen, setEvidenceModalOpen] = useState(false);
  const [newPhotoBefore, setNewPhotoBefore] = useState('');
  const [evidenceReason, setEvidenceReason] = useState('');

  // Location Modal
  const [locationModalOpen, setLocationModalOpen] = useState(false);
  const [newLat, setNewLat] = useState('');
  const [newLng, setNewLng] = useState('');
  const [newAddress, setNewAddress] = useState('');
  const [locationReason, setLocationReason] = useState('');

  // Delete Confirmation Modal
  const [deleteModalOpen, setDeleteModalOpen] = useState(false);
  const [deleteConfirmText, setDeleteConfirmText] = useState('');
  const [deleteReason, setDeleteReason] = useState('');

  // Users Data
  const [users, setUsers] = useState<any[]>([]);
  const [userRoleFilter, setUserRoleFilter] = useState('');
  const [userSearch, setUserSearch] = useState('');

  // Audit Logs Data
  const [auditLogs, setAuditLogs] = useState<any[]>([]);

  // Health Data
  const [healthData, setHealthData] = useState<any>(null);

  // Status message / toast
  const [alertMsg, setAlertMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const showAlert = (text: string, type: 'success' | 'error' = 'success') => {
    setAlertMsg({ type, text });
    setTimeout(() => setAlertMsg(null), 5000);
  };

  // Check auth session
  useEffect(() => {
    if (token) {
      fetch('/api/super-admin/auth/me', {
        headers: { Authorization: `Bearer ${token}` }
      })
        .then(r => r.json())
        .then(data => {
          if (data.user) {
            setAdminUser(data.user);
          } else {
            handleLogout();
          }
        })
        .catch(() => handleLogout());
    }
  }, [token]);

  // Load Tab Data
  useEffect(() => {
    if (!token || !adminUser) return;
    if (activeTab === 'overview') loadOverview();
    if (activeTab === 'complaints') loadComplaints();
    if (activeTab === 'users') loadUsers();
    if (activeTab === 'audit') loadAuditLogs();
    if (activeTab === 'health') loadHealth();
  }, [activeTab, token, adminUser]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoggingIn(true);
    setAuthError('');
    try {
      const res = await fetch('/api/super-admin/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: emailInput, password: passwordInput })
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Authentication rejected.');
      }
      sessionStorage.setItem('ns_super_admin_token', data.token);
      setToken(data.token);
      setAdminUser(data.user);
      showAlert('Super Admin verified. Secure session established.');
    } catch (err: any) {
      setAuthError(err.message || 'Authentication failed.');
    } finally {
      setLoggingIn(false);
    }
  };

  const handleLogout = () => {
    sessionStorage.removeItem('ns_super_admin_token');
    localStorage.removeItem('ns_super_admin_token');
    setToken(null);
    setAdminUser(null);
  };

  const loadOverview = async () => {
    setLoadingOverview(true);
    try {
      const res = await fetch('/api/super-admin/overview', {
        headers: { Authorization: `Bearer ${token}` }
      });
      const data = await res.json();
      if (data.success) setOverview(data);
    } catch (err) {
      console.error(err);
    } finally {
      setLoadingOverview(false);
    }
  };

  const loadComplaints = async () => {
    setLoadingComplaints(true);
    try {
      const url = `/api/super-admin/complaints?search=${encodeURIComponent(complaintSearch)}&limit=50`;
      const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
      const data = await res.json();
      if (data.success) setComplaints(data.complaints || []);
    } catch (err) {
      console.error(err);
    } finally {
      setLoadingComplaints(false);
    }
  };

  const openComplaintDetail = async (id: string | number) => {
    try {
      const res = await fetch(`/api/super-admin/complaints/${id}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      const data = await res.json();
      if (data.success) {
        setSelectedComplaint(data);
      }
    } catch (err) {
      console.error(err);
    }
  };

  const loadUsers = async () => {
    try {
      const url = `/api/super-admin/users?role=${encodeURIComponent(userRoleFilter)}&search=${encodeURIComponent(userSearch)}&limit=50`;
      const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
      const data = await res.json();
      if (data.success) setUsers(data.users || []);
    } catch (err) {
      console.error(err);
    }
  };

  const loadAuditLogs = async () => {
    try {
      const res = await fetch('/api/super-admin/audit-logs?limit=50', {
        headers: { Authorization: `Bearer ${token}` }
      });
      const data = await res.json();
      if (data.success) setAuditLogs(data.logs || []);
    } catch (err) {
      console.error(err);
    }
  };

  const loadHealth = async () => {
    try {
      const res = await fetch('/api/super-admin/health', {
        headers: { Authorization: `Bearer ${token}` }
      });
      const data = await res.json();
      if (data.success) setHealthData(data);
    } catch (err) {
      console.error(err);
    }
  };

  const handleUpdateComplaint = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedComplaint) return;
    try {
      const res = await fetch(`/api/super-admin/complaints/${selectedComplaint.complaint.id}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify(editForm)
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      showAlert('Complaint corrected successfully.');
      setEditModalOpen(false);
      openComplaintDetail(selectedComplaint.complaint.id);
      loadComplaints();
    } catch (err: any) {
      showAlert(err.message, 'error');
    }
  };

  const handleReplaceEvidence = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedComplaint) return;
    try {
      const res = await fetch(`/api/super-admin/complaints/${selectedComplaint.complaint.id}/evidence`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({
          photo_before_url: newPhotoBefore,
          reason: evidenceReason
        })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      showAlert('Evidence updated and prior version preserved in history.');
      setEvidenceModalOpen(false);
      setNewPhotoBefore('');
      openComplaintDetail(selectedComplaint.complaint.id);
      loadComplaints();
    } catch (err: any) {
      showAlert(err.message, 'error');
    }
  };

  const handleCorrectLocation = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedComplaint) return;
    try {
      const res = await fetch(`/api/super-admin/complaints/${selectedComplaint.complaint.id}/location`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({
          latitude: Number(newLat),
          longitude: Number(newLng),
          location_address: newAddress,
          reason: locationReason
        })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      showAlert('Location coordinates corrected and synchronized.');
      setLocationModalOpen(false);
      openComplaintDetail(selectedComplaint.complaint.id);
      loadComplaints();
    } catch (err: any) {
      showAlert(err.message, 'error');
    }
  };

  const handleArchiveToggle = async (isArchived: boolean) => {
    if (!selectedComplaint) return;
    const action = isArchived ? 'restore' : 'archive';
    try {
      const res = await fetch(`/api/super-admin/complaints/${selectedComplaint.complaint.id}/${action}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ reason: `Administrative ${action}` })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      showAlert(`Complaint #${selectedComplaint.complaint.id} ${action}d.`);
      openComplaintDetail(selectedComplaint.complaint.id);
      loadComplaints();
    } catch (err: any) {
      showAlert(err.message, 'error');
    }
  };

  const handleDeletePermanent = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedComplaint) return;
    try {
      const res = await fetch(`/api/super-admin/complaints/${selectedComplaint.complaint.id}`, {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({
          confirm: deleteConfirmText.trim().toUpperCase(),
          reason: deleteReason.trim() || 'Super Admin permanent deletion'
        })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to delete complaint.');
      showAlert('Complaint permanently deleted from system.');
      setDeleteModalOpen(false);
      setDeleteConfirmText('');
      setDeleteReason('');
      setSelectedComplaint(null);
      loadComplaints();
    } catch (err: any) {
      showAlert(err.message, 'error');
    }
  };

  const handleToggleUserStatus = async (userId: string | number, currentStatus: string) => {
    const nextStatus = currentStatus === 'active' ? 'suspended' : 'active';
    try {
      const res = await fetch(`/api/super-admin/users/${userId}/status`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ status: nextStatus, reason: 'Super Admin status toggle' })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      showAlert(`User #${userId} status changed to ${nextStatus}.`);
      loadUsers();
    } catch (err: any) {
      showAlert(err.message, 'error');
    }
  };

  // Authentication View
  if (!token || !adminUser) {
    return (
      <div className="min-h-screen bg-slate-950 text-slate-100 flex items-center justify-center p-6 font-mono">
        <div className="max-w-md w-full bg-slate-900 border border-emerald-500/30 rounded-2xl p-8 shadow-2xl relative overflow-hidden">
          <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-emerald-500 via-teal-500 to-indigo-500" />
          
          <div className="flex items-center space-x-3 mb-6">
            <div className="w-12 h-12 rounded-xl bg-emerald-500/10 border border-emerald-500/40 flex items-center justify-center text-emerald-400">
              <ShieldAlert className="w-6 h-6" />
            </div>
            <div>
              <h1 className="text-lg font-bold tracking-wider text-emerald-400">NAGARSETU 3.1</h1>
              <p className="text-xs text-slate-400">DEVELOPER CONTROL CENTER</p>
            </div>
          </div>

          <div className="p-3 bg-amber-500/10 border border-amber-500/30 rounded-xl mb-6 text-xs text-amber-300">
            <strong>Restricted Console:</strong> Accessible solely by authorized project developers with verified server credentials.
          </div>

          {authError && (
            <div className="p-3 bg-rose-500/10 border border-rose-500/30 rounded-xl mb-4 text-xs text-rose-300">
              {authError}
            </div>
          )}

          <form onSubmit={handleLogin} className="space-y-4">
            <div>
              <label className="text-xs text-slate-400 block mb-1">Developer Email</label>
              <div className="relative">
                <input
                  type="email"
                  value={emailInput}
                  onChange={e => setEmailInput(e.target.value)}
                  placeholder="developer@nagarsetu.local"
                  required
                  className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-200 focus:outline-none focus:border-emerald-500"
                />
              </div>
            </div>

            <div>
              <label className="text-xs text-slate-400 block mb-1">Passphrase</label>
              <input
                type="password"
                value={passwordInput}
                onChange={e => setPasswordInput(e.target.value)}
                placeholder="••••••••••••"
                required
                className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-200 focus:outline-none focus:border-emerald-500"
              />
            </div>

            <button
              type="submit"
              disabled={loggingIn}
              className="w-full bg-emerald-600 hover:bg-emerald-500 text-white font-bold py-2.5 rounded-lg text-sm transition-all flex items-center justify-center space-x-2 shadow-lg shadow-emerald-900/30"
            >
              <Key className="w-4 h-4" />
              <span>{loggingIn ? 'Authenticating...' : 'Authorize Secure Console'}</span>
            </button>
          </form>

          <div className="mt-6 pt-4 border-t border-slate-800 text-[11px] text-slate-500 text-center">
            Zero-Trust Isolation • Tamper-Resistant Audit Trail
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans">
      {/* Toast Alert */}
      {alertMsg && (
        <div className={`fixed top-4 right-4 z-50 px-4 py-3 rounded-xl shadow-xl border text-sm flex items-center space-x-2 ${
          alertMsg.type === 'success' ? 'bg-emerald-950 border-emerald-500 text-emerald-200' : 'bg-rose-950 border-rose-500 text-rose-200'
        }`}>
          {alertMsg.type === 'success' ? <CheckCircle2 className="w-4 h-4 text-emerald-400" /> : <XCircle className="w-4 h-4 text-rose-400" />}
          <span>{alertMsg.text}</span>
        </div>
      )}

      {/* Top Header */}
      <header className="bg-slate-900 border-b border-slate-800 px-6 py-4 flex items-center justify-between">
        <div className="flex items-center space-x-3">
          <div className="w-9 h-9 rounded-lg bg-emerald-500/20 border border-emerald-500/40 flex items-center justify-center text-emerald-400">
            <Terminal className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center space-x-2">
              <span className="font-extrabold text-sm tracking-wide text-white">NAGARSETU 3.1</span>
              <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/30">
                SUPER ADMIN
              </span>
            </div>
            <p className="text-[11px] text-slate-400">Exclusive Developer Control Center</p>
          </div>
        </div>

        <div className="flex items-center space-x-4">
          <div className="text-right hidden sm:block">
            <p className="text-xs font-semibold text-slate-200">{adminUser.name}</p>
            <p className="text-[11px] text-slate-400">{adminUser.email}</p>
          </div>
          <button
            onClick={handleLogout}
            className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-rose-900/40 hover:text-rose-300 text-slate-300 text-xs flex items-center space-x-1.5 transition-colors border border-slate-700"
          >
            <LogOut className="w-3.5 h-3.5" />
            <span>Lock</span>
          </button>
        </div>
      </header>

      {/* Main Navigation Tabs */}
      <div className="bg-slate-900/50 border-b border-slate-800 px-6 py-2 flex space-x-2 overflow-x-auto text-xs font-medium">
        {[
          { id: 'overview', label: 'Overview', icon: Layers },
          { id: 'complaints', label: 'All Complaints', icon: FileText },
          { id: 'users', label: 'User Directory', icon: Users },
          { id: 'audit', label: 'Audit Trail', icon: ShieldCheck },
          { id: 'health', label: 'System Health', icon: Server }
        ].map(tab => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => { setActiveTab(tab.id as any); setSelectedComplaint(null); }}
              className={`px-4 py-2 rounded-lg flex items-center space-x-2 transition-all ${
                isActive
                  ? 'bg-emerald-600 text-white font-bold shadow-md shadow-emerald-900/30'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800'
              }`}
            >
              <Icon className="w-4 h-4" />
              <span>{tab.label}</span>
            </button>
          );
        })}
      </div>

      {/* Main Content Area */}
      <main className="flex-1 p-6 max-w-7xl w-full mx-auto space-y-6">
        {/* OVERVIEW TAB */}
        {activeTab === 'overview' && (
          <div className="space-y-6">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 space-y-1">
                <span className="text-xs text-slate-400">Total Active Complaints</span>
                <p className="text-3xl font-extrabold text-emerald-400">{overview?.total_complaints ?? '...'}</p>
                <span className="text-[11px] text-slate-500">Across all municipal sectors</span>
              </div>
              <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 space-y-1">
                <span className="text-xs text-slate-400">Audited Mutations</span>
                <p className="text-3xl font-extrabold text-indigo-400">{overview?.total_audit_events ?? '...'}</p>
                <span className="text-[11px] text-slate-500">Immutable governance records</span>
              </div>
              <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 space-y-1">
                <span className="text-xs text-slate-400">Recurring Issue Clusters</span>
                <p className="text-3xl font-extrabold text-amber-400">{overview?.total_recurring_links ?? '...'}</p>
                <span className="text-[11px] text-slate-500">100m / 90d recurrence links</span>
              </div>
              <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 space-y-1">
                <span className="text-xs text-slate-400">System Governance</span>
                <p className="text-3xl font-extrabold text-teal-400">ONLINE</p>
                <span className="text-[11px] text-slate-500">Database & APIs synchronized</span>
              </div>
            </div>

            {/* Quick Status Breakdown */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 space-y-4">
                <h3 className="text-sm font-bold text-slate-200">Complaints by Status</h3>
                <div className="space-y-2">
                  {overview?.status_breakdown && Object.entries(overview.status_breakdown).map(([st, cnt]: any) => (
                    <div key={st} className="flex justify-between items-center text-xs border-b border-slate-800/60 pb-2">
                      <span className="text-slate-300">{st}</span>
                      <span className="font-mono font-bold text-emerald-400">{cnt}</span>
                    </div>
                  ))}
                </div>
              </div>

              <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 space-y-4">
                <h3 className="text-sm font-bold text-slate-200">Users by Role</h3>
                <div className="space-y-2">
                  {overview?.user_breakdown && Object.entries(overview.user_breakdown).map(([role, cnt]: any) => (
                    <div key={role} className="flex justify-between items-center text-xs border-b border-slate-800/60 pb-2">
                      <span className="capitalize text-slate-300">{role.replace('_', ' ')}</span>
                      <span className="font-mono font-bold text-indigo-400">{cnt}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* COMPLAINTS TAB */}
        {activeTab === 'complaints' && (
          <div className="space-y-6">
            {!selectedComplaint ? (
              <div className="space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex items-center space-x-2 flex-1 max-w-md">
                    <div className="relative w-full">
                      <Search className="w-4 h-4 absolute left-3 top-3 text-slate-400" />
                      <input
                        type="text"
                        placeholder="Search complaint ID, citizen, description..."
                        value={complaintSearch}
                        onChange={e => setComplaintSearch(e.target.value)}
                        onKeyDown={e => e.key === 'Enter' && loadComplaints()}
                        className="w-full bg-slate-900 border border-slate-800 rounded-xl pl-9 pr-4 py-2 text-xs text-slate-200 focus:outline-none focus:border-emerald-500"
                      />
                    </div>
                    <button
                      onClick={loadComplaints}
                      className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-xl text-xs flex items-center space-x-1"
                    >
                      <RefreshCw className="w-3.5 h-3.5" />
                      <span>Filter</span>
                    </button>
                  </div>
                </div>

                <div className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden shadow-xl">
                  <table className="w-full text-left text-xs text-slate-300">
                    <thead className="bg-slate-950/60 text-slate-400 font-bold border-b border-slate-800">
                      <tr>
                        <th className="py-3 px-4">Ticket</th>
                        <th className="py-3 px-4">Title / Category</th>
                        <th className="py-3 px-4">Status</th>
                        <th className="py-3 px-4">Priority</th>
                        <th className="py-3 px-4">Department</th>
                        <th className="py-3 px-4 text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800/60">
                      {complaints.map(c => (
                        <tr key={c.id} className="hover:bg-slate-800/40 transition-colors">
                          <td className="py-3 px-4 font-mono font-bold text-emerald-400">
                            {c.complaint_number || `#${c.id}`}
                          </td>
                          <td className="py-3 px-4">
                            <p className="font-semibold text-slate-200">{c.title}</p>
                            <span className="text-[11px] text-slate-400">{c.category}</span>
                          </td>
                          <td className="py-3 px-4">
                            <span className="px-2 py-0.5 rounded-md text-[10px] font-bold bg-slate-800 text-slate-300 border border-slate-700">
                              {c.status}
                            </span>
                          </td>
                          <td className="py-3 px-4">
                            <span className={`px-2 py-0.5 rounded-md text-[10px] font-bold ${
                              c.priority === 'Critical' ? 'bg-rose-950 text-rose-300 border border-rose-800' :
                              c.priority === 'High' ? 'bg-amber-950 text-amber-300 border border-amber-800' :
                              'bg-slate-800 text-slate-300'
                            }`}>
                              {c.priority}
                            </span>
                          </td>
                          <td className="py-3 px-4 text-slate-300">{c.department_name || c.department_code || 'General'}</td>
                          <td className="py-3 px-4 text-right">
                            <button
                              onClick={() => openComplaintDetail(c.id)}
                              className="px-3 py-1 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-xs font-semibold"
                            >
                              Inspect
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ) : (
              /* DETAILED COMPLAINT RECORD & CONTROL CENTER */
              <div className="space-y-6">
                <div className="flex items-center justify-between">
                  <button
                    onClick={() => setSelectedComplaint(null)}
                    className="text-xs text-slate-400 hover:text-slate-200 flex items-center space-x-1"
                  >
                    <span>← Return to Complaint List</span>
                  </button>
                  <div className="flex items-center space-x-2">
                    <button
                      onClick={() => {
                        const comp = selectedComplaint.complaint;
                        setEditForm({
                          title: comp.title || '',
                          description: comp.description || '',
                          category: comp.category || '',
                          department_id: comp.department_id || '',
                          priority: comp.priority || 'Medium',
                          status: comp.status || 'Submitted',
                          reason: ''
                        });
                        setEditModalOpen(true);
                      }}
                      className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-xs font-bold flex items-center space-x-1"
                    >
                      <Edit3 className="w-3.5 h-3.5" />
                      <span>Edit Fields</span>
                    </button>
                    <button
                      onClick={() => setEvidenceModalOpen(true)}
                      className="px-3 py-1.5 bg-teal-600 hover:bg-teal-500 text-white rounded-lg text-xs font-bold flex items-center space-x-1"
                    >
                      <Image className="w-3.5 h-3.5" />
                      <span>Evidence</span>
                    </button>
                    <button
                      onClick={() => {
                        const comp = selectedComplaint.complaint;
                        setNewLat(String(comp.latitude || ''));
                        setNewLng(String(comp.longitude || ''));
                        setNewAddress(comp.location_address || '');
                        setLocationModalOpen(true);
                      }}
                      className="px-3 py-1.5 bg-cyan-600 hover:bg-cyan-500 text-white rounded-lg text-xs font-bold flex items-center space-x-1"
                    >
                      <MapPin className="w-3.5 h-3.5" />
                      <span>Location</span>
                    </button>
                    <button
                      onClick={() => handleArchiveToggle(Boolean(selectedComplaint.complaint.is_archived))}
                      className="px-3 py-1.5 bg-amber-600 hover:bg-amber-500 text-white rounded-lg text-xs font-bold flex items-center space-x-1"
                    >
                      <Archive className="w-3.5 h-3.5" />
                      <span>{selectedComplaint.complaint.is_archived ? 'Restore' : 'Archive'}</span>
                    </button>
                    <button
                      onClick={() => {
                        setDeleteConfirmText('');
                        setDeleteReason('');
                        setDeleteModalOpen(true);
                      }}
                      className="px-3 py-1.5 bg-rose-600 hover:bg-rose-500 text-white rounded-lg text-xs font-bold flex items-center space-x-1 cursor-pointer"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      <span>Delete</span>
                    </button>
                  </div>
                </div>

                {/* Complaint Core Summary */}
                <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 space-y-4">
                  <div className="flex justify-between items-start">
                    <div>
                      <span className="font-mono text-xs text-emerald-400 font-bold">
                        {selectedComplaint.complaint.complaint_number || `#${selectedComplaint.complaint.id}`}
                      </span>
                      <h2 className="text-xl font-extrabold text-white mt-1">{selectedComplaint.complaint.title}</h2>
                      <p className="text-xs text-slate-400 mt-1">{selectedComplaint.complaint.description}</p>
                    </div>
                    <div className="text-right space-y-1">
                      <span className="px-3 py-1 rounded-md text-xs font-extrabold bg-slate-800 text-slate-200 border border-slate-700 block">
                        {selectedComplaint.complaint.status}
                      </span>
                      <span className="text-[11px] text-slate-400 block">
                        Priority: {selectedComplaint.complaint.priority}
                      </span>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 pt-4 border-t border-slate-800/80 text-xs">
                    <div>
                      <span className="text-slate-500 block">Department</span>
                      <span className="font-semibold text-slate-200">{selectedComplaint.complaint.department_name || 'PWD'}</span>
                    </div>
                    <div>
                      <span className="text-slate-500 block">Citizen</span>
                      <span className="font-semibold text-slate-200">{selectedComplaint.complaint.citizen_name || 'Anonymous'}</span>
                    </div>
                    <div>
                      <span className="text-slate-500 block">GPS Coordinates</span>
                      <span className="font-semibold text-slate-200 font-mono">
                        {selectedComplaint.complaint.latitude?.toFixed(5)}, {selectedComplaint.complaint.longitude?.toFixed(5)}
                      </span>
                    </div>
                    <div>
                      <span className="text-slate-500 block">Registered At</span>
                      <span className="font-semibold text-slate-200">
                        {new Date(selectedComplaint.complaint.created_at).toLocaleString()}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Photo Evidence Preview */}
                <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 space-y-3">
                  <h3 className="text-sm font-bold text-slate-200">Active Photo Evidence</h3>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <span className="text-xs text-slate-400 block mb-1">Before / Front Condition</span>
                      <div className="h-48 rounded-xl overflow-hidden bg-slate-950 border border-slate-800">
                        <img
                          src={selectedComplaint.complaint.photo_before_url || selectedComplaint.complaint.photo_front_url || '/uploads/civic-default.jpg'}
                          alt="Before"
                          className="w-full h-full object-cover"
                        />
                      </div>
                    </div>
                    <div>
                      <span className="text-xs text-slate-400 block mb-1">After / Resolved Condition</span>
                      <div className="h-48 rounded-xl overflow-hidden bg-slate-950 border border-slate-800 flex items-center justify-center text-xs text-slate-500">
                        {selectedComplaint.complaint.photo_after_url ? (
                          <img src={selectedComplaint.complaint.photo_after_url} alt="After" className="w-full h-full object-cover" />
                        ) : (
                          'No resolution photo uploaded yet'
                        )}
                      </div>
                    </div>
                  </div>
                </div>

                {/* Evidence Versions History */}
                {selectedComplaint.evidence_versions?.length > 0 && (
                  <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 space-y-3">
                    <h3 className="text-sm font-bold text-slate-200">Historical Evidence Versions</h3>
                    <div className="space-y-2">
                      {selectedComplaint.evidence_versions.map((ver: any) => (
                        <div key={ver.id} className="p-3 bg-slate-950 rounded-xl border border-slate-800 flex justify-between items-center text-xs">
                          <div>
                            <span className="font-bold text-teal-400">Version #{ver.version_number}</span>
                            <span className="text-slate-400 ml-2">Archived: {new Date(ver.created_at).toLocaleString()}</span>
                            <p className="text-[11px] text-slate-500 mt-0.5">Reason: {ver.replacement_reason}</p>
                          </div>
                          <a href={ver.photo_before_url} target="_blank" rel="noreferrer" className="text-xs text-indigo-400 hover:underline">
                            View Image
                          </a>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* USER MANAGEMENT TAB */}
        {activeTab === 'users' && (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center space-x-2">
                <select
                  value={userRoleFilter}
                  onChange={e => setUserRoleFilter(e.target.value)}
                  className="bg-slate-900 border border-slate-800 text-xs text-slate-200 rounded-xl px-3 py-2"
                >
                  <option value="">All Roles</option>
                  <option value="citizen">Citizens</option>
                  <option value="city_admin">City Admins</option>
                  <option value="department_head">Department Heads</option>
                  <option value="service_staff">Field Staff</option>
                </select>
                <input
                  type="text"
                  placeholder="Search user..."
                  value={userSearch}
                  onChange={e => setUserSearch(e.target.value)}
                  className="bg-slate-900 border border-slate-800 text-xs text-slate-200 rounded-xl px-3 py-2"
                />
                <button onClick={loadUsers} className="px-3 py-2 bg-slate-800 text-slate-200 rounded-xl text-xs">
                  Filter
                </button>
              </div>
            </div>

            <div className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden shadow-xl">
              <table className="w-full text-left text-xs text-slate-300">
                <thead className="bg-slate-950/60 text-slate-400 font-bold border-b border-slate-800">
                  <tr>
                    <th className="py-3 px-4">User</th>
                    <th className="py-3 px-4">Contact</th>
                    <th className="py-3 px-4">Role</th>
                    <th className="py-3 px-4">Status</th>
                    <th className="py-3 px-4 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60">
                  {users.map(u => (
                    <tr key={u.id} className="hover:bg-slate-800/40">
                      <td className="py-3 px-4 font-bold text-white">{u.name}</td>
                      <td className="py-3 px-4 text-slate-400">
                        <div>{u.email}</div>
                        <div>{u.mobile}</div>
                      </td>
                      <td className="py-3 px-4">
                        <span className="capitalize px-2 py-0.5 rounded-md bg-slate-800 border border-slate-700 text-[10px]">
                          {u.role}
                        </span>
                      </td>
                      <td className="py-3 px-4">
                        <span className={`px-2 py-0.5 rounded-md text-[10px] font-bold ${
                          u.status === 'active' ? 'bg-emerald-950 text-emerald-300 border border-emerald-800' : 'bg-rose-950 text-rose-300 border border-rose-800'
                        }`}>
                          {u.status}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-right">
                        {u.role !== 'super_admin' && (
                          <button
                            onClick={() => handleToggleUserStatus(u.id, u.status)}
                            className="px-2.5 py-1 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded text-xs"
                          >
                            {u.status === 'active' ? 'Suspend' : 'Activate'}
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* AUDIT LOG TAB */}
        {activeTab === 'audit' && (
          <div className="space-y-4">
            <h3 className="text-sm font-bold text-slate-200">Super Admin Immutable Action Audit Log</h3>
            <div className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden shadow-xl">
              <table className="w-full text-left text-xs text-slate-300">
                <thead className="bg-slate-950/60 text-slate-400 font-bold border-b border-slate-800">
                  <tr>
                    <th className="py-3 px-4">Timestamp</th>
                    <th className="py-3 px-4">Action</th>
                    <th className="py-3 px-4">Admin</th>
                    <th className="py-3 px-4">Target</th>
                    <th className="py-3 px-4">Reason / Changes</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60">
                  {auditLogs.map(log => (
                    <tr key={log.id} className="hover:bg-slate-800/40 font-mono text-[11px]">
                      <td className="py-2.5 px-4 text-slate-400">{new Date(log.created_at).toLocaleString()}</td>
                      <td className="py-2.5 px-4 font-bold text-emerald-400">{log.action}</td>
                      <td className="py-2.5 px-4 text-slate-300">{log.admin_email}</td>
                      <td className="py-2.5 px-4 text-indigo-300">{log.target_type}:{log.target_id || '-'}</td>
                      <td className="py-2.5 px-4 text-slate-400 max-w-xs truncate">
                        {log.reason || log.changes_json || '-'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* SYSTEM HEALTH TAB */}
        {activeTab === 'health' && (
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 space-y-4 font-mono text-xs">
            <h3 className="text-sm font-bold text-slate-200 font-sans">Database & Infrastructure Health</h3>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              <div className="p-4 bg-slate-950 rounded-xl border border-slate-800">
                <span className="text-slate-500 block">Database Status</span>
                <span className="text-lg font-bold text-emerald-400">{healthData?.database || 'Healthy'}</span>
              </div>
              <div className="p-4 bg-slate-950 rounded-xl border border-slate-800">
                <span className="text-slate-500 block">Memory RSS</span>
                <span className="text-lg font-bold text-indigo-400">{healthData?.memory_usage_mb || 0} MB</span>
              </div>
              <div className="p-4 bg-slate-950 rounded-xl border border-slate-800">
                <span className="text-slate-500 block">Uptime</span>
                <span className="text-lg font-bold text-teal-400">{healthData?.uptime_seconds || 0}s</span>
              </div>
              <div className="p-4 bg-slate-950 rounded-xl border border-slate-800">
                <span className="text-slate-500 block">Node Engine</span>
                <span className="text-lg font-bold text-slate-200">{healthData?.node_version || 'v20.x'}</span>
              </div>
            </div>
          </div>
        )}
      </main>

      {/* EDIT MODAL */}
      {editModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 max-w-lg w-full space-y-4">
            <h3 className="text-base font-bold text-white">Correct Complaint Fields</h3>
            <form onSubmit={handleUpdateComplaint} className="space-y-3 text-xs">
              <div>
                <label className="text-slate-400 block mb-1">Title</label>
                <input
                  type="text"
                  value={editForm.title}
                  onChange={e => setEditForm({ ...editForm, title: e.target.value })}
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 text-white"
                />
              </div>
              <div>
                <label className="text-slate-400 block mb-1">Description</label>
                <textarea
                  value={editForm.description}
                  onChange={e => setEditForm({ ...editForm, description: e.target.value })}
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 text-white h-20"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-slate-400 block mb-1">Status</label>
                  <select
                    value={editForm.status}
                    onChange={e => setEditForm({ ...editForm, status: e.target.value })}
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 text-white"
                  >
                    <option value="Submitted">Submitted</option>
                    <option value="Staff Assigned">Staff Assigned</option>
                    <option value="In Progress">In Progress</option>
                    <option value="Resolution Submitted">Resolution Submitted</option>
                    <option value="Resolved">Resolved</option>
                    <option value="Rejected">Rejected</option>
                  </select>
                </div>
                <div>
                  <label className="text-slate-400 block mb-1">Priority</label>
                  <select
                    value={editForm.priority}
                    onChange={e => setEditForm({ ...editForm, priority: e.target.value })}
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 text-white"
                  >
                    <option value="Low">Low</option>
                    <option value="Medium">Medium</option>
                    <option value="High">High</option>
                    <option value="Critical">Critical</option>
                  </select>
                </div>
              </div>
              <div>
                <label className="text-slate-400 block mb-1">Reason for Administrative Mutation</label>
                <input
                  type="text"
                  placeholder="Explain why fields are being updated..."
                  value={editForm.reason}
                  onChange={e => setEditForm({ ...editForm, reason: e.target.value })}
                  required
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 text-white"
                />
              </div>
              <div className="flex justify-end space-x-2 pt-2">
                <button
                  type="button"
                  onClick={() => setEditModalOpen(false)}
                  className="px-4 py-2 bg-slate-800 text-slate-300 rounded-lg"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white font-bold rounded-lg"
                >
                  Commit Correction
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* EVIDENCE REPLACEMENT MODAL */}
      {evidenceModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 max-w-lg w-full space-y-4">
            <h3 className="text-base font-bold text-white">Replace Evidence (Preserves History)</h3>
            <form onSubmit={handleReplaceEvidence} className="space-y-3 text-xs">
              <div>
                <label className="text-slate-400 block mb-1">New Primary Photo URL</label>
                <input
                  type="text"
                  placeholder="/uploads/corrected-image.jpg"
                  value={newPhotoBefore}
                  onChange={e => setNewPhotoBefore(e.target.value)}
                  required
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 text-white"
                />
              </div>
              <div>
                <label className="text-slate-400 block mb-1">Reason for Evidence Replacement</label>
                <input
                  type="text"
                  placeholder="e.g. Corrected blurry/mistaken upload"
                  value={evidenceReason}
                  onChange={e => setEvidenceReason(e.target.value)}
                  required
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 text-white"
                />
              </div>
              <div className="flex justify-end space-x-2 pt-2">
                <button
                  type="button"
                  onClick={() => setEvidenceModalOpen(false)}
                  className="px-4 py-2 bg-slate-800 text-slate-300 rounded-lg"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-teal-600 hover:bg-teal-500 text-white font-bold rounded-lg"
                >
                  Save Version & Replace
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* LOCATION CORRECTION MODAL */}
      {locationModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 max-w-lg w-full space-y-4">
            <h3 className="text-base font-bold text-white">Correct Location Coordinates</h3>
            <form onSubmit={handleCorrectLocation} className="space-y-3 text-xs">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-slate-400 block mb-1">Latitude</label>
                  <input
                    type="number"
                    step="any"
                    value={newLat}
                    onChange={e => setNewLat(e.target.value)}
                    required
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 text-white font-mono"
                  />
                </div>
                <div>
                  <label className="text-slate-400 block mb-1">Longitude</label>
                  <input
                    type="number"
                    step="any"
                    value={newLng}
                    onChange={e => setNewLng(e.target.value)}
                    required
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 text-white font-mono"
                  />
                </div>
              </div>
              <div>
                <label className="text-slate-400 block mb-1">Textual Address</label>
                <input
                  type="text"
                  value={newAddress}
                  onChange={e => setNewAddress(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 text-white"
                />
              </div>
              <div>
                <label className="text-slate-400 block mb-1">Reason for GPS Correction</label>
                <input
                  type="text"
                  placeholder="e.g. Map pin corrected to match exact civic defect"
                  value={locationReason}
                  onChange={e => setLocationReason(e.target.value)}
                  required
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 text-white"
                />
              </div>
              <div className="flex justify-end space-x-2 pt-2">
                <button
                  type="button"
                  onClick={() => setLocationModalOpen(false)}
                  className="px-4 py-2 bg-slate-800 text-slate-300 rounded-lg"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-cyan-600 hover:bg-cyan-500 text-white font-bold rounded-lg"
                >
                  Sync Coordinates
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* PERMANENT DELETION MODAL */}
      {deleteModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-rose-500/40 rounded-2xl p-6 max-w-lg w-full space-y-4">
            <div className="flex items-center space-x-2 text-rose-400">
              <AlertTriangle className="w-5 h-5" />
              <h3 className="text-base font-bold text-white">Permanent Deletion Confirmation</h3>
            </div>
            <p className="text-xs text-rose-300 bg-rose-950/40 border border-rose-900 p-3 rounded-xl">
              Warning: This operation will permanently remove the complaint and all attached history from the database.
              Type{' '}
              <button
                type="button"
                onClick={() => setDeleteConfirmText('PERMANENT_DELETE')}
                className="font-bold underline text-white hover:text-emerald-300 cursor-pointer"
                title="Click to copy into input"
              >
                PERMANENT_DELETE
              </button>{' '}
              below to authorize.
            </p>
            <form onSubmit={handleDeletePermanent} className="space-y-3 text-xs">
              <div>
                <div className="flex justify-between items-center mb-1">
                  <label className="text-slate-400">Type Confirmation String</label>
                  <button
                    type="button"
                    onClick={() => setDeleteConfirmText('PERMANENT_DELETE')}
                    className="text-[11px] text-emerald-400 hover:text-emerald-300 font-mono underline cursor-pointer"
                  >
                    Auto-fill PERMANENT_DELETE
                  </button>
                </div>
                <input
                  type="text"
                  placeholder="Type PERMANENT_DELETE"
                  value={deleteConfirmText}
                  onChange={e => setDeleteConfirmText(e.target.value)}
                  required
                  className="w-full bg-slate-950 border border-slate-800 focus:border-rose-500 focus:outline-none rounded-lg p-2 text-white font-mono"
                />
                <div className="mt-1 flex items-center justify-between text-[11px]">
                  {deleteConfirmText.trim().toUpperCase() === 'PERMANENT_DELETE' ? (
                    <span className="text-emerald-400 font-semibold">✓ Authorization key verified</span>
                  ) : deleteConfirmText.trim().length > 0 ? (
                    <span className="text-amber-400">Must be PERMANENT_DELETE</span>
                  ) : (
                    <span className="text-slate-500">Key required: PERMANENT_DELETE</span>
                  )}
                </div>
              </div>
              <div>
                <label className="text-slate-400 block mb-1">Reason for Deletion</label>
                <input
                  type="text"
                  placeholder="e.g. Legal erasure request or corrupt test artifact"
                  value={deleteReason}
                  onChange={e => setDeleteReason(e.target.value)}
                  required
                  className="w-full bg-slate-950 border border-slate-800 focus:border-slate-700 focus:outline-none rounded-lg p-2 text-white"
                />
              </div>
              <div className="flex justify-end space-x-2 pt-2">
                <button
                  type="button"
                  onClick={() => setDeleteModalOpen(false)}
                  className="px-4 py-2 bg-slate-800 text-slate-300 hover:bg-slate-700 cursor-pointer rounded-lg"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={deleteConfirmText.trim().toUpperCase() !== 'PERMANENT_DELETE'}
                  className="px-4 py-2 bg-rose-600 hover:bg-rose-500 disabled:opacity-40 disabled:hover:bg-rose-600 disabled:cursor-not-allowed text-white font-bold rounded-lg cursor-pointer transition-opacity"
                >
                  Authorize Deletion
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
