export type FrontendReloadSafety = {
  safe: boolean;
  reason: string | null;
};

const UNSAFE_EXACT_PATHS = new Map<string, string>([
  ["/auth", "auth_form"],
  ["/auth/callback", "auth_callback"],
  ["/auth/reset", "auth_recovery"],
  ["/book", "booking_form"],
  ["/book/group", "group_booking_form"],
  ["/cart", "checkout_preparation"],
  ["/commerce/confirmed", "payment_finalization"],
  ["/membership", "membership_checkout"],
  ["/membership/confirmed", "membership_finalization"],
  ["/booking/confirmed", "booking_finalization"],
  ["/wellness", "sensitive_form"],
  ["/corp/join", "registration_form"],
  ["/corp/register", "registration_form"],
  ["/score/start", "live_score_setup"],
  ["/score/join", "live_score_join"],
]);

const UNSAFE_PATH_PREFIXES: Array<[string, string]> = [
  ["/order/", "payment_finalization"],
  ["/booking/invite/", "participant_claim"],
  ["/booking/ticket/", "participant_finalization"],
  ["/activity/invite/", "participant_payment"],
  ["/pass/", "pass_claim"],
  ["/course/", "course_checkout"],
  ["/seriespel/", "league_transaction"],
  ["/score/match/", "live_score"],
];

/**
 * Route-level safety is deliberately conservative around forms, auth and
 * payment finalization. Activity discovery/detail pages remain safe until a
 * modern client explicitly opens a critical section for checkout handoff.
 */
export function classifyFrontendReload(
  pathname: string,
  criticalReasons: Iterable<string> = [],
): FrontendReloadSafety {
  const activeReason = Array.from(criticalReasons)[0];
  if (activeReason) return { safe: false, reason: activeReason };

  const normalizedPath = pathname || "/";
  const exactReason = UNSAFE_EXACT_PATHS.get(normalizedPath);
  if (exactReason) return { safe: false, reason: exactReason };

  const prefixed = UNSAFE_PATH_PREFIXES.find(([prefix]) => normalizedPath.startsWith(prefix));
  if (prefixed) return { safe: false, reason: prefixed[1] };

  return { safe: true, reason: null };
}
