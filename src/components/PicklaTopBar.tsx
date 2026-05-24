import { Menu, X, ArrowRight, LogOut } from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { Drawer, DrawerContent } from "@/components/ui/drawer";
import picklaLogo from "@/assets/pickla-logo.svg";

const FONT_HEADING = "'Space Grotesk', sans-serif";
const FONT_MONO = "'Space Mono', monospace";

type PicklaTopBarProps = {
  slug?: string;
  venueName?: string;
  venueOpen?: boolean;
  showVenue?: boolean;
  onVenueClick?: () => void;
  background?: string;
};

export function PicklaTopBar({
  slug = "pickla-arena-sthlm",
  venueName = "Pickla Stockholm",
  venueOpen = true,
  showVenue = true,
  onVenueClick,
  background = "#fffaf7",
}: PicklaTopBarProps) {
  const navigate = useNavigate();
  const { user, signOut } = useAuth();
  const [open, setOpen] = useState(false);

  const go = (href: string) => {
    setOpen(false);
    navigate(href);
  };

  const handleSignOut = async () => {
    await signOut();
    setOpen(false);
    navigate(`/?v=${encodeURIComponent(slug)}`);
  };

  return (
    <>
      <header
        className="fixed left-0 right-0 top-0 z-50 border-b border-black/5 px-5 pb-3 pt-[calc(env(safe-area-inset-top,0px)+14px)] backdrop-blur-xl"
        style={{ background: `${background}f2` }}
      >
        <div className="mx-auto flex max-w-md items-center justify-between gap-3">
          <button
            type="button"
            onClick={() => navigate(`/?v=${encodeURIComponent(slug)}`)}
            className="shrink-0 active:scale-[0.98]"
            aria-label="Till startsidan"
          >
            <img src={picklaLogo} alt="Pickla" className="h-8 w-auto" />
          </button>

          {showVenue && (
            <button
              type="button"
              onClick={onVenueClick}
              className="min-w-0 flex-1 justify-center flex items-center gap-1.5 rounded-full bg-white px-3 py-2 text-[12px] shadow-sm active:scale-[0.98]"
              style={{ fontFamily: FONT_MONO }}
            >
              <span className="h-2.5 w-2.5 rounded-full" style={{ background: venueOpen ? "#32ef87" : "#d1d5db" }} />
              <span className="truncate">{venueName}</span>
            </button>
          )}

          <button
            type="button"
            onClick={() => setOpen(true)}
            className="grid h-10 w-10 place-items-center rounded-full border border-black/10 bg-white text-neutral-950 shadow-sm active:scale-[0.98]"
            aria-label="Öppna meny"
          >
            <Menu className="h-5 w-5" />
          </button>
        </div>
      </header>

      <Drawer open={open} onOpenChange={setOpen}>
        <DrawerContent className="max-h-[88vh] rounded-t-[28px] border-0 bg-white px-6 pb-[calc(env(safe-area-inset-bottom,0px)+22px)] pt-5">
          <div className="mx-auto flex w-full max-w-md flex-col">
            <div className="mb-6 flex items-center justify-between">
              <div>
                <p className="text-[10px] uppercase tracking-[0.24em] text-neutral-400" style={{ fontFamily: FONT_MONO }}>
                  meny
                </p>
                <h2 className="mt-1 text-[25px] font-black leading-none text-neutral-950" style={{ fontFamily: FONT_HEADING }}>
                  Pickla
                </h2>
              </div>
              <button type="button" onClick={() => setOpen(false)} className="rounded-full p-2 text-neutral-950">
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="space-y-7 overflow-y-auto pb-4">
              <section className="space-y-2">
                {[
                  [user ? "Min sida" : "Logga in", user ? `/my?v=${slug}` : `/auth?redirect=/my&v=${slug}`],
                  ...(user ? [["Min statistik", `/stats?v=${slug}`]] : []),
                  ["Boka pickleball", `/book?v=${slug}&sport=pickleball`],
                  ["Boka darts", `/book?v=${slug}&sport=dart`],
                  ["Planera event", `/book/group?v=${slug}`],
                  ["Pickla Idag", `/hub?v=${slug}`],
                ].map(([label, href]) => (
                  <button
                    key={label}
                    type="button"
                    onClick={() => go(href)}
                    className="flex w-full items-center justify-between rounded-2xl border border-neutral-200 bg-white px-4 py-4 text-left text-neutral-950"
                    style={{ fontFamily: FONT_HEADING }}
                  >
                    <span>{label}</span>
                    <ArrowRight className="h-4 w-4 text-neutral-400" />
                  </button>
                ))}
              </section>

              {showVenue && (
                <section>
                  <button
                    type="button"
                    onClick={() => {
                      setOpen(false);
                      onVenueClick?.();
                    }}
                    className="flex w-full items-center justify-between rounded-2xl border border-neutral-200 bg-[#fffaf7] px-4 py-4 text-left"
                  >
                    <span className="text-[14px] font-black text-neutral-950" style={{ fontFamily: FONT_HEADING }}>
                      {venueName}
                    </span>
                    <ArrowRight className="h-4 w-4 text-neutral-400" />
                  </button>
                </section>
              )}

              {user && (
                <section className="pt-2">
                  <button
                    type="button"
                    onClick={handleSignOut}
                    className="flex w-full items-center justify-between rounded-2xl border border-neutral-200 bg-[#f4f0ee] px-4 py-4 text-left text-neutral-950"
                    style={{ fontFamily: FONT_HEADING }}
                  >
                    <span>Logga ut</span>
                    <LogOut className="h-4 w-4 text-neutral-400" />
                  </button>
                </section>
              )}
            </div>
          </div>
        </DrawerContent>
      </Drawer>
    </>
  );
}
