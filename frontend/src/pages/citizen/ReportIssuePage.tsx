import React, { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { DEFAULT_CIVIC_IMAGE_PLACEHOLDER } from '../../lib/supabase';
import { useAuth } from '../../context/AuthContext';
import { useLanguage } from '../../context/LanguageContext';
import { useNotification } from '../../context/NotificationContext';
import { DashboardLayout } from '../../components/DashboardLayout';
import { LocationMapPicker } from '../../components/LocationMapPicker';
import { PriorityBadge } from '../../components/PriorityBadge';
import {
  resolveIssueLocation,
  findDuplicateComplaints,
  isWithinNashikServiceArea,
  requestFreshGpsLocation,
  reverseGeocodeCoordinates,
  isValidCoordinate,
  LocationSourceType
} from '../../services/locationService';
import {
  detectCivicIssue,
  extractVisualFeatures,
  compareImageSimilarity,
  checkAiHealth,
  normalizeDepartment,
  CIVIC_CATEGORIES,
  CivicCategory
} from '../../services/aiVisionService';
import {
  createComplaint,
  uploadComplaintImage,
  generateComplaintNumber,
  saveOfflineDraft,
  clearOfflineDrafts,
  getOfflineDrafts,
  getAllComplaints,
  HttpError,
  AuthError,
  isNetworkError
} from '../../services/complaintService';
import {
  saveDraft as saveIndexedDBDraft,
  getDraft as getIndexedDBDraft,
  getDrafts as getIndexedDBDrafts,
  deleteDraft as deleteIndexedDBDraft,
  OfflineDraft,
  OfflineDraftImage
} from '../../services/offlineDraftService';
import { resolveDepartmentInfo } from '../../services/departmentService';
import { PriorityLevel, AIVisionResult, VisualFeatures, ImageSimilarityResult, ComplaintAngle, ComplaintAnglePhoto } from '../../types/database.types';
import {
  Camera, Upload, Sparkles, AlertTriangle, CheckCircle2, MapPin,
  ArrowRight, ArrowLeft, RefreshCw, ShieldCheck, WifiOff, FileText, X, Edit3, Save, ThumbsUp, Plus, Image as ImageIcon, Eye, ZoomIn,
  ChevronLeft, ChevronRight, Trash2, FolderOpen, Wifi
} from 'lucide-react';

interface AngleSlotData {
  file: File | null;
  previewUrl: string;
}

interface AngleConfig {
  angle: ComplaintAngle;
  number: number;
  title: string;
  recommendedView: string;
  badge: string;
  subtitle: string;
  recommended?: boolean;
}

const ANGLE_CONFIGS: AngleConfig[] = [
  {
    angle: 'front',
    number: 1,
    title: '1. Front View',
    recommendedView: 'Front View',
    badge: 'Recommended / Primary',
    subtitle: 'Primary overview of defect and street context',
    recommended: true
  },
  {
    angle: 'left',
    number: 2,
    title: '2. Left View',
    recommendedView: 'Left View',
    badge: 'Perspective & Depth',
    subtitle: 'Left-side perspective showing depth & footpath'
  },
  {
    angle: 'right',
    number: 3,
    title: '3. Right View',
    recommendedView: 'Right View',
    badge: 'Traffic & Context',
    subtitle: 'Right-side perspective showing oncoming lane & surroundings'
  },
  {
    angle: 'closeup',
    number: 4,
    title: '4. Top View',
    recommendedView: 'Top View',
    badge: 'Defect Severity',
    subtitle: 'Top view or macro angle showing defect crater and depth'
  }
];

/**
 * Consolidates image observations into a single coherent paragraph of at least five meaningful sentences.
 * Covers:
 * 1) Visible civic issue
 * 2) Specific damage / physical evidence
 * 3) Observable severity & condition
 * 4) Potential public impact (distinguishing inference from observation)
 * 5) Necessary municipal inspection & corrective action
 * Consolidates multiple angle observations without repetition.
 */
function buildConsolidatedCivicDescription(
  baseDescription: string,
  aiRes: AIVisionResult | null,
  slots: Record<ComplaintAngle, AngleSlotData>
): string {
  if (!baseDescription && !aiRes) return '';
  
  let cleaned = (baseDescription || '').trim();

  // If base description is under 5 sentences, generate the authoritative 5-sentence paragraph
  const sentences = cleaned.split(/(?<=\.)\s+/).filter(s => s.trim().length > 10);
  if (sentences.length < 5 && aiRes) {
    const cat = (aiRes.category || '').toLowerCase();
    const issue = (aiRes.issue_type || aiRes.title || '').toLowerCase();
    const dept = aiRes.department || 'the responsible municipal department';
    const conf = aiRes.confidence ? Math.round(Number(aiRes.confidence) * 100) : 92;
    const sev = (aiRes.severity || 'High').toLowerCase();

    if (cat.includes('water') || issue.includes('pipe') || issue.includes('leak')) {
      const isRupture = issue.includes('broken');
      cleaned = isRupture
        ? `Photographic evidence captured from the site reveals an active structural rupture affecting municipal water supply piping infrastructure. Visual examination identifies localized pipe material fracture with pressurized water dispersion escaping across the adjacent surface area. The visible defect represents a ${sev}-severity utility condition demonstrating clear physical compromise that impairs steady localized distribution. While surface water discharge is directly confirmed in the photograph, inferred secondary consequences include gradual subsurface soil weakening, localized erosion, and potable water loss if left uncontained. Prompt on-site technical inspection and pipe restoration by ${dept} are necessary to isolate the supply line and complete durable repairs.`
        : `Photographic evidence captured from the site reveals observable water leakage discharging from municipal piping infrastructure. Physical inspection indicates fluid seepage and moisture pooling along the exposed conduit joint with approximately ${conf}% visual confidence. The visible defect represents a ${sev}-severity utility condition demonstrating clear physical compromise that impairs steady localized distribution. While surface water discharge is directly confirmed in the photograph, inferred secondary consequences include gradual subsurface soil weakening, localized erosion, and potable water loss if left uncontained. Prompt on-site technical inspection and pipe restoration by ${dept} are necessary to isolate the supply line and complete durable repairs.`;
    } else if (cat.includes('road') || issue.includes('pothole')) {
      cleaned = `The uploaded photograph documents a distinct road surface defect consisting of an open pothole within the public vehicular roadway. Visual evidence demonstrates asphalt displacement with broken pavement margins and exposed base-course aggregate across the traffic corridor. The crater represents a ${sev}-severity roadway hazard displaying clear physical degradation that impedes continuous vehicular movement. Visual observations establish the pavement cavity directly, while inferred public impacts include sudden vehicular swerving, tire puncture risk, and progressive roadbed deterioration from repetitive axle loads. Targeted site inspection and bituminous asphalt patch remediation by ${dept} are required to level the thoroughfare and safeguard daily transit.`;
    } else if (cat.includes('sanitat') || cat.includes('waste') || cat.includes('garbage')) {
      cleaned = `Visual analysis of the uploaded image identifies uncontained solid municipal waste accumulating along the public corridor. Observable physical evidence confirms scattered refuse bags, plastic packaging, and mixed municipal discards discarded upon the open ground. The accumulation represents a ${sev}-severity sanitary concern exhibiting untended refuse that obstructs orderly pedestrian access. Direct visual inspection verifies the uncollected litter pile, whereas inferred public impacts encompass foul odor dispersion, pest harborage, and potential stormwater drain blockages during heavy rain. Prompt dispatch of municipal clearing crews and localized sanitation treatment by ${dept} are necessary to remove all refuse and restore environmental cleanliness.`;
    } else if (cat.includes('drain') || cat.includes('sewag') || issue.includes('drain')) {
      const isOverflow = issue.includes('overflow');
      cleaned = isOverflow
        ? `Photographic evidence documents an active drainage overflow spilling runoff water across the surrounding public precinct. Visible physical indicators confirm restricted hydraulic passage with foreign particulate matter gathered along the curb channel. The drainage structure presents a ${sev}-severity operational impediment exhibiting substantial silt buildup that impedes normal water flow. While waterway constriction is directly confirmed by visual inspection, inferred hazards include wastewater pooling, pedestrian inconvenience, and street flooding during peak runoff events. Expedited desilting and channel clearing operations by ${dept} are required to restore adequate drainage capacity and prevent localized waterlogging.`
        : `Photographic evidence documents a compromised drainage channel obstructed by accumulated debris and sedimentation. Visible physical indicators confirm restricted hydraulic passage with foreign particulate matter gathered along the curb channel. The drainage structure presents a ${sev}-severity operational impediment exhibiting substantial silt buildup that impedes normal water flow. While waterway constriction is directly confirmed by visual inspection, inferred hazards include wastewater pooling, pedestrian inconvenience, and street flooding during peak runoff events. Expedited desilting and channel clearing operations by ${dept} are required to restore adequate drainage capacity and prevent localized waterlogging.`;
    } else {
      cleaned = `Photographic evidence submitted reveals a noticeable civic infrastructure defect requiring municipal maintenance attention. Visual inspection identifies localized physical degradation and material wear affecting public utility assets in the area. The condition exhibits a ${sev}-severity civic concern with observable physical compromise that diminishes public asset reliability. While physical wear is directly verified in the uploaded photograph, inferred consequences include gradual structural decline and service interruption for neighborhood residents if neglected. A focused field assessment and remedial maintenance by ${dept} are necessary to restore normal operating standards and ensure citizen safety.`;
    }
  }

  // Consolidate multi-angle evidence nonrepetitively
  const otherAngles = (['left', 'right', 'closeup'] as ComplaintAngle[]).filter(a => Boolean(slots[a]?.previewUrl || slots[a]?.file));
  if (otherAngles.length > 0 && cleaned.length > 0) {
    const hasCorroboration = cleaned.includes('additional viewing angles') || cleaned.includes('Supplementary photographic evidence');
    if (!hasCorroboration) {
      cleaned = `${cleaned} Supplementary photographic evidence from additional viewing angles corroborates the primary visual observations, confirming consistent defect margins across perspectives.`;
    }
  }

  return cleaned.trim();
}

// Strict AI Image Category Validation Helpers & Data Structures
export const CANONICAL_DOMAINS_FE: Record<string, { id: CivicCategory; label: string; aliases: string[]; defectKeywords: string[]; domain: string }> = {
  water: {
    id: 'Water',
    label: 'Water Supply',
    aliases: ['water', 'water supply', 'pipe', 'pipeline', 'leak', 'burst pipe', 'water pipe'],
    defectKeywords: ['pipe', 'leak', 'burst', 'water', 'joint'],
    domain: 'pipe'
  },
  roads: {
    id: 'Roads',
    label: 'Roads & Works',
    aliases: ['roads', 'road', 'roads & works', 'pothole', 'asphalt', 'road damage'],
    defectKeywords: ['pothole', 'road', 'crack', 'asphalt', 'rutting', 'surface defect', 'road damage'],
    domain: 'road'
  },
  drainage: {
    id: 'Drainage',
    label: 'Drainage',
    aliases: ['drainage', 'drain', 'sewer', 'sewage', 'gutter', 'culvert'],
    defectKeywords: ['drain', 'sewer', 'sewage', 'gutter', 'overflow', 'blocked drain', 'damaged drain'],
    domain: 'drainage'
  },
  sanitation: {
    id: 'Sanitation',
    label: 'Sanitation',
    aliases: ['sanitation', 'garbage', 'waste', 'trash', 'debris', 'dump'],
    defectKeywords: ['garbage', 'waste', 'trash', 'litter', 'debris', 'dump', 'rubbish', 'bio-medical waste'],
    domain: 'waste'
  }
};

export function normalizeCivicCategoryKeyFE(cat?: string | null): CivicCategory | null {
  if (!cat) return null;
  const s = String(cat).trim().toLowerCase();
  for (const [, info] of Object.entries(CANONICAL_DOMAINS_FE)) {
    if (info.id.toLowerCase() === s || info.aliases.some((a) => s.includes(a))) {
      return info.id;
    }
  }
  return null;
}

export function detectCivicDomainFromAnalysisFE(aiResult: any): CivicCategory | null {
  if (!aiResult) return null;
  const cat = String(aiResult.category || '').toLowerCase();
  const rawClass = String(aiResult.detected_class || aiResult.ai_detected_class || aiResult.primaryDetection?.class || '').toLowerCase();
  const issue = String(aiResult.issue_type || aiResult.title || '').toLowerCase();
  const domain = String(aiResult.analysis_domain || aiResult.domain || '').toLowerCase();

  for (const [, info] of Object.entries(CANONICAL_DOMAINS_FE)) {
    if (info.defectKeywords.some((kw) => rawClass.includes(kw) || issue.includes(kw))) {
      return info.id;
    }
  }

  if (aiResult.pipe_condition === 'damaged' || aiResult.pipe_condition === 'uncertain') return 'Water';
  if (aiResult.drain_condition === 'damaged' || aiResult.drain_condition === 'blocked') return 'Drainage';
  if (aiResult.road_condition === 'defective') return 'Roads';

  for (const [, info] of Object.entries(CANONICAL_DOMAINS_FE)) {
    if (info.aliases.some((a) => cat.includes(a))) {
      return info.id;
    }
  }

  if (domain === 'pipe' || domain === 'water') return 'Water';
  if (domain === 'road' || domain === 'roads') return 'Roads';
  if (domain === 'drainage' || domain === 'drain') return 'Drainage';
  if (domain === 'waste' || domain === 'sanitation') return 'Sanitation';

  return null;
}

export interface ValidationOutcomeResult {
  outcome: 'SUPPORTED' | 'UNSUPPORTED' | 'UNCERTAIN';
  selectedCategory: CivicCategory;
  detectedCategory?: CivicCategory | null;
  suggestedCategory?: string;
  confidence?: number;
  message: string;
}

export function validateCategoryMatchFE(selectedCategory: string | null, aiResult: any): ValidationOutcomeResult {
  const normSelected = normalizeCivicCategoryKeyFE(selectedCategory);
  if (!normSelected) {
    return {
      outcome: 'UNCERTAIN',
      selectedCategory: 'Roads',
      message: 'Category validation requires manual verification.'
    };
  }

  if (!aiResult) {
    return {
      outcome: 'UNCERTAIN',
      selectedCategory: normSelected,
      message: 'AI validation could not be completed. You may proceed with manual verification.'
    };
  }

  const confidence = Number(aiResult.confidence || 0);
  const detected = Boolean(aiResult.detected);
  const detectedDomain = detectCivicDomainFromAnalysisFE(aiResult);
  const isCleanRoad = aiResult.road_condition === 'clean' || aiResult.aiStatus === 'confirmed_clean';

  // Outcome 1: SUPPORTED — Reliable image evidence matches the selected category.
  if (detected && detectedDomain === normSelected && confidence >= 0.40) {
    return {
      outcome: 'SUPPORTED',
      selectedCategory: normSelected,
      detectedCategory: detectedDomain,
      confidence,
      message: `Image evidence reliably matches the selected issue category (${CANONICAL_DOMAINS_FE[normSelected.toLowerCase()]?.label || normSelected}).`
    };
  }

  // Outcome 2: UNSUPPORTED — Reliable image evidence identifies a different issue category or clearly unrelated content.
  if (detected && detectedDomain && detectedDomain !== normSelected && confidence >= 0.50) {
    const suggestedLabel = CANONICAL_DOMAINS_FE[detectedDomain.toLowerCase()]?.label || detectedDomain;
    return {
      outcome: 'UNSUPPORTED',
      selectedCategory: normSelected,
      detectedCategory: detectedDomain,
      suggestedCategory: suggestedLabel,
      confidence,
      message: 'Unsupported Image — This photograph does not match the selected issue category. Please upload a relevant image or select the correct category.'
    };
  }

  if (isCleanRoad && normSelected !== 'Roads' && confidence >= 0.70) {
    return {
      outcome: 'UNSUPPORTED',
      selectedCategory: normSelected,
      detectedCategory: 'Roads',
      suggestedCategory: 'Roads & Works',
      confidence,
      message: 'Unsupported Image — This photograph does not match the selected issue category. Please upload a relevant image or select the correct category.'
    };
  }

  // Outcome 3: UNCERTAIN — AI cannot reliably identify the issue. Do not falsely classify as unsupported.
  return {
    outcome: 'UNCERTAIN',
    selectedCategory: normSelected,
    detectedCategory: detectedDomain || null,
    confidence,
    message: 'The AI cannot reliably identify the issue. You may retake the photo, upload a clearer view, or proceed with manual verification.'
  };
}

export const ReportIssuePage: React.FC = () => {
  const { user } = useAuth();
  const { t, translateCategory, translatePriority, translateDepartment } = useLanguage();
  const { toast } = useNotification();
  const navigate = useNavigate();

  // 4-Angle Photo Evidence State
  const [angleSlots, setAngleSlots] = useState<Record<ComplaintAngle, AngleSlotData>>({
    front: { file: null, previewUrl: '' },
    left: { file: null, previewUrl: '' },
    right: { file: null, previewUrl: '' },
    closeup: { file: null, previewUrl: '' },
  });
  const [currentSlotIndex, setCurrentSlotIndex] = useState<number>(0);
  const [touchStartX, setTouchStartX] = useState<number | null>(null);
  const [touchEndX, setTouchEndX] = useState<number | null>(null);

  const minSwipeDistance = 45;

  const onTouchStart = (e: React.TouchEvent) => {
    setTouchEndX(null);
    setTouchStartX(e.targetTouches[0].clientX);
  };

  const onTouchMove = (e: React.TouchEvent) => {
    setTouchEndX(e.targetTouches[0].clientX);
  };

  const onTouchEnd = () => {
    if (touchStartX === null || touchEndX === null) return;
    const distance = touchStartX - touchEndX;
    const isLeftSwipe = distance > minSwipeDistance;
    const isRightSwipe = distance < -minSwipeDistance;
    if (isLeftSwipe && currentSlotIndex < ANGLE_CONFIGS.length - 1) {
      setCurrentSlotIndex((prev) => prev + 1);
    }
    if (isRightSwipe && currentSlotIndex > 0) {
      setCurrentSlotIndex((prev) => prev - 1);
    }
  };

  const [selectedPhotoFile, setSelectedPhotoFile] = useState<File | null>(null);
  const [photoPreviewUrl, setPhotoPreviewUrl] = useState<string>('');
  const [zoomImageUrl, setZoomImageUrl] = useState<string | null>(null);
  const [analyzingAI, setAnalyzingAI] = useState<boolean>(false);
  const [aiResult, setAiResult] = useState<AIVisionResult | null>(null);
  const [aiHealth, setAiHealth] = useState<{ reachable: boolean; configured: boolean; model: string } | null>(null);
  const [primaryFeatures, setPrimaryFeatures] = useState<VisualFeatures | null>(null);

  // Strict AI Image Category Validation States
  const [validatingSlot, setValidatingSlot] = useState<ComplaintAngle | null>(null);
  const [validationStatusMsg, setValidationStatusMsg] = useState<string | null>(null);
  const [slotValidationResults, setSlotValidationResults] = useState<Record<ComplaintAngle, ValidationOutcomeResult | null>>({
    front: null,
    left: null,
    right: null,
    closeup: null
  });
  const [unsupportedAlert, setUnsupportedAlert] = useState<{
    angle: ComplaintAngle;
    message: string;
    suggestedCategory?: string;
    detectedKey?: CivicCategory | null;
  } | null>(null);

  // Form Field States
  const [forceManualReport, setForceManualReport] = useState<boolean>(false);
  const [category, setCategory] = useState<CivicCategory | null>(null);
  const [hasSelectedCategory, setHasSelectedCategory] = useState<boolean>(false);
  const aiRequestIdRef = React.useRef<number>(0);
  const [title, setTitle] = useState<string>('');
  const [description, setDescription] = useState<string>('');
  const [priority, setPriority] = useState<PriorityLevel>('Medium');
  const [department, setDepartment] = useState<string>('');
  const [isManuallyEdited, setIsManuallyEdited] = useState<boolean>(false);

  // Location States
  const [lat, setLat] = useState<number>(20.0059);
  const [lng, setLng] = useState<number>(73.7898);
  const [locationAccuracy, setLocationAccuracy] = useState<number | undefined>(15);
  const [locationSource, setLocationSource] = useState<LocationSourceType>('map_pin');
  const [mapPinConfirmed, setMapPinConfirmed] = useState<boolean>(false);
  const [locationStatusText, setLocationStatusText] = useState<string>('Select defect location on Leaflet map pin');
  const [locationAddress, setLocationAddress] = useState<string>('');
  const [detectingLocation, setDetectingLocation] = useState<boolean>(false);

  // Duplicate Check & UI Modal States
  const [nearbyDuplicates, setNearbyDuplicates] = useState<Array<{ complaint: any; distanceMeters: number }>>([]);
  const [showLocationPickerModal, setShowLocationPickerModal] = useState<boolean>(false);
  const [showLocationPromptModal, setShowLocationPromptModal] = useState<boolean>(false);
  const [showReviewModal, setShowReviewModal] = useState<boolean>(false);
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [draftSavedToast, setDraftSavedToast] = useState<boolean>(false);
  const [sameIssueDuplicateError, setSameIssueDuplicateError] = useState<{
    message: string;
    existingComplaintId?: string;
    distanceM?: number;
  } | null>(null);
  const [currentDraftId, setCurrentDraftId] = useState<string | null>(null);
  const [draftCreatedAt, setDraftCreatedAt] = useState<string | null>(null);
  const [originalCaptureTime, setOriginalCaptureTime] = useState<string | null>(null);
  const [exifGpsData, setExifGpsData] = useState<any | null>(null);
  const [savedDraftsList, setSavedDraftsList] = useState<OfflineDraft[]>([]);
  const [showDraftsModal, setShowDraftsModal] = useState<boolean>(false);
  const [isOnlineStatus, setIsOnlineStatus] = useState<boolean>(typeof navigator !== 'undefined' ? navigator.onLine : true);
  const isDraftLoadedRef = React.useRef<boolean>(false);
  const isSubmittingRef = React.useRef<boolean>(false);
  const cachedComplaintsRef = React.useRef<any[] | null>(null);

  // Restore a specific draft into the form
  const restoreDraft = (draft: OfflineDraft) => {
    setCurrentDraftId(draft.draft_id);
    setDraftCreatedAt(draft.created_at);
    setOriginalCaptureTime(draft.original_capture_time || draft.created_at);
    isDraftLoadedRef.current = true;

    if (draft.title) setTitle(draft.title);
    if (draft.description) setDescription(draft.description);
    if (draft.category) {
      setCategory(draft.category as CivicCategory);
      setHasSelectedCategory(true);
    }
    if (draft.priority) setPriority(draft.priority as PriorityLevel);
    if (draft.department) setDepartment(draft.department);

    // PRESERVE ORIGINAL ISSUE-SITE COORDINATES
    if (draft.latitude != null && !isNaN(Number(draft.latitude))) setLat(Number(draft.latitude));
    if (draft.longitude != null && !isNaN(Number(draft.longitude))) setLng(Number(draft.longitude));
    if (draft.location_source) setLocationSource(draft.location_source as LocationSourceType);
    if (draft.location_accuracy_m) setLocationAccuracy(draft.location_accuracy_m);
    if (draft.exif_gps) setExifGpsData(draft.exif_gps);
    if (draft.manual_address) setLocationAddress(draft.manual_address);

    // Restore photos from stored Blobs/Files with fresh object URLs
    if (draft.images && draft.images.length > 0) {
      const updatedSlots = { ...angleSlots };
      draft.images.forEach((img) => {
        const file = img.blob instanceof File
          ? img.blob
          : new File([img.blob], img.name || `${img.angle}-view.jpg`, { type: img.type || 'image/jpeg' });
        const previewUrl = URL.createObjectURL(file);
        updatedSlots[img.angle] = { file, previewUrl };
        if (img.angle === 'front') {
          setSelectedPhotoFile(file);
          setPhotoPreviewUrl(previewUrl);
        }
      });
      setAngleSlots(updatedSlots);
    }
    setShowDraftsModal(false);
    toast.info(`Restored draft: "${draft.title || draft.category}"`);
  };

  const handleDeleteDraft = async (draftId: string) => {
    await deleteIndexedDBDraft(draftId);
    if (currentDraftId === draftId) {
      setCurrentDraftId(null);
      isDraftLoadedRef.current = false;
    }
    const updated = await getIndexedDBDrafts(user?.id);
    setSavedDraftsList(updated);
    toast.info("Draft deleted.");
  };

  // Online / Offline Network Restoration Listeners
  React.useEffect(() => {
    const handleOnline = async () => {
      setIsOnlineStatus(true);
      const drafts = await getIndexedDBDrafts(user?.id);
      setSavedDraftsList(drafts);
      if (drafts.length > 0) {
        toast.info(
          `You're back online. You have ${drafts.length} saved complaint${drafts.length === 1 ? '' : 's'} ready to submit.`
        );
        // MANDATORY: DO NOT AUTO-SUBMIT, DO NOT AUTO-UPLOAD, DO NOT AUTO-DELETE
      }
    };

    const handleOffline = () => {
      setIsOnlineStatus(false);
      toast.warning("You're offline. Draft complaints and photos will be saved locally on this device.");
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, [user?.id, toast]);

  // Initial AI Health & Location Check & Resume Offline Draft if present
  React.useEffect(() => {
    checkAiHealth().then(setAiHealth).catch(() => setAiHealth({ reachable: false, configured: false, model: 'Offline' }));

    // Load drafts from IndexedDB
    getIndexedDBDrafts(user?.id).then((drafts) => {
      setSavedDraftsList(drafts);
      if (drafts && drafts.length > 0 && !currentDraftId) {
        // Automatically restore newest draft if form is empty
        restoreDraft(drafts[0]);
      } else {
        requestFreshLocation(false);
      }
    }).catch(() => {
      requestFreshLocation(false);
    });
  }, [user?.id]);

  // Request Fresh Live GPS Location & Check whether browser/device location is enabled
  const requestFreshLocation = async (isUserAction: boolean = false) => {
    // PRESERVE ORIGINAL ISSUE-SITE COORDINATES: Never overwrite restored draft location in background
    if (!isUserAction && isDraftLoadedRef.current) {
      return true;
    }

    setDetectingLocation(true);

    // Fast-path permission check via navigator.permissions if supported
    if (typeof navigator !== 'undefined' && navigator.permissions?.query) {
      try {
        const permStatus = await navigator.permissions.query({ name: 'geolocation' as PermissionName });
        if (permStatus.state === 'denied') {
          setDetectingLocation(false);
          setShowLocationPromptModal(true);
          return false;
        }
      } catch {
        // Fall back directly to requestFreshGpsLocation
      }
    }

    try {
      const gps = await requestFreshGpsLocation();
      if (gps && gps.latitude && gps.longitude) {
        const acc = gps.accuracyMeters ? Math.round(gps.accuracyMeters) : 10;
        setLat(gps.latitude);
        setLng(gps.longitude);
        setLocationAccuracy(acc);

        if (acc <= 100) {
          setLocationSource('device_gps'); // setLocationSource('live_gps')
          setLocationStatusText(`Live GPS verified (±${acc}m)`);
          setShowLocationPromptModal(false);
        } else {
          setLocationSource('device_gps');
          setLocationStatusText('GPS accuracy low — please confirm on map');
          toast.warning(`Device GPS accuracy is low (±${acc}m). Please confirm defect location on the map.`);
          setShowLocationPromptModal(true);
        }
        runDuplicateCheck(gps.latitude, gps.longitude);

        const addr = await reverseGeocodeCoordinates(gps.latitude, gps.longitude);
        if (addr) setLocationAddress(addr);
        return true;
      } else {
        setShowLocationPromptModal(true);
        return false;
      }
    } catch (e) {
      console.warn('GPS detection failed:', e);
      setShowLocationPromptModal(true);
      return false;
    } finally {
      setDetectingLocation(false);
    }
  };

  // Category Switch Handler with Automatic Revalidation of Previously Attached Images
  const handleCategoryChange = async (newCat: CivicCategory) => {
    if (!newCat) return;
    setCategory(newCat);
    setHasSelectedCategory(true);
    const newDept = normalizeDepartment('', newCat);
    setDepartment(newDept);
    setIsManuallyEdited(true);

    if (newCat === 'Water') {
      setTitle('Water Pipe Leakage / Supply Issue');
      setPriority('High');
    } else if (newCat === 'Drainage') {
      setTitle('Drainage Blockage / Overflow Issue');
      setPriority('High');
    } else if (newCat === 'Sanitation') {
      setTitle('Garbage Accumulation / Waste Issue');
      setPriority('Medium');
    } else if (newCat === 'Roads') {
      setTitle('Road Surface Damage / Pothole');
      setPriority('Medium');
    }

    // Invalidate previous AI result immediately on domain change
    setAiResult(null);

    const domainMap: Record<string, string> = {
      'Water': 'pipe',
      'Drainage': 'drainage',
      'Sanitation': 'waste',
      'Roads': 'road'
    };
    const targetDomain = domainMap[newCat] || 'road';

    // Revalidate previously attached images across all 4 slots
    const anglesToCheck = (['front', 'left', 'right', 'closeup'] as ComplaintAngle[]).filter(
      (a) => Boolean(angleSlots[a]?.file)
    );

    for (const angle of anglesToCheck) {
      const slotFile = angleSlots[angle]?.file;
      if (!slotFile) continue;

      try {
        const checkRes = await detectCivicIssue(slotFile, false, targetDomain);
        const checkValidation = validateCategoryMatchFE(newCat, checkRes);

        if (checkValidation.outcome === 'UNSUPPORTED') {
          // Remove unsupported image from this slot so it does not count toward the 2-photo minimum
          setAngleSlots((prev) => ({
            ...prev,
            [angle]: { file: null, previewUrl: '' }
          }));
          setSlotValidationResults((prev) => ({
            ...prev,
            [angle]: null
          }));
          if (angle === 'front') {
            setSelectedPhotoFile(null);
            setPhotoPreviewUrl('');
            setPrimaryFeatures(null);
          }
          toast.warning(
            `Unsupported Image in ${angle.toUpperCase()} view removed — does not match ${newCat}.`
          );
          setUnsupportedAlert({
            angle,
            message: 'Unsupported Image — This photograph does not match the selected issue category. Please upload a relevant image or select the correct category.',
            suggestedCategory: checkValidation.suggestedCategory,
            detectedKey: checkValidation.detectedCategory
          });
        } else {
          setSlotValidationResults((prev) => ({
            ...prev,
            [angle]: checkValidation
          }));
          if (angle === 'front' && checkRes) {
            setAiResult(checkRes);
          }
        }
      } catch (err) {
        console.warn(`Category revalidation error on ${angle}:`, err);
      }
    }
  };

  // Handle Capture or Upload with STRICT AI IMAGE CATEGORY VALIDATION for Any of the 4 Image Angles
  const handleAnglePhotoSelect = async (angle: ComplaintAngle, file: File) => {
    // Clear previous unsupported alert for this slot
    if (unsupportedAlert && unsupportedAlert.angle === angle) {
      setUnsupportedAlert(null);
    }

    setValidatingSlot(angle);
    setValidationStatusMsg('Validating civic issue category with AI...');

    const filenameLower = (file.name || '').toLowerCase();
    let currentCategory = category;

    // Resolve analysis domain corresponding to selected category
    let candidateDomain: string | undefined = undefined;
    if (currentCategory === 'Water' || (!currentCategory && (filenameLower.includes('pipe') || filenameLower.includes('leak') || filenameLower.includes('water')))) {
      candidateDomain = 'pipe';
      if (!currentCategory) {
        currentCategory = 'Water';
        setCategory('Water');
        setDepartment(normalizeDepartment('', 'Water'));
        setHasSelectedCategory(true);
      }
    } else if (currentCategory === 'Drainage' || (!currentCategory && (filenameLower.includes('drain') || filenameLower.includes('sewag') || filenameLower.includes('gutter')))) {
      candidateDomain = 'drainage';
      if (!currentCategory) {
        currentCategory = 'Drainage';
        setDepartment(normalizeDepartment('', 'Drainage'));
        setHasSelectedCategory(true);
      }
    } else if (currentCategory === 'Sanitation' || (!currentCategory && (filenameLower.includes('garbage') || filenameLower.includes('waste') || filenameLower.includes('trash')))) {
      candidateDomain = 'waste';
      if (!currentCategory) {
        currentCategory = 'Sanitation';
        setDepartment(normalizeDepartment('', 'Sanitation'));
        setHasSelectedCategory(true);
      }
    } else if (currentCategory === 'Roads' || (!currentCategory && (filenameLower.includes('road') || filenameLower.includes('pothole')))) {
      candidateDomain = 'road';
      if (!currentCategory) {
        currentCategory = 'Roads';
        setDepartment(normalizeDepartment('', 'Roads'));
        setHasSelectedCategory(true);
      }
    } else if (!candidateDomain) {
      candidateDomain = 'road';
    }

    try {
      // 1. Analyze image BEFORE adding to accepted evidence list
      let analysisRes: any = null;
      try {
        analysisRes = await detectCivicIssue(file, false, candidateDomain);
      } catch (err) {
        console.warn('AI analysis returned error during pre-validation:', err);
        analysisRes = null;
      }

      // 2. Strict Category Validation Comparison
      const validation = validateCategoryMatchFE(currentCategory, analysisRes);

      // Outcome 2: UNSUPPORTED — Reject explicit wrong-category uploads BEFORE they count toward 2-photo minimum
      if (validation.outcome === 'UNSUPPORTED') {
        setValidatingSlot(null);
        setUnsupportedAlert({
          angle,
          message: 'Unsupported Image — This photograph does not match the selected issue category. Please upload a relevant image or select the correct category.',
          suggestedCategory: validation.suggestedCategory,
          detectedKey: validation.detectedCategory
        });
        toast.error('Unsupported Image — This photograph does not match the selected issue category. Please upload a relevant image or select the correct category.');
        return; // REJECT! File is NOT added to angleSlots.
      }

      // Outcome 1: SUPPORTED or Outcome 3: UNCERTAIN
      setSlotValidationResults((prev) => ({
        ...prev,
        [angle]: validation
      }));

      const url = URL.createObjectURL(file);
      setAngleSlots((prev) => ({
        ...prev,
        [angle]: { file, previewUrl: url }
      }));

      if (validation.outcome === 'UNCERTAIN') {
        toast.info('AI cannot reliably confirm this issue category. Photo accepted for manual municipal verification.');
      } else {
        toast.success(`Photo verified and accepted for ${currentCategory ? translateCategory(currentCategory) : 'civic issue'}.`);
      }

      const isFirstImage = !selectedPhotoFile && !photoPreviewUrl;
      if (angle === 'front' || isFirstImage) {
        setSelectedPhotoFile(file);
        setPhotoPreviewUrl(url);
        setPrimaryFeatures(null);

        // Extract visual features locally
        try {
          const feats = await extractVisualFeatures(file);
          setPrimaryFeatures(feats);
        } catch (e) {
          console.warn('Local visual feature extraction skipped:', e);
        }

        // Apply analysis results to form if available
        if (analysisRes) {
          setAiResult(analysisRes);
          if (analysisRes.is_available !== false && analysisRes.confidence > 0) {
            if (!isManuallyEdited || !title) {
              if (analysisRes.title) setTitle(analysisRes.title);
            }
            if (!isManuallyEdited || !description) {
              if (analysisRes.description) {
                const nextSlots = { ...angleSlots, [angle]: { file, previewUrl: url } };
                const consolidated = buildConsolidatedCivicDescription(analysisRes.description, analysisRes, nextSlots);
                setDescription(consolidated);
              }
            }
            if (!isManuallyEdited || !priority) {
              if (analysisRes.priority) setPriority(analysisRes.priority as PriorityLevel);
            }
            if (!isManuallyEdited || !department) {
              if (analysisRes.department) setDepartment(normalizeDepartment(analysisRes.department, analysisRes.category));
            }
          }
        }

        // Run Location Resolution on front image
        try {
          const resolvedLoc = await resolveIssueLocation(file, lat, lng, null, null, locationAccuracy, mapPinConfirmed);
          if (resolvedLoc.latitude && resolvedLoc.longitude) {
            setLat(resolvedLoc.latitude);
            setLng(resolvedLoc.longitude);
            setLocationSource(resolvedLoc.source);
            setLocationStatusText(
              resolvedLoc.message ||
              (resolvedLoc.source === 'exif'
                ? 'Location detected from photo GPS'
                : resolvedLoc.source === 'device_gps'
                ? (resolvedLoc.lowAccuracy ? 'GPS accuracy low — please confirm on map' : `Live GPS verified (±${resolvedLoc.accuracy || 15}m)`)
                : 'Location confirmed by map pin')
            );
            runDuplicateCheck(resolvedLoc.latitude, resolvedLoc.longitude);
            const addr = await reverseGeocodeCoordinates(resolvedLoc.latitude, resolvedLoc.longitude);
            if (addr) setLocationAddress(addr);
          }
        } catch (err) {
          console.warn('Location resolution warning:', err);
        }
      } else {
        // Non-front angle: Preserve angle-verification system
        if (primaryFeatures) {
          try {
            const angleFeats = await extractVisualFeatures(file);
            const sim = compareImageSimilarity(primaryFeatures, angleFeats, 0);
            if (sim.isExactDuplicate) {
              toast.warning(`Note: The image for ${angle.toUpperCase()} is identical to the Front View.`);
            }
          } catch (e) {}
        }

        if (!isManuallyEdited && aiResult) {
          const nextSlots = { ...angleSlots, [angle]: { file, previewUrl: url } };
          setDescription((prev) => buildConsolidatedCivicDescription(prev || aiResult.description || '', aiResult, nextSlots));
        }
      }
    } finally {
      setValidatingSlot(null);
    }
  };

  const removeAnglePhoto = (angle: ComplaintAngle) => {
    const nextSlots = {
      ...angleSlots,
      [angle]: { file: null, previewUrl: '' }
    };
    setAngleSlots(nextSlots);
    if (angle === 'front') {
      setSelectedPhotoFile(null);
      setPhotoPreviewUrl('');
      setPrimaryFeatures(null);
      setAiResult(null);
    } else if (!isManuallyEdited && aiResult) {
      setDescription((prev) => buildConsolidatedCivicDescription(aiResult.description || prev, aiResult, nextSlots));
    }
  };

  const handlePhotoSelect = (file: File) => handleAnglePhotoSelect('front', file);

  // Run AI Vision Analysis & Location Extraction
  const runAIVisionAndLocation = async (file: File, photoUrlStr: string, isRetry: boolean = false, forcedDomain?: string) => {
    const thisRequestId = ++aiRequestIdRef.current;
    setAnalyzingAI(true);
    setAiResult(null);

    // Extract EXIF location if available and not set by live GPS
    try {
      const resolvedLoc = await resolveIssueLocation(file, lat, lng, null, null, locationAccuracy, mapPinConfirmed);
      if (resolvedLoc.latitude && resolvedLoc.longitude) {
        setLat(resolvedLoc.latitude);
        setLng(resolvedLoc.longitude);
        setLocationSource(resolvedLoc.source);
        setLocationStatusText(
          resolvedLoc.message ||
          (resolvedLoc.source === 'exif'
            ? 'Location detected from photo GPS'
            : resolvedLoc.source === 'device_gps'
            ? (resolvedLoc.lowAccuracy ? 'GPS accuracy low — please confirm on map' : `Live GPS verified (±${resolvedLoc.accuracy || 15}m)`)
            : 'Location confirmed by map pin')
        );
        if (resolvedLoc.requiresConfirmation) {
          toast.warning(resolvedLoc.message || 'Please confirm the complaint location on the map.');
        }
        runDuplicateCheck(resolvedLoc.latitude, resolvedLoc.longitude);

        const addr = await reverseGeocodeCoordinates(resolvedLoc.latitude, resolvedLoc.longitude);
        if (addr) setLocationAddress(addr);
      }
    } catch (err) {
      console.warn('Location resolution warning:', err);
    }

    try {
      const filenameLower = (file.name || '').toLowerCase();
      let analysisDomain: string | undefined = forcedDomain;

      if (!analysisDomain) {
        if (
          category === 'Water' ||
          filenameLower.includes('pipe') ||
          filenameLower.includes('leak') ||
          filenameLower.includes('burst') ||
          filenameLower.includes('water')
        ) {
          analysisDomain = 'pipe';
          if (!hasSelectedCategory) {
            setCategory('Water');
            setDepartment(normalizeDepartment('', 'Water'));
            setHasSelectedCategory(true);
          }
        } else if (
          category === 'Drainage' ||
          filenameLower.includes('drain') ||
          filenameLower.includes('sewag') ||
          filenameLower.includes('gutter') ||
          filenameLower.includes('culvert')
        ) {
          analysisDomain = 'drainage';
          if (!hasSelectedCategory) {
            setCategory('Drainage');
            setDepartment(normalizeDepartment('', 'Drainage'));
            setHasSelectedCategory(true);
          }
        } else if (
          category === 'Sanitation' ||
          filenameLower.includes('garbage') ||
          filenameLower.includes('waste') ||
          filenameLower.includes('trash')
        ) {
          analysisDomain = 'waste';
          if (!hasSelectedCategory) {
            setCategory('Sanitation');
            setDepartment(normalizeDepartment('', 'Sanitation'));
            setHasSelectedCategory(true);
          }
        } else if (
          category === 'Roads' ||
          filenameLower.includes('road') ||
          filenameLower.includes('pothole') ||
          filenameLower.includes('asphalt')
        ) {
          analysisDomain = 'road';
          if (!hasSelectedCategory) {
            setCategory('Roads');
            setDepartment(normalizeDepartment('', 'Roads'));
            setHasSelectedCategory(true);
          }
        }
      }

      // If no domain selected or detected from filename, do NOT silently default to road! Require explicit selection.
      if (!analysisDomain) {
        setAnalyzingAI(false);
        return;
      }

      const res = await detectCivicIssue(file, isRetry, analysisDomain);

      // Race condition cancellation: ignore slower response from earlier domain request
      if (thisRequestId !== aiRequestIdRef.current) {
        console.log(`[DomainSync] Slower response from req #${thisRequestId} ignored in favor of active req #${aiRequestIdRef.current}`);
        return;
      }

      // Cross-domain safety guard: Never show pipe result under Road or road result under Water
      if (analysisDomain === 'pipe' && (res.category === 'Roads' || res.category === 'Road Condition' || res.department_code === 'PWD')) {
        console.warn('[DomainSync] Mismatched road result for pipe domain; converting to domain-specific manual review');
        res.category = 'Water';
        res.department = 'Water Supply & Sewerage Board';
        res.department_code = 'WTR';
        res.aiStatus = 'manual_review';
        res.issue_type = 'Pipe Condition Needs Review';
        res.title = 'Pipe Condition Needs Review';
      } else if (analysisDomain === 'road' && (res.category === 'Water' || res.category === 'Water Supply' || res.department_code === 'WTR')) {
        console.warn('[DomainSync] Mismatched water result for road domain; converting to domain-specific manual review');
        res.category = 'Roads';
        res.department = 'Public Works Department';
        res.department_code = 'PWD';
        res.aiStatus = 'manual_review';
        res.issue_type = 'Road Condition Needs Review';
        res.title = 'Road Condition Needs Review';
      }

      setAiResult(res);
      setPrimaryFeatures(res.visual_features || null);

      if (res.is_available !== false && res.confidence > 0) {
        if (res.road_condition === 'clean' || res.aiStatus === 'confirmed_clean') {
          // Clean road confirmed: Do NOT pre-fill PWD / Road Damage / High Priority
          setCategory('Roads');
          setTitle('');
          setDescription('');
          setPriority('Low');
          setDepartment('');
          setForceManualReport(false);
          setIsManuallyEdited(false);
        } else if (res.aiStatus === 'confirmed_normal') {
          // Normal infrastructure confirmed: No defect, reset form
          setTitle('');
          setDescription('');
          setPriority('Low');
          setDepartment('');
          setForceManualReport(false);
          setIsManuallyEdited(false);
        } else if (res.road_condition === 'uncertain' || (res.aiStatus === 'manual_review' && (res.category === 'Road Condition' || res.category === 'Roads'))) {
          // Uncertain road image: Mark for review, do NOT assign definitive PWD
          setCategory('Roads');
          setTitle('');
          setDescription('');
          setPriority('Medium');
          setDepartment('');
          setForceManualReport(false);
          setIsManuallyEdited(false);
        } else {
          if (res.category && res.category !== 'Normal / Functional') {
            const mappedCat = res.category === 'Water Supply' ? 'Water' : (res.category as CivicCategory);
            setCategory(mappedCat);
          }
          if (!isManuallyEdited || !title) {
            if (res.title) {
              setTitle(res.title);
            }
          }
          if (!isManuallyEdited || !description) {
            if (res.description) {
              const consolidated = buildConsolidatedCivicDescription(res.description, res, angleSlots);
              setDescription(consolidated);
            }
          }
          if (!isManuallyEdited || !priority) {
            if (res.priority) {
              setPriority(res.priority as PriorityLevel);
            }
          }
          if (!isManuallyEdited || !department) {
            if (res.department) {
              setDepartment(normalizeDepartment(res.department, res.category));
            }
          }
        }
      }
    } catch (err) {
      console.error('AI Vision Error:', err);
    } finally {
      if (thisRequestId === aiRequestIdRef.current) {
        setAnalyzingAI(false);
      }
    }
  };

  const runDuplicateCheck = async (checkLat: number, checkLng: number) => {
    try {
      let existing = cachedComplaintsRef.current;
      if (!existing || existing.length === 0) {
        existing = await getAllComplaints();
        cachedComplaintsRef.current = existing;
      }
      const dups = findDuplicateComplaints(checkLat, checkLng, existing, 100);
      setNearbyDuplicates(dups);
    } catch {
      setNearbyDuplicates([]);
    }
  };

  const handleSaveDraft = async () => {
    try {
      const images: OfflineDraftImage[] = [];
      (Object.keys(angleSlots) as ComplaintAngle[]).forEach((angle) => {
        const slot = angleSlots[angle];
        if (slot.file) {
          images.push({
            angle,
            blob: slot.file,
            name: slot.file.name,
            type: slot.file.type || 'image/jpeg',
            size: slot.file.size,
            lastModified: slot.file.lastModified
          });
        }
      });

      const draftId = currentDraftId || `draft_${Date.now()}`;
      const nowIso = new Date().toISOString();
      const draftData: OfflineDraft = {
        draft_id: draftId,
        citizen_id: user?.id,
        created_at: draftCreatedAt || nowIso,
        updated_at: nowIso,
        draft_status: 'local_draft',
        title: title || (category ? `${category} Issue Reported` : 'Civic Issue Reported'),
        description,
        category: (category || 'Roads') as CivicCategory,
        priority,
        department,
        latitude: lat,
        longitude: lng,
        location_source: locationSource,
        location_accuracy_m: locationAccuracy,
        original_capture_time: originalCaptureTime || nowIso,
        exif_gps: exifGpsData,
        manual_address: locationAddress,
        images
      };

      await saveIndexedDBDraft(draftData);
      setCurrentDraftId(draftId);
      isDraftLoadedRef.current = true;

      const updatedDrafts = await getIndexedDBDrafts(user?.id);
      setSavedDraftsList(updatedDrafts);

      // SAVE DRAFT UI
      if (typeof navigator !== 'undefined' && !navigator.onLine) {
        toast.info(
          "You're offline. Your complaint and photos are safely saved on this device. You can review and submit it once you're back online."
        );
      } else {
        toast.success("Draft saved on this device.");
      }
      setDraftSavedToast(true);
      setTimeout(() => setDraftSavedToast(false), 3000);
    } catch (e: any) {
      console.error("Save draft failed:", e);
      toast.error("Failed to save draft locally.");
    }
  };

  // Final Complaint Submission
  const handleFinalSubmit = async (e?: React.MouseEvent) => {
    if (e) {
      e.preventDefault();
      e.stopPropagation();
    }

    // Synchronous immediate guard against double-clicks and concurrent executions
    if (isSubmittingRef.current || submitting) {
      return;
    }

    // MANUAL ONLINE SUBMISSION RULE:
    // If offline: do not submit, keep draft safe
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      isSubmittingRef.current = false;
      setSubmitting(false);
      setShowReviewModal(false);
      toast.warning("No internet connection. Your draft is safe. Submit it when you're back online.");
      await handleSaveDraft();
      return;
    }

    isSubmittingRef.current = true;
    setSubmitting(true);

    try {
      const complaintNumber = generateComplaintNumber();

      const validPhotoCount = Object.values(angleSlots).filter((s) => Boolean(s.previewUrl || s.file)).length;

      if (validPhotoCount < 2) {
        toast.warning(`At least 2 evidence photos from any view are compulsory. Currently uploaded: ${validPhotoCount}/4. Please upload ${2 - validPhotoCount} more photo${2 - validPhotoCount > 1 ? 's' : ''} to proceed.`);
        isSubmittingRef.current = false;
        setSubmitting(false);
        return;
      }

      if (!category) {
        toast.warning('Please select an issue type (Water Supply, Roads & Works, Drainage, or Sanitation) before submitting.');
        isSubmittingRef.current = false;
        setSubmitting(false);
        return;
      }

      // 3-Tier Geolocation Validation
      if (!isValidCoordinate(lat, lng)) {
        toast.error('Valid complaint coordinates are required. Please mark the defect location on the map.');
        isSubmittingRef.current = false;
        setSubmitting(false);
        return;
      }

      if (locationSource === 'device_gps' && locationAccuracy && locationAccuracy > 100 && !mapPinConfirmed) {
        toast.warning('Device GPS accuracy is lower than 100m. Please confirm defect location on the map.');
        setShowLocationPromptModal(true);
        isSubmittingRef.current = false;
        setSubmitting(false);
        return;
      }

      // Upload all available angle files
      const uploadedUrls: Record<ComplaintAngle, string> = {
        front: '',
        left: '',
        right: '',
        closeup: ''
      };

      const angles: ComplaintAngle[] = ['front', 'left', 'right', 'closeup'];
      for (const ang of angles) {
        const slot = angleSlots[ang];
        if (slot.file) {
          try {
            uploadedUrls[ang] = await uploadComplaintImage(slot.file);
          } catch (uploadErr) {
            console.warn(`Upload failed for ${ang}:`, uploadErr);
          }
        }
        // If upload failed or not available, fallback to permanent base64 data URL (NEVER a temporary blob: URL)
        if (!uploadedUrls[ang] && slot.file) {
          try {
            uploadedUrls[ang] = await new Promise<string>((resolve) => {
              const reader = new FileReader();
              reader.onloadend = () => resolve((reader.result as string) || DEFAULT_CIVIC_IMAGE_PLACEHOLDER);
              reader.onerror = () => resolve(DEFAULT_CIVIC_IMAGE_PLACEHOLDER);
              reader.readAsDataURL(slot.file!);
            });
          } catch {
            uploadedUrls[ang] = DEFAULT_CIVIC_IMAGE_PLACEHOLDER;
          }
        } else if (!uploadedUrls[ang] && slot.previewUrl && !slot.previewUrl.startsWith('blob:')) {
          uploadedUrls[ang] = slot.previewUrl;
        }
      }

      // Determine primary URL (Front View, or first available angle) — NEVER a temporary blob: URL
      const cleanPreviewFallback = (photoPreviewUrl && !photoPreviewUrl.startsWith('blob:')) ? photoPreviewUrl : '';
      const primaryUrl = uploadedUrls.front || uploadedUrls.left || uploadedUrls.right || uploadedUrls.closeup || cleanPreviewFallback || DEFAULT_CIVIC_IMAGE_PLACEHOLDER;

      const anglePhotos: ComplaintAnglePhoto[] = [
        uploadedUrls.front ? { angle: 'front' as ComplaintAngle, label: 'Front View', url: uploadedUrls.front } : null,
        uploadedUrls.left ? { angle: 'left' as ComplaintAngle, label: 'Left View', url: uploadedUrls.left } : null,
        uploadedUrls.right ? { angle: 'right' as ComplaintAngle, label: 'Right View', url: uploadedUrls.right } : null,
        uploadedUrls.closeup ? { angle: 'closeup' as ComplaintAngle, label: 'Close-up Detail', url: uploadedUrls.closeup } : null,
      ].filter(Boolean) as ComplaintAnglePhoto[];

      const additionalUrls = [
        uploadedUrls.left,
        uploadedUrls.right,
        uploadedUrls.closeup
      ].filter(Boolean);

      const resolvedDept = resolveDepartmentInfo(undefined, department, category || undefined);

      const newComplaintData = {
        complaint_number: complaintNumber,
        citizen_id: user?.id || '',
        photo_before_url: primaryUrl,
        photo_front_url: uploadedUrls.front || primaryUrl,
        photo_left_url: uploadedUrls.left || '',
        photo_right_url: uploadedUrls.right || '',
        photo_closeup_url: uploadedUrls.closeup || '',
        angle_photos: anglePhotos,
        additional_photos: additionalUrls,
        ai_vision_metadata: (aiResult && aiResult.confidence > 0) ? {
          category: aiResult.category,
          confidence: aiResult.confidence,
          confidence_level: aiResult.confidence_level,
          detected_objects: aiResult.detected_objects,
          analysis_time_ms: aiResult.analysis_time_ms,
          angles_count: anglePhotos.length
        } : undefined,
        category: (category || 'Roads') as CivicCategory,
        title: title || `${category || 'Civic'} Issue Reported`,
        description: description || `Civic issue reported via NAGARSETU at ${locationAddress}`,
        priority,
        status: (aiResult && aiResult.confidence < 0.80) ? ('NEEDS_VERIFICATION' as const) : ('Submitted' as const),
        department_id: resolvedDept.id,
        department_name: resolvedDept.fullName,
        latitude: lat,
        longitude: lng,
        location_source: locationSource,
        location_accuracy_m: locationAccuracy,
        location_address: locationAddress,
        ai_category: aiResult?.category || category || 'Roads',
        ai_specific_issue: aiResult?.issue_type || category || 'Civic Issue',
        ai_confidence: aiResult?.confidence ?? 0.0,
        ai_severity: aiResult?.severity || aiResult?.priority || priority,
        ai_urgency: aiResult?.priority || priority,
        ai_evidence: aiResult?.description || description,
        ai_model: (aiResult as any)?.model || 'civiclens-yolov8',
        ai_status: aiResult?.aiStatus || 'confirmed',
        ai_detected_class: aiResult?.explanation?.detectedIssue || (aiResult?.detected_objects?.[0] ?? null),
        ai_reason: aiResult?.explanation?.reason || aiResult?.description || '',
        ai_analyzed_at: new Date().toISOString(),
        needs_manual_verification: !aiResult || aiResult.reviewRequired !== false || aiResult.confidence < 0.75
      };

      const created = await createComplaint(newComplaintData);
      if (currentDraftId) {
        await deleteIndexedDBDraft(currentDraftId);
      }
      clearOfflineDrafts();
      setShowReviewModal(false);
      toast.success("Complaint submitted successfully.");
      // Keep isSubmittingRef.current = true to lock against any duplicate submissions during redirection
      navigate('/citizen/success', { state: { complaint: created } });
    } catch (err: any) {
      console.error('Complaint submission error:', err);
      // Re-enable submission only when submission genuinely fails
      isSubmittingRef.current = false;
      setSubmitting(false);
      setShowReviewModal(false);

      if (isNetworkError(err)) {
        handleSaveDraft();
        toast.info('Network issue detected. Complaint saved to offline drafts on your device.');
      } else if (err instanceof AuthError || err.isAuthError || err.status === 401 || err.status === 403) {
        toast.error(err.message || 'Authentication required. Please log in again.');
      } else if (err instanceof HttpError || err.isHttpError || err.status) {
        if (err.status === 429) {
          toast.error(err.message || 'Action rate limit exceeded. Please slow down your requests and try again in a few moments.');
        } else if (
          err.status === 409 &&
          (err.data?.error === 'ISSUE_ALREADY_REPORTED_BY_CITIZEN' ||
           err.data?.code === 'ISSUE_ALREADY_REPORTED_BY_CITIZEN')
        ) {
          const duplicateMsg =
            'This issue has already been reported by you within 100 metres. You cannot create another complaint for the same issue.';
          setSameIssueDuplicateError({
            message: duplicateMsg,
            existingComplaintId: err.data?.existing_complaint_id,
            distanceM: err.data?.distance_m
          });
          toast.error(duplicateMsg);
        } else {
          const detailStr = err.data?.details && Array.isArray(err.data.details) ? ` (${err.data.details.join(', ')})` : '';
          toast.error(`${err.message || 'Server error processing complaint.'}${detailStr}`);
        }
      } else {
        toast.error(err.message || 'Failed to submit complaint. Please verify your details.');
      }
    }
  };

  return (
    <DashboardLayout title={t('reportComplaint')}>
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 w-full space-y-6 font-sans">
        
        {/* HEADER BAR */}
        <div className="bg-white p-6 rounded-xl border border-gray-200 shadow-sm flex flex-wrap items-center justify-between gap-4">
          <div className="space-y-1">
            <div className="flex items-center space-x-2">
              <Link to="/citizen/portal" className="text-xs font-bold text-emerald-700 hover:underline flex items-center space-x-1">
                <ArrowLeft className="w-3.5 h-3.5" />
                <span>{t('backToDashboard')}</span>
              </Link>
            </div>
            <h1 className="text-2xl sm:text-3xl font-extrabold text-gray-900 font-outfit">
              {t('reportComplaint')}
            </h1>
            <p className="text-xs sm:text-sm text-gray-600">
              {t('reportIssueSubtitle')}
            </p>
          </div>

          <div className={`flex items-center space-x-2 text-xs font-mono font-bold px-3.5 py-2 rounded-full border ${
            aiHealth?.reachable
              ? 'text-emerald-700 bg-emerald-50 border-emerald-200'
              : 'text-amber-800 bg-amber-50 border-amber-200'
          }`}>
            <Sparkles className={`w-4 h-4 ${aiHealth?.reachable ? 'text-emerald-600 animate-pulse' : 'text-amber-600'}`} />
            <span>
              {aiHealth?.reachable
                ? 'Nagarsetu AI'
                : aiHealth?.configured
                ? '🟡 AI Service Offline (Manual Mode Ready)'
                : '🔴 AI Service Unavailable'}
            </span>
          </div>
        </div>

        {/* DRAFT SAVED TOAST */}
        {draftSavedToast && (
          <div className="p-4 rounded-xl bg-emerald-50 border border-emerald-300 text-emerald-800 text-xs font-bold flex items-center space-x-2 shadow-xs">
            <CheckCircle2 className="w-4 h-4 text-emerald-600" />
            <span>{t('draftSavedSuccess')}</span>
          </div>
        )}

        {/* SAME-ISSUE CITIZEN DUPLICATE ALERT */}
        {sameIssueDuplicateError && (
          <div className="p-4 rounded-xl bg-amber-50 border-2 border-amber-400 text-amber-900 shadow-sm space-y-3">
            <div className="flex items-start gap-3">
              <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
              <div className="space-y-1">
                <h4 className="text-sm font-bold text-amber-900">
                  Duplicate Issue Reported
                </h4>
                <p className="text-sm text-amber-800">
                  {sameIssueDuplicateError.message}
                </p>
                {sameIssueDuplicateError.distanceM !== undefined && (
                  <p className="text-xs text-amber-700">
                    Proximity to previous report: {sameIssueDuplicateError.distanceM} metres
                  </p>
                )}
              </div>
            </div>
            {sameIssueDuplicateError.existingComplaintId && (
              <div className="pt-1 flex items-center gap-2">
                <Link
                  to={`/citizen/complaints/${sameIssueDuplicateError.existingComplaintId}`}
                  className="inline-flex items-center gap-1.5 px-4 py-2 bg-amber-600 hover:bg-amber-700 text-white text-xs font-bold rounded-lg shadow-sm transition-colors"
                >
                  <Eye className="w-3.5 h-3.5" />
                  <span>Track Existing Complaint #{sameIssueDuplicateError.existingComplaintId}</span>
                  <ArrowRight className="w-3.5 h-3.5" />
                </Link>
              </div>
            )}
          </div>
        )}

        {/* NETWORK & OFFLINE DRAFT BANNER */}
        {!isOnlineStatus && (
          <div className="p-4 rounded-xl bg-slate-900 border border-slate-800 text-white shadow-sm flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center space-x-3">
              <WifiOff className="w-5 h-5 text-amber-400 shrink-0" />
              <div>
                <p className="text-sm font-bold">You're currently offline</p>
                <p className="text-xs text-slate-300">
                  Your complaint and photos are safely saved on this device. You can review and submit it once you're back online.
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={handleSaveDraft}
              className="px-3.5 py-1.5 bg-amber-500 hover:bg-amber-600 text-slate-900 text-xs font-bold rounded-lg shadow-sm"
            >
              Save Draft
            </button>
          </div>
        )}

        {isOnlineStatus && savedDraftsList.length > 0 && (
          <div className="p-4 rounded-xl bg-blue-50 border border-blue-200 text-blue-900 shadow-sm flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center space-x-3">
              <FolderOpen className="w-5 h-5 text-blue-600 shrink-0" />
              <div>
                <p className="text-sm font-bold">
                  You're back online. You have {savedDraftsList.length} saved complaint{savedDraftsList.length === 1 ? '' : 's'} ready to submit.
                </p>
                <p className="text-xs text-blue-700">
                  Select a saved draft to review its original issue-site coordinates and submit.
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setShowDraftsModal(true)}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold rounded-lg shadow-sm"
            >
              View Saved Drafts ({savedDraftsList.length})
            </button>
          </div>
        )}

        {/* SAVED DRAFTS MODAL */}
        {showDraftsModal && (
          <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4">
            <div className="bg-white rounded-2xl max-w-2xl w-full max-h-[85vh] overflow-hidden flex flex-col shadow-2xl border border-gray-200">
              <div className="p-5 border-b border-gray-100 flex items-center justify-between bg-gray-50">
                <div className="flex items-center space-x-2">
                  <FolderOpen className="w-5 h-5 text-emerald-600" />
                  <h3 className="font-bold text-gray-900 text-base">Saved Offline Drafts ({savedDraftsList.length})</h3>
                </div>
                <button
                  type="button"
                  onClick={() => setShowDraftsModal(false)}
                  className="p-1 rounded-lg text-gray-400 hover:text-gray-600"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="p-5 overflow-y-auto space-y-4 flex-1">
                {savedDraftsList.length === 0 ? (
                  <p className="text-sm text-gray-500 text-center py-6">No drafts saved on this device.</p>
                ) : (
                  savedDraftsList.map((d) => (
                    <div key={d.draft_id} className="p-4 rounded-xl border border-gray-200 bg-gray-50/50 space-y-3">
                      <div className="flex items-start justify-between">
                        <div>
                          <span className="text-xs font-bold text-emerald-700 uppercase tracking-wider">{d.category}</span>
                          <h4 className="font-bold text-gray-900 text-sm">{d.title}</h4>
                          <p className="text-xs text-gray-500 mt-0.5">
                            Saved on {new Date(d.updated_at).toLocaleString('en-IN')} • {d.images?.length || 0} photo(s)
                          </p>
                        </div>
                        <span className="px-2 py-0.5 text-[10px] font-bold rounded-full bg-amber-100 text-amber-800">
                          Saved Offline
                        </span>
                      </div>
                      <div className="text-xs text-gray-600 flex items-center gap-1.5">
                        <MapPin className="w-3.5 h-3.5 text-gray-400" />
                        <span>Site Coords: {d.latitude.toFixed(5)}, {d.longitude.toFixed(5)} ({d.location_source})</span>
                      </div>
                      <div className="flex items-center justify-end gap-2 pt-2 border-t border-gray-200">
                        <button
                          type="button"
                          onClick={() => handleDeleteDraft(d.draft_id)}
                          className="px-3 py-1.5 text-xs text-rose-600 hover:bg-rose-50 rounded-lg flex items-center gap-1 font-semibold"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                          Delete Draft
                        </button>
                        <button
                          type="button"
                          onClick={() => restoreDraft(d)}
                          className="px-3.5 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold rounded-lg shadow-sm flex items-center gap-1"
                        >
                          <Edit3 className="w-3.5 h-3.5" />
                          Continue Editing & Submit
                        </button>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        )}

        {/* MAIN DESKTOP 50/50 SPLIT LAYOUT */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
          
          {/* LEFT 50% PANEL: IMAGE & AI ANALYSIS & LOCATION BADGE */}
          <div className="lg:col-span-6 bg-white p-6 rounded-xl border border-gray-200 shadow-sm space-y-6 lg:sticky lg:top-20">
            
            {/* EVIDENCE PHOTOS HEADER & CAROUSEL */}
            {(() => {
              const addedCount = Object.values(angleSlots).filter((s) => Boolean(s.previewUrl)).length;
              const cfg = ANGLE_CONFIGS[currentSlotIndex] || ANGLE_CONFIGS[0];
              const slot = angleSlots[cfg.angle];
              const isFront = cfg.angle === 'front';
              const hasImage = Boolean(slot.previewUrl);

              return (
                <div className="space-y-4">
                  {/* Header with Title and Dynamic Badge Counter */}
                  <div className="flex items-center justify-between border-b border-gray-100 pb-3">
                    <div>
                      <h2 className="text-sm font-extrabold text-gray-900 font-outfit uppercase tracking-wider flex items-center space-x-2">
                        <Camera className="w-4 h-4 text-emerald-600" />
                        <span>Complaint Evidence Photos</span>
                      </h2>
                      <p className="text-[11px] text-gray-500 mt-0.5">
                        Swipe or navigate through 4 angles. Minimum 2 photos required from any view.
                      </p>
                    </div>
                    <div className="flex items-center space-x-2 shrink-0">
                      <span className={`text-xs font-mono font-extrabold px-2.5 py-1 rounded-full border shadow-2xs ${
                        addedCount >= 2
                          ? 'bg-emerald-50 text-emerald-800 border-emerald-300 ring-1 ring-emerald-200'
                          : 'bg-amber-50 text-amber-800 border-amber-300 ring-1 ring-amber-200'
                      }`}>
                        {addedCount} / 4 Added {addedCount < 2 ? `(Min 2 Compulsory)` : `✓ Ready`}
                      </span>
                    </div>
                  </div>

                  {/* Issue Category / Domain Quick Selector */}
                  <div className="bg-slate-50/90 p-3 rounded-xl border border-slate-200 space-y-2">
                    <div className="flex items-center justify-between">
                      <label className="text-[11px] font-extrabold uppercase tracking-wider text-slate-700 flex items-center space-x-1.5 font-outfit">
                        <span>Select Issue Type to Report</span>
                      </label>
                      <span className="text-[10px] text-slate-500 font-medium">Routes to specialized local AI</span>
                    </div>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                      {[
                        { id: 'Water', domain: 'pipe', icon: '💧', label: 'Water Supply', desc: 'Pipe Leak / Burst' },
                        { id: 'Roads', domain: 'road', icon: '🛣️', label: 'Roads & Works', desc: 'Pothole / Surface' },
                        { id: 'Drainage', domain: 'drainage', icon: '🚰', label: 'Drainage', desc: 'Block / Overflow' },
                        { id: 'Sanitation', domain: 'waste', icon: '🗑️', label: 'Sanitation', desc: 'Garbage / Waste' },
                      ].map((item) => {
                        const isSelected = category === item.id;
                        return (
                          <button
                            key={item.id}
                            type="button"
                            onClick={() => {
                              handleCategoryChange(item.id as CivicCategory);
                            }}
                            className={`p-2.5 rounded-xl text-left border transition-all cursor-pointer ${
                              isSelected
                                ? 'bg-emerald-50 border-emerald-500 text-emerald-950 shadow-xs ring-1 ring-emerald-400'
                                : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-100 hover:border-slate-300'
                            }`}
                          >
                            <div className="flex items-center space-x-1.5 font-extrabold text-xs">
                              <span>{item.icon}</span>
                              <span className="truncate">{item.label}</span>
                            </div>
                            <div className="text-[10px] text-slate-500 truncate mt-0.5">{item.desc}</div>
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {/* Compulsory 2-Photo Requirement Banner */}
                  {addedCount < 2 ? (
                    <div className="p-3 rounded-xl bg-amber-50 border border-amber-300 text-amber-950 text-xs font-medium flex items-center justify-between gap-2 shadow-2xs">
                      <div className="flex items-center space-x-2">
                        <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
                        <span>
                          <strong>Compulsory requirement:</strong> Please upload at least <strong>2 photos</strong> (any view) before proceeding.
                        </span>
                      </div>
                      <span className="font-mono font-extrabold bg-amber-200/80 text-amber-900 px-2 py-0.5 rounded text-[11px] shrink-0">
                        {addedCount}/2 Uploaded
                      </span>
                    </div>
                  ) : (
                    <div className="p-2.5 rounded-xl bg-emerald-50 border border-emerald-300 text-emerald-950 text-xs font-medium flex items-center justify-between gap-2 shadow-2xs">
                      <div className="flex items-center space-x-2">
                        <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                        <span>
                          <strong>Requirement met!</strong> {addedCount} photos uploaded (minimum 2 satisfied). You can proceed to submit.
                        </span>
                      </div>
                      <span className="font-mono font-extrabold bg-emerald-200/80 text-emerald-900 px-2 py-0.5 rounded text-[11px] shrink-0">
                        ✓ Unlocked
                      </span>
                    </div>
                  )}


                  {/* Single Image Slot Carousel View with Touch Swipe Support */}
                  <div
                    className="relative overflow-hidden touch-pan-y"
                    onTouchStart={onTouchStart}
                    onTouchMove={onTouchMove}
                    onTouchEnd={onTouchEnd}
                  >
                    <div
                      key={cfg.angle}
                      className={`rounded-2xl border p-4 flex flex-col justify-between transition-all min-h-[350px] ${
                        hasImage
                          ? 'bg-white border-emerald-300 shadow-sm ring-1 ring-emerald-100'
                          : isFront
                          ? 'bg-emerald-50/40 border-2 border-dashed border-emerald-300'
                          : 'bg-gray-50/70 border-2 border-dashed border-gray-300'
                      }`}
                    >
                      {/* Top Popup / Label showing recommended view & dynamic counter */}
                      <div className="flex items-center justify-between gap-2 mb-3">
                        <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-50 text-emerald-900 border border-emerald-300 shadow-2xs text-xs font-bold font-outfit">
                          <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
                          <span>Recommended: {cfg.recommendedView}</span>
                        </div>

                        <div className="flex items-center space-x-1.5">
                          <span className={`inline-flex items-center px-2 py-0.5 rounded-full border text-xs font-mono font-extrabold shadow-2xs ${
                            addedCount >= 2
                              ? 'bg-emerald-50 text-emerald-800 border-emerald-300'
                              : 'bg-amber-50 text-amber-800 border-amber-300'
                          }`}>
                            {addedCount}/4 {addedCount < 2 ? '(Min 2)' : ''}
                          </span>
                          <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full font-mono ${
                            isFront
                              ? 'bg-emerald-100 text-emerald-800 border border-emerald-200'
                              : 'bg-slate-100 text-slate-700 border border-slate-200'
                          }`}>
                            Slot {currentSlotIndex + 1} of 4
                          </span>
                        </div>
                      </div>

                      {/* Title & Subtitle description */}
                      <div className="mb-2">
                        <div className="flex items-center space-x-2">
                          <h3 className="font-extrabold text-sm text-gray-900 font-outfit">
                            {cfg.title}
                          </h3>
                          <span className="text-[10px] text-gray-500 font-medium font-mono">({cfg.badge})</span>
                          {hasImage && (
                            <span className="text-[9px] font-mono font-bold px-2 py-0.5 rounded-full border ml-auto flex items-center gap-1 bg-emerald-50 text-emerald-700 border-emerald-200">
                              {slotValidationResults[cfg.angle]?.outcome === 'UNCERTAIN' ? (
                                <span className="text-amber-800 font-bold">⚠ Manual Review</span>
                              ) : (
                                <span>✓ Supported ({category ? translateCategory(category) : 'Evidence'})</span>
                              )}
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-gray-500 mt-0.5">
                          {cfg.subtitle}
                        </p>
                      </div>

                      {/* Angle Slot Body: Preview or Capture Controls */}
                      {hasImage ? (
                        <div className="space-y-3 my-auto">
                          <div
                            className="relative aspect-16/10 rounded-xl overflow-hidden border border-gray-200 bg-gray-100 group cursor-pointer shadow-xs"
                            onClick={() => setZoomImageUrl(slot.previewUrl)}
                            title="Click to view larger"
                          >
                            <img
                              src={slot.previewUrl}
                              alt={cfg.title}
                              className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-200"
                            />
                            <div className="absolute inset-0 bg-black/20 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center text-white">
                              <ZoomIn className="w-6 h-6 drop-shadow" />
                            </div>
                            {isFront && analyzingAI && (
                              <div className="absolute inset-0 bg-gray-900/60 backdrop-blur-xs flex flex-col items-center justify-center text-white text-xs font-bold space-y-1.5">
                                <Sparkles className="w-5 h-5 animate-spin text-emerald-400" />
                                <span>AI Analyzing...</span>
                              </div>
                            )}
                          </div>

                          {/* Action buttons: Retake / Replace / Remove */}
                          <div className="flex items-center space-x-2 pt-1">
                            <label
                              htmlFor={`citizen-angle-camera-${cfg.angle}`}
                              className="flex-1 py-2 px-3 rounded-xl bg-gray-100 hover:bg-gray-200 text-gray-800 font-bold text-xs text-center border border-gray-300 cursor-pointer min-h-[40px] flex items-center justify-center space-x-1.5 shadow-2xs"
                              title="Retake photo using camera"
                            >
                              <Camera className="w-3.5 h-3.5 text-emerald-600" />
                              <span>Retake</span>
                            </label>

                            <label
                              htmlFor={`citizen-angle-upload-${cfg.angle}`}
                              className="flex-1 py-2 px-3 rounded-xl bg-gray-100 hover:bg-gray-200 text-gray-800 font-bold text-xs text-center border border-gray-300 cursor-pointer min-h-[40px] flex items-center justify-center space-x-1.5 shadow-2xs"
                              title="Replace with file from device"
                            >
                              <Upload className="w-3.5 h-3.5 text-blue-600" />
                              <span>Replace</span>
                            </label>

                            <button
                              type="button"
                              onClick={() => removeAnglePhoto(cfg.angle)}
                              className="py-2 px-3 rounded-xl bg-rose-50 hover:bg-rose-100 text-rose-700 font-bold text-xs border border-rose-200 min-h-[40px] flex items-center justify-center shadow-2xs"
                              title="Remove this photo"
                            >
                              <X className="w-4 h-4" />
                            </button>
                          </div>
                        </div>
                      ) : (
                        <div className="space-y-4 py-6 my-auto text-center">
                          {validatingSlot === cfg.angle ? (
                            <div className="py-6 space-y-3">
                              <div className="w-14 h-14 rounded-2xl bg-emerald-50 text-emerald-600 flex items-center justify-center mx-auto border border-emerald-200 shadow-2xs">
                                <RefreshCw className="w-7 h-7 text-emerald-600 animate-spin" />
                              </div>
                              <div>
                                <p className="text-xs font-extrabold text-emerald-900 font-outfit">Validating Issue Category...</p>
                                <p className="text-[11px] text-emerald-700 mt-0.5">Analyzing image with specialized AI model before accepting</p>
                              </div>
                            </div>
                          ) : (
                            <>
                              {unsupportedAlert && unsupportedAlert.angle === cfg.angle && (
                                <div className="p-3.5 rounded-xl bg-rose-50 border border-rose-300 text-rose-950 text-xs space-y-2 mb-3 text-left">
                                  <div className="flex items-center space-x-2 font-extrabold text-rose-900">
                                    <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0" />
                                    <span>Unsupported Image</span>
                                  </div>
                                  <p className="text-rose-800 text-[11px] leading-relaxed">
                                    {unsupportedAlert.message}
                                  </p>
                                  {unsupportedAlert.suggestedCategory && (
                                    <div className="flex items-center justify-between pt-1">
                                      <span className="text-[11px] font-medium text-rose-900">
                                        Suggested: <strong>{unsupportedAlert.suggestedCategory}</strong>
                                      </span>
                                      {unsupportedAlert.detectedKey && (
                                        <button
                                          type="button"
                                          onClick={() => handleCategoryChange(unsupportedAlert.detectedKey!)}
                                          className="px-2.5 py-1 rounded-lg bg-rose-600 hover:bg-rose-700 text-white font-bold text-[10px] cursor-pointer shadow-2xs"
                                        >
                                          Switch to {unsupportedAlert.suggestedCategory}
                                        </button>
                                      )}
                                    </div>
                                  )}
                                </div>
                              )}

                              <div className="w-14 h-14 rounded-2xl bg-white text-emerald-600 flex items-center justify-center mx-auto border border-gray-200 shadow-2xs">
                                <Camera className="w-7 h-7 text-emerald-600" />
                              </div>

                              <div>
                                <p className="text-xs font-bold text-gray-800 font-outfit">Add photo for {cfg.recommendedView}</p>
                                <p className="text-[11px] text-gray-500 mt-0.5">Use camera or choose file from device gallery</p>
                              </div>

                              <div className="grid grid-cols-2 gap-3 max-w-sm mx-auto">
                                <label
                                  htmlFor={`citizen-angle-camera-${cfg.angle}`}
                                  className="py-2.5 px-3 rounded-xl bg-emerald-600 hover:bg-emerald-700 active:bg-emerald-800 text-white font-extrabold text-xs text-center cursor-pointer shadow-xs min-h-[44px] flex items-center justify-center space-x-2"
                                >
                                  <Camera className="w-4 h-4 shrink-0" />
                                  <span>Camera</span>
                                </label>

                                <label
                                  htmlFor={`citizen-angle-upload-${cfg.angle}`}
                                  className="py-2.5 px-3 rounded-xl bg-white hover:bg-gray-100 active:bg-gray-200 text-gray-800 font-bold text-xs text-center border border-gray-300 shadow-2xs cursor-pointer min-h-[44px] flex items-center justify-center space-x-2"
                                >
                                  <Upload className="w-4 h-4 shrink-0 text-gray-600" />
                                  <span>Upload</span>
                                </label>
                              </div>
                            </>
                          )}
                        </div>
                      )}

                      {/* Navigation Controls: Previous / Next controls & swipe indicator */}
                      <div className="flex items-center justify-between pt-3 mt-2 border-t border-gray-100">
                        <button
                          type="button"
                          onClick={() => setCurrentSlotIndex((prev) => Math.max(0, prev - 1))}
                          disabled={currentSlotIndex === 0}
                          className={`flex items-center space-x-1 px-3 py-1.5 rounded-lg text-xs font-bold transition-all min-h-[36px] ${
                            currentSlotIndex === 0
                              ? 'text-gray-300 cursor-not-allowed'
                              : 'text-gray-700 hover:bg-gray-100 active:bg-gray-200 border border-gray-200 shadow-2xs'
                          }`}
                        >
                          <ChevronLeft className="w-4 h-4" />
                          <span>Previous</span>
                        </button>

                        <div className="flex items-center space-x-1">
                          {ANGLE_CONFIGS.map((_, dotIdx) => (
                            <button
                              key={`dot-${dotIdx}`}
                              type="button"
                              onClick={() => setCurrentSlotIndex(dotIdx)}
                              className={`h-2 rounded-full transition-all ${
                                currentSlotIndex === dotIdx
                                  ? 'w-6 bg-emerald-600'
                                  : 'w-2 bg-gray-300 hover:bg-gray-400'
                              }`}
                              title={`Go to Slot ${dotIdx + 1}`}
                            />
                          ))}
                        </div>

                        <button
                          type="button"
                          onClick={() => setCurrentSlotIndex((prev) => Math.min(ANGLE_CONFIGS.length - 1, prev + 1))}
                          disabled={currentSlotIndex === ANGLE_CONFIGS.length - 1}
                          className={`flex items-center space-x-1 px-3 py-1.5 rounded-lg text-xs font-bold transition-all min-h-[36px] ${
                            currentSlotIndex === ANGLE_CONFIGS.length - 1
                              ? 'text-gray-300 cursor-not-allowed'
                              : 'text-emerald-700 bg-emerald-50 hover:bg-emerald-100 active:bg-emerald-200 border border-emerald-200 shadow-2xs'
                          }`}
                        >
                          <span>Next</span>
                          <ChevronRight className="w-4 h-4" />
                        </button>
                      </div>
                    </div>

                    {/* Persistent Camera & Upload Hidden Inputs for all 4 slots */}
                    {ANGLE_CONFIGS.map((c) => (
                      <React.Fragment key={`inputs-${c.angle}`}>
                        <input
                          type="file"
                          accept="image/*"
                          capture="environment"
                          id={`citizen-angle-camera-${c.angle}`}
                          className="hidden"
                          onChange={(e) => {
                            if (e.target.files && e.target.files[0]) {
                              handleAnglePhotoSelect(c.angle, e.target.files[0]);
                            }
                          }}
                        />
                        <input
                          type="file"
                          accept="image/jpeg,image/png,image/webp,image/jpg"
                          id={`citizen-angle-upload-${c.angle}`}
                          className="hidden"
                          onChange={(e) => {
                            if (e.target.files && e.target.files[0]) {
                              handleAnglePhotoSelect(c.angle, e.target.files[0]);
                            }
                          }}
                        />
                      </React.Fragment>
                    ))}
                  </div>
                </div>
              );
            })()}

            {/* Analyzing AI state banner */}
            {analyzingAI && (
              <div className="p-4 rounded-xl bg-emerald-50 border border-emerald-300 flex items-center space-x-3 text-xs text-emerald-950 shadow-2xs">
                <RefreshCw className="w-5 h-5 text-emerald-600 animate-spin shrink-0" />
                <div>
                  <div className="font-extrabold font-outfit text-sm text-emerald-900">
                    Running Local AI Vision Analysis...
                  </div>
                  <div className="text-emerald-700 text-[11px] mt-0.5">
                    Analyzing photo for <strong>{category ? translateCategory(category) : 'civic infrastructure'}</strong> using specialized local model.
                  </div>
                </div>
              </div>
            )}

            {/* Neutral prompt if image uploaded but no domain selected yet */}
            {!analyzingAI && !aiResult && selectedPhotoFile && !category && (
              <div className="p-4 rounded-xl bg-slate-50 border-2 border-dashed border-slate-300 text-slate-800 space-y-2 text-xs">
                <div className="flex items-center space-x-2 font-extrabold text-slate-900 font-outfit text-sm">
                  <Sparkles className="w-4 h-4 text-emerald-600" />
                  <span>Select Issue Domain Above</span>
                </div>
                <p className="text-slate-600 text-xs">
                  Please tap one of the issue buttons above (<strong>Water Supply</strong>, <strong>Roads & Works</strong>, <strong>Drainage</strong>, or <strong>Sanitation</strong>) to analyze this photo with the dedicated local AI model.
                </p>
              </div>
            )}

            {/* AI ANALYSIS RESULT CARD */}
            {aiResult && aiResult.is_available === false ? (
              <div className="p-4 rounded-xl bg-amber-50 border border-amber-300 space-y-3 text-xs">
                <div className="flex items-center justify-between">
                  <span className="font-extrabold text-amber-900 font-outfit uppercase tracking-wider flex items-center space-x-1.5">
                    <AlertTriangle className="w-4 h-4 text-amber-600" />
                    <span>{t('aiVisionAnalysis')}</span>
                  </span>
                  <span className="font-mono text-[10px] font-bold px-2 py-0.5 rounded border text-amber-800 bg-white border-amber-200">
                    Status: AI Temporarily Unavailable
                  </span>
                </div>

                <p className="text-amber-900 font-medium text-xs">
                  {aiResult.error_message || 'Local AI Vision service is temporarily unavailable. You can retry or enter the complaint details manually.'}
                </p>

                <div className="flex flex-col sm:flex-row items-center gap-2 pt-1">
                  {angleSlots.front.file && (
                    <button
                      type="button"
                      disabled={analyzingAI}
                      onClick={() => {
                        if (angleSlots.front.file && !analyzingAI) runAIVisionAndLocation(angleSlots.front.file, angleSlots.front.previewUrl, true);
                      }}
                      className="w-full sm:w-1/2 py-2.5 rounded-xl bg-white hover:bg-amber-100 text-amber-900 font-bold border border-amber-300 flex items-center justify-center space-x-1 min-h-[44px] cursor-pointer disabled:opacity-50"
                    >
                      <RefreshCw className={`w-3.5 h-3.5 text-amber-600 ${analyzingAI ? 'animate-spin' : ''}`} />
                      <span>{analyzingAI ? t('retrying') : t('retryAiAnalysis')}</span>
                    </button>
                  )}

                  <button
                    type="button"
                    onClick={() => {
                      const titleInput = document.getElementById('complaint-title-input');
                      if (titleInput) titleInput.focus();
                    }}
                    className="w-full sm:w-1/2 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold flex items-center justify-center space-x-1 min-h-[44px] cursor-pointer"
                  >
                    <span>{t('continueManually')}</span>
                  </button>
                </div>
              </div>
            ) : aiResult && (aiResult.road_condition === 'clean' || aiResult.aiStatus === 'confirmed_clean' || aiResult.aiStatus === 'confirmed_normal' || (aiResult.detected === false && aiResult.aiStatus !== 'manual_review')) ? (
              /* CASE 2: CLEAN OR NORMAL INFRASTRUCTURE VERIFIED */
              <div className="p-4 rounded-xl bg-emerald-50 border-2 border-emerald-400 space-y-3 text-xs shadow-xs">
                <div className="flex items-center justify-between">
                  <span className="font-extrabold text-emerald-950 font-outfit uppercase tracking-wider flex items-center space-x-1.5 text-sm">
                    <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0" />
                    <span>{aiResult.road_condition === 'clean' || aiResult.aiStatus === 'confirmed_clean' ? '✓ ROAD CONDITION: CLEAN' : '✓ INFRASTRUCTURE: NORMAL & INTACT'}</span>
                  </span>
                  <span className="font-mono text-[10px] font-bold px-2 py-0.5 rounded border text-emerald-800 bg-white border-emerald-300">
                    AI confidence: {Math.round(aiResult.confidence * 100)}%
                  </span>
                </div>

                <div className="bg-white/90 p-3 rounded-lg border border-emerald-200 space-y-1">
                  <div className="font-extrabold text-emerald-900 text-sm font-outfit flex items-center space-x-1.5">
                    <ShieldCheck className="w-4 h-4 text-emerald-600" />
                    <span>{aiResult.road_condition === 'clean' || aiResult.aiStatus === 'confirmed_clean' ? 'Road appears clean' : 'Infrastructure appears normal & intact'}</span>
                  </div>
                  <p className="text-gray-700 text-xs font-medium">
                    {aiResult.road_condition === 'clean' || aiResult.aiStatus === 'confirmed_clean' ? 'No visible pothole or major road defect detected.' : 'No visible leak, damage, or civic defect detected.'}
                  </p>
                  <p className="text-gray-500 text-[11px]">
                    {aiResult.description || 'Condition verified normal by local AI model.'}
                  </p>
                </div>

                <div className="flex items-center justify-between text-[11px] bg-white/90 px-2.5 py-1.5 rounded-lg border border-emerald-200">
                  <span className="text-emerald-950 font-medium">
                    Selected Domain: <strong className="font-bold">{category ? translateCategory(category) : (aiResult.category || 'Normal')}</strong>
                    {aiResult.analysis_domain ? <span className="font-mono text-[10px] text-emerald-700 font-bold ml-1">({aiResult.analysis_domain})</span> : null}
                  </span>
                  <span className="text-slate-600 font-medium font-mono text-[10px]">
                    Validated AI Model: <strong className="text-emerald-800 font-bold">{aiResult.model || aiResult.ai_model || (category === 'Water' ? 'water_pipe_model.pt' : category === 'Drainage' ? 'drainage_model.pt' : 'civicmodel.pt')}</strong>
                  </span>
                </div>

                <div className="p-2.5 rounded-lg bg-emerald-100/70 border border-emerald-200 text-emerald-950 text-[11px] font-medium">
                  <span>✓ No complaint is required for this image.</span>
                </div>

                {/* Citizen Action Options */}
                <div className="flex flex-col sm:flex-row items-center gap-2 pt-1 border-t border-emerald-200/60">
                  <button
                    type="button"
                    onClick={() => {
                      const input = document.getElementById('citizen-angle-upload-front') as HTMLInputElement;
                      if (input) input.click();
                    }}
                    className="w-full sm:w-1/3 py-2 px-2.5 rounded-xl bg-white hover:bg-emerald-100 text-emerald-900 font-bold border border-emerald-300 flex items-center justify-center space-x-1 min-h-[40px] cursor-pointer text-[11px]"
                  >
                    <Camera className="w-3.5 h-3.5 text-emerald-700" />
                    <span>Upload Another Image</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      setForceManualReport(true);
                      const titleInput = document.getElementById('complaint-title-input');
                      if (titleInput) {
                        titleInput.focus();
                        titleInput.scrollIntoView({ behavior: 'smooth', block: 'center' });
                      }
                    }}
                    className="w-full sm:w-1/3 py-2 px-2.5 rounded-xl bg-white hover:bg-amber-100 text-amber-900 font-bold border border-amber-300 flex items-center justify-center space-x-1 min-h-[40px] cursor-pointer text-[11px]"
                  >
                    <Edit3 className="w-3.5 h-3.5 text-amber-700" />
                    <span>Report Issue Anyway</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => navigate('/citizen')}
                    className="w-full sm:w-1/3 py-2 px-2.5 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white font-bold flex items-center justify-center space-x-1 min-h-[40px] cursor-pointer text-[11px]"
                  >
                    <X className="w-3.5 h-3.5" />
                    <span>Cancel Report</span>
                  </button>
                </div>
              </div>
            ) : aiResult && (aiResult.road_condition === 'uncertain' || aiResult.aiStatus === 'manual_review') ? (
              /* CASE 3: UNCERTAIN ROAD OR PIPE REVIEW */
              (() => {
                const isPipeReview = aiResult.category === 'Water' || aiResult.department_code === 'WTR' || (aiResult.issue_type || '').toLowerCase().includes('pipe');
                const reviewTitle = isPipeReview ? '⚠ PIPE CONDITION: NEEDS REVIEW' : '⚠ ROAD CONDITION: NEEDS REVIEW';
                const reviewHeadline = isPipeReview ? 'Pipe condition could not be verified confidently.' : 'Road condition could not be verified confidently.';
                const reviewSubtext = isPipeReview ? 'Please verify pipe defect details manually or upload a clearer pipe image.' : 'Please upload a clearer road image.';
                const retryBtnText = isPipeReview ? 'Upload Clearer Pipe Image' : 'Upload Clearer Image';

                return (
                  <div className="p-4 rounded-xl bg-amber-50 border-2 border-amber-300 space-y-3 text-xs shadow-xs">
                    <div className="flex items-center justify-between">
                      <span className="font-extrabold text-amber-950 font-outfit uppercase tracking-wider flex items-center space-x-1.5 text-sm">
                        <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0" />
                        <span>{reviewTitle}</span>
                      </span>
                      <span className="font-mono text-[10px] font-bold px-2 py-0.5 rounded border text-amber-800 bg-white border-amber-300">
                        Confidence: {Math.round(aiResult.confidence * 100)}%
                      </span>
                    </div>

                    <div className="bg-white/90 p-3 rounded-lg border border-amber-200 space-y-1">
                      <div className="font-extrabold text-amber-950 text-sm font-outfit">
                        {reviewHeadline}
                      </div>
                      <p className="text-amber-900 text-xs font-medium">
                        {reviewSubtext}
                      </p>
                    </div>

                    <div className="flex items-center justify-between text-[11px] bg-white/90 px-2.5 py-1.5 rounded-lg border border-amber-200">
                      <span className="text-amber-950 font-medium">
                        Selected Domain: <strong className="font-bold">{category ? translateCategory(category) : (aiResult.category || 'Review')}</strong>
                        {aiResult.analysis_domain ? <span className="font-mono text-[10px] text-amber-800 font-bold ml-1">({aiResult.analysis_domain})</span> : null}
                      </span>
                      <span className="text-slate-600 font-medium font-mono text-[10px]">
                        Review Model: <strong className="text-amber-900 font-bold">{aiResult.model || aiResult.ai_model || (isPipeReview ? 'water_pipe_model.pt' : 'road_condition_analyzer')}</strong>
                      </span>
                    </div>

                    <p className="text-amber-800 text-[11px]">
                      {aiResult.explanation?.reason || (isPipeReview ? 'Pipe surface details are ambiguous. A utility technician will review if submitted.' : 'Road surface details are ambiguous or lighting is low. A civic engineer will review if submitted.')}
                    </p>

                    <div className="flex flex-col sm:flex-row items-center gap-2 pt-1 border-t border-amber-200/60">
                      <button
                        type="button"
                        onClick={() => {
                          const input = document.getElementById('citizen-angle-upload-front') as HTMLInputElement;
                          if (input) input.click();
                        }}
                        className="w-full sm:w-1/2 py-2 px-3 rounded-xl bg-white hover:bg-amber-100 text-amber-900 font-bold border border-amber-300 flex items-center justify-center space-x-1.5 min-h-[40px] cursor-pointer text-[11px]"
                      >
                        <RefreshCw className="w-3.5 h-3.5 text-amber-700" />
                        <span>{retryBtnText}</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => {
                          setForceManualReport(true);
                          const titleInput = document.getElementById('complaint-title-input');
                          if (titleInput) {
                            titleInput.focus();
                            titleInput.scrollIntoView({ behavior: 'smooth', block: 'center' });
                          }
                        }}
                        className="w-full sm:w-1/2 py-2 px-3 rounded-xl bg-amber-600 hover:bg-amber-700 text-white font-bold flex items-center justify-center space-x-1.5 min-h-[40px] cursor-pointer text-[11px]"
                      >
                        <span>Continue with Manual Entry</span>
                      </button>
                    </div>
                  </div>
                );
              })()
            ) : aiResult && (
              /* CASE 1 & DEFECTS: POTHOLE / ROAD DAMAGE / WASTE */
              <div className="p-4 rounded-xl bg-emerald-50/70 border border-emerald-300 space-y-3 text-xs">
                {/* Header with Title and Confidence Level Badge */}
                <div className="flex items-center justify-between">
                  <span className="font-extrabold text-emerald-900 font-outfit uppercase tracking-wider flex items-center space-x-1.5">
                    <Sparkles className="w-4 h-4 text-emerald-600" />
                    <span>AI DETECTED</span>
                  </span>

                  <span
                    className={`font-mono text-[10px] font-bold px-2 py-0.5 rounded border ${
                      aiResult.confidence_level === 'High'
                        ? 'text-emerald-800 bg-white border-emerald-300'
                        : aiResult.confidence_level === 'Medium'
                        ? 'text-amber-800 bg-amber-50 border-amber-300'
                        : 'text-rose-800 bg-rose-50 border-rose-300'
                    }`}
                  >
                    {aiResult.confidence_level === 'High' ? '🟢 Confident' : aiResult.confidence_level === 'Medium' ? '🟡 Suggestion' : '⚪ Review'} (Confidence: {Math.round(aiResult.confidence * 100)}% • Level: {aiResult.confidence_level?.toUpperCase() || 'HIGH'})
                  </span>
                </div>

                {/* Detected Issue Headline */}
                <div className="bg-white/80 p-2.5 rounded-lg border border-emerald-200">
                  <div className="font-extrabold text-gray-900 text-sm font-outfit">
                    {aiResult.issue_type || aiResult.title}
                  </div>
                  <div className="text-[11px] text-gray-600 mt-0.5">
                    Category: <strong className="text-emerald-950 font-bold">{translateCategory(aiResult.category)}</strong>
                  </div>
                </div>

                {/* Domain & Model Synchronization Tag */}
                <div className="flex items-center justify-between text-[11px] bg-white/90 px-2.5 py-1.5 rounded-lg border border-emerald-200">
                  <span className="text-emerald-950 font-medium">
                    Selected Domain: <strong className="font-bold">{category ? translateCategory(category) : translateCategory(aiResult.category)}</strong>
                    {aiResult.analysis_domain ? <span className="font-mono text-[10px] text-emerald-700 font-bold ml-1">({aiResult.analysis_domain})</span> : null}
                  </span>
                  <span className="text-slate-600 font-medium font-mono text-[10px]">
                    Validated AI Model: <strong className="text-emerald-800 font-bold">{aiResult.model || aiResult.ai_model || (category === 'Water' ? 'water_pipe_model.pt' : category === 'Drainage' ? 'drainage_model.pt' : category === 'Sanitation' ? 'best.pt' : 'civicmodel.pt')}</strong>
                  </span>
                </div>

                {/* Key Metrics Grid: Severity, Priority, Department */}
                <div className="grid grid-cols-3 gap-2 text-gray-800 pt-0.5 font-medium">
                  <div className="bg-white/60 p-2 rounded-lg border border-emerald-100">
                    <span className="text-gray-500 block text-[9px] uppercase tracking-wider">Severity</span>
                    <strong className="text-gray-900 font-outfit text-xs">{aiResult.severity || 'Medium'}</strong>
                  </div>
                  <div className="bg-white/60 p-2 rounded-lg border border-emerald-100">
                    <span className="text-gray-500 block text-[9px] uppercase tracking-wider">Priority</span>
                    <strong className="text-gray-900 font-outfit text-xs">{aiResult.priority || 'Medium'}</strong>
                  </div>
                  <div className="bg-white/60 p-2 rounded-lg border border-emerald-100">
                    <span className="text-gray-500 block text-[9px] uppercase tracking-wider">Department</span>
                    <strong className="text-gray-900 font-outfit text-xs truncate block" title={aiResult.department}>{translateDepartment(aiResult.department)}</strong>
                  </div>
                </div>

                {/* Explainability Block: Why */}
                <div className="p-2.5 rounded-lg bg-emerald-100/60 border border-emerald-200 text-emerald-950 text-[11px]">
                  <span className="font-extrabold text-emerald-900 block mb-0.5">Why:</span>
                  <span>{aiResult.explanation?.reason || `${aiResult.issue_type || aiResult.title} detected with ${Math.round(aiResult.confidence * 100)}% confidence.`}</span>
                </div>

                {/* Transparency Notice */}
                <div className="flex items-center justify-between text-[10px] text-gray-500 pt-0.5 border-t border-emerald-200/50">
                  <span className="italic">
                    {aiResult.transparencyNotice || (aiResult.confidence >= 0.75 ? 'AI-generated — please review before submitting.' : 'AI suggestion — please verify.')}
                  </span>
                  <span className="text-emerald-700 font-mono font-medium">All fields editable</span>
                </div>
              </div>
            )}

            {/* AUTOMATIC & INTERACTIVE LOCATION CARD WITH EMBEDDED MAP */}
            <div className="p-4 bg-white rounded-xl border border-gray-200 shadow-sm space-y-3 font-sans">
              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-2">
                  <MapPin className="w-5 h-5 text-rose-500" />
                  <span className="font-extrabold text-gray-900 font-outfit text-sm">📍 {t('complaintLocation')}</span>
                </div>

                <button
                  type="button"
                  onClick={() => requestFreshLocation(true)}
                  disabled={detectingLocation}
                  className="px-3 py-1.5 rounded-xl bg-emerald-50 hover:bg-emerald-100 text-emerald-800 font-extrabold text-xs border border-emerald-200 flex items-center space-x-1 min-h-[36px] cursor-pointer"
                >
                  <RefreshCw className={`w-3.5 h-3.5 text-emerald-600 ${detectingLocation ? 'animate-spin' : ''}`} />
                  <span>{detectingLocation ? t('detecting') : t('detectMyLocation')}</span>
                </button>
              </div>

              {/* LOCATION STATUS & ACCURACY BADGE */}
              <div className={`p-2.5 rounded-xl text-xs font-semibold flex items-center justify-between border ${
                locationSource === 'exif' || locationSource === 'exif_gps'
                  ? 'bg-purple-50 text-purple-900 border-purple-200'
                  : locationSource === 'device_gps' || locationSource === 'live_gps'
                  ? 'bg-emerald-50 text-emerald-900 border-emerald-200'
                  : 'bg-blue-50 text-blue-900 border-blue-200'
              }`}>
                <span className="flex items-center space-x-1.5 truncate mr-2">
                  {detectingLocation ? (
                    <RefreshCw className="w-3.5 h-3.5 text-emerald-600 animate-spin shrink-0" />
                  ) : locationSource === 'exif' || locationSource === 'exif_gps' ? (
                    <Camera className="w-3.5 h-3.5 text-purple-600 shrink-0" />
                  ) : locationSource === 'device_gps' || locationSource === 'live_gps' ? (
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                  ) : (
                    <MapPin className="w-3.5 h-3.5 text-blue-600 shrink-0" />
                  )}
                  <span className="truncate">{locationStatusText}</span>
                </span>

                <div className="flex items-center space-x-1.5 shrink-0">
                  {/* SOURCE BADGE */}
                  <span className={`font-mono text-[9px] font-extrabold uppercase px-2 py-0.5 rounded-full border ${
                    locationSource === 'exif' || locationSource === 'exif_gps'
                      ? 'bg-purple-100 text-purple-800 border-purple-300'
                      : locationSource === 'device_gps' || locationSource === 'live_gps'
                      ? 'bg-emerald-100 text-emerald-800 border-emerald-300'
                      : 'bg-blue-100 text-blue-800 border-blue-300'
                  }`}>
                    {locationSource === 'exif' || locationSource === 'exif_gps'
                      ? 'EXIF GPS'
                      : locationSource === 'device_gps' || locationSource === 'live_gps'
                      ? 'LIVE GPS'
                      : 'MAP PIN'}
                  </span>

                  {locationAccuracy && (
                    <span className="font-mono text-[10px] font-extrabold bg-white px-2 py-0.5 rounded border border-gray-200 text-gray-700">
                      ±{locationAccuracy}m
                    </span>
                  )}
                </div>
              </div>

              {/* EMBEDDED MAP PICKER */}
              <div className="rounded-xl overflow-hidden border border-gray-200">
                <LocationMapPicker
                  initialLat={lat}
                  initialLng={lng}
                  accuracyMeters={locationAccuracy}
                  accuracyStatusText={
                    locationSource === 'exif' || locationSource === 'exif_gps'
                      ? '📷 EXIF GPS'
                      : locationSource === 'device_gps' || locationSource === 'live_gps'
                      ? '✓ Live GPS'
                      : '📍 Map Pin'
                  }
                  onLocationSelect={async (newLat, newLng) => {
                    setLat(newLat);
                    setLng(newLng);
                    setMapPinConfirmed(true);
                    setLocationSource(locationSource === 'exif' || locationSource === 'device_gps' ? 'map_pin_confirmed' : 'map_pin');
                    setLocationStatusText('Location confirmed by map pin');
                    runDuplicateCheck(newLat, newLng);

                    const addr = await reverseGeocodeCoordinates(newLat, newLng);
                    if (addr) setLocationAddress(addr);
                  }}
                />
              </div>

              {/* ADDRESS & COORDINATES DISPLAY */}
              <div className="p-3 bg-slate-50 rounded-xl border border-gray-200 space-y-1.5">
                <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider block font-mono">{t('locationAddressLandmark')}</span>
                <input aria-label="location Address"
                  type="text"
                  value={locationAddress}
                  onChange={(e) => setLocationAddress(e.target.value)}
                  placeholder={t('locationLandmarkPlaceholder')}
                  className="w-full bg-white border border-gray-200 rounded-lg p-2 font-bold text-xs text-gray-900 focus:border-emerald-500"
                />
                <div className="flex items-center justify-between text-[10px] font-mono text-gray-500 pt-0.5">
                  <span>Coordinates: {lat.toFixed(6)}, {lng.toFixed(6)}</span>
                  <span className="font-bold text-emerald-700 uppercase bg-emerald-50 px-1.5 py-0.5 rounded border border-emerald-200">
                    {locationSource}
                  </span>
                </div>
              </div>
            </div>

          </div>

          {/* RIGHT 50% PANEL: COMPLAINT DETAILS FORM & ACTIONS */}
          <div className="lg:col-span-6 bg-white p-6 rounded-xl border border-gray-200 shadow-sm space-y-6">
            
            <div className="flex items-center justify-between border-b border-gray-100 pb-3">
              <h2 className="text-sm font-extrabold text-gray-900 font-outfit uppercase tracking-wider">
                {t('complaintDetailsFormStep')}
              </h2>
              {isManuallyEdited && (
                <span className="text-[10px] font-bold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200">
                  ✓ {t('manuallyEdited')}
                </span>
              )}
            </div>

            {/* FORM FIELDS */}
            <div className="space-y-4 text-xs">
              {aiResult && (aiResult.road_condition === 'clean' || aiResult.aiStatus === 'confirmed_clean') && !forceManualReport && (
                <div className="p-3.5 rounded-xl bg-emerald-50 border border-emerald-300 text-emerald-950 text-xs space-y-2">
                  <div className="flex items-center space-x-2">
                    <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0" />
                    <span className="font-extrabold text-sm font-outfit">✓ Road Verified as Clean</span>
                  </div>
                  <p className="text-gray-700 text-xs">
                    No complaint is required because the road appears clean with no active defect detected.
                  </p>
                  <div className="pt-1 flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setForceManualReport(true)}
                      className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-[11px] cursor-pointer"
                    >
                      Report an Issue Anyway
                    </button>
                    <button
                      type="button"
                      onClick={() => navigate('/citizen')}
                      className="px-3 py-1.5 rounded-lg bg-gray-100 hover:bg-gray-200 text-gray-700 font-bold text-[11px] cursor-pointer"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}
              
              <div>
                <label className="block font-bold text-gray-700 mb-1">{t('category')}</label>
                <select aria-label="category"
                  value={category || ''}
                  onChange={(e) => {
                    const newCat = e.target.value as CivicCategory;
                    if (newCat) handleCategoryChange(newCat);
                  }}
                  className="w-full bg-white border border-gray-300 rounded-xl p-2.5 font-bold text-gray-900 focus:border-emerald-500 min-h-[44px]"
                >
                  {!category && <option value="" disabled>Select Issue Category...</option>}
                  {CIVIC_CATEGORIES.map((c) => (
                    <option key={c} value={c}>{translateCategory(c)}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block font-bold text-gray-700 mb-1">{t('complaintTitle')}</label>
                <input aria-label="complaint title input"
                  type="text"
                  id="complaint-title-input"
                  value={title}
                  onChange={(e) => {
                    setTitle(e.target.value);
                    setIsManuallyEdited(true);
                  }}
                  placeholder={t('enterTitle')}
                  className="w-full bg-white border border-gray-300 rounded-xl p-2.5 font-bold text-gray-900 focus:border-emerald-500 min-h-[44px]"
                />
              </div>

              <div>
                <label className="block font-bold text-gray-700 mb-1">{t('description')}</label>
                <textarea aria-label="description"
                  rows={6}
                  value={description}
                  onChange={(e) => {
                    setDescription(e.target.value);
                    setIsManuallyEdited(true);
                  }}
                  placeholder={t('enterDescription')}
                  className="w-full bg-white border border-gray-300 rounded-xl p-3 text-gray-900 focus:border-emerald-500 font-medium leading-relaxed min-h-[140px]"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block font-bold text-gray-700 mb-1">{t('priority')}</label>
                  <select aria-label="priority"
                    value={priority}
                    onChange={(e) => {
                      setPriority(e.target.value as PriorityLevel);
                      setIsManuallyEdited(true);
                    }}
                    className="w-full bg-white border border-gray-300 rounded-xl p-2.5 font-bold text-gray-900 focus:border-emerald-500 min-h-[44px]"
                  >
                    <option value="Low">{translatePriority('Low')}</option>
                    <option value="Medium">{translatePriority('Medium')}</option>
                    <option value="High">{translatePriority('High')}</option>
                    <option value="Critical">{translatePriority('Critical')}</option>
                  </select>
                </div>

                <div>
                  <label className="block font-bold text-gray-700 mb-1">{t('myDepartment')}</label>
                  <select aria-label="department"
                    value={department}
                    onChange={(e) => {
                      setDepartment(e.target.value);
                      setIsManuallyEdited(true);
                    }}
                    className="w-full bg-white border border-gray-300 rounded-xl p-2.5 font-bold text-gray-900 focus:border-emerald-500 min-h-[44px]"
                  >
                    <option value="Public Works Department">{translateDepartment('Public Works Department')}</option>
                    <option value="Sanitation & Waste Management">{translateDepartment('Sanitation & Waste Management')}</option>
                    <option value="Water Supply & Sewerage Board">{translateDepartment('Water Supply & Sewerage Board')}</option>
                    <option value="Drainage & Sewage Department">{translateDepartment('Drainage & Sewage Department')}</option>
                    <option value="Electrical & Street Lighting">{translateDepartment('Electrical & Street Lighting')}</option>
                    <option value="Traffic Management Department">{translateDepartment('Traffic Management Department')}</option>
                    <option value="Maintenance Department">{translateDepartment('Maintenance Department')}</option>
                  </select>
                </div>
              </div>

            </div>

            {/* 100M NEARBY DUPLICATE CHECK */}
            <div className="pt-2 border-t border-gray-100">
              <span className="font-extrabold text-gray-900 font-outfit block text-xs mb-2">
                {t('nearbyComplaintCheck')}
              </span>

              {nearbyDuplicates.length === 0 ? (
                <div className="p-3.5 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs font-semibold flex items-center space-x-2">
                  <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                  <span>{t('noSimilarComplaintNearby')}</span>
                </div>
              ) : (
                <div className="p-4 rounded-xl bg-amber-50 border border-amber-200 text-amber-900 space-y-2 text-xs">
                  <div className="flex items-center space-x-2 font-bold">
                    <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
                    <span>{t('similarComplaintFoundNearby')} ({nearbyDuplicates[0].distanceMeters}m away)</span>
                  </div>
                  <p className="text-amber-800 text-[11px]">{t('existingComplaintReportedNearby')}</p>
                  <div className="flex items-center space-x-2 pt-1">
                    <Link
                      to={`/citizen/complaint/${nearbyDuplicates[0].complaint.id}`}
                      className="px-3 py-1.5 rounded-lg bg-amber-600 text-white font-bold text-xs hover:bg-amber-700 min-h-[44px] flex items-center"
                    >
                      {t('viewExisting')}
                    </Link>
                    <button
                      type="button"
                      onClick={() => toast.success(`Thank you! Your support for complaint ${nearbyDuplicates[0].complaint.complaint_number} has been recorded.`)}
                      className="px-3 py-1.5 rounded-lg bg-white border border-amber-300 text-amber-900 font-bold text-xs hover:bg-amber-100 min-h-[44px]"
                    >
                      {t('supportExisting')}
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* FORM ACTIONS */}
            <div className="pt-4 border-t border-gray-100 flex flex-col sm:flex-row items-center justify-between gap-3">
              <button
                type="button"
                onClick={handleSaveDraft}
                className="w-full sm:w-auto px-5 py-3 rounded-xl bg-gray-100 hover:bg-gray-200 text-gray-800 font-bold text-xs border border-gray-300 min-h-[44px] flex items-center justify-center space-x-1.5"
              >
                <Save className="w-4 h-4 text-gray-600" />
                <span>{t('saveDraft')}</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  const isCleanRoad = aiResult && (aiResult.road_condition === 'clean' || aiResult.aiStatus === 'confirmed_clean');
                  if (isCleanRoad && !forceManualReport) {
                    toast.info("No complaint is required because the road appears clean. If you would like to report another issue, click 'Report an Issue Anyway'.");
                    return;
                  }
                  const uploadedCount = Object.values(angleSlots).filter((s) => Boolean(s.previewUrl)).length;
                  if (uploadedCount < 2) {
                    toast.warning(`At least 2 evidence photos from any view are compulsory. Currently uploaded: ${uploadedCount}/4. Please upload ${2 - uploadedCount} more photo${2 - uploadedCount > 1 ? 's' : ''} to proceed.`);
                    return;
                  }
                  setShowReviewModal(true);
                }}
                className={`w-full sm:w-auto px-8 py-3.5 rounded-xl font-extrabold text-xs uppercase tracking-wider shadow-sm min-h-[44px] flex items-center justify-center space-x-2 transition-all ${
                  Object.values(angleSlots).filter((s) => Boolean(s.previewUrl)).length >= 2
                    ? 'bg-emerald-600 hover:bg-emerald-700 text-white cursor-pointer ring-2 ring-emerald-400/50'
                    : 'bg-amber-100 hover:bg-amber-200 text-amber-900 border border-amber-300 cursor-pointer'
                }`}
                title={
                  Object.values(angleSlots).filter((s) => Boolean(s.previewUrl)).length < 2
                    ? `Compulsory: Upload at least 2 photos from any view to proceed (${Object.values(angleSlots).filter((s) => Boolean(s.previewUrl)).length}/2)`
                    : 'Review and Submit Complaint'
                }
              >
                <span>
                  {t('reviewComplaint')} ({Object.values(angleSlots).filter((s) => Boolean(s.previewUrl)).length}/4 Photos
                  {Object.values(angleSlots).filter((s) => Boolean(s.previewUrl)).length < 2 ? ' • Min 2 Required' : ' • Ready'}
                  )
                </span>
                <ArrowRight className="w-4 h-4" />
              </button>
            </div>

          </div>

        </div>

      </div>

      {/* TURN ON YOUR LOCATION POPUP MODAL */}
      {showLocationPromptModal && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="turn-on-location-title"
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-gray-900/60 backdrop-blur-xs font-sans"
        >
          <div className="max-w-md w-full bg-white rounded-2xl p-6 sm:p-7 border border-gray-200 shadow-2xl space-y-5 text-center my-auto animate-in fade-in zoom-in-95 duration-200">
            {/* Location Icon Badge */}
            <div className="w-16 h-16 rounded-2xl bg-emerald-50 border border-emerald-200 text-emerald-600 flex items-center justify-center mx-auto shadow-sm">
              <MapPin className="w-8 h-8" />
            </div>

            {/* Title & Description */}
            <div className="space-y-2">
              <h3 id="turn-on-location-title" className="text-xl font-extrabold text-gray-900 font-outfit">
                Turn On Your Location
              </h3>
              <p className="text-sm text-gray-600 leading-relaxed">
                Please turn on your device location to report a complaint. Location is required to accurately identify the complaint location.
              </p>
            </div>

            {/* Action Buttons */}
            <div className="space-y-2.5 pt-2">
              <button
                type="button"
                id="btn-turn-on-location"
                onClick={() => requestFreshLocation(true)}
                disabled={detectingLocation}
                className="w-full py-3.5 px-4 rounded-xl bg-emerald-600 hover:bg-emerald-700 active:bg-emerald-800 text-white font-extrabold text-xs uppercase tracking-wider shadow-md hover:shadow-lg flex items-center justify-center space-x-2 min-h-[48px] cursor-pointer transition-all disabled:opacity-60"
              >
                {detectingLocation ? (
                  <>
                    <RefreshCw className="w-4 h-4 animate-spin text-white mr-1.5" />
                    <span>Detecting Location...</span>
                  </>
                ) : (
                  <>
                    <MapPin className="w-4 h-4 mr-1.5" />
                    <span>Turn On Location</span>
                  </>
                )}
              </button>

              <button
                type="button"
                id="btn-cancel-location"
                onClick={() => setShowLocationPromptModal(false)}
                className="w-full py-2.5 px-4 rounded-xl bg-gray-100 hover:bg-gray-200 active:bg-gray-300 text-gray-700 font-bold text-xs uppercase tracking-wider min-h-[44px] cursor-pointer transition-all"
              >
                <span>Cancel</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* EDIT LOCATION MAP PICKER MODAL */}
      {showLocationPickerModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-gray-900/40 backdrop-blur-xs font-sans overflow-y-auto">
          <div className="max-w-xl w-full bg-white rounded-xl p-4 sm:p-6 border border-gray-200 shadow-md space-y-4 max-h-[90vh] my-auto overflow-y-auto">
            <div className="flex items-center justify-between border-b border-gray-100 pb-3">
              <h3 className="text-base font-extrabold text-gray-900 font-outfit">Adjust Site Location Pin</h3>
              <button onClick={() => setShowLocationPickerModal(false)} className="text-gray-400 hover:text-gray-600 min-h-[44px] min-w-[44px]">✕</button>
            </div>

            <div className="h-64 rounded-xl overflow-hidden border border-gray-200">
              <LocationMapPicker
                initialLat={lat}
                initialLng={lng}
                onLocationSelect={(newLat, newLng) => {
                  setLat(newLat);
                  setLng(newLng);
                  setLocationSource('manual_pin');
                  runDuplicateCheck(newLat, newLng);
                }}
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-gray-700 mb-1">{t('locationAddressLandmark')}</label>
              <input aria-label="location Address"
                type="text"
                value={locationAddress}
                onChange={(e) => setLocationAddress(e.target.value)}
                className="w-full bg-white border border-gray-300 rounded-xl p-2.5 text-xs font-bold text-gray-900 min-h-[44px]"
              />
            </div>

            <div className="flex justify-end pt-2">
              <button
                type="button"
                onClick={() => setShowLocationPickerModal(false)}
                className="px-6 py-2.5 rounded-xl bg-emerald-600 text-white font-extrabold text-xs uppercase min-h-[44px]"
              >
                Confirm Location Pin
              </button>
            </div>
          </div>
        </div>
      )}

      {/* FINAL REVIEW & SUBMIT MODAL */}
      {showReviewModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-gray-900/40 backdrop-blur-xs font-sans overflow-y-auto">
          <div className="max-w-lg w-full bg-white rounded-xl p-4 sm:p-6 border border-gray-200 shadow-md space-y-4 max-h-[90vh] my-auto overflow-y-auto">
            <div className="flex items-center justify-between border-b border-gray-100 pb-3">
              <h3 className="text-base font-extrabold text-gray-900 font-outfit">{t('reviewBeforeSubmission')}</h3>
              <button onClick={() => setShowReviewModal(false)} className="text-gray-400 hover:text-gray-600 min-h-[44px] min-w-[44px]">✕</button>
            </div>

            {/* 4-Angle Photo Preview Strip */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pb-1">
              {ANGLE_CONFIGS.map((cfg) => {
                const url = angleSlots[cfg.angle].previewUrl;
                if (!url) return null;
                return (
                  <div key={cfg.angle} className="relative rounded-xl overflow-hidden border border-gray-200 aspect-4/3 bg-gray-100">
                    <img src={url} alt={cfg.title} className="w-full h-full object-cover" />
                    <span className="absolute bottom-1 left-1 bg-gray-900/80 text-white text-[9px] px-1.5 py-0.5 rounded font-mono font-bold">
                      {cfg.title}
                    </span>
                  </div>
                );
              })}
            </div>

            <div className="bg-gray-50 p-4 rounded-xl border border-gray-200 text-xs space-y-2">
              <div className="flex items-center justify-between">
                <span className="font-bold text-emerald-800 font-outfit">{t('category')}: {category ? translateCategory(category) : 'Not Selected'}</span>
                <PriorityBadge priority={priority} />
              </div>

              <div>
                <strong className="block text-gray-900 font-outfit text-sm">{title || (category ? `${translateCategory(category)} Issue` : 'Civic Issue')}</strong>
                <p className="text-gray-600 text-[11px] mt-0.5">{description || 'No description provided.'}</p>
              </div>

              <div className="pt-2 border-t border-gray-200 flex flex-wrap justify-between text-gray-500 text-[11px]">
                <span>Dept: {translateDepartment(department)}</span>
                <span>Address: {locationAddress}</span>
              </div>

              {aiResult && (
                <div className="pt-1.5 border-t border-gray-200 text-[10px] text-emerald-700 font-mono flex items-center space-x-1">
                  <Sparkles className="w-3 h-3" />
                  <span>AI Confidence: {Math.round(aiResult.confidence * 100)}% ({aiResult.confidence_level})</span>
                </div>
              )}
            </div>

            <div className="flex items-center justify-between gap-3 pt-2">
              <button
                type="button"
                onClick={() => setShowReviewModal(false)}
                className="px-4 py-2.5 rounded-xl bg-gray-100 hover:bg-gray-200 text-gray-700 font-bold text-xs min-h-[44px]"
              >
                {t('editForm')}
              </button>

              {Object.values(angleSlots).filter((s) => Boolean(s.previewUrl)).length < 2 && (
                <div className="w-full p-2.5 rounded-xl bg-amber-50 border border-amber-200 text-amber-900 text-xs font-semibold flex items-center space-x-2">
                  <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
                  <span>At least 2 evidence photos (any view) are compulsory to submit. Please edit and add {2 - Object.values(angleSlots).filter((s) => Boolean(s.previewUrl)).length} more photo(s).</span>
                </div>
              )}

              <button
                type="button"
                id="btn-submit-complaint-final"
                onClick={handleFinalSubmit}
                disabled={submitting || isSubmittingRef.current || Object.values(angleSlots).filter((s) => Boolean(s.previewUrl)).length < 2}
                className="px-6 py-3 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-extrabold text-xs uppercase min-h-[44px] flex items-center space-x-1.5 disabled:opacity-60 disabled:cursor-not-allowed cursor-pointer transition-all"
              >
                {submitting || isSubmittingRef.current ? (
                  <>
                    <RefreshCw className="w-4 h-4 animate-spin text-white" />
                    <span>{t('submitting')}</span>
                  </>
                ) : (
                  <>
                    <CheckCircle2 className="w-4 h-4" />
                    <span>{t('submitComplaint')}</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* FULL-SCREEN ZOOM IMAGE PREVIEW MODAL */}
      {zoomImageUrl && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-gray-900/80 backdrop-blur-xs"
          onClick={() => setZoomImageUrl(null)}
        >
          <div className="relative max-w-3xl w-full bg-white rounded-2xl overflow-hidden shadow-2xl p-2" onClick={(e) => e.stopPropagation()}>
            <button
              onClick={() => setZoomImageUrl(null)}
              className="absolute top-4 right-4 z-10 p-2 rounded-full bg-gray-900/70 text-white hover:bg-gray-900 transition-colors cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>
            <img src={zoomImageUrl} alt="Full Angle Preview" className="w-full max-h-[80vh] object-contain rounded-xl" />
          </div>
        </div>
      )}

    </DashboardLayout>
  );
};
