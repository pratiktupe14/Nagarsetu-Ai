import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { DashboardLayout } from '../../components/DashboardLayout';
import { StatusBadge } from '../../components/StatusBadge';
import { PriorityBadge } from '../../components/PriorityBadge';
import { ActivityTimeline } from '../../components/ActivityTimeline';
import { getAllComplaints } from '../../services/complaintService';
import { formatSlaRemainingTime } from '../../services/adminService';
import { exportComplaintsToCSV } from '../../services/analyticsService';
import { Complaint } from '../../types/database.types';
import { CitizenFeedbackCard } from '../../components/CitizenFeedbackCard';
import { useRealtimeComplaints } from '../../hooks/useRealtimeComplaints';
import { getValidImageUrl, DEFAULT_CIVIC_IMAGE_PLACEHOLDER } from '../../lib/supabase';
import {
  Search, Download, RefreshCw, Star, MapPin, Clock,
  CheckCircle2, AlertTriangle, ArrowUpDown, ChevronLeft, ChevronRight,
  X, Maximize2, Building2, MessageSquare, FileCheck
} from 'lucide-react';

const DEPARTMENT_OPTIONS = [
  'Roads & Public Works',
  'Sanitation & Solid Waste',
  'Water Supply & Sewerage',
  'Electrical & Lighting',
  'Drainage & Stormwater',
  'Traffic Management'
];

const CATEGORY_OPTIONS = [
  'Pothole',
  'Overflowing Dustbin',
  'Water Leakage',
  'Streetlight',
  'Drainage Overflow',
  'Traffic Signal'
];

const WARD_OPTIONS = [
  'Ward 1',
  'Ward 4',
  'Ward 8',
  'Ward 12',
  'Ward 15',
  'Ward 20'
];

type SortField = 'complaint_number' | 'created_at' | 'updated_at' | 'resolution_hours' | 'department_name' | 'priority' | 'rating';

export const AdminResolvedComplaintsPage: React.FC = () => {
  const [complaints, setComplaints] = useState<Complaint[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filters State
  const [searchQuery, setSearchQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('All');
  const [departmentFilter, setDepartmentFilter] = useState('All');
  const [priorityFilter, setPriorityFilter] = useState('All');
  const [wardFilter, setWardFilter] = useState('All');
  const [dateFilter, setDateFilter] = useState('All Time');
  const [slaFilter, setSlaFilter] = useState('All');
  const [ratingFilter, setRatingFilter] = useState('All');
  const [statusFilter, setStatusFilter] = useState('All');

  // Sorting State
  const [sortField, setSortField] = useState<SortField>('updated_at');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');

  // Pagination State
  const [currentPage, setCurrentPage] = useState(1);
  const pageSize = 10;

  // Selected Complaint for Detail Drawer / Modal
  const [selectedComplaint, setSelectedComplaint] = useState<Complaint | null>(null);
  const [activeTab, setActiveTab] = useState<'proof' | 'details' | 'feedback' | 'timeline'>('proof');
  const [showFullImageModal, setShowFullImageModal] = useState<string | null>(null);

  // Load Complaints Data
  const loadComplaints = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const list = await getAllComplaints();
      setComplaints(list);
    } catch (e) {
      console.error(e);
      setError('Unable to load resolved complaints.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadComplaints();
  }, [loadComplaints]);

  // Subscribe to realtime updates
  useRealtimeComplaints(useCallback(() => {
    loadComplaints();
  }, [loadComplaints]));

  // Filter complaints that have resolution history: 'Resolved', 'Resolution Submitted', or 'Reopened'
  const resolvedList = useMemo(() => {
    return complaints.filter((c) => {
      return c.status === 'Resolved' || c.status === 'Resolution Submitted' || c.status === 'Reopened';
    });
  }, [complaints]);

  // Helper for resolution time calculation in hours & minutes
  const calculateResolutionTime = useCallback((c: Complaint): { hours: number; text: string } => {
    const start = new Date(c.created_at).getTime();
    const end = new Date(c.updated_at).getTime();
    const diffMs = Math.max(0, end - start);
    const totalMins = Math.floor(diffMs / 60000);
    const hours = Math.floor(totalMins / 60);
    const mins = totalMins % 60;
    return {
      hours,
      text: hours > 0 ? `${hours}h ${mins}m` : `${mins}m`
    };
  }, []);

  // Compute Summary Statistics
  const summaryStats = useMemo(() => {
    const total = resolvedList.length;

    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const weekStart = todayStart - 6 * 86400000;

    const todayCount = resolvedList.filter((c) => new Date(c.updated_at).getTime() >= todayStart).length;
    const weekCount = resolvedList.filter((c) => new Date(c.updated_at).getTime() >= weekStart).length;

    const citizenVerifiedCount = resolvedList.filter((c) => c.rating && c.rating >= 4).length;
    const reopenedCount = resolvedList.filter((c) => c.status === 'Reopened').length;

    // Calculate Average Resolution Time
    let totalHours = 0;
    let validCount = 0;
    resolvedList.forEach((c) => {
      const res = calculateResolutionTime(c);
      totalHours += res.hours;
      validCount++;
    });

    const avgHours = validCount > 0 ? (totalHours / validCount).toFixed(1) : '0.0';

    return {
      total,
      todayCount,
      weekCount,
      citizenVerifiedCount,
      reopenedCount,
      avgHours
    };
  }, [resolvedList, calculateResolutionTime]);

  // Filtered List based on search and selected filters
  const filteredList = useMemo(() => {
    return resolvedList.filter((c) => {
      // Search
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchesId = c.complaint_number.toLowerCase().includes(q);
        const matchesTitle = c.title.toLowerCase().includes(q);
        const matchesLoc = (c.location_address || '').toLowerCase().includes(q);
        const matchesStaff = (c.assigned_staff_name || '').toLowerCase().includes(q);
        if (!matchesId && !matchesTitle && !matchesLoc && !matchesStaff) return false;
      }

      // Category
      if (categoryFilter !== 'All' && c.category !== categoryFilter) return false;

      // Department
      if (departmentFilter !== 'All' && c.department_name && !c.department_name.toLowerCase().includes(departmentFilter.toLowerCase())) return false;

      // Priority
      if (priorityFilter !== 'All' && c.priority !== priorityFilter) return false;

      // Ward / Area
      if (wardFilter !== 'All' && c.location_address && !c.location_address.toLowerCase().includes(wardFilter.toLowerCase())) return false;

      // Status
      if (statusFilter !== 'All' && c.status !== statusFilter) return false;

      // Rating
      if (ratingFilter !== 'All') {
        if (ratingFilter === '5 Stars' && c.rating !== 5) return false;
        if (ratingFilter === '4+ Stars' && (!c.rating || c.rating < 4)) return false;
        if (ratingFilter === '3+ Stars' && (!c.rating || c.rating < 3)) return false;
        if (ratingFilter === 'No Feedback' && c.rating) return false;
      }

      // SLA Performance
      if (slaFilter !== 'All') {
        const slaInfo = formatSlaRemainingTime(c.sla_deadline);
        if (slaFilter === 'Within SLA' && slaInfo.isOverdue) return false;
        if (slaFilter === 'Breached SLA' && !slaInfo.isOverdue) return false;
      }

      // Resolved Date Filter
      if (dateFilter !== 'All Time') {
        const updatedTime = new Date(c.updated_at).getTime();
        const now = Date.now();
        if (dateFilter === 'Today' && now - updatedTime > 86400000) return false;
        if (dateFilter === 'Last 7 Days' && now - updatedTime > 7 * 86400000) return false;
        if (dateFilter === 'Last 30 Days' && now - updatedTime > 30 * 86400000) return false;
      }

      return true;
    });
  }, [resolvedList, searchQuery, categoryFilter, departmentFilter, priorityFilter, wardFilter, statusFilter, ratingFilter, slaFilter, dateFilter]);

  // Sorted List
  const sortedList = useMemo(() => {
    return [...filteredList].sort((a, b) => {
      let valA: any = a[sortField as keyof Complaint] || '';
      let valB: any = b[sortField as keyof Complaint] || '';

      if (sortField === 'resolution_hours') {
        valA = calculateResolutionTime(a).hours;
        valB = calculateResolutionTime(b).hours;
      } else if (sortField === 'created_at' || sortField === 'updated_at') {
        valA = new Date(valA).getTime();
        valB = new Date(valB).getTime();
      }

      if (valA < valB) return sortOrder === 'asc' ? -1 : 1;
      if (valA > valB) return sortOrder === 'asc' ? 1 : -1;
      return 0;
    });
  }, [filteredList, sortField, sortOrder, calculateResolutionTime]);

  // Paginated List
  const totalPages = Math.ceil(sortedList.length / pageSize) || 1;
  const paginatedList = useMemo(() => {
    const start = (currentPage - 1) * pageSize;
    return sortedList.slice(start, start + pageSize);
  }, [sortedList, currentPage, pageSize]);

  // Toggle sorting column
  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortOrder('desc');
    }
  };

  // Clear all filters
  const handleClearFilters = () => {
    setSearchQuery('');
    setCategoryFilter('All');
    setDepartmentFilter('All');
    setPriorityFilter('All');
    setWardFilter('All');
    setDateFilter('All Time');
    setSlaFilter('All');
    setRatingFilter('All');
    setStatusFilter('All');
    setCurrentPage(1);
  };

  // Render Star Rating component
  const renderStars = (rating?: number) => {
    if (!rating) {
      return <span className="text-xs text-gray-400 font-medium italic">No feedback yet</span>;
    }
    return (
      <div className="flex items-center space-x-1">
        <div className="flex text-amber-400">
          {[1, 2, 3, 4, 5].map((star) => (
            <Star
              key={star}
              className={`w-3.5 h-3.5 ${star <= rating ? 'fill-amber-400 text-amber-400' : 'text-gray-300'}`}
            />
          ))}
        </div>
        <span className="text-xs font-bold text-gray-700 ml-1 font-mono">{rating}.0/5</span>
      </div>
    );
  };

  return (
    <DashboardLayout title="Resolved Complaints">
      <div className="p-4 sm:p-6 lg:p-8 space-y-6 max-w-[1600px] mx-auto text-gray-900 bg-white min-h-screen">
        
        {/* ================================================== */}
        {/* 2. PAGE HEADER */}
        {/* ================================================== */}
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 border-b border-gray-200 pb-5">
          <div className="space-y-1">
            <div className="flex items-center space-x-3">
              <h1 className="text-2xl sm:text-3xl font-extrabold text-gray-900 tracking-tight font-outfit">
                Resolved Complaints
              </h1>
              <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-extrabold font-mono bg-emerald-50 text-emerald-800 border border-emerald-300">
                {summaryStats.total} Resolved Complaints
              </span>
            </div>
            <p className="text-sm text-gray-600 font-medium">
              Review completed civic complaints, resolution evidence and citizen feedback.
            </p>
          </div>

          <div className="flex items-center space-x-3 shrink-0">
            <button
              onClick={loadComplaints}
              disabled={loading}
              className="inline-flex items-center space-x-2 px-3.5 py-2 rounded-xl text-xs font-bold bg-white text-gray-700 border border-gray-300 hover:bg-gray-50 hover:border-gray-400 transition-colors shadow-xs"
            >
              <RefreshCw className={`w-3.5 h-3.5 text-gray-500 ${loading ? 'animate-spin' : ''}`} />
              <span>Refresh</span>
            </button>

            <button
              onClick={() => exportComplaintsToCSV(filteredList)}
              className="inline-flex items-center space-x-2 px-4 py-2 rounded-xl text-xs font-bold bg-emerald-600 text-white hover:bg-emerald-700 transition-colors shadow-sm"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Export Report</span>
            </button>
          </div>
        </div>

        {/* ================================================== */}
        {/* 3. SUMMARY BAR (Compact administrative summary with bordered sections) */}
        {/* ================================================== */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 border border-gray-200 rounded-xl divide-x divide-y sm:divide-y-0 divide-gray-200 bg-white shadow-xs overflow-hidden">
          
          <div className="p-3.5 text-center space-y-0.5">
            <span className="text-[11px] font-bold text-gray-500 uppercase tracking-wider block font-outfit">
              Total Resolved
            </span>
            <span className="text-xl font-extrabold text-gray-900 font-mono block">
              {summaryStats.total}
            </span>
          </div>

          <div className="p-3.5 text-center space-y-0.5">
            <span className="text-[11px] font-bold text-gray-500 uppercase tracking-wider block font-outfit">
              Resolved Today
            </span>
            <span className="text-xl font-extrabold text-emerald-700 font-mono block">
              {summaryStats.todayCount}
            </span>
          </div>

          <div className="p-3.5 text-center space-y-0.5">
            <span className="text-[11px] font-bold text-gray-500 uppercase tracking-wider block font-outfit">
              Resolved This Week
            </span>
            <span className="text-xl font-extrabold text-gray-900 font-mono block">
              {summaryStats.weekCount}
            </span>
          </div>

          <div className="p-3.5 text-center space-y-0.5">
            <span className="text-[11px] font-bold text-gray-500 uppercase tracking-wider block font-outfit">
              Citizen Verified
            </span>
            <span className="text-xl font-extrabold text-emerald-700 font-mono block">
              {summaryStats.citizenVerifiedCount}
            </span>
          </div>

          <div className="p-3.5 text-center space-y-0.5">
            <span className="text-[11px] font-bold text-gray-500 uppercase tracking-wider block font-outfit">
              Reopened
            </span>
            <span className="text-xl font-extrabold text-orange-700 font-mono block">
              {summaryStats.reopenedCount}
            </span>
          </div>

          <div className="p-3.5 text-center space-y-0.5">
            <span className="text-[11px] font-bold text-gray-500 uppercase tracking-wider block font-outfit">
              Avg Resolution Time
            </span>
            <span className="text-xl font-extrabold text-gray-900 font-mono block">
              {summaryStats.avgHours}h
            </span>
          </div>

        </div>

        {/* ================================================== */}
        {/* 4. FILTER TOOLBAR */}
        {/* ================================================== */}
        <div className="bg-slate-50 p-4 rounded-xl border border-gray-200 space-y-3">
          
          <div className="flex flex-col lg:flex-row items-stretch lg:items-center gap-3">
            {/* Search Input */}
            <div className="relative flex-1">
              <Search className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400" />
              <input aria-label="Search complaint ID, issue or location..."
                type="text"
                placeholder="Search complaint ID, issue or location..."
                value={searchQuery}
                onChange={(e) => {
                  setSearchQuery(e.target.value);
                  setCurrentPage(1);
                }}
                className="w-full pl-10 pr-4 py-2 bg-white border border-gray-300 rounded-lg text-xs font-medium focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500"
              />
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery('')}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>

            {/* Filter Action Buttons */}
            <div className="flex items-center space-x-2 shrink-0">
              <button
                onClick={handleClearFilters}
                className="px-3 py-2 bg-white border border-gray-300 text-gray-700 hover:bg-gray-100 rounded-lg text-xs font-bold transition-colors"
              >
                Clear Filters
              </button>
            </div>
          </div>

          {/* Filter Dropdowns Grid */}
          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-2.5 pt-1">
            
            {/* Category Filter */}
            <div>
              <label className="block text-[10px] font-extrabold text-gray-500 uppercase tracking-wider mb-1 font-outfit">
                Category
              </label>
              <select aria-label="category  filter"
                value={categoryFilter}
                onChange={(e) => { setCategoryFilter(e.target.value); setCurrentPage(1); }}
                className="w-full p-1.5 bg-white border border-gray-300 rounded-lg text-xs font-medium text-gray-800 focus:ring-1 focus:ring-emerald-500"
              >
                <option value="All">All Categories</option>
                {CATEGORY_OPTIONS.map((cat) => (
                  <option key={cat} value={cat}>{cat}</option>
                ))}
              </select>
            </div>

            {/* Department Filter */}
            <div>
              <label className="block text-[10px] font-extrabold text-gray-500 uppercase tracking-wider mb-1 font-outfit">
                Department
              </label>
              <select aria-label="department  filter"
                value={departmentFilter}
                onChange={(e) => { setDepartmentFilter(e.target.value); setCurrentPage(1); }}
                className="w-full p-1.5 bg-white border border-gray-300 rounded-lg text-xs font-medium text-gray-800 focus:ring-1 focus:ring-emerald-500"
              >
                <option value="All">All Depts</option>
                {DEPARTMENT_OPTIONS.map((dept) => (
                  <option key={dept} value={dept}>{dept}</option>
                ))}
              </select>
            </div>

            {/* Priority Filter */}
            <div>
              <label className="block text-[10px] font-extrabold text-gray-500 uppercase tracking-wider mb-1 font-outfit">
                Priority
              </label>
              <select aria-label="priority  filter"
                value={priorityFilter}
                onChange={(e) => { setPriorityFilter(e.target.value); setCurrentPage(1); }}
                className="w-full p-1.5 bg-white border border-gray-300 rounded-lg text-xs font-medium text-gray-800 focus:ring-1 focus:ring-emerald-500"
              >
                <option value="All">All Priorities</option>
                <option value="Low">Low</option>
                <option value="Medium">Medium</option>
                <option value="High">High</option>
                <option value="Critical">Critical</option>
              </select>
            </div>

            {/* Ward / Area Filter */}
            <div>
              <label className="block text-[10px] font-extrabold text-gray-500 uppercase tracking-wider mb-1 font-outfit">
                Ward / Area
              </label>
              <select aria-label="ward  filter"
                value={wardFilter}
                onChange={(e) => { setWardFilter(e.target.value); setCurrentPage(1); }}
                className="w-full p-1.5 bg-white border border-gray-300 rounded-lg text-xs font-medium text-gray-800 focus:ring-1 focus:ring-emerald-500"
              >
                <option value="All">All Wards</option>
                {WARD_OPTIONS.map((w) => (
                  <option key={w} value={w}>{w}</option>
                ))}
              </select>
            </div>

            {/* Resolved Date Filter */}
            <div>
              <label className="block text-[10px] font-extrabold text-gray-500 uppercase tracking-wider mb-1 font-outfit">
                Resolved Date
              </label>
              <select aria-label="date  filter"
                value={dateFilter}
                onChange={(e) => { setDateFilter(e.target.value); setCurrentPage(1); }}
                className="w-full p-1.5 bg-white border border-gray-300 rounded-lg text-xs font-medium text-gray-800 focus:ring-1 focus:ring-emerald-500"
              >
                <option value="All Time">All Time</option>
                <option value="Today">Today</option>
                <option value="Last 7 Days">Last 7 Days</option>
                <option value="Last 30 Days">Last 30 Days</option>
              </select>
            </div>

            {/* SLA Performance Filter */}
            <div>
              <label className="block text-[10px] font-extrabold text-gray-500 uppercase tracking-wider mb-1 font-outfit">
                SLA Performance
              </label>
              <select aria-label="sla  filter"
                value={slaFilter}
                onChange={(e) => { setSlaFilter(e.target.value); setCurrentPage(1); }}
                className="w-full p-1.5 bg-white border border-gray-300 rounded-lg text-xs font-medium text-gray-800 focus:ring-1 focus:ring-emerald-500"
              >
                <option value="All">All SLA</option>
                <option value="Within SLA">Within SLA</option>
                <option value="Breached SLA">Breached SLA</option>
              </select>
            </div>

            {/* Citizen Rating Filter */}
            <div>
              <label className="block text-[10px] font-extrabold text-gray-500 uppercase tracking-wider mb-1 font-outfit">
                Citizen Rating
              </label>
              <select aria-label="rating  filter"
                value={ratingFilter}
                onChange={(e) => { setRatingFilter(e.target.value); setCurrentPage(1); }}
                className="w-full p-1.5 bg-white border border-gray-300 rounded-lg text-xs font-medium text-gray-800 focus:ring-1 focus:ring-emerald-500"
              >
                <option value="All">All Ratings</option>
                <option value="5 Stars">★★★★★ 5 Stars</option>
                <option value="4+ Stars">★ 4+ Stars</option>
                <option value="3+ Stars">★ 3+ Stars</option>
                <option value="No Feedback">No Feedback</option>
              </select>
            </div>

            {/* Status Filter */}
            <div>
              <label className="block text-[10px] font-extrabold text-gray-500 uppercase tracking-wider mb-1 font-outfit">
                Status
              </label>
              <select aria-label="status  filter"
                value={statusFilter}
                onChange={(e) => { setStatusFilter(e.target.value); setCurrentPage(1); }}
                className="w-full p-1.5 bg-white border border-gray-300 rounded-lg text-xs font-medium text-gray-800 focus:ring-1 focus:ring-emerald-500"
              >
                <option value="All">All Statuses</option>
                <option value="Resolved">Resolved</option>
                <option value="Reopened">Reopened</option>
                <option value="Resolution Submitted">Resolution Submitted</option>
              </select>
            </div>

          </div>

        </div>

        {/* ================================================== */}
        {/* 5. MAIN RESOLVED COMPLAINT TABLE */}
        {/* ================================================== */}
        <div className="bg-white border border-gray-200 rounded-xl overflow-hidden shadow-xs">
          
          {loading ? (
            /* 19. LOADING STATE - Skeleton Rows */
            <div className="p-6 space-y-4">
              <div className="h-6 bg-gray-100 rounded w-1/4 animate-pulse" />
              <div className="space-y-3">
                {[1, 2, 3, 4, 5].map((i) => (
                  <div key={i} className="h-12 bg-gray-50 rounded border border-gray-100 animate-pulse" />
                ))}
              </div>
            </div>
          ) : error ? (
            /* 20. ERROR STATE */
            <div className="p-12 text-center space-y-4">
              <AlertTriangle className="w-10 h-10 text-rose-500 mx-auto" />
              <div className="space-y-1">
                <h3 className="text-base font-bold text-gray-900">Unable to load resolved complaints</h3>
                <p className="text-xs text-gray-500">Please verify network connectivity and try again.</p>
              </div>
              <button
                onClick={loadComplaints}
                className="px-4 py-2 bg-emerald-600 text-white font-bold text-xs rounded-lg hover:bg-emerald-700 transition-colors"
              >
                Try Again
              </button>
            </div>
          ) : paginatedList.length === 0 ? (
            /* 18. EMPTY STATE */
            <div className="p-12 text-center space-y-3">
              <CheckCircle2 className="w-10 h-10 text-emerald-500 mx-auto" />
              <h3 className="text-base font-bold text-gray-900 font-outfit">No Resolved Complaints</h3>
              <p className="text-xs text-gray-500 max-w-sm mx-auto">
                Resolved complaints will appear here once civic issues are successfully completed.
              </p>
              <button
                onClick={loadComplaints}
                className="px-4 py-2 bg-white border border-gray-300 text-gray-700 font-bold text-xs rounded-lg hover:bg-gray-50 transition-colors"
              >
                Refresh
              </button>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                
                {/* TABLE HEADER WITH SORTING */}
                <thead>
                  <tr className="bg-slate-50 border-b border-gray-200 text-[11px] font-extrabold text-gray-600 uppercase tracking-wider font-outfit">
                    
                    <th
                      onClick={() => handleSort('complaint_number')}
                      className="py-3 px-4 cursor-pointer hover:bg-gray-100 select-none whitespace-nowrap"
                    >
                      <div className="flex items-center space-x-1">
                        <span>Complaint ID</span>
                        <ArrowUpDown className="w-3 h-3 text-gray-400" />
                      </div>
                    </th>

                    <th className="py-3 px-4 whitespace-nowrap">Issue</th>

                    <th className="py-3 px-4 whitespace-nowrap">Location</th>

                    <th
                      onClick={() => handleSort('department_name')}
                      className="py-3 px-4 cursor-pointer hover:bg-gray-100 select-none whitespace-nowrap"
                    >
                      <div className="flex items-center space-x-1">
                        <span>Department</span>
                        <ArrowUpDown className="w-3 h-3 text-gray-400" />
                      </div>
                    </th>

                    <th className="py-3 px-4 whitespace-nowrap">Resolved By</th>

                    <th
                      onClick={() => handleSort('updated_at')}
                      className="py-3 px-4 cursor-pointer hover:bg-gray-100 select-none whitespace-nowrap"
                    >
                      <div className="flex items-center space-x-1">
                        <span>Resolved On</span>
                        <ArrowUpDown className="w-3 h-3 text-gray-400" />
                      </div>
                    </th>

                    <th
                      onClick={() => handleSort('resolution_hours')}
                      className="py-3 px-4 cursor-pointer hover:bg-gray-100 select-none whitespace-nowrap"
                    >
                      <div className="flex items-center space-x-1">
                        <span>Resolution Time</span>
                        <ArrowUpDown className="w-3 h-3 text-gray-400" />
                      </div>
                    </th>

                    <th
                      onClick={() => handleSort('rating')}
                      className="py-3 px-4 cursor-pointer hover:bg-gray-100 select-none whitespace-nowrap"
                    >
                      <div className="flex items-center space-x-1">
                        <span>Citizen Rating</span>
                        <ArrowUpDown className="w-3 h-3 text-gray-400" />
                      </div>
                    </th>

                    <th className="py-3 px-4 whitespace-nowrap">Status</th>

                    <th className="py-3 px-4 text-right whitespace-nowrap">Action</th>

                  </tr>
                </thead>

                {/* TABLE BODY */}
                <tbody className="divide-y divide-gray-200 text-xs font-medium text-gray-800">
                  {paginatedList.map((comp) => {
                    const resTime = calculateResolutionTime(comp);

                    return (
                      <tr
                        key={comp.id}
                        className="hover:bg-slate-50/80 transition-colors"
                      >
                        {/* 1. Complaint ID */}
                        <td className="py-3 px-4 font-mono font-extrabold text-emerald-700 whitespace-nowrap">
                          {comp.complaint_number}
                        </td>

                        {/* 2. Issue */}
                        <td className="py-3 px-4 max-w-xs">
                          <div className="space-y-0.5">
                            <span className="font-bold text-gray-900 line-clamp-1">
                              {comp.title}
                            </span>
                            <span className="inline-block text-[10px] font-bold text-gray-500 bg-gray-100 px-1.5 py-0.5 rounded font-mono">
                              {comp.category}
                            </span>
                          </div>
                        </td>

                        {/* 3. Location */}
                        <td className="py-3 px-4 max-w-xs text-gray-600 truncate">
                          {comp.location_address || `Ward ${comp.latitude.toFixed(2)}, Zone`}
                        </td>

                        {/* 4. Department */}
                        <td className="py-3 px-4 text-gray-700 whitespace-nowrap font-medium">
                          {comp.department_name || 'Public Works'}
                        </td>

                        {/* 5. Resolved By */}
                        <td className="py-3 px-4 text-gray-900 font-bold whitespace-nowrap">
                          {comp.assigned_staff_name || 'Field Officer'}
                        </td>

                        {/* 6. Resolved On */}
                        <td className="py-3 px-4 font-mono text-gray-600 whitespace-nowrap">
                          {new Date(comp.updated_at).toLocaleDateString('en-GB', {
                            day: '2-digit',
                            month: 'short',
                            year: 'numeric'
                          })}
                        </td>

                        {/* 7. Resolution Time */}
                        <td className="py-3 px-4 font-mono font-bold text-gray-800 whitespace-nowrap">
                          {resTime.text}
                        </td>

                        {/* 8. Citizen Rating */}
                        <td className="py-3 px-4 whitespace-nowrap">
                          {renderStars(comp.rating)}
                        </td>

                        {/* 9. Status Badge */}
                        <td className="py-3 px-4 whitespace-nowrap">
                          <StatusBadge status={comp.status} />
                        </td>

                        {/* 10. Action Buttons */}
                        <td className="py-3 px-4 text-right whitespace-nowrap">
                          <div className="flex items-center justify-end space-x-1.5">
                            <button
                              onClick={() => {
                                setSelectedComplaint(comp);
                                setActiveTab('proof');
                              }}
                              className="px-2.5 py-1 bg-white border border-gray-300 hover:bg-emerald-50 hover:border-emerald-300 hover:text-emerald-700 text-gray-700 font-bold rounded-lg text-xs transition-colors"
                            >
                              View
                            </button>
                            {comp.photo_after_url && (
                              <button
                                onClick={() => {
                                  setSelectedComplaint(comp);
                                  setActiveTab('proof');
                                }}
                                className="px-2 py-1 bg-emerald-50 text-emerald-800 border border-emerald-200 hover:bg-emerald-100 rounded-lg text-[11px] font-bold transition-colors"
                              >
                                Proof
                              </button>
                            )}
                          </div>
                        </td>

                      </tr>
                    );
                  })}
                </tbody>

              </table>
            </div>
          )}

          {/* ================================================== */}
          {/* 17. PAGINATION */}
          {/* ================================================== */}
          {!loading && sortedList.length > 0 && (
            <div className="flex flex-col sm:flex-row items-center justify-between gap-4 p-4 border-t border-gray-200 bg-slate-50">
              
              <div className="text-xs font-medium text-gray-600 font-mono">
                Showing{' '}
                <span className="font-bold text-gray-900">
                  {Math.min((currentPage - 1) * pageSize + 1, sortedList.length)}
                </span>
                –
                <span className="font-bold text-gray-900">
                  {Math.min(currentPage * pageSize, sortedList.length)}
                </span>{' '}
                of <span className="font-bold text-gray-900">{sortedList.length}</span> resolved complaints
              </div>

              <div className="flex items-center space-x-1.5">
                <button
                  onClick={() => setCurrentPage((prev) => Math.max(prev - 1, 1))}
                  disabled={currentPage === 1}
                  className="px-3 py-1.5 bg-white border border-gray-300 rounded-lg text-xs font-bold text-gray-700 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                >
                  <ChevronLeft className="w-3.5 h-3.5 inline mr-1" />
                  Previous
                </button>

                <div className="flex items-center space-x-1 px-2">
                  {Array.from({ length: totalPages }, (_, i) => i + 1).map((pageNum) => (
                    <button
                      key={pageNum}
                      onClick={() => setCurrentPage(pageNum)}
                      className={`w-7 h-7 rounded-lg text-xs font-bold font-mono transition-colors ${
                        currentPage === pageNum
                          ? 'bg-emerald-600 text-white'
                          : 'bg-white border border-gray-300 text-gray-700 hover:bg-gray-100'
                      }`}
                    >
                      {pageNum}
                    </button>
                  ))}
                </div>

                <button
                  onClick={() => setCurrentPage((prev) => Math.min(prev + 1, totalPages))}
                  disabled={currentPage === totalPages}
                  className="px-3 py-1.5 bg-white border border-gray-300 rounded-lg text-xs font-bold text-gray-700 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                >
                  Next
                  <ChevronRight className="w-3.5 h-3.5 inline ml-1" />
                </button>
              </div>

            </div>
          )}

        </div>

        {/* ================================================== */}
        {/* RESOLVED COMPLAINT INSPECTION MODAL / DRAWER */}
        {/* ================================================== */}
        {selectedComplaint && (
          <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 sm:p-6">
            
            <div className="bg-white rounded-2xl border border-gray-200 shadow-2xl w-full max-w-4xl max-h-[90vh] flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-150">
              
              {/* MODAL HEADER */}
              <div className="p-4 sm:p-5 border-b border-gray-200 bg-slate-50 flex items-center justify-between shrink-0">
                <div className="space-y-1">
                  <div className="flex items-center space-x-2">
                    <span className="font-mono text-sm font-extrabold text-emerald-800 bg-emerald-100 px-2.5 py-0.5 rounded border border-emerald-300">
                      {selectedComplaint.complaint_number}
                    </span>
                    <StatusBadge status={selectedComplaint.status} />
                    <PriorityBadge priority={selectedComplaint.priority} />
                  </div>
                  <h2 className="text-lg font-extrabold text-gray-900 font-outfit">
                    {selectedComplaint.title}
                  </h2>
                </div>

                <button
                  onClick={() => setSelectedComplaint(null)}
                  className="p-1.5 text-gray-400 hover:text-gray-700 hover:bg-gray-200 rounded-lg transition-colors"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {/* MODAL TABS */}
              <div className="flex border-b border-gray-200 bg-white px-4 shrink-0 font-outfit">
                <button
                  onClick={() => setActiveTab('proof')}
                  className={`py-3 px-4 text-xs font-extrabold border-b-2 transition-colors flex items-center space-x-1.5 ${
                    activeTab === 'proof'
                      ? 'border-emerald-600 text-emerald-700'
                      : 'border-transparent text-gray-500 hover:text-gray-800'
                  }`}
                >
                  <FileCheck className="w-4 h-4" />
                  <span>Resolution Proof</span>
                </button>

                <button
                  onClick={() => setActiveTab('details')}
                  className={`py-3 px-4 text-xs font-extrabold border-b-2 transition-colors flex items-center space-x-1.5 ${
                    activeTab === 'details'
                      ? 'border-emerald-600 text-emerald-700'
                      : 'border-transparent text-gray-500 hover:text-gray-800'
                  }`}
                >
                  <Building2 className="w-4 h-4" />
                  <span>Work Details</span>
                </button>

                <button
                  onClick={() => setActiveTab('feedback')}
                  className={`py-3 px-4 text-xs font-extrabold border-b-2 transition-colors flex items-center space-x-1.5 ${
                    activeTab === 'feedback'
                      ? 'border-emerald-600 text-emerald-700'
                      : 'border-transparent text-gray-500 hover:text-gray-800'
                  }`}
                >
                  <MessageSquare className="w-4 h-4" />
                  <span>Citizen Feedback</span>
                </button>

                <button
                  onClick={() => setActiveTab('timeline')}
                  className={`py-3 px-4 text-xs font-extrabold border-b-2 transition-colors flex items-center space-x-1.5 ${
                    activeTab === 'timeline'
                      ? 'border-emerald-600 text-emerald-700'
                      : 'border-transparent text-gray-500 hover:text-gray-800'
                  }`}
                >
                  <Clock className="w-4 h-4" />
                  <span>Timeline & Log</span>
                </button>
              </div>

              {/* MODAL BODY CONTENT */}
              <div className="p-6 overflow-y-auto space-y-6 flex-1 text-gray-900">
                
                {/* 11. REOPENED BANNER IF APPLICABLE */}
                {selectedComplaint.status === 'Reopened' && (
                  <div className="bg-orange-50 border border-orange-300 rounded-xl p-4 space-y-1">
                    <div className="flex items-center space-x-2 text-orange-900 font-extrabold text-sm font-outfit">
                      <AlertTriangle className="w-4 h-4 text-orange-600" />
                      <span>⚠ Complaint Reopened</span>
                    </div>
                    <p className="text-xs text-orange-800 font-medium">
                      <strong className="font-bold">Reason:</strong>{' '}
                      {selectedComplaint.admin_rejection_reason || 'Citizen reported issue was not satisfactorily resolved.'}
                    </p>
                    <p className="text-[10px] text-orange-700 font-mono pt-1">
                      Reopened On: {new Date(selectedComplaint.updated_at).toLocaleString()}
                    </p>
                  </div>
                )}

                {/* TAB 1: RESOLUTION PROOF & BEFORE/AFTER COMPARISON */}
                {activeTab === 'proof' && (
                  <div className="space-y-6">
                    <div className="space-y-1">
                      <h3 className="text-sm font-extrabold uppercase tracking-wider text-gray-700 font-outfit">
                        RESOLUTION PROOF COMPARISON
                      </h3>
                      <p className="text-xs text-gray-500">
                        Side-by-side verification of citizen reported defect versus completed service staff work.
                      </p>
                    </div>

                    {/* 7 & 8. BEFORE → AFTER VISUAL COMPARISON */}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                      
                      {/* BEFORE IMAGE */}
                      <div className="border border-gray-200 rounded-xl overflow-hidden bg-gray-50 space-y-2 p-3">
                        <div className="flex items-center justify-between text-xs font-bold text-gray-700 font-outfit border-b border-gray-200 pb-2">
                          <span className="flex items-center space-x-1.5 text-rose-700">
                            <span className="w-2 h-2 rounded-full bg-rose-600" />
                            <span>BEFORE (Reported Issue)</span>
                          </span>
                          <span className="text-[10px] font-mono text-gray-400">Citizen Photo</span>
                        </div>

                        <div className="relative aspect-video rounded-lg overflow-hidden bg-gray-200 group">
                          {selectedComplaint.photo_before_url ? (
                            <img
                              src={getValidImageUrl(selectedComplaint.photo_before_url)}
                              alt="Original Defect Before"
                              className="w-full h-full object-cover"
                              onError={(e) => { e.currentTarget.src = DEFAULT_CIVIC_IMAGE_PLACEHOLDER; }}
                            />
                          ) : (
                            <div className="flex items-center justify-center h-full text-xs text-gray-400 font-mono">
                              No Before Image
                            </div>
                          )}
                          <button
                            onClick={() => setShowFullImageModal(getValidImageUrl(selectedComplaint.photo_before_url))}
                            className="absolute bottom-2 right-2 p-1.5 bg-black/60 text-white rounded-md hover:bg-black transition-colors"
                          >
                            <Maximize2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                        <p className="text-xs text-gray-600 font-medium">
                          Reported defect: {selectedComplaint.title}
                        </p>
                      </div>

                      {/* AFTER IMAGE */}
                      <div className="border border-emerald-200 rounded-xl overflow-hidden bg-emerald-50/40 space-y-2 p-3">
                        <div className="flex items-center justify-between text-xs font-bold text-emerald-900 font-outfit border-b border-emerald-200 pb-2">
                          <span className="flex items-center space-x-1.5 text-emerald-700">
                            <span className="w-2 h-2 rounded-full bg-emerald-600" />
                            <span>AFTER (Resolved Condition)</span>
                          </span>
                          <span className="text-[10px] font-mono text-emerald-700">Staff Repair Proof</span>
                        </div>

                        <div className="relative aspect-video rounded-lg overflow-hidden bg-gray-200 group">
                          {selectedComplaint.photo_after_url ? (
                            <img
                              src={getValidImageUrl(selectedComplaint.photo_after_url)}
                              alt="Resolved Condition After"
                              className="w-full h-full object-cover"
                              onError={(e) => { e.currentTarget.src = DEFAULT_CIVIC_IMAGE_PLACEHOLDER; }}
                            />
                          ) : (
                            <div className="flex items-center justify-center h-full text-xs text-gray-400 font-mono">
                              No After Image Submitted
                            </div>
                          )}
                          {selectedComplaint.photo_after_url && (
                            <button
                              onClick={() => setShowFullImageModal(selectedComplaint.photo_after_url!)}
                              className="absolute bottom-2 right-2 p-1.5 bg-black/60 text-white rounded-md hover:bg-black transition-colors"
                            >
                              <Maximize2 className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>
                        <p className="text-xs text-emerald-900 font-medium">
                          Resolution proof verified by Municipal Service Team.
                        </p>
                      </div>

                    </div>

                    {/* WORK PERFORMED NOTES */}
                    {selectedComplaint.work_performed && (
                      <div className="bg-gray-50 p-4 rounded-xl border border-gray-200 space-y-1">
                        <h4 className="text-xs font-bold uppercase tracking-wider text-gray-700 font-outfit">
                          Work Performed by Staff
                        </h4>
                        <p className="text-xs text-gray-800 font-medium leading-relaxed">
                          {selectedComplaint.work_performed}
                        </p>
                        {selectedComplaint.materials_used && (
                          <p className="text-xs text-gray-600 pt-1 font-mono">
                            <strong className="font-bold text-gray-700">Materials Used:</strong> {selectedComplaint.materials_used}
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                )}

                {/* TAB 2: RESOLUTION DETAILS & METRICS */}
                {activeTab === 'details' && (
                  <div className="space-y-6">
                    {/* 9. RESOLUTION DETAILS METRIC GRID */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                      
                      <div className="p-3.5 rounded-xl border border-gray-200 bg-gray-50 space-y-1">
                        <span className="text-[10px] font-bold text-gray-500 uppercase tracking-wider block font-outfit">
                          Complaint ID
                        </span>
                        <span className="text-sm font-mono font-extrabold text-emerald-700 block">
                          {selectedComplaint.complaint_number}
                        </span>
                      </div>

                      <div className="p-3.5 rounded-xl border border-gray-200 bg-gray-50 space-y-1">
                        <span className="text-[10px] font-bold text-gray-500 uppercase tracking-wider block font-outfit">
                          Category & Priority
                        </span>
                        <span className="text-xs font-bold text-gray-900 block">
                          {selectedComplaint.category} ({selectedComplaint.priority} Priority)
                        </span>
                      </div>

                      <div className="p-3.5 rounded-xl border border-gray-200 bg-gray-50 space-y-1">
                        <span className="text-[10px] font-bold text-gray-500 uppercase tracking-wider block font-outfit">
                          Department
                        </span>
                        <span className="text-xs font-bold text-gray-900 block">
                          {selectedComplaint.department_name || 'Public Works'}
                        </span>
                      </div>

                      <div className="p-3.5 rounded-xl border border-gray-200 bg-gray-50 space-y-1">
                        <span className="text-[10px] font-bold text-gray-500 uppercase tracking-wider block font-outfit">
                          Assigned Staff
                        </span>
                        <span className="text-xs font-bold text-gray-900 block">
                          {selectedComplaint.assigned_staff_name || 'Ramesh Kumar'}
                        </span>
                      </div>

                      <div className="p-3.5 rounded-xl border border-gray-200 bg-gray-50 space-y-1">
                        <span className="text-[10px] font-bold text-gray-500 uppercase tracking-wider block font-outfit">
                          Resolution Time
                        </span>
                        <span className="text-xs font-mono font-bold text-gray-900 block">
                          {calculateResolutionTime(selectedComplaint).text}
                        </span>
                      </div>

                      {/* 14. SLA PERFORMANCE */}
                      <div className="p-3.5 rounded-xl border border-gray-200 bg-gray-50 space-y-1">
                        <span className="text-[10px] font-bold text-gray-500 uppercase tracking-wider block font-outfit">
                          SLA Performance
                        </span>
                        <span className="text-xs font-extrabold text-emerald-700 block">
                          {formatSlaRemainingTime(selectedComplaint.sla_deadline).isOverdue ? 'Breached SLA' : 'Completed Within SLA'}
                        </span>
                      </div>

                    </div>

                    {/* LOCATION DETAILS */}
                    <div className="border border-gray-200 rounded-xl p-4 space-y-2 bg-white">
                      <h4 className="text-xs font-bold text-gray-700 uppercase tracking-wider font-outfit flex items-center space-x-1.5">
                        <MapPin className="w-4 h-4 text-emerald-600" />
                        <span>Location & Address</span>
                      </h4>
                      <p className="text-xs font-medium text-gray-800">
                        {selectedComplaint.location_address || 'Municipal Zone 4, Central Ward'}
                      </p>
                      <p className="text-[11px] font-mono text-gray-500">
                        GPS Coordinates: {selectedComplaint.latitude.toFixed(4)}° N, {selectedComplaint.longitude.toFixed(4)}° E ({selectedComplaint.location_source})
                      </p>
                    </div>

                    {/* FULL DESCRIPTION */}
                    <div className="border border-gray-200 rounded-xl p-4 space-y-2 bg-white">
                      <h4 className="text-xs font-bold text-gray-700 uppercase tracking-wider font-outfit">
                        Initial Citizen Description
                      </h4>
                      <p className="text-xs font-medium text-gray-800 leading-relaxed whitespace-pre-line">
                        {selectedComplaint.description}
                      </p>
                    </div>
                  </div>
                )}

                {/* TAB 3: 10. CITIZEN FEEDBACK */}
                {activeTab === 'feedback' && (
                  <div className="space-y-4">
                    <h3 className="text-sm font-extrabold uppercase tracking-wider text-gray-700 font-outfit">
                      CITIZEN FEEDBACK & SATISFACTION
                    </h3>

                    <CitizenFeedbackCard
                      citizenName={selectedComplaint.citizen_name || (selectedComplaint as any).feedback?.citizen_name || 'Citizen'}
                      complaintNumber={selectedComplaint.complaint_number}
                      rating={selectedComplaint.rating || (selectedComplaint as any).feedback?.rating}
                      review={selectedComplaint.feedback_comment || (selectedComplaint as any).feedback?.review || (selectedComplaint as any).feedback?.comment}
                      submissionDate={selectedComplaint.feedback_created_at || (selectedComplaint as any).feedback?.created_at || (selectedComplaint as any).feedback?.submission_date}
                    />
                  </div>
                )}

                {/* TAB 4: 12 & 13. TIMELINE & AUDIT HISTORY */}
                {activeTab === 'timeline' && (
                  <div className="space-y-6">
                    <ActivityTimeline complaintId={selectedComplaint.id} />
                  </div>
                )}

              </div>

              {/* MODAL FOOTER */}
              <div className="p-4 border-t border-gray-200 bg-slate-50 flex items-center justify-end space-x-3 shrink-0">
                <button
                  onClick={() => setSelectedComplaint(null)}
                  className="px-4 py-2 bg-white border border-gray-300 text-gray-700 font-bold rounded-xl text-xs hover:bg-gray-100 transition-colors"
                >
                  Close
                </button>
              </div>

            </div>

          </div>
        )}

        {/* FULL IMAGE LIGHTBOX MODAL */}
        {showFullImageModal && (
          <div
            onClick={() => setShowFullImageModal(null)}
            className="fixed inset-0 z-60 bg-black/80 flex items-center justify-center p-4 cursor-pointer"
          >
            <div className="relative max-w-4xl max-h-[90vh] overflow-hidden rounded-xl">
              <img src={showFullImageModal} alt="Enlarged proof" className="w-full h-full object-contain" />
              <button
                onClick={() => setShowFullImageModal(null)}
                className="absolute top-3 right-3 p-2 bg-black/60 text-white rounded-full hover:bg-black"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
          </div>
        )}

      </div>
    </DashboardLayout>
  );
};
