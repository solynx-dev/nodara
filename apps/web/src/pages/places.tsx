import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import maplibregl, { type Map as MLMap } from 'maplibre-gl';
import { Bell, BellOff, Crosshair, MapPin, Pencil, Plus, Search, Trash2, X } from 'lucide-react';
import { circlePolygon } from '@nodara/shared';
import { api, qs } from '@/lib/api';
import { ago, coords, formatDistance } from '@/lib/format';
import { useCircles, useConfig, useLive, useUser } from '@/lib/queries';
import type { CircleDetail, PlaceAlert, PlaceEvent, PlaceWithMeta } from '@/lib/types';
import { Avatar, Badge, Button, Card, cx, Dialog, EmptyState, ErrorNote, IconButton, Input, Select, Spinner, Switch } from '@/components/ui';
import { useToast } from '@/components/toast';
import { MapView, setGeoJson } from '@/features/map/MapView';
import { HtmlMarker, PlacesLayer, useStyleEffect } from '@/features/map/layers';
import { PLACE_COLORS, PLACE_ICONS, PlaceIcon } from '@/features/map/icons';

interface Draft {
  id?: string;
  name: string;
  lat: number;
  lon: number;
  radiusM: number;
  icon: string;
  color: string;
  circleId: string | null;
  address: string | null;
}

export default function PlacesPage() {
  const me = useUser();
  const qc = useQueryClient();
  const toast = useToast();
  const { data: places = [], isLoading } = useQuery({ queryKey: ['places'], queryFn: () => api.get<PlaceWithMeta[]>('/api/places') });
  const { data: circles = [] } = useCircles();
  const { data: members = [] } = useLive(null);
  const [map, setMap] = useState<MLMap | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [alertsFor, setAlertsFor] = useState<PlaceWithMeta | null>(null);
  const [selected, setSelected] = useState<string | null>(null);

  const startNew = (lat?: number, lon?: number) => {
    const c = map?.getCenter();
    setDraft({
      name: '',
      lat: lat ?? c?.lat ?? 0,
      lon: lon ?? c?.lng ?? 0,
      radiusM: 150,
      icon: 'home',
      color: PLACE_COLORS[0]!,
      circleId: circles[0]?.id ?? null,
      address: null,
    });
  };

  // Click the map to drop a pin while drafting.
  useEffect(() => {
    if (!map) return;
    const click = (e: maplibregl.MapMouseEvent) => setDraft((d) => (d ? { ...d, lat: e.lngLat.lat, lon: e.lngLat.lng } : d));
    map.on('click', click);
    return () => {
      map.off('click', click);
    };
  }, [map]);

  useEffect(() => {
    if (!map || places.length === 0 || draft) return;
    const b = new maplibregl.LngLatBounds();
    places.forEach((p) => b.extend([p.lon, p.lat]));
    map.fitBounds(b, { padding: 80, maxZoom: 15, duration: 0 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, places.length]);

  const save = useMutation({
    mutationFn: (d: Draft) => (d.id ? api.patch(`/api/places/${d.id}`, d) : api.post('/api/places', d)),
    onSuccess: (_r, d) => {
      qc.invalidateQueries({ queryKey: ['places'] });
      toast({ tone: 'success', title: d.id ? 'Place updated' : `${d.name} saved`, body: d.circleId ? 'Circle members will see arrivals and departures.' : 'Only you can see this place.' });
      setDraft(null);
    },
  });
  const remove = useMutation({
    mutationFn: (id: string) => api.del(`/api/places/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['places'] }),
  });
  const byId = new Map(members.map((m) => [m.id, m]));
  const visiblePlaces = draft?.id ? places.filter((p) => p.id !== draft.id) : places;

  return (
    <div className="flex min-h-full flex-col lg:h-full lg:flex-row">
      <aside className="order-2 w-full shrink-0 border-line lg:order-1 lg:w-[400px] lg:overflow-y-auto lg:border-r">
        <div className="p-4 sm:p-5">
          {draft ? (
            <PlaceEditor draft={draft} setDraft={setDraft} circles={circles} onCancel={() => setDraft(null)} onSave={() => save.mutate(draft)} saving={save.isPending} error={save.error} map={map} />
          ) : (
            <>
              <div className="mb-5 flex items-end justify-between gap-3">
                <div>
                  <h1 className="text-[24px] font-extrabold tracking-[-0.03em]">Places</h1>
                  <p className="text-[13px] text-muted">Get notified when people arrive or leave.</p>
                </div>
                <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => startNew()}>
                  Add place
                </Button>
              </div>
              {isLoading ? (
                <Spinner />
              ) : places.length === 0 ? (
                <EmptyState icon={<MapPin className="size-7" />} title="No places yet" body="Add Home, School or Work. Nodara will record arrivals and departures and notify the people who ask for it." />
              ) : (
                <ul className="space-y-2">
                  {places.map((p) => (
                    <li key={p.id}>
                      <div
                        className={cx('card flex cursor-pointer items-center gap-3 p-3 transition hover:border-line-strong', selected === p.id && 'border-accent')}
                        onClick={() => {
                          setSelected(p.id);
                          map?.flyTo({ center: [p.lon, p.lat], zoom: 15.5 });
                        }}
                      >
                        <div className="flex size-11 shrink-0 items-center justify-center rounded-xl text-white" style={{ background: p.color }}>
                          <PlaceIcon name={p.icon} className="size-5" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <span className="truncate text-[15px] font-bold">{p.name}</span>
                            {!p.circleId && <Badge>Private</Badge>}
                          </div>
                          <div className="truncate text-[12.5px] text-muted">
                            {p.circleId ? circles.find((c) => c.id === p.circleId)?.name : 'Only you'} · {formatDistance(p.radiusM, me.preferences.units)} radius
                          </div>
                          {p.membersInside.length > 0 && (
                            <div className="mt-1.5 flex items-center gap-1.5">
                              <div className="flex -space-x-1.5">
                                {p.membersInside.map((id) => {
                                  const m = byId.get(id);
                                  return m ? <Avatar key={id} name={m.displayName} color={m.avatarColor} size={20} className="ring-2 ring-surface" /> : null;
                                })}
                              </div>
                              <span className="text-[12px] font-semibold text-success">here now</span>
                            </div>
                          )}
                        </div>
                        <div className="flex shrink-0 items-center" onClick={(e) => e.stopPropagation()}>
                          {p.circleId && (
                            <IconButton label="Alerts" active={p.alertCount > 0} onClick={() => setAlertsFor(p)}>
                              {p.alertCount > 0 ? <Bell className="size-4" /> : <BellOff className="size-4" />}
                            </IconButton>
                          )}
                          {p.canEdit && (
                            <IconButton label="Edit" onClick={() => setDraft({ id: p.id, name: p.name, lat: p.lat, lon: p.lon, radiusM: p.radiusM, icon: p.icon, color: p.color, circleId: p.circleId, address: p.address })}>
                              <Pencil className="size-4" />
                            </IconButton>
                          )}
                          {p.canEdit && (
                            <IconButton label="Delete" onClick={() => window.confirm(`Delete ${p.name}?`) && remove.mutate(p.id)}>
                              <Trash2 className="size-4" />
                            </IconButton>
                          )}
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
              {selected && <PlaceEvents placeId={selected} />}
            </>
          )}
        </div>
      </aside>
      <section className="relative order-1 h-[46vh] shrink-0 lg:order-2 lg:h-auto lg:flex-1">
        <MapView className="absolute inset-0" onReady={setMap}>
          {map && <PlacesLayer map={map} places={visiblePlaces} onSelect={setSelected} />}
          {map && draft && <DraftLayer map={map} draft={draft} />}
          {map && draft && (
            <HtmlMarker map={map} lon={draft.lon} lat={draft.lat} anchor="bottom">
              <div className="flex flex-col items-center">
                <div className="flex size-10 items-center justify-center rounded-full border-[3px] border-white text-white shadow-lg" style={{ background: draft.color }}>
                  <PlaceIcon name={draft.icon} className="size-5" />
                </div>
                <div className="h-3 w-0.5 bg-ink/70" />
              </div>
            </HtmlMarker>
          )}
        </MapView>
        {draft && (
          <div className="absolute top-3 left-1/2 z-10 -translate-x-1/2 rounded-xl border border-line bg-elevated/95 px-3 py-1.5 text-[12.5px] font-semibold shadow-card backdrop-blur">
            Tap the map to move the pin
          </div>
        )}
      </section>
      {alertsFor && <AlertsDialog place={alertsFor} onClose={() => setAlertsFor(null)} />}
    </div>
  );
}

function DraftLayer({ map, draft }: { map: MLMap; draft: Draft }) {
  useStyleEffect(
    map,
    (m) => {
      setGeoJson(m, 'nd-draft', { type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [circlePolygon(draft.lat, draft.lon, draft.radiusM)] } });
      if (!m.getLayer('nd-draft-fill')) {
        m.addLayer({ id: 'nd-draft-fill', type: 'fill', source: 'nd-draft', paint: { 'fill-color': draft.color, 'fill-opacity': 0.16 } });
        m.addLayer({ id: 'nd-draft-line', type: 'line', source: 'nd-draft', paint: { 'line-color': draft.color, 'line-width': 2 } });
      } else {
        m.setPaintProperty('nd-draft-fill', 'fill-color', draft.color);
        m.setPaintProperty('nd-draft-line', 'line-color', draft.color);
      }
    },
    [draft.lat, draft.lon, draft.radiusM, draft.color],
  );
  useEffect(
    () => () => {
      if (!map.getStyle()) return;
      for (const l of ['nd-draft-fill', 'nd-draft-line']) if (map.getLayer(l)) map.removeLayer(l);
      if (map.getSource('nd-draft')) map.removeSource('nd-draft');
    },
    [map],
  );
  return null;
}

function PlaceEditor({
  draft,
  setDraft,
  circles,
  onCancel,
  onSave,
  saving,
  error,
  map,
}: {
  draft: Draft;
  setDraft: (d: Draft) => void;
  circles: { id: string; name: string }[];
  onCancel: () => void;
  onSave: () => void;
  saving: boolean;
  error: unknown;
  map: MLMap | null;
}) {
  const me = useUser();
  const { data: config } = useConfig();
  const [q, setQ] = useState('');
  const [search, setSearch] = useState('');
  useEffect(() => {
    const t = setTimeout(() => setSearch(q.trim()), 450);
    return () => clearTimeout(t);
  }, [q]);
  const center = map?.getCenter();
  const results = useQuery({
    queryKey: ['geocode', search],
    enabled: search.length >= 3,
    queryFn: () => api.get<{ enabled: boolean; results: { label: string; lat: number; lon: number }[] }>(`/api/geocode/search${qs({ q: search, lat: center?.lat, lon: center?.lng })}`),
  });
  const useMyLocation = () =>
    navigator.geolocation.getCurrentPosition((p) => {
      setDraft({ ...draft, lat: p.coords.latitude, lon: p.coords.longitude });
      map?.flyTo({ center: [p.coords.longitude, p.coords.latitude], zoom: 16 });
    });
  const radiusSteps = [25, 50, 75, 100, 150, 200, 300, 500, 750, 1000, 2000, 5000];
  const ri = radiusSteps.findIndex((r) => r >= draft.radiusM);
  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <h2 className="text-[20px] font-extrabold tracking-tight">{draft.id ? 'Edit place' : 'New place'}</h2>
        <IconButton label="Cancel" onClick={onCancel}>
          <X className="size-5" />
        </IconButton>
      </div>
      <div className="relative">
        {config?.geocoding ? (
          <div className="relative">
            <Search className="pointer-events-none absolute top-3 left-3.5 size-4.5 text-muted" />
            <input className="field pl-10" placeholder="Search for an address or place" value={q} onChange={(e) => setQ(e.target.value)} />
            {results.data && search.length >= 3 && (
              <div className="absolute inset-x-0 top-full z-20 mt-1 max-h-72 overflow-y-auto rounded-xl border border-line bg-elevated p-1 shadow-float">
                {results.data.results.length === 0 && <div className="px-3 py-2 text-[13px] text-muted">No results</div>}
                {results.data.results.map((r, i) => (
                  <button
                    key={i}
                    className="flex w-full items-start gap-2 rounded-lg px-3 py-2 text-left text-[13.5px] hover:bg-surface-2"
                    onClick={() => {
                      setDraft({ ...draft, lat: r.lat, lon: r.lon, address: r.label, name: draft.name || r.label.split(',')[0]! });
                      map?.flyTo({ center: [r.lon, r.lat], zoom: 16 });
                      setQ('');
                    }}
                  >
                    <MapPin className="mt-0.5 size-4 shrink-0 text-muted" />
                    {r.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        ) : (
          <p className="rounded-xl bg-surface-2 p-3 text-[12.5px] text-muted">Address search is off on this server. Tap the map to place the pin, or use your current location.</p>
        )}
        <Button size="sm" variant="ghost" className="mt-2" icon={<Crosshair className="size-4" />} onClick={useMyLocation}>
          Use my current location
        </Button>
      </div>
      <Input label="Name" placeholder="Home, School, Grandma's…" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} maxLength={60} />
      <div>
        <div className="label mb-2 flex justify-between">
          <span>Radius</span>
          <span className="tnum text-ink">{formatDistance(draft.radiusM, me.preferences.units)}</span>
        </div>
        <input type="range" min={0} max={radiusSteps.length - 1} value={ri < 0 ? radiusSteps.length - 1 : ri} onChange={(e) => setDraft({ ...draft, radiusM: radiusSteps[Number(e.target.value)]! })} className="w-full" />
        <p className="mt-1 text-[12px] text-muted">Larger radii are more reliable with imprecise GPS. 100–200 m suits most homes.</p>
      </div>
      <div>
        <div className="label mb-2">Icon</div>
        <div className="grid grid-cols-6 gap-1.5">
          {Object.entries(PLACE_ICONS).map(([k, v]) => (
            <button key={k} title={v.label} onClick={() => setDraft({ ...draft, icon: k })} className={cx('flex aspect-square items-center justify-center rounded-xl border transition', draft.icon === k ? 'border-accent bg-accent-soft text-accent-text' : 'border-line hover:bg-surface-2')}>
              <v.icon className="size-5" />
            </button>
          ))}
        </div>
      </div>
      <div>
        <div className="label mb-2">Colour</div>
        <div className="flex flex-wrap gap-2">
          {PLACE_COLORS.map((c) => (
            <button key={c} aria-label={c} onClick={() => setDraft({ ...draft, color: c })} className={cx('size-8 rounded-full', draft.color === c && 'ring-2 ring-ink ring-offset-2 ring-offset-bg')} style={{ background: c }} />
          ))}
        </div>
      </div>
      <Select label="Shared with" value={draft.circleId ?? ''} onChange={(e) => setDraft({ ...draft, circleId: e.target.value || null })}>
        {circles.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
        <option value="">Only me (private)</option>
      </Select>
      <div className="tnum text-[12px] text-muted">{coords(draft.lat, draft.lon)}</div>
      <ErrorNote error={error} />
      <div className="flex gap-2">
        <Button variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button variant="primary" className="flex-1" onClick={onSave} loading={saving} disabled={!draft.name.trim()}>
          {draft.id ? 'Save changes' : 'Save place'}
        </Button>
      </div>
    </div>
  );
}

function AlertsDialog({ place, onClose }: { place: PlaceWithMeta; onClose: () => void }) {
  const me = useUser();
  const qc = useQueryClient();
  const { data: circle } = useQuery({ queryKey: ['circle', place.circleId], queryFn: () => api.get<CircleDetail>(`/api/circles/${place.circleId}`) });
  const { data: existing } = useQuery({ queryKey: ['place-alerts', place.id], queryFn: () => api.get<PlaceAlert[]>(`/api/places/${place.id}/alerts`) });
  const [state, setState] = useState<Record<string, { onArrive: boolean; onDepart: boolean }>>({});
  useEffect(() => {
    if (!existing || !circle) return;
    const all = existing.find((a) => a.memberId === null);
    const s: typeof state = {};
    for (const m of circle.members) {
      if (m.id === me.id) continue;
      const a = existing.find((x) => x.memberId === m.id) ?? all;
      s[m.id] = { onArrive: a?.onArrive ?? false, onDepart: a?.onDepart ?? false };
    }
    setState(s);
  }, [existing, circle, me.id]);
  const save = useMutation({
    mutationFn: () => {
      const entries = Object.entries(state);
      const allSame = entries.length > 0 && entries.every(([, v]) => v.onArrive === entries[0]![1].onArrive && v.onDepart === entries[0]![1].onDepart);
      const alerts = allSame ? [{ memberId: null, ...entries[0]![1] }] : entries.map(([memberId, v]) => ({ memberId, ...v }));
      return api.put(`/api/places/${place.id}/alerts`, { alerts });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['places'] });
      qc.invalidateQueries({ queryKey: ['place-alerts', place.id] });
      onClose();
    },
  });
  const others = useMemo(() => circle?.members.filter((m) => m.id !== me.id) ?? [], [circle, me.id]);
  return (
    <Dialog
      open
      onClose={onClose}
      title={`Alerts for ${place.name}`}
      description="Choose whose arrivals and departures notify you."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" onClick={() => save.mutate()} loading={save.isPending}>
            Save alerts
          </Button>
        </>
      }
    >
      <div className="divide-y divide-line pb-2">
        {others.length === 0 && <p className="py-4 text-[14px] text-muted">Invite people to this circle to get alerts about them.</p>}
        {others.map((m) => (
          <div key={m.id} className="flex items-center gap-3 py-3">
            <Avatar name={m.displayName} color={m.avatarColor} size={34} />
            <div className="flex-1 text-[14px] font-semibold">{m.displayName}</div>
            <label className="flex items-center gap-1.5 text-[12.5px] font-semibold text-muted">
              Arrives
              <Switch checked={state[m.id]?.onArrive ?? false} onChange={(v) => setState({ ...state, [m.id]: { ...state[m.id]!, onArrive: v } })} />
            </label>
            <label className="flex items-center gap-1.5 text-[12.5px] font-semibold text-muted">
              Leaves
              <Switch checked={state[m.id]?.onDepart ?? false} onChange={(v) => setState({ ...state, [m.id]: { ...state[m.id]!, onDepart: v } })} />
            </label>
          </div>
        ))}
      </div>
      <p className="pb-2 text-[12px] text-muted">Alerts depend on the person’s device reporting location. Browsers can’t monitor places in the background, so alerts may be delayed for web-only users.</p>
      <ErrorNote error={save.error} />
    </Dialog>
  );
}

function PlaceEvents({ placeId }: { placeId: string }) {
  const { data = [] } = useQuery({ queryKey: ['place-events', placeId], queryFn: () => api.get<PlaceEvent[]>(`/api/place-events?placeId=${placeId}&limit=15`) });
  if (!data.length) return null;
  return (
    <Card className="mt-5 p-4">
      <div className="eyebrow mb-2">Recent activity</div>
      <ul className="space-y-1.5">
        {data.map((e) => (
          <li key={e.id} className="flex items-center gap-2.5 text-[13px]">
            <Avatar name={e.user.displayName} color={e.user.avatarColor} size={24} />
            <span className="flex-1">
              <b>{e.user.displayName.split(' ')[0]}</b> {e.kind === 'arrive' ? 'arrived' : 'left'}
            </span>
            <span className="text-muted">{ago(e.occurredAt)}</span>
          </li>
        ))}
      </ul>
    </Card>
  );
}
