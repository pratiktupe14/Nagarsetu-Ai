import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { MapContainer, TileLayer, Marker, Popup } from 'react-leaflet';
import L from 'leaflet';
import { DashboardLayout } from '../../components/DashboardLayout';
import { StatusBadge } from '../../components/StatusBadge';
import { PriorityBadge, getPriorityConfig } from '../../components/PriorityBadge';
import { getAllComplaints } from '../../services/complaintService';
import {
  fetchDepartmentStaffApi,
  ServiceStaffMemberRecord
} from '../../services/adminService';
import { Complaint } from '../../types/database.types';
import { useRealtimeComplaints } from '../../hooks/useRealtimeComplaints';
import { useLanguage } from '../../context/LanguageContext';
import {
  Building2, Users, FileText, CheckCircle2, AlertTriangle, RefreshCw,
  Search, Eye, Clock, Activity, Wrench, Trash2, Droplets, Waves, Zap,
  Compass, MapPin, ExternalLink, Sliders, TrendingUp, Award, Layers,
  FileSpreadsheet, ArrowRight, ShieldCheck, ChevronRight, Maximize2,
  CheckSquare, BarChart2, PieChart, ShieldAlert
} from 'lucide-react';

import {
  getDepartmentHeads,
  getDepartments,
  matchComplaintToDepartment,
  DepartmentLeadershipSummary,
  MunicipalDepartment
} from '../../services/departmentService';
import { supabase, isSupabaseConfigured } from '../../lib/supabase';

// Fix standard Leaflet marker icon asset issue
delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
});

// Custom DivIcon generator for priority-based map markers
const createCustomMapMarkerIcon = (priority: string) => {
  const pConfig = getPriorityConfig(priority);
  const bgColor = pConfig.hex;
  const pulseColor = pConfig.pulseHex;

  const svgHtml = `
    <div style="position: relative; width: 28px; height: 28px; display: flex; align-items: center; justify-content: center;">
      <div style="position: absolute; width: 28px; height: 28px; background-color: ${pulseColor}; opacity: 0.35; border-radius: 50%; animation: ping 1.5s cubic-bezier(0, 0, 0.2, 1) infinite;"></div>
      <div style="width: 20px; height: 20px; background-color: ${bgColor}; border: 2px solid white; border-radius: 50%; box-shadow: 0 2px 4px rgba(0,0,0,0.3); display: flex; align-items: center; justify-content: center;">
        <div style="width: 6px; height: 6px; background-color: white; border-radius: 50%;"></div>
      </div>
    </div>
  `;

  return L.divIcon({
    html: svgHtml,
    className: 'custom-leaflet-marker',
    iconSize: [28, 28],
    iconAnchor: [14, 14],
    popupAnchor: [0, -14]
  });
};

const ALL_SEVEN_MUNICIPAL_DEPARTMENTS = [
  { id: 'all', name: 'All Municipal Departments', code: 'ALL', icon: Building2 },
  { id: 'dept-pwd-001', name: 'Roads & Public Works (PWD)', code: 'PWD', icon: Wrench },
  { id: 'dept-san-001', name: 'Sanitation & Waste Management', code: 'SAN', icon: Trash2 },
  { id: 'dept-wtr-001', name: 'Water Supply & Sewerage Board', code: 'WTR', icon: Droplets },
  { id: 'dept-drn-001', name: 'Drainage & Sewage Department', code: 'DRN', icon: Waves },
  { id: 'dept-ele-001', name: 'Electrical & Street Lighting Dept', code: 'ELE', icon: Zap },
  { id: 'dept-trf-001', name: 'Traffic Management Dept', code: 'TRF', icon: Activity },
  { id: 'dept-mnt-001', name: 'Maintenance Department', code: 'MNT', icon: Wrench }
];

export const AdminDepartmentDashboardPage: React.FC = () => {
  const { t } = useLanguage();
  const navigate = useNavigate();

  const [selectedDeptId, setSelectedDeptId] = useState<string>('all');
  const [complaints, setComplaints] = useState<Complaint[]>([]);
  const [staffMembers, setStaffMembers] = useState<ServiceStaffMemberRecord[]>([]);
  const [headSummaries, setHeadSummaries] = useState<DepartmentLeadershipSummary[]>([]);
  const [dbDepartments, setDbDepartments] = useState<MunicipalDepartment[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Map layer filter & search
  const [mapLayerTab, setMapLayerTab] = useState<'All' | 'Active Tasks' | 'Overdue' | 'Critical' | 'Completed'>('All');
  const [searchQuery, setSearchQuery] = useState('');

  // Load Real Database Data
  const loadData = useCallback(async () => {
    setLoading(true);
    setErrorMsg(null);
    try {
      const [compList, heads, depts, staffRes] = await Promise.all([
        getAllComplaints(),
        getDepartmentHeads(),
        getDepartments(),
        fetchDepartmentStaffApi().catch(() => ({ staff: [] }))
      ]);

      setComplaints(compList);
      setHeadSummaries(heads);
      setDbDepartments(depts);

      const staff: ServiceStaffMemberRecord[] = (staffRes?.staff || []).map((s: any) => ({
        id: String(s.id),
        name: s.name,
        employee_id: s.employee_id || `STF-${s.id}`,
        department_name: s.department_name || 'Municipal Department',
        role: s.designation || 'Service Staff',
        status: (s.status || 'Active').toLowerCase() === 'active' ? 'Available' : 'Offline',
        contact_number: s.mobile || s.contact_number || '+91 98220 00000',
        email: s.email,
        ward_area: 'Nashik City',
        joined_date: s.created_at || new Date().toISOString(),
        created_at: s.created_at || new Date().toISOString(),
        active_tasks: s.active_tasks || 0,
        completed_tasks: s.completed_tasks || 0,
        overdue_tasks: s.overdue_tasks || 0
      }));
      setStaffMembers(staff);
    } catch (e: any) {
      console.error('Error loading department dashboard data:', e);
      setErrorMsg('Unable to load department dashboard data from database.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  useRealtimeComplaints(useCallback(() => {
    loadData();
  }, [loadData]));

  useEffect(() => {
    if (!isSupabaseConfigured()) return;
    const channel = supabase
      .channel('realtime_admin_dept_dashboard')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'department_heads' }, () => {
        loadData();
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'complaints' }, () => {
        loadData();
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [loadData]);

  const now = useMemo(() => new Date(), []);

  // Helper matching complaint to selected department (using authoritative matching layer)
  const isComplaintMatch = useCallback((c: Complaint, deptId: string) => {
    if (deptId === 'all') return true;
    return matchComplaintToDepartment(c, deptId, dbDepartments);
  }, [dbDepartments]);

  // Filtered Complaints for Selected Department
  const deptComplaints = useMemo(() => {
    return complaints.filter((c) => isComplaintMatch(c, selectedDeptId));
  }, [complaints, selectedDeptId, isComplaintMatch]);

  // Selected Department Meta Information
  const currentDeptMeta = useMemo(() => {
    return ALL_SEVEN_MUNICIPAL_DEPARTMENTS.find((d) => d.id === selectedDeptId) || ALL_SEVEN_MUNICIPAL_DEPARTMENTS[0];
  }, [selectedDeptId]);

  // Active Staff Members Count for Selected Department
  const deptStaffCount = useMemo(() => {
    if (selectedDeptId === 'all') return staffMembers.filter((s) => s.status !== 'Offline' && s.status !== 'On Leave').length;
    const currentCode = currentDeptMeta.code.toLowerCase();
    return staffMembers.filter((s) => {
      if (s.status === 'Offline' || s.status === 'On Leave') return false;
      const sDeptName = (s.department_name || '').toLowerCase();
      const sDeptId = String((s as any).department_id || '').toLowerCase();
      return sDeptName.includes(currentCode) || sDeptId.includes(currentCode);
    }).length;
  }, [staffMembers, selectedDeptId, currentDeptMeta]);

  // Find Department Head Name dynamically from Supabase / DB
  const currentDeptHeadName = useMemo(() => {
    if (selectedDeptId === 'all') return 'City Executive Leadership';
    const match = headSummaries.find(
      (s) => s.deptCode.toLowerCase() === currentDeptMeta.code.toLowerCase() || s.deptId === selectedDeptId
    );
    if (match && match.hasActiveHead) {
      return `${match.headName} (${match.headEmail})`;
    }
    return 'No Active Head';
  }, [headSummaries, selectedDeptId, currentDeptMeta]);

  // Calculate Real Performance Metrics from Database Records (No fake 100% or fake 18.4 hrs)
  const metrics = useMemo(() => {
    const total = deptComplaints.length;
    const newComplaints = deptComplaints.filter((c) => c.status === 'Submitted' || c.status === 'Verified').length;
    const pending = deptComplaints.filter((c) => c.status === 'Approved' || c.status === 'Department Assigned').length;
    const assigned = deptComplaints.filter((c) => c.status === 'Staff Assigned').length;
    const inProgress = deptComplaints.filter((c) => c.status === 'In Progress' || c.status === 'Accepted' || c.status === 'On the Way').length;
    const pendingReview = deptComplaints.filter((c) => c.status === 'Resolution Submitted').length;
    
    const overdue = deptComplaints.filter((c) => {
      if (c.status === 'Resolved' || c.status === 'Rejected' || !c.sla_deadline) return false;
      return new Date(c.sla_deadline) < now;
    }).length;

    const completed = deptComplaints.filter((c) => c.status === 'Resolution Submitted' || c.status === 'Resolved').length;
    const resolved = deptComplaints.filter((c) => c.status === 'Resolved').length;
    const critical = deptComplaints.filter((c) => c.priority === 'Critical' && c.status !== 'Resolved' && c.status !== 'Rejected').length;

    if (total === 0) {
      return {
        total: 0,
        newComplaints: 0,
        pending: 0,
        assigned: 0,
        inProgress: 0,
        pendingReview: 0,
        overdue: 0,
        completed: 0,
        resolved: 0,
        critical: 0,
        resolutionRate: 'N/A',
        resolutionRateNum: 0,
        slaCompliance: 'N/A',
        slaComplianceNum: 0,
        overdueRate: '0.0%',
        avgResolutionTime: 'N/A'
      };
    }

    const resolutionRateNum = (resolved / total) * 100;
    const resolutionRate = `${resolutionRateNum.toFixed(1)}%`;
    const slaComplianceNum = ((total - overdue) / total) * 100;
    const slaCompliance = `${slaComplianceNum.toFixed(1)}%`;
    const overdueRate = `${((overdue / total) * 100).toFixed(1)}%`;

    // Average resolution time
    let totalHours = 0;
    let resolvedCount = 0;
    deptComplaints.forEach((c) => {
      if (c.status === 'Resolved' && c.created_at && c.updated_at) {
        const diff = new Date(c.updated_at).getTime() - new Date(c.created_at).getTime();
        if (diff > 0) {
          totalHours += diff / (1000 * 3600);
          resolvedCount += 1;
        }
      }
    });
    const avgResolutionTime = resolvedCount > 0 ? `${(totalHours / resolvedCount).toFixed(1)} hrs` : 'N/A';

    return {
      total,
      newComplaints,
      pending,
      assigned,
      inProgress,
      pendingReview,
      overdue,
      completed,
      resolved,
      critical,
      resolutionRate,
      resolutionRateNum,
      slaCompliance,
      slaComplianceNum,
      overdueRate,
      avgResolutionTime
    };
  }, [deptComplaints, now]);

  // Seven Department Comparison Grid (Real Data)
  const sevenDepartmentComparisonCards = useMemo(() => {
    return ALL_SEVEN_MUNICIPAL_DEPARTMENTS.filter((d) => d.id !== 'all').map((dept) => {
      const list = complaints.filter((c) => isComplaintMatch(c, dept.id));
      const total = list.length;
      const inProgress = list.filter((c) => c.status === 'In Progress' || c.status === 'Accepted' || c.status === 'On the Way' || c.status === 'Staff Assigned').length;
      const overdue = list.filter((c) => c.status !== 'Resolved' && c.status !== 'Rejected' && c.sla_deadline && new Date(c.sla_deadline) < now).length;
      const resolved = list.filter((c) => c.status === 'Resolved').length;
      const resolutionRate = total > 0 ? `${((resolved / total) * 100).toFixed(0)}%` : 'N/A';
      const match = headSummaries.find((s) => s.deptCode.toLowerCase() === dept.code.toLowerCase() || s.deptId === dept.id);
      const headName = match && match.hasActiveHead ? match.headName : 'No Active Head';

      return {
        id: dept.id,
        name: dept.name,
        code: dept.code,
        icon: dept.icon,
        headName,
        total,
        inProgress,
        overdue,
        resolved,
        resolutionRate
      };
    });
  }, [complaints, headSummaries, isComplaintMatch, now]);

  // Filter map plottable complaints
  const mapPlottableComplaints = useMemo(() => {
    return deptComplaints.filter((c) => {
      if (typeof c.latitude !== 'number' || typeof c.longitude !== 'number' || isNaN(c.latitude) || isNaN(c.longitude) || c.latitude === 0 || c.longitude === 0) return false;
      if (mapLayerTab === 'Active Tasks' && c.status !== 'In Progress' && c.status !== 'Accepted' && c.status !== 'On the Way' && c.status !== 'Staff Assigned') return false;
      if (mapLayerTab === 'Overdue' && (c.status === 'Resolved' || !c.sla_deadline || new Date(c.sla_deadline) >= now)) return false;
      if (mapLayerTab === 'Critical' && c.priority !== 'Critical') return false;
      if (mapLayerTab === 'Completed' && c.status !== 'Resolved') return false;

      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const numMatch = c.complaint_number.toLowerCase().includes(q);
        const titleMatch = c.title.toLowerCase().includes(q);
        const locMatch = (c.location_address || '').toLowerCase().includes(q);
        if (!numMatch && !titleMatch && !locMatch) return false;
      }

      return true;
    });
  }, [deptComplaints, mapLayerTab, searchQuery, now]);

  // Real recent activity events from database records
  const recentActivityLogs = useMemo(() => {
    if (deptComplaints.length === 0) return [];
    return deptComplaints.slice(0, 5).map((c, i) => {
      let eventTitle = `Complaint ${c.complaint_number} updated to ${c.status}`;
      if (c.status === 'Submitted' || c.status === 'Verified') eventTitle = `New complaint received (${c.complaint_number})`;
      if (c.status === 'In Progress') eventTitle = `Work started on ${c.complaint_number} (${c.title})`;
      if (c.status === 'Staff Assigned') eventTitle = `Task assigned to ${c.assigned_staff_name || 'Field Staff'}`;
      if (c.status === 'Resolution Submitted') eventTitle = `Work proof uploaded for ${c.complaint_number}`;
      if (c.status === 'Resolved') eventTitle = `Resolution verified & closed for ${c.complaint_number}`;

      const eventTime = c.updated_at
        ? new Date(c.updated_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        : c.created_at
        ? new Date(c.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        : 'Recently';

      return {
        id: `act-${c.id}-${i}`,
        title: eventTitle,
        subtitle: `Location: ${c.location_address || 'Nashik'} • Priority: ${c.priority}`,
        time: eventTime,
        compNum: c.complaint_number
      };
    });
  }, [deptComplaints]);

  return (
    <DashboardLayout title={t('departmentDashboard') || "Department Performance Dashboard"}>
      <div className="p-4 sm:p-5 space-y-5 max-w-[1600px] mx-auto text-gray-900 bg-white min-h-screen font-sans">
        
        {/* ERROR STATE ALERT */}
        {errorMsg && (
          <div className="p-4 bg-rose-50 border border-rose-200 rounded-xl flex items-center justify-between text-rose-800 text-xs">
            <div className="flex items-center space-x-2">
              <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0" />
              <span>{errorMsg}</span>
            </div>
            <button
              onClick={loadData}
              className="px-3 py-1 bg-rose-600 hover:bg-rose-700 text-white rounded-md font-bold transition-colors"
            >
              Retry
            </button>
          </div>
        )}

        {/* ================================================== */}
        {/* 1. CLASSIC DEPARTMENT HEADER CARD */}
        {/* ================================================== */}
        <div className="bg-slate-50 p-4 rounded-xl border border-gray-200 flex flex-col md:flex-row md:items-center justify-between gap-3 shadow-2xs">
          <div className="flex items-center space-x-3">
            <div className="p-2.5 bg-emerald-600 text-white rounded-lg shadow-2xs shrink-0">
              <currentDeptMeta.icon className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center space-x-2 flex-wrap">
                <h1 className="text-lg sm:text-xl font-extrabold text-gray-900 font-outfit tracking-tight">
                  {currentDeptMeta.name}
                </h1>
                <span className="font-mono text-[9px] font-extrabold bg-white text-emerald-800 px-2 py-0.5 rounded border border-emerald-300">
                  CITY ADMIN OVERVIEW
                </span>
              </div>
              <p className="text-xs text-gray-600 font-medium mt-0.5">
                Head: <strong className="text-gray-900 font-outfit">{currentDeptHeadName}</strong> • Staff: <strong className="text-gray-900 font-outfit">{deptStaffCount} Active Members</strong>
              </p>
            </div>
          </div>

          <div className="flex items-center space-x-2 shrink-0">
            {/* DEPARTMENT SELECTOR DROPDOWN (ALL 7 DEPARTMENTS) */}
            <select aria-label="selected Dept Id"
              value={selectedDeptId}
              onChange={(e) => setSelectedDeptId(e.target.value)}
              className="bg-white border-2 border-emerald-500 rounded-lg px-3 py-2 text-xs text-gray-900 font-extrabold shadow-2xs focus:outline-none focus:ring-2 focus:ring-emerald-500 min-h-[38px] font-outfit cursor-pointer"
            >
              {ALL_SEVEN_MUNICIPAL_DEPARTMENTS.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.id === 'all' ? 'All Municipal Departments ▼' : `${d.name} (${d.code})`}
                </option>
              ))}
            </select>

            <button
              onClick={loadData}
              disabled={loading}
              className="p-2 rounded-lg bg-white text-gray-700 border border-gray-200 hover:bg-gray-50 transition-colors min-h-[38px]"
              title="Refresh Data"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            </button>
          </div>
        </div>

        {/* ================================================== */}
        {/* 2. COMPACT SUMMARY KPI CARDS ROW (10 COLUMNS) */}
        {/* ================================================== */}
        <div className="grid grid-cols-2 sm:grid-cols-5 lg:grid-cols-10 border border-gray-200 rounded-xl divide-x divide-y sm:divide-y-0 divide-gray-200 bg-white shadow-2xs overflow-hidden text-xs">
          <div className="p-2.5 text-center space-y-0.5">
            <span className="text-[9px] font-bold text-gray-500 uppercase block font-outfit">Total</span>
            <span className="text-lg font-extrabold text-gray-900 font-mono block">{metrics.total}</span>
          </div>

          <div className="p-2.5 text-center space-y-0.5">
            <span className="text-[9px] font-bold text-gray-500 uppercase block font-outfit">New</span>
            <span className="text-lg font-extrabold text-blue-700 font-mono block">{metrics.newComplaints}</span>
          </div>

          <div className="p-2.5 text-center space-y-0.5">
            <span className="text-[9px] font-bold text-gray-500 uppercase block font-outfit">Pending</span>
            <span className="text-lg font-extrabold text-yellow-700 font-mono block">{metrics.pending}</span>
          </div>

          <div className="p-2.5 text-center space-y-0.5">
            <span className="text-[9px] font-bold text-gray-500 uppercase block font-outfit">Assigned</span>
            <span className="text-lg font-extrabold text-indigo-700 font-mono block">{metrics.assigned}</span>
          </div>

          <div className="p-2.5 text-center space-y-0.5 bg-amber-50/40">
            <span className="text-[9px] font-bold text-amber-800 uppercase block font-outfit">In Progress</span>
            <span className="text-lg font-extrabold text-amber-700 font-mono block">{metrics.inProgress}</span>
          </div>

          <div className="p-2.5 text-center space-y-0.5">
            <span className="text-[9px] font-bold text-gray-500 uppercase block font-outfit">Review</span>
            <span className="text-lg font-extrabold text-purple-700 font-mono block">{metrics.pendingReview}</span>
          </div>

          <div className="p-2.5 text-center space-y-0.5 bg-rose-50/40">
            <span className="text-[9px] font-bold text-rose-800 uppercase block font-outfit">Overdue</span>
            <span className="text-lg font-extrabold text-rose-700 font-mono block">{metrics.overdue}</span>
          </div>

          <div className="p-2.5 text-center space-y-0.5">
            <span className="text-[9px] font-bold text-gray-500 uppercase block font-outfit">Critical</span>
            <span className="text-lg font-extrabold text-rose-900 font-mono block">{metrics.critical}</span>
          </div>

          <div className="p-2.5 text-center space-y-0.5 bg-emerald-50/40">
            <span className="text-[9px] font-bold text-emerald-800 uppercase block font-outfit">Resolved</span>
            <span className="text-lg font-extrabold text-emerald-700 font-mono block">{metrics.resolved}</span>
          </div>

          <div className="p-2.5 text-center space-y-0.5 bg-slate-50">
            <span className="text-[9px] font-bold text-gray-500 uppercase block font-outfit">SLA Rate</span>
            <span className="text-lg font-extrabold text-emerald-800 font-mono block">{metrics.resolutionRate}</span>
          </div>
        </div>

        {/* ================================================== */}
        {/* 3. ROW 1: DEPARTMENT PERFORMANCE & COMPLAINT STATUS BREAKDOWN */}
        {/* ================================================== */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          
          {/* LEFT: DEPARTMENT PERFORMANCE & SLA METRICS CARD */}
          <div className="p-4 bg-white border border-gray-200 rounded-xl space-y-3.5 shadow-2xs text-xs">
            <div className="flex items-center justify-between border-b border-gray-200 pb-2">
              <div className="flex items-center space-x-2">
                <TrendingUp className="w-4 h-4 text-emerald-600" />
                <h3 className="font-extrabold text-gray-900 font-outfit text-xs uppercase tracking-wider">
                  Department Performance & SLA Compliance
                </h3>
              </div>
              <span className="font-mono text-[10px] text-gray-500 font-bold">REAL DATABASE METRICS</span>
            </div>

            <div className="space-y-3">
              {/* Resolution Rate */}
              <div className="space-y-1">
                <div className="flex justify-between font-bold">
                  <span className="text-gray-700">Resolution Efficiency Rate</span>
                  <span className="font-mono text-emerald-700">{metrics.resolutionRate}</span>
                </div>
                <div className="w-full bg-gray-100 rounded-full h-2 overflow-hidden">
                  <div className="bg-emerald-600 h-full rounded-full transition-all" style={{ width: `${Math.min(100, Math.max(0, metrics.resolutionRateNum))}%` }} />
                </div>
              </div>

              {/* SLA Compliance Rate */}
              <div className="space-y-1">
                <div className="flex justify-between font-bold">
                  <span className="text-gray-700">SLA Compliance Rate</span>
                  <span className="font-mono text-blue-700">{metrics.slaCompliance}</span>
                </div>
                <div className="w-full bg-gray-100 rounded-full h-2 overflow-hidden">
                  <div className="bg-blue-600 h-full rounded-full transition-all" style={{ width: `${Math.min(100, Math.max(0, metrics.slaComplianceNum))}%` }} />
                </div>
              </div>

              {/* Average Resolution Time & Overdue Rate */}
              <div className="grid grid-cols-2 gap-3 pt-1">
                <div className="p-2.5 bg-slate-50 rounded-lg border border-gray-200 space-y-0.5">
                  <span className="text-[10px] text-gray-500 font-bold block uppercase font-outfit">Avg Resolution Time</span>
                  <span className="text-sm font-extrabold text-gray-900 font-mono block">{metrics.avgResolutionTime}</span>
                </div>

                <div className="p-2.5 bg-slate-50 rounded-lg border border-gray-200 space-y-0.5">
                  <span className="text-[10px] text-gray-500 font-bold block uppercase font-outfit">SLA Overdue Rate</span>
                  <span className="text-sm font-extrabold text-rose-700 font-mono block">{metrics.overdueRate}</span>
                </div>
              </div>
            </div>
          </div>

          {/* RIGHT: COMPLAINT STATUS BREAKDOWN CARD */}
          <div className="p-4 bg-white border border-gray-200 rounded-xl space-y-3.5 shadow-2xs text-xs">
            <div className="flex items-center justify-between border-b border-gray-200 pb-2">
              <div className="flex items-center space-x-2">
                <BarChart2 className="w-4 h-4 text-emerald-600" />
                <h3 className="font-extrabold text-gray-900 font-outfit text-xs uppercase tracking-wider">
                  Complaint Status Breakdown
                </h3>
              </div>
              <span className="font-mono text-[10px] font-bold text-gray-500">{deptComplaints.length} Total</span>
            </div>

            <div className="space-y-2">
              {[
                { label: 'New / Verified', count: metrics.newComplaints, color: 'bg-blue-600' },
                { label: 'Pending Dept Assignment', count: metrics.pending, color: 'bg-yellow-600' },
                { label: 'Staff Assigned', count: metrics.assigned, color: 'bg-indigo-600' },
                { label: 'In Progress / On Task', count: metrics.inProgress, color: 'bg-amber-600' },
                { label: 'Pending Review', count: metrics.pendingReview, color: 'bg-purple-600' },
                { label: 'Overdue SLA Breached', count: metrics.overdue, color: 'bg-rose-600' },
                { label: 'Resolved & Closed', count: metrics.resolved, color: 'bg-emerald-600' }
              ].map((item) => (
                <div key={item.label} className="flex items-center justify-between space-x-3 text-xs">
                  <div className="w-36 font-semibold text-gray-700 truncate">{item.label}</div>
                  <div className="flex-1 bg-gray-100 rounded-full h-2 overflow-hidden">
                    <div className={`${item.color} h-full rounded-full`} style={{ width: `${deptComplaints.length > 0 ? (item.count / deptComplaints.length) * 100 : 0}%` }} />
                  </div>
                  <span className="w-8 text-right font-mono font-extrabold text-gray-900">{item.count}</span>
                </div>
              ))}
            </div>
          </div>

        </div>

        {/* ================================================== */}
        {/* 4. ROW 2: COMPACT DEPARTMENT MAP (60%) + RECENT ACTIVITY (40%) */}
        {/* ================================================== */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
          
          {/* LEFT: COMPACT DEPARTMENT MAP CARD (COL 7 / 60% WIDTH) */}
          <div className="lg:col-span-7 p-4 bg-slate-50 border border-gray-200 rounded-xl space-y-3 shadow-2xs">
            <div className="flex items-center justify-between border-b border-gray-200 pb-2">
              <div className="flex items-center space-x-2">
                <Compass className="w-4 h-4 text-emerald-600" />
                <h3 className="font-extrabold text-gray-900 font-outfit text-xs uppercase tracking-wider">
                  Department Map ({mapPlottableComplaints.length} Plotted)
                </h3>
              </div>

              <div className="flex items-center space-x-2">
                {/* MAP LAYER FILTERS */}
                <div className="hidden sm:flex items-center space-x-1 text-[11px] font-bold font-outfit">
                  {(['All', 'Active Tasks', 'Overdue', 'Critical', 'Completed'] as const).map((layer) => (
                    <button
                      key={layer}
                      onClick={() => setMapLayerTab(layer)}
                      className={`px-2 py-0.5 rounded transition-all ${
                        mapLayerTab === layer
                          ? 'bg-emerald-600 text-white font-extrabold'
                          : 'bg-white text-gray-700 border border-gray-200 hover:bg-slate-100'
                      }`}
                    >
                      {layer}
                    </button>
                  ))}
                </div>

                <Link
                  to="/admin/map"
                  className="px-2.5 py-1 bg-white border border-gray-300 hover:bg-gray-100 text-gray-800 font-extrabold text-[11px] rounded-lg transition-colors inline-flex items-center space-x-1"
                >
                  <Maximize2 className="w-3 h-3 text-emerald-600" />
                  <span>View Full Map</span>
                </Link>
              </div>
            </div>

            {/* COMPACT MAP CONTAINER (HEIGHT: 340px) */}
            <div className="relative rounded-xl overflow-hidden border border-gray-200 shadow-2xs bg-slate-100 h-[340px] z-10">
              <MapContainer
                center={[20.0059, 73.7898]}
                zoom={12}
                style={{ width: '100%', height: '100%' }}
                scrollWheelZoom={true}
              >
                <TileLayer
                  attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
                  url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                />

                {mapPlottableComplaints.map((comp) => {
                  const markerIcon = createCustomMapMarkerIcon(comp.priority);
                  return (
                    <Marker key={comp.id} position={[comp.latitude, comp.longitude]} icon={markerIcon}>
                      <Popup>
                        <div className="p-1 space-y-1.5 text-xs font-sans max-w-xs">
                          <div className="flex items-center justify-between border-b border-gray-200 pb-1">
                            <span className="font-mono font-bold text-emerald-800">{comp.complaint_number}</span>
                            <PriorityBadge priority={comp.priority} />
                          </div>
                          <h4 className="font-extrabold text-gray-900 text-xs font-outfit">{comp.title}</h4>
                          <p className="text-[10px] text-gray-600 truncate">{comp.location_address || 'Nashik'}</p>
                          <StatusBadge status={comp.status} />
                        </div>
                      </Popup>
                    </Marker>
                  );
                })}
              </MapContainer>

              {/* COMPACT MAP FOOTER LEGEND */}
              <div className="absolute bottom-2 left-2 bg-white/95 backdrop-blur-xs px-2.5 py-1.5 rounded-lg border border-gray-200 shadow-sm z-20 text-[10px] font-mono flex items-center space-x-3">
                <div className="flex items-center space-x-1">
                  <span className="w-2 h-2 rounded-full bg-rose-600 inline-block"></span>
                  <span className="font-bold text-gray-800">Critical</span>
                </div>
                <div className="flex items-center space-x-1">
                  <span className="w-2 h-2 rounded-full bg-amber-600 inline-block"></span>
                  <span className="font-bold text-gray-800">Active</span>
                </div>
                <div className="flex items-center space-x-1">
                  <span className="w-2 h-2 rounded-full bg-emerald-600 inline-block"></span>
                  <span className="font-bold text-gray-800">Completed</span>
                </div>
              </div>
            </div>
          </div>

          {/* RIGHT: RECENT DEPARTMENT ACTIVITY LOG CARD (COL 5 / 40% WIDTH) */}
          <div className="lg:col-span-5 p-4 bg-white border border-gray-200 rounded-xl space-y-3 shadow-2xs text-xs">
            <div className="flex items-center justify-between border-b border-gray-200 pb-2">
              <div className="flex items-center space-x-2">
                <Activity className="w-4 h-4 text-emerald-600" />
                <h3 className="font-extrabold text-gray-900 font-outfit text-xs uppercase tracking-wider">
                  Recent Department Activity
                </h3>
              </div>

              <Link to="/admin/complaints" className="text-[11px] font-bold text-emerald-700 hover:underline">
                View All
              </Link>
            </div>

            {recentActivityLogs.length === 0 ? (
              <div className="p-8 text-center text-gray-400 font-medium">No recent activity.</div>
            ) : (
              <div className="space-y-2.5">
                {recentActivityLogs.map((log) => (
                  <div key={log.id} className="p-2.5 bg-slate-50 rounded-lg border border-gray-200 space-y-1">
                    <div className="flex items-center justify-between">
                      <span className="font-extrabold text-gray-900 font-outfit text-xs">{log.title}</span>
                      <span className="font-mono text-[10px] text-gray-400">{log.time}</span>
                    </div>
                    <p className="text-[11px] text-gray-600 font-medium truncate">{log.subtitle}</p>
                  </div>
                ))}
              </div>
            )}
          </div>

        </div>

        {/* ================================================== */}
        {/* 5. ROW 3: DEPARTMENT STAFF OVERVIEW & RECENT TASKS TABLE */}
        {/* ================================================== */}
        <div className="p-4 bg-white border border-gray-200 rounded-xl space-y-3.5 shadow-2xs text-xs">
          <div className="flex items-center justify-between border-b border-gray-200 pb-2">
            <div className="flex items-center space-x-2">
              <Users className="w-4 h-4 text-emerald-600" />
              <h3 className="font-extrabold text-gray-900 font-outfit text-xs uppercase tracking-wider">
                Department Staff & Operational Tasks ({deptComplaints.length})
              </h3>
            </div>

            <Link
              to={`/admin/staff${currentDeptMeta.code !== 'ALL' ? `?department=${currentDeptMeta.code}` : ''}`}
              className="px-3 py-1 bg-emerald-600 hover:bg-emerald-700 text-white font-extrabold text-xs rounded-lg transition-colors inline-flex items-center space-x-1"
            >
              <span>View Staff Roster</span>
              <ChevronRight className="w-3.5 h-3.5" />
            </Link>
          </div>

          {deptComplaints.length === 0 ? (
            <div className="p-8 text-center text-gray-400 font-medium">
              No active tasks or complaints found for this department.
            </div>
          ) : (
            <div className="w-full overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="bg-slate-50 border-b border-gray-200 text-gray-700 uppercase font-mono text-[10px] font-extrabold">
                    <th className="p-3">Complaint ID</th>
                    <th className="p-3">Issue Title</th>
                    <th className="p-3">Location Address</th>
                    <th className="p-3 text-center">Priority</th>
                    <th className="p-3 text-center">Status</th>
                    <th className="p-3">Assigned Field Staff</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  {deptComplaints.slice(0, 6).map((comp) => (
                    <tr key={comp.id} className="hover:bg-slate-50/80">
                      <td className="p-3 font-mono text-emerald-800 font-bold">{comp.complaint_number}</td>
                      <td className="p-3 font-bold text-gray-900">{comp.title}</td>
                      <td className="p-3 text-gray-600">{comp.location_address || 'Nashik'}</td>
                      <td className="p-3 text-center"><PriorityBadge priority={comp.priority} /></td>
                      <td className="p-3 text-center"><StatusBadge status={comp.status} /></td>
                      <td className="p-3 font-semibold text-gray-800">{comp.assigned_staff_name || 'Unassigned'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

      </div>
    </DashboardLayout>
  );
};
