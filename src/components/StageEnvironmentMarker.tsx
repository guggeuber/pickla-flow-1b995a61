import { useLocation } from "react-router-dom";
import { shouldShowStageEnvironmentMarker } from "@/lib/stageEnvironment";

type StageEnvironmentMarkerProps = {
  environment?: string;
};

export function StageEnvironmentMarker({
  environment = import.meta.env.VITE_PICKLA_ENVIRONMENT,
}: StageEnvironmentMarkerProps) {
  const { pathname } = useLocation();
  if (!shouldShowStageEnvironmentMarker(environment, pathname)) return null;

  return (
    <div
      aria-label="Stage environment"
      className="pointer-events-none fixed right-3 top-[calc(env(safe-area-inset-top,0px)+8px)] z-[200] rounded-full border border-white/30 bg-red-600 px-2.5 py-1 font-mono text-[10px] font-black tracking-[0.16em] text-white shadow-lg"
      data-testid="stage-environment-marker"
    >
      STAGE
    </div>
  );
}
