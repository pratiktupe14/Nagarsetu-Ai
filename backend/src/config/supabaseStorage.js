const { createClient } = require('@supabase/supabase-js');

function getValidSupabaseConfig() {
  const envUrl = (
    process.env.SUPABASE_URL ||
    process.env.VITE_SUPABASE_URL ||
    process.env.PUBLIC_SUPABASE_URL ||
    ''
  ).trim();

  const envKey = (
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_ANON_KEY ||
    process.env.VITE_SUPABASE_ANON_KEY ||
    ''
  ).trim();

  const validUrl = (envUrl && !envUrl.includes('your-supabase') && !envUrl.includes('your-project') && !envUrl.includes('placeholder') && !envUrl.includes('example'))
    ? envUrl
    : '';

  const validKey = (envKey && !envKey.includes('your_supabase') && !envKey.includes('your-supabase') && !envKey.includes('your_service_role') && !envKey.includes('placeholder') && !envKey.includes('here') && envKey.length > 20)
    ? envKey
    : '';

  return { url: validUrl, key: validKey };
}

const { url: supabaseUrl, key: supabaseKey } = getValidSupabaseConfig();

let supabase = null;
if (supabaseUrl && supabaseKey) {
  try {
    supabase = createClient(supabaseUrl, supabaseKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false
      }
    });
  } catch (e) {
    console.warn('[SUPABASE STORAGE] Initialization note:', e.message);
  }
}

/**
 * Uploads a file buffer to Supabase Storage bucket (default 'issues')
 * and returns the full public HTTPS URL.
 * 
 * @param {Buffer} buffer 
 * @param {string} filename 
 * @param {string} mimetype 
 * @param {string} bucketName 
 * @returns {Promise<{ publicUrl: string, filePath: string }>}
 */
async function uploadBufferToSupabase(buffer, filename, mimetype = 'image/jpeg', bucketName = 'issues') {
  if (!supabase) {
    throw new Error('Supabase client is not configured on the backend. Check SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY environment variables.');
  }

  const cleanFilename = `${Date.now()}_${filename.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
  const filePath = `uploads/${cleanFilename}`;

  const { data, error } = await supabase.storage
    .from(bucketName)
    .upload(filePath, buffer, {
      contentType: mimetype,
      cacheControl: '3600',
      upsert: true
    });

  if (error) {
    console.error('[SUPABASE STORAGE ERROR]', error.message);
    throw new Error(`Supabase Storage upload failed: ${error.message}`);
  }

  const { data: publicUrlData } = supabase.storage
    .from(bucketName)
    .getPublicUrl(filePath);

  if (!publicUrlData || !publicUrlData.publicUrl) {
    throw new Error('Failed to retrieve public URL from Supabase Storage.');
  }

  return {
    publicUrl: publicUrlData.publicUrl,
    filePath: data.path || filePath
  };
}

module.exports = {
  supabase,
  uploadBufferToSupabase
};
