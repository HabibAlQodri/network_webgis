import type { Geometry, MultiPolygon, Polygon } from "geojson";
import type { CellData } from "./data";
import { inBBox, type BBox } from "./spatial";
import type { Locale } from "./locale";

/** Active area used to filter data. `geometry` is optional; without it, only the bounding box is used. */
export type RegionFilter = {
  label: string;
  /** Type displayed in the UI, e.g. "Province", "Regency", or "Map view". */
  kind: string;
  bbox: BBox;
  geometry?: Polygon | MultiPolygon;
};

/* ---------- Koordinat ---------- */

/**
 * Baca koordinat dari teks: "-6.2, 106.8", "-6.2 106.8", "106.8, -6.2", atau dengan hemisfer "6.2S 106.8E".
 * Urutan lat,lon dianggap default; bila hanya urutan lon,lat yang valid (mis. "106.8, -6.2") dibalik otomatis.
 * Mengembalikan [lon, lat] atau null bila bukan koordinat.
 */
export function parseCoordinate(text: string): [number, number] | null {
  const s = text.trim().toUpperCase().replace(/\s+/g, " ");
  const m = /^([+-]?\d+(?:[.,]\d+)?)\s*°?\s*([NSEW])?\s*[,;\s]\s*([+-]?\d+(?:[.,]\d+)?)\s*°?\s*([NSEW])?$/.exec(s);
  if (!m) return null;
  const num = (v: string) => Number(v.replace(",", "."));
  let a = num(m[1]), b = num(m[3]);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  const ha = m[2], hb = m[4];
  if (ha === "S" || ha === "W") a = -Math.abs(a); else if (ha === "N" || ha === "E") a = Math.abs(a);
  if (hb === "S" || hb === "W") b = -Math.abs(b); else if (hb === "N" || hb === "E") b = Math.abs(b);
  // Hemisfer menentukan sumbu: "106.8E 6.2S" → lon, lat
  if ((ha === "E" || ha === "W") && (hb === "N" || hb === "S")) [a, b] = [b, a];
  if (Math.abs(a) <= 90 && Math.abs(b) <= 180) return [b, a];  // lat, lon
  if (Math.abs(b) <= 90 && Math.abs(a) <= 180) return [a, b];  // lon, lat
  return null;
}

/* ---------- Titik dalam poligon ---------- */

function inRing(x: number, y: number, ring: number[][]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0], yi = ring[i][1], xj = ring[j][0], yj = ring[j][1];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Titik di dalam poligon (cincin pertama = luar, sisanya lubang). */
function inPolygon(x: number, y: number, rings: number[][][]): boolean {
  if (!rings.length || !inRing(x, y, rings[0])) return false;
  for (let h = 1; h < rings.length; h++) if (inRing(x, y, rings[h])) return false;
  return true;
}

export function pointInGeometry(x: number, y: number, g: Polygon | MultiPolygon): boolean {
  if (g.type === "Polygon") return inPolygon(x, y, g.coordinates);
  for (const poly of g.coordinates) if (inPolygon(x, y, poly)) return true;
  return false;
}

export function geometryBBox(g: Polygon | MultiPolygon): BBox {
  let w = Infinity, s = Infinity, e = -Infinity, n = -Infinity;
  const polys = g.type === "Polygon" ? [g.coordinates] : g.coordinates;
  for (const p of polys) for (const ring of p) for (const [x, y] of ring) {
    if (x < w) w = x; if (x > e) e = x; if (y < s) s = y; if (y > n) n = y;
  }
  return [w, s, e, n];
}

/** Indeks sel yang berada di dalam wilayah (bbox lebih dulu, lalu poligon bila ada). Urutan menaik. */
export function cellsInRegion(c: CellData, r: RegionFilter): Uint32Array {
  const out: number[] = [];
  for (let i = 0; i < c.lon.length; i++) {
    if (!inBBox(c.lon[i], c.lat[i], r.bbox)) continue;
    if (r.geometry && !pointInGeometry(c.lon[i], c.lat[i], r.geometry)) continue;
    out.push(i);
  }
  return Uint32Array.from(out);
}

/* ---------- Geocoding (Nominatim / OpenStreetMap) ---------- */

export type PlaceResult = {
  id: string;
  name: string;
  detail: string;
  kind: string;
  center: [number, number];
  bbox: BBox;
  geometry?: Polygon | MultiPolygon;
};

type NominatimItem = {
  place_id: number; osm_type?: string; osm_id?: number;
  lat: string; lon: string; display_name: string; name?: string;
  category?: string; type?: string; addresstype?: string;
  boundingbox?: [string, string, string, string]; // [selatan, utara, barat, timur]
  geojson?: Geometry;
};

const KIND_LABEL: Record<Locale, Record<string, string>> = {
  en: {
    state: "Province", province: "Province", region: "Region",
    county: "Regency", regency: "Regency", city: "City", municipality: "City",
    city_district: "District", district: "District", suburb: "Suburb", village: "Village",
    island: "Island", town: "Town", hamlet: "Hamlet",
  },
  id: {
    state: "Provinsi", province: "Provinsi", region: "Wilayah",
    county: "Kabupaten", regency: "Kabupaten", city: "Kota", municipality: "Kota",
    city_district: "Kecamatan", district: "Kecamatan", suburb: "Kelurahan", village: "Desa",
    island: "Pulau", town: "Kota", hamlet: "Dusun",
  },
};

/** Ubah satu hasil Nominatim menjadi PlaceResult; null bila tak punya koordinat/bbox yang valid. */
export function parseNominatimItem(it: NominatimItem, locale: Locale = "en"): PlaceResult | null {
  const lat = Number(it.lat), lon = Number(it.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  const bb = it.boundingbox?.map(Number);
  const bbox: BBox = bb && bb.length === 4 && bb.every(Number.isFinite) ? [bb[2], bb[0], bb[3], bb[1]] : [lon - 0.05, lat - 0.05, lon + 0.05, lat + 0.05];
  const g = it.geojson;
  const geometry = g && (g.type === "Polygon" || g.type === "MultiPolygon") ? g : undefined;
  const [first, ...rest] = it.display_name.split(",").map((p) => p.trim());
  return {
    id: `${it.osm_type ?? "x"}${it.osm_id ?? it.place_id}`,
    name: it.name || first,
    detail: rest.slice(0, 2).join(", "),
    kind: KIND_LABEL[locale][it.addresstype ?? ""] ?? KIND_LABEL[locale][it.type ?? ""] ?? (geometry ? (locale === "id" ? "Wilayah" : "Area") : (locale === "id" ? "Lokasi" : "Location")),
    center: [lon, lat], bbox, geometry,
  };
}

/**
 * Search for places with Nominatim. Only called on explicit user action (not while typing),
 * sesuai kebijakan penggunaan Nominatim (tanpa autocomplete, maks. ±1 permintaan/detik).
 */
export async function geocode(query: string, signal?: AbortSignal, locale: Locale = "en"): Promise<PlaceResult[]> {
  const params = new URLSearchParams({
    format: "jsonv2", q: query, countrycodes: "id", limit: "6",
    polygon_geojson: "1", polygon_threshold: "0.005", "accept-language": locale,
  });
  const res = await fetch(`https://nominatim.openstreetmap.org/search?${params}`, { signal, headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error(`Search failed (status ${res.status})`);
  const items = (await res.json()) as NominatimItem[];
  if (!Array.isArray(items)) throw new Error("Invalid search response");
  return items.map((item) => parseNominatimItem(item, locale)).filter((p): p is PlaceResult => p !== null);
}

export function placeToRegion(p: PlaceResult): RegionFilter {
  return { label: p.name, kind: p.kind, bbox: p.geometry ? geometryBBox(p.geometry) : p.bbox, geometry: p.geometry };
}
