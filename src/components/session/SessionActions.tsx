import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";
import type { SessionActionPresentation } from "@/lib/sessionPresentation";
import { cn } from "@/lib/utils";

type RuntimeSessionAction = SessionActionPresentation & {
  icon?: ReactNode;
  onClick?: () => void;
  type?: "button" | "submit";
  form?: string;
  variant?: "primary" | "secondary" | "quiet";
};

type SessionActionsProps = {
  primary?: RuntimeSessionAction | null;
  secondary?: RuntimeSessionAction[];
  className?: string;
};

export function SessionActions({ primary, secondary = [], className }: SessionActionsProps) {
  return (
    <div className={cn("space-y-3", className)}>
      {primary ? (
        <Button
          type={primary.type ?? "button"}
          form={primary.form}
          onClick={primary.onClick}
          disabled={primary.disabled || primary.loading}
          className="h-14 w-full gap-2 rounded-[22px] bg-neutral-950 text-[17px] font-black text-white hover:bg-neutral-900"
        >
          {primary.icon}
          {primary.label}
        </Button>
      ) : null}

      {secondary.length > 0 ? (
        <div className="grid grid-cols-2 gap-3">
          {secondary.map((action) => (
            <Button
              key={action.key}
              type={action.type ?? "button"}
              form={action.form}
              onClick={action.onClick}
              disabled={action.disabled || action.loading}
              variant="secondary"
              className="h-12 gap-2 rounded-2xl bg-slate-100 text-[15px] font-bold text-slate-950 hover:bg-slate-200"
            >
              {action.icon}
              {action.label}
            </Button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
