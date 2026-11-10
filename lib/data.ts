import type { FeatureCollection } from "geojson";

export type CellData = {
  radio: number[]; mnc: number[]; area: number[]; cell: number[];
  lon: number[]; lat: number[]; range: number[]; samples: number[]; updated: number[];
};

export type Dataset = {
  cells: CellData;
  towers: FeatureCollection;
};

export type LoadStep = "cells" | "towers";

/** Data loading error: `userMessage` is user-friendly; `detail` is for debugging. */
export class DataLoadError extends Error {
  userMessage: string;
  detail: string;
  constructor(userMessage: string, detail: string) {
    super(detail);
    this.name = "DataLoadError";
    this.userMessage = userMessage;
    this.detail = detail;
  }
}

/** True when an error comes from AbortController (loading was cancelled, not failed). */
export function isAbortError(e: unknown): boolean {
  return !!e && typeof e === "object" && (e as { name?: string }).name === "AbortError";
}

/* ---------- Validasi ---------- */

const CELL_FIELDS = ["radio", "mnc", "area", "cell", "lon", "lat", "range", "samples", "updated"] as const;
const RADIO_COUNT = 4; // GSM, UMTS, LTE, NR (lihat RADIOS di config.ts)
const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const validLonLat = (lon: number, lat: number) => lon >= -180 && lon <= 180 && lat >= -90 && lat <= 90;

/** Pastikan semua field wajib berupa array angka dengan panjang sama, radio dalam rentang, dan koordinat valid. */
export function validateCells(d: unknown): asserts d is CellData {
  const USER = "Cell site data is corrupted or has an invalid format.";
  const bad = (detail: string) => new DataLoadError(USER, `cells.json: ${detail}`);
  if (!d || typeof d !== "object" || Array.isArray(d)) throw bad("file contents are not an object");
  const o = d as Record<string, unknown>;

  // 1) struktur & panjang array
  let n = -1;
  for (const f of CELL_FIELDS) {
    const a = o[f];
    if (!Array.isArray(a)) throw bad(`field \`${f}\` is missing or is not an array`);
    if (n === -1) n = a.length;
    else if (a.length !== n) throw bad(`length of \`${f}\` (${a.length}) differs from \`${CELL_FIELDS[0]}\` (${n})`);
  }
  if (n === 0) throw bad("no cell sites (empty array)");

  // 2) nilai tiap elemen
  for (const f of CELL_FIELDS) {
    const a = o[f] as unknown[];
    for (let i = 0; i < n; i++) {
      if (!isNum(a[i])) throw bad(`\`${f}[${i}]\` is not a valid number (${JSON.stringify(a[i])})`);
    }
  }
  const { radio, lon, lat } = o as { radio: number[]; lon: number[]; lat: number[] };
  for (let i = 0; i < n; i++) {
    if (!Number.isInteger(radio[i]) || radio[i] < 0 || radio[i] >= RADIO_COUNT) throw bad(`\`radio[${i}]\` = ${radio[i]} is outside the range 0–${RADIO_COUNT - 1}`);
    if (!validLonLat(lon[i], lat[i])) throw bad(`coordinates for cell site ${i} are out of range (lon=${lon[i]}, lat=${lat[i]})`);
  }
}

/** Pastikan FeatureCollection valid dan tiap fitur berupa Point dengan koordinat yang dapat dipakai peta. */
export function validateTowers(d: unknown): asserts d is FeatureCollection {
  const USER = "Tower data is corrupted or has an invalid format.";
  const bad = (detail: string) => new DataLoadError(USER, `towers.geojson: ${detail}`);
  if (!d || typeof d !== "object" || Array.isArray(d)) throw bad("file contents are not an object");
  const o = d as { type?: unknown; features?: unknown };
  if (o.type !== "FeatureCollection") throw bad(`type must be "FeatureCollection"; found ${JSON.stringify(o.type)}`);
  if (!Array.isArray(o.features)) throw bad("`features` is missing or is not an array");

  for (let i = 0; i < o.features.length; i++) {
    const f = o.features[i] as { type?: unknown; geometry?: { type?: unknown; coordinates?: unknown } | null } | null;
    if (!f || typeof f !== "object" || f.type !== "Feature") throw bad(`features[${i}] is not a Feature`);
    const g = f.geometry;
    if (!g || typeof g !== "object") throw bad(`features[${i}] has no geometry`);
    if (g.type !== "Point") throw bad(`features[${i}] has geometry type ${JSON.stringify(g.type)}; expected "Point"`);
    const c = g.coordinates;
    if (!Array.isArray(c) || c.length < 2 || !isNum(c[0]) || !isNum(c[1])) throw bad(`features[${i}] has invalid coordinates (${JSON.stringify(c)})`);
    if (!validLonLat(c[0], c[1])) throw bad(`features[${i}] coordinates are out of range (lon=${c[0]}, lat=${c[1]})`);
  }
}

/* ---------- Pemuatan ---------- */

async function fetchJson<T>(url: string, label: string, signal?: AbortSignal): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, { signal });
  } catch (e) {
    if (isAbortError(e)) throw e;
    throw new DataLoadError(
      `Could not connect to the server while loading ${label}. Check your internet connection.`,
      `Network error: GET ${url} (${e instanceof Error ? e.message : String(e)})`,
    );
  }
  if (!res.ok) {
    const userMessage =
      res.status === 404 ? `The ${label} file was not found on the server.`
      : res.status >= 500 ? `The server encountered a problem while loading ${label}. Please try again later.`
      : `${label[0].toUpperCase() + label.slice(1)} failed to load (status ${res.status}).`;
    throw new DataLoadError(userMessage, `HTTP ${res.status} ${res.statusText}: GET ${url}`);
  }
  try {
    return (await res.json()) as T;
  } catch (e) {
    if (isAbortError(e)) throw e;
    throw new DataLoadError(
      `The ${label} file is corrupted or has an invalid format.`,
      `Invalid JSON: GET ${url} (${e instanceof Error ? e.message : String(e)})`,
    );
  }
}

export type LoadOptions = {
  /** Batalkan pemuatan (mis. komponen dilepas atau pemuatan diulang). Promise ditolak dengan AbortError. */
  signal?: AbortSignal;
  /** Dipanggil saat satu berkas selesai dimuat dan lolos validasi. */
  onStep?: (step: LoadStep) => void;
};

export async function loadDataset({ signal, onStep }: LoadOptions = {}): Promise<Dataset> {
  // Controller internal: bila satu permintaan gagal, permintaan lainnya ikut dihentikan.
  const ctrl = new AbortController();
  const forward = () => ctrl.abort();
  if (signal?.aborted) ctrl.abort(); else signal?.addEventListener("abort", forward, { once: true });
  try {
    const [cells, towers] = await Promise.all([
      fetchJson<unknown>("/data/cells.json", "cell site data", ctrl.signal).then((d) => {
        validateCells(d);
        onStep?.("cells");
        return d;
      }),
      fetchJson<unknown>("/data/towers.geojson", "tower data", ctrl.signal).then((d) => {
        validateTowers(d);
        onStep?.("towers");
        return d;
      }),
    ]);
    return { cells, towers };
  } catch (e) {
    ctrl.abort();
    throw e;
  } finally {
    signal?.removeEventListener("abort", forward);
  }
}

export function cellsToGeoJSON(c: CellData, idx: ArrayLike<number>): FeatureCollection {
  const features = new Array(idx.length);
  for (let k = 0; k < idx.length; k++) {
    const i = idx[k];
    features[k] = {
      type: "Feature",
      geometry: { type: "Point", coordinates: [c.lon[i], c.lat[i]] },
      properties: { i, mnc: c.mnc[i], radio: c.radio[i], range: c.range[i], samples: c.samples[i], area: c.area[i], cell: c.cell[i], updated: c.updated[i] },
    };
  }
  return { type: "FeatureCollection", features };
}