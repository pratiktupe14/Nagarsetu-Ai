/**
 * Centralized API URL Resolver for NAGARSETU 3.1
 * Resolves API URL dynamically in both Development (localhost) and Vercel Production.
 */
export const getApiUrl = (): string => {
  const isBrowser = typeof window !== 'undefined';
  const isLocalhost = isBrowser && (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1');
  const rawEnvUrl = (import.meta.env.VITE_API_URL || import.meta.env.VITE_API_BASE_URL || '').trim();

  // Normalize protocol & strip trailing slash and optional trailing /api
  let envUrl = rawEnvUrl;
  if (envUrl && !envUrl.startsWith('http://') && !envUrl.startsWith('https://')) {
    envUrl = `https://${envUrl}`;
  }
  envUrl = envUrl.replace(/\/+$/, '').replace(/\/api$/, '');

  // In production browser environments (Vercel):
  if (isBrowser && !isLocalhost) {
    // If an invalid localhost URL is provided, ignore it
    if (envUrl && (envUrl.includes('localhost') || envUrl.includes('127.0.0.1'))) {
      envUrl = '';
    }
    // Return verified production backend if envUrl is set
    if (envUrl) {
      return envUrl;
    }
    // Unified full-stack deployment routes /api directly to same-origin serverless functions
    return '';
  }

  // Local development
  if (envUrl) {
    return envUrl;
  }
  if (isLocalhost) {
    return 'http://localhost:5000';
  }
  return '';
};

export const getAiServiceUrl = (): string => {
  const envAiUrl = import.meta.env.VITE_AI_SERVICE_URL;
  if (envAiUrl && envAiUrl.trim() !== '') {
    return envAiUrl.trim().replace(/\/$/, '');
  }
  const mainApi = getApiUrl();
  return mainApi ? `${mainApi}/api/ai` : '/api/ai';
};

export const getNoCacheHeaders = (additionalHeaders: Record<string, string> = {}): Record<string, string> => {
  const token = sessionStorage.getItem('nagarsetu_token') || localStorage.getItem('nagarsetu_token') || '';
  return {
    'Cache-Control': 'no-cache, no-store, must-revalidate',
    'Pragma': 'no-cache',
    'Expires': '0',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...additionalHeaders
  };
};

export const handleApiResponse = async (res: Response): Promise<any> => {
  if (res.status === 429) {
    throw new Error('Rate limit exceeded. Please wait a moment before trying again.');
  }
  if (!res.ok) {
    const errorBody = await res.json().catch(() => ({}));
    throw new Error(errorBody.error || errorBody.message || `API Error (${res.status})`);
  }
  return res.json();
};
