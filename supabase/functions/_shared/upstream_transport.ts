type ErrorLike = {
  name?: unknown;
  message?: unknown;
};

/**
 * Identifies failures where an outbound HTTP request never produced an
 * application response. Keep this deliberately narrower than generic
 * TypeError detection so validation and programming errors remain 4xx/bugs.
 */
export function isUpstreamTransportError(error: unknown) {
  const value = error && typeof error === 'object' ? error as ErrorLike : {};
  const name = typeof value.name === 'string' ? value.name : '';
  const message = typeof value.message === 'string' ? value.message : String(error || '');
  const searchable = `${name} ${message}`.toLowerCase();

  return /failed to fetch|fetch failed|networkerror|network request failed|connection reset|econn(?:reset|refused)|socket hang up|dns|sendrequest|error sending request|http\/?2 error|stream error/.test(searchable);
}
