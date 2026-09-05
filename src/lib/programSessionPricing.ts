import type { VerifiedAccountState } from "@/hooks/useVerifiedAccount";

export const PROGRAM_SESSION_PUBLIC_PREVIEW_ENDPOINT = "activity-preview";
export const PROGRAM_SESSION_PERSONALIZED_PREVIEW_ENDPOINT = "activity-preview-personalized";

export type ProgramSessionPricingPhase = "pending" | "resolved" | "error";

type ProgramSessionPricingViewInput<T> = {
  accountState: VerifiedAccountState;
  publicPreview: T | null | undefined;
  personalizedPreview: T | null | undefined;
  publicError: boolean;
  personalizedError: boolean;
  accessPending: boolean;
};

export type ProgramSessionPricingView<T> = {
  phase: ProgramSessionPricingPhase;
  preview: T | null;
  source: "public" | "personalized" | null;
};

/**
 * Pricing may use the public representation only after account bootstrap has
 * committed an anonymous state. Every other account state is fail-closed until
 * an authenticated representation exists.
 */
export function resolveProgramSessionPricingView<T>({
  accountState,
  publicPreview,
  personalizedPreview,
  publicError,
  personalizedError,
  accessPending,
}: ProgramSessionPricingViewInput<T>): ProgramSessionPricingView<T> {
  if (accountState === "anonymous") {
    if (publicPreview) return { phase: "resolved", preview: publicPreview, source: "public" };
    return { phase: publicError ? "error" : "pending", preview: null, source: null };
  }

  if (accountState === "validation_error" || accountState === "terminal_failure") {
    return { phase: "error", preview: null, source: null };
  }

  if (accountState !== "verified" || accessPending) {
    return { phase: "pending", preview: null, source: null };
  }

  if (personalizedPreview) {
    return { phase: "resolved", preview: personalizedPreview, source: "personalized" };
  }

  return {
    phase: personalizedError ? "error" : "pending",
    preview: null,
    source: null,
  };
}
