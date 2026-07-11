import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Copy, ExternalLink, Loader2, Pencil, Plus, RotateCcw, TabletSmartphone } from "lucide-react";
import { apiDelete, apiGet, apiPatch, apiPost } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { canonicalAppUrl } from "@/lib/canonicalOrigin";

interface Court {
  id: string;
  name: string;
  court_number: number;
  sport_type: string | null;
}

interface DisplayDevice {
  id: string;
  name: string;
  device_token: string;
  venue_court_id: string | null;
  mode: string;
  is_active: boolean;
  last_seen_at: string | null;
  instructions?: string | null;
  external_links?: Array<{ label: string; url: string }>;
  venue_courts?: Court | null;
}

function linksToText(links?: Array<{ label: string; url: string }>) {
  return (links || []).map((link) => `${link.label} | ${link.url}`).join("\n");
}

function parseLinks(text: string) {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [label, ...urlParts] = line.split("|").map((part) => part.trim());
      const url = urlParts.join("|").trim();
      return { label, url };
    })
    .filter((link) => link.label && link.url && /^https?:\/\//i.test(link.url))
    .slice(0, 8);
}

export default function AdminDevices({ venueId }: { venueId: string }) {
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [courtId, setCourtId] = useState("");
  const [creating, setCreating] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editCourtId, setEditCourtId] = useState("");
  const [editLinks, setEditLinks] = useState("");
  const [editInstructions, setEditInstructions] = useState("");

  const { data: devices = [], isLoading } = useQuery<DisplayDevice[]>({
    queryKey: ["admin-display-devices", venueId],
    queryFn: () => apiGet("api-admin", "display-devices", { venueId }),
  });

  const { data: courts = [] } = useQuery<Court[]>({
    queryKey: ["admin-courts", venueId],
    queryFn: () => apiGet("api-admin", "courts", { venueId }),
  });

  const sortedCourts = useMemo(
    () => [...courts].sort((a, b) => (a.sport_type || "").localeCompare(b.sport_type || "") || a.court_number - b.court_number),
    [courts],
  );

  const createDevice = useMutation({
    mutationFn: () => apiPost("api-admin", "display-devices", {
      venueId,
      name: name.trim(),
      venue_court_id: courtId || null,
      mode: "resource_home",
      external_links: selectedCourt?.sport_type === "dart"
        ? [{ label: "Nakka", url: "https://n01darts.com/n01/web/n01.html" }]
        : [],
    }),
    onSuccess: () => {
      setName("");
      setCourtId("");
      setCreating(false);
      qc.invalidateQueries({ queryKey: ["admin-display-devices", venueId] });
      toast.success("Padda skapad");
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const updateDevice = useMutation({
    mutationFn: (body: Record<string, any>) => apiPatch("api-admin", "display-devices", { venueId, ...body }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin-display-devices", venueId] });
      toast.success("Padda uppdaterad");
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const deleteDevice = useMutation({
    mutationFn: (deviceId: string) => apiDelete("api-admin", "display-devices", { venueId, deviceId }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin-display-devices", venueId] });
      toast.success("Padda borttagen");
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const selectedCourt = sortedCourts.find((court) => court.id === courtId);
  const deviceUrl = (token: string) => canonicalAppUrl(`/display/device/${token}`);

  const startEdit = (device: DisplayDevice) => {
    setEditingId(device.id);
    setEditName(device.name);
    setEditCourtId(device.venue_court_id || "");
    setEditLinks(linksToText(device.external_links));
    setEditInstructions(device.instructions || "");
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditName("");
    setEditCourtId("");
    setEditLinks("");
    setEditInstructions("");
  };

  const saveEdit = (deviceId: string) => {
    updateDevice.mutate({
      deviceId,
      name: editName.trim(),
      venue_court_id: editCourtId || null,
      external_links: parseLinks(editLinks),
      instructions: editInstructions.trim() || null,
    }, {
      onSuccess: cancelEdit,
    });
  };

  const copy = async (text: string, label = "Kopierad") => {
    await navigator.clipboard.writeText(text);
    toast.success(label);
  };

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-border bg-card p-4">
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10">
            <TabletSmartphone className="h-5 w-5 text-primary" />
          </div>
          <div>
            <h2 className="font-display text-lg font-bold">Paddor / Devices</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Skapa en länk per fysisk padda. Öppna länken på paddan och lägg den i kiosk- eller hemskärmsläge.
            </p>
          </div>
        </div>
      </div>

      <div className="rounded-2xl border border-dashed border-border bg-card p-4">
        {!creating ? (
          <Button onClick={() => setCreating(true)} className="w-full gap-2">
            <Plus className="h-4 w-4" />
            Skapa padda
          </Button>
        ) : (
          <div className="space-y-3">
            <Input placeholder="Namn, t.ex. Dartpadda 7" value={name} onChange={(e) => setName(e.target.value)} />
            <select
              value={courtId}
              onChange={(e) => setCourtId(e.target.value)}
              className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
            >
              <option value="">Ingen resurs / venue home</option>
              {sortedCourts.map((court) => (
                <option key={court.id} value={court.id}>
                  {court.name} · {court.sport_type || "resource"}
                </option>
              ))}
            </select>
            <div className="flex gap-2">
              <Button onClick={() => createDevice.mutate()} disabled={!name.trim() || createDevice.isPending} className="flex-1">
                {createDevice.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Skapa"}
              </Button>
              <Button variant="outline" onClick={() => setCreating(false)}>Avbryt</Button>
            </div>
          </div>
        )}
      </div>

      {isLoading ? (
        <div className="flex justify-center py-10">
          <Loader2 className="h-5 w-5 animate-spin text-primary" />
        </div>
      ) : (
        <div className="space-y-3">
          {devices.map((device) => {
            const url = deviceUrl(device.device_token);
            const editing = editingId === device.id;
            return (
              <div key={device.id} className="rounded-2xl border border-border bg-card p-4">
                {editing ? (
                  <div className="mb-4 space-y-3">
                    <Input value={editName} onChange={(e) => setEditName(e.target.value)} placeholder="Paddnamn" />
                    <select
                      value={editCourtId}
                      onChange={(e) => setEditCourtId(e.target.value)}
                      className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                    >
                      <option value="">Ingen resurs / venue home</option>
                      {sortedCourts.map((court) => (
                        <option key={court.id} value={court.id}>
                          {court.name} · {court.sport_type || "resource"}
                        </option>
                      ))}
                    </select>
                    <Textarea
                      value={editLinks}
                      onChange={(e) => setEditLinks(e.target.value)}
                      placeholder="Externa länkar, en per rad: Nakka | https://n01darts.com/n01/web/n01.html"
                      rows={3}
                    />
                    <Textarea
                      value={editInstructions}
                      onChange={(e) => setEditInstructions(e.target.value)}
                      placeholder="Intern instruktion för denna padda"
                      rows={2}
                    />
                    <div className="flex gap-2">
                      <Button
                        onClick={() => saveEdit(device.id)}
                        disabled={!editName.trim() || updateDevice.isPending}
                        className="flex-1"
                      >
                        {updateDevice.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Spara"}
                      </Button>
                      <Button variant="outline" onClick={cancelEdit}>Avbryt</Button>
                    </div>
                  </div>
                ) : (
                  <div className="mb-3 flex items-start justify-between gap-3">
                    <div>
                      <p className="font-display text-base font-bold">{device.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {device.venue_courts?.name || "Venue home"} · {device.is_active ? "Aktiv" : "Avstängd"}
                      </p>
                      {device.external_links?.length ? (
                        <p className="mt-1 text-[10px] text-muted-foreground">
                          länkar: {device.external_links.map((link) => link.label).join(", ")}
                        </p>
                      ) : null}
                      {device.last_seen_at && (
                        <p className="mt-1 text-[10px] text-muted-foreground">
                          senast sedd {new Date(device.last_seen_at).toLocaleString("sv-SE")}
                        </p>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      <Button variant="outline" size="sm" onClick={() => startEdit(device)} className="gap-2">
                        <Pencil className="h-3.5 w-3.5" />
                        Redigera
                      </Button>
                      <button
                        onClick={() => updateDevice.mutate({ deviceId: device.id, is_active: !device.is_active })}
                        className={`rounded-full px-3 py-1 text-xs font-bold ${device.is_active ? "bg-emerald-500/10 text-emerald-600" : "bg-muted text-muted-foreground"}`}
                      >
                        {device.is_active ? "ON" : "OFF"}
                      </button>
                    </div>
                  </div>
                )}

                <div className="mb-3 rounded-xl bg-muted/40 p-3">
                  <p className="break-all font-mono text-xs text-muted-foreground">{url}</p>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <Button variant="outline" size="sm" onClick={() => copy(url, "Device-länk kopierad")} className="gap-2">
                    <Copy className="h-3.5 w-3.5" />
                    Kopiera
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => window.open(url, "_blank")} className="gap-2">
                    <ExternalLink className="h-3.5 w-3.5" />
                    Öppna
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => updateDevice.mutate({ deviceId: device.id, rotate_token: true })}
                    className="gap-2"
                  >
                    <RotateCcw className="h-3.5 w-3.5" />
                    Rotera token
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => deleteDevice.mutate(device.id)}
                    className="text-destructive hover:text-destructive"
                  >
                    Ta bort
                  </Button>
                </div>
              </div>
            );
          })}
          {devices.length === 0 && (
            <div className="rounded-2xl border border-border bg-card p-6 text-center">
              <p className="text-sm text-muted-foreground">Inga paddor skapade än.</p>
            </div>
          )}
        </div>
      )}

      <div className="rounded-2xl border border-border bg-card p-4">
        <p className="font-display text-sm font-bold">Instruktion</p>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
          Öppna device-länken på paddan, välj “Lägg till på hemskärmen” eller lås webbläsaren i kiosk-läge.
          Token kan roteras om en länk läcker. Själva incheckningen kräver fortfarande giltig 4-siffrig bokningskod.
        </p>
      </div>
    </div>
  );
}
