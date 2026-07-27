import { supabase } from "@/integrations/supabase/client";

type SessionReadResult = Awaited<ReturnType<typeof supabase.auth.getSession>>;
type SessionRefreshResult = Awaited<ReturnType<typeof supabase.auth.refreshSession>>;

type SessionReader = () => Promise<SessionReadResult>;
type SessionRefresher = () => Promise<SessionRefreshResult>;

let sessionReadInFlight: Promise<SessionReadResult> | null = null;
let sessionRefreshInFlight: Promise<SessionRefreshResult> | null = null;
let authOperationInFlight: Promise<unknown> | null = null;

function runAuthOperation<T>(operation: () => Promise<T>): Promise<T> {
  const start = () => {
    try {
      return operation();
    } catch (error) {
      return Promise.reject(error);
    }
  };
  const request = authOperationInFlight
    ? authOperationInFlight.then(start, start)
    : start();
  authOperationInFlight = request;
  const clear = () => {
    if (authOperationInFlight === request) authOperationInFlight = null;
  };
  void request.then(clear, clear);
  return request;
}

export function getSessionSingleFlight(
  readSession: SessionReader = () => supabase.auth.getSession(),
): Promise<SessionReadResult> {
  if (sessionReadInFlight) return sessionReadInFlight;

  const request = runAuthOperation(readSession);
  sessionReadInFlight = request;
  const clear = () => {
    if (sessionReadInFlight === request) sessionReadInFlight = null;
  };
  void request.then(clear, clear);
  return request;
}

export function refreshSessionSingleFlight(
  refreshSession: SessionRefresher = () => supabase.auth.refreshSession(),
): Promise<SessionRefreshResult> {
  if (sessionRefreshInFlight) return sessionRefreshInFlight;

  const request = runAuthOperation(refreshSession);
  sessionRefreshInFlight = request;
  const clear = () => {
    if (sessionRefreshInFlight === request) sessionRefreshInFlight = null;
  };
  void request.then(clear, clear);
  return request;
}
