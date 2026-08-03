import type { ReactNode } from "react";
import { X } from "lucide-react";

import { Drawer, DrawerContent, DrawerDescription, DrawerTitle } from "@/components/ui/drawer";
import { SessionHeader } from "@/components/session/SessionHeader";
import type { SessionPresentation } from "@/lib/sessionPresentation";
import { cn } from "@/lib/utils";

type ShellContentProps = {
  presentation: SessionPresentation;
  children: ReactNode;
  footer?: ReactNode;
  headerLeading?: ReactNode;
  headerActions?: ReactNode;
  hidePresentationHeader?: boolean;
  fixedFooter?: boolean;
  className?: string;
  onClose?: () => void;
};

type SessionDrawerShellProps = ShellContentProps & {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  standalone?: boolean;
};

function ShellContent({ presentation, children, footer, headerLeading, headerActions, hidePresentationHeader = false, fixedFooter = false, className, onClose }: ShellContentProps) {
  return (
    <div className={cn("relative mx-auto flex h-full w-full max-w-md flex-col bg-white text-neutral-950", className)}>
      <div className={cn("relative z-10 shrink-0 border-b border-neutral-200 bg-white/95 px-6 pt-3 backdrop-blur", hidePresentationHeader ? "pb-3" : "pb-5")}>
        <div className={cn("relative flex h-11 items-center justify-center", !hidePresentationHeader && "mb-3")}>
          {headerLeading ? <div className="absolute left-0 top-0 flex items-center" data-testid="session-header-leading">{headerLeading}</div> : null}
          <div className="h-1.5 w-10 rounded-full bg-foreground/80" />
          <div className="absolute right-0 top-0 flex items-center gap-1" data-testid="session-header-actions">
            {headerActions}
            {onClose ? (
              <button
                type="button"
                onClick={onClose}
                className="grid h-11 w-11 place-items-center rounded-full text-neutral-500 hover:bg-neutral-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-950"
                aria-label="Stäng"
              >
                <X className="h-5 w-5" />
              </button>
            ) : null}
          </div>
        </div>
        {!hidePresentationHeader ? <SessionHeader presentation={presentation} /> : null}
      </div>

      <div
        data-testid="session-scroll-area"
        className={cn(
          "min-h-0 flex-1 overflow-y-auto overscroll-contain px-6 pt-5 [-webkit-overflow-scrolling:touch]",
          footer && fixedFooter
            ? "pb-[calc(92px+env(safe-area-inset-bottom,0px)+24px)]"
            : "pb-6",
        )}
      >
        <div className="space-y-4">{children}</div>
      </div>

      {footer ? (
        <div
          data-testid="session-fixed-action"
          className={cn(
            "z-20 border-t border-neutral-200 bg-white/95 px-6 pb-[calc(env(safe-area-inset-bottom,0px)+20px)] pt-4 backdrop-blur",
            fixedFooter ? "absolute inset-x-0 bottom-0" : "relative shrink-0",
          )}
        >
          {footer}
        </div>
      ) : null}
    </div>
  );
}

export function SessionDrawerShell({
  open = true,
  onOpenChange,
  standalone = false,
  presentation,
  children,
  footer,
  headerLeading,
  headerActions,
  hidePresentationHeader,
  fixedFooter,
  className,
}: SessionDrawerShellProps) {
  const onClose = onOpenChange ? () => onOpenChange(false) : undefined;

  if (standalone) {
    return (
      <div className="min-h-dvh bg-[#f7f4ee] text-neutral-950">
        <ShellContent presentation={presentation} footer={footer} headerLeading={headerLeading} headerActions={headerActions} hidePresentationHeader={hidePresentationHeader} fixedFooter={fixedFooter} className={className} onClose={onClose}>
          {children}
        </ShellContent>
      </div>
    );
  }

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent className="z-[60] h-[88dvh] max-h-[720px] overflow-clip rounded-t-[28px] border-neutral-200 bg-white p-0 text-neutral-950 outline-none [&>div:first-child]:hidden">
        <DrawerTitle className="sr-only">{presentation.title}</DrawerTitle>
        <DrawerDescription className="sr-only">{presentation.typeLabel}</DrawerDescription>
        <ShellContent presentation={presentation} footer={footer} headerLeading={headerLeading} headerActions={headerActions} hidePresentationHeader={hidePresentationHeader} fixedFooter={fixedFooter} className={className} onClose={onClose}>
          {children}
        </ShellContent>
      </DrawerContent>
    </Drawer>
  );
}
