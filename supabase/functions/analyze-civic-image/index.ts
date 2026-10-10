// Supabase Edge Function: analyze-civic-image
// Local Civic AI Routing - Gemini completely decommissioned

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  // NAGARSETU now uses local YOLOv8 + LangGraph computer-vision pipeline
  return new Response(
    JSON.stringify({
      success: false,
      status: 'migrated_to_local_ai',
      message: 'Direct Gemini Edge Function is decommissioned. All image vision requests are routed via NAGARSETU Local AI Service (POST /api/ai/analyze).'
    }),
    { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
  );
});
