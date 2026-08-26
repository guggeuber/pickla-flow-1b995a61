import { useQuery } from "@tanstack/react-query";
import { ArrowRight, Loader2 } from "lucide-react";
import { DateTime } from "luxon";
import { useNavigate, useSearchParams } from "react-router-dom";
import { PicklaTopBar } from "@/components/PicklaTopBar";
import { ResponsiveSupabaseImage } from "@/components/ResponsiveSupabaseImage";
import { fetchCourseCatalog } from "@/lib/courses";
import { CARD_ARTWORK_SIZES, CARD_ARTWORK_WIDTHS } from "@/lib/responsiveSupabaseImage";
import { seriesPresentation } from "@/lib/seriesPresentation";
import { resolveCustomerVenueContext } from "@/lib/customerVenue";

export default function CoursesPage() {
  const [params] = useSearchParams(); const navigate = useNavigate();
  const slug = resolveCustomerVenueContext(params.get("v")).slug;
  const catalog = useQuery({ queryKey: ["course-catalog", slug], queryFn: () => fetchCourseCatalog(slug, { auth: "omit" }), staleTime: 30_000 });
  return <div className="min-h-dvh bg-[#fffaf7] text-neutral-950"><PicklaTopBar slug={slug} background="#fffaf7" /><main className="mx-auto max-w-md px-5 pb-16 pt-[calc(env(safe-area-inset-top,0px)+104px)]">
    <p className="text-[11px] font-black uppercase tracking-[0.2em] text-neutral-400">Träna</p><h1 className="mt-2 text-[34px] font-black leading-none tracking-[-0.04em]">Lär dig spela.</h1><p className="mt-3 text-sm leading-relaxed text-neutral-500">Kurser och träningsupplägg som är öppna eller snart öppnar för anmälan.</p>
    {catalog.isLoading ? <Loader2 className="mx-auto mt-12 h-6 w-6 animate-spin" /> : <div className="mt-9 grid gap-4">{(catalog.data?.items || []).filter((course) => seriesPresentation(course.format?.presentation_type).listedInCourses).map((course, index) => <article key={course.id} className="overflow-hidden rounded-[24px] border border-black/10 bg-white">{course.image_urls?.[0] ? <ResponsiveSupabaseImage src={course.image_urls[0]} alt={course.name} sizes={CARD_ARTWORK_SIZES} widths={CARD_ARTWORK_WIDTHS} width={1280} height={720} priority={index === 0} className="block h-auto w-full" /> : null}<div className="p-5"><p className="text-[10px] font-black uppercase tracking-[0.18em] text-[#ed3f8f]">{course.registration_state === "open" ? "Anmälan öppen" : "Öppnar snart"}</p><h2 className="mt-2 text-xl font-black">{course.name}</h2><p className="mt-2 text-sm leading-relaxed text-neutral-500">{course.format?.description || course.description}</p><p className="mt-3 text-sm font-bold">Startar {DateTime.fromISO(course.start_date).setLocale("sv").toFormat("d MMMM")} · {course.capacity.available_count} platser kvar</p><button type="button" onClick={() => navigate(`/course/${course.id}?v=${encodeURIComponent(slug)}`)} className="mt-4 inline-flex min-h-11 items-center gap-2 rounded-full bg-neutral-950 px-5 text-sm font-black text-white">Visa kurs <ArrowRight className="h-4 w-4" /></button></div></article>)}{!(catalog.data?.items || []).some((course) => seriesPresentation(course.format?.presentation_type).listedInCourses) ? <p className="border-y border-black/10 py-8 text-sm text-neutral-500">Inga kursstarter är publicerade just nu.</p> : null}</div>}
  </main></div>;
}
