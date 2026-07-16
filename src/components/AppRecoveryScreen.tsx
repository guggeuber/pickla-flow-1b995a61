type AppRecoveryScreenProps = {
  onRetry: () => void | Promise<void>;
  onSignOut: () => void | Promise<void>;
  busy?: boolean;
};

export function AppRecoveryScreen({ onRetry, onSignOut, busy = false }: AppRecoveryScreenProps) {
  return (
    <main
      role="alert"
      aria-live="assertive"
      className="grid min-h-[100dvh] place-items-center bg-[#fffaf7] px-6 py-10 text-[#111111]"
    >
      <section className="w-full max-w-[420px] rounded-[24px] border border-black/[0.08] bg-white p-7 shadow-[0_16px_48px_rgba(17,17,17,0.08)]">
        <p className="text-[11px] font-extrabold tracking-[0.18em] text-[#ed3f8f]">PICKLA</p>
        <h1 className="mt-3 text-[28px] font-extrabold leading-[1.05]">
          Something went wrong while loading your account.
        </h1>
        <p className="mt-4 text-[15px] leading-6 text-[#6b6664]">
          Your account is safe. Try loading the app again or sign out and try again.
        </p>
        <div className="mt-6 grid gap-2.5">
          <button
            type="button"
            onClick={() => void onRetry()}
            disabled={busy}
            className="rounded-[14px] border border-[#111111] bg-[#111111] px-4 py-3 text-[15px] font-bold text-white disabled:opacity-60"
          >
            Try again
          </button>
          <button
            type="button"
            onClick={() => void onSignOut()}
            disabled={busy}
            className="rounded-[14px] border border-black/15 bg-white px-4 py-3 text-[15px] font-bold text-[#111111] disabled:opacity-60"
          >
            Sign out
          </button>
        </div>
      </section>
    </main>
  );
}
