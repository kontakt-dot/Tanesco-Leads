/**
 * PLZ-Koordinaten für die Gebietskarte: GeoNames (geonames.org), CC BY 4.0. Wird erst geladen, wenn die Karte geöffnet wird
 * (knapp 500 KB) und dann im Speicher behalten. Die Projektion rechnet Länge/Breite in die Fläche der Deutschlandkarte
 * (germany-map.json, viewBox 600 × 817) um – gleiche Karte wie im Dashboard.
 */
export type PlzEntry = { plz: string; place: string; lat: number; lng: number; state: string };
type GeoFile = { attribution: string; projection: { x: number[]; y: number[]; terms: string[] }; plz: Record<string, [string, number, number, string]> };

export type PlzGeo = { attribution: string; entries: Map<string, PlzEntry>; universe: Set<string>; project: (lng: number, lat: number) => { x: number; y: number } };
let cache: PlzGeo | null = null;
let loading: Promise<PlzGeo> | null = null;

export function loadPlzGeo(): Promise<PlzGeo> {
  if (cache) return Promise.resolve(cache);
  if (!loading) loading = import("../../../shared/data/plz-geo.json").then((module) => {
    const file = ((module as unknown as { default?: GeoFile }).default ?? (module as unknown as GeoFile)) as GeoFile;
    const entries = new Map<string, PlzEntry>();
    for (const [plz, [place, lat, lng, state]] of Object.entries(file.plz)) entries.set(plz, { plz, place, lat, lng, state });
    const { x, y } = file.projection;
    const project = (lng: number, lat: number) => { const terms = [lng, lat, 1, lng * lat, lng * lng, lat * lat]; return { x: terms.reduce((sum, term, index) => sum + term * x[index], 0), y: terms.reduce((sum, term, index) => sum + term * y[index], 0) }; };
    cache = { attribution: file.attribution, entries, universe: new Set(entries.keys()), project };
    return cache;
  });
  return loading;
}
export function plzGeoSync() { return cache; }
export const PLZ_ATTRIBUTION = "PLZ-Koordinaten: GeoNames (geonames.org), CC BY 4.0";
