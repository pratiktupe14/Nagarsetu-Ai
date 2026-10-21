import React, { useState, useEffect, useCallback } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { useLanguage } from '../../context/LanguageContext';
import { DashboardLayout } from '../../components/DashboardLayout';
import { StatusBadge } from '../../components/StatusBadge';
import { PriorityBadge } from '../../components/PriorityBadge';
import { getCitizenComplaints, getOfflineDrafts } from '../../services/complaintService';
import { getOfficialAnnouncements, getMaintenanceWorks } from '../../services/announcementService';
import { Complaint, OfficialAnnouncement, MaintenanceWork } from '../../types/database.types';
import { useRealtimeComplaints } from '../../hooks/useRealtimeComplaints';
import { PlusCircle, Clock, ArrowRight, ShieldCheck, WifiOff, FileText, Zap, AlertTriangle, RefreshCw, Megaphone, HardHat } from 'lucide-react';

import { getValidImageUrl, DEFAULT_CIVIC_IMAGE_PLACEHOLDER } from '../../lib/supabase';

function getMaintenanceBadge(status: MaintenanceWork['status']) {
  switch (status) {
    case 'Planned': return 'bg-blue-50 text-blue-800 border-blue-200';
    case 'Approved': return 'bg-purple-50 text-purple-800 border-purple-200';
    case 'In Progress': return 'bg-amber-50 text-amber-800 border-amber-200';
    case 'Completed': return 'bg-emerald-50 text-emerald-800 border-emerald-200';
    case 'Delayed': return 'bg-orange-50 text-orange-800 border-orange-200';
    case 'Cancelled': return 'bg-rose-50 text-rose-800 border-rose-200';
    default: return 'bg-gray-50 text-gray-800 border-gray-200';
  }
}

export const CitizenPortal: React.FC = () => {
  const { user } = useAuth();
  const { language, t, translateCategory } = useLanguage();
  const navigate = useNavigate();

  const [complaints, setComplaints] = useState<Complaint[]>([]);
  const [announcements, setAnnouncements] = useState<OfficialAnnouncement[]>([]);
  const [maintenanceWorks, setMaintenanceWorks] = useState<MaintenanceWork[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [activeFilter, setActiveFilter] = useState<'All' | 'Pending' | 'In Progress' | 'Resolved' | 'Reopened' | 'Rejected'>('All');
  const [offlineDraftsCount, setOfflineDraftsCount] = useState(0);

  const loadComplaints = useCallback(async (opts?: boolean | React.MouseEvent) => {
    const isInitial = typeof opts === 'boolean' ? opts : true;
    if (isInitial) setLoading(true);
    setErrorMsg(null);
    try {
      const [list, anns, works] = await Promise.all([
        getCitizenComplaints(user?.id || ''),
        getOfficialAnnouncements().catch((e) => {
          console.warn('CitizenPortal getOfficialAnnouncements caught:', e);
          return [];
        }),
        getMaintenanceWorks().catch((e) => {
          console.warn('CitizenPortal getMaintenanceWorks caught:', e);
          return [];
        })
      ]);
      setComplaints(Array.isArray(list) ? list : []);
      setAnnouncements(Array.isArray(anns) ? anns.slice(0, 3) : []);
      setMaintenanceWorks(Array.isArray(works) ? works.slice(0, 3) : []);
    } catch (e: any) {
      console.error('Error in CitizenPortal loadComplaints:', e);
      setErrorMsg(e?.message || 'Unable to load complaints. Please check your network connection and try again.');
      setComplaints([]);
      setAnnouncements([]);
      setMaintenanceWorks([]);
    } finally {
      if (isInitial) setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    loadComplaints(true);
    try {
      const drafts = getOfflineDrafts();
      setOfflineDraftsCount(Array.isArray(drafts) ? drafts.length : 0);
    } catch (e) {
      setOfflineDraftsCount(0);
    }
  }, [loadComplaints]);

  // Subscribe to real-time complaint updates across portals
  useRealtimeComplaints(useCallback(() => {
    loadComplaints(false);
  }, [loadComplaints]));

  // Centralized status normalization to ensure mutually exclusive, exhaustive categories
  const normalizeStatus = (status?: string): 'Pending' | 'In Progress' | 'Resolved' | 'Reopened' | 'Rejected' => {
    const s = String(status || '').trim().toLowerCase();
    if (['submitted', 'verified', 'approved', 'pending'].includes(s)) return 'Pending';
    if (['department assigned', 'staff assigned', 'in progress', 'accepted', 'on the way', 'investigation'].includes(s)) return 'In Progress';
    if (['resolved', 'resolution submitted'].includes(s)) return 'Resolved';
    if (['reopened'].includes(s)) return 'Reopened';
    if (['rejected'].includes(s)) return 'Rejected';
    return 'Pending';
  };

  // Defensive array checks & authoritative metric calculations
  const safeComplaints = Array.isArray(complaints) ? complaints : [];
  const totalCount = safeComplaints.length;
  const pendingCount = safeComplaints.filter((c) => c && normalizeStatus(c.status) === 'Pending').length;
  const inProgressCount = safeComplaints.filter((c) => c && normalizeStatus(c.status) === 'In Progress').length;
  const resolvedCount = safeComplaints.filter((c) => c && normalizeStatus(c.status) === 'Resolved').length;
  const reopenedCount = safeComplaints.filter((c) => c && normalizeStatus(c.status) === 'Reopened').length;
  const rejectedCount = safeComplaints.filter((c) => c && normalizeStatus(c.status) === 'Rejected').length;

  const filteredComplaints = safeComplaints.filter((c) => {
    if (!c) return false;
    if (activeFilter === 'All') return true;
    return normalizeStatus(c.status) === activeFilter;
  });

  // 1. ERROR STATE
  if (errorMsg) {
    return (
      <DashboardLayout title={t('dashboard')}>
        <div className="max-w-md mx-auto px-4 py-16 text-center space-y-4 flex flex-col justify-center items-center font-sans">
          <div className="w-16 h-16 rounded-2xl bg-rose-50 border border-rose-200 text-rose-600 flex items-center justify-center">
            <AlertTriangle className="w-8 h-8" />
          </div>
          <h2 className="text-xl font-extrabold text-gray-900 font-outfit">{errorMsg}</h2>
          <p className="text-xs text-gray-500">{t('pleaseTryAgain')}</p>
          <button
            onClick={() => loadComplaints()}
            className="px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-extrabold text-xs uppercase tracking-wider shadow-sm flex items-center space-x-1.5 min-h-[44px]"
          >
            <RefreshCw className="w-4 h-4" />
            <span>{t('apply')}</span>
          </button>
        </div>
      </DashboardLayout>
    );
  }

  // 2. LOADING STATE
  if (loading) {
    return (
      <DashboardLayout title={t('dashboard')}>
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-20 text-center space-y-4 flex flex-col justify-center items-center font-sans">
          <div className="w-10 h-10 rounded-full border-4 border-emerald-600 border-t-transparent animate-spin" />
          <p className="text-xs font-bold text-gray-700 font-outfit">{t('loading')}</p>
        </div>
      </DashboardLayout>
    );
  }

  // 3. SUCCESS STATE
  return (
    <DashboardLayout title={t('dashboard')}>
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 w-full space-y-8 font-sans">
        
        {offlineDraftsCount > 0 && (
          <div className="p-4 rounded-2xl bg-amber-50 border border-amber-200 text-amber-900 text-xs flex items-center justify-between shadow-xs">
            <div className="flex items-center space-x-2">
              <WifiOff className="w-5 h-5 text-amber-600 shrink-0" />
              <div>
                <span className="font-bold block text-gray-900">{t('draftSavedOffline')}</span>
                <span>{offlineDraftsCount} {t('draftSavedOfflineNotice')}</span>
              </div>
            </div>
            <button
              onClick={() => navigate('/citizen/report')}
              className="px-3.5 py-1.5 rounded-xl bg-amber-600 hover:bg-amber-700 text-white font-bold text-xs min-h-[44px]"
            >
              {t('resumeDraft')}
            </button>
          </div>
        )}

        <div className="bg-white p-6 sm:p-8 rounded-2xl border border-gray-200 shadow-sm flex flex-wrap items-center justify-between gap-4">
          <div className="space-y-1">
            <div className="flex items-center space-x-2">
              <span className="inline-flex items-center space-x-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
                <ShieldCheck className="w-3.5 h-3.5" />
                <span>{t('roleCitizen')}</span>
              </span>
              <span className="inline-flex items-center space-x-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-blue-50 text-blue-700 border border-blue-200 animate-pulse">
                <Zap className="w-3 h-3 text-blue-600" />
                <span>{t('realtime')}</span>
              </span>
            </div>

            <h1 className="text-2xl sm:text-3xl font-extrabold text-gray-900 font-outfit">
              {t('welcome')}, {user?.full_name || (user as any)?.name || t('roleCitizen')}
            </h1>
            <p className="text-xs sm:text-sm text-gray-600">
              {t('tagline')}
            </p>
          </div>

          <div className="flex items-center space-x-3 w-full sm:w-auto">
            <Link
              to="/citizen/track"
              className="w-full sm:w-auto px-5 py-3.5 rounded-xl bg-white border-2 border-emerald-600 text-emerald-700 hover:bg-emerald-50 font-extrabold text-xs uppercase tracking-wider shadow-sm flex items-center justify-center space-x-2 transition-all min-h-[44px]"
            >
              <Clock className="w-5 h-5 text-emerald-600" />
              <span>{t('myComplaints')}</span>
            </Link>
            <Link
              to="/citizen/report"
              className="w-full sm:w-auto px-6 py-3.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-extrabold text-xs uppercase tracking-wider shadow-sm flex items-center justify-center space-x-2 transition-all min-h-[44px]"
            >
              <PlusCircle className="w-5 h-5" />
              <span>+ {t('reportComplaint')}</span>
            </Link>
          </div>
        </div>

        {/* COMPLAINT STATUS QUICK ACTION BANNER */}
        <div className="bg-gradient-to-r from-emerald-900 to-teal-800 text-white p-6 rounded-2xl border border-emerald-700 shadow-md flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
          <div className="space-y-1.5">
            <div className="flex items-center space-x-2">
              <span className="px-2.5 py-0.5 rounded-full text-[10px] font-extrabold bg-emerald-400/20 text-emerald-200 border border-emerald-400/30 flex items-center space-x-1">
                <span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping inline-block mr-1" />
                <span>{t('liveUpdates')}</span>
              </span>
            </div>
            <h2 className="text-xl font-extrabold text-white font-outfit">{t('myComplaints')}</h2>
            <p className="text-xs text-emerald-100/90 max-w-xl">
              {t('tagline')}
            </p>
          </div>

          <Link
            to="/citizen/track"
            className="px-6 py-3 rounded-xl bg-emerald-400 hover:bg-emerald-300 text-gray-950 font-extrabold text-xs uppercase tracking-wider shadow-md flex items-center space-x-2 transition-all shrink-0 min-h-[44px]"
          >
            <span>{t('view')}</span>
            <ArrowRight className="w-4 h-4" />
          </Link>
        </div>

        {/* METRICS GRID */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 sm:gap-4">
          
          <button
            onClick={() => setActiveFilter('All')}
            className={`p-5 rounded-2xl border text-left transition-all ${
              activeFilter === 'All'
                ? 'bg-gray-50 border-gray-400 ring-2 ring-gray-400/30 shadow-md'
                : 'bg-white border-gray-200 shadow-sm hover:border-gray-300'
            }`}
          >
            <span className="text-xs font-semibold text-gray-500 uppercase tracking-wider block">{t('total')}</span>
            <div className="text-2xl sm:text-3xl font-extrabold text-gray-900 font-mono mt-1">{totalCount}</div>
          </button>

          <button
            onClick={() => setActiveFilter('Pending')}
            className={`p-5 rounded-2xl border text-left transition-all ${
              activeFilter === 'Pending'
                ? 'bg-blue-50/50 border-blue-400 ring-2 ring-blue-400/30 shadow-md'
                : 'bg-white border-blue-200 shadow-sm hover:border-blue-300'
            }`}
          >
            <span className="text-xs font-semibold text-blue-700 uppercase tracking-wider block">{t('pending')}</span>
            <div className="text-2xl sm:text-3xl font-extrabold text-blue-700 font-mono mt-1">{pendingCount}</div>
          </button>

          <button
            onClick={() => setActiveFilter('In Progress')}
            className={`p-5 rounded-2xl border text-left transition-all ${
              activeFilter === 'In Progress'
                ? 'bg-amber-50/50 border-amber-400 ring-2 ring-amber-400/30 shadow-md'
                : 'bg-white border-amber-200 shadow-sm hover:border-amber-300'
            }`}
          >
            <span className="text-xs font-semibold text-amber-800 uppercase tracking-wider block">{t('inProgress')}</span>
            <div className="text-2xl sm:text-3xl font-extrabold text-amber-800 font-mono mt-1">{inProgressCount}</div>
          </button>

          <button
            onClick={() => setActiveFilter('Resolved')}
            className={`p-5 rounded-2xl border text-left transition-all ${
              activeFilter === 'Resolved'
                ? 'bg-emerald-50/50 border-emerald-400 ring-2 ring-emerald-400/30 shadow-md'
                : 'bg-white border-emerald-200 shadow-sm hover:border-emerald-300'
            }`}
          >
            <span className="text-xs font-semibold text-emerald-800 uppercase tracking-wider block">{t('resolved')}</span>
            <div className="text-2xl sm:text-3xl font-extrabold text-emerald-800 font-mono mt-1">{resolvedCount}</div>
          </button>

          <button
            onClick={() => setActiveFilter('Reopened')}
            className={`p-5 rounded-2xl border text-left transition-all ${
              activeFilter === 'Reopened'
                ? 'bg-purple-50/50 border-purple-400 ring-2 ring-purple-400/30 shadow-md'
                : 'bg-white border-purple-200 shadow-sm hover:border-purple-300'
            }`}
          >
            <span className="text-xs font-semibold text-purple-800 uppercase tracking-wider block">{t('statusReopened')}</span>
            <div className="text-2xl sm:text-3xl font-extrabold text-purple-800 font-mono mt-1">{reopenedCount}</div>
          </button>

          {rejectedCount > 0 && (
            <button
              onClick={() => setActiveFilter('Rejected')}
              className={`p-5 rounded-2xl border text-left transition-all ${
                activeFilter === 'Rejected'
                  ? 'bg-rose-50/50 border-rose-400 ring-2 ring-rose-400/30 shadow-md'
                  : 'bg-white border-rose-200 shadow-sm hover:border-rose-300'
              }`}
            >
              <span className="text-xs font-semibold text-rose-800 uppercase tracking-wider block">{t('statusRejected')}</span>
              <div className="text-2xl sm:text-3xl font-extrabold text-rose-800 font-mono mt-1">{rejectedCount}</div>
            </button>
          )}

        </div>

        {/* MY REPORTED COMPLAINTS */}
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-200 pb-3">
            <h2 className="text-lg font-extrabold text-gray-900 font-outfit">{t('myComplaints')}</h2>

            <div className="flex items-center space-x-1 bg-white p-1 rounded-xl border border-gray-200 text-xs font-semibold">
              {(rejectedCount > 0
                ? (['All', 'Pending', 'In Progress', 'Resolved', 'Reopened', 'Rejected'] as const)
                : (['All', 'Pending', 'In Progress', 'Resolved', 'Reopened'] as const)
              ).map((tab) => (
                <button
                  key={tab}
                  onClick={() => setActiveFilter(tab)}
                  className={`px-3 py-1.5 rounded-lg transition-all ${
                    activeFilter === tab
                      ? 'bg-emerald-600 text-white font-bold shadow-xs'
                      : 'text-gray-600 hover:text-gray-900 hover:bg-gray-50'
                  }`}
                >
                  {tab === 'All' ? t('all') : tab === 'Pending' ? t('pending') : tab === 'In Progress' ? t('inProgress') : tab === 'Resolved' ? t('resolved') : tab === 'Reopened' ? t('statusReopened') : t('statusRejected')}
                </button>
              ))}
            </div>
          </div>

          {filteredComplaints.length === 0 ? (
            <div className="bg-white rounded-2xl p-12 text-center border border-gray-200 space-y-4">
              <div className="w-14 h-14 rounded-2xl bg-gray-50 text-gray-400 flex items-center justify-center mx-auto border border-gray-200">
                <FileText className="w-7 h-7" />
              </div>
              <h3 className="text-base font-bold text-gray-900 font-outfit">{t('noComplaintsFound')}</h3>
              <Link
                to="/citizen/report"
                className="inline-flex items-center space-x-2 px-5 py-2.5 rounded-xl bg-emerald-600 text-white font-bold text-xs uppercase shadow-sm hover:bg-emerald-700 min-h-[44px]"
              >
                <PlusCircle className="w-4 h-4" />
                <span>+ {t('reportComplaint')}</span>
              </Link>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {filteredComplaints.map((comp) => (
                <div
                  key={comp.id}
                  className="bg-white rounded-2xl p-5 border border-gray-200 shadow-sm hover:border-emerald-500 transition-all flex flex-col justify-between space-y-4"
                >
                  <div className="space-y-3">
                    <div className="relative rounded-xl overflow-hidden h-40 bg-gray-100 border border-gray-200">
                      {comp.photo_before_url ? (
                        <img
                          src={getValidImageUrl(comp.photo_before_url)}
                          alt={comp.title}
                          className="w-full h-full object-cover"
                          onError={(e) => {
                            e.currentTarget.src = DEFAULT_CIVIC_IMAGE_PLACEHOLDER;
                          }}
                        />
                      ) : (
                        <div className="w-full h-full flex flex-col items-center justify-center bg-gray-50 text-gray-400 space-y-1">
                          <FileText className="w-6 h-6 text-gray-300" />
                          <span className="text-[11px] font-semibold text-gray-400">{t('noImage')}</span>
                        </div>
                      )}
                      <div className="absolute top-2 left-2">
                        <StatusBadge status={comp.status} />
                      </div>
                      <div className="absolute top-2 right-2">
                        <PriorityBadge priority={comp.priority} />
                      </div>
                    </div>

                    <div>
                      <div className="flex items-center justify-between">
                        <span className="text-[10px] uppercase font-bold text-emerald-700 tracking-wider font-mono">
                          {comp.complaint_number}
                        </span>
                        <span className="text-[10px] text-gray-500">{translateCategory(comp.category)}</span>
                      </div>
                      <h3 className="text-sm font-extrabold text-gray-900 leading-snug mt-0.5 line-clamp-1">
                        {comp.title}
                      </h3>
                      <p className="text-xs text-gray-600 mt-1 line-clamp-2">{comp.description}</p>
                    </div>
                  </div>

                  <div className="pt-3 border-t border-gray-100 flex items-center justify-between text-xs">
                    <span className="text-[10px] text-gray-500 font-mono flex items-center space-x-1">
                      <Clock className="w-3 h-3 text-gray-400" />
                      <span>{new Date(comp.created_at).toLocaleDateString()}</span>
                    </span>

                    <Link
                      to={`/citizen/complaint/${comp.id}`}
                      className="px-3 py-1.5 rounded-lg bg-emerald-50 hover:bg-emerald-100 text-emerald-800 font-extrabold text-xs transition-colors flex items-center space-x-1 min-h-[44px]"
                    >
                      <span>{t('view')}</span>
                      <ArrowRight className="w-3 h-3" />
                    </Link>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* SECTION: OFFICIAL ANNOUNCEMENTS & CITY UPDATES */}
        <div className="space-y-4 pt-4 border-t border-gray-200">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-extrabold text-gray-900 font-outfit flex items-center space-x-2">
                <Megaphone className="w-5 h-5 text-emerald-600" />
                <span>{t('announcements')}</span>
              </h2>
            </div>

            <Link
              to="/citizen/announcements"
              className="text-xs font-extrabold text-emerald-700 hover:text-emerald-800 flex items-center space-x-1 bg-emerald-50 px-3.5 py-2 rounded-xl border border-emerald-200 min-h-[44px]"
            >
              <span>{t('view')} {t('announcements')}</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </Link>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {announcements.map((ann) => (
              <div
                key={ann.id}
                className="bg-white rounded-2xl p-5 border border-gray-200 shadow-sm hover:shadow-md transition-all flex flex-col justify-between space-y-3"
              >
                <div className="space-y-2 text-xs">
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-emerald-800 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200 text-[10px]">
                      📢 {ann.category}
                    </span>
                    <span className={`px-2 py-0.5 rounded text-[10px] font-extrabold uppercase ${
                      ann.priority === 'Emergency' ? 'bg-rose-600 text-white' : 'bg-emerald-600 text-white'
                    }`}>
                      {ann.priority}
                    </span>
                  </div>

                  <h3 className="font-extrabold text-gray-900 font-outfit text-sm leading-snug line-clamp-2">
                    {ann.title}
                  </h3>

                  <p className="text-gray-600 text-[11px] line-clamp-2 leading-relaxed">
                    {ann.description}
                  </p>

                  <div className="pt-2 border-t border-gray-100 flex items-center justify-between text-[11px] text-gray-500 font-medium">
                    <span>📍 {ann.area}</span>
                    <span>{ann.start_date}</span>
                  </div>
                </div>

                <Link
                  to={`/citizen/announcements/${ann.id}`}
                  className="w-full py-2.5 rounded-xl bg-gray-50 hover:bg-emerald-50 text-gray-800 hover:text-emerald-800 font-extrabold text-xs uppercase tracking-wider border border-gray-200 flex items-center justify-center space-x-1 min-h-[44px]"
                >
                  <span>{t('view')}</span>
                  <ArrowRight className="w-3.5 h-3.5" />
                </Link>
              </div>
            ))}
          </div>
        </div>

        {/* SECTION: ONGOING MUNICIPAL WORK NEAR YOU */}
        <div className="space-y-4 pt-4 border-t border-gray-200">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-extrabold text-gray-900 font-outfit flex items-center space-x-2">
                <HardHat className="w-5 h-5 text-amber-600" />
                <span>{t('civicWorks')}</span>
              </h2>
            </div>

            <Link
              to="/citizen/work"
              className="text-xs font-extrabold text-emerald-700 hover:text-emerald-800 flex items-center space-x-1 bg-emerald-50 px-3.5 py-2 rounded-xl border border-emerald-200 min-h-[44px]"
            >
              <span>{t('view')} {t('civicWorks')}</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </Link>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {maintenanceWorks.map((work) => (
              <div
                key={work.id}
                className="bg-white rounded-2xl p-5 border border-gray-200 shadow-sm hover:shadow-md transition-all flex flex-col justify-between space-y-3"
              >
                <div className="space-y-2 text-xs">
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-gray-700 bg-gray-50 px-2 py-0.5 rounded border border-gray-200 text-[10px]">
                      🏢 {work.department_name}
                    </span>
                    <span className={`px-2 py-0.5 rounded text-[10px] font-extrabold uppercase border ${getMaintenanceBadge(work.status)}`}>
                      {work.status}
                    </span>
                  </div>

                  <h3 className="font-extrabold text-gray-900 font-outfit text-sm leading-snug line-clamp-2">
                    {work.title}
                  </h3>

                  <p className="text-gray-600 text-[11px] line-clamp-2 leading-relaxed">
                    {work.description}
                  </p>

                  <div className="pt-2 border-t border-gray-100 flex items-center justify-between text-[11px] text-gray-500 font-medium">
                    <span>📍 {work.area}</span>
                    <span>{work.expected_completion}</span>
                  </div>
                </div>

                <Link
                  to={`/citizen/work/${work.id}`}
                  className="w-full py-2.5 rounded-xl bg-gray-50 hover:bg-emerald-50 text-gray-800 hover:text-emerald-800 font-extrabold text-xs uppercase tracking-wider border border-gray-200 flex items-center justify-center space-x-1 min-h-[44px]"
                >
                  <span>{t('view')}</span>
                  <ArrowRight className="w-3.5 h-3.5" />
                </Link>
              </div>
            ))}
          </div>
        </div>

      </div>
    </DashboardLayout>
  );
};
