"use client";
import dynamic from "next/dynamic";
import Image from "next/image";
import { useEffect, useMemo, useRef, useState } from "react";
import { OPERATORS, OTHER_COLOR, PRESETS, RADIOS, RADIO_COLORS, REGIONS, type Preset } from "@/lib/config";
import { DataLoadError, isAbortError, loadDataset, type Dataset, type LoadStep } from "@/lib/data";
import { cellsToCSV, cellsToExportGeoJSON, download, downloadCanvasAsPNG, exportFilename } from "@/lib/export";
import { cellsInRegion, parseCoordinate, placeToRegion, type PlaceResult, type RegionFilter } from "@/lib/region";
import { formatNumber, localizeDataMessage, text, useLocale, type Locale } from "@/lib/locale";
import { inBBox, type BBox } from "@/lib/spatial";
import { compareOperators, OTHER_OPERATOR, type OperatorStat } from "@/lib/stats";
import type { Basemap, CellFilter, Viewport } from "./MapView";
import type { Map as MLMap } from "maplibre-gl";
import { useGeocoder, type GeocodeState } from "./useGeocoder";

function MapLoading() {
  const locale = useLocale();
  return <div className="grid h-full place-items-center text-sm text-slate-500">{text(locale, "Preparing map…", "Menyiapkan peta…")}</div>;
}

const MapView = dynamic(() => import("./MapView"), {
  ssr: false,
  loading: MapLoading,
});
const KNOWN_OPS = Object.keys(OPERATORS).map(Number);
const KNOWN_SET: ReadonlySet<number> = new Set(KNOWN_OPS);
const fmt = (n: number, locale: Locale) => formatNumber(n, locale);
const opName = (mnc: number, locale: Locale) => (mnc === OTHER_OPERATOR ? text(locale, "Other", "Lainnya") : OPERATORS[mnc]?.name ?? `MNC ${mnc}`);

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => { const t = setTimeout(() => setV(value), ms); return () => clearTimeout(t); }, [value, ms]);
  return v;
}
const focusRing = "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-400";
// Nearest location to the map center (offline, from PRESETS)
const CITIES = PRESETS.filter((p) => p.region !== "National");
function distKm(a: [number, number], b: [number, number]) {
  const r = Math.PI / 180, dLat = (b[1] - a[1]) * r, dLon = (b[0] - a[0]) * r;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a[1] * r) * Math.cos(b[1] * r) * Math.sin(dLon / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(h));
}
function describePlace(center: [number, number] | undefined, zoom: number | undefined, locale: Locale): { name: string; sub: string } {
  if (!center || zoom === undefined || zoom < 5.5) return { name: "Indonesia", sub: text(locale, "National view", "Tampilan nasional") };
  let best: Preset = CITIES[0], bd = Infinity;
  for (const c of CITIES) { const d = distKm(center, c.center); if (d < bd) { bd = d; best = c; } }
  if (bd < 40) return { name: best.label, sub: localizedPresetName(best.province, locale) };
  return locale === "id"
    ? { name: `Dekat ${best.label}`, sub: `${localizedPresetName(best.province, locale)} · ±${fmt(Math.round(bd), locale)} km` }
    : { name: `Near ${best.label}`, sub: `${best.province} · ~${fmt(Math.round(bd), locale)} km` };
}

function localizedPresetName(value: string, locale: Locale): string {
  if (locale !== "id") return value;
  const names: Record<string, string> = {
    National: "Nasional", "Entire archipelago": "Seluruh nusantara", Java: "Jawa",
    "Jakarta, Banten, West Java": "DKI Jakarta, Banten, Jawa Barat", "West Java": "Jawa Barat",
    "Central Java": "Jawa Tengah", "East Java": "Jawa Timur",
    "Map view": "Tampilan peta", Rectangle: "Persegi",
  };
  return names[value] ?? value;
}

function localizedAreaKind(value: string, locale: Locale): string {
  const kinds: Record<string, string> = {
    Rectangle: "Persegi", Province: "Provinsi", Regency: "Kabupaten", City: "Kota",
    District: "Kecamatan", Suburb: "Kelurahan", Village: "Desa", Island: "Pulau",
    Town: "Kota", Region: "Wilayah", Area: "Wilayah", Location: "Lokasi",
  };
  return locale === "id" ? kinds[value] ?? value : value;
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

function FilterRow({ on, onClick, color, label, value, max, fixed, locale }: {
  on: boolean; onClick?: () => void; color: string; label: string; value: number; max: number; fixed?: boolean; locale: Locale;
}) {
  const body = (
    <>
      <div className="flex items-center gap-2 text-[13px]">
        <span className="h-2.5 w-2.5 rounded-sm" style={{ background: on ? color : "#cbd5e1" }} />
        <span className="flex-1 text-left">{label}</span>
        <span className="tabular-nums text-xs text-slate-600">{fmt(value, locale)}</span>
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

function FilterTag({ children, onClear, locale }: { children: React.ReactNode; onClear: () => void; locale: Locale }) {
  return (
    <button
      onClick={onClear} title={text(locale, "Remove this filter", "Hapus filter ini")}
      className={`pointer-events-auto flex items-center gap-1.5 rounded-full border border-sky-400/40 bg-sky-500/15 py-1 pl-2.5 pr-2 text-[11px] text-sky-800 backdrop-blur hover:bg-sky-500/25 ${focusRing}`}
    >
      {children}
      <Icon name="close" size={10} />
    </button>
  );
}

/** Online location search results (Nominatim). Administrative boundaries also filter the data. */
function PlaceList({ state, onPick, locale }: { state: GeocodeState; onPick: (p: PlaceResult) => void; locale: Locale }) {
  if (state.status === "idle") return null;
  if (state.status === "loading") {
    return (
      <div className="flex items-center gap-2 px-3 py-2 text-xs text-slate-600" role="status">
        <span className="h-3 w-3 animate-spin rounded-full border-2 border-slate-300 border-t-sky-500" />{text(locale, `Searching for “${state.q}”…`, `Mencari “${state.q}”…`)}
      </div>
    );
  }
  if (state.status === "error") return <p className="px-3 py-2 text-xs text-red-600" role="alert">{text(locale, state.message, "Pencarian lokasi gagal. Periksa koneksi lalu coba lagi.")}</p>;
  if (!state.results.length) return <p className="px-3 py-2 text-xs text-slate-500">{text(locale, `No results for “${state.q}”.`, `Tidak ada hasil untuk “${state.q}”.`)}</p>;
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
                {p.geometry ? `${p.kind} · ${text(locale, "boundary", "batas wilayah")}` : p.kind}
              </span>
            </button>
          </li>
        ))}
      </ul>
      <p className="px-3 pb-1.5 pt-1 text-[10px] leading-snug text-slate-500">{text(locale, "Selecting an area with boundaries (province, regency, or city) also filters data to those boundaries. Source: OpenStreetMap Nominatim.", "Memilih wilayah berbatas (provinsi, kabupaten, atau kota) juga memfilter data sesuai batas tersebut. Sumber: OpenStreetMap Nominatim.")}</p>
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

function CompareCard({ stat, total, color, best, locale }: { stat: OperatorStat; total: number; color: string; best: { count: number; coverage: number }; locale: Locale }) {
  const share = total ? (stat.count / total) * 100 : 0;
  const mix = TECH_ORDER.filter((r) => stat.byRadio[r] > 0);
  const m = (v: number) => `${fmt(Math.round(v), locale)} m`;
  const pct = (n: number) => (n / stat.count) * 100;
  return (
    <li className="rounded-lg border border-slate-900/10 bg-white px-2.5 py-2">
      <div className="flex items-center gap-2 text-[13px]">
        <Dot c={color} />
        <span className="min-w-0 flex-1 truncate font-medium">{opName(stat.mnc, locale)}</span>
        <span className="tabular-nums">{fmt(stat.count, locale)}</span>
        <span className="w-9 text-right text-[11px] tabular-nums text-slate-500">{share.toFixed(share < 10 ? 1 : 0)}%</span>
      </div>
      <div className="mt-1 h-[3px] rounded bg-slate-900/5" aria-hidden>
        <div className="h-full rounded" style={{ width: `${best.count ? (stat.count / best.count) * 100 : 0}%`, background: color }} />
      </div>
      <div className="mt-1.5 flex h-1.5 overflow-hidden rounded-full bg-slate-900/5" role="img"
        aria-label={`${text(locale, "Technology", "Teknologi")}: ${mix.map((r) => `${RADIOS[r]} ${pct(stat.byRadio[r]).toFixed(0)}%`).join(", ")}`}>
        {mix.map((r) => <span key={r} style={{ width: `${pct(stat.byRadio[r])}%`, background: RADIO_COLORS[r] }} />)}
      </div>
      <div className="mt-1 flex flex-wrap gap-x-2.5 text-[10px] text-slate-600">
        {mix.map((r) => <span key={r} className="flex items-center gap-1"><Dot c={RADIO_COLORS[r]} />{RADIOS[r]} {fmt(stat.byRadio[r], locale)}</span>)}
      </div>
      <dl className="mt-1.5 flex flex-wrap justify-between gap-x-3 gap-y-0.5 border-t border-slate-900/5 pt-1.5 text-[11px]">
        <StatItem k={text(locale, "Average range", "Jangkauan rata-rata")} v={m(stat.avgRange)} />
        <StatItem k={text(locale, "Median", "Median")} v={m(stat.medianRange)} />
        <StatItem k={text(locale, "Est. coverage", "Perkiraan cakupan")} v={`${fmt(Math.round(stat.coverageKm2), locale)} km²`} />
      </dl>
    </li>
  );
}

/* ---------- Dashboard ---------- */

export default function Dashboard() {
  const locale = useLocale();
  const t = (english: string, indonesian: string) => text(locale, english, indonesian);
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
  const [exportMap, setExportMap] = useState<MLMap | null>(null);
  const topGeo = useGeocoder(locale);
  const areaGeo = useGeocoder(locale);

  // Floating panel, closed by default to maximize map space.
  const [tab, setTab] = useState<Tab | null>(null);
  const [lastTab, setLastTab] = useState<Tab>("layers");
  const [legendOpen, setLegendOpen] = useState(false);
  // The draggable legend is constrained to remain inside the map.
  const legendRef = useRef<HTMLDivElement>(null);
  const mobileLegendRef = useRef<HTMLDivElement>(null);
  const [legendPos, setLegendPos] = useState<{ x: number; y: number }>(() => {
    if (typeof window === "undefined") return { x: 0, y: 0 };
    try {
      const v = JSON.parse(localStorage.getItem("legend-pos") ?? "null");
      if (v && Number.isFinite(v.x) && Number.isFinite(v.y)) return v;
    } catch { /* abaikan */ }
    return { x: 0, y: 0 };
  });
  const [mobileLegendPos, setMobileLegendPos] = useState<{ x: number; y: number }>(() => {
    if (typeof window === "undefined") return { x: 0, y: 0 };
    try {
      const v = JSON.parse(localStorage.getItem("mobile-legend-pos") ?? "null");
      if (v && Number.isFinite(v.x) && Number.isFinite(v.y)) return v;
    } catch { /* abaikan */ }
    return { x: 0, y: 0 };
  });
  const legendDrag = useRef<{ sx: number; sy: number; ox: number; oy: number; min: [number, number]; max: [number, number]; moved: boolean; mobile: boolean } | null>(null);
  const suppressLegendClick = useRef(false);
  const [cablesIndex, setCablesIndex] = useState<{ id: string; name: string; center: [number, number]; rfs_year?: number | null; is_planned?: boolean }[]>([]);
  const [q, setQ] = useState("");
  const [searchFocus, setSearchFocus] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const [areaQ, setAreaQ] = useState("");
  const [areaRegion, setAreaRegion] = useState<"All" | (typeof REGIONS)[number]>("All");

  const openTab = (t: Tab) => {
    if (tab === t) { setTab(null); return; }
    setTab(t); setLastTab(t); setLegendOpen(false);
  };

  // Keep the legend within the map area with an 8px margin.
  const legendLimits = (cur: { x: number; y: number }, el = legendRef.current) => {
    const host = el?.offsetParent as HTMLElement | null;
    if (!el || !host) return null;
    const r = el.getBoundingClientRect(), h = host.getBoundingClientRect(), bx = r.left - cur.x, by = r.top - cur.y;
    return { min: [h.left + 8 - bx, h.top + 8 - by] as [number, number], max: [h.right - 8 - (bx + r.width), h.bottom - 8 - (by + r.height)] as [number, number] };
  };
  const clampLegend = (p: { x: number; y: number }, cur = p, el = legendRef.current) => {
    const l = legendLimits(cur, el);
    return l ? { x: Math.min(l.max[0], Math.max(l.min[0], p.x)), y: Math.min(l.max[1], Math.max(l.min[1], p.y)) } : p;
  };
  const saveLegend = (p: { x: number; y: number }, mobile = false) => {
    try { localStorage.setItem(mobile ? "mobile-legend-pos" : "legend-pos", JSON.stringify(p)); } catch { /* abaikan */ }
  };
  useEffect(() => {
    const onResize = () => setLegendPos((p) => clampLegend(p));
    const onMobileResize = () => setMobileLegendPos((p) => clampLegend(p, p, mobileLegendRef.current));
    window.addEventListener("resize", onResize);
    window.addEventListener("resize", onMobileResize);
    return () => {
      window.removeEventListener("resize", onResize);
      window.removeEventListener("resize", onMobileResize);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Index submarine cable systems for search.
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
  const mobileLegendDragProps = {
    onPointerDown: (e: React.PointerEvent<HTMLElement>) => {
      if (e.button !== 0) return;
      const limits = legendLimits(mobileLegendPos, mobileLegendRef.current);
      if (!limits) return;
      suppressLegendClick.current = false;
      e.currentTarget.setPointerCapture(e.pointerId);
      legendDrag.current = { sx: e.clientX, sy: e.clientY, ox: mobileLegendPos.x, oy: mobileLegendPos.y, ...limits, moved: false, mobile: true };
    },
    onPointerMove: (e: React.PointerEvent<HTMLElement>) => {
      const drag = legendDrag.current;
      if (!drag) return;
      if (!drag.moved && Math.hypot(e.clientX - drag.sx, e.clientY - drag.sy) < 4) return;
      drag.moved = true;
      setMobileLegendPos({
        x: Math.min(drag.max[0], Math.max(drag.min[0], drag.ox + e.clientX - drag.sx)),
        y: Math.min(drag.max[1], Math.max(drag.min[1], drag.oy + e.clientY - drag.sy)),
      });
    },
    onPointerUp: (e: React.PointerEvent<HTMLElement>) => {
      const drag = legendDrag.current;
      if (!drag) return;
      suppressLegendClick.current = drag.moved;
      legendDrag.current = null;
      const position = drag.moved ? {
        x: Math.min(drag.max[0], Math.max(drag.min[0], drag.ox + e.clientX - drag.sx)),
        y: Math.min(drag.max[1], Math.max(drag.min[1], drag.oy + e.clientY - drag.sy)),
      } : { x: drag.ox, y: drag.oy };
      setMobileLegendPos(position);
      saveLegend(position, true);
    },
    onPointerCancel: () => { legendDrag.current = null; suppressLegendClick.current = false; },
  };
  const desktopLegendDragProps = {
    onPointerDown: (e: React.PointerEvent<HTMLElement>) => {
      if (e.button !== 0) return;
      const limits = legendLimits(legendPos, legendRef.current);
      if (!limits) return;
      suppressLegendClick.current = false;
      e.currentTarget.setPointerCapture(e.pointerId);
      legendDrag.current = { sx: e.clientX, sy: e.clientY, ox: legendPos.x, oy: legendPos.y, ...limits, moved: false, mobile: false };
    },
    onPointerMove: (e: React.PointerEvent<HTMLElement>) => {
      const drag = legendDrag.current;
      if (!drag) return;
      if (!drag.moved && Math.hypot(e.clientX - drag.sx, e.clientY - drag.sy) < 4) return;
      drag.moved = true;
      setLegendPos({
        x: Math.min(drag.max[0], Math.max(drag.min[0], drag.ox + e.clientX - drag.sx)),
        y: Math.min(drag.max[1], Math.max(drag.min[1], drag.oy + e.clientY - drag.sy)),
      });
    },
    onPointerUp: (e: React.PointerEvent<HTMLElement>) => {
      const drag = legendDrag.current;
      if (!drag) return;
      suppressLegendClick.current = drag.moved;
      legendDrag.current = null;
      const position = drag.moved ? {
        x: Math.min(drag.max[0], Math.max(drag.min[0], drag.ox + e.clientX - drag.sx)),
        y: Math.min(drag.max[1], Math.max(drag.min[1], drag.oy + e.clientY - drag.sy)),
      } : { x: drag.ox, y: drag.oy };
      setLegendPos(position);
      saveLegend(position);
    },
    onPointerCancel: () => { legendDrag.current = null; suppressLegendClick.current = false; },
  };
  const resetLegend = (mobile = false) => {
    const position = { x: 0, y: 0 };
    if (mobile) setMobileLegendPos(position);
    else setLegendPos(position);
    saveLegend(position, mobile);
  };

  // Keyboard shortcuts: [ toggles the panel, / focuses search, Esc closes.
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
            : { message: "Data could not be loaded due to an unexpected error.", detail: e instanceof Error ? e.message : String(e) },
        );
      });
    return () => ctrl.abort();
  }, [attempt]);

  // Subset of cells in the active area (null = all). Recomputed only when the area changes.
  const regionIdx = useMemo(() => (data && region ? cellsInRegion(data.cells, region) : null), [data, region]);

  // Calculate statistics and filtered cell indices within the active area.
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

  // Apply attribute filters as layer expressions instead of rebuilding GeoJSON.
  const cellFilter = useMemo<CellFilter>(
    () => ({ knownOps: KNOWN_OPS, ops: [...ops].filter((m) => OPERATORS[m]), radios: [...radios], minSamples }),
    [ops, radios, minSamples],
  );

  // Compare operators only while the tab is open. Respect area, technology, and sample filters.
  // The operator filter is intentionally ignored so there is always something to compare.
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

  // Search results: coordinates, preset areas, submarine cables, operators, and online search.
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
    if (raw.length >= 3) list.push({ kind: "online", query: raw });
    return list;
  }, [q, cablesIndex]);

  const applyPlace = (p: PlaceResult) => {
    setPin(null);
    if (p.geometry) setRegion(placeToRegion(p));
    setView({ label: p.name, province: p.detail, region: "National", center: p.center, zoom: 11, bounds: p.bbox, n: view.n + 1 });
  };
  const pickPlace = (p: PlaceResult) => {
    applyPlace(p);
    setQ(""); topGeo.reset(); areaGeo.reset(); searchRef.current?.blur();
  };
  const pickResult = (r: SearchResult) => {
    if (r.kind === "online") { topGeo.run(r.query); return; } // dropdown tetap terbuka untuk hasilnya
    if (r.kind === "coord") {
      setPin([r.lon, r.lat]);
      setView({ label: "Coordinates", province: `${r.lat.toFixed(5)}, ${r.lon.toFixed(5)}`, region: "National", center: [r.lon, r.lat], zoom: 14, n: view.n + 1 });
    } else if (r.kind === "area") {
      setView({ ...r.p, n: view.n + 1 });
    } else if (r.kind === "cable") {
      setShow((prev) => ({ ...prev, cables: true }));
      setView({
        label: r.item.name,
        province: `Submarine cable · ${r.item.is_planned ? "Planned" : "Operational"}${r.item.rfs_year ? ` (RFS ${r.item.rfs_year})` : ""}`,
        region: "National",
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
          <p className="text-sm font-medium text-red-600">{t("Unable to load data", "Data tidak dapat dimuat")}</p>
          <p className="text-xs text-slate-700">{localizeDataMessage(error.message, locale)}</p>
          <details className="text-left text-[11px] text-slate-500">
            <summary className="cursor-pointer text-center">{t("Technical details", "Detail teknis")}</summary>
            <p className="mt-1 break-words rounded bg-slate-900/5 p-2 font-mono">{error.detail}</p>
          </details>
          <button onClick={retryLoad} className={`rounded-lg bg-sky-500 px-4 py-1.5 text-sm font-medium text-white hover:bg-sky-400 ${focusRing}`}>
            {t("Reload data", "Muat ulang data")}
          </button>
        </div>
      </div>
    );
  }
  if (!data || !calc) {
    return (
      <div className="grid h-screen place-items-center bg-slate-50 text-slate-600">
        <div className="space-y-2 text-sm" role="status" aria-live="polite">
          {([["cells", t("Cell site data", "Data BTS")], ["towers", t("Tower data", "Data menara")]] as [LoadStep, string][]).map(([k, label]) => (
            <div key={k} className="flex items-center gap-3">
              {loaded.includes(k)
                ? <span className="grid h-4 w-4 place-items-center text-emerald-600" aria-hidden>✓</span>
                : <span className="h-4 w-4 animate-spin rounded-full border-2 border-slate-300 border-t-sky-500" />}
              <span className={loaded.includes(k) ? "text-slate-500" : ""}>{loaded.includes(k) ? `${label} ${t("ready", "siap")}` : `${t("Loading", "Memuat")} ${label.toLowerCase()}…`}</span>
            </div>
          ))}
        </div>
      </div>
    );
  }

  const place = describePlace(vp.center, vp.zoom, locale);
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
    [t("Filtered cell sites", "Sel BTS terfilter"), fmt(calc.idx.length, locale), region ? t(`of ${fmt(calc.scopeTotal, locale)} cell sites in ${region.label}`, `dari ${fmt(calc.scopeTotal, locale)} sel BTS di ${region.label}`) : t(`of ${fmt(calc.total, locale)} cell sites`, `dari ${fmt(calc.total, locale)} sel BTS`)],
    [t("OSM towers", "Menara OSM"), fmt(data.towers.features.length, locale)],
    [t("Submarine cables", "Kabel laut"), t("74 systems", "74 sistem"), t("146 landing stations", "146 stasiun pendaratan")],
    [t("ITU fiber optic", "Fiber optik ITU"), t("1,060 segments", "1.060 segmen")],
  ];
  const quick: [ShowKey, string, React.ReactNode][] = [
    ["cells", t("Cell sites", "Sel BTS"), <Dot key="c" c="#f59e0b" />],
    ["towers", t("Towers", "Menara"), <Dot key="t" c="#fbbf24" />],
    ["cables", t("Submarine cables", "Kabel laut"), <Line key="k" c="#38bdf8" />],
    ["landingPoints", t("Landing stations", "Stasiun pendaratan"), <Dot key="l" c="#0891b2" ring />],
    ["ituFiber", t("Fiber", "Fiber"), <Line key="f" c="#10b981" />],
  ];
  const panelTitle: Record<Tab, string> = {
    layers: t("Layers & basemap", "Layer & peta dasar"), filter: t("Data filters", "Filter data"),
    area: t("Area", "Wilayah"), compare: t("Compare operators", "Bandingkan operator"),
    stats: t("Summary", "Ringkasan"), export: t("Export data", "Ekspor data"),
  };

  return (
    <main className="relative flex h-[100dvh] flex-col overflow-hidden bg-slate-50 text-slate-900 md:block md:h-screen">

      {/* Top toolbar: search, quick layer toggles, and active filter chips */}
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
                <p className="mt-0.5 truncate text-[10px] font-medium text-slate-500">{t("Mobile Network Infrastructure Map", "Peta Infrastruktur Jaringan Seluler")}</p>
              </div>
            </div>
            <button
              type="button"
              onClick={goToIndonesia}
              title={t("Return to the Indonesia view", "Kembali ke tampilan Indonesia")}
              aria-label={t("Return to the Indonesia view", "Kembali ke tampilan Indonesia")}
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
                placeholder={t("City, province, coordinates, operator", "Kota, provinsi, koordinat, operator")} aria-label={t("Search areas, coordinates, or operators", "Cari wilayah, koordinat, atau operator")}
                className={`w-full rounded-xl py-2 pl-8 pr-7 text-xs text-slate-900 placeholder:text-slate-500 ${glass} ${focusRing}`}
              />
              {!q && <kbd className="pointer-events-none absolute right-2 top-1/2 hidden -translate-y-1/2 rounded border border-slate-900/15 px-1 font-mono text-[10px] text-slate-500 md:block">/</kbd>}
              {searchFocus && q.trim() && (
                <div className={`absolute left-0 top-full mt-1 max-h-[60vh] w-72 max-w-[calc(100vw-1.5rem)] overflow-y-auto rounded-xl py-1 ${glass}`}>
                  {topGeo.state.status !== "idle" ? (
                    <PlaceList state={topGeo.state} onPick={pickPlace} locale={locale} />
                  ) : (
                    <ul>
                      {results.length === 0 && <li className="px-3 py-2 text-xs text-slate-500">{t("No results", "Tidak ada hasil")}</li>}
                      {results.map((r) => (
                        <li key={r.kind === "area" ? `a-${r.p.label}` : r.kind === "cable" ? `c-${r.item.id}` : r.kind === "op" ? `o-${r.mnc}` : r.kind}>
                          <button onMouseDown={(e) => e.preventDefault()} onClick={() => pickResult(r)}
                            className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-slate-800 hover:bg-slate-900/5">
                            {r.kind === "coord" && <><Icon name="pin" size={12} /><span className="flex-1">{t("Go to coordinates", "Ke koordinat")}</span><span className="text-[10px] tabular-nums text-slate-500">{r.lat.toFixed(4)}, {r.lon.toFixed(4)}</span></>}
                            {r.kind === "area" && <><Icon name="pin" size={12} /><span className="flex-1">{r.p.label}</span><span className="max-w-[110px] truncate text-[10px] text-slate-500">{localizedPresetName(r.p.province, locale)}</span></>}
                            {r.kind === "cable" && <><Line c="#38bdf8" /><span className="flex-1 truncate font-medium">{r.item.name}</span><span className="text-[10px] text-sky-700">{t("Submarine cable", "Kabel laut")}</span></>}
                            {r.kind === "op" && <><Dot c={r.color} /><span className="flex-1">{r.name}</span><span className="text-[10px] text-slate-500">{t("This operator only", "Hanya operator ini")}</span></>}
                            {r.kind === "online" && <><Icon name="search" size={12} /><span className="flex-1 truncate">{t(`Search “${r.query}” on OpenStreetMap`, `Cari “${r.query}” di OpenStreetMap`)}</span><kbd className="rounded border border-slate-900/15 px-1 font-mono text-[10px] text-slate-500">↵</kbd></>}
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </div>

            <div className={`pointer-events-auto flex w-full min-w-0 gap-0.5 overflow-hidden rounded-xl p-0.5 md:w-auto md:overflow-x-auto md:p-1 ${glass}`} role="group" aria-label={t("Quick layers", "Layer cepat")}>
              {quick.map(([k, label, sw]) => (
                <QuickToggle key={k} on={show[k]} onClick={() => setShow({ ...show, [k]: !show[k] })} swatch={sw} label={label} />
              ))}
            </div>
          </div>
        </div>

        {(dirty || pin) && (
          <div className="flex items-center gap-1.5 overflow-x-auto whitespace-nowrap [scrollbar-width:none] md:flex-wrap md:justify-center md:overflow-visible">
            {region && <FilterTag locale={locale} onClear={() => setRegion(null)}>{localizedAreaKind(region.kind, locale)}: {localizedPresetName(region.label, locale)}</FilterTag>}
            {pin && <FilterTag locale={locale} onClear={() => setPin(null)}>{t("Point", "Titik")} {pin[1].toFixed(4)}, {pin[0].toFixed(4)}</FilterTag>}
            {opsDirty && <FilterTag locale={locale} onClear={() => setOps(new Set(knownOps))}>{t("Operators", "Operator")} {ops.size}/{knownOps.length}</FilterTag>}
            {radiosDirty && (
              <FilterTag locale={locale} onClear={() => setRadios(new Set(allRadios))}>
                {radios.size ? [...radios].sort().map((i) => RADIOS[i]).join(", ") : t("No technology", "Tanpa teknologi")}
              </FilterTag>
            )}
            {samplesDirty && <FilterTag locale={locale} onClear={() => setMinSamples(1)}>{t("Samples", "Sampel")} ≥ {minSamples}</FilterTag>}
            {dirty && <button onClick={resetFilters} className={`pointer-events-auto shrink-0 rounded px-1.5 text-[11px] text-slate-700 underline-offset-2 hover:text-slate-900 hover:underline ${focusRing}`}>
              {t("Reset", "Atur ulang")}
            </button>}
          </div>
        )}
      </div>

      {/* On mobile, the map sits between the top and bottom bars; on desktop, it fills the screen. */}
      <div className="relative min-h-0 flex-1 md:absolute md:inset-0 md:flex-none">
  <MapView cells={data.cells} mask={calc.mask} sourceIdx={regionIdx} filter={cellFilter} region={region} marker={pin} towers={data.towers} show={show} mode={mode} view={view} basemap={basemap} locale={locale} onViewport={setVp} onMapReady={setExportMap} />
      {/* Panel melayang: hanya satu bagian terbuka pada satu waktu */}
      <aside
        aria-label={t("Control panel", "Panel kontrol")} aria-hidden={!tab} inert={!tab}
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
              <p className="truncate text-[11px] text-slate-500">{t("Indonesia Network & Mobile Infrastructure Map", "Peta Infrastruktur Jaringan & Seluler Indonesia")}</p>
            </div>
          </div>
          <button onClick={() => setTab(null)} aria-label={t("Close panel", "Tutup panel")} className={`rounded p-1 text-slate-600 hover:bg-slate-900/5 hover:text-slate-900 ${focusRing}`}>
            <Icon name="close" />
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-3">
          {lastTab === "layers" && (
            <div className="space-y-1">
              <LayerRow on={show.cells} onToggle={() => setShow({ ...show, cells: !show.cells })} swatch={<Dot c="#f59e0b" />} label={t("Cell sites", "Sel BTS")} meta={fmt(calc.idx.length, locale)}>
                <span className="w-full">
                  <Segmented value={mode} onChange={setMode} label={t("Cell display mode", "Mode tampilan sel")}
                    options={[{ id: "points", label: t("Points", "Titik") }, { id: "heat", label: "Heatmap" }]} />
                </span>
              </LayerRow>
              <LayerRow on={show.towers} onToggle={() => setShow({ ...show, towers: !show.towers })} swatch={<Dot c="#fbbf24" />} label={t("OSM towers", "Menara OSM")} meta={fmt(data.towers.features.length, locale)} />
              <LayerRow on={show.cables} onToggle={() => setShow({ ...show, cables: !show.cables })} swatch={<Line c="#38bdf8" />} label={t("Submarine cables", "Kabel laut")} meta={t("74 systems", "74 sistem")} />
              <LayerRow on={show.landingPoints} onToggle={() => setShow({ ...show, landingPoints: !show.landingPoints })} swatch={<Dot c="#0891b2" ring />} label={t("Landing stations", "Stasiun pendaratan")} meta={t("146 locations", "146 lokasi")} />
              <LayerRow on={show.ituFiber} onToggle={() => setShow({ ...show, ituFiber: !show.ituFiber })} swatch={<Line c="#10b981" />} label={t("Fiber optic & microwave", "Fiber optik & microwave")} meta={t("1,060 segments", "1.060 segmen")}>
                <Legend c="#10b981">{t("Operational", "Operasional")} (874)</Legend>
                <Legend c="#ca8a04">{t("Planned", "Rencana")} (95)</Legend>
                <Legend c="#9333ea">Microwave (91)</Legend>
              </LayerRow>
              <SubHead title={t("Basemap", "Peta dasar")} />
              <div className="px-1">
                <Segmented value={basemap} onChange={setBasemap} label={t("Basemap", "Peta dasar")}
                  options={[{ id: "dark", label: t("Dark", "Gelap") }, { id: "light", label: t("Light", "Terang") }, { id: "voyager", label: "Voyager" }]} />
              </div>
            </div>
          )}

          {lastTab === "filter" && (
            <div className="space-y-1">
              <SubHead
                title={t("Operators", "Operator")}
                action={
                  <span className="flex gap-3">
                    <button className={linkBtn} onClick={() => setOps(new Set(knownOps))}>{t("All", "Semua")}</button>
                    <button className={linkBtn} onClick={() => setOps(new Set())}>{t("Clear", "Kosongkan")}</button>
                  </span>
                }
              />
              {opRows.map(([mnc, n]) => {
                const known = OPERATORS[mnc];
                return (
                  <FilterRow
                    key={mnc} fixed={!known} on={!known || ops.has(mnc)} max={maxOp} value={n} locale={locale}
                    color={known?.color ?? OTHER_COLOR} label={known?.name ?? `MNC ${mnc}`}
                    onClick={() => toggle(ops, mnc, setOps)}
                  />
                );
              })}

              <SubHead
                title={t("Technology", "Teknologi")}
                action={
                  <span className="flex gap-3">
                    <button className={linkBtn} onClick={() => setRadios(new Set(allRadios))}>{t("All", "Semua")}</button>
                    <button className={linkBtn} onClick={() => setRadios(new Set())}>{t("Clear", "Kosongkan")}</button>
                  </span>
                }
              />
              {RADIOS.map((r, i) => (
                <FilterRow key={r} locale={locale} on={radios.has(i)} onClick={() => toggle(radios, i, setRadios)}
                  color={RADIO_COLORS[i]} label={r} value={calc.perRadio[i]} max={maxRadio} />
              ))}

              <SubHead title={t("Location accuracy", "Akurasi posisi")} />
              <div className="space-y-1.5 px-2">
                <div className="flex justify-between text-xs">
                  <span className="text-slate-700">{t("Minimum samples", "Minimal sampel")}</span>
                  <span className="tabular-nums text-sky-700">{minSamples}</span>
                </div>
                <input
                  type="range" min={1} max={30} value={minSamples} aria-label={t("Minimum samples", "Minimal sampel")}
                  onChange={(e) => setMinSamples(+e.target.value)} className="w-full accent-sky-500"
                />
                <p className="text-[11px] leading-snug text-slate-500">{t(`More samples improve cell location accuracy. Average range of visible cells: ${fmt(Math.round(calc.avgRange), locale)} m.`, `Semakin banyak sampel, semakin akurat lokasi sel. Rata-rata jangkauan sel yang terlihat: ${fmt(Math.round(calc.avgRange), locale)} m.`)}</p>
              </div>

              {dirty && (
                <button onClick={resetFilters} className={`mt-3 w-full rounded-lg border border-slate-900/15 py-1.5 text-xs text-slate-800 hover:bg-slate-900/5 ${focusRing}`}>
                  {t("Reset all filters", "Atur ulang semua filter")}
                </button>
              )}
            </div>
          )}

          {lastTab === "area" && (() => {
            const s = areaQ.trim().toLowerCase();
            const list = PRESETS.filter((p) =>
              (areaRegion === "All" || p.region === areaRegion) &&
              (!s || p.label.toLowerCase().includes(s) || p.province.toLowerCase().includes(s) || localizedPresetName(p.province, "id").toLowerCase().includes(s)));
            return (
              <div>
                <section aria-label={t("Area filter", "Filter wilayah")} className="mb-3 space-y-2 rounded-xl bg-slate-900/[0.04] p-2.5">
                  <div className="flex items-center justify-between">
                    <h3 className="text-[11px] font-medium uppercase tracking-wide text-slate-500">{t("Area filter", "Filter wilayah")}</h3>
                    {region && <button className={linkBtn} onClick={() => setRegion(null)}>{t("Remove", "Hapus")}</button>}
                  </div>
                  {region ? (
                    <div className="text-xs">
                      <div className="font-medium">{localizedPresetName(region.label, locale)} <span className="font-normal text-slate-500">· {localizedAreaKind(region.kind, locale)}</span></div>
                      <div className="tabular-nums text-slate-600">{t(`${fmt(calc.scopeTotal, locale)} cell sites in this area`, `${fmt(calc.scopeTotal, locale)} sel BTS di wilayah ini`)}</div>
                    </div>
                  ) : (
                    <p className="text-[11px] leading-snug text-slate-500">{t("Search for a province or regency below, or limit data to the currently visible map area.", "Cari provinsi atau kabupaten di bawah, atau batasi data ke area peta yang terlihat.")}</p>
                  )}
                  <button
                    disabled={!vp.bounds}
                    onClick={() => vp.bounds && setRegion({ label: t("Map view", "Tampilan peta"), kind: t("Rectangle", "Persegi"), bbox: vp.bounds })}
                    className={`w-full rounded-lg border border-slate-900/15 py-1 text-xs text-slate-800 hover:bg-slate-900/5 disabled:opacity-40 ${focusRing}`}
                  >
                    {t("Limit to current map view", "Batasi ke tampilan peta saat ini")}
                  </button>
                </section>
                <div className="sticky -top-3 z-10 -mx-3 space-y-1.5 border-b border-slate-900/10 bg-white/95 px-3 pb-2 pt-2.5">
                  <div className="relative">
                    <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-500"><Icon name="search" size={13} /></span>
                    <input
                      value={areaQ} onChange={(e) => { setAreaQ(e.target.value); areaGeo.reset(); }}
                      onKeyDown={(e) => { if (e.key === "Enter" && areaQ.trim().length >= 3) areaGeo.run(areaQ); }}
                      placeholder={t("Search city, province, or regency", "Cari kota, provinsi, atau kabupaten")} aria-label={t("Search area", "Cari wilayah")}
                      className={`w-full rounded-lg border border-slate-900/10 bg-slate-900/5 py-1 pl-7 pr-7 text-xs text-slate-900 placeholder:text-slate-500 ${focusRing}`}
                    />
                    {areaQ && (
                      <button onClick={() => { setAreaQ(""); areaGeo.reset(); }} aria-label={t("Clear search", "Hapus pencarian")} className={`absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-1 text-slate-500 hover:text-slate-900 ${focusRing}`}>
                        <Icon name="close" size={10} />
                      </button>
                    )}
                  </div>
                  <div className="-mx-3 flex gap-1 overflow-x-auto px-3 pb-0.5 [scrollbar-width:none]">
                    {(["All", ...REGIONS] as const).map((r) => (
                      <Chip key={r} small on={areaRegion === r} onClick={() => setAreaRegion(r)}>{r === "All" ? t("All", "Semua") : localizedPresetName(r === "Java" ? "Java" : r, locale)}</Chip>
                    ))}
                  </div>
                </div>
                <div className="flex items-center justify-between px-0.5 pb-1 pt-2 text-[10px] text-slate-500">
                  <span>{t(`${list.length} locations`, `${list.length} lokasi`)}</span>
                  {(areaQ || areaRegion !== "All") && (
                    <button className={linkBtn} onClick={() => { setAreaQ(""); setAreaRegion("All"); }}>{t("Reset", "Atur ulang")}</button>
                  )}
                </div>
                {list.length === 0 ? (
                  <p className="px-1 py-4 text-center text-xs text-slate-500">{t("No matching locations.", "Tidak ada lokasi yang cocok.")}</p>
                ) : (
                  <div className="flex flex-wrap gap-1">
                    {list.map((p) => (
                      <Chip
                        key={p.label} small
                        on={view.label === p.label && view.n > 0}
                        title={`${p.label} · ${localizedPresetName(p.province, locale)}`}
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
                        {t(`Search all of Indonesia for “${areaQ.trim()}” (OpenStreetMap)`, `Cari “${areaQ.trim()}” di seluruh Indonesia (OpenStreetMap)`)}
                      </button>
                    )}
                    <div className="-mx-3"><PlaceList state={areaGeo.state} onPick={pickPlace} locale={locale} /></div>
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
                  <Segmented value={compareScope} onChange={setCompareScope} label={t("Comparison scope", "Cakupan perbandingan")}
                    options={[{ id: "region", label: region ? short(localizedPresetName(region.label, locale)) : t("All data", "Seluruh data") }, { id: "view", label: t("Map view", "Tampilan peta") }]} />
                  <Segmented value={compareSort} onChange={setCompareSort} label={t("Sort by", "Urutkan berdasarkan")}
                    options={[{ id: "count", label: t("Cell sites", "Jumlah sel") }, { id: "coverage", label: t("Coverage", "Cakupan") }, { id: "range", label: t("Range", "Jangkauan") }]} />
                </div>
                {!compare ? null : compare.total === 0 ? (
                  <p className="px-1 py-4 text-center text-xs text-slate-500">{t("No cell sites in this scope.", "Tidak ada sel pada cakupan ini.")}</p>
                ) : (
                  <>
                    <p className="px-1 text-[11px] text-slate-600" aria-live="polite">
                      {t(`${fmt(compare.total, locale)} cell sites · ${compareScope === "view" ? "visible area" : region ? localizedPresetName(region.label, locale) : "all of Indonesia"}`, `${fmt(compare.total, locale)} sel BTS · ${compareScope === "view" ? "area yang terlihat" : region ? localizedPresetName(region.label, locale) : "seluruh Indonesia"}`)}
                      {(radiosDirty || samplesDirty) && t(" · follows technology and sample filters", " · mengikuti filter teknologi dan sampel")}
                    </p>
                    <ul className="space-y-1.5">
                      {rows.map((r) => (
                        <CompareCard key={r.mnc} stat={r} total={compare.total} best={best} color={OPERATORS[r.mnc]?.color ?? OTHER_COLOR} locale={locale} />
                      ))}
                    </ul>
                    <details className="px-1 text-[10px] leading-snug text-slate-500">
                      <summary className="cursor-pointer text-[11px] text-sky-700">{t("Methodology", "Catatan metode")}</summary>
                      <p className="mt-1">{t("The operator filter does not apply here. Estimated coverage is the union of each cell site’s range circles (overlapping areas are counted once), not a signal-strength measurement. Range is an approximate radius from crowdsourced data.", "Filter operator tidak berlaku di sini. Estimasi cakupan adalah gabungan lingkaran jangkauan setiap sel (area tumpang tindih dihitung sekali), bukan pengukuran kekuatan sinyal. Jangkauan merupakan radius perkiraan dari data crowdsourced.")}</p>
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
              const names = { operator: (mnc: number) => opName(mnc, locale), radio: (r: number) => RADIOS[r] ?? String(r) };
              const file = exportFilename(["cell-sites", region?.label ?? "", exportScope === "view" ? "map-view" : ""], kind);
              if (kind === "csv") download(file, "text/csv", cellsToCSV(c, idx, names));
              else download(file, "application/geo+json", JSON.stringify(cellsToExportGeoJSON(c, idx, names)));
              setExportMsg(t(`${fmt(idx.length, locale)} cell sites exported to ${file}`, `${fmt(idx.length, locale)} sel BTS diekspor ke ${file}`));
            };
            const active = [
              region && t(`Area: ${localizedPresetName(region.label, locale)}`, `Wilayah: ${localizedPresetName(region.label, locale)}`),
              opsDirty && t(`Operators ${ops.size}/${knownOps.length}`, `Operator ${ops.size}/${knownOps.length}`),
              radiosDirty && t(`Technology: ${radios.size ? [...radios].sort().map((i) => RADIOS[i]).join(", ") : "none"}`, `Teknologi: ${radios.size ? [...radios].sort().map((i) => RADIOS[i]).join(", ") : "tidak ada"}`),
              samplesDirty && t(`Samples ≥ ${minSamples}`, `Sampel ≥ ${minSamples}`),
            ].filter(Boolean) as string[];
            return (
              <div className="space-y-3">
                <Segmented value={exportScope} onChange={(v) => { setExportScope(v); setExportMsg(""); }} label={t("Export scope", "Cakupan ekspor")}
                  options={[{ id: "filter", label: t("All filtered results", "Semua hasil filter") }, { id: "view", label: t("Visible map area only", "Hanya area peta yang terlihat") }]} />
                <div className="rounded-xl bg-slate-900/[0.04] px-3 py-2.5 text-xs">
                  <div className="text-[11px] text-slate-500">{t("Ready to export", "Siap diekspor")}</div>
                  <div className="text-[15px] font-semibold tabular-nums">{t(`${fmt(count, locale)} cell sites`, `${fmt(count, locale)} sel BTS`)}</div>
                  <div className="mt-1 text-[11px] text-slate-600">{active.length ? active.join(" · ") : t("No filters: all cell sites", "Tanpa filter: semua sel BTS")}</div>
                </div>
                <div className="grid grid-cols-3 gap-2">
                  {(["csv", "geojson"] as const).map((k) => (
                    <button key={k} disabled={count === 0} onClick={() => doExport(k)}
                      className={`flex items-center justify-center gap-1.5 rounded-lg bg-sky-500 py-1.5 text-xs font-medium text-white hover:bg-sky-400 disabled:cursor-not-allowed disabled:opacity-40 ${focusRing}`}>
                      <Icon name="download" size={13} />{k === "csv" ? "CSV" : "GeoJSON"}
                    </button>
                  ))}
                  <button disabled={!exportMap} onClick={async () => {
                    const map = exportMap;
                    if (!map) {
                      setExportMsg(t("The map is not ready yet. Please try again.", "Peta belum siap. Silakan coba lagi."));
                      return;
                    }
                    const file = exportFilename(["cell-sites", region?.label ?? "", "map-view"], "png");
                    setExportMsg(t("Preparing map image…", "Menyiapkan gambar peta…"));
                    try {
                      await downloadCanvasAsPNG(file, map.getCanvas());
                      setExportMsg(t(`Map image exported to ${file}`, `Gambar peta diekspor ke ${file}`));
                    } catch (error) {
                      console.error("Map image export failed:", error);
                      setExportMsg(t("Could not export the map image. The browser may block capture of cross-origin map tiles.", "Gambar peta tidak dapat diekspor. Browser mungkin memblokir pengambilan tile peta lintas origin."));
                    }
                  }}
                    className={`flex items-center justify-center gap-1.5 rounded-lg bg-sky-500 py-1.5 text-xs font-medium text-white hover:bg-sky-400 disabled:cursor-not-allowed disabled:opacity-40 ${focusRing}`}
                    title={t("Export the current map view as a PNG image", "Ekspor tampilan peta saat ini sebagai gambar PNG")}>
                    <Icon name="download" size={13} />PNG
                  </button>
                </div>
                <p className={`min-h-4 px-1 text-[11px] ${exportMsg.startsWith("Could not") ? "text-red-600" : "text-emerald-700"}`} role="status" aria-live="polite">{exportMsg}</p>
                <p className="px-1 text-[10px] leading-snug text-slate-500">
                  {t("Data columns: radio, mcc, mnc, operator, tac, cell_id, lon, lat, range_m, samples, updated. Check source data licenses (e.g. OpenCelliD CC BY-SA and OpenStreetMap ODbL) and include attribution when sharing. PNG captures the current map view and visible layers.", "Kolom data: radio, mcc, mnc, operator, tac, cell_id, lon, lat, range_m, samples, updated. Periksa lisensi sumber data (mis. OpenCelliD CC BY-SA dan OpenStreetMap ODbL) serta cantumkan atribusi saat membagikan hasil. PNG mengambil tampilan peta dan layer yang sedang terlihat.")}
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
                <div className="flex justify-between"><span className="text-slate-600">{t("In map view", "Dalam tampilan peta")}</span><span className="tabular-nums">{t(`${fmt(vp.cells, locale)} cell sites · ${fmt(vp.towers, locale)} towers`, `${fmt(vp.cells, locale)} sel BTS · ${fmt(vp.towers, locale)} menara`)}</span></div>
                <div className="flex justify-between"><span className="text-slate-600">{t("Average range", "Jangkauan rata-rata")}</span><span className="tabular-nums">{fmt(Math.round(calc.avgRange), locale)} m</span></div>
                {calc.latest > 0 && (
                  <div className="flex justify-between"><span className="text-slate-600">{t("Last updated", "Pembaruan terakhir")}</span><span className="tabular-nums">{new Date(calc.latest * 1000).toLocaleDateString(locale === "id" ? "id-ID" : "en-US")}</span></div>
                )}
              </div>
              <div>
                <SubHead title={t("Technology distribution", "Sebaran teknologi")} />
                {RADIOS.map((r, i) => (
                  <FilterRow key={r} fixed on color={RADIO_COLORS[i]} label={r} value={calc.perRadio[i]} max={maxRadio} locale={locale} />
                ))}
              </div>
            </div>
          )}
        </div>
      </aside>

      {/* Compact legend — mobile: popover; desktop: draggable overlay */}

      {/* Mobile legend (< md): bottom-right popover; scale is at bottom-left. */}
      <div
        ref={mobileLegendRef}
        style={{ transform: `translate(${mobileLegendPos.x}px, ${mobileLegendPos.y}px)` }}
        className="absolute bottom-10 right-2 z-10 flex flex-col items-end gap-1.5 md:hidden"
      >
        {legendOpen && (
          <div className={`w-52 max-w-[calc(100vw-1rem)] space-y-2 rounded-xl p-2.5 text-[11px] text-slate-700 ${glass}`}>
            <div>
              <div className="mb-1 text-slate-500">{t("Cell sites by operator", "Sel BTS per operator")}</div>
              <div className="grid grid-cols-2 gap-x-2 gap-y-1">
                {Object.values(OPERATORS).slice(0, 5).map((o) => (
                  <span key={o.name} className="flex items-center gap-1.5"><Dot c={o.color} />{o.name}</span>
                ))}
                <span className="flex items-center gap-1.5"><Dot c={OTHER_COLOR} />{t("Other", "Lainnya")}</span>
              </div>
            </div>
            <div className="space-y-1">
              <span className="flex items-center gap-1.5"><Dot c="#fbbf24" />{t("OSM towers", "Menara OSM")}</span>
              <span className="flex items-center gap-1.5"><Dot c="#0891b2" ring />{t("Landing stations", "Stasiun pendaratan")}</span>
              <Legend c="#38bdf8">{t("Submarine cables", "Kabel laut")}</Legend>
              <Legend c="#10b981">{t("Operational fiber", "Fiber operasional")}</Legend>
              <Legend c="#ca8a04">{t("Planned fiber", "Fiber rencana")}</Legend>
              <Legend c="#9333ea">Microwave</Legend>
            </div>
          </div>
        )}
        <button
          {...mobileLegendDragProps}
          onClick={() => {
            if (suppressLegendClick.current) {
              suppressLegendClick.current = false;
              return;
            }
            setLegendOpen(!legendOpen);
          }}
          onDoubleClick={() => resetLegend(true)}
          onKeyDown={(e) => { if (e.key === "Home") resetLegend(true); }}
          title={t("Drag to move · click to open or close · double-click to reset", "Seret untuk memindahkan · klik untuk membuka atau menutup · klik dua kali untuk mengatur ulang")}
          aria-label={t("Legend. Drag to move, click to open or close, double-click to reset position", "Legenda. Seret untuk memindahkan, klik untuk membuka atau menutup, klik dua kali untuk mengatur ulang posisi")}
          aria-expanded={legendOpen}
          className={`flex cursor-grab touch-none select-none items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[11px] text-slate-800 active:cursor-grabbing ${glass} ${focusRing}`}
        >
          {t("Legend", "Legenda")}
          <span className={`transition ${legendOpen ? "" : "rotate-180"}`}><Icon name="chevron" size={10} /></span>
        </button>
      </div>

      {/* === Desktop legend (>= md) === */}
      <div ref={legendRef} style={{ transform: `translate(${legendPos.x}px, ${legendPos.y}px)` }} className="absolute bottom-14 right-3 z-10 hidden md:block">
        {legendOpen && (
          <div className={`mb-2 w-52 space-y-2.5 rounded-xl p-3 text-[11px] text-slate-700 ${glass}`}>
            <div>
              <div className="mb-1 text-slate-500">{t("Cell sites by operator", "Sel BTS per operator")}</div>
              <div className="grid grid-cols-2 gap-x-2 gap-y-1">
                {Object.values(OPERATORS).slice(0, 5).map((o) => (
                  <span key={o.name} className="flex items-center gap-1.5"><Dot c={o.color} />{o.name}</span>
                ))}
                <span className="flex items-center gap-1.5"><Dot c={OTHER_COLOR} />{t("Other", "Lainnya")}</span>
              </div>
            </div>
            <div className="space-y-1">
              <span className="flex items-center gap-1.5"><Dot c="#fbbf24" />{t("OSM towers", "Menara OSM")}</span>
              <span className="flex items-center gap-1.5"><Dot c="#0891b2" ring />{t("Landing stations", "Stasiun pendaratan")}</span>
              <Legend c="#38bdf8">{t("Submarine cables", "Kabel laut")}</Legend>
              <Legend c="#10b981">{t("Operational fiber", "Fiber operasional")}</Legend>
              <Legend c="#ca8a04">{t("Planned fiber", "Fiber rencana")}</Legend>
              <Legend c="#9333ea">Microwave</Legend>
            </div>
          </div>
        )}
        <button
          {...desktopLegendDragProps}
          onClick={() => {
            if (suppressLegendClick.current) {
              suppressLegendClick.current = false;
              return;
            }
            setLegendOpen(!legendOpen);
          }}
          onDoubleClick={() => resetLegend()}
          onKeyDown={(e) => { if (e.key === "Home") resetLegend(); }}
          title={t("Drag to move · click to open or close · double-click to reset", "Seret untuk memindahkan · klik untuk membuka atau menutup · klik dua kali untuk mengatur ulang")}
          aria-label={t("Legend. Drag to move, click to open or close, double-click to reset position", "Legenda. Seret untuk memindahkan, klik untuk membuka atau menutup, klik dua kali untuk mengatur ulang posisi")}
          aria-expanded={legendOpen}
          className={`flex cursor-grab touch-none select-none items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[11px] text-slate-800 hover:bg-slate-100 active:cursor-grabbing ${glass} ${focusRing}`}
        >
          {t("Legend", "Legenda")}
          <span className={`transition ${legendOpen ? "" : "rotate-180"}`}><Icon name="chevron" size={10} /></span>
        </button>
      </div>

      <div className="pointer-events-none absolute bottom-7 left-[60px] z-10 hidden max-w-xs rounded-lg bg-white/90 px-3 py-1.5 shadow-lg backdrop-blur md:block">
        <div className="flex items-center gap-1.5 text-[13px] font-medium text-slate-900">
          <span className="text-sky-700"><Icon name="pin" size={12} /></span>
          <span className="truncate">{place.name}</span>
        </div>
        <div className="truncate text-[11px] text-slate-600">{place.sub}</div>
        <div className="text-[11px] tabular-nums text-slate-700">{t(`${fmt(vp.cells, locale)} cell sites, ${fmt(vp.towers, locale)} towers in view`, `${fmt(vp.cells, locale)} sel BTS, ${fmt(vp.towers, locale)} menara dalam tampilan`)}</div>
      </div>
      </div>

      {/* Bottom bar: location info and menu on mobile; floating icon rail on desktop */}
      <div className="relative z-20 shrink-0 border-t border-slate-900/10 bg-white/95 pb-[env(safe-area-inset-bottom)] shadow-[0_-2px_8px_rgba(15,23,42,.06)] md:contents">
        <div className="flex items-center justify-between gap-2 px-3 pt-1.5 text-[11px] text-slate-600 md:hidden">
          <span className="flex min-w-0 items-center gap-1.5">
            <span className="text-sky-700"><Icon name="pin" size={12} /></span>
            <span className="truncate font-medium text-slate-900">{place.name}</span>
            <span className="truncate">· {place.sub}</span>
          </span>
          <span className="shrink-0 tabular-nums">{t(`${fmt(vp.cells, locale)} cell sites`, `${fmt(vp.cells, locale)} sel BTS`)}</span>
        </div>
      <nav
        aria-label={t("Main menu", "Menu utama")}
        className={`flex items-center gap-1 px-2 py-1 md:absolute md:left-3 md:top-3 md:z-20 md:flex-col md:justify-start md:rounded-2xl md:p-1 md:border md:border-slate-900/10 md:bg-white/90 md:shadow-xl md:backdrop-blur`}
      >
        <RailBtn icon="layers" label={t("Layers & basemap", "Layer & peta dasar")} active={tab === "layers"} onClick={() => openTab("layers")} />
        <RailBtn icon="filter" label={t("Data filters", "Filter data")} active={tab === "filter"} badge={dirty} onClick={() => openTab("filter")} />
        <RailBtn icon="pin" label={t("Area", "Wilayah")} active={tab === "area"} badge={!!region} onClick={() => openTab("area")} />
        <RailBtn icon="compare" label={t("Compare operators", "Bandingkan operator")} active={tab === "compare"} onClick={() => openTab("compare")} />
        <RailBtn icon="chart" label={t("Summary", "Ringkasan")} active={tab === "stats"} onClick={() => openTab("stats")} />
        <RailBtn icon="download" label={t("Export data", "Ekspor data")} active={tab === "export"} onClick={() => openTab("export")} />
      </nav>
      </div>
    </main>
  );
}