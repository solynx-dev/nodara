import type { StyleSpecification } from 'maplibre-gl';
import type { MapStyleOption } from '@nodara/shared';

/** A dependency-free raster style using standard OpenStreetMap tiles. */
export const OSM_RASTER: StyleSpecification = {
  version: 8,
  sources: {
    osm: {
      type: 'raster',
      tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
      tileSize: 256,
      maxzoom: 19,
      attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    },
  },
  layers: [{ id: 'osm', type: 'raster', source: 'osm' }],
};

export function resolveStyle(opt: MapStyleOption | undefined): string | StyleSpecification {
  if (!opt || opt.url === 'builtin:osm-raster') return OSM_RASTER;
  return opt.url;
}

export function pickStyle(styles: MapStyleOption[], preferred: string | null, theme: 'light' | 'dark'): MapStyleOption | undefined {
  const explicit = preferred ? styles.find((s) => s.id === preferred) : undefined;
  if (explicit) return explicit;
  return styles.find((s) => s.dark === (theme === 'dark')) ?? styles[0];
}
