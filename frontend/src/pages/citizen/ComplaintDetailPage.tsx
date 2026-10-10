import React, { useState, useEffect, useCallback } from 'react';
import { useParams, Link } from 'react-router-dom';
import { DashboardLayout } from '../../components/DashboardLayout';
import { StatusBadge } from '../../components/StatusBadge';
import { PriorityBadge } from '../../components/PriorityBadge';
import { RiskAssessmentCard } from '../../components/RiskAssessmentCard';
import { LocationMapPicker } from '../../components/LocationMapPicker';
import { ActivityTimeline } from '../../components/ActivityTimeline';
import { RelatedIssuesSection } from '../../components/RelatedIssuesSection';
import { getComplaintById, getAllComplaints, getCitizenComplaints, submitComplaintFeedback, reopenComplaint } from '../../services/complaintService';
import { isValidCoordinate } from '../../services/locationService';
import { useRealtimeComplaints } from '../../hooks/useRealtimeComplaints';
import { Complaint, ComplaintStatus } from '../../types/database.types';
import { Star, ArrowLeft, Send, RotateCcw, UserCheck, Zap, MapPin, Flame, Users, Layers, Clock } from 'lucide-react';
import { getValidImageUrl, DEFAULT_CIVIC_IMAGE_PLACEHOLDER } from '../../lib/supabase';
import { formatPortalDateTime, formatPortalDate, formatPortalTime } from '../../utils/dateUtils';
import { useLanguage } from '../../context/LanguageContext';

function formatResponseTimeLabel(hours?: number, deadline?: string, createdAt?: string): string {
  if (hours) {
    if (hours === 360) return '15 Days';
    if (hours === 96) return '4 Days';
    if (hours === 48) return '48 Hours';
    if (hours === 24) return '24 Hours';
    if (hours >= 24 && hours % 24 === 0) return `${hours / 24} Days`;
    return `${hours} Hours`;
  }
  if (deadline && createdAt) {
    const diffHours = Math.round((new Date(deadline).getTime() - new Date(createdAt).getTime()) / (1000 * 60 * 60));
    if (diffHours >= 350 && diffHours <= 370) return '15 Days';
    if (diffHours >= 90 && diffHours <= 100) return '4 Days';
    if (diffHours >= 45 && diffHours <= 50) return '48 Hours';
    if (diffHours >= 20 && diffHours <= 26) return '24 Hours';
    if (diffHours >= 24 && diffHours % 24 === 0) return `${Math.round(diffHours / 24)} Days`;
    if (diffHours > 0) return `${diffHours} Hours`;
  }
  return '4 Days';
}

export const ComplaintDetailPage: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const { t, lang, translateCategory, translateStatus, translatePriority, translateDepartment } = useLanguage();

  const [complaint, setComplaint] = useState<Complaint | null>(null);
  const [allComplaints, setAllComplaints] = useState<Complaint[]>([]);
  const [loading, setLoading] = useState(true);

  const [rating, setRating] = useState(5);
  const [feedbackComment, setFeedbackComment] = useState('');
  const [feedbackSubmitted, setFeedbackSubmitted] = useState(false);

  const [showReopenModal, setShowReopenModal] = useState(false);
  const [reopenReason, setReopenReason] = useState('');
  const [submittingReopen, setSubmittingReopen] = useState(false);

  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    if (!id) {
      setLoading(false);
      setErrorMsg('Complaint ID not specified.');
      return;
    }

    setLoading(true);
    setErrorMsg(null);
    try {
      let data = await getComplaintById(id);
      if (!data) {
        // Fallback: check citizen's complaints list
        try {
          const userStr = sessionStorage.getItem('nagarsetu_user') || localStorage.getItem('nagarsetu_user');
          const userObj = userStr ? JSON.parse(userStr) : null;
          const myComplaints = await getCitizenComplaints(userObj?.id || '');
          if (myComplaints && myComplaints.length > 0) {
            data = myComplaints.find((c) => c.complaint_number === id || String(c.id) === id) || null;
            if (!data && (id === '1' || !isNaN(Number(id)))) {
              data = myComplaints[0];
            }
          }
        } catch (mErr) {}
      }

      if (data) {
        setComplaint(data);
        setErrorMsg(null);
      } else {
        setComplaint(null);
        setErrorMsg(`Complaint not found for ID "${id}".`);
      }
      // Non-blocking background fetch for list
      getAllComplaints().then((list) => setAllComplaints(list)).catch(() => {});
    } catch (e: any) {
      console.error('Error loading complaint detail:', e);
      setComplaint(null);
      setErrorMsg('Unable to load complaint details. Please check your network connection.');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Subscribe to real-time complaint updates across portals
  useRealtimeComplaints(useCallback(() => {
    if (!id) return;
    getComplaintById(id).then((updated) => {
      if (updated) setComplaint(updated);
    });
  }, [id]));

  const handleFeedbackSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!complaint) return;
    await submitComplaintFeedback(complaint.id, rating, feedbackComment);
    setFeedbackSubmitted(true);
    loadData();
  };

  const handleReopenSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!complaint || !reopenReason) return;
    setSubmittingReopen(true);
    try {
      await reopenComplaint(complaint.id, reopenReason);
      setShowReopenModal(false);
      loadData();
    } catch (e) {
      console.error(e);
    } finally {
      setSubmittingReopen(false);
    }
  };

  if (loading) {
    return (
      <DashboardLayout title="Complaint Details">
        <div className="max-w-md mx-auto py-20 px-4 text-center space-y-4 font-sans">
          <div className="w-10 h-10 rounded-full border-4 border-emerald-600 border-t-transparent animate-spin mx-auto" />
          <p className="text-xs font-bold text-gray-700 font-outfit">Loading complaint details...</p>
        </div>
      </DashboardLayout>
    );
  }

  if (errorMsg || !complaint) {
    return (
      <DashboardLayout title="Complaint Details">
        <div className="max-w-md mx-auto py-16 px-4 text-center space-y-4 font-sans">
          <div className="w-16 h-16 rounded-2xl bg-amber-50 border border-amber-200 text-amber-700 flex items-center justify-center mx-auto">
            <Flame className="w-8 h-8 text-amber-600" />
          </div>
          <h2 className="text-xl font-extrabold text-gray-900 font-outfit">
            {errorMsg || 'Complaint Not Found'}
          </h2>
          {id && (
            <p className="text-xs text-gray-500 font-mono">
              Complaint ID: {id}
            </p>
          )}
          <div className="flex items-center justify-center space-x-3 pt-2">
            <button
              onClick={() => loadData()}
              className="px-4 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs uppercase shadow-sm"
            >
              Try Again
            </button>
            <Link
              to="/citizen/complaints"
              className="px-4 py-2.5 rounded-xl bg-gray-100 hover:bg-gray-200 text-gray-700 font-bold text-xs"
            >
              Back to My Complaints
            </Link>
          </div>
        </div>
      </DashboardLayout>
    );
  }

  const isResolved = complaint.status === 'Resolved' || complaint.status === 'Resolution Submitted';

  return (
    <DashboardLayout title="Complaint Details">
      <div className="p-4 sm:p-6 lg:p-8 space-y-6 max-w-[1400px] mx-auto text-gray-900 bg-white min-h-screen font-sans">
        
        {/* TOP BACK BAR */}
        <div className="flex items-center justify-between border-b border-gray-200 pb-4">
          <Link
            to="/citizen/complaints"
            className="inline-flex items-center space-x-1.5 text-xs font-bold text-gray-600 hover:text-emerald-600 transition-colors min-h-[44px]"
          >
            <ArrowLeft className="w-4 h-4" />
            <span>{t('backToMyComplaints')}</span>
          </Link>

          <span className="font-mono text-xs font-extrabold text-emerald-700 bg-emerald-50 px-3 py-1 rounded-full border border-emerald-200">
            {complaint.complaint_number}
          </span>
        </div>

        {/* MAIN DETAIL CARD */}
        <div className="bg-white rounded-2xl p-6 sm:p-8 border border-gray-200 shadow-xs space-y-6">
          
          <div className="flex flex-wrap items-start justify-between gap-4 border-b border-gray-100 pb-4">
            <div className="space-y-1">
              <div className="flex items-center space-x-2">
                <StatusBadge status={complaint.status} />
                <PriorityBadge priority={complaint.priority} />
              </div>
              <h1 className="text-2xl sm:text-3xl font-extrabold text-gray-900 font-outfit pt-1">
                {complaint.title}
              </h1>
              <p className="text-xs text-gray-500 font-mono">Category: {complaint.category}</p>
            </div>

            <div className="text-right text-xs text-gray-500 font-mono">
              <span>Submitted: {formatPortalDateTime(complaint.created_at)}</span>
            </div>
          </div>

          {/* 4-QUADRANT RISK ASSESSMENT */}
          <RiskAssessmentCard
            safety_score={complaint.safety_score}
            disruption_score={complaint.disruption_score}
            health_environment_score={complaint.health_environment_score}
            defect_severity_score={complaint.defect_severity_score}
            risk_score={complaint.risk_score}
            priority_rank={complaint.priority_rank}
            priority={complaint.priority}
          />

          {/* COMMUNITY IMPACT & DUPLICATE INTELLIGENCE CARD */}
          <div className="p-5 rounded-2xl bg-emerald-50/70 border border-emerald-300 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center space-x-2">
                <span className="px-2.5 py-1 rounded-lg bg-emerald-600 text-white font-extrabold text-xs font-outfit uppercase tracking-wider flex items-center space-x-1 shadow-xs">
                  <Flame className="w-3.5 h-3.5" />
                  <span>Civic Impact Vector</span>
                </span>
                <span className="font-mono text-xs font-bold text-emerald-900">
                  {complaint.support_count || 1} Citizen Support Backing
                </span>
              </div>
            </div>

            <p className="text-xs text-emerald-800 leading-relaxed font-medium">
              This issue has been verified and grouped within the municipal GIS cluster to prevent duplicate civic tickets and prioritize fast dispatch.
            </p>
          </div>

          {/* RECURRING ISSUE INTELLIGENCE */}
          {complaint.recurring_issue?.is_recurring && (
            <div className="p-4 rounded-2xl bg-amber-50 border border-amber-300 text-amber-900 space-y-2">
              <div className="flex items-center space-x-2">
                <span className="px-2.5 py-0.5 rounded-lg bg-amber-600 text-white font-extrabold text-xs font-outfit uppercase tracking-wider">
                  Potential Recurring Issue
                </span>
                <span className="text-xs font-bold text-amber-800">
                  Status: {complaint.recurring_issue.recurrence_status}
                </span>
              </div>
              <p className="text-xs text-amber-800 leading-relaxed font-medium">
                Previous resolved incident #{complaint.recurring_issue.previous_complaint_number || complaint.recurring_issue.previous_complaint_id} found within {complaint.recurring_issue.distance_meters != null ? `${complaint.recurring_issue.distance_meters} meters` : 'vicinity'}.
              </p>
            </div>
          )}

          {/* BEFORE & AFTER PHOTO EVIDENCE */}
          <div className="space-y-3">
            <h3 className="text-sm font-extrabold text-gray-900 font-outfit uppercase tracking-wider">Photo Evidence</h3>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <span className="text-xs font-bold text-gray-700 block">BEFORE (Reported Condition)</span>

                <div className="rounded-xl overflow-hidden border border-gray-200 bg-gray-50 h-60">
                  <img
                    src={getValidImageUrl(complaint.photo_before_url || complaint.photo_front_url)}
                    alt="Before repair"
                    className="w-full h-full object-cover"
                    onError={(e) => {
                      const fallback = getValidImageUrl(DEFAULT_CIVIC_IMAGE_PLACEHOLDER);
                      if (e.currentTarget.src !== fallback) {
                        e.currentTarget.src = fallback;
                      }
                    }}
                  />
                </div>
              </div>

              {complaint.photo_after_url && (
                <div className="space-y-2">
                  <span className="text-xs font-bold font-outfit text-emerald-700 block">AFTER (Resolution Proof)</span>
                  <div className="rounded-xl overflow-hidden border-2 border-emerald-400 bg-emerald-50/30 h-60">
                    <img
                      src={getValidImageUrl(complaint.photo_after_url)}
                      alt="After repair proof"
                      className="w-full h-full object-cover"
                      onError={(e) => { e.currentTarget.src = DEFAULT_CIVIC_IMAGE_PLACEHOLDER; }}
                    />
                  </div>
                </div>
              )}

              {/* Multi-Angle Evidence Photos if available */}
              {(() => {
                let angles: Array<{ label: string; url: string }> = [];
                if (complaint.angle_photos) {
                  try {
                    const parsed = typeof complaint.angle_photos === 'string' ? JSON.parse(complaint.angle_photos) : complaint.angle_photos;
                    if (Array.isArray(parsed)) {
                      angles = parsed.filter(p => p && p.url);
                    }
                  } catch (e) {}
                }
                if (angles.length === 0) {
                  if (complaint.photo_left_url) angles.push({ label: 'Left View', url: complaint.photo_left_url });
                  if (complaint.photo_right_url) angles.push({ label: 'Right View', url: complaint.photo_right_url });
                  if (complaint.photo_closeup_url) angles.push({ label: 'Close-up Detail', url: complaint.photo_closeup_url });
                }
                if (angles.length === 0) return null;

                return (
                  <div className="col-span-full pt-3 space-y-2">
                    <span className="text-xs font-bold text-gray-700 block uppercase tracking-wider">Multi-Angle Inspection Evidence ({angles.length} angle{angles.length > 1 ? 's' : ''})</span>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                      {angles.map((ang, idx) => (
                        <div key={idx} className="space-y-1">
                          <div className="rounded-lg overflow-hidden border border-gray-200 bg-gray-50 h-28">
                            <img
                              src={getValidImageUrl(ang.url)}
                              alt={ang.label}
                              className="w-full h-full object-cover"
                              onError={(e) => { e.currentTarget.src = DEFAULT_CIVIC_IMAGE_PLACEHOLDER; }}
                            />
                          </div>
                          <span className="text-[11px] font-mono font-semibold text-gray-600 block truncate">{ang.label}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })()}
            </div>
          </div>

          {/* DESCRIPTION */}
          <div className="space-y-2 pt-2 border-t border-gray-100">
            <h3 className="text-sm font-extrabold text-gray-900 font-outfit uppercase tracking-wider">Detailed Description</h3>
            <p className="text-xs text-gray-700 leading-relaxed bg-slate-50 p-4 rounded-xl border border-gray-200 font-medium">
              {complaint.description || 'No additional text description provided by citizen.'}
            </p>
          </div>

          {/* DEPARTMENT & STAFF ASSIGNMENT INFO */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2 border-t border-gray-100 text-xs">
            <div className="p-4 rounded-xl bg-slate-50 border border-gray-200 space-y-1">
              <span className="text-gray-500 font-medium block">Responsible Municipal Department</span>
              <span className="font-extrabold text-gray-900 text-sm font-outfit block">{complaint.department_name || 'Municipal Triage Queue'}</span>
            </div>

            <div className="p-4 rounded-xl bg-slate-50 border border-gray-200 space-y-1">
              <span className="text-gray-500 font-medium block">Assigned Field Staff Officer</span>
              <span className="font-extrabold text-gray-900 text-sm font-outfit block">{complaint.assigned_staff_name || 'Awaiting Officer Dispatch'}</span>
            </div>
          </div>

          {/* RESPONSE TIME & SLA DEADLINE INFO */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2 border-t border-gray-100 text-xs">
            <div className="p-4 rounded-xl bg-slate-50 border border-gray-200 space-y-1">
              <span className="text-gray-500 font-medium flex items-center space-x-1">
                <Clock className="w-3.5 h-3.5 text-gray-500" />
                <span>Response Time</span>
              </span>
              <span className="font-extrabold text-gray-900 text-sm font-outfit block">
                {formatResponseTimeLabel(complaint.response_time_hours, complaint.sla_deadline, complaint.created_at)}
              </span>
            </div>

            <div className="p-4 rounded-xl bg-slate-50 border border-gray-200 space-y-1">
              <span className="text-gray-500 font-medium flex items-center space-x-1">
                <Clock className="w-3.5 h-3.5 text-emerald-600" />
                <span>Response Deadline</span>
              </span>
              <span className="font-extrabold text-emerald-800 text-sm font-outfit block">
                {complaint.sla_deadline ? new Date(complaint.sla_deadline).toLocaleString() : 'Standard SLA Queue'}
              </span>
            </div>
          </div>

          {/* WORK RESOLUTION NOTES & MATERIALS */}
          {complaint.work_performed && (
            <div className="p-5 rounded-2xl bg-slate-50 border border-gray-200 space-y-2 text-xs">
              <h4 className="font-extrabold text-gray-900 font-outfit uppercase tracking-wider">Maintenance Resolution Summary</h4>
              <p className="text-gray-800 font-medium">{complaint.work_performed}</p>
              {complaint.materials_used && (
                <p className="text-gray-500 font-mono text-[11px]">Materials Used: {complaint.materials_used}</p>
              )}
            </div>
          )}

          {/* LOCATION & GIS MAP */}
          <div className="space-y-3 pt-2 border-t border-gray-100">
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-2">
                <MapPin className="w-4 h-4 text-emerald-600" />
                <h3 className="text-sm font-extrabold text-gray-900 font-outfit uppercase tracking-wider">Location & GIS Verification</h3>
              </div>
              <span className="text-xs text-gray-500 font-mono">{complaint.location_address}</span>
            </div>

            {isValidCoordinate(complaint.latitude, complaint.longitude) ? (
              <LocationMapPicker
                initialLat={Number(complaint.latitude)}
                initialLng={Number(complaint.longitude)}
                interactive={false}
              />
            ) : (
              <div className="p-8 rounded-2xl bg-amber-50 border border-amber-200 text-center space-y-2 font-sans">
                <MapPin className="w-6 h-6 text-amber-600 mx-auto" />
                <p className="text-xs font-bold text-amber-900 font-outfit">Location Coordinates Unavailable</p>
                <p className="text-[11px] text-amber-700 font-mono">
                  Address: {complaint.location_address || 'Address pending verification'}
                </p>
              </div>
            )}
          </div>

          {/* REAL-TIME COMPLAINT ACTIVITY TIMELINE */}
          <div className="pt-2 border-t border-gray-100">
            <ActivityTimeline complaintId={complaint.id} />
          </div>

          {/* CITIZEN RESOLUTION RATING & FEEDBACK */}
          {isResolved && (
            <div className="p-6 bg-slate-50 border border-gray-200 rounded-2xl space-y-4 pt-4 border-t border-gray-200">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-extrabold text-gray-900 font-outfit uppercase tracking-wider">Rate Resolution Quality</h3>
                {complaint.rating && (
                  <span className="text-xs font-mono text-emerald-700 font-bold">Rating Submitted</span>
                )}
              </div>

              {feedbackSubmitted || complaint.rating ? (
                <div className="p-4 bg-emerald-50 border border-emerald-300 rounded-xl text-xs space-y-1 text-emerald-900">
                  <div className="flex items-center space-x-1 text-amber-500">
                    {[1, 2, 3, 4, 5].map((star) => (
                      <Star key={star} className={`w-4 h-4 ${star <= (complaint.rating || rating) ? 'fill-amber-400 text-amber-400' : 'text-gray-300'}`} />
                    ))}
                  </div>
                  <span className="font-bold block">Thank you for rating municipal service resolution quality!</span>
                  {complaint.feedback_comment && (
                    <p className="text-gray-700 italic">"{complaint.feedback_comment}"</p>
                  )}
                </div>
              ) : (
                <form onSubmit={handleFeedbackSubmit} className="space-y-4 text-xs">
                  <div className="space-y-1">
                    <label className="block text-gray-700 font-bold">Resolution Rating *</label>
                    <div className="flex items-center space-x-2">
                      {[1, 2, 3, 4, 5].map((star) => (
                        <button
                          key={star}
                          type="button"
                          onClick={() => setRating(star)}
                          className="p-1 focus:outline-none"
                        >
                          <Star className={`w-6 h-6 ${star <= rating ? 'fill-amber-400 text-amber-400' : 'text-gray-300'}`} />
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="space-y-1">
                    <label className="block text-gray-700 font-bold">Feedback / Repair Quality Note</label>
                    <textarea aria-label="feedback Comment"
                      rows={3}
                      value={feedbackComment}
                      onChange={(e) => setFeedbackComment(e.target.value)}
                      placeholder="Add comments on whether the repair was completed satisfactorily..."
                      className="w-full bg-white border border-gray-300 rounded-xl p-2.5 text-xs text-gray-900 font-medium"
                    />
                  </div>

                  <div className="flex items-center justify-between pt-2">
                    <button
                      type="submit"
                      className="px-5 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white font-extrabold text-xs rounded-xl shadow-xs inline-flex items-center space-x-1.5 min-h-[44px]"
                    >
                      <Send className="w-4 h-4" />
                      <span>Submit Resolution Rating</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => setShowReopenModal(true)}
                      className="px-4 py-2.5 bg-orange-50 text-orange-700 hover:bg-orange-100 border border-orange-300 font-bold text-xs rounded-xl inline-flex items-center space-x-1 min-h-[44px]"
                    >
                      <RotateCcw className="w-4 h-4" />
                      <span>Issue Not Fixed? Reopen Complaint</span>
                    </button>
                  </div>
                </form>
              )}
            </div>
          )}

          {/* LINKED / NEARBY ISSUES SECTION */}
          <div className="pt-4 border-t border-gray-100">
            <RelatedIssuesSection
              currentComplaint={complaint}
              allComplaints={allComplaints}
            />
          </div>

        </div>

        {/* REOPEN COMPLAINT MODAL */}
        {showReopenModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-gray-900/40 backdrop-blur-xs font-sans overflow-y-auto">
            <div className="max-w-md w-full bg-white rounded-2xl p-4 sm:p-6 border border-gray-200 shadow-md space-y-4 max-h-[90vh] my-auto overflow-y-auto">
              <div className="flex items-center space-x-2 text-orange-600">
                <RotateCcw className="w-5 h-5" />
                <h3 className="text-base font-extrabold text-gray-900 font-outfit">Reopen Civic Complaint</h3>
              </div>

              <p className="text-xs text-gray-600 leading-relaxed">
                If the municipal resolution was incomplete or the problem has recurred, submit a reason below to reopen this complaint for re-inspection.
              </p>

              <form onSubmit={handleReopenSubmit} className="space-y-4 text-xs">
                <div>
                  <label className="block font-bold text-gray-700 mb-1">Reopen Reason *</label>
                  <textarea aria-label="reopen Reason"
                    rows={3}
                    required
                    value={reopenReason}
                    onChange={(e) => setReopenReason(e.target.value)}
                    placeholder="Explain why the issue requires further repair..."
                    className="w-full bg-white border border-gray-300 rounded-xl p-2.5 text-xs text-gray-900 font-medium"
                  />
                </div>

                <div className="flex items-center justify-end space-x-3 pt-2">
                  <button
                    type="button"
                    onClick={() => setShowReopenModal(false)}
                    className="px-4 py-2 rounded-xl bg-gray-100 text-gray-700 font-bold min-h-[44px]"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={submittingReopen}
                    className="px-5 py-2 rounded-xl bg-orange-600 hover:bg-orange-700 text-white font-extrabold text-xs uppercase tracking-wider min-h-[44px]"
                  >
                    {submittingReopen ? 'Reopening...' : 'Confirm Reopen'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

      </div>
    </DashboardLayout>
  );
};
