import { createClient } from '@supabase/supabase-js';
import { getApiUrl } from '../config/apiConfig';

const rawUrl = (import.meta.env.VITE_SUPABASE_URL || '').trim();
const rawKey = (import.meta.env.VITE_SUPABASE_ANON_KEY || '').trim();

// Unconfigured client placeholder to prevent crashes on module evaluation
const PLACEHOLDER_URL = 'https://unconfigured.supabase.co';
const PLACEHOLDER_KEY = 'unconfigured-anon-key';

export const SUPABASE_PROJECT_URL =
  (rawUrl && !rawUrl.includes('placeholder'))
    ? rawUrl
    : '';

export const SUPABASE_ANON_KEY =
  (rawKey && !rawKey.includes('placeholder'))
    ? rawKey
    : '';

export const isSupabaseConfigured = (): boolean => {
  return Boolean(
    rawUrl &&
    rawKey &&
    !rawUrl.includes('placeholder') &&
    !rawKey.includes('placeholder')
  );
};

export const supabase = createClient(
  SUPABASE_PROJECT_URL || PLACEHOLDER_URL,
  SUPABASE_ANON_KEY || PLACEHOLDER_KEY
);

export const isValidUuid = (val?: string | null): boolean => {
  if (!val || typeof val !== 'string') return false;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(val.trim());
};

export const DEFAULT_CIVIC_IMAGE_PLACEHOLDER = '/uploads/civic-default.jpg';

export const getValidImageUrl = (url?: string | null): string => {
  const getDefault = () => {
    const apiBase = getApiUrl();
    return apiBase ? `${apiBase.replace(/\/$/, '')}${DEFAULT_CIVIC_IMAGE_PLACEHOLDER}` : DEFAULT_CIVIC_IMAGE_PLACEHOLDER;
  };

  if (!url || typeof url !== 'string') return getDefault();
  const trimmed = url.trim();
  if (!trimmed || trimmed === '' || trimmed === 'undefined' || trimmed === 'null') {
    return getDefault();
  }
  
  // Full HTTP/HTTPS URLs, Base64 Data URIs, or local blob URLs (from URL.createObjectURL)
  if (trimmed.startsWith('http://') || trimmed.startsWith('https://') || trimmed.startsWith('data:image/') || trimmed.startsWith('blob:')) {
    return trimmed;
  }
  
  // Supabase Storage paths (e.g. "issues/uploads/...", "uploads/...")
  if (SUPABASE_PROJECT_URL && !SUPABASE_PROJECT_URL.includes('placeholder')) {
    const cleanProjectUrl = SUPABASE_PROJECT_URL.replace(/\/$/, '');
    if (trimmed.startsWith('issues/')) {
      return `${cleanProjectUrl}/storage/v1/object/public/${trimmed}`;
    }
    if (trimmed.startsWith('uploads/')) {
      return `${cleanProjectUrl}/storage/v1/object/public/issues/${trimmed}`;
    }
  }

  // Relative backend upload paths
  if (trimmed.startsWith('/uploads/') || trimmed.startsWith('uploads/')) {
    const apiBase = getApiUrl();
    const cleanPath = trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
    if (apiBase) {
      return `${apiBase.replace(/\/$/, '')}${cleanPath}`;
    }
    return cleanPath;
  }
  
  return trimmed;
};



