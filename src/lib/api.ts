import { supabase } from "@/integrations/supabase/client";

const PROJECT_ID = import.meta.env.VITE_SUPABASE_PROJECT_ID;
const BASE_URL = `https://${PROJECT_ID}.supabase.co/functions/v1`;

async function getAuthHeaders(): Promise<Record<string, string>> {
  const { data: { session } } = await supabase.auth.getSession();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (session?.access_token) {
    headers["Authorization"] = `Bearer ${session.access_token}`;
  }
  return headers;
}

export async function apiGet<T = any>(
  fn: string,
  endpoint: string,
  params?: Record<string, string>
): Promise<T> {
  const headers = await getAuthHeaders();
  const url = new URL(`${BASE_URL}/${fn}/${endpoint}`);
  if (params) {
    Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  }
  const res = await fetch(url.toString(), { headers });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `API error ${res.status}`);
  }
  return res.json();
}

export async function apiPost<T = any>(
  fn: string,
  endpoint: string,
  body: Record<string, any>
): Promise<T> {
  const headers = await getAuthHeaders();
  const res = await fetch(`${BASE_URL}/${fn}/${endpoint}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || `API error ${res.status}`);
  }
  return res.json();
}

export async function apiPatch<T = any>(
  fn: string,
  endpoint: string,
  body: Record<string, any>
): Promise<T> {
  const headers = await getAuthHeaders();
  const res = await fetch(`${BASE_URL}/${fn}/${endpoint}`, {
    method: "PATCH",
    headers,
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || `API error ${res.status}`);
  }
  return res.json();
}

export async function apiDelete<T = any>(
  fn: string,
  endpoint: string,
  params?: Record<string, string>
): Promise<T> {
  const headers = await getAuthHeaders();
  const url = new URL(`${BASE_URL}/${fn}/${endpoint}`);
  if (params) {
    Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  }
  const res = await fetch(url.toString(), { method: "DELETE", headers });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || `API error ${res.status}`);
  }
  return res.json();
}
