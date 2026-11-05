"use client";
import dynamic from "next/dynamic";
import Image from "next/image";
import { useEffect, useMemo, useRef, useState } from "react";
import { OPERATORS, OTHER_COLOR, PRESETS, RADIOS, RADIO_COLORS, REGIONS, type Preset } from "@/lib/config";
import { DataLoadError, isAbortError, loadDataset, type Dataset, type LoadStep } from "@/lib/data";
import { cellsToCSV, cellsToExportGeoJSON, download, exportFilename } from "@/lib/export";
import { cellsInRegion, parseCoordinate, placeToRegion, type PlaceResult, type RegionFilter } from "@/lib/region";
import { inBBox, type BBox } from "@/lib/spatial";
import { compareOperators, OTHER_OPERATOR, type OperatorStat } from "@/lib/stats";
import type { Basemap, CellFilter, Viewport } from "./MapView";
import { useGeocoder, type GeocodeState } from "./useGeocoder";

const MapView = dynamic(() => import("./MapView"), {
  ssr: false,
  loading: () => <div className="grid h-full place-items-center text-sm text-slate-500">Menyiapkan peta…</div>,
});
const fmt = (n: number) => n.toLocaleString("id-ID");
const KNOWN_OPS = Object.keys(OPERATORS).map(Number);
const KNOWN_SET: ReadonlySet<number> = new Set(KNOWN_OPS);
const opName = (mnc: number) => (mnc === OTHER_OPERATOR ? "Lainnya" : OPERATORS[mnc]?.name ?? `MNC ${mnc}`);

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => { const t = setTimeout(() => setV(value), ms); return () => clearTimeout(t); }, [value, ms]);
  return v;
}
const focusRing = "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-400";
// Lokasi terdekat dari titik tengah peta (offline, dari daftar PRESETS)
const CITIES = PRESETS.filter((p) => p.region !== "Nasional");
function distKm(a: [number, number], b: [number, number]) {
  const r = Math.PI / 180, dLat = (b[1] - a[1]) * r, dLon = (b[0] - a[0]) * r;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a[1] * r) * Math.cos(b[1] * r) * Math.sin(dLon / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(h));
}
function describePlace(center?: [number, number], zoom?: number): { name: string; sub: string } {
  if (!center || zoom === undefined || zoom < 5.5) return { name: "Indonesia", sub: "Tampilan nasional" };
  let best: Preset = CITIES[0], bd = Infinity;
  for (const c of CITIES) { const d = distKm(center, c.center); if (d < bd) { bd = d; best = c; } }
  if (bd < 40) return { name: best.label, sub: best.province };
  return { name: `Dekat ${best.label}`, sub: `${best.province} · ±${fmt(Math.round(bd))} km` };
}

const glass = "border border-slate-900/10 bg-white/90 shadow-xl backdrop-blur";

type Tab = "layers" | "filter" | "area" | "compare" | "stats" | "export";
type ShowKey = "cells" | "towers" | "cables" | "landingPoints" | "ituFiber";

/* ---------- Ikon ---------- */

const ICONS = {
  layers: "M8 2L2 5l6 3 6-3-6-3zM2 8l6 3 6-3M2 11l6 3 6-3",
  filter: "M2 3h12l-4.5 5.5V13l-3-1.5V8.5L2 3z",
  pin: "M8 14.5s4.5-4 4.5-8a4.5 4.5 0 10-9 0c0 4 4.5 8 4.5 8zM8 8a1.6 1.6 0 100-3.2A1.6 1.6 0 008 8z",
  chart: "M3 13V8M8 13V3M13 13V6",
  compare: "M2 4h9M2 8h12M2 12h6",
  download: "M8 2v8M4.5 7L8 10.5 11.5 7M3 13.5h10",
  search: "M7 12A5 5 0 107 2a5 5 0 000 10zM11 11l3.5 3.5",
  close: "M4 4l8 8M12 4l-8 8",
  grip: "M6 4h.01M10 4h.01M6 8h.01M10 8h.01M6 12h.01M10 12h.01",
  chevron: "M3 6l5 5 5-5",
} as const;

function Icon({ name, size = 16 }: { name: keyof typeof ICONS; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d={ICONS[name]} />
    </svg>
  );
}

/* ---------- Komponen kecil ---------- */

function Chip({ on, onClick, children, small, title }: { on: boolean; onClick: () => void; children: React.ReactNode; small?: boolean; title?: string }) {
  return (
    <button
      onClick={onClick}
      aria-pressed={on} title={title}
      className={`shrink-0 rounded-full border text-xs transition ${small ? "px-2.5 py-0.5 text-[11px]" : "px-3 py-1"} ${focusRing} ${
        on ? "border-sky-400/60 bg-sky-400/15 text-sky-700" : "border-slate-900/10 text-slate-700 hover:border-slate-900/25 hover:bg-slate-900/5"
      }`}
    >
      {children}
    </button>
  );
}

function Segmented<T extends string>({ value, options, onChange, label }: {
  value: T; options: { id: T; label: string }[]; onChange: (v: T) => void; label: string;
}) {
  return (
    <div role="group" aria-label={label} className="flex rounded-lg bg-slate-900/5 p-0.5">
      {options.map((o) => (
        <button
          key={o.id}
          onClick={() => onChange(o.id)}
          aria-pressed={value === o.id}
          className={`flex-1 rounded-md px-2 py-1 text-xs transition ${focusRing} ${
            value === o.id ? "bg-white text-slate-900 shadow" : "text-slate-600 hover:text-slate-800"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function Switch({ on }: { on: boolean }) {
  return (
    <span className={`relative h-4 w-7 shrink-0 rounded-full transition ${on ? "bg-sky-500" : "bg-slate-300"}`}>
      <span className={`absolute top-0.5 h-3 w-3 rounded-full bg-white transition-all ${on ? "left-3.5" : "left-0.5"}`} />
    </span>
  );
}

function LayerRow({ on, onToggle, swatch, label, meta, children }: {
  on: boolean; onToggle: () => void; swatch: React.ReactNode; label: string; meta?: string; children?: React.ReactNode;
}) {
  return (
    <div className={`rounded-lg px-2 py-1.5 transition ${on ? "bg-slate-900/[0.04]" : ""}`}>
      <button
        role="switch" aria-checked={on} onClick={onToggle}
        className={`flex w-full items-center gap-2.5 rounded text-left text-[13px] ${focusRing} ${on ? "text-slate-900" : "text-slate-500"}`}
      >
        <span className={`flex w-5 justify-center ${on ? "" : "opacity-40"}`}>{swatch}</span>
        <span className="flex-1">{label}</span>
        {meta && <span className="text-[11px] tabular-nums text-slate-500">{meta}</span>}
        <Switch on={on} />
      </button>
      {on && children && <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 pl-[30px] text-[11px] text-slate-600">{children}</div>}
    </div>
  );
}

const Line = ({ c }: { c: string }) => <span className="inline-block h-0.5 w-4 rounded" style={{ background: c }} />;
const Dot = ({ c, ring }: { c: string; ring?: boolean }) => (
  <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: c, border: ring ? "1.5px solid #fff" : undefined }} />
);
const Legend = ({ c, children }: { c: string; children: React.ReactNode }) => (
  <span className="flex items-center gap-1.5"><Line c={c} />{children}</span>
);

function FilterRow({ on, onClick, color, label, value, max, fixed }: {
  on: boolean; onClick?: () => void; color: string; label: string; value: number; max: number; fixed?: boolean;
}) {
  const body = (
    <>
      <div className="flex items-center gap-2 text-[13px]">
        <span className="h-2.5 w-2.5 rounded-sm" style={{ background: on ? color : "#cbd5e1" }} />
        <span className="flex-1 text-left">{label}</span>
        <span className="tabular-nums text-xs text-slate-600">{fmt(value)}</span>
      </div>
      <div className="mt-1 h-1 rounded bg-slate-900/5">
        <div className="h-full rounded transition-all" style={{ width: `${max ? (value / max) * 100 : 0}%`, background: on ? color : "#cbd5e1" }} />
      </div>
    </>
  );
  if (fixed) return <div className="rounded-lg px-2 py-1.5 text-slate-600">{body}</div>;
  return (
    <button
      onClick={onClick} aria-pressed={on}
      className={`block w-full rounded-lg px-2 py-1.5 transition hover:bg-slate-900/5 ${focusRing} ${on ? "text-slate-900" : "text-slate-500"}`}
    >
      {body}
    </button>
  );
}

function SubHead({ title, action }: { title: string; action?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between px-2 pb-1 pt-3 first:pt-0">
      <h3 className="text-[11px] font-medium uppercase tracking-wide text-slate-500">{title}</h3>
      {action}
    </div>
  );
}

const linkBtn = `rounded text-[11px] text-sky-700 hover:text-sky-900 ${focusRing}`;

function RailBtn({ active, label, badge, onClick, icon }: {
  active: boolean; label: string; badge?: boolean; onClick: () => void; icon: keyof typeof ICONS;
}) {
  return (
    <button
      onClick={onClick} aria-label={label} aria-pressed={active}
      className={`group relative grid h-10 w-10 flex-1 place-items-center rounded-xl transition md:flex-none ${focusRing} ${
        active ? "bg-sky-500/20 text-sky-700" : "text-slate-600 hover:bg-slate-900/5 hover:text-slate-900"
      }`}
    >
      <Icon name={icon} size={18} />
      {badge && <span className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-sky-400 ring-2 ring-white" />}
      <span className="pointer-events-none absolute left-full ml-2 hidden whitespace-nowrap rounded-md bg-slate-800 px-2 py-1 text-[11px] text-white shadow-lg md:group-hover:block">
        {label}
      </span>
    </button>
  );
}

function QuickToggle({ on, onClick, swatch, label }: { on: boolean; onClick: () => void; swatch: React.ReactNode; label: string }) {
  return (
    <button
      onClick={onClick} aria-pressed={on} title={label}
      className={`flex min-w-0 flex-1 items-center justify-center gap-1 rounded-lg px-1 py-1.5 text-[10px] transition sm:gap-1.5 sm:px-2.5 sm:text-xs lg:flex-none lg:shrink-0 ${focusRing} ${
        on ? "bg-slate-900/10 text-slate-900" : "text-slate-500 hover:bg-slate-900/5 hover:text-slate-700"
      }`}
    >
      <span className={on ? "" : "opacity-40"}>{swatch}</span>
      <span className="truncate">{label}</span>
    </button>
  );
}

function FilterTag({ children, onClear }: { children: React.ReactNode; onClear: () => void }) {
  return (
    <button
      onClick={onClear} title="Hapus filter ini"
      className={`pointer-events-auto flex items-center gap-1.5 rounded-full border border-sky-400/40 bg-sky-500/15 py-1 pl-2.5 pr-2 text-[11px] text-sky-800 backdrop-blur hover:bg-sky-500/25 ${focusRing}`}
    >
      {children}
      <Icon name="close" size={10} />
    </button>
  );
}

/** Hasil pencarian lokasi online (Nominatim). Wilayah administratif ber-poligon juga memfilter data. */
function PlaceList({ state, onPick }: { state: GeocodeState; onPick: (p: PlaceResult) => void }) {
  if (state.status === "idle") return null;
  if (state.status === "loading") {
    return (
      <div className="flex items-center gap-2 px-3 py-2 text-xs text-slate-600" role="status">
        <span className="h-3 w-3 animate-spin rounded-full border-2 border-slate-300 border-t-sky-500" />Mencari “{state.q}”…
      </div>
    );
  }
  if (state.status === "error") return <p className="px-3 py-2 text-xs text-red-600" role="alert">{state.message}</p>;
  if (!state.results.length) return <p className="px-3 py-2 text-xs text-slate-500">Tidak ada hasil untuk “{state.q}”.</p>;
  return (
    <>
      <ul>
        {state.results.map((p) => (
          <li key={p.id}>
            <button
              onMouseDown={(e) => e.preventDefault()} onClick={() => onPick(p)}
              className={`flex w-full items-start gap-2 px-3 py-1.5 text-left text-xs text-slate-800 hover:bg-slate-900/5 ${focusRing}`}
            >
              <span className="mt-0.5 text-slate-500"><Icon name="pin" size={12} /></span>
              <span className="min-w-0 flex-1">
                <span className="block truncate">{p.name}</span>
                {p.detail && <span className="block truncate text-[10px] text-slate-500">{p.detail}</span>}
              </span>
              <span className={`shrink-0 rounded-full px-1.5 py-0.5 text-[10px] ${p.geometry ? "bg-sky-500/15 text-sky-800" : "bg-slate-900/5 text-slate-600"}`}>
                {p.geometry ? `${p.kind} · filter` : p.kind}
              </span>
            </button>
          </li>
        ))}
      </ul>
      <p className="px-3 pb-1.5 pt-1 text-[10px] leading-snug text-slate-500">Memilih wilayah ber-batas (provinsi, kabupaten, kota) juga memfilter data ke dalam batasnya. Sumber: OpenStreetMap Nominatim.</p>
    </>
  );
}

const TECH_ORDER = [3, 2, 1, 0]; // NR, LTE, UMTS, GSM (terbaru dulu)

function StatItem({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex items-baseline gap-1">
      <dt className="text-slate-500">{k}</dt>
      <dd className="tabular-nums text-slate-900">{v}</dd>
    </div>
  );
}

function CompareCard({ stat, total, color, best }: { stat: OperatorStat; total: number; color: string; best: { count: number; coverage: number } }) {
  const share = total ? (stat.count / total) * 100 : 0;
  const mix = TECH_ORDER.filter((r) => stat.byRadio[r] > 0);
  const m = (v: number) => `${fmt(Math.round(v))} m`;
  const pct = (n: number) => (n / stat.count) * 100;
  return (
    <li className="rounded-lg border border-slate-900/10 bg-white px-2.5 py-2">
      <div className="flex items-center gap-2 text-[13px]">
        <Dot c={color} />
        <span className="min-w-0 flex-1 truncate font-medium">{opName(stat.mnc)}</span>
        <span className="tabular-nums">{fmt(stat.count)}</span>
        <span className="w-9 text-right text-[11px] tabular-nums text-slate-500">{share.toFixed(share < 10 ? 1 : 0)}%</span>
      </div>
      <div className="mt-1 h-[3px] rounded bg-slate-900/5" aria-hidden>
        <div className="h-full rounded" style={{ width: `${best.count ? (stat.count / best.count) * 100 : 0}%`, background: color }} />
      </div>
      <div className="mt-1.5 flex h-1.5 overflow-hidden rounded-full bg-slate-900/5" role="img"
        aria-label={`Teknologi: ${mix.map((r) => `${RADIOS[r]} ${pct(stat.byRadio[r]).toFixed(0)}%`).join(", ")}`}>
        {mix.map((r) => <span key={r} style={{ width: `${pct(stat.byRadio[r])}%`, background: RADIO_COLORS[r] }} />)}
      </div>
      <div className="mt-1 flex flex-wrap gap-x-2.5 text-[10px] text-slate-600">
        {mix.map((r) => <span key={r} className="flex items-center gap-1"><Dot c={RADIO_COLORS[r]} />{RADIOS[r]} {fmt(stat.byRadio[r])}</span>)}
      </div>
      <dl className="mt-1.5 flex flex-wrap justify-between gap-x-3 gap-y-0.5 border-t border-slate-900/5 pt-1.5 text-[11px]">
        <StatItem k="Rata-rata" v={m(stat.avgRange)} />
        <StatItem k="Median" v={m(stat.medianRange)} />
        <StatItem k="Est. cakupan" v={`${fmt(Math.round(stat.coverageKm2))} km²`} />
      </dl>
    </li>
  );
}

/* ---------- Dashboard ---------- */

export default function Dashboard() {
  const [data, setData] = useState<Dataset | null>(null);
  const [error, setError] = useState<{ message: string; detail: string } | null>(null);
  const [loaded, setLoaded] = useState<LoadStep[]>([]);
  const [attempt, setAttempt] = useState(0);
  const [ops, setOps] = useState<Set<number>>(new Set());
  const [radios, setRadios] = useState<Set<number>>(new Set([0, 1, 2, 3]));
  const [minSamples, setMinSamples] = useState(1);
  const [show, setShow] = useState({ cells: false, towers: false, cables: true, landingPoints: true, ituFiber: true });
  const [mode, setMode] = useState<"points" | "heat">("points");
  const [basemap, setBasemap] = useState<Basemap>("voyager");
  const [view, setView] = useState<Preset & { n: number; bounds?: BBox }>({ ...PRESETS[0], n: 0 });
  const [vp, setVp] = useState<Viewport>({ cells: 0, towers: 0 });
  const [region, setRegion] = useState<RegionFilter | null>(null);
  const [pin, setPin] = useState<[number, number] | null>(null);
  const [compareScope, setCompareScope] = useState<"region" | "view">("region");
  const [compareSort, setCompareSort] = useState<"count" | "coverage" | "range">("count");
  const [exportScope, setExportScope] = useState<"filter" | "view">("filter");
  const [exportMsg, setExportMsg] = useState("");
  const topGeo = useGeocoder();
  const areaGeo = useGeocoder();

  // UI: panel melayang (tertutup secara default agar peta lega)
  const [tab, setTab] = useState<Tab | null>(null);
  const [lastTab, setLastTab] = useState<Tab>("layers");
  const [legendOpen, setLegendOpen] = useState(false);
  // Legenda bisa digeser: offset (px) dari posisi bawaan, dibatasi agar tetap di dalam peta
  const legendRef = useRef<HTMLDivElement>(null);
  const [legendPos, setLegendPos] = useState<{ x: number; y: number }>(() => {
    if (typeof window === "undefined") return { x: 0, y: 0 };
    try {
      const v = JSON.parse(localStorage.getItem("legend-pos") ?? "null");
      if (v && Number.isFinite(v.x) && Number.isFinite(v.y)) return v;
    } catch { /* abaikan */ }
    return { x: 0, y: 0 };
  });
  const legendDrag = useRef<{ sx: number; sy: number; ox: number; oy: number; min: [number, number]; max: [number, number]; moved: boolean } | null>(null);
  const suppressLegendClick = useRef(false);
  const [cablesIndex, setCablesIndex] = useState<{ id: string; name: string; center: [number, number]; rfs_year?: number | null; is_planned?: boolean }[]>([]);
  const [q, setQ] = useState("");
  const [searchFocus, setSearchFocus] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const [areaQ, setAreaQ] = useState("");
  const [areaRegion, setAreaRegion] = useState<"Semua" | (typeof REGIONS)[number]>("Semua");

  const openTab = (t: Tab) => {
    if (tab === t) { setTab(null); return; }
    setTab(t); setLastTab(t); setLegendOpen(false);
  };

  // Batas geser legenda = area peta dikurangi margin 8px (posisi dasar = posisi sekarang dikurangi offset)
  const legendLimits = (cur: { x: number; y: number }) => {
    const el = legendRef.current, host = el?.offsetParent as HTMLElement | null;
    if (!el || !host) return null;
    const r = el.getBoundingClientRect(), h = host.getBoundingClientRect(), bx = r.left - cur.x, by = r.top - cur.y;
    return { min: [h.left + 8 - bx, h.top + 8 - by] as [number, number], max: [h.right - 8 - (bx + r.width), h.bottom - 8 - (by + r.height)] as [number, number] };
  };
  const clampLegend = (p: { x: number; y: number }, cur = p) => {
    const l = legendLimits(cur);
    return l ? { x: Math.min(l.max[0], Math.max(l.min[0], p.x)), y: Math.min(l.max[1], Math.max(l.min[1], p.y)) } : p;
  };
  const saveLegend = (p: { x: number; y: number }) => { try { localStorage.setItem("legend-pos", JSON.stringify(p)); } catch { /* abaikan */ } };
  useEffect(() => {
    const onResize = () => setLegendPos((p) => clampLegend(p));
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Indeks sistem kabel laut untuk pencarian
  useEffect(() => {
    fetch("/data/cables_telegeography.geojson")
      .then((r) => (r.ok ? r.json() : null))
      .then((gj) => {
        if (!gj || !Array.isArray(gj.features)) return;
        const byId = new Map<string, { id: string; name: string; center: [number, number]; rfs_year?: number | null; is_planned?: boolean }>();
        for (const f of gj.features) {
          const p = f.properties;
          if (!p?.id || byId.has(p.id)) continue;
          const coords = f.geometry?.coordinates;
          if (!Array.isArray(coords) || coords.length === 0) continue;
          const mid = coords[Math.floor(coords.length / 2)];
          if (Array.isArray(mid) && mid.length >= 2) {
            byId.set(p.id, {
              id: p.id,
              name: p.name || p.id,
              center: [mid[0], mid[1]],
              rfs_year: p.rfs_year,
              is_planned: p.is_planned,
            });
          }
        }
        setCablesIndex(Array.from(byId.values()));
      })
      .catch(() => { /* abaikan jika gagal/offline */ });
  }, []);
  const dragProps = {
    onPointerDown: (e: React.PointerEvent<HTMLElement>) => {
      if (e.button !== 0) return;
      const l = legendLimits(legendPos); if (!l) return;
      suppressLegendClick.current = false;
      e.currentTarget.setPointerCapture(e.pointerId);
      legendDrag.current = { sx: e.clientX, sy: e.clientY, ox: legendPos.x, oy: legendPos.y, ...l, moved: false };
    },
    onPointerMove: (e: React.PointerEvent<HTMLElement>) => {
      const d = legendDrag.current; if (!d) return;
      if (!d.moved && Math.hypot(e.clientX - d.sx, e.clientY - d.sy) < 4) return;
      d.moved = true;
      setLegendPos({
        x: Math.min(d.max[0], Math.max(d.min[0], d.ox + e.clientX - d.sx)),
        y: Math.min(d.max[1], Math.max(d.min[1], d.oy + e.clientY - d.sy)),
      });
    },
    onPointerUp: () => {
      if (!legendDrag.current) return;
      suppressLegendClick.current = legendDrag.current.moved;
      legendDrag.current = null;
      saveLegend(legendPos);
    },
    onPointerCancel: () => { legendDrag.current = null; suppressLegendClick.current = false; },
  };
  const resetLegend = () => { setLegendPos({ x: 0, y: 0 }); saveLegend({ x: 0, y: 0 }); };

  // Pintasan keyboard: [ buka/tutup panel, / fokus ke pencarian, Esc tutup
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      const typing = !!el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA");
      if (e.key === "Escape") {
        if (typing) el!.blur(); else setTab(null);
        return;
      }
      if (typing || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === "[") setTab((t) => (t ? null : lastTab));
      if (e.key === "/") { e.preventDefault(); searchRef.current?.focus(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [lastTab]);

  const retryLoad = () => {
    setError(null);
    setLoaded([]);
    setAttempt((a) => a + 1);
  };

  useEffect(() => {
    // AbortController menghentikan permintaan jaringan saat komponen dilepas atau pemuatan diulang
    const ctrl = new AbortController();
    const { signal } = ctrl;
    loadDataset({ signal, onStep: (step) => { if (!signal.aborted) setLoaded((l) => [...l, step]); } })
      .then((d) => { if (!signal.aborted) { setData(d); setOps(new Set(Object.keys(OPERATORS).map(Number))); } })
      .catch((e) => {
        if (signal.aborted || isAbortError(e)) return; // dibatalkan, bukan gagal
        console.error("[loadDataset]", e); // detail lengkap untuk debugging
        setError(
          e instanceof DataLoadError
            ? { message: e.userMessage, detail: e.detail }
            : { message: "Data tidak bisa dimuat karena terjadi kesalahan tak terduga.", detail: e instanceof Error ? e.message : String(e) },
        );
      });
    return () => ctrl.abort();
  }, [attempt]);

  // Subset sel dalam wilayah aktif (null = semua). Hanya dihitung ulang saat wilayah berubah.
  const regionIdx = useMemo(() => (data && region ? cellsInRegion(data.cells, region) : null), [data, region]);

  // Hitung statistik + indeks sel yang lolos filter (di dalam wilayah aktif)
  const calc = useMemo(() => {
    if (!data) return null;
    const c = data.cells, n = c.radio.length, m = regionIdx ? regionIdx.length : n;
    const perOp = new Map<number, number>();
    const perRadio = [0, 0, 0, 0];
    const keep: number[] = [];
    const mask = new Uint8Array(n);
    let rangeSum = 0, latest = 0;
    for (let k = 0; k < m; k++) {
      const i = regionIdx ? regionIdx[k] : k;
      if (!radios.has(c.radio[i]) || c.samples[i] < minSamples) continue;
      perOp.set(c.mnc[i], (perOp.get(c.mnc[i]) ?? 0) + 1);
      if (!ops.has(c.mnc[i]) && OPERATORS[c.mnc[i]]) continue;
      if (c.updated[i] > latest) latest = c.updated[i];
      perRadio[c.radio[i]]++;
      rangeSum += c.range[i];
      mask[i] = 1;
      keep.push(i);
    }
    return { idx: Uint32Array.from(keep), mask, perOp, perRadio, avgRange: keep.length ? rangeSum / keep.length : 0, latest, total: n, scopeTotal: m };
  }, [data, ops, radios, minSamples, regionIdx]);

  // Filter atribut untuk peta: diterapkan sebagai ekspresi filter layer, bukan dengan membangun ulang GeoJSON
  const cellFilter = useMemo<CellFilter>(
    () => ({ knownOps: KNOWN_OPS, ops: [...ops].filter((m) => OPERATORS[m]), radios: [...radios], minSamples }),
    [ops, radios, minSamples],
  );

  // Perbandingan operator: hanya dihitung saat tab terbuka. Mengikuti wilayah, teknologi, dan sampel
  // (filter operator sengaja diabaikan, kalau tidak tak ada yang dibandingkan).
  const boundsDeb = useDebounced(vp.bounds, 250);
  const compare = useMemo(() => {
    if (!data || tab !== "compare") return null;
    const c = data.cells, m = regionIdx ? regionIdx.length : c.radio.length;
    const b = compareScope === "view" ? boundsDeb : undefined;
    const sel: number[] = [];
    for (let k = 0; k < m; k++) {
      const i = regionIdx ? regionIdx[k] : k;
      if (!radios.has(c.radio[i]) || c.samples[i] < minSamples) continue;
      if (b && !inBBox(c.lon[i], c.lat[i], b)) continue;
      sel.push(i);
    }
    return { stats: compareOperators(c, sel, KNOWN_SET), total: sel.length };
  }, [data, tab, regionIdx, compareScope, boundsDeb, radios, minSamples]);

  const toggle = <T,>(s: Set<T>, v: T, set: (s: Set<T>) => void) => {
    const x = new Set(s);
    if (x.has(v)) {
      x.delete(v);
    } else {
      x.add(v);
    }
    set(x);
  };

  // Hasil pencarian: koordinat, wilayah (preset), kabel laut, operator, lalu opsi cari online
  type SearchResult =
    | { kind: "coord"; lon: number; lat: number }
    | { kind: "area"; p: Preset }
    | { kind: "cable"; item: { id: string; name: string; center: [number, number]; rfs_year?: number | null; is_planned?: boolean } }
    | { kind: "op"; mnc: number; name: string; color: string }
    | { kind: "online"; query: string };
  const results = useMemo<SearchResult[]>(() => {
    const raw = q.trim();
    if (!raw) return [];
    const coord = parseCoordinate(raw);
    if (coord) return [{ kind: "coord", lon: coord[0], lat: coord[1] }];
    const s = raw.toLowerCase();
    const areas = PRESETS.filter((p) => p.label.toLowerCase().includes(s) || p.province.toLowerCase().includes(s)).map((p) => ({ kind: "area" as const, p }));
    const cablesFound = cablesIndex
      .filter((c) => c.name.toLowerCase().includes(s))
      .slice(0, 4)
      .map((c) => ({ kind: "cable" as const, item: c }));
    const opsFound = Object.entries(OPERATORS)
      .filter(([, o]) => o.name.toLowerCase().includes(s))
      .map(([mnc, o]) => ({ kind: "op" as const, mnc: Number(mnc), name: o.name, color: o.color }));
    const list: SearchResult[] = [...areas, ...cablesFound, ...opsFound].slice(0, 7);
    if (raw.length >= 3) list.push({ kind: "online", query: raw }); // provinsi/kabupaten/alamat lewat Nominatim
    return list;
  }, [q, cablesIndex]);

  const applyPlace = (p: PlaceResult) => {
    setPin(null);
    if (p.geometry) setRegion(placeToRegion(p)); // wilayah ber-batas → ikut memfilter data
    setView({ label: p.name, province: p.detail, region: "Nasional", center: p.center, zoom: 11, bounds: p.bbox, n: view.n + 1 });
  };
  const pickPlace = (p: PlaceResult) => {
    applyPlace(p);
    setQ(""); topGeo.reset(); areaGeo.reset(); searchRef.current?.blur();
  };
  const pickResult = (r: SearchResult) => {
    if (r.kind === "online") { topGeo.run(r.query); return; } // dropdown tetap terbuka untuk hasilnya
    if (r.kind === "coord") {
      setPin([r.lon, r.lat]);
      setView({ label: "Koordinat", province: `${r.lat.toFixed(5)}, ${r.lon.toFixed(5)}`, region: "Nasional", center: [r.lon, r.lat], zoom: 14, n: view.n + 1 });
    } else if (r.kind === "area") {
      setView({ ...r.p, n: view.n + 1 });
    } else if (r.kind === "cable") {
      setShow((prev) => ({ ...prev, cables: true }));
      setView({
        label: r.item.name,
        province: `Kabel Laut · ${r.item.is_planned ? "Rencana" : "Operasional"}${r.item.rfs_year ? ` (RFS ${r.item.rfs_year})` : ""}`,
        region: "Nasional",
        center: r.item.center,
        zoom: 7.5,
        n: view.n + 1,
      });
    } else {
      setOps(new Set([r.mnc]));
    }
    setQ(""); topGeo.reset(); searchRef.current?.blur();
  };

  if (error) {
    return (
      <div className="grid h-screen place-items-center bg-slate-50 p-6 text-center">
        <div className="max-w-sm space-y-3">
          <p className="text-sm font-medium text-red-600">Data tidak bisa dimuat</p>
          <p className="text-xs text-slate-700">{error.message}</p>
          <details className="text-left text-[11px] text-slate-500">
            <summary className="cursor-pointer text-center">Detail teknis</summary>
            <p className="mt-1 break-words rounded bg-slate-900/5 p-2 font-mono">{error.detail}</p>
          </details>
          <button onClick={retryLoad} className={`rounded-lg bg-sky-500 px-4 py-1.5 text-sm font-medium text-white hover:bg-sky-400 ${focusRing}`}>
            Muat ulang data
          </button>
        </div>
      </div>
    );
  }
  if (!data || !calc) {
    return (
      <div className="grid h-screen place-items-center bg-slate-50 text-slate-600">
        <div className="space-y-2 text-sm" role="status" aria-live="polite">
          {([["cells", "Data sel BTS"], ["towers", "Data menara"]] as [LoadStep, string][]).map(([k, label]) => (
            <div key={k} className="flex items-center gap-3">
              {loaded.includes(k)
                ? <span className="grid h-4 w-4 place-items-center text-emerald-600" aria-hidden>✓</span>
                : <span className="h-4 w-4 animate-spin rounded-full border-2 border-slate-300 border-t-sky-500" />}
              <span className={loaded.includes(k) ? "text-slate-500" : ""}>{loaded.includes(k) ? `${label} siap` : `Memuat ${label.toLowerCase()}…`}</span>
            </div>
          ))}
        </div>
      </div>
    );
  }

  const place = describePlace(vp.center, vp.zoom);
  const opRows = [...calc.perOp.entries()].sort((a, b) => b[1] - a[1]);
  const maxOp = opRows[0]?.[1] ?? 0;
  const maxRadio = Math.max(...calc.perRadio, 0);
  const knownOps = Object.keys(OPERATORS).map(Number);
  const allRadios = [0, 1, 2, 3];
  const opsDirty = ops.size !== knownOps.length;
  const radiosDirty = radios.size !== RADIOS.length;
  const samplesDirty = minSamples !== 1;
  const dirty = opsDirty || radiosDirty || samplesDirty || !!region;
  const resetFilters = () => { setOps(new Set(knownOps)); setRadios(new Set(allRadios)); setMinSamples(1); setRegion(null); };
  const goToIndonesia = () => {
    setRegion(null);
    setPin(null);
    setQ("");
    setSearchFocus(false);
    topGeo.reset();
    setView({ ...PRESETS[0], n: view.n + 1 });
    setTab(null);
  };
  const kpi: [string, string, string?][] = [
    ["Sel lolos filter", fmt(calc.idx.length), region ? `dari ${fmt(calc.scopeTotal)} sel di ${region.label}` : `dari ${fmt(calc.total)} sel`],
    ["Menara OSM", fmt(data.towers.features.length)],
    ["Kabel laut", "74 sistem", "146 stasiun"],
    ["Fiber optik ITU", "1.060 segmen"],
  ];
  const quick: [ShowKey, string, React.ReactNode][] = [
    ["cells", "Sel BTS", <Dot key="c" c="#f59e0b" />],
    ["towers", "Menara", <Dot key="t" c="#fbbf24" />],
    ["cables", "Kabel laut", <Line key="k" c="#38bdf8" />],
    ["landingPoints", "Landing", <Dot key="l" c="#0891b2" ring />],
    ["ituFiber", "Fiber", <Line key="f" c="#10b981" />],
  ];
  const panelTitle: Record<Tab, string> = { layers: "Layer & peta dasar", filter: "Filter data", area: "Wilayah", compare: "Bandingkan operator", stats: "Ringkasan", export: "Ekspor data" };

  return (
    <main className="relative flex h-[100dvh] flex-col overflow-hidden bg-slate-50 text-slate-900 md:block md:h-screen">

      {/* Toolbar atas: pencarian + toggle layer cepat + chip filter aktif */}
      <div
        className={`relative z-20 flex shrink-0 flex-col gap-1.5 border-b border-slate-900/10 bg-white/95 px-2 pb-2 pt-[max(0.5rem,env(safe-area-inset-top))] shadow-sm md:pointer-events-none md:absolute md:left-3 md:right-14 md:top-3 md:gap-2 md:border-0 md:bg-transparent md:p-0 md:shadow-none md:transition-[left] md:duration-200 ${
          tab ? (tab === "compare" ? "md:left-[492px]" : "md:left-[396px]") : "md:left-[76px]"
        }`}
      >
        <div className="flex flex-col gap-1.5 lg:flex-row lg:flex-wrap lg:items-center lg:justify-between lg:gap-2">
          <div className={`pointer-events-auto flex w-full shrink-0 items-center justify-between rounded-xl px-2.5 py-1.5 ${glass} lg:w-fit lg:justify-start`}>
            <div className="flex min-w-0 items-center gap-2">
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-slate-50 ring-1 ring-slate-900/5">
                <Image src="/Jejaringnusa_removebg.png" alt="" width={32} height={32} className="h-8 w-8 object-contain" />
              </span>
              <div className="min-w-0 leading-tight">
                <p className="truncate text-[11px] font-bold tracking-[0.12em] text-slate-900">JEJARINGNUSA</p>
                <p className="mt-0.5 truncate text-[10px] font-medium text-slate-500">Peta Infrastruktur Seluler</p>
              </div>
            </div>
            <button
              type="button"
              onClick={goToIndonesia}
              title="Kembali ke tampilan Indonesia"
              aria-label="Kembali ke tampilan Indonesia"
              className={`ml-3 shrink-0 rounded-full bg-slate-900/[0.04] px-2 py-1 text-[9px] font-semibold tracking-wide text-slate-500 transition hover:bg-sky-500/10 hover:text-sky-700 ${focusRing} lg:hidden`}
            >
              INDONESIA
            </button>
          </div>

          <div className="flex w-full min-w-0 flex-col gap-1.5 lg:w-auto lg:flex-row lg:items-start lg:gap-2">
            <div className="pointer-events-auto relative w-full shrink-0 md:w-60">
              <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-500"><Icon name="search" size={14} /></span>
              <input
                ref={searchRef} value={q} onChange={(e) => { setQ(e.target.value); topGeo.reset(); }}
                onFocus={() => setSearchFocus(true)} onBlur={() => setTimeout(() => setSearchFocus(false), 120)}
                onKeyDown={(e) => { if (e.key === "Enter" && results[0]) pickResult(results[0]); }}
                placeholder="Kota, provinsi, koordinat, operator" aria-label="Cari wilayah, koordinat, atau operator"
                className={`w-full rounded-xl py-2 pl-8 pr-7 text-xs text-slate-900 placeholder:text-slate-500 ${glass} ${focusRing}`}
              />
              {!q && <kbd className="pointer-events-none absolute right-2 top-1/2 hidden -translate-y-1/2 rounded border border-slate-900/15 px-1 font-mono text-[10px] text-slate-500 md:block">/</kbd>}
              {searchFocus && q.trim() && (
                <div className={`absolute left-0 top-full mt-1 max-h-[60vh] w-72 max-w-[calc(100vw-1.5rem)] overflow-y-auto rounded-xl py-1 ${glass}`}>
                  {topGeo.state.status !== "idle" ? (
                    <PlaceList state={topGeo.state} onPick={pickPlace} />
                  ) : (
                    <ul>
                      {results.length === 0 && <li className="px-3 py-2 text-xs text-slate-500">Tidak ada hasil</li>}
                      {results.map((r) => (
                        <li key={r.kind === "area" ? `a-${r.p.label}` : r.kind === "cable" ? `c-${r.item.id}` : r.kind === "op" ? `o-${r.mnc}` : r.kind}>
                          <button onMouseDown={(e) => e.preventDefault()} onClick={() => pickResult(r)}
                            className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-slate-800 hover:bg-slate-900/5">
                            {r.kind === "coord" && <><Icon name="pin" size={12} /><span className="flex-1">Ke koordinat</span><span className="text-[10px] tabular-nums text-slate-500">{r.lat.toFixed(4)}, {r.lon.toFixed(4)}</span></>}
                            {r.kind === "area" && <><Icon name="pin" size={12} /><span className="flex-1">{r.p.label}</span><span className="max-w-[110px] truncate text-[10px] text-slate-500">{r.p.province}</span></>}
                            {r.kind === "cable" && <><Line c="#38bdf8" /><span className="flex-1 truncate font-medium">{r.item.name}</span><span className="text-[10px] text-sky-700">Kabel Laut</span></>}
                            {r.kind === "op" && <><Dot c={r.color} /><span className="flex-1">{r.name}</span><span className="text-[10px] text-slate-500">Hanya operator ini</span></>}
                            {r.kind === "online" && <><Icon name="search" size={12} /><span className="flex-1 truncate">Cari “{r.query}” di OpenStreetMap</span><kbd className="rounded border border-slate-900/15 px-1 font-mono text-[10px] text-slate-500">↵</kbd></>}
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </div>

            <div className={`pointer-events-auto flex w-full min-w-0 gap-0.5 overflow-hidden rounded-xl p-0.5 md:w-auto md:overflow-x-auto md:p-1 ${glass}`} role="group" aria-label="Layer cepat">
              {quick.map(([k, label, sw]) => (
                <QuickToggle key={k} on={show[k]} onClick={() => setShow({ ...show, [k]: !show[k] })} swatch={sw} label={label} />
              ))}
            </div>
          </div>
        </div>

        {(dirty || pin) && (
          <div className="flex items-center gap-1.5 overflow-x-auto whitespace-nowrap [scrollbar-width:none] md:flex-wrap md:justify-center md:overflow-visible">
            {region && <FilterTag onClear={() => setRegion(null)}>{region.kind}: {region.label}</FilterTag>}
            {pin && <FilterTag onClear={() => setPin(null)}>Titik {pin[1].toFixed(4)}, {pin[0].toFixed(4)}</FilterTag>}
            {opsDirty && <FilterTag onClear={() => setOps(new Set(knownOps))}>Operator {ops.size}/{knownOps.length}</FilterTag>}
            {radiosDirty && (
              <FilterTag onClear={() => setRadios(new Set(allRadios))}>
                {radios.size ? [...radios].sort().map((i) => RADIOS[i]).join(", ") : "Tanpa teknologi"}
              </FilterTag>
            )}
            {samplesDirty && <FilterTag onClear={() => setMinSamples(1)}>Sampel ≥ {minSamples}</FilterTag>}
            {dirty && <button onClick={resetFilters} className={`pointer-events-auto shrink-0 rounded px-1.5 text-[11px] text-slate-700 underline-offset-2 hover:text-slate-900 hover:underline ${focusRing}`}>
              Reset
            </button>}
          </div>
        )}
      </div>

      {/* Area peta: di mobile berada di antara bar atas & bawah (tidak tertutup); di desktop memenuhi layar */}
      <div className="relative min-h-0 flex-1 md:absolute md:inset-0 md:flex-none">
  <MapView cells={data.cells} mask={calc.mask} sourceIdx={regionIdx} filter={cellFilter} region={region} marker={pin} towers={data.towers} show={show} mode={mode} view={view} basemap={basemap} onViewport={setVp} />
      {/* Panel melayang: hanya satu bagian terbuka pada satu waktu */}
      <aside
        aria-label="Panel kontrol" aria-hidden={!tab} inert={!tab}
        className={`absolute inset-x-2 bottom-2 z-30 flex max-h-[80%] flex-col overflow-hidden rounded-2xl transition duration-200 md:inset-x-auto md:bottom-auto md:left-[60px] md:top-3 md:max-h-[calc(100%-1.5rem)] ${lastTab === "compare" ? "md:w-[26rem]" : "md:w-80"} ${glass} ${
          tab ? "translate-y-0 opacity-100 md:translate-x-0" : "pointer-events-none translate-y-2 opacity-0 md:-translate-x-2 md:translate-y-0"
        }`}
      >
        <header className="flex items-center justify-between gap-3 border-b border-slate-900/10 px-4 py-3">
          <div className="flex min-w-0 items-center gap-3">
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-sky-500 text-white shadow-sm shadow-sky-500/30">
              <Icon name="layers" size={18} />
            </span>
            <div className="min-w-0">
              <h1 className="truncate text-sm font-semibold">{panelTitle[lastTab]}</h1>
              <p className="truncate text-[11px] text-slate-500">Peta Infrastruktur Jaringan & Seluler Indonesia</p>
            </div>
          </div>
          <button onClick={() => setTab(null)} aria-label="Tutup panel" className={`rounded p-1 text-slate-600 hover:bg-slate-900/5 hover:text-slate-900 ${focusRing}`}>
            <Icon name="close" />
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-3">
          {lastTab === "layers" && (
            <div className="space-y-1">
              <LayerRow on={show.cells} onToggle={() => setShow({ ...show, cells: !show.cells })} swatch={<Dot c="#f59e0b" />} label="Sel BTS" meta={fmt(calc.idx.length)}>
                <span className="w-full">
                  <Segmented value={mode} onChange={setMode} label="Mode sel"
                    options={[{ id: "points", label: "Titik" }, { id: "heat", label: "Heatmap" }]} />
                </span>
              </LayerRow>
              <LayerRow on={show.towers} onToggle={() => setShow({ ...show, towers: !show.towers })} swatch={<Dot c="#fbbf24" />} label="Menara OSM" meta={fmt(data.towers.features.length)} />
              <LayerRow on={show.cables} onToggle={() => setShow({ ...show, cables: !show.cables })} swatch={<Line c="#38bdf8" />} label="Kabel laut" meta="74 sistem" />
              <LayerRow on={show.landingPoints} onToggle={() => setShow({ ...show, landingPoints: !show.landingPoints })} swatch={<Dot c="#0891b2" ring />} label="Landing station" meta="146 lokasi" />
              <LayerRow on={show.ituFiber} onToggle={() => setShow({ ...show, ituFiber: !show.ituFiber })} swatch={<Line c="#10b981" />} label="Fiber optik & microwave" meta="1.060 segmen">
                <Legend c="#10b981">Operasional (874)</Legend>
                <Legend c="#ca8a04">Rencana (95)</Legend>
                <Legend c="#9333ea">Microwave (91)</Legend>
              </LayerRow>
              <SubHead title="Peta dasar" />
              <div className="px-1">
                <Segmented value={basemap} onChange={setBasemap} label="Peta dasar"
                  options={[{ id: "dark", label: "Gelap" }, { id: "light", label: "Terang" }, { id: "voyager", label: "Voyager" }]} />
              </div>
            </div>
          )}

          {lastTab === "filter" && (
            <div className="space-y-1">
              <SubHead
                title="Operator"
                action={
                  <span className="flex gap-3">
                    <button className={linkBtn} onClick={() => setOps(new Set(knownOps))}>Semua</button>
                    <button className={linkBtn} onClick={() => setOps(new Set())}>Kosongkan</button>
                  </span>
                }
              />
              {opRows.map(([mnc, n]) => {
                const known = OPERATORS[mnc];
                return (
                  <FilterRow
                    key={mnc} fixed={!known} on={!known || ops.has(mnc)} max={maxOp} value={n}
                    color={known?.color ?? OTHER_COLOR} label={known?.name ?? `MNC ${mnc}`}
                    onClick={() => toggle(ops, mnc, setOps)}
                  />
                );
              })}

              <SubHead
                title="Teknologi"
                action={
                  <span className="flex gap-3">
                    <button className={linkBtn} onClick={() => setRadios(new Set(allRadios))}>Semua</button>
                    <button className={linkBtn} onClick={() => setRadios(new Set())}>Kosongkan</button>
                  </span>
                }
              />
              {RADIOS.map((r, i) => (
                <FilterRow key={r} on={radios.has(i)} onClick={() => toggle(radios, i, setRadios)}
                  color={RADIO_COLORS[i]} label={r} value={calc.perRadio[i]} max={maxRadio} />
              ))}

              <SubHead title="Akurasi posisi" />
              <div className="space-y-1.5 px-2">
                <div className="flex justify-between text-xs">
                  <span className="text-slate-700">Minimal sampel</span>
                  <span className="tabular-nums text-sky-700">{minSamples}</span>
                </div>
                <input
                  type="range" min={1} max={30} value={minSamples} aria-label="Minimal sampel"
                  onChange={(e) => setMinSamples(+e.target.value)} className="w-full accent-sky-500"
                />
                <p className="text-[11px] leading-snug text-slate-500">Makin banyak sampel, makin akurat posisi sel. Rata-rata jangkauan sel tampil: {fmt(Math.round(calc.avgRange))} m.</p>
              </div>

              {dirty && (
                <button onClick={resetFilters} className={`mt-3 w-full rounded-lg border border-slate-900/15 py-1.5 text-xs text-slate-800 hover:bg-slate-900/5 ${focusRing}`}>
                  Reset semua filter
                </button>
              )}
            </div>
          )}

          {lastTab === "area" && (() => {
            const s = areaQ.trim().toLowerCase();
            const list = PRESETS.filter((p) =>
              (areaRegion === "Semua" || p.region === areaRegion) &&
              (!s || p.label.toLowerCase().includes(s) || p.province.toLowerCase().includes(s)));
            return (
              <div>
                <section aria-label="Filter wilayah" className="mb-3 space-y-2 rounded-xl bg-slate-900/[0.04] p-2.5">
                  <div className="flex items-center justify-between">
                    <h3 className="text-[11px] font-medium uppercase tracking-wide text-slate-500">Filter wilayah</h3>
                    {region && <button className={linkBtn} onClick={() => setRegion(null)}>Hapus</button>}
                  </div>
                  {region ? (
                    <div className="text-xs">
                      <div className="font-medium">{region.label} <span className="font-normal text-slate-500">· {region.kind}</span></div>
                      <div className="tabular-nums text-slate-600">{fmt(calc.scopeTotal)} sel di dalam wilayah</div>
                    </div>
                  ) : (
                    <p className="text-[11px] leading-snug text-slate-500">Cari provinsi atau kabupaten di bawah, atau batasi data ke area yang sedang terlihat.</p>
                  )}
                  <button
                    disabled={!vp.bounds}
                    onClick={() => vp.bounds && setRegion({ label: "Tampilan peta", kind: "Persegi", bbox: vp.bounds })}
                    className={`w-full rounded-lg border border-slate-900/15 py-1 text-xs text-slate-800 hover:bg-slate-900/5 disabled:opacity-40 ${focusRing}`}
                  >
                    Batasi ke tampilan peta saat ini
                  </button>
                </section>
                <div className="sticky -top-3 z-10 -mx-3 space-y-1.5 border-b border-slate-900/10 bg-white/95 px-3 pb-2 pt-2.5">
                  <div className="relative">
                    <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-500"><Icon name="search" size={13} /></span>
                    <input
                      value={areaQ} onChange={(e) => { setAreaQ(e.target.value); areaGeo.reset(); }}
                      onKeyDown={(e) => { if (e.key === "Enter" && areaQ.trim().length >= 3) areaGeo.run(areaQ); }}
                      placeholder="Cari kota, provinsi, atau kabupaten" aria-label="Cari wilayah"
                      className={`w-full rounded-lg border border-slate-900/10 bg-slate-900/5 py-1 pl-7 pr-7 text-xs text-slate-900 placeholder:text-slate-500 ${focusRing}`}
                    />
                    {areaQ && (
                      <button onClick={() => { setAreaQ(""); areaGeo.reset(); }} aria-label="Hapus pencarian" className={`absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-1 text-slate-500 hover:text-slate-900 ${focusRing}`}>
                        <Icon name="close" size={10} />
                      </button>
                    )}
                  </div>
                  <div className="-mx-3 flex gap-1 overflow-x-auto px-3 pb-0.5 [scrollbar-width:none]">
                    {(["Semua", ...REGIONS] as const).map((r) => (
                      <Chip key={r} small on={areaRegion === r} onClick={() => setAreaRegion(r)}>{r === "Bali & Nusa Tenggara" ? "Bali & NT" : r}</Chip>
                    ))}
                  </div>
                </div>
                <div className="flex items-center justify-between px-0.5 pb-1 pt-2 text-[10px] text-slate-500">
                  <span>{list.length} lokasi</span>
                  {(areaQ || areaRegion !== "Semua") && (
                    <button className={linkBtn} onClick={() => { setAreaQ(""); setAreaRegion("Semua"); }}>Reset</button>
                  )}
                </div>
                {list.length === 0 ? (
                  <p className="px-1 py-4 text-center text-xs text-slate-500">Tidak ada lokasi yang cocok.</p>
                ) : (
                  <div className="flex flex-wrap gap-1">
                    {list.map((p) => (
                      <Chip
                        key={p.label} small
                        on={view.label === p.label && view.n > 0}
                        title={`${p.label} · ${p.province}`}
                        onClick={() => setView({ ...p, n: view.n + 1 })}
                      >
                        {p.label}
                      </Chip>
                    ))}
                  </div>
                )}
                {areaQ.trim().length >= 3 && (
                  <div className="mt-2 border-t border-slate-900/10 pt-2">
                    {areaGeo.state.status === "idle" && (
                      <button className={`${linkBtn} px-0.5 text-xs`} onClick={() => areaGeo.run(areaQ)}>
                        Cari “{areaQ.trim()}” di seluruh Indonesia (OpenStreetMap)
                      </button>
                    )}
                    <div className="-mx-3"><PlaceList state={areaGeo.state} onPick={pickPlace} /></div>
                  </div>
                )}
              </div>
            );
          })()}

          {lastTab === "compare" && (() => {
            const rows = compare ? [...compare.stats].sort((a, b) =>
              compareSort === "coverage" ? b.coverageKm2 - a.coverageKm2 : compareSort === "range" ? b.avgRange - a.avgRange : b.count - a.count) : [];
            const best = { count: Math.max(0, ...rows.map((r) => r.count)), coverage: Math.max(0, ...rows.map((r) => r.coverageKm2)) };
            const short = (t: string) => (t.length > 15 ? `${t.slice(0, 14)}…` : t);
            return (
              <div className="space-y-3">
                <div className="space-y-1.5">
                  <Segmented value={compareScope} onChange={setCompareScope} label="Cakupan perbandingan"
                    options={[{ id: "region", label: region ? short(region.label) : "Seluruh data" }, { id: "view", label: "Tampilan peta" }]} />
                  <Segmented value={compareSort} onChange={setCompareSort} label="Urutkan berdasarkan"
                    options={[{ id: "count", label: "Jumlah sel" }, { id: "coverage", label: "Cakupan" }, { id: "range", label: "Jangkauan" }]} />
                </div>
                {!compare ? null : compare.total === 0 ? (
                  <p className="px-1 py-4 text-center text-xs text-slate-500">Tidak ada sel pada cakupan ini.</p>
                ) : (
                  <>
                    <p className="px-1 text-[11px] text-slate-600" aria-live="polite">
                      {fmt(compare.total)} sel · {compareScope === "view" ? "area yang terlihat" : region ? region.label : "seluruh Indonesia"}
                      {(radiosDirty || samplesDirty) && " · mengikuti filter teknologi & sampel"}
                    </p>
                    <ul className="space-y-1.5">
                      {rows.map((r) => (
                        <CompareCard key={r.mnc} stat={r} total={compare.total} best={best} color={OPERATORS[r.mnc]?.color ?? OTHER_COLOR} />
                      ))}
                    </ul>
                    <details className="px-1 text-[10px] leading-snug text-slate-500">
                      <summary className="cursor-pointer text-[11px] text-sky-700">Catatan metode</summary>
                      <p className="mt-1">Filter operator tidak berlaku di sini. Estimasi cakupan = gabungan lingkaran jangkauan tiap sel (area tumpang tindih dihitung sekali), bukan pengukuran kuat sinyal. Jangkauan adalah radius perkiraan dari data crowdsourced.</p>
                    </details>
                  </>
                )}
              </div>
            );
          })()}

          {lastTab === "export" && (() => {
            const count = exportScope === "view" ? vp.cells : calc.idx.length;
            const doExport = (kind: "csv" | "geojson") => {
              const c = data.cells, b = vp.bounds;
              const idx = exportScope === "view" && b ? Array.from(calc.idx).filter((i) => inBBox(c.lon[i], c.lat[i], b)) : calc.idx;
              const names = { operator: opName, radio: (r: number) => RADIOS[r] ?? String(r) };
              const file = exportFilename(["sel-bts", region?.label ?? "", exportScope === "view" ? "tampilan-peta" : ""], kind);
              if (kind === "csv") download(file, "text/csv", cellsToCSV(c, idx, names));
              else download(file, "application/geo+json", JSON.stringify(cellsToExportGeoJSON(c, idx, names)));
              setExportMsg(`${fmt(idx.length)} sel diekspor ke ${file}`);
            };
            const active = [
              region && `Wilayah: ${region.label}`,
              opsDirty && `Operator ${ops.size}/${knownOps.length}`,
              radiosDirty && `Teknologi: ${radios.size ? [...radios].sort().map((i) => RADIOS[i]).join(", ") : "tidak ada"}`,
              samplesDirty && `Sampel ≥ ${minSamples}`,
            ].filter(Boolean) as string[];
            return (
              <div className="space-y-3">
                <Segmented value={exportScope} onChange={(v) => { setExportScope(v); setExportMsg(""); }} label="Cakupan ekspor"
                  options={[{ id: "filter", label: "Semua hasil filter" }, { id: "view", label: "Hanya tampilan peta" }]} />
                <div className="rounded-xl bg-slate-900/[0.04] px-3 py-2.5 text-xs">
                  <div className="text-[11px] text-slate-500">Akan diekspor</div>
                  <div className="text-[15px] font-semibold tabular-nums">{fmt(count)} sel</div>
                  <div className="mt-1 text-[11px] text-slate-600">{active.length ? active.join(" · ") : "Tanpa filter: semua sel"}</div>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  {(["csv", "geojson"] as const).map((k) => (
                    <button key={k} disabled={count === 0} onClick={() => doExport(k)}
                      className={`flex items-center justify-center gap-1.5 rounded-lg bg-sky-500 py-1.5 text-xs font-medium text-white hover:bg-sky-400 disabled:cursor-not-allowed disabled:opacity-40 ${focusRing}`}>
                      <Icon name="download" size={13} />{k === "csv" ? "CSV" : "GeoJSON"}
                    </button>
                  ))}
                </div>
                <p className="min-h-4 px-1 text-[11px] text-emerald-700" role="status" aria-live="polite">{exportMsg}</p>
                <p className="px-1 text-[10px] leading-snug text-slate-500">
                  Kolom: radio, mcc, mnc, operator, tac, cell_id, lon, lat, range_m, samples, updated. Periksa lisensi sumber data (mis. OpenCelliD CC BY-SA, OpenStreetMap ODbL) dan cantumkan atribusi bila membagikan hasilnya.
                </p>
              </div>
            );
          })()}

          {lastTab === "stats" && (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-px overflow-hidden rounded-xl bg-slate-900/10">
                {kpi.map(([k, v, sub]) => (
                  <div key={k} className="bg-white px-3 py-2.5">
                    <div className="text-[11px] text-slate-500">{k}</div>
                    <div className="text-[15px] font-semibold tabular-nums">{v}</div>
                    {sub && <div className="text-[11px] text-slate-500">{sub}</div>}
                  </div>
                ))}
              </div>
              <div className="space-y-1 rounded-xl bg-slate-900/[0.04] px-3 py-2.5 text-xs">
                <div className="flex justify-between"><span className="text-slate-600">Dalam tampilan peta</span><span className="tabular-nums">{fmt(vp.cells)} sel · {fmt(vp.towers)} menara</span></div>
                <div className="flex justify-between"><span className="text-slate-600">Rata-rata jangkauan</span><span className="tabular-nums">{fmt(Math.round(calc.avgRange))} m</span></div>
                {calc.latest > 0 && (
                  <div className="flex justify-between"><span className="text-slate-600">Pembaruan terakhir</span><span className="tabular-nums">{new Date(calc.latest * 1000).toLocaleDateString("id-ID")}</span></div>
                )}
              </div>
              <div>
                <SubHead title="Sebaran teknologi" />
                {RADIOS.map((r, i) => (
                  <FilterRow key={r} fixed on color={RADIO_COLORS[i]} label={r} value={calc.perRadio[i]} max={maxRadio} />
                ))}
              </div>
            </div>
          )}
        </div>
      </aside>

      {/* Legenda ringkas — mobile: bottom-sheet di atas nav; desktop: floating draggable */}

      {/* === Mobile legend (< md): popover kecil di kanan-bawah area peta; skala ada di kiri-bawah === */}
      <div className="absolute bottom-10 right-2 z-10 flex flex-col items-end gap-1.5 md:hidden">
        {legendOpen && (
          <div className={`w-52 max-w-[calc(100vw-1rem)] space-y-2 rounded-xl p-2.5 text-[11px] text-slate-700 ${glass}`}>
            <div>
              <div className="mb-1 text-slate-500">Sel BTS per operator</div>
              <div className="grid grid-cols-2 gap-x-2 gap-y-1">
                {Object.values(OPERATORS).slice(0, 5).map((o) => (
                  <span key={o.name} className="flex items-center gap-1.5"><Dot c={o.color} />{o.name}</span>
                ))}
                <span className="flex items-center gap-1.5"><Dot c={OTHER_COLOR} />Lainnya</span>
              </div>
            </div>
            <div className="space-y-1">
              <span className="flex items-center gap-1.5"><Dot c="#fbbf24" />Menara OSM</span>
              <span className="flex items-center gap-1.5"><Dot c="#0891b2" ring />Landing station</span>
              <Legend c="#38bdf8">Kabel laut</Legend>
              <Legend c="#10b981">Fiber operasional</Legend>
              <Legend c="#ca8a04">Fiber rencana</Legend>
              <Legend c="#9333ea">Microwave</Legend>
            </div>
          </div>
        )}
        <button
          onClick={() => setLegendOpen(!legendOpen)} aria-expanded={legendOpen}
          className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[11px] text-slate-800 ${glass} ${focusRing}`}
        >
          Legenda
          <span className={`transition ${legendOpen ? "" : "rotate-180"}`}><Icon name="chevron" size={10} /></span>
        </button>
      </div>

      {/* === Desktop legend (>= md) === */}
      <div ref={legendRef} style={{ transform: `translate(${legendPos.x}px, ${legendPos.y}px)` }} className="absolute bottom-14 right-3 z-10 hidden md:block">
        {legendOpen && (
          <div className={`mb-2 w-52 space-y-2.5 rounded-xl p-3 text-[11px] text-slate-700 ${glass}`}>
            <div>
              <div className="mb-1 text-slate-500">Sel BTS per operator</div>
              <div className="grid grid-cols-2 gap-x-2 gap-y-1">
                {Object.values(OPERATORS).slice(0, 5).map((o) => (
                  <span key={o.name} className="flex items-center gap-1.5"><Dot c={o.color} />{o.name}</span>
                ))}
                <span className="flex items-center gap-1.5"><Dot c={OTHER_COLOR} />Lainnya</span>
              </div>
            </div>
            <div className="space-y-1">
              <span className="flex items-center gap-1.5"><Dot c="#fbbf24" />Menara OSM</span>
              <span className="flex items-center gap-1.5"><Dot c="#0891b2" ring />Landing station</span>
              <Legend c="#38bdf8">Kabel laut</Legend>
              <Legend c="#10b981">Fiber operasional</Legend>
              <Legend c="#ca8a04">Fiber rencana</Legend>
              <Legend c="#9333ea">Microwave</Legend>
            </div>
          </div>
        )}
        <button
          {...dragProps}
          onClick={() => {
            if (suppressLegendClick.current) {
              suppressLegendClick.current = false;
              return;
            }
            setLegendOpen(!legendOpen);
          }}
          onDoubleClick={resetLegend}
          onKeyDown={(e) => { if (e.key === "Home") resetLegend(); }}
          title="Seret untuk memindahkan · klik untuk membuka/tutup · klik dua kali untuk mengembalikan"
          aria-label="Legenda. Seret untuk memindahkan, klik untuk membuka atau menutup, klik dua kali untuk mengembalikan posisi"
          aria-expanded={legendOpen}
          className={`flex cursor-grab touch-none select-none items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[11px] text-slate-800 hover:bg-slate-100 active:cursor-grabbing ${glass} ${focusRing}`}
        >
          Legenda
          <span className={`transition ${legendOpen ? "" : "rotate-180"}`}><Icon name="chevron" size={10} /></span>
        </button>
      </div>

      <div className="pointer-events-none absolute bottom-7 left-[60px] z-10 hidden max-w-xs rounded-lg bg-white/90 px-3 py-1.5 shadow-lg backdrop-blur md:block">
        <div className="flex items-center gap-1.5 text-[13px] font-medium text-slate-900">
          <span className="text-sky-700"><Icon name="pin" size={12} /></span>
          <span className="truncate">{place.name}</span>
        </div>
        <div className="truncate text-[11px] text-slate-600">{place.sub}</div>
        <div className="text-[11px] tabular-nums text-slate-700">{fmt(vp.cells)} sel, {fmt(vp.towers)} menara dalam tampilan</div>
      </div>
      </div>

      {/* Bar bawah: mobile = info lokasi + menu; desktop = rail ikon melayang di kiri */}
      <div className="relative z-20 shrink-0 border-t border-slate-900/10 bg-white/95 pb-[env(safe-area-inset-bottom)] shadow-[0_-2px_8px_rgba(15,23,42,.06)] md:contents">
        <div className="flex items-center justify-between gap-2 px-3 pt-1.5 text-[11px] text-slate-600 md:hidden">
          <span className="flex min-w-0 items-center gap-1.5">
            <span className="text-sky-700"><Icon name="pin" size={12} /></span>
            <span className="truncate font-medium text-slate-900">{place.name}</span>
            <span className="truncate">· {place.sub}</span>
          </span>
          <span className="shrink-0 tabular-nums">{fmt(vp.cells)} sel</span>
        </div>
      <nav
        aria-label="Menu utama"
        className={`flex items-center gap-1 px-2 py-1 md:absolute md:left-3 md:top-3 md:z-20 md:flex-col md:justify-start md:rounded-2xl md:p-1 md:border md:border-slate-900/10 md:bg-white/90 md:shadow-xl md:backdrop-blur`}
      >
        <RailBtn icon="layers" label="Layer & peta dasar" active={tab === "layers"} onClick={() => openTab("layers")} />
        <RailBtn icon="filter" label="Filter data" active={tab === "filter"} badge={dirty} onClick={() => openTab("filter")} />
        <RailBtn icon="pin" label="Wilayah" active={tab === "area"} badge={!!region} onClick={() => openTab("area")} />
        <RailBtn icon="compare" label="Bandingkan operator" active={tab === "compare"} onClick={() => openTab("compare")} />
        <RailBtn icon="chart" label="Ringkasan" active={tab === "stats"} onClick={() => openTab("stats")} />
        <RailBtn icon="download" label="Ekspor data" active={tab === "export"} onClick={() => openTab("export")} />
      </nav>
      </div>
    </main>
  );
}