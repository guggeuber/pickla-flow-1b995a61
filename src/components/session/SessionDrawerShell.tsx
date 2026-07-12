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
  className?: string;
  onClose?: () => void;
};

type SessionDrawerShellProps = ShellContentProps & {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  standalone?: boolean;
};

function ShellContent({ presentation, children, footer, className, onClose }: ShellContentProps) {
  return (
    <div className={cn("mx-auto flex h-full w-full max-w-md flex-col bg-white text-neutral-950", className)}>
      <div className="sticky top-0 z-10 border-b border-neutral-200 bg-white/95 px-6 pb-5 pt-3 backdrop-blur">
        <div className="relative mb-5 flex items-center justify-center">
          <div className="h-2 w-28 rounded-full bg-foreground/80" />
          {onClose ? (
            <button
              type="button"
              onClick={onClose}
              className="absolute right-0 grid h-10 w-10 place-items-center rounded-full bg-neutral-100 text-neutral-500"
              aria-label="Stäng"
            >
              <X className="h-5 w-5" />
            </button>
          ) : null}
        </div>
        <SessionHeader presentation={presentation} />
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
        <div className="space-y-4">{children}</div>
      </div>

      {footer ? (
        <div className="sticky bottom-0 border-t border-neutral-200 bg-white/95 px-6 pb-[calc(env(safe-area-inset-bottom)+20px)] pt-4 backdrop-blur">
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
  className,
}: SessionDrawerShellProps) {
  const onClose = onOpenChange ? () => onOpenChange(false) : undefined;

  if (standalone) {
    return (
      <div className="min-h-dvh bg-[#f7f4ee] text-neutral-950">
        <ShellContent presentation={presentation} footer={footer} className={className} onClose={onClose}>
          {children}
        </ShellContent>
      </div>
    );
  }

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent className="z-[60] h-[88dvh] max-h-[720px] overflow-hidden rounded-t-[28px] border-neutral-200 bg-white p-0 text-neutral-950">
        <DrawerTitle className="sr-only">{presentation.title}</DrawerTitle>
        <DrawerDescription className="sr-only">{presentation.typeLabel}</DrawerDescription>
        <ShellContent presentation={presentation} footer={footer} className={className} onClose={onClose}>
          {children}
        </ShellContent>
      </DrawerContent>
    </Drawer>
  );
}
