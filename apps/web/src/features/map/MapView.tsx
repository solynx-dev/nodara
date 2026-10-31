import { forwardRef, useEffect, useImperativeHandle, useRef, useState, type ReactNode } from 'react';
import maplibregl, { type LngLatBoundsLike, type Map as MLMap } from 'maplibre-gl';
import { useConfig, useMe } from '@/lib/queries';
import { currentTheme } from '@/lib/theme';
import { pickStyle, resolveStyle } from './styles';
import { cx } from '@/components/ui';

export interface MapHandle {
  map: MLMap | null;
  flyTo: (lon: number, lat: number, zoom?: number) => void;
  fit: (bounds: LngLatBoundsLike, padding?: number, maxZoom?: number) => void;
}

interface Props {
  className?: string;
  center?: [number, number];
  zoom?: number;
  interactive?: boolean;
  controls?: boolean;
  styleId?: string | null;
  onReady?: (map: MLMap) => void;
  /** Called after every style (re)load so callers can (re)add sources & layers. */
  onStyle?: (map: MLMap) => void;
  children?: ReactNode;
}

/**
 * MapLibre GL wrapper. Tile providers come from the server configuration so
 * administrators can point Nodara at their own tile infrastructure.
 */
export const MapView = forwardRef<MapHandle, Props>(function MapView(
  { className, center = [-79.38, 43.65], zoom = 11, interactive = true, controls = true, styleId, onReady, onStyle, children },
  ref,
) {
  const container = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MLMap | null>(null);
  const [loaded, setLoaded] = useState(false);
  const { data: config } = useConfig();
  const { data: me } = useMe();
  const [theme, setTheme] = useState(currentTheme());
  const onStyleRef = useRef(onStyle);
  onStyleRef.current = onStyle;

  useEffect(() => {
    const f = (e: Event) => setTheme((e as CustomEvent).detail);
    window.addEventListener('nodara:theme', f);
    return () => window.removeEventListener('nodara:theme', f);
  }, []);

  const styleOpt = config ? pickStyle(config.mapStyles, styleId ?? me?.preferences.mapStyle ?? null, theme) : undefined;

  useImperativeHandle(ref, () => ({
    get map() {
      return mapRef.current;
    },
    flyTo(lon, lat, z) {
      mapRef.current?.flyTo({ center: [lon, lat], zoom: z ?? Math.max(mapRef.current.getZoom(), 14), speed: 1.4, essential: true });
    },
    fit(bounds, padding = 64, maxZoom = 15) {
      mapRef.current?.fitBounds(bounds, { padding, maxZoom, duration: 700 });
    },
  }));

  useEffect(() => {
    if (!container.current || !config) return;
    const map = new maplibregl.Map({
      container: container.current,
      style: resolveStyle(styleOpt),
      center,
      zoom,
      interactive,
      attributionControl: { compact: true },
      fadeDuration: 150,
      pitchWithRotate: false,
      dragRotate: interactive,
    });
    mapRef.current = map;
    // Phones have pinch-zoom; the zoom buttons only crowd the screen there.
    if (controls && interactive && window.matchMedia('(min-width: 1024px)').matches) {
      map.addControl(new maplibregl.NavigationControl({ visualizePitch: false, showCompass: true }), 'top-right');
    }
    map.on('style.load', () => onStyleRef.current?.(map));
    map.on('load', () => {
      setLoaded(true);
      onReady?.(map);
    });
    const ro = new ResizeObserver(() => map.resize());
    ro.observe(container.current);
    return () => {
      ro.disconnect();
      map.remove();
      mapRef.current = null;
      setLoaded(false);
    };
    // Recreate only when config arrives; style changes are applied below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [Boolean(config)]);

  // Swap styles in place (theme or preference change).
  const styleKey = styleOpt?.id;
  const firstStyle = useRef(true);
  useEffect(() => {
    if (!mapRef.current || !styleOpt) return;
    if (firstStyle.current) {
      firstStyle.current = false;
      return;
    }
    mapRef.current.setStyle(resolveStyle(styleOpt));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [styleKey]);

  return (
    <div className={cx('overflow-hidden', !/\b(absolute|fixed)\b/.test(className ?? '') && 'relative', className)}>
      <div ref={container} className="h-full w-full" />
      {!loaded && <div className="absolute inset-0 animate-pulse bg-[var(--map-bg)]" />}
      {loaded && children}
    </div>
  );
});

/** Utility: add or replace a GeoJSON source's data. */
export function setGeoJson(map: MLMap, id: string, data: GeoJSON.GeoJSON, extra: Record<string, unknown> = {}) {
  const src = map.getSource(id) as maplibregl.GeoJSONSource | undefined;
  if (src) src.setData(data);
  else map.addSource(id, { type: 'geojson', data, ...extra });
}

export function emptyFC(): GeoJSON.FeatureCollection {
  return { type: 'FeatureCollection', features: [] };
}
