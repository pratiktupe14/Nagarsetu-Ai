import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useLocation, Link, useNavigate } from 'react-router-dom';
import { MapContainer, TileLayer, Marker, Popup } from 'react-leaflet';
import L from 'leaflet';
import { useAuth } from '../../context/AuthContext';
import { useLanguage } from '../../context/LanguageContext';
import { useNotification } from '../../context/NotificationContext';
import { DashboardLayout } from '../../components/DashboardLayout';
import { StatusBadge } from '../../components/StatusBadge';
import { PriorityBadge } from '../../components/PriorityBadge';
import { ActivityTimeline } from '../../components/ActivityTimeline';
import { CitizenFeedbackCard } from '../../components/CitizenFeedbackCard';
import {
  getStaffTasks, acceptStaffTask, startStaffTravel, startStaffWork,
  submitStaffResolution
} from '../../services/complaintService';
import { resolveDepartmentInfo } from '../../services/departmentService';
import { formatSlaRemainingTime, logActivity, fetchComplaintActivityLogs } from '../../services/adminService';
import { getNotificationsForRole, syncNotificationsFromBackend, markNotificationAsRead } from '../../services/notificationService';
import { Complaint, ComplaintStatus, NotificationItem, ComplaintActivityLog, extractComplaintAnglePhotos } from '../../types/database.types';
import { useRealtimeComplaints } from '../../hooks/useRealtimeComplaints';
import { getValidImageUrl, DEFAULT_CIVIC_IMAGE_PLACEHOLDER } from '../../lib/supabase';
import { resolveMediaUrl } from '../../utils/mediaUtils';
import { formatPortalDateTime, formatPortalTime, formatPortalDate } from '../../utils/dateUtils';
import { openGoogleMapsDirections } from '../../utils/navigation';
import {
  Wrench, CheckCircle2, Clock, AlertTriangle, MapPin, Upload,
  Camera, Check, Play, Navigation, Eye, UserCheck, ShieldCheck, Zap, X,
  Search, Lock, Building2, User, RefreshCw, FileText, ChevronRight,
  MessageSquarePlus, Star, ArrowRight, Map, Bell, Sliders, Calendar,
  TrendingUp, Award, Activity, Droplets, Trash2, Waves
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
  if (nameLower.includes('maintenance')) {
    return {
      fullName: 'Maintenance Department',
      shortName: 'Maintenance',
      icon: Wrench,
      badgeColor: 'bg-slate-50 text-slate-800 border-slate-300',
      description: 'Building Repairs & General Municipal Infrastructure Maintenance',
      taskTypes: ['Building Repair', 'Infrastructure Repair', 'General Maintenance']
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

// Fix standard Leaflet marker icon asset issue
delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
});

const createStatusMarkerIcon = (status: ComplaintStatus, isOverdue: boolean = false) => {
  let color = '#0284c7';
  if (status === 'Accepted' || status === 'On the Way' || status === 'In Progress') color = '#d97706';
  else if (status === 'Resolution Submitted' || status === 'Resolved') color = '#059669';
  if (isOverdue && status !== 'Resolved') color = '#e11d48';

  return L.divIcon({
    className: 'custom-staff-preview-marker',
    html: `
      <div style="background-color:${color}; width:18px; height:18px; border-radius:50%; border:2px solid #ffffff; box-shadow:0 2px 4px rgba(0,0,0,0.3);"></div>
    `,
    iconSize: [18, 18],
    iconAnchor: [9, 9]
  });
};

export const StaffPortal: React.FC = () => {
  const { user } = useAuth();
  const { t, lang, changeLanguage, translateCategory, translateStatus, translatePriority, translateDepartment } = useLanguage();
  const { toast } = useNotification();
  const location = useLocation();
  const navigate = useNavigate();

  // Route View Mode
  const currentPath = location.pathname;
  const isDashboardView = currentPath === '/staff/portal';
  const isNewPage = currentPath === '/staff/tasks/new';
  const isInProgressPage = currentPath === '/staff/tasks/in-progress';
  const isOverduePage = currentPath === '/staff/tasks/overdue';
  const isCompletedPage = currentPath === '/staff/tasks/completed';
  const isProfilePage = currentPath === '/staff/profile';

  // Department-wise & Staff-specific identity
  const staffName = user?.full_name || 'Field Officer';
  const staffEmployeeId = user?.employee_id || (user?.id ? `STF-${String(user.id).slice(0, 4).toUpperCase()}` : 'STF-001');

  const resolvedDept = useMemo(
    () => resolveDepartmentInfo(user?.department_id, user?.department_name),
    [user?.department_id, user?.department_name]
  );
  const staffDepartmentFull = resolvedDept.fullName;
  const staffDepartment = resolvedDept.name;
  const staffRole = 'Field Service Officer';

  const deptInfo = useMemo(() => getDepartmentInfo(staffDepartmentFull), [staffDepartmentFull]);

  const [tasks, setTasks] = useState<Complaint[]>([]);
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filters State for Task List View
  const [activeTab, setActiveTab] = useState<'All' | 'New' | 'Accepted' | 'In Progress' | 'Due Soon' | 'Overdue' | 'Completed'>('All');
  const [searchQuery, setSearchQuery] = useState('');
  const [priorityFilter, setPriorityFilter] = useState('All');
  const [categoryFilter, setCategoryFilter] = useState('All');
  const [slaFilter, setSlaFilter] = useState('All');
  const [dateFilter, setDateFilter] = useState('All');
  const [locationFilter, setLocationFilter] = useState('All');
  const [metricFilter, setMetricFilter] = useState<'All' | 'High' | 'Critical' | 'DueToday'>('All');

  const clearAllFilters = useCallback(() => {
    setSearchQuery('');
    setPriorityFilter('All');
    setCategoryFilter('All');
    setSlaFilter('All');
    setDateFilter('All');
    setLocationFilter('All');
    setMetricFilter('All');
  }, []);

  // Selected Task Modal State
  const [selectedTask, setSelectedTask] = useState<Complaint | null>(null);

  // Progress Update & Resolution State
  const [progressNote, setProgressNote] = useState('');
  const [submittingProgressNote, setSubmittingProgressNote] = useState(false);
  const [photoAfterFile, setPhotoAfterFile] = useState<File | null>(null);
  const [photoAfterPreview, setPhotoAfterPreview] = useState<string>('');
  const [workNotes, setWorkNotes] = useState('');
  const [materialsUsed, setMaterialsUsed] = useState('');
  const [submittingResolution, setSubmittingResolution] = useState(false);
  const [recentActivities, setRecentActivities] = useState<ComplaintActivityLog[]>([]);

  // Auto-set default activeTab based on sub-route
  useEffect(() => {
    if (isNewPage) setActiveTab('New');
    else if (isInProgressPage) setActiveTab('In Progress');
    else if (isOverduePage) setActiveTab('Overdue');
    else if (isCompletedPage) setActiveTab('Completed');
    else setActiveTab('All');
  }, [isNewPage, isInProgressPage, isOverduePage, isCompletedPage]);

  // Load Staff-Specific & Department-Specific Tasks and Notifications
  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const list = await getStaffTasks(user?.id, staffDepartmentFull, user?.email, user?.full_name, user?.employee_id);
      setTasks(list);

      const notifs = await syncNotificationsFromBackend().catch(() => getNotificationsForRole(user?.id, 'service_staff'));
      setNotifications(notifs);

      if (list.length > 0) {
        fetchComplaintActivityLogs(list[0].id)
          .then((logs) => setRecentActivities(logs.slice(0, 4)))
          .catch(() => setRecentActivities([]));
      } else {
        setRecentActivities([]);
      }
    } catch (e) {
      console.error(e);
      setError('Unable to load dashboard data.');
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

  const now = new Date();

  // Greeting Time of Day
  const greetingTime = useMemo(() => {
    const hrs = now.getHours();
    if (hrs < 12) return t('goodMorning');
    if (hrs < 17) return t('goodAfternoon');
    return t('goodEvening');
  }, [now, t]);

  // Date String
  const currentDateFormatted = useMemo(() => {
    const locale = lang === 'hi' ? 'hi-IN' : lang === 'mr' ? 'mr-IN' : 'en-IN';
    return now.toLocaleDateString(locale, { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' });
  }, [now, lang]);

  // TASK SUMMARY METRICS
  const metrics = useMemo(() => {
    const total = tasks.length;
    const newTasks = tasks.filter((t) => {
      const s = String(t.status || '').toLowerCase().trim();
      return s === 'department assigned' || s === 'staff assigned' || s === 'assigned' || s === 'staff_assigned';
    }).length;
    const activeTasks = tasks.filter((t) => t.status === 'Accepted' || t.status === 'On the Way' || t.status === 'In Progress').length;
    
    const criticalCount = tasks.filter((t) => t.priority === 'Critical').length;
    const highCount = tasks.filter((t) => t.priority === 'High').length;

    const dueSoon = tasks.filter((t) => {
      if (t.status === 'Resolved') return false;
      if (!t.sla_deadline) return false;
      const diffMs = new Date(t.sla_deadline).getTime() - now.getTime();
      return diffMs > 0 && diffMs <= 2 * 3600000;
    }).length;

    const overdueTasksList = tasks.filter((t) => {
      if (t.status === 'Resolved') return false;
      if (!t.sla_deadline) return false;
      return new Date(t.sla_deadline) < now;
    });

    const overdueCount = overdueTasksList.length;
    const completed = tasks.filter((t) => t.status === 'Resolution Submitted' || t.status === 'Resolved').length;

    // SLA Compliance %
    const completedWithinSla = tasks.filter((t) => {
      if (t.status !== 'Resolved' && t.status !== 'Resolution Submitted') return false;
      if (!t.sla_deadline || !t.updated_at) return true;
      return new Date(t.updated_at) <= new Date(t.sla_deadline);
    }).length;

    const slaCompliancePercent = completed > 0 ? Math.round((completedWithinSla / completed) * 100) : 94;

    return {
      total,
      newTasks,
      activeTasks,
      criticalCount,
      highCount,
      dueSoon,
      overdueCount,
      overdueTasksList,
      completed,
      slaCompliancePercent
    };
  }, [tasks, now]);

  // PRIORITY TASKS (Sorted: Critical -> High -> Due Soon -> Overdue)
  const priorityTasksList = useMemo(() => {
    const activeOnly = tasks.filter((t) => t.status !== 'Resolved');
    return activeOnly.sort((a, b) => {
      const priorityOrder: Record<string, number> = { Critical: 1, High: 2, Medium: 3, Low: 4 };
      const pA = priorityOrder[a.priority] || 5;
      const pB = priorityOrder[b.priority] || 5;
      if (pA !== pB) return pA - pB;
      const timeA = a.sla_deadline ? new Date(a.sla_deadline).getTime() : 0;
      const timeB = b.sla_deadline ? new Date(b.sla_deadline).getTime() : 0;
      return timeA - timeB;
    }).slice(0, 4);
  }, [tasks]);

  // ACTIVE TASKS FOR DASHBOARD
  const activeTasksList = useMemo(() => {
    return tasks.filter((t) => t.status === 'Accepted' || t.status === 'On the Way' || t.status === 'In Progress').slice(0, 4);
  }, [tasks]);

  // NEW ASSIGNMENTS FOR DASHBOARD & METRICS
  const newAssignmentsListAll = useMemo(() => {
    return tasks.filter((t) => {
      const s = String(t.status || '').toLowerCase().trim();
      return s === 'department assigned' || s === 'staff assigned' || s === 'assigned' || s === 'staff_assigned';
    });
  }, [tasks]);

  const newAssignmentsList = useMemo(() => {
    return newAssignmentsListAll.slice(0, 4);
  }, [newAssignmentsListAll]);

  const newMetrics = useMemo(() => {
    const totalNew = newAssignmentsListAll.length;
    const highCount = newAssignmentsListAll.filter((t) => t.priority === 'High').length;
    const criticalCount = newAssignmentsListAll.filter((t) => t.priority === 'Critical').length;
    const dueTodayCount = newAssignmentsListAll.filter((t) => {
      if (!t.sla_deadline) return false;
      const d = new Date(t.sla_deadline);
      const today = new Date();
      return (
        d.getDate() === today.getDate() &&
        d.getMonth() === today.getMonth() &&
        d.getFullYear() === today.getFullYear()
      );
    }).length;

    return { totalNew, highCount, criticalCount, dueTodayCount };
  }, [newAssignmentsListAll]);

  // UNIQUE LOCATIONS FROM REAL RETURNED TASK DATA
  const uniqueLocations = useMemo(() => {
    const locSet = new Set<string>();
    tasks.forEach((t) => {
      if (t.location_address && t.location_address.trim()) {
        locSet.add(t.location_address.trim());
      }
    });
    return Array.from(locSet).sort();
  }, [tasks]);

  // TASKS WITH VALID GPS FOR MAP PREVIEW
  const mapPreviewTasks = useMemo(() => {
    return tasks.filter(
      (t) => typeof t.latitude === 'number' && typeof t.longitude === 'number' && t.latitude !== 0 && t.longitude !== 0
    );
  }, [tasks]);


  // FILTERED TASKS FOR LIST VIEW
  const filteredTasks = useMemo(() => {
    return tasks.filter((t) => {
      const st = t.status as string;

      // 1. Route Specific Pre-filtering
      if (isNewPage && !(st === 'Department Assigned' || st === 'Staff Assigned' || st === 'ASSIGNED')) return false;
      if (isInProgressPage && !(st === 'Accepted' || st === 'On the Way' || st === 'In Progress')) return false;
      if (isOverduePage && (st === 'Resolved' || !t.sla_deadline || new Date(t.sla_deadline) >= now)) return false;
      if (isCompletedPage && !(st === 'Resolution Submitted' || st === 'Resolved')) return false;

      // 2. Interactive Metric Card Selection Filter (when user clicks summary cards on /staff/tasks/new)
      if (isNewPage && metricFilter !== 'All') {
        if (metricFilter === 'High' && t.priority !== 'High') return false;
        if (metricFilter === 'Critical' && t.priority !== 'Critical') return false;
        if (metricFilter === 'DueToday') {
          if (!t.sla_deadline) return false;
          const d = new Date(t.sla_deadline);
          const today = new Date();
          const isToday = (
            d.getDate() === today.getDate() &&
            d.getMonth() === today.getMonth() &&
            d.getFullYear() === today.getFullYear()
          );
          if (!isToday) return false;
        }
      }

      // 3. Tab Filter
      if (!isNewPage && !isInProgressPage && !isOverduePage && !isCompletedPage && !isDashboardView) {
        if (activeTab === 'New' && !(st === 'Department Assigned' || st === 'Staff Assigned' || st === 'ASSIGNED')) return false;
        if (activeTab === 'Accepted' && st !== 'Accepted') return false;
        if (activeTab === 'In Progress' && !(st === 'In Progress' || st === 'On the Way')) return false;
        if (activeTab === 'Completed' && !(st === 'Resolution Submitted' || st === 'Resolved')) return false;
        
        if (activeTab === 'Due Soon') {
          if (st === 'Resolved' || !t.sla_deadline) return false;
          const diffMs = new Date(t.sla_deadline).getTime() - now.getTime();
          if (diffMs <= 0 || diffMs > 2 * 3600000) return false;
        }

        if (activeTab === 'Overdue') {
          if (st === 'Resolved' || !t.sla_deadline || new Date(t.sla_deadline) >= now) return false;
        }
      }

      // 4. Priority Filter
      if (priorityFilter !== 'All' && t.priority !== priorityFilter) return false;

      // 5. Category Filter
      if (categoryFilter !== 'All') {
        const catLower = (t.category || '').toLowerCase();
        const filtLower = categoryFilter.toLowerCase();
        if (!catLower.includes(filtLower) && !filtLower.includes(catLower)) return false;
      }

      // 6. SLA Filter
      if (slaFilter !== 'All') {
        if (!t.sla_deadline) return false;
        const diffMs = new Date(t.sla_deadline).getTime() - now.getTime();
        const d = new Date(t.sla_deadline);
        const today = new Date();
        const isToday = (
          d.getDate() === today.getDate() &&
          d.getMonth() === today.getMonth() &&
          d.getFullYear() === today.getFullYear()
        );

        if (slaFilter === 'Due Today' && !isToday) return false;
        if (slaFilter === 'Due Soon' && (diffMs <= 0 || diffMs > 2 * 3600000)) return false;
        if (slaFilter === 'Within SLA' && diffMs <= 0) return false;
        if (slaFilter === 'Overdue' && diffMs > 0) return false;
      }

      // 7. Date Filter
      if (dateFilter !== 'All') {
        const createdDate = new Date(t.created_at);
        const diffDays = (now.getTime() - createdDate.getTime()) / (1000 * 3600 * 24);
        if (dateFilter === 'Today' && diffDays > 1) return false;
        if (dateFilter === 'Last 7 Days' && diffDays > 7) return false;
        if (dateFilter === 'Older' && diffDays <= 7) return false;
      }

      // 8. Location Filter
      if (locationFilter !== 'All') {
        if ((t.location_address || '').trim() !== locationFilter.trim()) return false;
      }

      // 9. Search Query
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
  }, [tasks, isNewPage, isInProgressPage, isOverduePage, isCompletedPage, isDashboardView, activeTab, priorityFilter, categoryFilter, slaFilter, dateFilter, locationFilter, metricFilter, searchQuery, now]);

  // WORKFLOW TRANSITION HANDLERS
  const handleStatusTransition = async (taskId: string, newStatus: ComplaintStatus) => {
    try {
      if (newStatus === 'Accepted') await acceptStaffTask(taskId);
      else if (newStatus === 'On the Way') await startStaffTravel(taskId);
      else if (newStatus === 'In Progress') await startStaffWork(taskId);

      await loadData();
      const updatedList = await getStaffTasks(user?.id || 'staff-101', staffDepartmentFull);
      setSelectedTask(updatedList.find((t) => String(t.id) === String(taskId) || t.complaint_number === taskId) || null);
    } catch (err) {
      console.error(err);
      toast.error('Unable to update task status. Please try again.');
    }
  };

  // ADD FIELD PROGRESS NOTE
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
      const updatedList = await getStaffTasks(user?.id || 'staff-101', staffDepartmentFull);
      setSelectedTask(updatedList.find((t) => t.id === selectedTask.id) || null);
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
    <DashboardLayout title={isDashboardView ? t('dashboard') : t('myTasks')}>
      <div className="p-4 sm:p-6 lg:p-8 space-y-6 max-w-[1600px] mx-auto text-gray-900 bg-white min-h-screen font-sans">
        
        {/* ================================================== */}
        {/* DEPARTMENT HEADER CARD (DYNAMIC BY SUPABASE) */}
        {/* ================================================== */}
        <div className="bg-slate-50 p-4 rounded-xl border border-gray-200 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-center space-x-3.5">
            <div className={`p-3 rounded-xl border ${deptInfo.badgeColor} shrink-0`}>
              <deptInfo.icon className="w-6 h-6" />
            </div>
            <div>
              <div className="flex items-center space-x-2">
                <h2 className="text-lg font-extrabold text-gray-900 font-outfit">{translateDepartment(deptInfo.fullName)}</h2>
                <span className="font-mono text-[10px] font-bold bg-white text-emerald-800 px-2 py-0.5 rounded border border-emerald-200">
                  {t('fieldStaffPortal')}
                </span>
              </div>
              <p className="text-xs text-gray-600 font-medium mt-0.5">{deptInfo.description}</p>
            </div>
          </div>

          <div className="flex items-center space-x-2 shrink-0 text-xs">
            <span className="font-bold text-gray-500 uppercase tracking-wider font-outfit text-[10px]">{t('primaryWork')}</span>
            <div className="flex flex-wrap gap-1">
              {deptInfo.taskTypes.map((tItem) => (
                <span key={tItem} className="px-2 py-0.5 bg-white text-gray-700 font-mono text-[10px] font-bold rounded border border-gray-200">
                  {tItem}
                </span>
              ))}
            </div>
          </div>
        </div>

        {/* ================================================== */}
        {/* 2, 3. STAFF GREETING & PAGE HEADER */}
        {/* ================================================== */}
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 border-b border-gray-200 pb-5">
          <div className="space-y-1">
            <div className="flex items-center space-x-3">
              <h1 className="text-2xl sm:text-3xl font-extrabold text-gray-900 tracking-tight font-outfit">
                {isProfilePage ? t('profile') : t('myTasks')}
              </h1>
              <span className="inline-flex items-center space-x-1 px-2.5 py-1 rounded-full text-xs font-extrabold font-mono bg-emerald-50 text-emerald-800 border border-emerald-300">
                <deptInfo.icon className="w-3.5 h-3.5 text-emerald-700" />
                <span>{deptInfo.shortName}</span>
              </span>
            </div>
            <p className="text-sm text-gray-600 font-medium">
              {isProfilePage
                ? 'Your authenticated municipal staff identity and department credentials.'
                : `${greetingTime}! Here is your field work overview and priority assignments.`}
            </p>
          </div>

          {/* LOCKED IDENTITY & DATE BADGE */}
          <div className="flex flex-wrap items-center gap-3 shrink-0">
            <div className="bg-slate-50 border border-gray-200 rounded-xl p-2.5 px-4 flex items-center space-x-4 shadow-xs">
              <div className="flex items-center space-x-2 text-xs">
                <Building2 className="w-4 h-4 text-emerald-600 shrink-0" />
                <div>
                  <div className="flex items-center space-x-1">
                    <span className="font-extrabold text-gray-900 font-outfit">{translateDepartment(staffDepartment)}</span>
                    <Lock className="w-3 h-3 text-gray-400" />
                  </div>
                  <span className="font-mono text-[10px] text-gray-500 font-bold block">{staffEmployeeId}</span>
                </div>
              </div>

              <div className="h-6 w-px bg-gray-200" />

              <div className="flex items-center space-x-2 text-xs">
                <Calendar className="w-4 h-4 text-emerald-600 shrink-0" />
                <div>
                  <span className="font-mono font-extrabold text-gray-900 block">{currentDateFormatted}</span>
                  <span className="text-[10px] text-gray-500 font-medium block">{t('today')}</span>
                </div>
              </div>
            </div>

            <button
              onClick={loadData}
              disabled={loading}
              className="p-2.5 rounded-xl bg-white text-gray-700 border border-gray-300 hover:bg-gray-50 transition-colors min-h-[44px]"
              title="Refresh Dashboard"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            </button>
          </div>
        </div>

        {isProfilePage ? (
          <div className="max-w-3xl mx-auto space-y-6">
            <div className="bg-white p-6 rounded-xl border border-gray-200 space-y-6">
              <div className="flex items-center space-x-4 pb-4 border-b border-gray-200">
                <div className="w-16 h-16 rounded-full bg-emerald-100 text-emerald-800 font-extrabold text-2xl flex items-center justify-center font-outfit border-2 border-emerald-500 shrink-0">
                  {staffName.charAt(0)}
                </div>
                <div>
                  <h2 className="text-xl font-extrabold text-gray-900 font-outfit">{staffName}</h2>
                  <span className="text-xs font-bold text-emerald-700 block">{staffRole}</span>
                  <span className="font-mono text-xs text-gray-500 block">ID: {staffEmployeeId}</span>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
                <div className="p-3 bg-slate-50 rounded-xl border border-gray-200 space-y-1">
                  <span className="font-mono text-gray-500 text-[10px] block uppercase font-bold">Official Email</span>
                  <span className="font-extrabold text-gray-900 block">{user?.email || 'N/A'}</span>
                </div>

                <div className="p-3 bg-slate-50 rounded-xl border border-gray-200 space-y-1">
                  <span className="font-mono text-gray-500 text-[10px] block uppercase font-bold">Assigned Department</span>
                  <div className="flex items-center space-x-1">
                    <span className="font-extrabold text-emerald-800">{staffDepartmentFull}</span>
                    <Lock className="w-3 h-3 text-gray-400" />
                  </div>
                </div>

                <div className="p-3 bg-slate-50 rounded-xl border border-gray-200 space-y-1">
                  <span className="font-mono text-gray-500 text-[10px] block uppercase font-bold">Operational Scope</span>
                  <span className="font-extrabold text-gray-900 block">Field Staff (Field Operations)</span>
                </div>

                <div className="p-3 bg-slate-50 rounded-xl border border-gray-200 space-y-1">
                  <span className="font-mono text-gray-500 text-[10px] block uppercase font-bold">Account Verification</span>
                  <span className="font-extrabold text-emerald-700 block">Active & Verified Municipal Employee</span>
                </div>
              </div>

              <div className="p-4 rounded-xl bg-slate-50 border border-gray-200 text-xs space-y-2">
                <div className="flex items-center space-x-2 text-gray-700">
                  <Lock className="w-4 h-4 text-gray-400 shrink-0" />
                  <span className="font-bold">Security Notice:</span>
                </div>
                <p className="text-gray-600">
                  Department assignment and role permissions are set by City Administration. Contact your Department Manager or City Administration to request role or department transfers.
                </p>
              </div>
            </div>
          </div>
        ) : (
          <div className="space-y-6">
        {/* ================================================== */}
        {/* 4. TODAY'S WORK SUMMARY METRIC TILES */}
        {/* ================================================== */}
        <div className="grid grid-cols-2 sm:grid-cols-5 border border-gray-200 rounded-xl divide-x divide-y sm:divide-y-0 divide-gray-200 bg-white shadow-xs overflow-hidden">
          
          <Link to="/staff/tasks/new" className="p-3.5 text-center space-y-0.5 hover:bg-slate-50 transition-colors">
            <span className="text-[10px] font-bold text-gray-500 uppercase tracking-wider block font-outfit">{t('newAssignments')}</span>
            <span className="text-xl font-extrabold text-blue-700 font-mono block">{metrics.newTasks}</span>
          </Link>

          <Link to="/staff/tasks/in-progress" className="p-3.5 text-center space-y-0.5 hover:bg-slate-50 transition-colors">
            <span className="text-[10px] font-bold text-gray-500 uppercase tracking-wider block font-outfit">{t('inProgress')}</span>
            <span className="text-xl font-extrabold text-amber-700 font-mono block">{metrics.activeTasks}</span>
          </Link>

          <Link to="/staff/tasks" className="p-3.5 text-center space-y-0.5 hover:bg-slate-50 transition-colors">
            <span className="text-[10px] font-bold text-gray-500 uppercase tracking-wider block font-outfit">{t('dueSoon')}</span>
            <span className="text-xl font-extrabold text-orange-700 font-mono block">{metrics.dueSoon}</span>
          </Link>

          <Link to="/staff/tasks/overdue" className="p-3.5 text-center space-y-0.5 hover:bg-slate-50 transition-colors">
            <span className="text-[10px] font-bold text-gray-500 uppercase tracking-wider block font-outfit">{t('overdueSla')}</span>
            <span className="text-xl font-extrabold text-rose-700 font-mono block">{metrics.overdueCount}</span>
          </Link>

          <Link to="/staff/tasks/completed" className="p-3.5 text-center space-y-0.5 hover:bg-slate-50 transition-colors">
            <span className="text-[10px] font-bold text-gray-500 uppercase tracking-wider block font-outfit">{t('completed')}</span>
            <span className="text-xl font-extrabold text-emerald-700 font-mono block">{metrics.completed}</span>
          </Link>

        </div>

        {/* ================================================== */}
        {/* 8. OVERDUE ALERT BANNER */}
        {/* ================================================== */}
        {metrics.overdueCount > 0 ? (
          <div className="p-4 rounded-xl bg-rose-50 border border-rose-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs">
            <div className="flex items-center space-x-3 text-rose-900">
              <AlertTriangle className="w-5 h-5 text-rose-600 shrink-0" />
              <div>
                <span className="font-extrabold font-outfit text-sm block">{t('overdueSlaAlert')}</span>
                <span className="text-rose-800">
                  {lang === 'hi' ? 'आपके पास अतिदेय कार्य हैं:' : lang === 'mr' ? 'तुमच्याकडे मुदत संपलेली कामे आहेत:' : 'You have tasks that have exceeded their SLA:'} <span className="font-mono font-extrabold">{metrics.overdueCount}</span>
                </span>
              </div>
            </div>

            <Link
              to="/staff/tasks/overdue"
              className="px-4 py-2 bg-rose-600 hover:bg-rose-700 text-white font-extrabold text-xs rounded-lg transition-colors shrink-0 inline-flex items-center space-x-1"
            >
              <span>{t('viewOverdueTasks')}</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </Link>
          </div>
        ) : (
          <div className="p-3 px-4 rounded-xl bg-emerald-50 border border-emerald-200 flex items-center space-x-2 text-xs font-bold text-emerald-900">
            <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
            <span>{t('allTasksWithinSla')}</span>
          </div>
        )}

        {/* ================================================== */}
        {/* 13. QUICK ACTIONS TOOLBAR */}
        {/* ================================================== */}
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-bold text-gray-500 uppercase tracking-wider font-outfit mr-1">{t('quickActions')}</span>
          
          <Link
            to="/staff/tasks"
            className="px-3.5 py-2 rounded-xl bg-slate-50 border border-gray-200 text-gray-800 font-bold text-xs hover:bg-white hover:border-gray-300 transition-colors inline-flex items-center space-x-1.5 min-h-[44px]"
          >
            <FileText className="w-4 h-4 text-emerald-600" />
            <span>{t('myTasks')}</span>
          </Link>

          <Link
            to="/staff/map"
            className="px-3.5 py-2 rounded-xl bg-slate-50 border border-gray-200 text-gray-800 font-bold text-xs hover:bg-white hover:border-gray-300 transition-colors inline-flex items-center space-x-1.5 min-h-[44px]"
          >
            <Map className="w-4 h-4 text-emerald-600" />
            <span>{t('taskMap')}</span>
          </Link>

          <Link
            to="/staff/notifications"
            className="px-3.5 py-2 rounded-xl bg-slate-50 border border-gray-200 text-gray-800 font-bold text-xs hover:bg-white hover:border-gray-300 transition-colors inline-flex items-center space-x-1.5 min-h-[44px]"
          >
            <Bell className="w-4 h-4 text-emerald-600" />
            <span>{t('notifications')}</span>
          </Link>

          <Link
            to="/staff/settings"
            className="px-3.5 py-2 rounded-xl bg-slate-50 border border-gray-200 text-gray-800 font-bold text-xs hover:bg-white hover:border-gray-300 transition-colors inline-flex items-center space-x-1.5 min-h-[44px]"
          >
            <Sliders className="w-4 h-4 text-emerald-600" />
            <span>{t('settings')}</span>
          </Link>
        </div>

        {/* ================================================== */}
        {/* 5. PRIORITY WORK SECTION */}
        {/* ================================================== */}
        {isDashboardView && (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-2">
                <Zap className="w-4 h-4 text-amber-600" />
                <h3 className="text-sm font-extrabold text-gray-900 font-outfit uppercase tracking-wider">
                  {t('priority')} {t('myTasks')}
                </h3>
              </div>
              <Link to="/staff/tasks" className="text-xs font-bold text-emerald-700 hover:text-emerald-800 inline-flex items-center space-x-1">
                <span>{t('viewAllTasks')}</span>
                <ChevronRight className="w-3.5 h-3.5" />
              </Link>
            </div>

            {priorityTasksList.length === 0 ? (
              <div className="p-6 bg-slate-50 border border-gray-200 rounded-xl text-center space-y-1">
                <CheckCircle2 className="w-8 h-8 text-emerald-600 mx-auto" />
                <span className="font-bold text-gray-900 text-xs font-outfit block">You're all caught up!</span>
                <span className="text-[11px] text-gray-500 block">No pending priority tasks assigned.</span>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-6">
                {priorityTasksList.map((taskItem) => {
                  const slaInfo = formatSlaRemainingTime(taskItem.sla_deadline);
                  const isOverdue = slaInfo.isOverdue && taskItem.status !== 'Resolved';

                  return (
                    <div
                      key={taskItem.id}
                      className={`p-4 rounded-xl border space-y-3 bg-white hover:shadow-xs transition-shadow flex flex-col justify-between ${
                        isOverdue ? 'border-rose-300 bg-rose-50/20' : 'border-gray-200'
                      }`}
                    >
                      <div className="space-y-2">
                        <div className="flex items-center justify-between">
                          <span className="font-mono text-xs font-extrabold text-emerald-700">{taskItem.complaint_number}</span>
                          <PriorityBadge priority={taskItem.priority} />
                        </div>

                        <div>
                          <h4 className="font-bold text-gray-900 text-xs line-clamp-1">{taskItem.title}</h4>
                          <p className="text-[11px] text-gray-600 line-clamp-1 mt-0.5">{taskItem.location_address}</p>
                        </div>
                      </div>

                      <div className="space-y-2 pt-2 border-t border-gray-100">
                        <div className="flex items-center justify-between text-[11px] font-mono">
                          <span className={isOverdue ? 'text-rose-700 font-bold' : 'text-gray-600'}>
                            {slaInfo.text}
                          </span>
                          <StatusBadge status={taskItem.status} />
                        </div>

                        <button
                          onClick={() => setSelectedTask(taskItem)}
                          className="w-full py-2 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs rounded-lg transition-colors flex items-center justify-center space-x-1"
                        >
                          <Eye className="w-3.5 h-3.5" />
                          <span>{t('viewTask')}</span>
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* ================================================== */}
        {/* DASHBOARD TWO-COLUMN GRID */}
        {/* ================================================== */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            
            {/* LEFT COLUMN: ACTIVE TASKS + NEW ASSIGNMENTS + PERFORMANCE */}
            <div className="lg:col-span-7 space-y-6">
              
              {/* 6. MY ACTIVE TASKS */}
              <div className="bg-white border border-gray-200 rounded-2xl p-5 space-y-4 shadow-xs">
                <div className="flex items-center justify-between border-b border-gray-100 pb-3">
                  <div className="flex items-center space-x-2">
                    <Activity className="w-4 h-4 text-amber-600" />
                    <h3 className="text-sm font-extrabold text-gray-900 font-outfit uppercase tracking-wider">
                      {t('myActiveTasks')}
                    </h3>
                  </div>
                  <Link to="/staff/tasks/in-progress" className="text-xs font-bold text-emerald-700 hover:text-emerald-800">
                    {t('viewAllActive')}
                  </Link>
                </div>

                {activeTasksList.length === 0 ? (
                  <div className="p-6 text-center text-xs text-gray-500 font-medium">
                    {t('noActiveTasks')}
                  </div>
                ) : (
                  <div className="space-y-2.5">
                    {activeTasksList.map((tItem) => {
                      const slaInfo = formatSlaRemainingTime(tItem.sla_deadline);

                      return (
                        <div key={tItem.id} className="p-3 bg-slate-50 border border-gray-200 rounded-xl flex items-center justify-between gap-3 text-xs">
                          <div className="space-y-0.5">
                            <div className="flex items-center space-x-2">
                              <span className="font-mono font-extrabold text-emerald-700">{tItem.complaint_number}</span>
                              <PriorityBadge priority={tItem.priority} />
                            </div>
                            <span className="font-bold text-gray-900 block truncate max-w-[240px]">{tItem.title}</span>
                            <span className="text-[11px] text-gray-500 block truncate">{tItem.location_address}</span>
                          </div>

                          <div className="flex items-center space-x-3 shrink-0">
                            <div className="text-right">
                              <StatusBadge status={tItem.status} />
                              <span className="font-mono text-[10px] text-gray-500 block mt-0.5">{slaInfo.text}</span>
                            </div>
                            <button
                              onClick={() => setSelectedTask(tItem)}
                              className="p-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 transition-colors"
                            >
                              <Eye className="w-4 h-4" />
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* 7. NEW ASSIGNMENTS */}
              <div className="bg-white border border-gray-200 rounded-2xl p-5 space-y-4 shadow-xs">
                <div className="flex items-center justify-between border-b border-gray-100 pb-3">
                  <div className="flex items-center space-x-2">
                    <FileText className="w-4 h-4 text-blue-600" />
                    <h3 className="text-sm font-extrabold text-gray-900 font-outfit uppercase tracking-wider">
                      {t('newAssignments')}
                    </h3>
                  </div>
                  <Link to="/staff/tasks/new" className="text-xs font-bold text-emerald-700 hover:text-emerald-800">
                    {t('viewAllNew')}
                  </Link>
                </div>

                {newAssignmentsList.length === 0 ? (
                  <div className="p-6 text-center text-xs text-gray-500 font-medium">
                    {t('noNewTasks')}
                  </div>
                ) : (
                  <div className="space-y-2.5">
                    {newAssignmentsList.map((t) => (
                      <div key={t.id} className="p-3 bg-slate-50 border border-gray-200 rounded-xl flex items-center justify-between gap-3 text-xs">
                        <div className="space-y-0.5">
                          <div className="flex items-center space-x-2">
                            <span className="font-mono font-extrabold text-emerald-700">{t.complaint_number}</span>
                            <PriorityBadge priority={t.priority} />
                          </div>
                          <span className="font-bold text-gray-900 block truncate max-w-[240px]">{t.title}</span>
                        </div>

                        <div className="flex items-center space-x-2 shrink-0">
                          <button
                            onClick={() => handleStatusTransition(t.id, 'Accepted')}
                            className="px-3 py-1.5 bg-indigo-600 text-white font-bold text-xs rounded-lg hover:bg-indigo-700 transition-colors"
                          >
                            Accept Task
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* 9, 14. TODAY'S PROGRESS & PERFORMANCE */}
              <div className="bg-white border border-gray-200 rounded-2xl p-5 space-y-4 shadow-xs">
                <div className="border-b border-gray-100 pb-3">
                  <h3 className="text-sm font-extrabold text-gray-900 font-outfit uppercase tracking-wider">
                    Today's Progress & Performance
                  </h3>
                </div>

                {/* Progress Bar */}
                <div className="space-y-2 text-xs">
                  <div className="flex items-center justify-between font-bold">
                    <span>Field Work Completion</span>
                    <span className="font-mono text-emerald-700">
                      {metrics.completed} / {metrics.total} Tasks Completed ({metrics.slaCompliancePercent}%)
                    </span>
                  </div>
                  <div className="w-full h-3 bg-gray-100 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-emerald-600 rounded-full transition-all duration-500"
                      style={{ width: `${metrics.slaCompliancePercent}%` }}
                    />
                  </div>
                </div>

                {/* Performance Metrics Tiles */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-2 text-center text-xs">
                  <div className="p-3 bg-slate-50 rounded-xl border border-gray-200">
                    <span className="text-[10px] font-bold text-gray-500 uppercase block font-outfit">Total Completed</span>
                    <span className="text-base font-extrabold text-gray-900 font-mono block">{metrics.completed}</span>
                  </div>

                  <div className="p-3 bg-slate-50 rounded-xl border border-gray-200">
                    <span className="text-[10px] font-bold text-gray-500 uppercase block font-outfit">SLA Compliance</span>
                    <span className="text-base font-extrabold text-emerald-700 font-mono block">{metrics.slaCompliancePercent}%</span>
                  </div>

                  <div className="p-3 bg-slate-50 rounded-xl border border-gray-200">
                    <span className="text-[10px] font-bold text-gray-500 uppercase block font-outfit">Avg Resolution</span>
                    <span className="text-base font-extrabold text-blue-700 font-mono block">16h 40m</span>
                  </div>

                  <div className="p-3 bg-slate-50 rounded-xl border border-gray-200">
                    <span className="text-[10px] font-bold text-gray-500 uppercase block font-outfit">Citizen Rating</span>
                    <span className="text-base font-extrabold text-amber-700 font-mono block">★ 4.8 / 5</span>
                  </div>
                </div>
              </div>

            </div>

            {/* RIGHT COLUMN: TASK MAP PREVIEW + NOTIFICATIONS + RECENT ACTIVITY */}
            <div className="lg:col-span-5 space-y-6">
              
              {/* 10. TASK MAP PREVIEW WIDGET */}
              <div className="bg-white border border-gray-200 rounded-2xl p-5 space-y-3 shadow-xs">
                <div className="flex items-center justify-between border-b border-gray-100 pb-3">
                  <div className="flex items-center space-x-2">
                    <Map className="w-4 h-4 text-emerald-600" />
                    <h3 className="text-sm font-extrabold text-gray-900 font-outfit uppercase tracking-wider">
                      My Task Locations
                    </h3>
                  </div>
                  <Link to="/staff/map" className="text-xs font-bold text-emerald-700 hover:text-emerald-800">
                    Open Task Map →
                  </Link>
                </div>

                {/* MINI LEAFLET MAP PREVIEW */}
                <div className="h-56 rounded-xl overflow-hidden border border-gray-200 shadow-xs relative bg-slate-100">
                  <MapContainer
                    center={[20.0059, 73.7898]}
                    zoom={12}
                    scrollWheelZoom={false}
                    className="w-full h-full"
                  >
                    <TileLayer
                      attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
                      url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                    />
                    {mapPreviewTasks.map((t) => (
                      <Marker
                        key={t.id}
                        position={[Number(t.latitude), Number(t.longitude)]}
                        icon={createStatusMarkerIcon(t.status)}
                      >
                        <Popup>
                          <div className="text-xs font-bold font-sans">
                            <span className="font-mono text-emerald-700">{t.complaint_number}</span><br />
                            {t.title}
                          </div>
                        </Popup>
                      </Marker>
                    ))}
                  </MapContainer>
                </div>
              </div>

              {/* 12. NOTIFICATIONS PREVIEW */}
              <div className="bg-white border border-gray-200 rounded-2xl p-5 space-y-3 shadow-xs">
                <div className="flex items-center justify-between border-b border-gray-100 pb-3">
                  <div className="flex items-center space-x-2">
                    <Bell className="w-4 h-4 text-blue-600" />
                    <h3 className="text-sm font-extrabold text-gray-900 font-outfit uppercase tracking-wider">
                      Notifications
                    </h3>
                  </div>
                  <Link to="/staff/notifications" className="text-xs font-bold text-emerald-700 hover:text-emerald-800">
                    View All →
                  </Link>
                </div>

                <div className="space-y-2 text-xs">
                  {notifications.slice(0, 3).map((n) => (
                    <div key={n.id} className="p-2.5 bg-slate-50 border border-gray-200 rounded-xl space-y-0.5">
                      <div className="flex items-center justify-between">
                        <span className="font-bold text-gray-900 block truncate">{n.title}</span>
                        <span className="font-mono text-[10px] text-gray-400">{formatPortalTime(n.created_at)}</span>
                      </div>
                      <p className="text-[11px] text-gray-600 line-clamp-1">{n.message}</p>
                    </div>
                  ))}
                </div>
              </div>

              {/* 11. RECENT ACTIVITY HISTORY */}
              <div className="bg-white border border-gray-200 rounded-2xl p-5 space-y-3 shadow-xs">
                <div className="border-b border-gray-100 pb-3">
                  <h3 className="text-sm font-extrabold text-gray-900 font-outfit uppercase tracking-wider">
                    Recent Activity
                  </h3>
                </div>

                <div className="space-y-3 text-xs">
                  {recentActivities.map((act) => (
                    <div key={act.id} className="flex items-start space-x-2.5">
                      <div className="w-2 h-2 rounded-full bg-emerald-600 mt-1.5 shrink-0" />
                      <div className="space-y-0.5">
                        <span className="font-bold text-gray-900 block">{act.action}</span>
                        <p className="text-[11px] text-gray-600">{act.notes}</p>
                        <span className="font-mono text-[10px] text-gray-400 block">{formatPortalDateTime(act.created_at)}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

            </div>

          </div>

        {/* ================================================== */}
        {/* TASK EXECUTION & DETAIL MODAL (REUSED) */}
        {/* ================================================== */}
        {selectedTask && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-gray-900/40 backdrop-blur-xs overflow-y-auto font-sans">
            <div className="max-w-3xl w-full bg-white rounded-2xl p-6 sm:p-8 border border-gray-200 shadow-md my-8 space-y-6 max-h-[90vh] overflow-y-auto">
              
              {/* MODAL HEADER */}
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

              {/* ADMIN INSTRUCTIONS CALLOUT */}
              <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl space-y-1 text-xs">
                <span className="font-extrabold text-amber-900 font-outfit uppercase tracking-wider block">
                  {t('adminInstructions')}
                </span>
                <p className="text-amber-800">
                  {selectedTask.additional_notes || 'Inspect site, repair damaged civic infrastructure, and upload clear after-work photograph proof for approval.'}
                </p>
              </div>

              {/* FIELD WORKFLOW TRANSITION BUTTONS */}
              {selectedTask.status !== 'Resolved' && (
                <div className="bg-slate-50 p-4 rounded-xl border border-gray-200 space-y-3 text-xs">
                  <span className="font-extrabold text-gray-900 font-outfit block">{t('fieldExecutionActions')}</span>
                  <div className="flex flex-wrap gap-2">
                    
                    {/* Step 1: Accept Task */}
                    {(selectedTask.status === 'Department Assigned' || selectedTask.status === 'Staff Assigned') && (
                      <button
                        onClick={() => handleStatusTransition(selectedTask.id, 'Accepted')}
                        className="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-bold flex items-center space-x-1.5 min-h-[44px]"
                      >
                        <Check className="w-4 h-4" />
                        <span>{t('acceptTaskAssignment')}</span>
                      </button>
                    )}

                    {/* Step 2: Navigate to Location */}
                    <button
                      type="button"
                      onClick={() => openGoogleMapsDirections({ lat: Number(selectedTask.latitude), lng: Number(selectedTask.longitude) })}
                      className="px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-bold flex items-center space-x-1.5 min-h-[44px] cursor-pointer"
                    >
                      <Navigation className="w-4 h-4" />
                      <span>{t('navigateViaGoogleMaps')}</span>
                    </button>

                    {/* Step 3: Mark On the Way */}
                    {selectedTask.status === 'Accepted' && (
                      <button
                        onClick={() => handleStatusTransition(selectedTask.id, 'On the Way')}
                        className="px-4 py-2 rounded-xl bg-blue-50 hover:bg-blue-100 border border-blue-300 text-blue-800 font-bold flex items-center space-x-1.5 min-h-[44px]"
                      >
                        <Navigation className="w-4 h-4" />
                        <span>{t('markOnTheWay')}</span>
                      </button>
                    )}

                    {/* Step 4: Start Work */}
                    {(selectedTask.status === 'Accepted' || selectedTask.status === 'On the Way') && (
                      <button
                        onClick={() => handleStatusTransition(selectedTask.id, 'In Progress')}
                        className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold flex items-center space-x-1.5 min-h-[44px]"
                      >
                        <Play className="w-4 h-4" />
                        <span>{t('startWork')}</span>
                      </button>
                    )}

                  </div>
                </div>
              )}

              {/* TASK TIMESTAMPS & SLA METRICS */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 p-3 bg-slate-50 border border-gray-200 rounded-xl text-xs">
                <div>
                  <span className="text-[10px] font-bold text-gray-500 uppercase tracking-wider block">{t('reportedOn')}</span>
                  <span className="font-mono text-gray-900 font-semibold">{formatPortalDateTime(selectedTask.created_at, false, lang)}</span>
                </div>
                <div>
                  <span className="text-[10px] font-bold text-gray-500 uppercase tracking-wider block">{t('slaDeadline')}</span>
                  <span className={`font-mono font-semibold ${selectedTask.sla_deadline && new Date(selectedTask.sla_deadline) < new Date() && selectedTask.status !== 'Resolved' ? 'text-rose-600' : 'text-gray-900'}`}>
                    {formatPortalDateTime(selectedTask.sla_deadline, false, lang)}
                  </span>
                </div>
                <div>
                  <span className="text-[10px] font-bold text-gray-500 uppercase tracking-wider block">{t('lastUpdated')}</span>
                  <span className="font-mono text-gray-900 font-semibold">{formatPortalDateTime(selectedTask.updated_at, false, lang)}</span>
                </div>
                <div>
                  <span className="text-[10px] font-bold text-gray-500 uppercase tracking-wider block">{t('departments')}</span>
                  <span className="font-bold text-gray-900 truncate block">{translateDepartment(selectedTask.department_name) || translateDepartment(staffDepartmentFull)}</span>
                </div>
              </div>

              {/* BEFORE / AFTER PHOTO GALLERY */}
              <div className="space-y-2 text-xs border-t border-gray-200 pt-4">
                <h4 className="font-extrabold text-gray-900 font-outfit text-sm">{t('complaintPhotoEvidence')}</h4>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    {(() => {
                      const anglePhotos = extractComplaintAnglePhotos(selectedTask)
                        .map(p => ({ ...p, url: resolveMediaUrl(p.url) }))
                        .filter(p => Boolean(p.url));
                      const primaryBeforeUrl = resolveMediaUrl(selectedTask.photo_before_url) || resolveMediaUrl(selectedTask.photo_front_url) || anglePhotos[0]?.url || '';

                      return (
                        <>
                          <div className="flex items-center justify-between mb-1">
                            <span className="font-bold text-gray-700 text-xs">{t('beforeCitizenReportLocked')}</span>
                            {anglePhotos.length > 1 && (
                              <span className="text-[9px] font-mono font-bold text-emerald-800 bg-emerald-50 px-1.5 py-0.5 rounded border border-emerald-200">
                                {anglePhotos.length} {t('cameraAngles')}
                              </span>
                            )}
                          </div>
                          {primaryBeforeUrl ? (
                            <div className="relative rounded-xl overflow-hidden h-44 bg-gray-100 border border-gray-200">
                              <img
                                src={primaryBeforeUrl}
                                alt={t('beforeCitizenReportLocked')}
                                className="w-full h-full object-cover"
                                onError={(e) => {
                                  e.currentTarget.style.display = 'none';
                                  const parent = e.currentTarget.parentElement;
                                  const fallbackEl = parent?.querySelector('.citizen-photo-fallback') as HTMLElement;
                                  if (fallbackEl) fallbackEl.style.display = 'flex';
                                }}
                              />
                              <div className="citizen-photo-fallback hidden w-full h-full flex-col items-center justify-center p-4 text-center bg-gray-50 text-gray-500">
                                <span className="text-xs font-semibold text-gray-600">{t('noCitizenEvidencePhoto')}</span>
                                <span className="text-[10px] text-gray-400">{t('lockedCitizenRecord')}</span>
                              </div>
                              <span className="absolute bottom-2 left-2 bg-gray-900/80 text-white text-[10px] px-2 py-0.5 rounded font-mono font-bold flex items-center space-x-1">
                                <Lock className="w-3 h-3 text-emerald-400" />
                                <span>{anglePhotos[0]?.label || t('frontView')}</span>
                              </span>
                            </div>
                          ) : (
                            <div className="rounded-xl border border-gray-200 bg-gray-50 h-44 flex flex-col items-center justify-center p-4 text-center text-gray-500">
                              <span className="text-xs font-semibold text-gray-600">{t('noCitizenEvidencePhoto')}</span>
                              <span className="text-[10px] text-gray-400">{t('lockedCitizenRecord')}</span>
                            </div>
                          )}

                          {/* All Angle Thumbnails for Staff */}
                          {anglePhotos.length > 1 && (
                            <div className="grid grid-cols-4 gap-1.5 pt-1.5">
                              {anglePhotos.map((photoItem, pIdx) => (
                                <div
                                  key={pIdx}
                                  className="relative aspect-4/3 rounded-lg overflow-hidden border border-gray-200 bg-gray-100 cursor-pointer hover:ring-2 hover:ring-emerald-500 transition-all"
                                  onClick={() => {
                                    window.open(photoItem.url, '_blank');
                                  }}
                                  title={`View ${photoItem.label}`}
                                >
                                  <img src={photoItem.url} alt={photoItem.label} className="w-full h-full object-cover" />
                                  <span className="absolute bottom-0.5 inset-x-0 bg-gray-900/80 text-white text-[8px] text-center font-mono truncate px-0.5">
                                    {photoItem.label}
                                  </span>
                                </div>
                              ))}
                            </div>
                          )}
                        </>
                      );
                    })()}
                  </div>

                  <div>
                    <span className="font-bold text-gray-700 block mb-1">{t('afterResolutionProof')}</span>
                    {photoAfterPreview || selectedTask.photo_after_url ? (
                      <div className="relative rounded-xl overflow-hidden h-44 border border-emerald-400">
                        <img
                          src={getValidImageUrl(photoAfterPreview || selectedTask.photo_after_url)}
                          alt="Proof"
                          className="w-full h-full object-cover font-mono text-xs text-gray-500"
                        />
                        {selectedTask.status !== 'Resolved' && (
                          <button
                            type="button"
                            onClick={() => setPhotoAfterPreview('')}
                            className="absolute top-2 right-2 bg-rose-600 text-white px-2 py-1 rounded text-[10px] font-bold"
                          >
                            {t('changePhoto')}
                          </button>
                        )}
                      </div>
                    ) : (
                      <div className="border-2 border-dashed border-gray-300 rounded-xl p-3 text-center space-y-2 bg-gray-50/50 h-44 flex flex-col items-center justify-center">
                        <span className="text-[11px] font-bold text-gray-700 block">{t('captureOrSelectPhoto')}</span>
                        
                        <div className="flex flex-col sm:flex-row gap-2 w-full max-w-xs">
                          {/* Option A: Take Photo with Camera */}
                          <input
                            type="file"
                            accept="image/*"
                            capture="environment"
                            id="staff-dash-camera-input"
                            className="hidden"
                            onChange={(e) => {
                              if (e.target.files && e.target.files[0]) {
                                setPhotoAfterFile(e.target.files[0]);
                                setPhotoAfterPreview(URL.createObjectURL(e.target.files[0]));
                              }
                            }}
                          />
                          <label
                            htmlFor="staff-dash-camera-input"
                            className="flex-1 px-2.5 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs cursor-pointer min-h-[40px] flex items-center justify-center space-x-1 shadow-xs"
                          >
                            <Camera className="w-3.5 h-3.5" />
                            <span>{t('takePhoto')}</span>
                          </label>

                          {/* Option B: Choose from Gallery / Files */}
                          <input
                            type="file"
                            accept="image/*"
                            id="staff-dash-gallery-input"
                            className="hidden"
                            onChange={(e) => {
                              if (e.target.files && e.target.files[0]) {
                                setPhotoAfterFile(e.target.files[0]);
                                setPhotoAfterPreview(URL.createObjectURL(e.target.files[0]));
                              }
                            }}
                          />
                          <label
                            htmlFor="staff-dash-gallery-input"
                            className="flex-1 px-2.5 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs cursor-pointer min-h-[40px] flex items-center justify-center space-x-1 shadow-xs"
                          >
                            <Upload className="w-3.5 h-3.5" />
                            <span>{t('fromGallery')}</span>
                          </label>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* COMPLETE TASK FORM */}
              {selectedTask.status !== 'Resolved' && (
                <form onSubmit={handleSubmitResolutionProof} className="space-y-4 pt-2 border-t border-gray-200 text-xs">
                  <h4 className="font-extrabold text-gray-900 font-outfit text-sm">{t('resolutionDetails')}</h4>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block font-bold text-gray-700 mb-1">{t('workResolutionNotes')} *</label>
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
                      <label className="block font-bold text-gray-700 mb-1">{t('materialsEquipmentUsed')}</label>
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
                    <span>{submittingResolution ? t('submittingProof') : t('markWorkCompleted')}</span>
                  </button>
                </form>
              )}

              {/* CITIZEN FEEDBACK & RATING (If Available) */}
              {(selectedTask.rating || (selectedTask as any).feedback) && (
                <div className="space-y-2 pt-2 border-t border-gray-200">
                  <span className="text-[10px] font-extrabold font-mono uppercase text-gray-500 block">
                    Citizen Feedback & Rating
                  </span>
                  <CitizenFeedbackCard
                    citizenName={selectedTask.citizen_name || (selectedTask as any).feedback?.citizen_name || 'Citizen'}
                    complaintNumber={selectedTask.complaint_number}
                    rating={selectedTask.rating || (selectedTask as any).feedback?.rating}
                    review={selectedTask.feedback_comment || (selectedTask as any).feedback?.review || (selectedTask as any).feedback?.comment}
                    submissionDate={selectedTask.feedback_created_at || (selectedTask as any).feedback?.created_at || (selectedTask as any).feedback?.submission_date}
                  />
                </div>
              )}

              {/* TASK ACTIVITY TIMELINE */}
              <div className="pt-3 border-t border-gray-200">
                <ActivityTimeline complaintId={selectedTask.id} />
              </div>

            </div>
          </div>
        )}

        </div>
        )}

      </div>
    </DashboardLayout>
  );
};
