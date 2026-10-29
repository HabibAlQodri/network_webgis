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

/** Error pemuatan data: `userMessage` ramah untuk pengguna, `detail` teknis untuk debugging. */
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

/** True bila error berasal dari AbortController (pemuatan dibatalkan, bukan gagal). */
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
  const USER = "Berkas data sel BTS rusak atau formatnya tidak valid.";
  const bad = (detail: string) => new DataLoadError(USER, `cells.json: ${detail}`);
  if (!d || typeof d !== "object" || Array.isArray(d)) throw bad("isi berkas bukan objek");
  const o = d as Record<string, unknown>;

  // 1) struktur & panjang array
  let n = -1;
  for (const f of CELL_FIELDS) {
    const a = o[f];
    if (!Array.isArray(a)) throw bad(`field \`${f}\` hilang atau bukan array`);
    if (n === -1) n = a.length;
    else if (a.length !== n) throw bad(`panjang \`${f}\` (${a.length}) berbeda dari \`${CELL_FIELDS[0]}\` (${n})`);
  }
  if (n === 0) throw bad("tidak ada sel (array kosong)");

  // 2) nilai tiap elemen
  for (const f of CELL_FIELDS) {
    const a = o[f] as unknown[];
    for (let i = 0; i < n; i++) {
      if (!isNum(a[i])) throw bad(`\`${f}[${i}]\` bukan angka valid (${JSON.stringify(a[i])})`);
    }
  }
  const { radio, lon, lat } = o as { radio: number[]; lon: number[]; lat: number[] };
  for (let i = 0; i < n; i++) {
    if (!Number.isInteger(radio[i]) || radio[i] < 0 || radio[i] >= RADIO_COUNT) throw bad(`\`radio[${i}]\` = ${radio[i]} di luar rentang 0–${RADIO_COUNT - 1}`);
    if (!validLonLat(lon[i], lat[i])) throw bad(`koordinat sel ke-${i} di luar rentang (lon=${lon[i]}, lat=${lat[i]})`);
  }
}

/** Pastikan FeatureCollection valid dan tiap fitur berupa Point dengan koordinat yang dapat dipakai peta. */
export function validateTowers(d: unknown): asserts d is FeatureCollection {
  const USER = "Berkas data menara rusak atau formatnya tidak valid.";
  const bad = (detail: string) => new DataLoadError(USER, `towers.geojson: ${detail}`);
  if (!d || typeof d !== "object" || Array.isArray(d)) throw bad("isi berkas bukan objek");
  const o = d as { type?: unknown; features?: unknown };
  if (o.type !== "FeatureCollection") throw bad(`type harus "FeatureCollection", ditemukan ${JSON.stringify(o.type)}`);
  if (!Array.isArray(o.features)) throw bad("`features` hilang atau bukan array");

  for (let i = 0; i < o.features.length; i++) {
    const f = o.features[i] as { type?: unknown; geometry?: { type?: unknown; coordinates?: unknown } | null } | null;
    if (!f || typeof f !== "object" || f.type !== "Feature") throw bad(`features[${i}] bukan Feature`);
    const g = f.geometry;
    if (!g || typeof g !== "object") throw bad(`features[${i}] tidak punya geometri`);
    if (g.type !== "Point") throw bad(`features[${i}] bertipe geometri ${JSON.stringify(g.type)}, diharapkan "Point"`);
    const c = g.coordinates;
    if (!Array.isArray(c) || c.length < 2 || !isNum(c[0]) || !isNum(c[1])) throw bad(`features[${i}] koordinat tidak valid (${JSON.stringify(c)})`);
    if (!validLonLat(c[0], c[1])) throw bad(`features[${i}] koordinat di luar rentang (lon=${c[0]}, lat=${c[1]})`);
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
      `Tidak dapat menghubungi server saat memuat ${label}. Periksa koneksi internet Anda.`,
      `Network error: GET ${url} (${e instanceof Error ? e.message : String(e)})`,
    );
  }
  if (!res.ok) {
    const userMessage =
      res.status === 404 ? `Berkas ${label} tidak ditemukan di server.`
      : res.status >= 500 ? `Server sedang bermasalah saat memuat ${label}. Coba lagi beberapa saat lagi.`
      : `${label[0].toUpperCase() + label.slice(1)} gagal dimuat (kode ${res.status}).`;
    throw new DataLoadError(userMessage, `HTTP ${res.status} ${res.statusText}: GET ${url}`);
  }
  try {
    return (await res.json()) as T;
  } catch (e) {
    if (isAbortError(e)) throw e;
    throw new DataLoadError(
      `Berkas ${label} rusak atau formatnya tidak valid.`,
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
      fetchJson<unknown>("/data/cells.json", "data sel BTS", ctrl.signal).then((d) => {
        validateCells(d);
        onStep?.("cells");
        return d;
      }),
      fetchJson<unknown>("/data/towers.geojson", "data menara", ctrl.signal).then((d) => {
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