import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { supabase } from "@/integrations/supabase/client";
import picklaLogo from "@/assets/pickla-logo.svg";
import type { EmailOtpType } from "@supabase/supabase-js";
import {
  consumePreservedIntendedRoute,
  markFirstRunWelcome,
  resolveEntryDestination,
} from "@/lib/entryResolver";

const CREAM = "#faf8f5";
const DARK_BLUE = "#1a1f3a";
const TEXT_DARK = "#1a1a1a";
const TEXT_MUTED = "rgba(26,26,26,0.55)";
const FONT_HEADING = "'Space Grotesk', sans-serif";
const FONT_MONO = "'Space Mono', monospace";

const OTP_TYPES = new Set(["signup", "invite", "magiclink", "recovery", "email_change", "email"]);
const PENDING_CLAIM_KEY = "pickla_pending_claim_token";
const CONFIRMATION_ERROR_MESSAGE = "Länken kunde inte bekräftas. Skicka en ny bekräftelselänk.";
const CONFIRMATION_ERROR_HELP = "We could not confirm this link. Please request a new confirmation email.";

function callbackParam(searchParams: URLSearchParams, hashParams: URLSearchParams, key: string) {
  return searchParams.get(key) || hashParams.get(key);
}

function normalizeOtpType(type?: string | null): EmailOtpType {
  return OTP_TYPES.has(type || "") ? (type as EmailOtpType) : "signup";
}

function postAuthTarget(isFirstRunCandidate = false) {
  const pendingClaim = localStorage.getItem(PENDING_CLAIM_KEY);
  const intendedRoute = pendingClaim ? `/pass/${pendingClaim}` : consumePreservedIntendedRoute();
  const target = resolveEntryDestination({ intendedRoute });
  if (isFirstRunCandidate && !pendingClaim && !intendedRoute) markFirstRunWelcome();
  return target;
}

export default function AuthCallback() {
  const navigate = useNavigate();
  const [status, setStatus] = useState<"loading" | "success" | "error">("loading");
  const [errorMsg, setErrorMsg] = useState("");
  const [successText, setSuccessText] = useState("Du är inloggad");

  useEffect(() => {
    let cancelled = false;
    let resolved = false;
    let redirectTimer: number | undefined;
    let timeoutTimer: number | undefined;

    const logCallbackError = (error: unknown) => {
      const name = error instanceof Error ? error.name : "AuthCallbackError";
      const message = error instanceof Error ? error.message : String(error || "Unknown auth callback error");
      console.error("[auth-callback] Confirmation failed", { name, message });
    };

    const failLink = (error?: unknown) => {
      resolved = true;
      if (error) logCallbackError(error);
      if (cancelled) return;
      setErrorMsg(CONFIRMATION_ERROR_MESSAGE);
      setStatus("error");
    };

    const markSuccess = (text: string, isFirstRunCandidate: boolean) => {
      resolved = true;
      if (cancelled) return;
      setSuccessText(text);
      setStatus("success");
      redirectTimer = window.setTimeout(() => navigate(postAuthTarget(isFirstRunCandidate), { replace: true }), 1200);
    };

    const exchange = async () => {
      const searchParams = new URLSearchParams(window.location.search);
      const hashParams = new URLSearchParams(window.location.hash.replace(/^#/, ""));
      const authError = callbackParam(searchParams, hashParams, "error_description")
        || callbackParam(searchParams, hashParams, "error");
      if (authError) {
        failLink(new Error(authError));
        return;
      }

      const type = callbackParam(searchParams, hashParams, "type");
      const isSignup = type === "signup" || type === "email_change";

      // PKCE flow: Supabase sends ?code= — must exchange for session
      const code = callbackParam(searchParams, hashParams, "code");
      if (code) {
        const { error } = await supabase.auth.exchangeCodeForSession(window.location.href);
        if (error) {
          failLink(error);
          return;
        }
        markSuccess(isSignup ? "Din e-post är bekräftad" : "Du är inloggad", isSignup);
        return;
      }

      // OTP hash flow: used by custom Supabase email templates with {{ .TokenHash }}
      const tokenHash = callbackParam(searchParams, hashParams, "token_hash");
      if (tokenHash) {
        const { error } = await supabase.auth.verifyOtp({
          token_hash: tokenHash,
          type: normalizeOtpType(type),
        });
        if (error) {
          failLink(error);
          return;
        }
        markSuccess(isSignup ? "Din e-post är bekräftad" : "Du är inloggad", isSignup);
        return;
      }

      // Implicit flow fallback: #access_token may already be handled by Supabase client on load
      const { data: { session } } = await supabase.auth.getSession();
      if (session) {
        markSuccess("Du är inloggad", false);
        return;
      }

      failLink(new Error("Auth callback missing verification code and session."));
    };
    exchange().catch(failLink);

    timeoutTimer = window.setTimeout(async () => {
      if (cancelled || resolved) return;
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (session) markSuccess("Du är inloggad", false);
        else failLink(new Error("Auth callback timed out without a session."));
      } catch (error) {
        failLink(error);
      }
    }, 4000);

    return () => {
      cancelled = true;
      if (redirectTimer) window.clearTimeout(redirectTimer);
      if (timeoutTimer) window.clearTimeout(timeoutTimer);
    };
  }, [navigate]);

  return (
    <div
      className="min-h-[100dvh] flex flex-col items-center justify-center px-6 text-center"
      style={{ background: CREAM, color: TEXT_DARK }}
    >
      <motion.div
        initial={{ opacity: 0, y: 24 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
        className="flex flex-col items-center gap-6 max-w-xs"
      >
        <img src={picklaLogo} alt="Pickla" className="h-10 w-auto" />

        {status === "loading" && (
          <p className="text-[13px]" style={{ fontFamily: FONT_MONO, color: TEXT_MUTED }}>
            Bekräftar…
          </p>
        )}

        {status === "error" && (
          <>
            <div className="text-5xl">❌</div>
            <div>
              <h1 className="text-[22px] font-bold" style={{ fontFamily: FONT_HEADING }}>
                Något gick fel
              </h1>
              <p className="text-[12px] mt-2" style={{ fontFamily: FONT_MONO, color: TEXT_MUTED }}>
                {errorMsg}
              </p>
              <p className="text-[11px] mt-2" style={{ fontFamily: FONT_MONO, color: TEXT_MUTED }}>
                {CONFIRMATION_ERROR_HELP}
              </p>
            </div>
            <button
              onClick={() => navigate("/auth", { replace: true })}
              className="px-8 py-3 rounded-2xl text-[14px] font-bold active:scale-95 transition-transform"
              style={{ background: DARK_BLUE, color: "#fff", fontFamily: FONT_MONO }}
            >
              Tillbaka →
            </button>
          </>
        )}

        {status === "success" && (
          <>
            <motion.div
              initial={{ scale: 0.5, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ type: "spring", stiffness: 300, damping: 22 }}
              className="text-5xl"
            >
              🎯
            </motion.div>
            <div>
              <h1 className="text-[26px] font-bold tracking-tight" style={{ fontFamily: FONT_HEADING }}>
                Välkommen till Pickla!
              </h1>
              <p className="text-[13px] mt-2" style={{ fontFamily: FONT_MONO, color: TEXT_MUTED }}>
                {successText}
              </p>
            </div>
            <button
              onClick={() => navigate(postAuthTarget(status === "success" && successText === "Din e-post är bekräftad"), { replace: true })}
              className="px-8 py-3 rounded-2xl text-[14px] font-bold active:scale-95 transition-transform"
              style={{ background: DARK_BLUE, color: "#fff", fontFamily: FONT_MONO }}
            >
              Kom igång →
            </button>
          </>
        )}
      </motion.div>
    </div>
  );
}
