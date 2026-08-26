import { useEffect, useMemo, useState } from "react";
import { DateTime } from "luxon";
import { useQuery } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { ArrowLeft, CalendarDays, ChevronDown, ChevronRight, Crown, Loader2, Package, Plus, Tag } from "lucide-react";
import AdminCourses from "@/components/admin/AdminCourses";
import AdminLeague from "@/components/admin/AdminLeague";
import { fetchCourseAdmin, type CourseDetail } from "@/lib/courses";
import { fetchLeagueAdmin, type LeagueAdminSeason } from "@/lib/league";
import { catalogOfferSection, sortCatalogOffers, visibleCatalogOffers, type CatalogOfferSection } from "@/lib/adminCatalog";
import { seriesCustomerTitle, seriesPresentation, type SeriesPresentationType } from "@/lib/seriesPresentation";
import { ax, AX_GRID_BG } from "./axTheme";
import { AxChip } from "./axPrimitives";

type Props = {
  venueId: string | undefined;
  initialSeriesId?: string | null;
  onCloseInitialSeries?: () => void;
  onOpenModule: (id: string) => void;
};

const OFFER_TYPES: Array<{ type: SeriesPresentationType; label: string; description: string }> = [
  { type: "course", label: "Kurs", description: "Flera eller ett tillfälle med en bokningsbar plats i omgången." },
  { type: "social_event", label: "Event", description: "Ett namngivet publikt event med egen identitet." },
  { type: "clinic", label: "Clinic", description: "Fokuserad träning eller workshop med coach." },
  { type: "tournament", label: "Turnering", description: "Turneringspresentation med samma Series- och Commerce-grund." },
  { type: "league", label: "Seriespel", description: "Sex lag köper varsin lagplats. Fem League-kvällar, fixtures, resultat och tabell." },
];

const SECTION_COPY: Record<CatalogOfferSection, { title: string; empty: string }> = {
  active: { title: "Aktiva", empty: "Inga publicerade erbjudanden." },
  draft: { title: "Utkast", empty: "Inga utkast." },
  paused: { title: "Pausade", empty: "Inga pausade erbjudanden." },
  archived: { title: "Arkiverade", empty: "Inga arkiverade erbjudanden." },
};

function sek(value: number) {
  return `${Number(value || 0).toLocaleString("sv-SE")} kr`;
}

function offerDate(series: CourseDetail) {
  const start = DateTime.fromISO(series.start_date, { zone: "Europe/Stockholm" }).setLocale("sv");
  const end = DateTime.fromISO(series.end_date, { zone: "Europe/Stockholm" }).setLocale("sv");
  if (!start.isValid) return "Datum saknas";
  if (series.total_sessions === 1) return `${start.toFormat("d MMM")} · ${String(series.start_time).slice(0, 5)}`;
  return `${start.toFormat("d MMM")}–${end.toFormat("d MMM")}`;
}

function statusLabel(status: string) {
  if (status === "active") return "Publicerad";
  if (status === "draft") return "Utkast";
  if (status === "paused") return "Pausad";
  if (status === "completed") return "Avslutad";
  return "Arkiverad";
}

function OfferCard({ series, onEdit }: { series: CourseDetail; onEdit: () => void }) {
  const presentation = seriesPresentation(series.format?.presentation_type || "course");
  const customerTitle = seriesCustomerTitle({ seriesName: series.name, formatName: series.format?.name, presentationType: presentation.type });
  return (
    <article
      className="relative overflow-hidden rounded-2xl p-4"
      style={{ background: ax("surfaceHi"), border: `1px solid ${ax("borderSoft")}` }}
      data-testid={`catalog-offer-${series.id}`}
    >
      <span className="absolute inset-y-3 left-0 w-1 rounded-full" style={{ background: series.status === "active" ? ax("lime") : series.status === "draft" ? ax("sun") : ax("muted") }} />
      <div className="ml-2 flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <AxChip tone={series.format?.presentation_type === "social_event" ? "magenta" : "electric"}>{presentation.label}</AxChip>
            <AxChip tone={series.status === "active" ? "lime" : series.status === "draft" ? "sun" : "neutral"}>{statusLabel(series.status).toUpperCase()}</AxChip>
          </div>
          <h3 className="mt-2 truncate font-display text-[17px] font-black" style={{ color: "white" }}>{customerTitle}</h3>
          <p className="mt-1 font-mono text-[11px]" style={{ color: ax("muted") }}>
            {offerDate(series)} · {series.total_sessions} {series.total_sessions === 1 ? "tillfälle" : "tillfällen"}
          </p>
          <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs font-bold" style={{ color: ax("muted") }}>
            <span>{series.capacity.committed_count}/{series.capacity.capacity} platser</span>
            <span style={{ color: "white" }}>{sek(series.product.base_price_sek)}</span>
          </div>
          {series.product.scarcity_mode === "early_bird" && series.product.early_bird_price_minor != null ? (
            <p className="mt-1.5 text-[11px] font-bold" style={{ color: ax("lime") }}>
              Early Bird {sek(series.product.early_bird_price_minor / 100)} · första {series.product.early_bird_slots} platser
            </p>
          ) : null}
        </div>
        <motion.button
          type="button"
          whileTap={{ scale: 0.95 }}
          onClick={onEdit}
          className="inline-flex min-h-10 shrink-0 items-center gap-1 rounded-xl px-3 text-xs font-black"
          style={{ background: ax("electric"), color: ax("ink") }}
        >
          Redigera <ChevronRight className="h-3.5 w-3.5" />
        </motion.button>
      </div>
    </article>
  );
}

function OfferSection({ title, items, empty, onEdit }: { title: string; items: CourseDetail[]; empty: string; onEdit: (id: string) => void }) {
  return (
    <section className="space-y-2" data-testid={`catalog-section-${title.toLowerCase()}`}>
      <div className="flex items-center gap-2 px-1">
        <p className="font-mono text-[10px] font-black uppercase tracking-[0.2em]" style={{ color: ax("muted") }}>{title}</p>
        <span className="rounded-md px-1.5 py-0.5 font-mono text-[9px] font-bold" style={{ background: ax("surfaceHi"), color: ax("muted") }}>{items.length}</span>
        <span className="h-px flex-1" style={{ background: `linear-gradient(90deg, ${ax("border")}, transparent)` }} />
      </div>
      {items.length ? items.map((series) => <OfferCard key={series.id} series={series} onEdit={() => onEdit(series.id)} />) : (
        <p className="rounded-2xl px-4 py-5 text-center text-xs" style={{ background: ax("surfaceHi"), color: ax("muted"), border: `1px solid ${ax("borderSoft")}` }}>{empty}</p>
      )}
    </section>
  );
}

function LeagueOfferCard({ season, onEdit }: { season: LeagueAdminSeason; onEdit: () => void }) {
  const series = Array.isArray(season.activity_series) ? season.activity_series[0] : season.activity_series;
  const activeTeams = (season.teams || []).filter((team) => team.status === "active").length;
  const product = Array.isArray(series?.access_products) ? series.access_products[0] : series?.access_products;
  return <article className="relative overflow-hidden rounded-2xl p-4" style={{ background: ax("surfaceHi"), border: `1px solid ${ax("borderSoft")}` }} data-testid={`catalog-league-${season.id}`}><span className="absolute inset-y-3 left-0 w-1 rounded-full" style={{ background: series?.status === "active" ? ax("lime") : ax("sun") }} /><div className="ml-2 flex items-start gap-3"><div className="min-w-0 flex-1"><div className="flex gap-1.5"><AxChip tone="magenta">SERIESPEL</AxChip><AxChip tone={series?.status === "active" ? "lime" : "sun"}>{statusLabel(series?.status || "draft").toUpperCase()}</AxChip></div><h3 className="mt-2 truncate font-display text-[17px] font-black text-white">{series?.name}</h3><p className="mt-1 font-mono text-[11px]" style={{ color: ax("muted") }}>{series?.start_date ? DateTime.fromISO(series.start_date).setLocale("sv").toFormat("d MMM") : "Datum saknas"}–{series?.end_date ? DateTime.fromISO(series.end_date).setLocale("sv").toFormat("d MMM") : ""} · 5 torsdagar</p><div className="mt-3 flex gap-4 text-xs font-bold" style={{ color: ax("muted") }}><span>{activeTeams}/6 lag</span><span className="text-white">{sek(Number(product?.base_price_sek || 0))} / lag</span><span>{season.fixtures?.length || 0}/30 matcher</span></div></div><motion.button type="button" whileTap={{ scale: 0.95 }} onClick={onEdit} className="inline-flex min-h-10 shrink-0 items-center gap-1 rounded-xl px-3 text-xs font-black" style={{ background: ax("electric"), color: ax("ink") }}>Redigera <ChevronRight className="h-3.5 w-3.5" /></motion.button></div></article>;
}

export default function AdminCatalog({ venueId, initialSeriesId = null, onCloseInitialSeries, onOpenModule }: Props) {
  const [selectedSeriesId, setSelectedSeriesId] = useState<string | null>(initialSeriesId);
  const [createType, setCreateType] = useState<SeriesPresentationType | null>(null);
  const [choosingType, setChoosingType] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const query = useQuery({
    queryKey: ["admin-courses", venueId],
    queryFn: () => fetchCourseAdmin(venueId!),
    enabled: Boolean(venueId),
  });
  const leagueQuery = useQuery({
    queryKey: ["admin-leagues", venueId],
    queryFn: () => fetchLeagueAdmin(venueId!),
    enabled: Boolean(venueId),
  });

  useEffect(() => {
    if (initialSeriesId) {
      setSelectedSeriesId(initialSeriesId);
      setCreateType(null);
      setChoosingType(false);
    }
  }, [initialSeriesId]);

  const grouped = useMemo(() => {
    const result: Record<CatalogOfferSection, CourseDetail[]> = { active: [], draft: [], paused: [], archived: [] };
    for (const series of sortCatalogOffers(visibleCatalogOffers(query.data?.series || []))) result[catalogOfferSection(series)].push(series);
    return result;
  }, [query.data?.series]);
  const selectedSeries = query.data?.series.find((series) => series.id === selectedSeriesId);
  const selectedLeague = leagueQuery.data?.seasons.find((season) => season.activity_series_id === selectedSeriesId || season.id === selectedSeriesId);

  const closeEditor = () => {
    setSelectedSeriesId(null);
    setCreateType(null);
    setChoosingType(false);
    onCloseInitialSeries?.();
  };

  if (!venueId) return <p className="py-10 text-center text-sm" style={{ color: ax("muted") }}>Välj venue först.</p>;

  if (selectedSeriesId || createType) {
    return (
      <div className="space-y-4" data-testid="admin-catalog-editor">
        <div className="flex items-center gap-3">
          <button type="button" onClick={closeEditor} className="grid h-10 w-10 place-items-center rounded-xl" style={{ background: ax("surfaceHi"), color: "white" }} aria-label="Tillbaka till Catalog">
            <ArrowLeft className="h-4 w-4" />
          </button>
          <div className="min-w-0 flex-1">
            <p className="font-mono text-[10px] font-black uppercase tracking-[0.2em]" style={{ color: ax("electricSoft") }}>Catalog · Redigera</p>
            <h2 className="truncate font-display text-lg font-black" style={{ color: "white" }}>{selectedLeague ? (Array.isArray(selectedLeague.activity_series) ? selectedLeague.activity_series[0]?.name : selectedLeague.activity_series?.name) : selectedSeries ? seriesCustomerTitle({ seriesName: selectedSeries.name, formatName: selectedSeries.format?.name, presentationType: selectedSeries.format?.presentation_type }) : (createType ? `Nytt ${seriesPresentation(createType).label.toLowerCase()}` : "Öppnar erbjudande")}</h2>
          </div>
        </div>
        {selectedSeriesId && !selectedSeries && !selectedLeague && (query.isLoading || leagueQuery.isLoading) ? <div className="flex justify-center py-12"><Loader2 className="h-5 w-5 animate-spin" style={{ color: ax("muted") }} /></div> : createType === "league" || selectedLeague ? <AdminLeague venueId={venueId} leagueSeasonId={selectedLeague?.id || null} onDone={closeEditor} /> : <AdminCourses
          venueId={venueId}
          catalogMode
          initialSeriesId={selectedSeriesId}
          initialPresentationType={createType || selectedSeries?.format?.presentation_type || "course"}
          onDone={closeEditor}
        />}
      </div>
    );
  }

  return (
    <div className="space-y-5" data-testid="admin-catalog">
      <div className="relative overflow-hidden rounded-3xl p-5" style={{ background: `linear-gradient(135deg, ${ax("surface")}, ${ax("magenta", 0.12)})`, border: `1px solid ${ax("border")}` }}>
        <div className="absolute inset-0 opacity-30" style={AX_GRID_BG} />
        <div className="relative flex items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2"><Package className="h-4 w-4" style={{ color: ax("magenta") }} /><p className="font-mono text-[10px] font-black uppercase tracking-[0.2em]" style={{ color: ax("magenta") }}>Catalog · Vad säljer vi?</p></div>
            <h2 className="mt-2 font-display text-2xl font-black" style={{ color: "white" }}>Erbjudanden</h2>
            <p className="mt-1 max-w-sm text-xs leading-relaxed" style={{ color: ax("muted") }}>Kurser, event, clinics, turneringar och Seriespel med egen identitet. Tillfällena syns i samma Calendar som resten av huset.</p>
          </div>
          <motion.button type="button" whileTap={{ scale: 0.95 }} onClick={() => setChoosingType((value) => !value)} className="inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-xl px-3 text-xs font-black" style={{ background: `linear-gradient(135deg, ${ax("electric")}, ${ax("magenta")})`, color: "white" }}>
            <Plus className="h-4 w-4" /> Nytt erbjudande
          </motion.button>
        </div>
      </div>

      {query.isLoading ? <div className="flex justify-center py-12"><Loader2 className="h-5 w-5 animate-spin" style={{ color: ax("muted") }} /></div> : query.isError ? <p className="rounded-2xl p-5 text-center text-sm text-destructive">Catalog kunde inte hämtas.</p> : (
        <>
          {(leagueQuery.data?.seasons || []).length ? <section className="space-y-2"><div className="flex items-center gap-2 px-1"><p className="font-mono text-[10px] font-black uppercase tracking-[0.2em]" style={{ color: ax("magenta") }}>Seriespel</p><span className="h-px flex-1" style={{ background: `linear-gradient(90deg, ${ax("border")}, transparent)` }} /></div>{leagueQuery.data!.seasons.map((season) => <LeagueOfferCard key={season.id} season={season} onEdit={() => setSelectedSeriesId(season.activity_series_id)} />)}</section> : null}
          <OfferSection {...SECTION_COPY.active} items={grouped.active} onEdit={setSelectedSeriesId} />
          <OfferSection {...SECTION_COPY.draft} items={grouped.draft} onEdit={setSelectedSeriesId} />
          {grouped.paused.length ? <OfferSection {...SECTION_COPY.paused} items={grouped.paused} onEdit={setSelectedSeriesId} /> : null}
          {grouped.archived.length ? <section>
            <button type="button" onClick={() => setShowArchived((value) => !value)} className="flex w-full items-center justify-between rounded-2xl px-4 py-3 text-left" style={{ background: ax("surfaceHi"), border: `1px solid ${ax("borderSoft")}` }}>
              <span className="text-xs font-bold" style={{ color: ax("muted") }}>Arkiverade erbjudanden · {grouped.archived.length}</span>
              <ChevronDown className={`h-4 w-4 transition-transform ${showArchived ? "rotate-180" : ""}`} style={{ color: ax("muted") }} />
            </button>
            {showArchived ? <div className="mt-2"><OfferSection {...SECTION_COPY.archived} items={grouped.archived} onEdit={setSelectedSeriesId} /></div> : null}
          </section> : null}
        </>
      )}

      {choosingType ? <section className="rounded-2xl p-4" style={{ background: ax("surfaceHi"), border: `1px solid ${ax("borderSoft")}` }} data-testid="catalog-offer-type-picker">
        <p className="font-mono text-[10px] font-black uppercase tracking-[0.2em]" style={{ color: ax("muted") }}>Nytt erbjudande</p>
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          {OFFER_TYPES.map((offer) => <button key={offer.type} type="button" onClick={() => { setChoosingType(false); setCreateType(offer.type); }} className="rounded-xl p-3 text-left" style={{ background: ax("surface"), border: `1px solid ${ax("borderSoft")}` }}>
            <p className="text-sm font-black" style={{ color: "white" }}>{offer.label}</p><p className="mt-1 text-[11px] leading-relaxed" style={{ color: ax("muted") }}>{offer.description}</p>
          </button>)}
        </div>
      </section> : null}

      <section className="grid grid-cols-3 gap-2" aria-label="Catalogverktyg">
        <button type="button" onClick={() => onOpenModule("products")} className="rounded-xl p-3 text-center" style={{ background: ax("surfaceHi"), border: `1px solid ${ax("borderSoft")}` }}><Tag className="mx-auto h-4 w-4" style={{ color: ax("magenta") }} /><span className="mt-1 block text-[10px] font-bold" style={{ color: "white" }}>Produkter</span></button>
        <button type="button" onClick={() => onOpenModule("memberships")} className="rounded-xl p-3 text-center" style={{ background: ax("surfaceHi"), border: `1px solid ${ax("borderSoft")}` }}><Crown className="mx-auto h-4 w-4" style={{ color: ax("sun") }} /><span className="mt-1 block text-[10px] font-bold" style={{ color: "white" }}>Medlemskap</span></button>
        <button type="button" onClick={() => onOpenModule("schedule")} className="rounded-xl p-3 text-center" style={{ background: ax("surfaceHi"), border: `1px solid ${ax("borderSoft")}` }}><CalendarDays className="mx-auto h-4 w-4" style={{ color: ax("electricSoft") }} /><span className="mt-1 block text-[10px] font-bold" style={{ color: "white" }}>Maskinrum</span></button>
      </section>
    </div>
  );
}
