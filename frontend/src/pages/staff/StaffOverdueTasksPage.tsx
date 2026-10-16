import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { useLanguage } from '../../context/LanguageContext';
import { useNotification } from '../../context/NotificationContext';
import { DashboardLayout } from '../../components/DashboardLayout';
import { StatusBadge } from '../../components/StatusBadge';
import { PriorityBadge } from '../../components/PriorityBadge';
import { ActivityTimeline } from '../../components/ActivityTimeline';
import { getStaffTasks, submitStaffResolution } from '../../services/complaintService';
import { resolveDepartmentInfo } from '../../services/departmentService';
import { formatSlaRemainingTime, logActivity } from '../../services/adminService';
import { Complaint } from '../../types/database.types';
import { useRealtimeComplaints } from '../../hooks/useRealtimeComplaints';
import { getValidImageUrl, DEFAULT_CIVIC_IMAGE_PLACEHOLDER } from '../../lib/supabase';
import {
  Wrench, CheckCircle2, Clock, AlertTriangle, MapPin, Upload,
  Camera, Check, Play, Navigation, Eye, Lock, Building2,
  RefreshCw, Search, X, Calendar, FileText, ChevronRight,
  Trash2, Droplets, Waves, Zap, Activity
} from 'lucide-react';

const getDepartmentInfo = (departmentName: string) => {
  const nameLower = (departmentName || '').toLowerCase();
  if (nameLower.includes('sanitation') || nameLower.includes('waste')) {
    return {
      fullName: 'Sanitation & Waste Management',
      shortName: 'Sanitation & Waste',
      icon: Trash2,
      badgeColor: 'bg-amber-50 text-amber-800 border-amber-300',
      description: 'Garbage Collection, Overflowing Dustbins & Waste Cleanup',
      taskTypes: ['Garbage Collection', 'Dustbin Cleanup', 'Waste Removal']
    };
  }
  if (nameLower.includes('water')) {
    return {
      fullName: 'Water Supply & Sewerage',
      shortName: 'Water & Sewerage',
      icon: Droplets,
      badgeColor: 'bg-blue-50 text-blue-800 border-blue-300',
      description: 'Pipeline Maintenance, Water Leakage & Civic Water Supply',
      taskTypes: ['Pipeline Repair', 'Water Leakage', 'Water Supply Issue']
    };
  }
  if (nameLower.includes('drainage') || nameLower.includes('sewage')) {
    return {
      fullName: 'Drainage & Sewage Department',
      shortName: 'Drainage & Sewage',
      icon: Waves,
      badgeColor: 'bg-cyan-50 text-cyan-800 border-cyan-300',
      description: 'Drain Cleaning, Sewage Overflow & Underground Drainage',
      taskTypes: ['Drain Blockage', 'Sewage Overflow', 'Drain Cleaning']
    };
  }
  if (nameLower.includes('electric') || nameLower.includes('light')) {
    return {
      fullName: 'Electrical & Street Lighting',
      shortName: 'Electrical & Lighting',
      icon: Zap,
      badgeColor: 'bg-yellow-50 text-yellow-800 border-yellow-300',
      description: 'Streetlight Repair & Electrical Infrastructure Maintenance',
      taskTypes: ['Streetlight Repair', 'Electrical Maintenance', 'Cable Repair']
    };
  }
  if (nameLower.includes('traffic')) {
    return {
      fullName: 'Traffic Management Department',
      shortName: 'Traffic Management',
      icon: Activity,
      badgeColor: 'bg-purple-50 text-purple-800 border-purple-300',
      description: 'Traffic Signal Repair & Roadside Signage Infrastructure',
      taskTypes: ['Traffic Signal Repair', 'Signage Maintenance', 'Traffic Infrastructure']
    };
  }
  return {
    fullName: 'Public Works Department (PWD)',
    shortName: 'Public Works (PWD)',
    icon: Wrench,
    badgeColor: 'bg-emerald-50 text-emerald-800 border-emerald-300',
    description: 'Pothole Patching, Road Damage & Public Infrastructure Repairs',
    taskTypes: ['Pothole Repair', 'Road Maintenance', 'Infrastructure Repair']
  };
};

export const StaffOverdueTasksPage: React.FC = () => {
  const { user } = useAuth();
  const { t } = useLanguage();
  const { toast } = useNotification();

  const staffName = user?.full_name || 'Field Officer';
  const staffEmployeeId = user?.employee_id || (user?.id ? `STF-${String(user.id).slice(0, 4).toUpperCase()}` : 'STF-001');

  const resolvedDept = useMemo(
    () => resolveDepartmentInfo(user?.department_id, user?.department_name),
    [user?.department_id, user?.department_name]
  );
  const staffDepartmentFull = resolvedDept.fullName;
  const staffDepartment = resolvedDept.name;

  const deptInfo = useMemo(() => getDepartmentInfo(staffDepartmentFull), [staffDepartmentFull]);

  const [tasks, setTasks] = useState<Complaint[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filters State
  const [searchQuery, setSearchQuery] = useState('');
  const [priorityFilter, setPriorityFilter] = useState('All');
  const [categoryFilter, setCategoryFilter] = useState('All');
  const [slaFilter, setSlaFilter] = useState('All');
  const [dateFilter, setDateFilter] = useState('All');
  const [locationFilter, setLocationFilter] = useState('All');

  const [selectedTask, setSelectedTask] = useState<Complaint | null>(null);

  // Resolution proof modal state
  const [photoAfterFile, setPhotoAfterFile] = useState<File | null>(null);
  const [photoAfterPreview, setPhotoAfterPreview] = useState<string>('');
  const [workNotes, setWorkNotes] = useState('');
  const [materialsUsed, setMaterialsUsed] = useState('');
  const [progressNote, setProgressNote] = useState('');
  const [submittingResolution, setSubmittingResolution] = useState(false);
  const [submittingProgressNote, setSubmittingProgressNote] = useState(false);

  const clearAllFilters = useCallback(() => {
    setSearchQuery('');
    setPriorityFilter('All');
    setCategoryFilter('All');
    setSlaFilter('All');
    setDateFilter('All');
    setLocationFilter('All');
  }, []);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const list = await getStaffTasks(user?.id, staffDepartmentFull, user?.email, user?.full_name, user?.employee_id);
      setTasks(list);
    } catch (e) {
      console.error(e);
      setError('Unable to load tasks.');
    } finally {
      setLoading(false);
    }
  }, [user, staffDepartmentFull]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  useRealtimeComplaints(useCallback(() => {
    loadData();
  }, [loadData]));

  const now = useMemo(() => new Date(), []);

  // Filter ONLY overdue tasks
  const overdueListAll = useMemo(() => {
    return tasks.filter((t) => {
      const st = t.status as string;
      if (st === 'Resolved') return false;
      if (!t.sla_deadline) return false;
      return new Date(t.sla_deadline) < now;
    });
  }, [tasks, now]);

  const metrics = useMemo(() => {
    const totalOverdue = overdueListAll.length;
    const criticalCount = overdueListAll.filter((t) => t.priority === 'Critical').length;
    const highCount = overdueListAll.filter((t) => t.priority === 'High').length;

    return { totalOverdue, criticalCount, highCount };
  }, [overdueListAll]);

  const uniqueLocations = useMemo(() => {
    const locSet = new Set<string>();
    overdueListAll.forEach((t) => {
      if (t.location_address && t.location_address.trim()) {
        locSet.add(t.location_address.trim());
      }
    });
    return Array.from(locSet).sort();
  }, [overdueListAll]);

  const filteredTasks = useMemo(() => {
    return overdueListAll.filter((t) => {
      if (priorityFilter !== 'All' && t.priority !== priorityFilter) return false;

      if (categoryFilter !== 'All') {
        const catLower = (t.category || '').toLowerCase();
        const filtLower = categoryFilter.toLowerCase();
        if (!catLower.includes(filtLower) && !filtLower.includes(catLower)) return false;
      }

      if (dateFilter !== 'All') {
        const createdDate = new Date(t.created_at);
        const diffDays = (now.getTime() - createdDate.getTime()) / (1000 * 3600 * 24);
        if (dateFilter === 'Today' && diffDays > 1) return false;
        if (dateFilter === 'Last 7 Days' && diffDays > 7) return false;
        if (dateFilter === 'Older' && diffDays <= 7) return false;
      }

      if (locationFilter !== 'All') {
        if ((t.location_address || '').trim() !== locationFilter.trim()) return false;
      }

      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchesNum = (t.complaint_number || '').toLowerCase().includes(q);
        const matchesTitle = (t.title || '').toLowerCase().includes(q);
        const matchesCategory = (t.category || '').toLowerCase().includes(q);
        const matchesLoc = (t.location_address || '').toLowerCase().includes(q);
        const matchesDesc = (t.description || '').toLowerCase().includes(q);
        if (!matchesNum && !matchesTitle && !matchesCategory && !matchesLoc && !matchesDesc) return false;
      }

      return true;
    });
  }, [overdueListAll, priorityFilter, categoryFilter, dateFilter, locationFilter, searchQuery, now]);

  const handleAddProgressNote = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedTask || !progressNote.trim()) return;

    setSubmittingProgressNote(true);
    try {
      logActivity(
        selectedTask.id,
        staffName,
        'Field Work Progress Update',
        selectedTask.status,
        selectedTask.status,
        progressNote.trim()
      );
      setProgressNote('');
      await loadData();
    } catch (err) {
      console.error(err);
      toast.error('Unable to add progress note.');
    } finally {
      setSubmittingProgressNote(false);
    }
  };

  const handleSubmitResolutionProof = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedTask || (!photoAfterPreview && !photoAfterFile)) {
      toast.warning('Please upload or select an "AFTER" repair proof photo.');
      return;
    }

    setSubmittingResolution(true);
    try {
      const photoToSubmit = photoAfterFile || photoAfterPreview;
      await submitStaffResolution(
        selectedTask.id,
        photoToSubmit,
        workNotes || 'Field maintenance work completed.',
        materialsUsed || 'Standard repair materials & asphalt'
      );
      
      setSelectedTask(null);
      setPhotoAfterFile(null);
      setPhotoAfterPreview('');
      setWorkNotes('');
      setMaterialsUsed('');
      await loadData();
      toast.success('Task resolution proof submitted successfully! Awaiting Department Head verification.');
    } catch (err: any) {
      console.error('Task resolution submission error:', err);
      toast.error(err?.message || 'Error submitting resolution proof.');
    } finally {
      setSubmittingResolution(false);
    }
  };

  return (
    <DashboardLayout title="Overdue Tasks — Field Staff">
      <div className="p-4 sm:p-6 lg:p-8 space-y-6 max-w-[1600px] mx-auto text-gray-900 bg-white min-h-screen font-sans">
        
        {/* DEPARTMENT IDENTITY HEADER */}
        <div className="bg-slate-50 p-4 rounded-xl border border-gray-200 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-center space-x-3.5">
            <div className={`p-3 rounded-xl border ${deptInfo.badgeColor} shrink-0`}>
              <deptInfo.icon className="w-6 h-6" />
            </div>
            <div>
              <div className="flex items-center space-x-2">
                <h2 className="text-lg font-extrabold text-gray-900 font-outfit">{deptInfo.fullName}</h2>
                <span className="font-mono text-[10px] font-bold bg-white text-emerald-800 px-2 py-0.5 rounded border border-emerald-200">
                  Field Staff Portal
                </span>
              </div>
              <p className="text-xs text-gray-600 font-medium mt-0.5">{deptInfo.description}</p>
            </div>
          </div>

          <div className="flex items-center space-x-2 shrink-0 text-xs">
            <span className="font-bold text-gray-500 uppercase tracking-wider font-outfit text-[10px]">Primary Work:</span>
            <div className="flex flex-wrap gap-1">
              {deptInfo.taskTypes.map((t) => (
                <span key={t} className="px-2 py-0.5 bg-white text-gray-700 font-mono text-[10px] font-bold rounded border border-gray-200">
                  {t}
                </span>
              ))}
            </div>
          </div>
        </div>

        {/* PAGE HEADER */}
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 border-b border-gray-200 pb-5">
          <div className="space-y-1">
            <div className="flex items-center space-x-3">
              <h1 className="text-2xl sm:text-3xl font-extrabold text-gray-900 tracking-tight font-outfit">
                Overdue Tasks
              </h1>
              <span className="inline-flex items-center space-x-1 px-2.5 py-1 rounded-full text-xs font-extrabold font-mono bg-rose-50 text-rose-800 border border-rose-300">
                <deptInfo.icon className="w-3.5 h-3.5 text-rose-700" />
                <span>{deptInfo.shortName} Command</span>
              </span>
            </div>
            <p className="text-sm text-gray-600 font-medium">
              Tasks that have exceeded their SLA target and require immediate attention.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3 shrink-0">
            <div className="bg-slate-50 border border-gray-200 rounded-xl p-2.5 px-4 flex items-center space-x-4 shadow-xs">
              <div className="flex items-center space-x-2 text-xs">
                <Building2 className="w-4 h-4 text-emerald-600 shrink-0" />
                <div>
                  <div className="flex items-center space-x-1">
                    <span className="font-extrabold text-gray-900 font-outfit">{staffDepartment}</span>
                    <Lock className="w-3 h-3 text-gray-400" />
                  </div>
                  <span className="font-mono text-[10px] text-gray-500 font-bold block">{staffEmployeeId}</span>
                </div>
              </div>
            </div>

            <button
              onClick={loadData}
              disabled={loading}
              className="p-2.5 rounded-xl bg-white text-gray-700 border border-gray-300 hover:bg-gray-50 transition-colors min-h-[44px]"
              title="Refresh Overdue Tasks"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            </button>
          </div>
        </div>

        {/* OVERDUE ALERT WARNING BANNER */}
        {metrics.totalOverdue > 0 ? (
          <div className="p-4 rounded-xl bg-rose-50 border border-rose-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs">
            <div className="flex items-center space-x-3 text-rose-900">
              <AlertTriangle className="w-5 h-5 text-rose-600 shrink-0" />
              <div>
                <span className="font-extrabold font-outfit text-sm block">{t('overdueSlaAlert')}</span>
                <span className="text-rose-800">
                  You have <span className="font-mono font-extrabold">{metrics.totalOverdue}</span> {metrics.totalOverdue === 1 ? 'task that has' : 'tasks that have'} exceeded their SLA completion deadline.
                </span>
              </div>
            </div>
          </div>
        ) : (
          <div className="p-3 px-4 rounded-xl bg-emerald-50 border border-emerald-200 flex items-center space-x-2 text-xs font-bold text-emerald-900">
            <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
            <span>All Tasks Within SLA — Great work! You currently have no overdue assignments.</span>
          </div>
        )}

        {/* TOP SUMMARY CARDS */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div className="p-3.5 bg-rose-100 border border-rose-300 rounded-xl text-center">
            <span className="text-[10px] font-bold text-rose-800 uppercase tracking-wider block font-outfit">Total Overdue</span>
            <span className="text-xl font-extrabold text-rose-900 font-mono block">{metrics.totalOverdue}</span>
          </div>
          <div className="p-3.5 bg-rose-50 border border-rose-200 rounded-xl text-center">
            <span className="text-[10px] font-bold text-rose-700 uppercase tracking-wider block font-outfit">Critical</span>
            <span className="text-xl font-extrabold text-rose-800 font-mono block">{metrics.criticalCount}</span>
          </div>
          <div className="p-3.5 bg-orange-50 border border-orange-200 rounded-xl text-center">
            <span className="text-[10px] font-bold text-orange-700 uppercase tracking-wider block font-outfit">High Priority</span>
            <span className="text-xl font-extrabold text-orange-900 font-mono block">{metrics.highCount}</span>
          </div>
          <div className="p-3.5 bg-orange-50 border border-orange-200 rounded-xl text-center">
            <span className="text-[10px] font-bold text-orange-700 uppercase tracking-wider block font-outfit">SLA Breached</span>
            <span className="text-xl font-extrabold text-orange-900 font-mono block">{metrics.totalOverdue}</span>
          </div>
        </div>

        {/* SEARCH & FILTERS */}
        <div className="bg-slate-50 p-4 rounded-xl border border-gray-200 space-y-3">
          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
            <div className="relative flex-1">
              <Search className="w-4 h-4 text-gray-400 absolute left-3 top-3" />
              <input aria-label="Search complaint ID, issue, location..."
                type="text"
                placeholder="Search complaint ID, issue, location..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-9 pr-4 py-2 bg-white border border-gray-300 rounded-lg text-xs font-medium text-gray-900 focus:ring-1 focus:ring-emerald-500"
              />
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <select aria-label="priority  filter"
                value={priorityFilter}
                onChange={(e) => setPriorityFilter(e.target.value)}
                className="px-3 py-2 bg-white border border-gray-300 rounded-lg text-xs font-bold text-gray-700 focus:ring-1 focus:ring-emerald-500"
              >
                <option value="All">Priority: All</option>
                <option value="Critical">Critical</option>
                <option value="High">High</option>
                <option value="Medium">Medium</option>
                <option value="Low">Low</option>
              </select>

              <select aria-label="category  filter"
                value={categoryFilter}
                onChange={(e) => setCategoryFilter(e.target.value)}
                className="px-3 py-2 bg-white border border-gray-300 rounded-lg text-xs font-bold text-gray-700 focus:ring-1 focus:ring-emerald-500"
              >
                <option value="All">Category: All</option>
                <option value="Roads">Roads</option>
                <option value="Water">Water</option>
                <option value="Sanitation">Sanitation</option>
                <option value="Drainage">Drainage</option>
                <option value="Electrical">Electrical</option>
                <option value="Traffic">Traffic</option>
                <option value="Maintenance">Maintenance</option>
                <option value="Other">Other</option>
              </select>

              <select aria-label="date  filter"
                value={dateFilter}
                onChange={(e) => setDateFilter(e.target.value)}
                className="px-3 py-2 bg-white border border-gray-300 rounded-lg text-xs font-bold text-gray-700 focus:ring-1 focus:ring-emerald-500"
              >
                <option value="All">Date: All</option>
                <option value="Today">Today</option>
                <option value="Last 7 Days">Last 7 Days</option>
                <option value="Older">Older</option>
              </select>

              <select aria-label="location  filter"
                value={locationFilter}
                onChange={(e) => setLocationFilter(e.target.value)}
                className="px-3 py-2 bg-white border border-gray-300 rounded-lg text-xs font-bold text-gray-700 focus:ring-1 focus:ring-emerald-500 max-w-[160px] truncate"
              >
                <option value="All">Location: All</option>
                {uniqueLocations.map((loc) => (
                  <option key={loc} value={loc}>
                    {loc}
                  </option>
                ))}
              </select>

              {(searchQuery || priorityFilter !== 'All' || categoryFilter !== 'All' || dateFilter !== 'All' || locationFilter !== 'All') && (
                <button
                  type="button"
                  onClick={clearAllFilters}
                  className="px-3 py-2 bg-rose-50 border border-rose-200 text-rose-700 hover:bg-rose-100 font-extrabold text-xs rounded-lg transition-colors min-h-[36px]"
                >
                  Clear Filters
                </button>
              )}
            </div>
          </div>
        </div>

        {/* ERROR STATE */}
        {error && (
          <div className="p-6 bg-rose-50 border border-rose-200 rounded-xl text-center space-y-2">
            <AlertTriangle className="w-8 h-8 text-rose-600 mx-auto" />
            <h3 className="font-extrabold text-rose-900 text-sm font-outfit">Unable to load tasks.</h3>
            <p className="text-xs text-rose-700">Please try again.</p>
            <button
              onClick={loadData}
              className="px-4 py-2 bg-rose-600 hover:bg-rose-700 text-white font-bold text-xs rounded-lg transition-colors inline-flex items-center space-x-1"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              <span>Retry</span>
            </button>
          </div>
        )}

        {/* TASK LIST TABLE / CARDS */}
        {filteredTasks.length === 0 ? (
          <div className="p-12 text-center bg-white border border-gray-200 rounded-xl space-y-3">
            <CheckCircle2 className="w-12 h-12 text-emerald-600 mx-auto" />
            <h3 className="font-extrabold text-gray-900 text-sm font-outfit">
              {(searchQuery || priorityFilter !== 'All' || categoryFilter !== 'All' || dateFilter !== 'All' || locationFilter !== 'All')
                ? 'No Tasks Match Your Filters'
                : 'All Tasks Within SLA'}
            </h3>
            <p className="text-xs text-gray-500 max-w-md mx-auto">
              {(searchQuery || priorityFilter !== 'All' || categoryFilter !== 'All' || dateFilter !== 'All' || locationFilter !== 'All')
                ? 'Try adjusting or clearing your active search query and filter selections.'
                : 'Great work! You currently have no overdue assignments.'}
            </p>
            {(searchQuery || priorityFilter !== 'All' || categoryFilter !== 'All' || dateFilter !== 'All' || locationFilter !== 'All') && (
              <button
                type="button"
                onClick={clearAllFilters}
                className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs rounded-lg transition-colors inline-flex items-center space-x-1"
              >
                <span>Clear Filters</span>
              </button>
            )}
          </div>
        ) : (
          <>
            {/* DESKTOP TABLE */}
            <div className="hidden md:block bg-white border border-gray-200 rounded-xl overflow-hidden shadow-xs">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="bg-slate-50 border-b border-gray-200 text-[10px] font-extrabold text-gray-600 uppercase font-outfit">
                    <th className="py-3 px-3">Complaint ID</th>
                    <th className="py-3 px-3">Issue Title</th>
                    <th className="py-3 px-3">Category</th>
                    <th className="py-3 px-3">{t('priority')}</th>
                    <th className="py-3 px-3">{t('location')}</th>
                    <th className="py-3 px-3 font-mono">{t('slaDeadline')}</th>
                    <th className="py-3 px-3 font-mono">Overdue Duration</th>
                    <th className="py-3 px-3">Current Status</th>
                    <th className="py-3 px-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200 font-medium">
                  {filteredTasks.map((t) => {
                    const slaInfo = formatSlaRemainingTime(t.sla_deadline);

                    return (
                      <tr key={t.id} className="hover:bg-slate-50 bg-rose-50/40">
                        <td className="py-3 px-3 font-mono font-extrabold text-emerald-700">{t.complaint_number}</td>
                        <td className="py-3 px-3 font-bold text-gray-900">{t.title}</td>
                        <td className="py-3 px-3">
                          <span className="px-2 py-0.5 bg-slate-100 text-slate-700 font-mono text-[10px] font-bold rounded">
                            {t.category || 'Civic'}
                          </span>
                        </td>
                        <td className="py-3 px-3"><PriorityBadge priority={t.priority} /></td>
                        <td className="py-3 px-3 text-gray-700 max-w-[180px] truncate">{t.location_address}</td>
                        <td className="py-3 px-3 font-mono text-gray-600">
                          {t.sla_deadline ? new Date(t.sla_deadline).toLocaleDateString() : 'N/A'}
                        </td>
                        <td className="py-3 px-3 font-mono text-rose-700 font-bold">
                          {slaInfo.text}
                        </td>
                        <td className="py-3 px-3"><StatusBadge status={t.status} /></td>
                        <td className="py-3 px-3 text-right">
                          <div className="flex items-center justify-end space-x-2">
                            <button
                              onClick={() => setSelectedTask(t)}
                              className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-gray-800 font-bold text-xs rounded-lg transition-colors inline-flex items-center space-x-1 min-h-[36px]"
                            >
                              <Eye className="w-3.5 h-3.5 text-gray-600" />
                              <span>View Task</span>
                            </button>

                            <button
                              onClick={() => setSelectedTask(t)}
                              className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs rounded-lg transition-colors inline-flex items-center space-x-1 min-h-[36px]"
                            >
                              <Activity className="w-3.5 h-3.5" />
                              <span>Update Progress</span>
                            </button>

                            <button
                              onClick={() => setSelectedTask(t)}
                              className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs rounded-lg transition-colors inline-flex items-center space-x-1 min-h-[36px]"
                            >
                              <Wrench className="w-3.5 h-3.5" />
                              <span>Complete Task</span>
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* MOBILE CARDS */}
            <div className="block md:hidden space-y-3">
              {filteredTasks.map((t) => {
                const slaInfo = formatSlaRemainingTime(t.sla_deadline);

                return (
                  <div
                    key={t.id}
                    className="p-4 rounded-xl border border-rose-300 bg-rose-50/20 space-y-3"
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center space-x-2">
                        <span className="font-mono text-xs font-extrabold text-emerald-700">{t.complaint_number}</span>
                        <span className="px-2 py-0.5 bg-slate-100 text-slate-700 font-mono text-[10px] font-bold rounded">
                          {t.category || 'Civic'}
                        </span>
                      </div>
                      <PriorityBadge priority={t.priority} />
                    </div>

                    <div>
                      <h4 className="font-bold text-gray-900 text-xs">{t.title}</h4>
                      <p className="text-[11px] text-gray-600 mt-0.5">{t.location_address}</p>
                    </div>

                    <div className="flex items-center justify-between text-[11px] pt-2 border-t border-gray-100 font-mono">
                      <span className="text-rose-700 font-bold">
                        {slaInfo.text}
                      </span>
                      <StatusBadge status={t.status} />
                    </div>

                    <div className="flex flex-wrap gap-2 pt-2">
                      <button
                        onClick={() => setSelectedTask(t)}
                        className="flex-1 py-2 bg-slate-100 hover:bg-slate-200 text-gray-800 font-bold text-xs rounded-lg transition-colors flex items-center justify-center space-x-1 min-h-[44px]"
                      >
                        <Eye className="w-3.5 h-3.5" />
                        <span>View Task</span>
                      </button>
                      <button
                        onClick={() => setSelectedTask(t)}
                        className="flex-1 py-2 bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs rounded-lg transition-colors flex items-center justify-center space-x-1 min-h-[44px]"
                      >
                        <Activity className="w-3.5 h-3.5" />
                        <span>Update Progress</span>
                      </button>
                      <button
                        onClick={() => setSelectedTask(t)}
                        className="flex-1 py-2 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs rounded-lg transition-colors flex items-center justify-center space-x-1 min-h-[44px]"
                      >
                        <Wrench className="w-3.5 h-3.5" />
                        <span>Complete Task</span>
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        )}

        {/* WORK PROGRESS & COMPLETION PROOF MODAL */}
        {selectedTask && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-gray-900/40 backdrop-blur-xs overflow-y-auto font-sans">
            <div className="max-w-3xl w-full bg-white rounded-2xl p-6 sm:p-8 border border-gray-200 shadow-md my-8 space-y-6 max-h-[90vh] overflow-y-auto">
              <div className="flex items-start justify-between border-b border-gray-200 pb-3">
                <div className="space-y-1">
                  <div className="flex items-center space-x-2">
                    <span className="font-mono text-xs font-extrabold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-300">
                      {selectedTask.complaint_number}
                    </span>
                    <StatusBadge status={selectedTask.status} />
                    <PriorityBadge priority={selectedTask.priority} />
                  </div>
                  <h3 className="text-lg font-extrabold text-gray-900 font-outfit">{selectedTask.title}</h3>
                </div>
                <button
                  onClick={() => setSelectedTask(null)}
                  className="p-2 text-gray-400 hover:text-gray-600 rounded-lg min-h-[44px] min-w-[44px] flex items-center justify-center"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {/* PROGRESS NOTE FORM */}
              <form onSubmit={handleAddProgressNote} className="p-4 bg-slate-50 rounded-xl border border-gray-200 space-y-3 text-xs">
                <span className="font-extrabold text-gray-900 font-outfit block">Field Work Progress Log</span>
                <div className="flex gap-2">
                  <input aria-label="progress Note"
                    type="text"
                    required
                    value={progressNote}
                    onChange={(e) => setProgressNote(e.target.value)}
                    placeholder="Add field update note (e.g. Expediting repair work on site)..."
                    className="flex-1 bg-white border border-gray-300 rounded-lg p-2.5 text-xs text-gray-900"
                  />
                  <button
                    type="submit"
                    disabled={submittingProgressNote || !progressNote.trim()}
                    className="px-4 py-2.5 bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs rounded-lg min-h-[40px] disabled:opacity-50"
                  >
                    {submittingProgressNote ? 'Saving...' : 'Log Update'}
                  </button>
                </div>
              </form>

              {/* BEFORE & AFTER PHOTO EVIDENCE */}
              <div className="space-y-2 text-xs border-t border-gray-200 pt-4">
                <h4 className="font-extrabold text-gray-900 font-outfit text-sm">Complaint Photo Evidence</h4>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <span className="font-bold text-gray-700 block mb-1">BEFORE (Citizen Report - Locked)</span>
                    <div className="relative rounded-xl overflow-hidden h-44 bg-gray-100 border border-gray-200">
                      <img
                        src={getValidImageUrl(selectedTask.photo_before_url)}
                        alt="Before"
                        className="w-full h-full object-cover"
                        onError={(e) => { e.currentTarget.src = DEFAULT_CIVIC_IMAGE_PLACEHOLDER; }}
                      />
                    </div>
                  </div>

                  <div>
                    <span className="font-bold text-gray-700 block mb-1">AFTER (Resolution Proof Photo)</span>
                    {selectedTask.photo_after_url || photoAfterPreview ? (
                      <div className="relative rounded-xl overflow-hidden h-44 border border-emerald-400">
                        <img
                          src={getValidImageUrl(selectedTask.photo_after_url || photoAfterPreview)}
                          alt="Proof"
                          className="w-full h-full object-cover"
                          onError={(e) => { e.currentTarget.src = DEFAULT_CIVIC_IMAGE_PLACEHOLDER; }}
                        />
                        <button
                          type="button"
                          onClick={() => setPhotoAfterPreview('')}
                          className="absolute top-2 right-2 bg-rose-600 text-white px-2 py-1 rounded text-[10px] font-bold"
                        >
                          Change Photo
                        </button>
                      </div>
                    ) : (
                      <div className="border-2 border-dashed border-gray-300 rounded-xl p-3 text-center space-y-2 bg-gray-50/50 h-44 flex flex-col items-center justify-center">
                        <span className="text-[11px] font-bold text-gray-700 block">Capture or Select Evidence Photo</span>
                        
                        <div className="flex flex-col sm:flex-row gap-2 w-full max-w-xs">
                          <input
                            type="file"
                            accept="image/*"
                            capture="environment"
                            id="staff-overdue-camera-input"
                            className="hidden"
                            onChange={(e) => {
                              if (e.target.files && e.target.files[0]) {
                                setPhotoAfterFile(e.target.files[0]);
                                setPhotoAfterPreview(URL.createObjectURL(e.target.files[0]));
                              }
                            }}
                          />
                          <label
                            htmlFor="staff-overdue-camera-input"
                            className="flex-1 px-2.5 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs cursor-pointer min-h-[40px] flex items-center justify-center space-x-1 shadow-xs"
                          >
                            <Camera className="w-3.5 h-3.5" />
                            <span>Take Photo</span>
                          </label>

                          <input
                            type="file"
                            accept="image/*"
                            id="staff-overdue-gallery-input"
                            className="hidden"
                            onChange={(e) => {
                              if (e.target.files && e.target.files[0]) {
                                setPhotoAfterFile(e.target.files[0]);
                                setPhotoAfterPreview(URL.createObjectURL(e.target.files[0]));
                              }
                            }}
                          />
                          <label
                            htmlFor="staff-overdue-gallery-input"
                            className="flex-1 px-2.5 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs cursor-pointer min-h-[40px] flex items-center justify-center space-x-1 shadow-xs"
                          >
                            <Upload className="w-3.5 h-3.5" />
                            <span>From Gallery</span>
                          </label>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* COMPLETE TASK FORM */}
              <form onSubmit={handleSubmitResolutionProof} className="space-y-4 pt-2 border-t border-gray-200 text-xs">
                <h4 className="font-extrabold text-gray-900 font-outfit text-sm">Resolution Details & Proof Submission</h4>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block font-bold text-gray-700 mb-1">Work Resolution Notes *</label>
                    <input aria-label="work Notes"
                      type="text"
                      required
                      value={workNotes}
                      onChange={(e) => setWorkNotes(e.target.value)}
                      placeholder="e.g. Completed asphalt patching and road compaction."
                      className="w-full bg-white border border-gray-300 rounded-lg p-2.5 text-xs text-gray-900"
                    />
                  </div>

                  <div>
                    <label className="block font-bold text-gray-700 mb-1">Materials / Equipment Used</label>
                    <input aria-label="materials Used"
                      type="text"
                      value={materialsUsed}
                      onChange={(e) => setMaterialsUsed(e.target.value)}
                      placeholder="e.g. 50kg asphalt emulsion, roller compactor."
                      className="w-full bg-white border border-gray-300 rounded-lg p-2.5 text-xs text-gray-900"
                    />
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={submittingResolution || (!photoAfterPreview && !selectedTask.photo_after_url)}
                  className="w-full py-3 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-extrabold text-xs uppercase tracking-wider shadow-sm flex items-center justify-center space-x-1.5 min-h-[44px] disabled:opacity-50"
                >
                  <CheckCircle2 className="w-5 h-5" />
                  <span>{submittingResolution ? 'Submitting Proof...' : 'Mark Work Completed (Send for Admin Verification)'}</span>
                </button>
              </form>

              <div className="pt-3 border-t border-gray-200">
                <ActivityTimeline complaintId={selectedTask.id} />
              </div>
            </div>
          </div>
        )}

      </div>
    </DashboardLayout>
  );
};
