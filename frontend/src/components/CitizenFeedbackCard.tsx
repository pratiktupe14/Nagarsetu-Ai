import React from 'react';
import { Star, MessageSquareQuote, Calendar, Hash, UserCheck } from 'lucide-react';

export interface CitizenFeedbackCardProps {
  citizenName?: string | null;
  complaintNumber?: string | null;
  rating?: number | null;
  review?: string | null;
  submissionDate?: string | null;
  className?: string;
}

export const CitizenFeedbackCard: React.FC<CitizenFeedbackCardProps> = ({
  citizenName,
  complaintNumber,
  rating,
  review,
  submissionDate,
  className = ''
}) => {
  if (!rating && !review) {
    return (
      <div className={`p-6 text-center border border-gray-200 rounded-xl bg-gray-50/70 space-y-1.5 ${className}`}>
        <MessageSquareQuote className="w-7 h-7 text-gray-400 mx-auto" />
        <p className="text-xs font-bold text-gray-700">No citizen feedback submitted yet.</p>
        <p className="text-[11px] text-gray-500">Citizen rating and written review will appear here once submitted.</p>
      </div>
    );
  }

  // Display full registered citizen name; if unavailable default to 'Citizen' rather than inventing an identity
  const rawName = citizenName ? String(citizenName).trim() : '';
  const isAnonymous = !rawName || rawName.toLowerCase() === 'anonymous' || rawName.toLowerCase() === 'anonymous citizen' || rawName.toLowerCase() === 'anonymous resident';
  const displayName = !isAnonymous ? rawName : 'Citizen';

  // Format submission date safely
  let formattedDate = 'Recently submitted';
  if (submissionDate) {
    try {
      const d = new Date(submissionDate);
      if (!isNaN(d.getTime())) {
        formattedDate = d.toLocaleDateString('en-GB', {
          day: '2-digit',
          month: 'short',
          year: 'numeric'
        }) + ', ' + d.toLocaleTimeString('en-US', {
          hour: '2-digit',
          minute: '2-digit',
          hour12: true
        });
      }
    } catch {
      formattedDate = String(submissionDate);
    }
  }

  const starCount = Math.min(Math.max(Number(rating || 0), 1), 5);

  return (
    <div className={`bg-gradient-to-br from-emerald-50/80 via-white to-emerald-50/40 border border-emerald-200/90 rounded-2xl p-5 shadow-xs space-y-4 ${className}`}>
      {/* Header: Citizen Name & Rating */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-emerald-100 pb-3">
        <div className="flex items-center space-x-2.5">
          <div className="w-8 h-8 rounded-full bg-emerald-600 text-white flex items-center justify-center font-extrabold text-xs shadow-xs">
            {displayName.charAt(0).toUpperCase()}
          </div>
          <div>
            <div className="flex items-center space-x-1.5">
              <span className="text-xs font-extrabold text-gray-900 tracking-tight">{displayName}</span>
              <span className="inline-flex items-center space-x-0.5 px-2 py-0.5 bg-emerald-100 text-emerald-800 text-[10px] font-bold rounded-full">
                <UserCheck className="w-3 h-3 text-emerald-700" />
                <span>Verified Citizen</span>
              </span>
            </div>
            {complaintNumber && (
              <span className="flex items-center space-x-1 text-[11px] font-mono text-gray-500 mt-0.5">
                <Hash className="w-3 h-3 text-gray-400" />
                <span>{complaintNumber}</span>
              </span>
            )}
          </div>
        </div>

        {/* Stars */}
        <div className="flex items-center space-x-1 bg-white px-3 py-1.5 rounded-xl border border-emerald-200/80 shadow-2xs">
          {[1, 2, 3, 4, 5].map((star) => (
            <Star
              key={star}
              className={`w-4 h-4 ${
                star <= starCount
                  ? 'fill-amber-400 text-amber-400'
                  : 'text-gray-300'
              }`}
            />
          ))}
          <span className="text-xs font-black text-emerald-950 font-mono ml-1.5">
            {starCount}.0/5
          </span>
        </div>
      </div>

      {/* Written Review */}
      <div className="space-y-1.5">
        <span className="text-[10px] font-extrabold uppercase tracking-wider text-emerald-900/80 block">
          Citizen Review
        </span>
        <div className="p-3.5 bg-white rounded-xl border border-emerald-100/80 text-xs text-gray-800 leading-relaxed italic relative">
          <MessageSquareQuote className="w-4 h-4 text-emerald-400 inline-block mr-1.5 align-text-top" />
          "{review || 'Satisfactory work completed.'}"
        </div>
      </div>

      {/* Footer: Submission Date */}
      <div className="flex items-center justify-between text-[11px] text-gray-500 font-mono pt-1">
        <span className="flex items-center space-x-1 text-gray-600">
          <Calendar className="w-3 h-3 text-emerald-600" />
          <span>Submitted on: {formattedDate}</span>
        </span>
        <span className="text-[10px] font-bold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200">
          Official Feedback
        </span>
      </div>
    </div>
  );
};
