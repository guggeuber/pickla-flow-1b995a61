export const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, x-pickla-request-id, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
};

export function jsonResponse(data: unknown, status = 200, cacheSeconds = 0) {
  const headers: Record<string, string> = {
    ...corsHeaders,
    'Content-Type': 'application/json',
  };
  if (cacheSeconds > 0) {
    headers['Cache-Control'] = `public, max-age=${cacheSeconds}, s-maxage=${cacheSeconds}`;
  }
  return new Response(JSON.stringify(data), { status, headers });
}

export function privateJsonResponse(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      ...corsHeaders,
      'Content-Type': 'application/json',
      'Cache-Control': 'private, no-store',
      'Vary': 'Authorization',
    },
  });
}

export function htmlResponse(html: string, status = 200) {
  const body = new Blob([html], { type: 'text/html; charset=utf-8' });
  return new Response(body, {
    status,
    headers: {
      ...corsHeaders,
      'content-type': 'text/html; charset=utf-8',
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
      'Referrer-Policy': 'no-referrer',
    },
  });
}

export function errorResponse(message: string, status = 400) {
  return jsonResponse({ error: message }, status);
}

export function privateErrorResponse(message: string, status = 400) {
  return privateJsonResponse({ error: message }, status);
}
