import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { MapContainer, TileLayer, Marker, Popup, useMap } from 'react-leaflet';
import L from 'leaflet';
import { useAuth } from '../../context/AuthContext';
import { useLanguage } from '../../context/LanguageContext';
import { useNotification } from '../../context/NotificationContext';
import { DashboardLayout } from '../../components/DashboardLayout';
import { StatusBadge } from '../../components/StatusBadge';
import { PriorityBadge } from '../../components/PriorityBadge';
import { ActivityTimeline } from '../../components/ActivityTimeline';
import {
  getStaffTasks, acceptStaffTask, startStaffTravel, startStaffWork,
  submitStaffResolution
} from '../../services/complaintService';
import { resolveDepartmentInfo } from '../../services/departmentService';
import { formatSlaRemainingTime, logActivity } from '../../services/adminService';
import { Complaint, ComplaintStatus } from '../../types/database.types';
import { useRealtimeComplaints } from '../../hooks/useRealtimeComplaints';
import { getValidImageUrl, DEFAULT_CIVIC_IMAGE_PLACEHOLDER } from '../../lib/supabase';
import { NagarSetuMap } from '../../components/NagarSetuMap';
import { openGoogleMapsDirections } from '../../utils/navigation';
import { NagarSetuComplaint } from '../../types/maps';
import {
  Map, MapPin, Search, RefreshCw, Navigation, Eye, UserCheck, CheckCircle2,
  AlertTriangle, Clock, Building2, User, Lock, Crosshair, Compass, Wrench, X,
  Check, Play, Camera, Upload, Layers
} from 'lucide-react';

// Fix standard Leaflet marker icon asset issue
delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
});

// Custom Colored Leaflet Marker Icons based on Task Status & SLA
const createStatusMarkerIcon = (status: ComplaintStatus, isOverdue: boolean = false) => {
  let color = '#0284c7'; // Default sky/blue for New
  if (status === 'Accepted' || status === 'On the Way' || status === 'In Progress') {
    color = '#d97706'; // Amber for In Progress
  } else if (status === 'Resolution Submitted' || status === 'Resolved') {
    color = '#059669'; // Emerald for Completed
  }

  if (isOverdue && status !== 'Resolved') {
    color = '#e11d48'; // Rose/Red for Overdue SLA
  }

  const pulseEffect = isOverdue && status !== 'Resolved'
    ? `<div style="position:absolute; inset:-4px; background-color:#e11d48; border-radius:50%; animation: ping 1.5s cubic-bezier(0, 0, 0.2, 1) infinite; opacity:0.75;"></div>`
    : '';

  return L.divIcon({
    className: 'custom-staff-task-marker',
    html: `
      <div style="position:relative; width:22px; height:22px; cursor:pointer;">
        ${pulseEffect}
        <div style="position:relative; background-color:${color}; width:22px; height:22px; border-radius:50%; border:2px solid #ffffff; box-shadow:0 2px 6px rgba(0,0,0,0.35); display:flex; align-items:center; justify-content:center;">
          <div style="width:6px; height:6px; background-color:#ffffff; border-radius:50%;"></div>
        </div>
      </div>
    `,
    iconSize: [22, 22],
    iconAnchor: [11, 11]
  });
};

// Staff Live Location Marker Icon
const createStaffUserLocationIcon = () => {
  return L.divIcon({
    className: 'custom-staff-user-location',
    html: `
      <div style="position:relative; width:24px; height:24px;">
        <div style="position:absolute; inset:-4px; background-color:#2563eb; border-radius:50%; animation: ping 2s infinite; opacity:0.4;"></div>
        <div style="position:relative; background-color:#2563eb; width:24px; height:24px; border-radius:50%; border:3px solid #ffffff; box-shadow:0 2px 8px rgba(37,99,235,0.6); display:flex; align-items:center; justify-content:center; color:white; font-size:10px; font-weight:bold;">
          📍
        </div>
      </div>
    `,
    iconSize: [24, 24],
    iconAnchor: [12, 12]
  });
};

// Leaflet Controller to Fly Map View to Active Location
function MapFlyToController({ center, zoom }: { center: [number, number] | null; zoom: number }) {
  const map = useMap();
  useEffect(() => {
    if (center) {
      map.flyTo(center, zoom, { animate: true, duration: 1.2 });
    }
  }, [center, zoom, map]);
  return null;
}

export const StaffTaskMapPage: React.FC = () => {
  const { user } = useAuth();
  const { t } = useLanguage();
  const { toast } = useNotification();

  // Staff Identity & Department
  const staffName = user?.full_name || 'Field Officer';
  const staffEmployeeId = user?.employee_id || (user?.id ? `STF-${String(user.id).slice(0, 4).toUpperCase()}` : 'STF-001');

  const resolvedDept = useMemo(
    () => resolveDepartmentInfo(user?.department_id, user?.department_name),
    [user?.department_id, user?.department_name]
  );
  const staffDepartmentFull = resolvedDept.fullName;
  const staffDepartment = resolvedDept.name;

  // Data State
  const [tasks, setTasks] = useState<Complaint[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filters & Search
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('All');
  const [priorityFilter, setPriorityFilter] = useState<string>('All');
  const [categoryFilter, setCategoryFilter] = useState<string>('All');

  // Selected Task & Modal State
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [detailModalTask, setDetailModalTask] = useState<Complaint | null>(null);

  // Map Navigation & Location State
  const defaultCenter: [number, number] = [20.0059, 73.7898]; // Nashik default
  const [mapCenter, setMapCenter] = useState<[number, number] | null>(defaultCenter);
  const [mapZoom, setMapZoom] = useState<number>(13);
  const [userLocation, setUserLocation] = useState<[number, number] | null>(null);
  const [locationError, setLocationError] = useState<string | null>(null);

  const hasGoogleMapsKey = Boolean(
    (import.meta.env.VITE_GOOGLE_MAPS_API_KEY as string) ||
    (import.meta.env.VITE_GOOGLE_MAPS_BROWSER_API_KEY as string)
  );
  const [mapEngine, setMapEngine] = useState<'google' | 'leaflet'>(
    hasGoogleMapsKey ? 'google' : 'leaflet'
  );

  // Field Execution Form State
  const [progressNote, setProgressNote] = useState('');
  const [submittingProgressNote, setSubmittingProgressNote] = useState(false);
  const [photoAfterFile, setPhotoAfterFile] = useState<File | null>(null);
  const [photoAfterPreview, setPhotoAfterPreview] = useState<string>('');
  const [workNotes, setWorkNotes] = useState('');
  const [materialsUsed, setMaterialsUsed] = useState('');
  const [submittingResolution, setSubmittingResolution] = useState(false);

  // Load Staff Tasks
  const loadTasks = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const list = await getStaffTasks(user?.id, staffDepartmentFull, user?.email, user?.full_name, user?.employee_id);
      setTasks(list);
    } catch (err) {
      console.error(err);
      setError('Unable to load your assigned task locations.');
    } finally {
      setLoading(false);
    }
  }, [user, staffDepartmentFull]);

  useEffect(() => {
    loadTasks();
  }, [loadTasks]);

  useRealtimeComplaints(useCallback(() => {
    loadTasks();
  }, [loadTasks]));

  const now = useMemo(() => new Date(), []);

  // Metrics Bar
  const metrics = useMemo(() => {
    const total = tasks.length;
    const newTasks = tasks.filter((t) => t.status === 'Department Assigned' || t.status === 'Staff Assigned').length;
    const activeTasks = tasks.filter((t) => t.status === 'Accepted' || t.status === 'On the Way' || t.status === 'In Progress').length;
    
    const overdue = tasks.filter((t) => {
      if (t.status === 'Resolved') return false;
      if (!t.sla_deadline) return false;
      return new Date(t.sla_deadline) < now;
    }).length;

    const completed = tasks.filter((t) => t.status === 'Resolution Submitted' || t.status === 'Resolved').length;

    return { total, newTasks, activeTasks, overdue, completed };
  }, [tasks, now]);

  // Filtered Task List
  const filteredTasks = useMemo(() => {
    return tasks.filter((t) => {
      // Status Filter
      if (statusFilter === 'New' && !(t.status === 'Department Assigned' || t.status === 'Staff Assigned')) return false;
      if (statusFilter === 'In Progress' && !(t.status === 'Accepted' || t.status === 'On the Way' || t.status === 'In Progress')) return false;
      if (statusFilter === 'Overdue' && (t.status === 'Resolved' || !t.sla_deadline || new Date(t.sla_deadline) >= now)) return false;
      if (statusFilter === 'Completed' && !(t.status === 'Resolution Submitted' || t.status === 'Resolved')) return false;

      // Priority Filter
      if (priorityFilter !== 'All' && t.priority !== priorityFilter) return false;

      // Category Filter
      if (categoryFilter !== 'All' && t.category !== categoryFilter) return false;

      // Search Query
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchesNum = t.complaint_number.toLowerCase().includes(q);
        const matchesTitle = t.title.toLowerCase().includes(q);
        const matchesLoc = (t.location_address || '').toLowerCase().includes(q);
        if (!matchesNum && !matchesTitle && !matchesLoc) return false;
      }

      return true;
    });
  }, [tasks, statusFilter, priorityFilter, categoryFilter, searchQuery, now]);

  // Tasks with valid GPS coordinates
  const tasksWithGps = useMemo(() => {
    return filteredTasks.filter(
      (t) => typeof t.latitude === 'number' && typeof t.longitude === 'number' && t.latitude !== 0 && t.longitude !== 0
    );
  }, [filteredTasks]);

  // Categories Dropdown Options
  const categoriesList = useMemo(() => {
    const set = new Set(tasks.map((t) => t.category).filter(Boolean));
    return Array.from(set);
  }, [tasks]);

  // Handle Select Task in List or Marker Click
  const handleSelectTask = (task: Complaint) => {
    setSelectedTaskId(task.id);
    if (typeof task.latitude === 'number' && typeof task.longitude === 'number' && task.latitude !== 0 && task.longitude !== 0) {
      setMapCenter([task.latitude, task.longitude]);
      setMapZoom(16);
    }
  };

  // Get Staff Member's Live GPS Location
  const handleGetMyLocation = () => {
    setLocationError(null);
    if ('geolocation' in navigator) {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          const lat = pos.coords.latitude;
          const lng = pos.coords.longitude;
          setUserLocation([lat, lng]);
          setMapCenter([lat, lng]);
          setMapZoom(16);
        },
        (err) => {
          console.error(err);
          setLocationError('Unable to access your current location.');
        },
        { enableHighAccuracy: true, timeout: 10000 }
      );
    } else {
      setLocationError('Geolocation is not supported by your browser.');
    }
  };

  // Reset Map View
  const handleResetMapView = () => {
    if (tasksWithGps.length > 0) {
      const avgLat = tasksWithGps.reduce((acc, t) => acc + Number(t.latitude), 0) / tasksWithGps.length;
      const avgLng = tasksWithGps.reduce((acc, t) => acc + Number(t.longitude), 0) / tasksWithGps.length;
      setMapCenter([avgLat, avgLng]);
      setMapZoom(13);
    } else {
      setMapCenter(defaultCenter);
      setMapZoom(13);
    }
  };

  // Status Lifecycle Transition Handler
  const handleStatusTransition = async (taskId: string, newStatus: ComplaintStatus) => {
    try {
      if (newStatus === 'Accepted') await acceptStaffTask(taskId);
      else if (newStatus === 'On the Way') await startStaffTravel(taskId);
      else if (newStatus === 'In Progress') await startStaffWork(taskId);

      await loadTasks();
      const updatedList = await getStaffTasks(user?.id || 'staff-101', staffDepartmentFull);
      setDetailModalTask(updatedList.find((t) => String(t.id) === String(taskId) || t.complaint_number === taskId) || null);
    } catch (err) {
      console.error(err);
      toast.error('Unable to update task status. Please try again.');
    }
  };

  // Field Progress Update Submission
  const handleAddProgressNote = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!detailModalTask || !progressNote.trim()) return;

    setSubmittingProgressNote(true);
    try {
      logActivity(
        detailModalTask.id,
        staffName,
        'Field Work Progress Update',
        detailModalTask.status,
        detailModalTask.status,
        progressNote.trim()
      );
      setProgressNote('');
      await loadTasks();
      const updatedList = await getStaffTasks(user?.id || 'staff-101', staffDepartmentFull);
      setDetailModalTask(updatedList.find((t) => t.id === detailModalTask.id) || null);
    } catch (err) {
      console.error(err);
      toast.error('Unable to add progress note.');
    } finally {
      setSubmittingProgressNote(false);
    }
  };

  // Resolution Proof Upload Handler
  const handleSubmitResolutionProof = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!detailModalTask || (!photoAfterPreview && !photoAfterFile)) {
      toast.warning('Please upload or select an "AFTER" repair proof photo.');
      return;
    }

    setSubmittingResolution(true);
    try {
      const photoToSubmit = photoAfterFile || photoAfterPreview;
      await submitStaffResolution(
        detailModalTask.id,
        photoToSubmit,
        workNotes || 'Field maintenance work completed.',
        materialsUsed || 'Standard repair materials & asphalt'
      );

      setDetailModalTask(null);
      setPhotoAfterFile(null);
      setPhotoAfterPreview('');
      setWorkNotes('');
      setMaterialsUsed('');
      await loadTasks();
      toast.success('Task resolution proof submitted successfully! Awaiting Department Head verification.');
    } catch (err: any) {
      console.error('Task resolution submission error:', err);
      toast.error(err?.message || 'Error submitting resolution proof.');
    } finally {
      setSubmittingResolution(false);
    }
  };

  return (
    <DashboardLayout title="Task Map">
      <div className="p-4 sm:p-6 lg:p-8 space-y-6 max-w-[1600px] mx-auto text-gray-900 bg-white min-h-screen font-sans">
        
        {/* ================================================== */}
        {/* 6. PAGE HEADER WITH LOCKED DEPT & STAFF NAME */}
        {/* ================================================== */}
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 border-b border-gray-200 pb-5">
          <div className="space-y-1">
            <div className="flex items-center space-x-3">
              <h1 className="text-2xl sm:text-3xl font-extrabold text-gray-900 tracking-tight font-outfit">
                Task Map
              </h1>
              <span className="inline-flex items-center space-x-1 px-2.5 py-1 rounded-full text-xs font-extrabold font-mono bg-emerald-50 text-emerald-800 border border-emerald-300">
                <Map className="w-3.5 h-3.5 text-emerald-700" />
                <span>GIS Field Operations</span>
              </span>
            </div>
            <p className="text-sm text-gray-600 font-medium">
              View your assigned civic tasks and navigate to their locations.
            </p>
          </div>

          {/* LOCKED DEPARTMENT & STAFF BADGE */}
          <div className="flex flex-wrap items-center gap-3 shrink-0">
            <div className="bg-slate-50 border border-gray-200 rounded-xl p-2.5 px-4 flex items-center space-x-4 shadow-xs">
              <div className="flex items-center space-x-2 text-xs">
                <User className="w-4 h-4 text-emerald-600 shrink-0" />
                <div>
                  <span className="font-extrabold text-gray-900 font-outfit block">{staffName}</span>
                  <span className="font-mono text-[10px] text-gray-500 font-bold block">{staffEmployeeId}</span>
                </div>
              </div>

              <div className="h-6 w-px bg-gray-200" />

              <div className="flex items-center space-x-2 text-xs">
                <Building2 className="w-4 h-4 text-emerald-600 shrink-0" />
                <div>
                  <div className="flex items-center space-x-1">
                    <span className="font-extrabold text-gray-900 font-outfit">{staffDepartment}</span>
                    <span title="Department locked to your staff profile">
                      <Lock className="w-3 h-3 text-gray-400" />
                    </span>
                  </div>
                  <span className="text-[10px] text-gray-500 font-medium block">Department Assigned</span>
                </div>
              </div>
            </div>

            <button
              onClick={loadTasks}
              disabled={loading}
              className="p-2.5 rounded-xl bg-white text-gray-700 border border-gray-300 hover:bg-gray-50 transition-colors min-h-[44px]"
              title="Refresh Task Map"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            </button>
          </div>
        </div>

        {/* ================================================== */}
        {/* 13. TASK SUMMARY METRICS BAR */}
        {/* ================================================== */}
        <div className="grid grid-cols-2 sm:grid-cols-5 border border-gray-200 rounded-xl divide-x divide-y sm:divide-y-0 divide-gray-200 bg-white shadow-xs overflow-hidden">
          
          <div className="p-3 text-center space-y-0.5">
            <span className="text-[10px] font-bold text-gray-500 uppercase tracking-wider block font-outfit">My Tasks</span>
            <span className="text-xl font-extrabold text-gray-900 font-mono block">{metrics.total}</span>
          </div>

          <div className="p-3 text-center space-y-0.5">
            <span className="text-[10px] font-bold text-gray-500 uppercase tracking-wider block font-outfit">{t('newAssignments')}</span>
            <span className="text-xl font-extrabold text-blue-700 font-mono block">{metrics.newTasks}</span>
          </div>

          <div className="p-3 text-center space-y-0.5">
            <span className="text-[10px] font-bold text-gray-500 uppercase tracking-wider block font-outfit">In Progress</span>
            <span className="text-xl font-extrabold text-amber-700 font-mono block">{metrics.activeTasks}</span>
          </div>

          <div className="p-3 text-center space-y-0.5">
            <span className="text-[10px] font-bold text-gray-500 uppercase tracking-wider block font-outfit">{t('overdueSla')}</span>
            <span className="text-xl font-extrabold text-rose-700 font-mono block">{metrics.overdue}</span>
          </div>

          <div className="p-3 text-center space-y-0.5">
            <span className="text-[10px] font-bold text-gray-500 uppercase tracking-wider block font-outfit">Completed</span>
            <span className="text-xl font-extrabold text-emerald-700 font-mono block">{metrics.completed}</span>
          </div>

        </div>

        {/* ================================================== */}
        {/* 11 & 12. SEARCH & FILTERS BAR */}
        {/* ================================================== */}
        <div className="bg-slate-50 p-4 rounded-xl border border-gray-200 space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
            
            {/* Search Input */}
            <div className="relative sm:col-span-1">
              <Search className="w-4 h-4 text-gray-400 absolute left-3 top-3" />
              <input aria-label="Search complaint ID, issue..."
                type="text"
                placeholder="Search complaint ID, issue..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-9 pr-4 py-2 bg-white border border-gray-300 rounded-lg text-xs font-medium text-gray-900 focus:ring-1 focus:ring-emerald-500"
              />
              {searchQuery && (
                <button onClick={() => setSearchQuery('')} className="absolute right-3 top-2.5 text-gray-400 hover:text-gray-600">
                  <X className="w-4 h-4" />
                </button>
              )}
            </div>

            {/* Status Filter */}
            <div>
              <select aria-label="status  filter"
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className="w-full p-2 bg-white border border-gray-300 rounded-lg text-xs font-medium text-gray-800"
              >
                <option value="All">All Task Statuses</option>
                <option value="New">{t('newAssignments')}</option>
                <option value="In Progress">In Progress</option>
                <option value="Overdue">{t('overdueSla')}</option>
                <option value="Completed">Completed</option>
              </select>
            </div>

            {/* Priority Filter */}
            <div>
              <select aria-label="priority  filter"
                value={priorityFilter}
                onChange={(e) => setPriorityFilter(e.target.value)}
                className="w-full p-2 bg-white border border-gray-300 rounded-lg text-xs font-medium text-gray-800"
              >
                <option value="All">All Priorities</option>
                <option value="Critical">Critical Priority</option>
                <option value="High">High Priority</option>
                <option value="Medium">Medium Priority</option>
                <option value="Low">Low Priority</option>
              </select>
            </div>

            {/* Category Filter */}
            <div>
              <select aria-label="category  filter"
                value={categoryFilter}
                onChange={(e) => setCategoryFilter(e.target.value)}
                className="w-full p-2 bg-white border border-gray-300 rounded-lg text-xs font-medium text-gray-800"
              >
                <option value="All">All Categories</option>
                {categoriesList.map((cat) => (
                  <option key={cat} value={cat}>{cat}</option>
                ))}
              </select>
            </div>

          </div>
        </div>

        {/* ================================================== */}
        {/* 10, 22. SPLIT VIEW: LEFT TASK LIST + RIGHT MAP */}
        {/* ================================================== */}
        {loading ? (
          <div className="h-96 bg-gray-100 rounded-2xl animate-pulse flex items-center justify-center text-gray-400">
            Loading Task Map...
          </div>
        ) : error ? (
          <div className="bg-white rounded-2xl border border-gray-200 p-12 text-center space-y-3">
            <AlertTriangle className="w-8 h-8 text-rose-500 mx-auto" />
            <h3 className="text-base font-bold text-gray-900">{error}</h3>
            <button
              onClick={loadTasks}
              className="px-4 py-2 bg-emerald-600 text-white font-bold text-xs rounded-lg hover:bg-emerald-700 transition-colors"
            >
              Try Again
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            
            {/* LEFT SIDE: COMPACT TASK LIST */}
            <div className="lg:col-span-4 space-y-3 order-2 lg:order-1 max-h-[700px] overflow-y-auto pr-1">
              <div className="flex items-center justify-between">
                <span className="text-xs font-extrabold text-gray-700 uppercase font-outfit">
                  Task Pins ({filteredTasks.length})
                </span>
                <span className="text-[11px] font-mono text-gray-500">
                  GPS Mapped: {tasksWithGps.length}
                </span>
              </div>

              {filteredTasks.length === 0 ? (
                /* 27. EMPTY STATE */
                <div className="p-8 bg-slate-50 border border-gray-200 rounded-xl text-center space-y-2">
                  <CheckCircle2 className="w-8 h-8 text-emerald-600 mx-auto" />
                  <h4 className="font-bold text-gray-900 text-xs font-outfit">No Tasks to Display</h4>
                  <p className="text-[11px] text-gray-500">You currently have no assigned tasks with available locations matching the filter.</p>
                </div>
              ) : (
                <div className="space-y-2.5">
                  {filteredTasks.map((t) => {
                    const hasGps = typeof t.latitude === 'number' && typeof t.longitude === 'number' && t.latitude !== 0 && t.longitude !== 0;
                    const isSelected = selectedTaskId === t.id;
                    const slaInfo = formatSlaRemainingTime(t.sla_deadline);
                    const isOverdue = slaInfo.isOverdue && t.status !== 'Resolved';

                    return (
                      <div
                        key={t.id}
                        onClick={() => handleSelectTask(t)}
                        className={`p-3.5 rounded-xl border transition-all cursor-pointer space-y-2 ${
                          isSelected
                            ? 'border-emerald-500 bg-emerald-50/40 ring-1 ring-emerald-500 shadow-xs'
                            : isOverdue
                            ? 'border-rose-300 bg-rose-50/30 hover:border-rose-400'
                            : 'border-gray-200 bg-white hover:border-gray-300'
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <span className="font-mono font-extrabold text-emerald-700 text-xs">{t.complaint_number}</span>
                          <PriorityBadge priority={t.priority} />
                        </div>

                        <div>
                          <h4 className="font-bold text-gray-900 text-xs line-clamp-1">{t.title}</h4>
                          <div className="flex items-center space-x-1 text-[11px] text-gray-600 mt-0.5">
                            <MapPin className="w-3.5 h-3.5 text-gray-400 shrink-0" />
                            <span className="truncate">{t.location_address || 'Municipal Zone'}</span>
                          </div>
                        </div>

                        <div className="flex items-center justify-between text-[11px] font-mono border-t border-gray-100 pt-2">
                          {hasGps ? (
                            <span className={isOverdue ? 'text-rose-700 font-bold' : 'text-gray-600'}>
                              {slaInfo.text}
                            </span>
                          ) : (
                            /* 21. MISSING LOCATION FALLBACK */
                            <span className="text-amber-800 font-bold bg-amber-50 px-2 py-0.5 rounded text-[10px]">
                              Location Unavailable
                            </span>
                          )}
                          <StatusBadge status={t.status} />
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* RIGHT SIDE: LARGE INTERACTIVE MAP */}
            <div className="lg:col-span-8 order-1 lg:order-2 space-y-3">
              <div className="relative rounded-2xl overflow-hidden border border-gray-200 shadow-md h-[450px] sm:h-[600px] lg:h-[680px] bg-slate-100">
                
                {/* MAP TOP TOOLBAR */}
                <div className="absolute top-3 right-3 z-[400] flex items-center space-x-2">
                  
                  {/* ENGINE SWITCHER */}
                  {hasGoogleMapsKey && (
                    <div className="inline-flex rounded-xl border border-gray-200 bg-white p-0.5 shadow-sm">
                      <button
                        type="button"
                        onClick={() => setMapEngine('google')}
                        className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all min-h-[40px] ${
                          mapEngine === 'google'
                            ? 'bg-emerald-50 text-emerald-700 border border-emerald-300 shadow-xs'
                            : 'text-gray-600 hover:text-gray-900'
                        }`}
                      >
                        Google Maps
                      </button>
                      <button
                        type="button"
                        onClick={() => setMapEngine('leaflet')}
                        className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all min-h-[40px] ${
                          mapEngine === 'leaflet'
                            ? 'bg-emerald-50 text-emerald-700 border border-emerald-300 shadow-xs'
                            : 'text-gray-600 hover:text-gray-900'
                        }`}
                      >
                        OpenStreetMap
                      </button>
                    </div>
                  )}

                  {/* 15. MY LOCATION BUTTON */}
                  <button
                    onClick={handleGetMyLocation}
                    className="p-2.5 rounded-xl bg-white text-gray-800 border border-gray-300 shadow-sm hover:bg-slate-50 transition-colors font-bold text-xs flex items-center space-x-1.5 min-h-[44px]"
                    title="Locate My Position"
                  >
                    <Crosshair className="w-4 h-4 text-blue-600" />
                    <span className="hidden sm:inline">My Location</span>
                  </button>

                  {/* RESET VIEW BUTTON */}
                  <button
                    onClick={handleResetMapView}
                    className="p-2.5 rounded-xl bg-white text-gray-800 border border-gray-300 shadow-sm hover:bg-slate-50 transition-colors font-bold text-xs flex items-center space-x-1.5 min-h-[44px]"
                    title="Reset Map Bounds"
                  >
                    <Compass className="w-4 h-4 text-emerald-600" />
                    <span className="hidden sm:inline">Reset View</span>
                  </button>

                </div>

                {/* 14. MAP LEGEND */}
                <div className="absolute bottom-3 left-3 z-[400] bg-white/95 backdrop-blur-xs p-2.5 px-3.5 rounded-xl border border-gray-200 shadow-sm text-[11px] font-bold space-y-1">
                  <span className="text-[10px] uppercase font-outfit text-gray-500 block">Map Legend</span>
                  <div className="flex flex-wrap items-center gap-3 text-gray-800 font-mono">
                    <div className="flex items-center space-x-1">
                      <span className="w-2.5 h-2.5 rounded-full bg-sky-600 inline-block" />
                      <span>New</span>
                    </div>
                    <div className="flex items-center space-x-1">
                      <span className="w-2.5 h-2.5 rounded-full bg-amber-600 inline-block" />
                      <span>In Progress</span>
                    </div>
                    <div className="flex items-center space-x-1">
                      <span className="w-2.5 h-2.5 rounded-full bg-rose-600 inline-block" />
                      <span>Overdue</span>
                    </div>
                    <div className="flex items-center space-x-1">
                      <span className="w-2.5 h-2.5 rounded-full bg-emerald-600 inline-block" />
                      <span>Completed</span>
                    </div>
                  </div>
                </div>

                {/* LOCATION ERROR CALLOUT */}
                {locationError && (
                  <div className="absolute top-3 left-3 z-[400] bg-rose-50 text-rose-800 border border-rose-300 px-3 py-2 rounded-xl text-xs font-bold shadow-sm">
                    {locationError}
                  </div>
                )}

                {/* GOOGLE MAPS ENGINE */}
                {mapEngine === 'google' && hasGoogleMapsKey ? (
                  <NagarSetuMap
                    complaints={tasksWithGps.map((t) => ({
                      id: t.id,
                      complaintNumber: t.complaint_number,
                      category: t.category,
                      title: t.title,
                      description: t.description,
                      priority: t.priority,
                      status: t.status,
                      latitude: Number(t.latitude),
                      longitude: Number(t.longitude),
                      department_name: t.department_name,
                      location_address: t.location_address
                    }))}
                    center={
                      mapCenter
                        ? { lat: mapCenter[0], lng: mapCenter[1] }
                        : { lat: defaultCenter[0], lng: defaultCenter[1] }
                    }
                    zoom={mapZoom}
                    height="100%"
                    onComplaintSelect={(t) => {
                      setSelectedTaskId(t.id);
                      const matched = tasks.find((x) => x.id === t.id);
                      if (matched) setDetailModalTask(matched);
                    }}
                  />
                ) : (
                  /* LEAFLET MAP CONTAINER */
                  <MapContainer
                    center={mapCenter || defaultCenter}
                    zoom={mapZoom}
                    scrollWheelZoom={true}
                    className="w-full h-full"
                  >
                    <TileLayer
                      attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
                      url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                    />

                    <MapFlyToController center={mapCenter} zoom={mapZoom} />

                    {/* STAFF LIVE LOCATION MARKER */}
                    {userLocation && (
                      <Marker position={userLocation} icon={createStaffUserLocationIcon()}>
                        <Popup>
                          <div className="text-xs font-bold text-gray-900 font-sans">
                            📍 Your Current Location
                          </div>
                        </Popup>
                      </Marker>
                    )}

                    {/* 8. REAL TASK MARKERS */}
                    {tasksWithGps.map((t) => {
                      const slaInfo = formatSlaRemainingTime(t.sla_deadline);
                      const isOverdue = slaInfo.isOverdue && t.status !== 'Resolved';
                      const markerIcon = createStatusMarkerIcon(t.status, isOverdue);

                      return (
                        <Marker
                          key={t.id}
                          position={[Number(t.latitude), Number(t.longitude)]}
                          icon={markerIcon}
                          eventHandlers={{
                            click: () => {
                              setSelectedTaskId(t.id);
                            }
                          }}
                        >
                          {/* 9. MARKER POPUP */}
                          <Popup>
                            <div className="p-1 space-y-2 font-sans max-w-[260px] text-xs">
                              <div className="flex items-center justify-between border-b border-gray-100 pb-1">
                                <span className="font-mono font-extrabold text-emerald-700 text-xs">
                                  {t.complaint_number}
                                </span>
                                <StatusBadge status={t.status} />
                              </div>

                              <div>
                                <h4 className="font-extrabold text-gray-900 text-xs font-outfit leading-tight">
                                  {t.title}
                                </h4>
                                <p className="text-[11px] text-gray-600 mt-0.5">{t.location_address}</p>
                              </div>

                              <div className="flex items-center justify-between text-[10px] font-mono bg-gray-50 p-1.5 rounded">
                                <PriorityBadge priority={t.priority} />
                                <span className={isOverdue ? 'text-rose-700 font-bold' : 'text-gray-700'}>
                                  {slaInfo.text}
                                </span>
                              </div>

                              <div className="flex items-center gap-1.5 pt-1">
                                {/* 16. GOOGLE MAPS NAVIGATION LINK */}
                                <button
                                  type="button"
                                  onClick={() => openGoogleMapsDirections({ lat: Number(t.latitude), lng: Number(t.longitude) })}
                                  className="flex-1 py-1.5 px-2 bg-blue-600 text-white font-bold text-[11px] rounded-md text-center hover:bg-blue-700 transition-colors flex items-center justify-center space-x-1 cursor-pointer"
                                >
                                  <Navigation className="w-3 h-3" />
                                  <span>Navigate</span>
                                </button>

                                {/* VIEW TASK DETAIL MODAL BUTTON */}
                                <button
                                  onClick={() => setDetailModalTask(t)}
                                  className="flex-1 py-1.5 px-2 bg-emerald-600 text-white font-bold text-[11px] rounded-md text-center hover:bg-emerald-700 transition-colors flex items-center justify-center space-x-1 cursor-pointer"
                                >
                                  <Eye className="w-3 h-3" />
                                  <span>View Task</span>
                                </button>
                              </div>
                            </div>
                          </Popup>
                        </Marker>
                      );
                    })}

                  </MapContainer>
                )}
              </div>
            </div>

          </div>
        )}

        {/* ================================================== */}
        {/* TASK DETAIL & EXECUTION MODAL (REUSED) */}
        {/* ================================================== */}
        {detailModalTask && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-gray-900/40 backdrop-blur-xs overflow-y-auto font-sans">
            <div className="max-w-3xl w-full bg-white rounded-2xl p-6 sm:p-8 border border-gray-200 shadow-md my-8 space-y-6 max-h-[90vh] overflow-y-auto">
              
              {/* MODAL HEADER */}
              <div className="flex items-start justify-between border-b border-gray-200 pb-3">
                <div className="space-y-1">
                  <div className="flex items-center space-x-2">
                    <span className="font-mono text-xs font-extrabold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-300">
                      {detailModalTask.complaint_number}
                    </span>
                    <StatusBadge status={detailModalTask.status} />
                    <PriorityBadge priority={detailModalTask.priority} />
                  </div>
                  <h3 className="text-lg font-extrabold text-gray-900 font-outfit">{detailModalTask.title}</h3>
                </div>

                <button
                  onClick={() => setDetailModalTask(null)}
                  className="p-2 text-gray-400 hover:text-gray-600 rounded-lg min-h-[44px] min-w-[44px] flex items-center justify-center"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {/* ADMIN INSTRUCTIONS CALLOUT */}
              <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl space-y-1 text-xs">
                <span className="font-extrabold text-amber-900 font-outfit uppercase tracking-wider block">
                  Admin Instructions
                </span>
                <p className="text-amber-800">
                  {detailModalTask.additional_notes || 'Inspect site, repair damaged civic infrastructure, and upload clear after-work photograph proof for approval.'}
                </p>
              </div>

              {/* FIELD WORKFLOW TRANSITION BUTTONS */}
              {detailModalTask.status !== 'Resolved' && (
                <div className="bg-slate-50 p-4 rounded-xl border border-gray-200 space-y-3 text-xs">
                  <span className="font-extrabold text-gray-900 font-outfit block">Field Execution Lifecycle Actions</span>
                  <div className="flex flex-wrap gap-2">
                    
                    {/* Step 1: Accept Task */}
                    {(detailModalTask.status === 'Department Assigned' || detailModalTask.status === 'Staff Assigned') && (
                      <button
                        onClick={() => handleStatusTransition(detailModalTask.id, 'Accepted')}
                        className="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-bold flex items-center space-x-1.5 min-h-[44px]"
                      >
                        <Check className="w-4 h-4" />
                        <span>Accept Task Assignment</span>
                      </button>
                    )}

                    {/* Step 2: Navigate to Location */}
                    <a
                      href={`https://www.google.com/maps/dir/?api=1&destination=${detailModalTask.latitude},${detailModalTask.longitude}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-bold flex items-center space-x-1.5 min-h-[44px]"
                    >
                      <Navigation className="w-4 h-4" />
                      <span>Navigate to Location</span>
                    </a>

                    {/* Step 3: Mark On the Way */}
                    {detailModalTask.status === 'Accepted' && (
                      <button
                        onClick={() => handleStatusTransition(detailModalTask.id, 'On the Way')}
                        className="px-4 py-2 rounded-xl bg-blue-50 hover:bg-blue-100 border border-blue-300 text-blue-800 font-bold flex items-center space-x-1.5 min-h-[44px]"
                      >
                        <Navigation className="w-4 h-4" />
                        <span>Mark "On the Way to Site"</span>
                      </button>
                    )}

                    {/* Step 4: Start Work */}
                    {(detailModalTask.status === 'Accepted' || detailModalTask.status === 'On the Way') && (
                      <button
                        onClick={() => handleStatusTransition(detailModalTask.id, 'In Progress')}
                        className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold flex items-center space-x-1.5 min-h-[44px]"
                      >
                        <Play className="w-4 h-4" />
                        <span>Start Work (In Progress)</span>
                      </button>
                    )}

                  </div>
                </div>
              )}

              {/* LOCATION INFORMATION */}
              <div className="space-y-2 text-xs">
                <span className="font-bold text-gray-700 block">Site Address & Coordinates</span>
                <div className="p-3 bg-gray-50 border border-gray-200 rounded-xl space-y-1.5 flex flex-wrap items-center justify-between gap-2">
                  <div className="space-y-1">
                    <div className="flex items-center space-x-1.5">
                      <MapPin className="w-4 h-4 text-emerald-600 shrink-0" />
                      <span className="font-bold text-gray-900">{detailModalTask.location_address || 'Location unavailable'}</span>
                    </div>
                    <div className="font-mono text-[11px] text-gray-600">
                      GPS Coordinates: {detailModalTask.latitude}, {detailModalTask.longitude}
                    </div>
                  </div>

                  <a
                    href={`https://www.google.com/maps/dir/?api=1&destination=${detailModalTask.latitude},${detailModalTask.longitude}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="px-3.5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-extrabold text-xs shadow-xs flex items-center space-x-1.5 min-h-[44px]"
                  >
                    <Navigation className="w-4 h-4" />
                    <span>Get Directions</span>
                  </a>
                </div>
              </div>

              {/* PROGRESS UPDATE FORM */}
              {detailModalTask.status !== 'Resolved' && (
                <form onSubmit={handleAddProgressNote} className="space-y-2 border-t border-gray-200 pt-3 text-xs">
                  <span className="font-bold text-gray-700 block">Add On-Site Progress Update Note</span>
                  <div className="flex gap-2">
                    <input aria-label="e.g. Damaged section identified. Repair work has started."
                      type="text"
                      placeholder="e.g. Damaged section identified. Repair work has started."
                      value={progressNote}
                      onChange={(e) => setProgressNote(e.target.value)}
                      className="flex-1 p-2 bg-white border border-gray-300 rounded-lg text-xs text-gray-900"
                    />
                    <button
                      type="submit"
                      disabled={submittingProgressNote || !progressNote.trim()}
                      className="px-3 py-2 bg-blue-600 text-white font-bold text-xs rounded-lg hover:bg-blue-700 transition-colors shrink-0 disabled:opacity-50"
                    >
                      Post Update
                    </button>
                  </div>
                </form>
              )}

              {/* BEFORE / AFTER PHOTO GALLERY */}
              <div className="space-y-2 text-xs border-t border-gray-200 pt-4">
                <h4 className="font-extrabold text-gray-900 font-outfit text-sm">Complaint Photo Evidence</h4>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <span className="font-bold text-gray-700 block mb-1">BEFORE (Citizen Report - Locked)</span>
                    <div className="relative rounded-xl overflow-hidden h-44 bg-gray-100 border border-gray-200">
                      <img
                        src={getValidImageUrl(detailModalTask.photo_before_url)}
                        alt="Before"
                        className="w-full h-full object-cover"
                        onError={(e) => { e.currentTarget.src = DEFAULT_CIVIC_IMAGE_PLACEHOLDER; }}
                      />
                    </div>
                  </div>

                  <div>
                    <span className="font-bold text-gray-700 block mb-1">AFTER (Resolution Proof Photo)</span>
                    {photoAfterPreview || detailModalTask.photo_after_url ? (
                      <div className="relative rounded-xl overflow-hidden h-44 border border-emerald-400">
                        <img
                          src={getValidImageUrl(photoAfterPreview || detailModalTask.photo_after_url)}
                          alt="Proof"
                          className="w-full h-full object-cover font-mono text-xs text-gray-500"
                        />
                        {detailModalTask.status !== 'Resolved' && (
                          <button
                            type="button"
                            onClick={() => setPhotoAfterPreview('')}
                            className="absolute top-2 right-2 bg-rose-600 text-white px-2 py-1 rounded text-[10px] font-bold"
                          >
                            Change Photo
                          </button>
                        )}
                      </div>
                    ) : (
                      <div className="border-2 border-dashed border-gray-300 rounded-xl p-4 text-center space-y-2 bg-gray-50/50 h-44 flex flex-col items-center justify-center">
                        <Camera className="w-6 h-6 text-gray-400" />
                        <input
                          type="file"
                          accept="image/*"
                          id="staff-map-proof-input"
                          className="hidden"
                          onChange={(e) => {
                            if (e.target.files && e.target.files[0]) {
                              setPhotoAfterFile(e.target.files[0]);
                              setPhotoAfterPreview(URL.createObjectURL(e.target.files[0]));
                            }
                          }}
                        />
                        <label
                          htmlFor="staff-map-proof-input"
                          className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs cursor-pointer min-h-[44px] inline-flex items-center space-x-1"
                        >
                          <Upload className="w-3.5 h-3.5" />
                          <span>Upload Repair Photo</span>
                        </label>
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* COMPLETE TASK FORM */}
              {detailModalTask.status !== 'Resolved' && (
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
                    disabled={submittingResolution || (!photoAfterPreview && !detailModalTask.photo_after_url)}
                    className="w-full py-3 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-extrabold text-xs uppercase tracking-wider shadow-sm flex items-center justify-center space-x-1.5 min-h-[44px] disabled:opacity-50"
                  >
                    <CheckCircle2 className="w-5 h-5" />
                    <span>{submittingResolution ? 'Submitting Proof...' : 'Mark Work Completed (Send for Admin Verification)'}</span>
                  </button>
                </form>
              )}

              {/* TASK ACTIVITY TIMELINE */}
              <div className="pt-3 border-t border-gray-200">
                <ActivityTimeline complaintId={detailModalTask.id} />
              </div>

            </div>
          </div>
        )}

      </div>
    </DashboardLayout>
  );
};
