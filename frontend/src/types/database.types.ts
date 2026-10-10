export type UserRole = 'citizen' | 'city_admin' | 'department_head' | 'service_staff';

export type ComplaintStatus = 
  | 'Submitted' 
  | 'NEEDS_VERIFICATION'
  | 'Verified' 
  | 'Approved' 
  | 'Department Assigned' 
  | 'Staff Assigned'
  | 'Accepted'
  | 'On the Way'
  | 'In Progress' 
  | 'Resolution Submitted'
  | 'Resolved' 
  | 'Reopened' 
  | 'Rejected';

export type PriorityLevel = 'Low' | 'Medium' | 'High' | 'Critical';

export type NotificationType =
  | 'submitted'
  | 'verified'
  | 'approved'
  | 'department_assigned'
  | 'staff_assigned'
  | 'work_started'
  | 'resolution_submitted'
  | 'resolved'
  | 'reopened'
  | 'critical'
  | 'sla_warning'
  | 'sla_breached';

export type AIMode = 'demo' | 'production';

export interface VisualFeatures {
  dHash: string; // 64-bit difference hash
  brightness: number; // 0 - 255
  contrast: number; // 0 - 100
  dominantColors: string[]; // hex codes
  edgeDensity: number; // 0 - 1
  vector: number[]; // 32-dim feature embedding
}

export interface ImageSimilarityResult {
  isExactDuplicate: boolean;
  similarityScore: number; // 0 - 1
  confidenceLevel: 'High' | 'Medium' | 'Low';
  relation: 'exact_duplicate' | 'same_issue_different_angle' | 'same_category_different_issue' | 'different_issue';
  reason: string;
}

export interface AIVisionResult {
  mode: AIMode;
  analysis_id?: string;
  image_hash?: string;
  category: string;
  issue_type?: string;
  confidence: number; // e.g. 0.94
  confidence_level?: 'High' | 'Medium' | 'Low';
  priority: PriorityLevel;
  department: string;
  title: string;
  description: string;
  error_code?: string;
  error_message?: string;
  is_available?: boolean;
  visual_features?: VisualFeatures;
  detected_objects?: string[];
  quality_check?: {
    isUsable: boolean;
    warning?: string;
    brightness: number;
    contrast: number;
  };
  analysis_time_ms: number;
  aiStatus?: string;
  severity?: string;
  transparencyNotice?: string;
  explanation?: {
    detectedIssue?: string;
    confidence?: number;
    confidenceLevel?: string;
    visualImpact?: number;
    reason?: string;
    scoringDetails?: any;
  };
  analysis?: {
    visualImpactScore?: number;
    detectionCount?: number;
    hasMultipleDetections?: boolean;
    allDetections?: any[];
  };
  reviewRequired?: boolean;
  road_condition?: 'clean' | 'defective' | 'uncertain' | 'non_road';
  detected?: boolean;
  detected_class?: string | null;
  review_required?: boolean;
  department_code?: string | null;
  department_id?: string | number | null;
  analysis_domain?: string | null;
  model?: string | null;
  ai_model?: string | null;
}

export interface UserProfile {
  id: string;
  full_name: string;
  name?: string;
  mobile?: string;
  email: string;
  role: UserRole;
  department_id?: string;
  department_name?: string;
  department_code?: string;
  employee_id?: string;
  avatar_url?: string;
  address?: string;
  residential_address?: string;
  language_pref?: string;
  status?: 'Active' | 'Inactive' | 'active' | 'inactive';
  must_change_password?: boolean;
  created_at?: string;
}

export interface Department {
  id: string;
  name: string;
  code: string;
  description?: string;
  head_id?: string;
  head_name?: string;
  head_email?: string;
  created_at?: string;
}

export interface DepartmentHead {
  id: string;
  user_id: string;
  department_id: string;
  name: string;
  email: string;
  phone?: string;
  employee_id: string;
  designation?: string;
  status: 'active' | 'inactive' | 'Active' | 'Inactive';
  created_at?: string;
  updated_at?: string;
  // Optional joined metrics for UI
  department_name?: string;
  department_code?: string;
  staff_count?: number;
  active_tasks?: number;
  open_complaints?: number;
  overdue_tasks?: number;
  completed_tasks?: number;
  total_complaints?: number;
}

export type ComplaintAngle = 'front' | 'left' | 'right' | 'closeup';

export interface ComplaintAnglePhoto {
  angle: ComplaintAngle;
  url: string;
  label: string;
  created_at?: string;
}

export function extractComplaintAnglePhotos(comp: any): ComplaintAnglePhoto[] {
  if (!comp) return [];
  const list: ComplaintAnglePhoto[] = [];
  const seenUrls = new Set<string>();

  // 1. If explicit angle_photos array exists
  if (Array.isArray(comp.angle_photos)) {
    for (const item of comp.angle_photos) {
      if (item && item.url && !seenUrls.has(item.url)) {
        seenUrls.add(item.url);
        list.push({
          angle: item.angle || 'front',
          url: item.url,
          label: item.label || getAngleLabel(item.angle)
        });
      }
    }
  } else if (typeof comp.angle_photos === 'string' && comp.angle_photos.trim().startsWith('[')) {
    try {
      const parsed = JSON.parse(comp.angle_photos);
      if (Array.isArray(parsed)) {
        for (const item of parsed) {
          if (item && item.url && !seenUrls.has(item.url)) {
            seenUrls.add(item.url);
            list.push({
              angle: item.angle || 'front',
              url: item.url,
              label: item.label || getAngleLabel(item.angle)
            });
          }
        }
      }
    } catch {}
  }

  // 2. Fall back to dedicated angle columns if not already included
  const angleMap: Array<{ key: string; angle: ComplaintAngle; label: string }> = [
    { key: 'photo_front_url', angle: 'front', label: 'Front View' },
    { key: 'photo_left_url', angle: 'left', label: 'Left View' },
    { key: 'photo_right_url', angle: 'right', label: 'Right View' },
    { key: 'photo_closeup_url', angle: 'closeup', label: 'Close-up Detail' }
  ];

  for (const { key, angle, label } of angleMap) {
    const url = comp[key];
    if (url && typeof url === 'string' && !seenUrls.has(url)) {
      seenUrls.add(url);
      list.push({ angle, url, label });
    }
  }

  // 3. Ensure primary photo_before_url is included as Front View if not yet present
  if (comp.photo_before_url && !seenUrls.has(comp.photo_before_url)) {
    seenUrls.add(comp.photo_before_url);
    list.unshift({ angle: 'front', url: comp.photo_before_url, label: 'Front View' });
  }

  // 4. Also check additional_photos
  let addPhotos = comp.additional_photos;
  if (typeof addPhotos === 'string' && addPhotos.trim().startsWith('[')) {
    try { addPhotos = JSON.parse(addPhotos); } catch {}
  }
  if (Array.isArray(addPhotos)) {
    addPhotos.forEach((url: string, idx: number) => {
      if (url && typeof url === 'string' && !seenUrls.has(url)) {
        seenUrls.add(url);
        list.push({
          angle: idx === 0 ? 'left' : idx === 1 ? 'right' : 'closeup',
          url,
          label: idx === 0 ? 'Left View' : idx === 1 ? 'Right View' : `Angle #${idx + 2}`
        });
      }
    });
  }

  return list;
}

function getAngleLabel(angle?: string): string {
  switch (angle) {
    case 'front': return 'Front View';
    case 'left': return 'Left View';
    case 'right': return 'Right View';
    case 'closeup': return 'Close-up Detail';
    default: return 'Evidence View';
  }
}

export interface Complaint {
  id: string;
  complaint_number: string; // e.g. NS-2026-100234
  citizen_id: string;
  photo_before_url: string;
  photo_after_url?: string;
  photo_front_url?: string;
  photo_left_url?: string;
  photo_right_url?: string;
  photo_closeup_url?: string;
  additional_photos?: string[];
  angle_photos?: ComplaintAnglePhoto[];
  ai_vision_metadata?: any;
  category: string;
  title: string;
  description: string;
  priority: PriorityLevel;
  status: ComplaintStatus;
  department_id?: string;
  department_name?: string;
  latitude: number;
  longitude: number;
  location_source?: 'exif' | 'device_gps' | 'map_pin' | 'map_pin_confirmed' | 'live_gps' | 'exif_gps' | 'manual_pin' | 'geocoded' | 'geocode_failed' | 'unavailable' | 'gps';
  location_accuracy_m?: number | null;
  location_address?: string;
  duplicate_of_id?: string;
  support_count?: number;
  safety_score?: number;
  disruption_score?: number;
  health_environment_score?: number;
  defect_severity_score?: number;
  risk_score?: number;
  priority_rank?: number;
  assigned_staff_id?: string;
  assigned_staff_name?: string;
  assigned_staff_email?: string;
  assigned_by?: string;
  assigned_by_name?: string;
  department_head_id?: string;
  department_head_name?: string;
  rework_reason?: string;
  sla_deadline?: string;
  response_time_hours?: number;
  photo_before_work_url?: string;
  work_performed?: string;
  materials_used?: string;
  additional_notes?: string;
  admin_rejection_reason?: string;
  rating?: number;
  feedback_comment?: string;
  feedback_created_at?: string;
  citizen_name?: string;
  feedback?: {
    rating: number;
    review: string;
    comment?: string;
    created_at?: string;
    submission_date?: string;
    citizen_name?: string;
    complaint_number?: string;
  } | null;
  ai_category?: string;
  ai_specific_issue?: string;
  ai_confidence?: number;
  ai_severity?: string;
  ai_urgency?: string;
  ai_evidence?: string;
  ai_model?: string;
  ai_analyzed_at?: string;
  needs_manual_verification?: boolean;
  recurring_issue?: {
    is_recurring: boolean;
    recurrence_status: string;
    previous_complaint_id: string | number;
    previous_complaint_number?: string;
    distance_meters?: number | null;
    links?: any[];
  } | null;
  created_at: string;
  updated_at: string;
}

export interface ComplaintFeedback {
  id: string;
  complaint_id: string;
  rating: number;
  comment: string;
  is_resolved: boolean;
  created_at: string;
}

export interface NotificationItem {
  id: string;
  user_id: string;
  role: UserRole;
  complaint_id?: string;
  complaint_number?: string;
  type: NotificationType;
  title: string;
  message: string;
  is_read: boolean;
  created_at: string;
}

export interface WorkUpdate {
  id: string;
  complaint_id: string;
  staff_id: string;
  photo_before_work_url?: string;
  work_performed: string;
  materials_used?: string;
  additional_notes?: string;
  created_at: string;
}

export interface ResolutionProof {
  id: string;
  complaint_id: string;
  staff_id: string;
  photo_after_work_url: string;
  submitted_at: string;
  admin_review_status: 'Pending' | 'Approved' | 'Rejected';
  admin_rejection_reason?: string;
}

export interface StaffPerformanceMetrics {
  tasksCompleted: number;
  tasksInProgress: number;
  avgResolutionHours: number;
  overdueTasks: number;
  successRatePercentage: number;
}

export interface ComplaintActivityLog {
  id: string;
  complaint_id: string;
  actor_id?: string;
  actor_name: string;
  action: string;
  previous_status?: ComplaintStatus;
  new_status: ComplaintStatus;
  notes?: string;
  created_at: string;
}

export interface DepartmentStaffMember {
  id: string;
  name: string;
  employee_id: string;
  department_name: string;
  active_workload_count: number;
  is_online: boolean;
}

export interface AdminKPIStats {
  total: number;
  newCount: number;
  pendingVerification: number;
  approved: number;
  inProgress: number;
  resolved: number;
  reopened: number;
  overdue: number;
  critical: number;
}

// ANNOUNCEMENT & MAINTENANCE TYPES
export type AnnouncementCategory =
  | 'General'
  | 'Water Supply'
  | 'Road Work'
  | 'Sanitation'
  | 'Electrical'
  | 'Drainage'
  | 'Traffic'
  | 'Infrastructure'
  | 'Environment'
  | 'Emergency';

export type AnnouncementPriority = 'Normal' | 'Important' | 'Emergency';

export interface OfficialAnnouncement {
  id: string;
  title: string;
  description: string;
  title_hi?: string;
  title_mr?: string;
  description_hi?: string;
  description_mr?: string;
  category: AnnouncementCategory;
  area: string;
  latitude?: number;
  longitude?: number;
  priority: AnnouncementPriority;
  start_date: string;
  end_date?: string;
  start_time?: string;
  end_time?: string;
  image_url?: string;
  status: 'Draft' | 'Published' | 'Archived';
  published_by: string;
  created_at: string;
  updated_at: string;
}

export type MaintenanceWorkStatus = 'Planned' | 'Approved' | 'In Progress' | 'Completed' | 'Delayed' | 'Cancelled';

export interface MaintenanceWork {
  id: string;
  title: string;
  description: string;
  department_name: string;
  area: string;
  location_address?: string;
  latitude: number;
  longitude: number;
  status: MaintenanceWorkStatus;
  priority: PriorityLevel;
  start_date: string;
  expected_completion: string;
  assigned_staff_name?: string;
  image_url?: string;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export interface MaintenanceWorkUpdateLog {
  id: string;
  maintenance_id: string;
  status: MaintenanceWorkStatus;
  note: string;
  image_url?: string;
  created_by: string;
  created_at: string;
}
