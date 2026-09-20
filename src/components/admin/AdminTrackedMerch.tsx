import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Boxes, Loader2, Plus, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { apiGet, apiPatch, apiPost } from "@/lib/api";
import { Switch } from "@/components/ui/switch";

type OptionValue = { id: string; code: string; label: string; swatch: string | null; status: string };
type ProductOption = { id: string; code: string; label: string; product_option_values: OptionValue[] };
type Variant = {
  id: string;
  sku: string;
  title: string | null;
  price_override_minor: number | null;
  image_url: string | null;
  status: string;
  product_variant_option_values: Array<{ option_id: string; option_value_id: string }>;
  inventory: null | { id: string; on_hand: number; reserved: number; allocated: number; available_to_sell: number; version: number; incident_blocked: boolean };
};
type Detail = {
  product: { id: string; inventory_policy: string };
  venue: { franchisee_id: string | null; tracked_merch_sales_enabled: boolean; franchisees: { id: string; legal_name: string } | Array<{ id: string; legal_name: string }> | null } | null;
  listing: null | { id: string; tracked_sales_enabled: boolean; default_inventory_location_id: string; inventory_locations: { name: string } | Array<{ name: string }> | null };
  options: ProductOption[];
  variants: Variant[];
};
type Operations = {
  levels: Array<Variant["inventory"] & { variant_id: string }>;
  movements: Array<{ id: string; movement_type: string; on_hand_delta: number; reserved_delta: number; allocated_delta: number; reason: string; occurred_at: string }>;
  incidents: Array<{ id: string; incident_type: string; deficit_quantity: number; status: string; inventory_levels: { variant_id: string; location_id: string } | Array<{ variant_id: string; location_id: string }> }>;
  attempts: Array<{ id: string; commerce_order_id: string; status: string; last_error: string | null; recovery_attempts: number }>;
  refunds: Array<{ id: string; commerce_order_id: string; status: string; amount_inc_vat_minor: number; unallocated_amount_minor: number; commerce_refund_lines: Array<{ commerce_order_line_id: string; quantity: number }> }>;
  allocations: Allocation[];
};
type AllocationLine = {
  id: string;
  product_name: string;
  sku: string | null;
  quantity: number;
  collected_quantity: number;
  cancelled_quantity: number;
  fulfillment_status: string;
};
type Allocation = {
  id: string;
  commerce_order_id: string;
  commerce_order_line_id: string;
  quantity: number;
  collected_quantity: number;
  commerce_order_lines: AllocationLine | AllocationLine[] | null;
};
type RefundResponse = { recovery_pending?: boolean };

const inputClass = "w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary";
const splitValues = (value: string) => value.split(",").map((part) => part.trim()).filter(Boolean);
const code = (value: string) => value.toLowerCase().replace(/å/g, "a").replace(/ä/g, "a").replace(/ö/g, "o").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

export default function AdminTrackedMerch({ venueId, productId }: { venueId: string; productId: string }) {
  const queryClient = useQueryClient();
  const [colors, setColors] = useState("Black, Off-white");
  const [sizes, setSizes] = useState("S, M, L, XL");
  const [locationName, setLocationName] = useState("Butik / reception");
  const [sku, setSku] = useState("");
  const [title, setTitle] = useState("");
  const [overrideSek, setOverrideSek] = useState("");
  const [selectedValues, setSelectedValues] = useState<Record<string, string>>({});
  const [editingVariantId, setEditingVariantId] = useState<string | null>(null);
  const [stockInputs, setStockInputs] = useState<Record<string, string>>({});
  const [reasonInputs, setReasonInputs] = useState<Record<string, string>>({});
  const [correctionMode, setCorrectionMode] = useState<Record<string, boolean>>({});
  const [allowShortage, setAllowShortage] = useState<Record<string, boolean>>({});
  const [incidentEvidence, setIncidentEvidence] = useState<Record<string, string>>({});

  const detail = useQuery<Detail>({
    queryKey: ["admin-product-variants", venueId, productId],
    queryFn: () => apiGet("api-admin", "product-variants", { venueId, productId }),
  });
  const operations = useQuery<Operations>({
    queryKey: ["commerce-inventory-operations", venueId],
    queryFn: () => apiGet("api-commerce", "inventory-operations", { venueId }),
    enabled: Boolean(detail.data?.listing),
  });
  const refresh = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["admin-product-variants", venueId, productId] }),
      queryClient.invalidateQueries({ queryKey: ["commerce-inventory-operations", venueId] }),
      queryClient.invalidateQueries({ queryKey: ["commerce-catalog", venueId] }),
    ]);
  };
  const seller = Array.isArray(detail.data?.venue?.franchisees)
    ? detail.data?.venue?.franchisees[0]
    : detail.data?.venue?.franchisees;

  const setup = useMutation({
    mutationFn: () => {
      if (!detail.data?.venue?.franchisee_id || !seller) throw new Error("Anläggningen saknar verifierad juridisk säljare.");
      return apiPost("api-admin", "tracked-product-setup", {
        venueId,
        product_id: productId,
        seller_franchisee_id: detail.data.venue.franchisee_id,
        location_name: locationName,
        location_code: "retail",
        tracked_sales_enabled: false,
        options: [
          { code: "color", label: "Färg", sort_order: 10, values: splitValues(colors).map((value, index) => ({ code: code(value), label: value, sort_order: index * 10 })) },
          { code: "size", label: "Storlek", sort_order: 20, values: splitValues(sizes).map((value, index) => ({ code: code(value), label: value, sort_order: index * 10 })) },
        ],
      });
    },
    onSuccess: async () => { await refresh(); toast.success("Säljare, plats och alternativ är konfigurerade. Försäljning är fortfarande avstängd."); },
    onError: (error: Error) => toast.error(error.message),
  });

  const saveVariant = useMutation({
    mutationFn: () => {
      const options = detail.data?.options || [];
      const optionValueIds = options.map((option) => selectedValues[option.id]).filter(Boolean);
      if (!sku.trim() || optionValueIds.length !== options.length) throw new Error("SKU och ett värde för varje alternativ krävs.");
      const payload = {
        venueId,
        product_id: productId,
        variant_id: editingVariantId,
        sku: sku.trim(),
        title: title.trim() || null,
        price_override_minor: overrideSek.trim() === "" ? null : Math.round(Number(overrideSek) * 100),
        option_value_ids: optionValueIds,
        status: "active",
      };
      return editingVariantId
        ? apiPatch("api-admin", "product-variants", payload)
        : apiPost("api-admin", "product-variants", payload);
    },
    onSuccess: async () => {
      setSku(""); setTitle(""); setOverrideSek(""); setSelectedValues({}); setEditingVariantId(null);
      await refresh(); toast.success(editingVariantId ? "Variant uppdaterad" : "Variant skapad");
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const variantStatus = useMutation({
    mutationFn: ({ variant, status }: { variant: Variant; status: "active" | "archived" }) => apiPatch("api-admin", "product-variants", {
      venueId,
      product_id: productId,
      variant_id: variant.id,
      sku: variant.sku,
      title: variant.title,
      price_override_minor: variant.price_override_minor,
      image_url: variant.image_url,
      option_value_ids: variant.product_variant_option_values.map((value) => value.option_value_id),
      status,
    }),
    onSuccess: async () => { await refresh(); toast.success("Variantstatus uppdaterad"); },
    onError: (error: Error) => toast.error(error.message),
  });

  const resolveIncident = useMutation({
    mutationFn: (incidentId: string) => {
      const evidence = String(incidentEvidence[incidentId] || "").trim();
      if (!evidence) throw new Error("Verifieringsunderlag krävs innan incidenten kan stängas.");
      return apiPost("api-commerce", "inventory-incident-resolve", {
        venue_id: venueId,
        incident_id: incidentId,
        evidence: { operator_note: evidence, verified_at: new Date().toISOString() },
        idempotency_key: crypto.randomUUID(),
      });
    },
    onSuccess: async () => { await refresh(); toast.success("Incidenten stängdes efter verifiering"); },
    onError: (error: Error) => toast.error(error.message),
  });

  const stock = useMutation({
    mutationFn: async ({ variant, correct }: { variant: Variant; correct: boolean }) => {
      const quantity = Math.floor(Number(stockInputs[variant.id]));
      const reason = String(reasonInputs[variant.id] || "").trim();
      const locationId = detail.data?.listing?.default_inventory_location_id;
      if (!locationId || !Number.isFinite(quantity) || !reason) throw new Error("Antal och orsak krävs.");
      const idempotencyKey = crypto.randomUUID();
      return correct
        ? apiPost("api-commerce", "inventory-correct", {
          venue_id: venueId, variant_id: variant.id, location_id: locationId,
          physical_on_hand: quantity, expected_version: variant.inventory?.version,
          allow_shortage: allowShortage[variant.id] === true, reason, idempotency_key: idempotencyKey,
        })
        : apiPost("api-commerce", "inventory-receive", {
          venue_id: venueId, variant_id: variant.id, location_id: locationId,
          quantity, reason, reference: reason, idempotency_key: idempotencyKey,
        });
    },
    onSuccess: async () => { await refresh(); toast.success("Lagret uppdaterades med en spårbar rörelse"); },
    onError: (error: Error) => toast.error(error.message),
  });

  const sales = useMutation({
    mutationFn: (enabled: boolean) => apiPatch("api-admin", "tracked-sales", { venueId, product_id: productId, enabled }),
    onSuccess: async () => { await refresh(); toast.success("Försäljningsläget uppdaterades"); },
    onError: (error: Error) => toast.error(error.message),
  });

  const refund = useMutation({
    mutationFn: ({ allocation, quantity }: { allocation: Allocation; quantity: number }) => apiPost<RefundResponse>("api-commerce", "refund", {
      venue_id: venueId,
      order_id: allocation.commerce_order_id,
      lines: [{ line_id: allocation.commerce_order_line_id, quantity }],
      reason: "Admin quantity refund",
      idempotency_key: crypto.randomUUID(),
    }),
    onSuccess: async (result) => { await refresh(); toast[result.recovery_pending ? "warning" : "success"](result.recovery_pending ? "Återbetalningen inväntar avstämning" : "Återbetalningen registrerades"); },
    onError: (error: Error) => toast.error(error.message),
  });

  const dispositions = useMutation({
    mutationFn: ({ allocation, outcome, refundId }: { allocation: Allocation; outcome: "return_sellable" | "return_damaged" | "uncollected_present" | "uncollected_missing"; refundId?: string }) => apiPost("api-commerce", "physical-disposition", {
      venue_id: venueId,
      line_id: allocation.commerce_order_line_id,
      quantity: 1,
      outcome,
      refund_id: refundId || null,
      reason: ({
        return_sellable: "Sellable return accepted",
        return_damaged: "Damaged return accepted",
        uncollected_present: "Refunded uncollected unit confirmed physically present",
        uncollected_missing: "Refunded uncollected unit confirmed physically missing",
      })[outcome],
      idempotency_key: crypto.randomUUID(),
    }),
    onSuccess: async () => { await refresh(); toast.success("Fysisk disposition registrerad"); },
    onError: (error: Error) => toast.error(error.message),
  });

  const selectedLabels = useMemo(() => Object.fromEntries((detail.data?.options || []).map((option) => [
    option.id,
    option.product_option_values.find((value) => value.id === selectedValues[option.id])?.label || "",
  ])), [detail.data?.options, selectedValues]);

  if (detail.isLoading) return <Loader2 className="mx-auto my-6 h-5 w-5 animate-spin" />;
  if (detail.isError || !detail.data) return <p className="px-4 py-5 text-sm text-destructive">Variant- och lagerdata kunde inte hämtas.</p>;

  if (!detail.data.listing) return (
    <section className="space-y-3 border-t border-border px-4 py-5">
      <div><h3 className="text-sm font-bold">Varianter och lager</h3><p className="mt-1 text-xs text-muted-foreground">Konfigurera ny katalogidentitet. Detta skapar inget lagersaldo och försäljning förblir avstängd.</p></div>
      <label className="block text-xs font-semibold text-muted-foreground">Juridisk säljare<input value={seller?.legal_name || "Saknas"} disabled className={`${inputClass} mt-1 opacity-70`} /></label>
      <label className="block text-xs font-semibold text-muted-foreground">Lager-/utlämningsplats<input value={locationName} onChange={(event) => setLocationName(event.target.value)} className={`${inputClass} mt-1`} /></label>
      <label className="block text-xs font-semibold text-muted-foreground">Färger, kommaseparerade<input value={colors} onChange={(event) => setColors(event.target.value)} className={`${inputClass} mt-1`} /></label>
      <label className="block text-xs font-semibold text-muted-foreground">Storlekar, kommaseparerade<input value={sizes} onChange={(event) => setSizes(event.target.value)} className={`${inputClass} mt-1`} /></label>
      <button type="button" onClick={() => setup.mutate()} disabled={setup.isPending || !seller} className="flex h-10 w-full items-center justify-center gap-2 rounded-lg bg-primary text-sm font-bold text-primary-foreground disabled:opacity-40">{setup.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Boxes className="h-4 w-4" />} Konfigurera spårat lager</button>
    </section>
  );

  return (
    <section className="space-y-5 border-t border-border px-4 py-5">
      <div className="flex items-center justify-between gap-3">
        <div><h3 className="text-sm font-bold">Varianter och lager</h3><p className="text-xs text-muted-foreground">{Array.isArray(detail.data.listing.inventory_locations) ? detail.data.listing.inventory_locations[0]?.name : detail.data.listing.inventory_locations?.name}</p></div>
        <button type="button" onClick={() => void refresh()} className="rounded-lg border border-border p-2" aria-label="Uppdatera lager"><RefreshCw className="h-4 w-4" /></button>
      </div>

      <label className="flex items-center justify-between gap-4 rounded-lg border border-border p-3"><span><span className="block text-sm font-semibold">Ny spårad försäljning</span><span className="block text-xs text-muted-foreground">Avstängning påverkar inte befintliga betalningar, uthämtningar eller returer.</span></span><Switch checked={detail.data.listing.tracked_sales_enabled} disabled={sales.isPending} onCheckedChange={(enabled) => sales.mutate(enabled)} /></label>

      <div className="space-y-3 rounded-lg border border-border p-3">
        <div className="flex items-center justify-between gap-2"><h4 className="text-sm font-bold">{editingVariantId ? "Redigera variant" : "Ny variant"}</h4>{editingVariantId ? <button type="button" onClick={() => { setEditingVariantId(null); setSku(""); setTitle(""); setOverrideSek(""); setSelectedValues({}); }} className="text-xs font-semibold text-muted-foreground">Avbryt</button> : null}</div>
        <div className="grid grid-cols-2 gap-2">
          {(detail.data.options || []).map((option) => <label key={option.id} className="text-xs font-semibold text-muted-foreground">{option.label}<select value={selectedValues[option.id] || ""} onChange={(event) => setSelectedValues((current) => ({ ...current, [option.id]: event.target.value }))} className={`${inputClass} mt-1`}><option value="">Välj</option>{option.product_option_values.filter((value) => value.status !== "archived").map((value) => <option key={value.id} value={value.id}>{value.label}</option>)}</select></label>)}
        </div>
        <input value={sku} onChange={(event) => setSku(event.target.value)} placeholder="SKU, t.ex. PCT-BLK-M" className={inputClass} />
        <input value={title} onChange={(event) => setTitle(event.target.value)} placeholder={Object.values(selectedLabels).filter(Boolean).join(" / ") || "Variantnamn (valfritt)"} className={inputClass} />
        <input type="number" min="0" step="0.01" value={overrideSek} onChange={(event) => setOverrideSek(event.target.value)} placeholder="Variantpris SEK (tomt = baspris)" className={inputClass} />
        <button type="button" onClick={() => saveVariant.mutate()} disabled={saveVariant.isPending} className="flex h-10 w-full items-center justify-center gap-2 rounded-lg border border-primary text-sm font-bold text-primary"><Plus className="h-4 w-4" /> {editingVariantId ? "Spara variant" : "Skapa variant"}</button>
      </div>

      <div className="space-y-3">
        {detail.data.variants.length === 0 ? <p className="text-sm text-muted-foreground">Inga varianter ännu.</p> : detail.data.variants.map((variant) => {
          const inventory = variant.inventory;
          const correct = correctionMode[variant.id] === true;
          return <div key={variant.id} className={`rounded-lg border p-3 ${inventory?.incident_blocked ? "border-destructive/50 bg-destructive/5" : "border-border"}`}>
            <div className="flex items-start justify-between gap-3"><div><p className="text-sm font-bold">{variant.title || variant.sku}</p><p className="text-xs text-muted-foreground">SKU {variant.sku} · {variant.status === "archived" ? "Arkiverad" : variant.price_override_minor == null ? "Baspris" : `${(variant.price_override_minor / 100).toFixed(2)} kr`}</p></div>{inventory?.incident_blocked ? <AlertTriangle className="h-4 w-4 text-destructive" /> : null}</div>
            <div className="mt-2 flex flex-wrap gap-2"><button type="button" onClick={() => {
              setEditingVariantId(variant.id); setSku(variant.sku); setTitle(variant.title || "");
              setOverrideSek(variant.price_override_minor == null ? "" : String(variant.price_override_minor / 100));
              setSelectedValues(Object.fromEntries(variant.product_variant_option_values.map((value) => [value.option_id, value.option_value_id])));
            }} className="rounded-md border border-border px-2 py-1 text-xs font-semibold">Redigera</button><button type="button" disabled={variantStatus.isPending} onClick={() => variantStatus.mutate({ variant, status: variant.status === "archived" ? "active" : "archived" })} className="rounded-md border border-border px-2 py-1 text-xs font-semibold">{variant.status === "archived" ? "Återaktivera" : "Arkivera"}</button></div>
            <div className="mt-3 grid grid-cols-4 gap-1 text-center text-[11px]"><span>På hand<strong className="block text-sm">{inventory?.on_hand ?? 0}</strong></span><span>Res.<strong className="block text-sm">{inventory?.reserved ?? 0}</strong></span><span>Allok.<strong className="block text-sm">{inventory?.allocated ?? 0}</strong></span><span>Tillg.<strong className="block text-sm">{inventory?.available_to_sell ?? 0}</strong></span></div>
            <div className="mt-3 flex items-center gap-2"><button type="button" onClick={() => setCorrectionMode((current) => ({ ...current, [variant.id]: false }))} className={`rounded-md px-2 py-1 text-xs ${!correct ? "bg-primary text-primary-foreground" : "bg-muted"}`}>Ta emot</button><button type="button" onClick={() => setCorrectionMode((current) => ({ ...current, [variant.id]: true }))} className={`rounded-md px-2 py-1 text-xs ${correct ? "bg-primary text-primary-foreground" : "bg-muted"}`}>Fysisk kontroll</button></div>
            <div className="mt-2 grid grid-cols-[90px_1fr_auto] gap-2"><input type="number" min={correct ? 0 : 1} value={stockInputs[variant.id] || ""} onChange={(event) => setStockInputs((current) => ({ ...current, [variant.id]: event.target.value }))} placeholder={correct ? "På hand" : "+ antal"} className={inputClass} /><input value={reasonInputs[variant.id] || ""} onChange={(event) => setReasonInputs((current) => ({ ...current, [variant.id]: event.target.value }))} placeholder="Orsak / referens" className={inputClass} /><button type="button" onClick={() => stock.mutate({ variant, correct })} disabled={stock.isPending || (correct && !inventory)} className="rounded-lg bg-primary px-3 text-sm font-bold text-primary-foreground">Spara</button></div>
            {correct ? <label className="mt-2 flex items-center gap-2 text-xs text-muted-foreground"><input type="checkbox" checked={allowShortage[variant.id] || false} onChange={(event) => setAllowShortage((current) => ({ ...current, [variant.id]: event.target.checked }))} /> Bekräfta verklig brist och öppna blockerande incident om åtaganden överstiger saldot</label> : null}
          </div>;
        })}
      </div>

      {(operations.data?.incidents || []).some((incident) => incident.status === "open") ? <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-3"><h4 className="text-sm font-bold text-destructive">Öppna lagerincidenter</h4><p className="mt-1 text-xs text-muted-foreground">Korrigera först saldot. Incidenten kan bara stängas när tillgängligt saldo inte längre är negativt och verifieringsunderlag finns.</p>{operations.data?.incidents.filter((incident) => incident.status === "open").map((incident) => <div key={incident.id} className="mt-3"><p className="text-xs">{incident.incident_type} · underskott {incident.deficit_quantity}</p><div className="mt-1 flex gap-2"><input value={incidentEvidence[incident.id] || ""} onChange={(event) => setIncidentEvidence((current) => ({ ...current, [incident.id]: event.target.value }))} placeholder="Verifiering, t.ex. fysisk omräkning och referens" className={inputClass} /><button type="button" disabled={resolveIncident.isPending} onClick={() => resolveIncident.mutate(incident.id)} className="rounded-lg border border-destructive/40 px-3 text-xs font-bold text-destructive">Stäng</button></div></div>)}</div> : null}

      {(operations.data?.attempts || []).length ? <div><h4 className="text-sm font-bold">Checkout behöver följas</h4>{operations.data?.attempts.map((attempt) => <p key={attempt.id} className="mt-1 text-xs text-muted-foreground">{attempt.status} · order {attempt.commerce_order_id.slice(0, 8)} · försök {attempt.recovery_attempts}{attempt.last_error ? ` · ${attempt.last_error}` : ""}</p>)}</div> : null}

      {(operations.data?.allocations || []).length ? <div className="space-y-2"><h4 className="text-sm font-bold">Återbetalning och fysisk retur</h4><p className="text-xs text-muted-foreground">Pengar och fysisk vara registreras separat.</p>{operations.data?.allocations.slice(0, 20).map((allocation) => {
        const line = Array.isArray(allocation.commerce_order_lines) ? allocation.commerce_order_lines[0] : allocation.commerce_order_lines;
        const alreadyRefunded = (operations.data?.refunds || [])
          .filter((item) => ["preparing", "pending", "succeeded"].includes(item.status))
          .flatMap((item) => item.commerce_refund_lines || [])
          .filter((refundLine) => refundLine.commerce_order_line_id === allocation.commerce_order_line_id)
          .reduce((sum, refundLine) => sum + Number(refundLine.quantity || 0), 0);
        const remainingRefundable = Math.max(0, Number(allocation.quantity || 0) - alreadyRefunded);
        const uncollected = Math.max(0, Number(allocation.quantity) - Number(allocation.collected_quantity) - Number(line?.cancelled_quantity || 0));
        const succeededRefund = operations.data?.refunds.find((item) => item.commerce_order_id === allocation.commerce_order_id
          && item.status === "succeeded"
          && item.commerce_refund_lines?.some((refundLine) => refundLine.commerce_order_line_id === allocation.commerce_order_line_id));
        return <div key={allocation.id} className="rounded-lg border border-border p-3"><p className="text-sm font-bold">{line?.product_name} · {line?.sku}</p><p className="text-xs text-muted-foreground">Utlämnat {allocation.collected_quantity}/{allocation.quantity}</p><div className="mt-2 flex flex-wrap gap-2"><button type="button" disabled={refund.isPending || remainingRefundable < 1} onClick={() => refund.mutate({ allocation, quantity: 1 })} className="rounded-md border border-border px-2 py-1 text-xs font-semibold">Återbetala 1</button><button type="button" disabled={dispositions.isPending || Number(allocation.collected_quantity) < 1} onClick={() => dispositions.mutate({ allocation, outcome: "return_sellable", refundId: succeededRefund?.id })} className="rounded-md border border-border px-2 py-1 text-xs font-semibold">Retur säljbar</button><button type="button" disabled={dispositions.isPending || Number(allocation.collected_quantity) < 1} onClick={() => dispositions.mutate({ allocation, outcome: "return_damaged", refundId: succeededRefund?.id })} className="rounded-md border border-border px-2 py-1 text-xs font-semibold">Retur skadad</button><button type="button" disabled={dispositions.isPending || uncollected < 1 || !succeededRefund} onClick={() => dispositions.mutate({ allocation, outcome: "uncollected_present", refundId: succeededRefund?.id })} className="rounded-md border border-border px-2 py-1 text-xs font-semibold">Ej uthämtad · finns</button><button type="button" disabled={dispositions.isPending || uncollected < 1 || !succeededRefund} onClick={() => dispositions.mutate({ allocation, outcome: "uncollected_missing", refundId: succeededRefund?.id })} className="rounded-md border border-destructive/40 px-2 py-1 text-xs font-semibold text-destructive">Ej uthämtad · saknas</button></div></div>;
      })}</div> : null}

      {(operations.data?.movements || []).length ? <details><summary className="cursor-pointer text-sm font-bold">Senaste lagerrörelser</summary><div className="mt-2 space-y-1">{operations.data?.movements.slice(0, 20).map((movement) => <p key={movement.id} className="text-xs text-muted-foreground">{movement.movement_type}: hand {movement.on_hand_delta >= 0 ? "+" : ""}{movement.on_hand_delta}, res {movement.reserved_delta >= 0 ? "+" : ""}{movement.reserved_delta}, allok {movement.allocated_delta >= 0 ? "+" : ""}{movement.allocated_delta} · {movement.reason}</p>)}</div></details> : null}
    </section>
  );
}
