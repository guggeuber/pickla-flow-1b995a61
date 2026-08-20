import { ArrowRight } from "lucide-react";
import { DateTime } from "luxon";
import type { CourseDetail } from "@/lib/courses";
import { seriesPresentation } from "@/lib/seriesPresentation";

const PINK = "#ed3f8f";
const MUTED = "#76716f";
const BORDER = "rgba(17,17,17,0.07)";
const FONT_HEADING = "'Space Grotesk', sans-serif";
const FONT_MONO = "'Space Mono', monospace";

export function SeriesRegistrationCard({ series, onOpen }: { series: CourseDetail; onOpen: () => void }) {
  const presentation = seriesPresentation(series.format?.presentation_type);
  const prominentImage = presentation.imageProminence === "prominent" ? series.image_urls?.[0] : null;

  return (
    <article
      className="w-full overflow-hidden rounded-[24px] bg-white text-left"
      style={{ border: `1px solid ${BORDER}` }}
      data-testid="home-series-card"
      data-presentation-type={presentation.type}
    >
      {prominentImage ? (
        <img src={prominentImage} alt={series.name} className="aspect-[16/10] w-full object-cover" data-testid="home-series-image" />
      ) : null}
      <div className="p-5">
        <p className="text-[10px] font-black uppercase tracking-[0.2em]" style={{ color: PINK, fontFamily: FONT_MONO }}>
          {presentation.registrationEyebrow}
        </p>
        <h2 className="mt-2 text-xl font-black" style={{ fontFamily: FONT_HEADING }}>{series.name}</h2>
        {series.format?.description ? <p className="mt-2 text-sm leading-relaxed" style={{ color: MUTED }}>{series.format.description}</p> : null}
        <p className="mt-2 text-sm font-black" style={{ color: PINK }}>
          Startar {DateTime.fromISO(series.start_date).setLocale("sv").toFormat("d MMMM")} · {series.capacity.available_count} platser kvar
        </p>
        <button type="button" onClick={onOpen} className="mt-4 inline-flex items-center gap-2 rounded-full bg-black px-5 py-3 text-sm font-black text-white">
          {presentation.bookingCta} <ArrowRight className="h-4 w-4" />
        </button>
      </div>
    </article>
  );
}
