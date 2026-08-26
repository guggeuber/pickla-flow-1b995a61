import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2, Save } from "lucide-react";
import { toast } from "sonner";
import {
  removeSeriesMemberPricing,
  saveSeriesMemberPricing,
  type SeriesMemberPricingItem,
  type SeriesMemberPricingTier,
} from "@/lib/courses";

const inputClass = "h-11 rounded-xl border border-border bg-background px-3 text-sm outline-none focus:border-primary";

function formatSek(value: number) {
  return `${Number(value || 0).toLocaleString("sv-SE", { maximumFractionDigits: 2 }).replace(/\s/g, " ")} kr`;
}

function initialFixedPrice(pricing: SeriesMemberPricingTier) {
  if (pricing.rule?.fixed_price != null) return String(pricing.rule.fixed_price);
  // Catalog exposes explicit SEK only. Preserve an older percent rule until
  // the operator actually changes it by presenting its current SEK result.
  if (pricing.rule?.mode === "percent" && pricing.preview) return String(pricing.preview.resolved_price_sek);
  return "";
}

function SeriesMemberPriceRow({
  venueId,
  product,
  pricing,
  disabled,
}: {
  venueId: string;
  product: NonNullable<SeriesMemberPricingItem["product"]>;
  pricing: SeriesMemberPricingTier;
  disabled: boolean;
}) {
  const queryClient = useQueryClient();
  const [value, setValue] = useState(initialFixedPrice(pricing));

  useEffect(() => setValue(initialFixedPrice(pricing)), [pricing]);

  const save = useMutation({
    mutationFn: async () => {
      const trimmed = value.trim();
      if (!trimmed) return pricing.rule?.id ? removeSeriesMemberPricing(pricing.rule.id) : null;
      return saveSeriesMemberPricing({
        ruleId: pricing.rule?.id,
        tierId: pricing.tier.id,
        productKey: product.product_key,
        mode: "fixed",
        value: Number(trimmed),
        label: `${pricing.tier.name} · ${product.name}`,
      });
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["series-member-pricing", venueId] }),
        queryClient.invalidateQueries({ queryKey: ["tier-pricing", pricing.tier.id] }),
        queryClient.invalidateQueries({ queryKey: ["league-public"] }),
        queryClient.invalidateQueries({ queryKey: ["league-home"] }),
      ]);
      toast.success(value.trim() ? "Medlemspriset är sparat" : "Medlemspriset är borttaget");
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const numericValue = Number(value);
  const empty = value.trim() === "";
  const invalid = !empty && (!Number.isFinite(numericValue) || numericValue <= 0 || numericValue > product.base_price_sek);
  const currentValue = initialFixedPrice(pricing);
  const unchanged = value === currentValue || (empty && !pricing.rule);

  return <div data-testid={`series-member-price-${pricing.tier.id}`} className="grid gap-2 rounded-lg border border-border p-2 sm:grid-cols-[minmax(7rem,1fr)_minmax(9rem,12rem)_auto] sm:items-center">
    <div>
      <p className="text-xs font-bold">{pricing.tier.name}</p>
      <p className="mt-0.5 text-[11px] text-muted-foreground">
        {pricing.preview ? formatSek(pricing.preview.resolved_price_sek) : "Inget medlemspris"}
      </p>
    </div>
    <label className="relative">
      <span className="sr-only">{pricing.tier.name} medlemspris</span>
      <input
        aria-label={`${pricing.tier.name} medlemspris`}
        className={`${inputClass} w-full pr-8`}
        inputMode="decimal"
        placeholder="Inget pris"
        value={value}
        disabled={disabled}
        onChange={(event) => setValue(event.target.value)}
      />
      <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">kr</span>
    </label>
    <button
      type="button"
      onClick={() => save.mutate()}
      disabled={disabled || save.isPending || invalid || unchanged}
      className="inline-flex h-10 items-center justify-center gap-1 rounded-lg border border-border px-3 text-xs font-bold disabled:opacity-40"
    >
      {save.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}Spara
    </button>
  </div>;
}

export default function SeriesMemberPricingEditor({
  venueId,
  item,
  disabled = false,
  unitCopy,
}: {
  venueId: string;
  item?: SeriesMemberPricingItem;
  disabled?: boolean;
  unitCopy?: string;
}) {
  if (!item?.product) return <p className="mt-3 text-xs text-destructive">Erbjudandets prissättningsprodukt saknas.</p>;
  if (!item.product.is_active || item.product.status !== "active") return <p className="mt-3 text-xs text-destructive">Erbjudandets produkt är inte aktiv.</p>;
  return <div className="mt-3 rounded-xl border border-border bg-background p-3" data-testid="series-member-pricing">
    <div className="flex items-center justify-between gap-3">
      <div>
        <p className="text-xs font-black uppercase tracking-wider">Medlemspriser</p>
        {unitCopy ? <p className="mt-0.5 text-[11px] text-muted-foreground">{unitCopy}</p> : null}
      </div>
      <p className="text-xs text-muted-foreground">Ordinarie {formatSek(item.product.base_price_sek)}</p>
    </div>
    <div className="mt-2 grid gap-2">
      {item.tiers.length ? item.tiers.map((tier) => <SeriesMemberPriceRow key={tier.tier.id} venueId={venueId} product={item.product!} pricing={tier} disabled={disabled} />) : <p className="text-xs text-muted-foreground">Inga berättigade medlemsnivåer.</p>}
    </div>
    <p className="mt-2 text-[11px] text-muted-foreground">Tomt fält betyder inget erbjudandespecifikt medlemspris. Friplatser hanteras separat.</p>
  </div>;
}
