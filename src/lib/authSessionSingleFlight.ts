import { supabase } from "@/integrations/supabase/client";

type SessionReadResult = Awaited<ReturnType<typeof supabase.auth.getSession>>;
type SessionRefreshResult = Awaited<ReturnType<typeof supabase.auth.refreshSession>>;

type SessionReader = () => Promise<SessionReadResult>;
type SessionRefresher = () => Promise<SessionRefreshResult>;
type LocalSignOut = () => Promise<unknown>;
type TerminalAuthFailureListener = () => void;

export type UnauthorizedRecoveryResult = {
  accessToken: string | null;
  error: unknown | null;
  terminalFailureAlreadyHandled?: boolean;
};

export type UnauthorizedRecoveryDependencies = {
  getSession?: () => Promise<SessionReadResult>;
  refreshSession?: () => Promise<SessionRefreshResult>;
};

let sessionReadInFlight: Promise<SessionReadResult> | null = null;
let sessionRefreshInFlight: Promise<SessionRefreshResult> | null = null;
let authOperationInFlight: Promise<unknown> | null = null;
let unauthorizedRecoveryInFlight: Promise<UnauthorizedRecoveryResult> | null = null;
let terminalSignOutInFlight: Promise<void> | null = null;
let terminalAuthFailureInProgress = false;
const terminalAuthFailureListeners = new Set<TerminalAuthFailureListener>();
const terminallyRejectedAccessTokens = new Set<string>();
const MAX_REMEMBERED_REJECTED_TOKENS = 8;

export function rememberTerminallyRejectedAccessToken(accessToken: string) {
  terminallyRejectedAccessTokens.delete(accessToken);
  terminallyRejectedAccessTokens.add(accessToken);
  if (terminallyRejectedAccessTokens.size > MAX_REMEMBERED_REJECTED_TOKENS) {
    const oldest = terminallyRejectedAccessTokens.values().next().value;
    if (oldest) terminallyRejectedAccessTokens.delete(oldest);
  }
}

function alreadyHandledTerminalFailure(error: unknown): UnauthorizedRecoveryResult {
  return { accessToken: null, error, terminalFailureAlreadyHandled: true };
}

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

function sessionAccessToken(result: SessionReadResult | SessionRefreshResult) {
  return result.data.session?.access_token ?? null;
}

/**
 * Recovers a request that was rejected with a bearer token. Concurrent callers
 * share one refresh. A slower 401 handler first observes token rotation from a
 * completed recovery and reuses that token instead of refreshing again.
 */
export async function recoverSessionAfterUnauthorized(
  failedAccessToken: string,
  dependencies: UnauthorizedRecoveryDependencies = {},
): Promise<UnauthorizedRecoveryResult> {
  if (unauthorizedRecoveryInFlight) return unauthorizedRecoveryInFlight;

  const getSession = dependencies.getSession ?? (() => getSessionSingleFlight());
  const refreshSession = dependencies.refreshSession ?? (() => refreshSessionSingleFlight());

  let current: SessionReadResult;
  try {
    current = await getSession();
  } catch (error) {
    if (terminallyRejectedAccessTokens.has(failedAccessToken)) {
      return alreadyHandledTerminalFailure(error);
    }
    rememberTerminallyRejectedAccessToken(failedAccessToken);
    return { accessToken: null, error };
  }

  const currentToken = sessionAccessToken(current);
  if (currentToken && currentToken !== failedAccessToken) {
    if (terminallyRejectedAccessTokens.has(currentToken)) {
      return alreadyHandledTerminalFailure(new Error("Current access token was already rejected"));
    }
    return { accessToken: currentToken, error: null };
  }
  if (terminallyRejectedAccessTokens.has(failedAccessToken)) {
    return alreadyHandledTerminalFailure(new Error("Access token recovery already failed"));
  }

  // Another caller may have installed the recovery promise while this caller
  // was reading the current session.
  if (unauthorizedRecoveryInFlight) return unauthorizedRecoveryInFlight;

  const request = (async (): Promise<UnauthorizedRecoveryResult> => {
    try {
      const latest = await getSession();
      const latestToken = sessionAccessToken(latest);
      if (latestToken && latestToken !== failedAccessToken) {
        if (terminallyRejectedAccessTokens.has(latestToken)) {
          return alreadyHandledTerminalFailure(new Error("Current access token was already rejected"));
        }
        return { accessToken: latestToken, error: null };
      }

      if (terminallyRejectedAccessTokens.has(failedAccessToken)) {
        return alreadyHandledTerminalFailure(new Error("Access token recovery already failed"));
      }

      const refreshed = await refreshSession();
      const refreshedToken = sessionAccessToken(refreshed);
      if (refreshed.error || !refreshedToken || refreshedToken === failedAccessToken) {
        rememberTerminallyRejectedAccessToken(failedAccessToken);
        return {
          accessToken: null,
          error: refreshed.error ?? new Error("Session refresh returned no new access token"),
        };
      }

      return { accessToken: refreshedToken, error: null };
    } catch (error) {
      rememberTerminallyRejectedAccessToken(failedAccessToken);
      return { accessToken: null, error };
    }
  })();

  unauthorizedRecoveryInFlight = request;
  const clear = () => {
    if (unauthorizedRecoveryInFlight === request) unauthorizedRecoveryInFlight = null;
  };
  void request.then(clear, clear);
  return request;
}

export function subscribeToTerminalAuthFailure(listener: TerminalAuthFailureListener) {
  terminalAuthFailureListeners.add(listener);
  return () => terminalAuthFailureListeners.delete(listener);
}

export function isTerminalAuthFailureInProgress() {
  return terminalAuthFailureInProgress;
}

/**
 * Moves the current browser into a signed-out state exactly once for a burst of
 * unrecoverable requests. Listeners run synchronously so protected queries are
 * disabled before the local Supabase sign-out request finishes.
 */
export function terminateInvalidSessionSingleFlight(
  signOut: LocalSignOut = () => supabase.auth.signOut({ scope: "local" }),
): Promise<void> {
  if (terminalSignOutInFlight) return terminalSignOutInFlight;

  terminalAuthFailureInProgress = true;
  terminalAuthFailureListeners.forEach((listener) => {
    try {
      listener();
    } catch {
      // One UI listener must not prevent local auth cleanup.
    }
  });

  const request = (async () => {
    try {
      await signOut();
    } catch {
      // Supabase local sign-out removes persisted auth state even when its
      // server revocation call fails. The UI has already transitioned safely.
    } finally {
      terminalAuthFailureInProgress = false;
    }
  })();

  terminalSignOutInFlight = request;
  const clear = () => {
    if (terminalSignOutInFlight === request) terminalSignOutInFlight = null;
  };
  void request.then(clear, clear);
  return request;
}
