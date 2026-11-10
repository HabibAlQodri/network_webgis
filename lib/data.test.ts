import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cellsToGeoJSON, DataLoadError, isAbortError, loadDataset, validateCells, validateTowers,
  type CellData,
} from "./data";

/* ---------- Fixture ---------- */

const makeCells = (): CellData => ({
  radio: [0, 2, 3], mnc: [10, 11, 1], area: [100, 200, 300], cell: [1, 2, 3],
  lon: [106.8, 107.6, 110.4], lat: [-6.2, -6.9, -7.0], range: [500, 1200, 900], samples: [5, 50, 12], updated: [1700000000, 1710000000, 1720000000],
});
const makeTowers = () => ({
  type: "FeatureCollection",
  features: [
    { type: "Feature", geometry: { type: "Point", coordinates: [104.0, 1.1] }, properties: { name: "A" } },
    { type: "Feature", geometry: { type: "Point", coordinates: [105.0, 2.2] }, properties: { name: "B" } },
  ],
});

/* ---------- Mock fetch ---------- */

type Route = Response | Error | (() => Promise<Response>);
const json = (body: unknown, init?: ResponseInit) => new Response(JSON.stringify(body), { status: 200, ...init });

/** Pasang fetch palsu berdasarkan URL; hormati AbortSignal seperti fetch asli. */
function mockFetch(routes: { cells?: Route; towers?: Route }) {
  const signals: Record<string, AbortSignal | undefined> = {};
  const fn = vi.fn((url: string, init?: RequestInit) => {
    const key = url.includes("cells") ? "cells" : "towers";
    signals[key] = init?.signal ?? undefined;
    const r = routes[key as "cells" | "towers"];
    if (r === undefined) {
      // menggantung sampai dibatalkan
      return new Promise<Response>((_, reject) => {
        const abort = () => reject(new DOMException("Aborted", "AbortError"));
        if (init?.signal?.aborted) abort(); // fetch asli langsung menolak bila signal sudah dibatalkan
        else init?.signal?.addEventListener("abort", abort);
      });
    }
    if (r instanceof Error) return Promise.reject(r);
    if (typeof r === "function") return r();
    return Promise.resolve(r.clone());
  });
  vi.stubGlobal("fetch", fn);
  return { fn, signals };
}

const rejection = async (p: Promise<unknown>) => { try { await p; } catch (e) { return e; } throw new Error("Seharusnya ditolak"); };

beforeEach(() => { vi.spyOn(console, "error").mockImplementation(() => {}); });
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

/* ---------- loadDataset: respons HTTP & jaringan ---------- */

describe("loadDataset — kegagalan HTTP/jaringan", () => {
  it("berhasil dan memanggil onStep untuk tiap berkas", async () => {
    mockFetch({ cells: json(makeCells()), towers: json(makeTowers()) });
    const steps: string[] = [];
    const d = await loadDataset({ onStep: (s) => steps.push(s) });
    expect(d.cells.radio).toHaveLength(3);
    expect(d.towers.features).toHaveLength(2);
    expect(steps.sort()).toEqual(["cells", "towers"]);
  });

  it("404 returns a not-found message and HTTP details", async () => {
    mockFetch({ cells: new Response("nope", { status: 404, statusText: "Not Found" }), towers: json(makeTowers()) });
    const e = await rejection(loadDataset());
    expect(e).toBeInstanceOf(DataLoadError);
    expect((e as DataLoadError).userMessage).toMatch(/was not found/);
    expect((e as DataLoadError).detail).toBe("HTTP 404 Not Found: GET /data/cells.json");
  });

  it("500 returns a server error message", async () => {
    mockFetch({ cells: json(makeCells()), towers: new Response("", { status: 500, statusText: "Internal Server Error" }) });
    const e = (await rejection(loadDataset())) as DataLoadError;
    expect(e.userMessage).toMatch(/server encountered a problem/);
    expect(e.detail).toContain("HTTP 500");
    expect(e.detail).toContain("/data/towers.geojson");
  });

  it("other 4xx statuses return a generic message with the status code", async () => {
    mockFetch({ cells: new Response("", { status: 403, statusText: "Forbidden" }), towers: json(makeTowers()) });
    const e = (await rejection(loadDataset())) as DataLoadError;
    expect(e.userMessage).toMatch(/failed to load \(status 403\)/);
  });

  it("network failures return a connection message and preserve the original error in details", async () => {
    mockFetch({ cells: new TypeError("Failed to fetch"), towers: json(makeTowers()) });
    const e = (await rejection(loadDataset())) as DataLoadError;
    expect(e.userMessage).toMatch(/Check your internet connection/);
    expect(e.detail).toContain("Failed to fetch");
  });

  it("invalid JSON returns a format error message", async () => {
    mockFetch({ cells: new Response("{ bukan json", { status: 200 }), towers: json(makeTowers()) });
    const e = (await rejection(loadDataset())) as DataLoadError;
    expect(e.userMessage).toMatch(/corrupted or has an invalid format/);
    expect(e.detail).toMatch(/^Invalid JSON: GET \/data\/cells\.json/);
  });

  it("data tidak valid tidak lolos meski HTTP 200", async () => {
    const c = makeCells(); c.lat.pop();
    mockFetch({ cells: json(c), towers: json(makeTowers()) });
    const e = (await rejection(loadDataset())) as DataLoadError;
    expect(e).toBeInstanceOf(DataLoadError);
    expect(e.detail).toMatch(/length of `lat`/);
  });
});

/* ---------- loadDataset: pembatalan ---------- */

describe("loadDataset — pembatalan", () => {
  it("meneruskan signal ke fetch dan menolak dengan AbortError saat dibatalkan", async () => {
    const { signals } = mockFetch({}); // kedua permintaan menggantung
    const ctrl = new AbortController();
    const p = loadDataset({ signal: ctrl.signal });
    expect(signals.cells).toBeDefined();
    expect(signals.towers).toBeDefined();
    ctrl.abort();
    const e = await rejection(p);
    expect(isAbortError(e)).toBe(true);
    expect(e).not.toBeInstanceOf(DataLoadError);
    expect(signals.cells!.aborted).toBe(true);
    expect(signals.towers!.aborted).toBe(true);
  });

  it("signal yang sudah dibatalkan langsung menolak", async () => {
    mockFetch({});
    const ctrl = new AbortController(); ctrl.abort();
    expect(isAbortError(await rejection(loadDataset({ signal: ctrl.signal })))).toBe(true);
  });

  it("satu permintaan gagal → permintaan lain ikut dihentikan", async () => {
    const { signals } = mockFetch({ cells: new Response("", { status: 500 }) }); // towers menggantung
    const e = await rejection(loadDataset());
    expect(e).toBeInstanceOf(DataLoadError);
    expect(signals.towers!.aborted).toBe(true);
  });

  it("tidak ada onStep yang dipanggil setelah dibatalkan sebelum respons tiba", async () => {
    mockFetch({});
    const ctrl = new AbortController();
    const onStep = vi.fn();
    const p = loadDataset({ signal: ctrl.signal, onStep });
    ctrl.abort();
    await rejection(p);
    expect(onStep).not.toHaveBeenCalled();
  });
});

/* ---------- validateCells ---------- */

describe("validateCells", () => {
  it("menerima data valid", () => {
    expect(() => validateCells(makeCells())).not.toThrow();
  });

  it.each([null, undefined, [], "teks", 42])("menolak isi bukan objek: %j", (v) => {
    expect(() => validateCells(v)).toThrow(DataLoadError);
  });

  it("rejects missing fields", () => {
    const c: Partial<CellData> = makeCells(); delete c.lon;
    expect(() => validateCells(c)).toThrow(/`lon` is missing or is not an array/);
  });

  it("menolak field yang bukan array", () => {
    expect(() => validateCells({ ...makeCells(), mnc: "10,11,1" })).toThrow(/`mnc` is missing or is not an array/);
  });

  it("menolak panjang array yang tidak konsisten", () => {
    const c = makeCells(); c.range.push(1000);
    expect(() => validateCells(c)).toThrow(/length of `range` \(4\) differs from `radio` \(3\)/);
  });

  it("menolak array kosong", () => {
    const empty = Object.fromEntries(Object.keys(makeCells()).map((k) => [k, []]));
    expect(() => validateCells(empty)).toThrow(/empty array/);
  });

  it("menolak elemen null / bukan angka", () => {
    const c = makeCells(); (c.samples as unknown[])[1] = null;
    expect(() => validateCells(c)).toThrow(/`samples\[1\]` is not a valid number/);
    const d = makeCells(); (d.lon as unknown[])[0] = "106.8";
    expect(() => validateCells(d)).toThrow(/`lon\[0\]`/);
  });

  it("menolak radio di luar rentang atau bukan bilangan bulat", () => {
    const a = makeCells(); a.radio[2] = 4;
    expect(() => validateCells(a)).toThrow(/`radio\[2\]` = 4 is outside the range 0–3/);
    const b = makeCells(); b.radio[0] = 1.5;
    expect(() => validateCells(b)).toThrow(/`radio\[0\]`/);
  });

  it("menolak koordinat di luar rentang (mis. lon/lat tertukar)", () => {
    const c = makeCells(); c.lat[1] = 107.6; c.lon[1] = -6.9;
    expect(() => validateCells(c)).toThrow(/coordinates for cell site 1 are out of range/);
  });

  it("pesan pengguna ramah, detail teknis terpisah", () => {
    const c = makeCells(); c.lat.pop();
    try { validateCells(c); } catch (e) {
      expect((e as DataLoadError).userMessage).toBe("Cell site data is corrupted or has an invalid format.");
      expect((e as DataLoadError).detail).toMatch(/^cells\.json: /);
    }
  });
});

/* ---------- validateTowers ---------- */

describe("validateTowers", () => {
  const withFeature = (f: unknown) => ({ type: "FeatureCollection", features: [f] });
  const point = (coordinates: unknown) => ({ type: "Feature", geometry: { type: "Point", coordinates }, properties: {} });

  it("menerima FeatureCollection valid (termasuk koordinat dengan elevasi)", () => {
    expect(() => validateTowers(makeTowers())).not.toThrow();
    expect(() => validateTowers(withFeature(point([104, 1, 25])))).not.toThrow();
    expect(() => validateTowers({ type: "FeatureCollection", features: [] })).not.toThrow();
  });

  it.each([null, [], "x"])("menolak isi bukan objek: %j", (v) => {
    expect(() => validateTowers(v)).toThrow(DataLoadError);
  });

  it("menolak type yang bukan FeatureCollection", () => {
    expect(() => validateTowers({ type: "Feature", features: [] })).toThrow(/must be "FeatureCollection"/);
    expect(() => validateTowers({ features: [] })).toThrow(/must be "FeatureCollection"/);
  });

  it("menolak features yang hilang / bukan array", () => {
    expect(() => validateTowers({ type: "FeatureCollection" })).toThrow(/`features`/);
    expect(() => validateTowers({ type: "FeatureCollection", features: {} })).toThrow(/`features`/);
  });

  it("menolak item yang bukan Feature", () => {
    expect(() => validateTowers(withFeature(null))).toThrow(/features\[0\] is not a Feature/);
    expect(() => validateTowers(withFeature({ type: "Point", coordinates: [1, 2] }))).toThrow(/is not a Feature/);
  });

  it("menolak fitur tanpa geometri", () => {
    expect(() => validateTowers(withFeature({ type: "Feature", properties: {} }))).toThrow(/has no geometry/);
    expect(() => validateTowers(withFeature({ type: "Feature", geometry: null, properties: {} }))).toThrow(/has no geometry/);
  });

  it("menolak geometri selain Point", () => {
    const line = { type: "Feature", geometry: { type: "LineString", coordinates: [[1, 2], [3, 4]] }, properties: {} };
    expect(() => validateTowers(withFeature(line))).toThrow(/expected "Point"/);
  });

  it.each([
    ["tanpa koordinat", undefined],
    ["bukan array", "104,1"],
    ["terlalu pendek", [104]],
    ["berisi string", ["104", "1"]],
    ["berisi null", [null, 1]],
  ])("rejects invalid coordinates: %s", (_n, coords) => {
    expect(() => validateTowers(withFeature(point(coords)))).toThrow(/has invalid coordinates/);
  });

  it("menolak koordinat di luar rentang", () => {
    expect(() => validateTowers(withFeature(point([200, 1])))).toThrow(/coordinates are out of range/);
    expect(() => validateTowers(withFeature(point([100, 95])))).toThrow(/coordinates are out of range/);
  });

  it("menyebut indeks fitur yang bermasalah", () => {
    const t = makeTowers(); t.features.push({ type: "Feature", geometry: null, properties: { name: "C" } } as never);
    expect(() => validateTowers(t)).toThrow(/features\[2\]/);
  });

  it("GeoJSON yang gagal validasi ditolak lewat loadDataset", async () => {
    mockFetch({ cells: json(makeCells()), towers: json(withFeature(point([]))) });
    const e = (await rejection(loadDataset())) as DataLoadError;
    expect(e.userMessage).toBe("Tower data is corrupted or has an invalid format.");
    expect(e.detail).toMatch(/^towers\.geojson: features\[0\]/);
  });
});

/* ---------- cellsToGeoJSON ---------- */

describe("cellsToGeoJSON", () => {
  it("mengonversi sel terpilih dengan urutan koordinat [lon, lat] dan properti lengkap", () => {
    const fc = cellsToGeoJSON(makeCells(), [1]);
    expect(fc.type).toBe("FeatureCollection");
    expect(fc.features).toHaveLength(1);
    expect(fc.features[0]).toEqual({
      type: "Feature",
      geometry: { type: "Point", coordinates: [107.6, -6.9] },
      properties: { i: 1, mnc: 11, radio: 2, range: 1200, samples: 50, area: 200, cell: 2, updated: 1710000000 },
    });
  });

  it("menghormati urutan dan subset indeks (Uint32Array)", () => {
    const fc = cellsToGeoJSON(makeCells(), Uint32Array.from([2, 0]));
    expect(fc.features.map((f) => (f.properties as { i: number }).i)).toEqual([2, 0]);
    expect((fc.features[0].geometry as GeoJSON.Point).coordinates).toEqual([110.4, -7.0]);
  });

  it("indeks kosong → FeatureCollection kosong", () => {
    expect(cellsToGeoJSON(makeCells(), [])).toEqual({ type: "FeatureCollection", features: [] });
  });

  it("hasil dari data tervalidasi selalu menghasilkan koordinat valid", () => {
    const c = makeCells();
    validateCells(c);
    const fc = cellsToGeoJSON(c, [0, 1, 2]);
    for (const f of fc.features) {
      const [lon, lat] = (f.geometry as GeoJSON.Point).coordinates;
      expect(Number.isFinite(lon) && Number.isFinite(lat)).toBe(true);
    }
  });
});
