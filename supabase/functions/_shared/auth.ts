import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

export async function getAuthenticatedClient(req: Request) {
  const authHeader = req.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return { client: null, userId: null, error: 'Missing authorization' };
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY')!;

  // Create client with the user's JWT forwarded in all requests (for RLS)
  const client = createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: { Authorization: authHeader } },
  });

  // Pass token explicitly → forces HTTP call to /auth/v1/user on Supabase Auth server.
  // This works regardless of JWT algorithm (ES256, HS256) and requires no local secret.
  const token = authHeader.slice('Bearer '.length);
  const { data: { user }, error } = await client.auth.getUser(token);
  if (error || !user) {
    return { client: null, userId: null, error: 'Unauthorized' };
  }

  return { client, userId: user.id, error: null };
}

export function getServiceClient() {
  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  return createClient(supabaseUrl, serviceRoleKey);
}
