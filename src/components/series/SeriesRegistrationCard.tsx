import { ArrowRight } from "lucide-react";
import { DateTime } from "luxon";
import { ResponsiveSupabaseImage } from "@/components/ResponsiveSupabaseImage";
import type { CourseDetail } from "@/lib/courses";
import { CARD_ARTWORK_SIZES, CARD_ARTWORK_WIDTHS } from "@/lib/responsiveSupabaseImage";
import { seriesBookingCta, seriesPricePresentation } from "@/lib/seriesCustomerPricing";
import { seriesCustomerTitle, seriesPresentation } from "@/lib/seriesPresentation";

const PINK = "#ed3f8f";
const MUTED = "#76716f";
const BORDER = "rgba(17,17,17,0.07)";
const FONT_HEADING = "'Space Grotesk', sans-serif";
const FONT_MONO = "'Space Mono', monospace";

export function SeriesRegistrationCard({
  series,
  onOpen,
  imagePriority = false,
}: {
  series: CourseDetail;
  onOpen: () => void;
  imagePriority?: boolean;
}) {
  const presentation = seriesPresentation(series.format?.presentation_type);
  const artwork = series.image_urls?.[0] || null;
  const price = seriesPricePresentation({ pricing: series.pricing, basePriceSek: series.product.base_price_sek });
  const title = seriesCustomerTitle({ seriesName: series.name, formatName: series.format?.name, presentationType: presentation.type });
  const cta = seriesBookingCta(price, presentation.bookingCta);
  const registrationLabel = series.registration_state === "open"
    ? "Anmälan öppen"
    : series.registration_state === "upcoming"
      ? "Anmälan öppnar snart"
      : "Anmälan stängd";
  const eyebrow = `${presentation.label} · ${registrationLabel}`;
  const includedOpenPlay = presentation.type === "course"
    && series.included_access?.open_play_series_period.enabled === true;

  return (
    <article
      className="w-full overflow-hidden rounded-[24px] bg-white text-left"
      style={{ border: `1px solid ${BORDER}` }}
      data-testid="home-series-card"
      data-presentation-type={presentation.type}
    >
      {artwork ? (
        <ResponsiveSupabaseImage
          src={artwork}
          alt={title}
          sizes={CARD_ARTWORK_SIZES}
          widths={CARD_ARTWORK_WIDTHS}
          width={1280}
          height={720}
          priority={imagePriority}
          className="block h-auto w-full"
          data-testid="home-series-image"
        />
      ) : null}
      <div className="p-5">
        <p className="text-[10px] font-black uppercase tracking-[0.2em]" style={{ color: PINK, fontFamily: FONT_MONO }}>
          {eyebrow}
        </p>
        <h2 className="mt-2 text-xl font-black" style={{ fontFamily: FONT_HEADING }}>{title}</h2>
        {series.format?.description ? <p className="mt-2 text-sm leading-relaxed" style={{ color: MUTED }}>{series.format.description}</p> : null}
        {includedOpenPlay ? <div className="mt-3" data-testid="home-series-benefit">
          <p className="text-sm font-black uppercase tracking-[0.08em]" style={{ color: PINK }}>Fri Open Play ingår</p>
          <p className="mt-1 text-xs font-semibold" style={{ color: MUTED }}>Spela fritt mellan kurstillfällena</p>
        </div> : <>
          <p className="mt-2 text-sm font-black" style={{ color: PINK }}>{price.primary}</p>
          {price.context ? <p className="mt-1 text-xs font-semibold" style={{ color: MUTED }}>{price.context}</p> : null}
        </>}
        <p className="mt-2 text-sm font-bold" style={{ color: MUTED }}>
          {DateTime.fromISO(series.start_date).setLocale("sv").toFormat("d MMMM")} · {series.capacity.available_count} platser kvar
        </p>
        <button type="button" onClick={onOpen} className="mt-4 inline-flex items-center gap-2 rounded-full bg-black px-5 py-3 text-sm font-black text-white">
          {cta} <ArrowRight className="h-4 w-4" />
        </button>
      </div>
    </article>
  );
}
