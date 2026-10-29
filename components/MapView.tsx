"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import * as maplibregl from "maplibre-gl";
import type { Map as MLMap, GeoJSONSource } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import type { Feature, FeatureCollection, Point } from "geojson";
import { CARTO_API_KEY, OPERATORS, OTHER_COLOR, RADIOS } from "@/lib/config";
import { cellFilterExpr, type CellFilter } from "@/lib/cellFilter";
import { cellsToGeoJSON, type CellData } from "@/lib/data";
import type { RegionFilter } from "@/lib/region";
import { PointGrid, type BBox } from "@/lib/spatial";

export type Viewport = { cells: number; towers: number; center?: [number, number]; zoom?: number; bounds?: BBox };
export type { CellFilter };
export type Basemap = "dark" | "light" | "voyager";
type Props = {
  cells: CellData;
  /** mask[i] = 1 bila sel i lolos semua filter (dipakai untuk menghitung sel dalam tampilan). */
  mask: Uint8Array;
  /** Sel yang dimuat ke peta (subset wilayah). null = semua sel. Hanya berubah saat wilayah berubah. */
  sourceIdx: Uint32Array | null;
  filter: CellFilter;
  region: RegionFilter | null;
  marker: [number, number] | null;
  towers: FeatureCollection;
  show: { cells: boolean; towers: boolean; cables: boolean; landingPoints: boolean; ituFiber: boolean };
  mode: "points" | "heat";
  view: { center: [number, number]; zoom: number; n: number; bounds?: BBox };
  basemap?: Basemap;
  onViewport: (v: Viewport) => void;
};

const BASEMAPS: Record<Basemap, string> = { dark: "dark_all", light: "light_all", voyager: "rastertiles/voyager" };

const colorExpr = [
  "match", ["get", "mnc"],
  ...Object.entries(OPERATORS).flatMap(([k, v]) => [Number(k), v.color]),
  OTHER_COLOR,
] as unknown as maplibregl.ExpressionSpecification;

// Urutan prioritas klik: titik kecil di atas, garis di bawah
const lineColor = (fallback: string) =>
  [
    "match", ["coalesce", ["get", "color"], fallback],
    "#facc15", "#ca8a04",
    "#c084fc", "#9333ea",
    ["coalesce", ["get", "color"], fallback],
  ] as unknown as maplibregl.ExpressionSpecification;

const EMPTY_FC: FeatureCollection = { type: "FeatureCollection", features: [] };
const regionFeature = (r: RegionFilter | null): FeatureCollection => {
  if (!r) return EMPTY_FC;
  const [w, s, e, n] = r.bbox;
  const geometry = r.geometry ?? { type: "Polygon" as const, coordinates: [[[w, s], [e, s], [e, n], [w, n], [w, s]]] };
  const f: Feature = { type: "Feature", geometry, properties: {} };
  return { type: "FeatureCollection", features: [f] };
};

const CLICK_ORDER = ["landing-points", "towers", "cells-points", "cables-tg-hit", "itu-fiber-hit"];

const POPUP_CSS = `
.gis-popup .maplibregl-popup-content{background:#fff;color:#0f172a;border:1px solid rgba(15,23,42,.1);border-radius:12px;padding:12px 14px;box-shadow:0 10px 30px rgba(15,23,42,.18)}
.gis-popup .maplibregl-popup-close-button{color:#64748b;font-size:18px;padding:2px 8px}
.gis-popup .maplibregl-popup-close-button:hover{background:transparent;color:#0f172a}
.gis-popup.maplibregl-popup-anchor-top .maplibregl-popup-tip,.gis-popup.maplibregl-popup-anchor-top-left .maplibregl-popup-tip,.gis-popup.maplibregl-popup-anchor-top-right .maplibregl-popup-tip{border-bottom-color:#fff}
.gis-popup.maplibregl-popup-anchor-bottom .maplibregl-popup-tip,.gis-popup.maplibregl-popup-anchor-bottom-left .maplibregl-popup-tip,.gis-popup.maplibregl-popup-anchor-bottom-right .maplibregl-popup-tip{border-top-color:#fff}
.gis-popup.maplibregl-popup-anchor-left .maplibregl-popup-tip{border-right-color:#fff}
.gis-popup.maplibregl-popup-anchor-right .maplibregl-popup-tip{border-left-color:#fff}
.maplibregl-ctrl-group{background:rgba(255,255,255,.92)!important;border:1px solid rgba(15,23,42,.1);border-radius:12px!important;box-shadow:0 4px 14px rgba(15,23,42,.12)!important;overflow:hidden}
.maplibregl-ctrl-group button+button{border-top:1px solid rgba(15,23,42,.1)!important}
.maplibregl-ctrl-group button:hover{background:#f1f5f9!important}
.maplibregl-ctrl-scale{background:rgba(255,255,255,.8);color:#334155;border-color:#64748b}
.maplibregl-ctrl-attrib{background:rgba(255,255,255,.75)!important;color:#475569}
.maplibregl-ctrl-attrib a{color:#334155}
`;

function popupNode(title: string, rows: [string, string][], badge?: { text: string; color: string }) {
  const el = document.createElement("div");
  el.style.cssText = "font:12px/1.4 system-ui,sans-serif;min-width:200px;max-width:260px";
  const h = document.createElement("div");
  h.style.cssText = "display:flex;align-items:center;gap:8px;font-weight:600;font-size:13px;margin:0 16px 8px 0;padding-bottom:6px;border-bottom:1px solid rgba(15,23,42,.1)";
  if (badge) {
    const d = document.createElement("span");
    d.style.cssText = `width:8px;height:8px;border-radius:50%;flex:none;background:${badge.color}`;
    h.appendChild(d);
  }
  const t = document.createElement("span"); t.textContent = title; h.appendChild(t);
  el.appendChild(h);
  for (const [k, v] of rows) {
    const r = document.createElement("div");
    r.style.cssText = "display:flex;justify-content:space-between;gap:16px;margin-bottom:3px";
    const a = document.createElement("span"); a.style.color = "#64748b"; a.textContent = k;
    const b = document.createElement("span"); b.style.cssText = "font-weight:500;text-align:right;font-variant-numeric:tabular-nums"; b.textContent = v;
    r.append(a, b); el.appendChild(r);
  }
  return el;
}

export default function MapView({ cells, mask, sourceIdx, filter, region, marker, towers, show, mode, view, basemap = "dark", onViewport }: Props) {
  const box = useRef<HTMLDivElement>(null);
  const coordRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MLMap | null>(null);
  const popupRef = useRef<maplibregl.Popup | null>(null);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(true);
  const markerRef = useRef<maplibregl.Marker | null>(null);

  // Indeks spasial dibangun sekali per dataset: hitungan dalam tampilan hanya memeriksa bucket yang terlihat
  const grids = useMemo(() => {
    const tl: number[] = [], tt: number[] = [];
    for (const f of towers.features) { const [x, y] = (f.geometry as Point).coordinates; tl.push(x); tt.push(y); }
    return { cells: new PointGrid(cells.lon, cells.lat), towers: new PointGrid(tl, tt) };
  }, [cells, towers]);
  // Sumber data sel: subset wilayah, atau semua sel
  const srcIdx = useMemo(() => sourceIdx ?? Uint32Array.from({ length: cells.radio.length }, (_, i) => i), [sourceIdx, cells]);

  const latest = useRef({ cells, mask, srcIdx, filter, region, grids, towers, onViewport });
  latest.current = { cells, mask, srcIdx, filter, region, grids, towers, onViewport };

  const report = () => {
    const map = mapRef.current; if (!map) return;
    const b = map.getBounds(), { mask: m, grids: g } = latest.current;
    const bb: BBox = [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()];
    const c0 = map.getCenter();
    latest.current.onViewport({ cells: g.cells.count(bb, m), towers: g.towers.count(bb), center: [c0.lng, c0.lat], zoom: map.getZoom(), bounds: bb });
  };

  useEffect(() => {
    const baseSources: Record<string, maplibregl.RasterSourceSpecification> = {};
    const baseLayers: maplibregl.LayerSpecification[] = [];
    for (const [id, path] of Object.entries(BASEMAPS)) {
      baseSources[`base-${id}`] = {
        type: "raster",
        tileSize: 256,
        attribution: "© OpenStreetMap © CARTO · TeleGeography · ITU Broadband Map",
        tiles: ["a", "b", "c", "d"].map((s) => `https://${s}.basemaps.cartocdn.com/${path}/{z}/{x}/{y}.png?key=${CARTO_API_KEY}`),
      };
      baseLayers.push({ id: `base-${id}`, type: "raster", source: `base-${id}`, layout: { visibility: id === basemap ? "visible" : "none" } });
    }

    const map = new maplibregl.Map({
      container: box.current!,
      center: view.center, zoom: view.zoom,
      minZoom: 3, maxZoom: 18,
      style: { version: 8, sources: baseSources, layers: baseLayers },
    });
    mapRef.current = map;
    map.on("error", (e) => console.error("MapLibre error:", e.error));
    map.once("idle", () => setBusy(false));
    const ro = new ResizeObserver(() => map.resize());
    ro.observe(box.current!);
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
    map.addControl(new maplibregl.GeolocateControl({ positionOptions: { enableHighAccuracy: true }, trackUserLocation: false }), "top-right");
    map.addControl(new maplibregl.FullscreenControl({ container: box.current!.parentElement ?? undefined }), "top-right");
    map.addControl(new maplibregl.ScaleControl(), "bottom-right");

    map.on("load", () => {
      // 1. Data Sumber
      map.addSource("cables-tg", { type: "geojson", data: "/data/cables_telegeography.geojson" });
      map.addSource("landing-points", { type: "geojson", data: "/data/landing_points.geojson" });
      map.addSource("itu-fiber", { type: "geojson", data: "/data/itu_fiber.geojson" });
      map.addSource("cells", { type: "geojson", data: cellsToGeoJSON(latest.current.cells, latest.current.srcIdx) });
      map.addSource("towers", { type: "geojson", data: latest.current.towers });
      map.addSource("region", { type: "geojson", data: regionFeature(latest.current.region) });

      // Batas wilayah aktif (di bawah semua layer data)
      map.addLayer({ id: "region-fill", type: "fill", source: "region", paint: { "fill-color": "#0ea5e9", "fill-opacity": 0.06 } });
      map.addLayer({
        id: "region-line", type: "line", source: "region",
        layout: { "line-join": "round" },
        paint: { "line-color": "#0284c7", "line-width": 2, "line-dasharray": [2, 1.5], "line-opacity": 0.9 },
      });

      // 2. Layer Kabel Laut TeleGeography (Indonesia)
      map.addLayer({
        id: "cables-tg-glow", type: "line", source: "cables-tg",
        layout: { "line-cap": "round", "line-join": "round" },
        paint: { "line-color": ["coalesce", ["get", "color"], "#38bdf8"], "line-width": 5, "line-opacity": 0.3, "line-blur": 3 },
      });
      map.addLayer({
        id: "cables-tg", type: "line", source: "cables-tg",
        layout: { "line-cap": "round", "line-join": "round" },
        paint: { "line-color": ["coalesce", ["get", "color"], "#38bdf8"], "line-width": ["interpolate", ["linear"], ["zoom"], 4, 1.4, 10, 2.4], "line-opacity": 0.9 },
      });
      // Area klik lebih lebar agar garis tipis mudah dipilih (tidak terlihat)
      map.addLayer({
        id: "cables-tg-hit", type: "line", source: "cables-tg",
        paint: { "line-color": "#000", "line-width": 14, "line-opacity": 0 },
      });

      // 3. Layer Landing Stations (Kabel Laut)
      map.addLayer({
        id: "landing-points", type: "circle", source: "landing-points",
        paint: {
          "circle-color": "#0891b2",
          "circle-radius": ["interpolate", ["linear"], ["zoom"], 4, 3.5, 8, 5.5, 12, 8],
          "circle-stroke-color": "#ffffff",
          "circle-stroke-width": 1.8,
          "circle-opacity": 1,
        },
      });

      // 4. Layer Fiber Optik Darat ITU Broadband Map
      map.addLayer({
        id: "itu-fiber-glow", type: "line", source: "itu-fiber",
        layout: { "line-cap": "round", "line-join": "round" },
        paint: { "line-color": lineColor("#10b981"), "line-width": 4, "line-opacity": 0.22, "line-blur": 3 },
      });
      map.addLayer({
        id: "itu-fiber", type: "line", source: "itu-fiber",
        layout: { "line-cap": "round", "line-join": "round" },
        paint: {
          "line-color": lineColor("#10b981"),
          "line-width": ["interpolate", ["linear"], ["zoom"], 4, 1.2, 10, 2.2],
          "line-opacity": 0.88,
        },
      });
      map.addLayer({
        id: "itu-fiber-hit", type: "line", source: "itu-fiber",
        paint: { "line-color": "#000", "line-width": 14, "line-opacity": 0 },
      });

      // 5. Layer Sel BTS & Menara
      map.addLayer({
        id: "cells-heat", type: "heatmap", source: "cells", layout: { visibility: "none" },
        paint: {
          "heatmap-radius": ["interpolate", ["linear"], ["zoom"], 4, 6, 10, 18, 14, 30],
          "heatmap-intensity": 0.8,
          "heatmap-opacity": 0.8,
          "heatmap-color": [
            "interpolate", ["linear"], ["heatmap-density"],
            0, "rgba(255,255,255,0)", 0.15, "#93c5fd", 0.35, "#3b82f6", 0.55, "#10b981", 0.75, "#f59e0b", 1, "#dc2626",
          ],
        },
      });
      map.addLayer({
        id: "cells-points", type: "circle", source: "cells",
        paint: {
          "circle-color": colorExpr, "circle-opacity": 0.92,
          "circle-radius": ["interpolate", ["linear"], ["zoom"], 4, 1.6, 9, 3, 13, 5.5, 16, 9],
          "circle-stroke-color": "rgba(15,23,42,0.65)",
          "circle-stroke-width": ["interpolate", ["linear"], ["zoom"], 4, 0, 8, 0.4, 12, 0.8, 15, 1.2],
        },
      });
      map.addLayer({
        id: "towers", type: "circle", source: "towers",
        paint: {
          "circle-color": "#fbbf24", "circle-stroke-color": "#78350f", "circle-stroke-width": 1.3,
          "circle-radius": ["interpolate", ["linear"], ["zoom"], 4, 2, 10, 4.8, 15, 8],
        },
      });

      // Popup tunggal: klik memilih fitur dengan prioritas, popup lama otomatis tertutup
      const open = (lngLat: maplibregl.LngLatLike, node: HTMLElement) => {
        popupRef.current?.remove();
        popupRef.current = new maplibregl.Popup({ className: "gis-popup", maxWidth: "280px", closeButton: true })
          .setLngLat(lngLat).setDOMContent(node).addTo(map);
      };
      const pick = (pt: maplibregl.Point) => {
        const layers = CLICK_ORDER.filter((l) => map.getLayer(l) && map.getLayoutProperty(l, "visibility") !== "none");
        if (!layers.length) return null;
        const hits = map.queryRenderedFeatures([[pt.x - 4, pt.y - 4], [pt.x + 4, pt.y + 4]], { layers });
        if (!hits.length) return null;
        hits.sort((a, b) => CLICK_ORDER.indexOf(a.layer.id) - CLICK_ORDER.indexOf(b.layer.id));
        return hits[0];
      };

      map.on("click", (e) => {
        const f = pick(e.point); if (!f) { popupRef.current?.remove(); return; }
        const p = f.properties as Record<string, any>;
        switch (f.layer.id) {
          case "cells-points": {
            const op = OPERATORS[p.mnc]?.name ?? `MNC ${p.mnc}`;
            open(e.lngLat, popupNode(`${op} · ${RADIOS[p.radio]}`, [
              ["TAC", String(p.area)], ["Cell ID", String(p.cell)], ["Range", `${p.range} m`],
              ["Samples", String(p.samples)], ["Update", new Date(p.updated * 1000).toLocaleDateString("id-ID")],
            ], { text: op, color: OPERATORS[p.mnc]?.color ?? OTHER_COLOR }));
            break;
          }
          case "towers":
            open(e.lngLat, popupNode(p.name || "Menara (OSM)", [
              ["Operator", p.operator || "-"], ["Tipe", p.kind || "-"],
              ["Tinggi", p.height ? `${p.height} m` : "-"], ["OSM", String(p.id)],
            ], { text: "", color: "#fbbf24" }));
            break;
          case "cables-tg-hit":
            open(e.lngLat, popupNode(p.name, [
              ["Status", p.is_planned ? "Rencana" : "Aktif / Operasional"],
              ["RFS Year", p.rfs_year ? String(p.rfs_year) : "-"],
              ["Landing Stn", p.landing_count ? `${p.landing_count} lokasi` : "-"],
              ["Sumber", "TeleGeography"],
              ["ID", String(p.id ?? "-")],
            ], { text: "", color: p.color || "#38bdf8" }));
            break;
          case "landing-points":
            open(e.lngLat, popupNode(p.name, [
              ["Kategori", "Landing Station Kabel Laut"],
              ["Negara", "Indonesia"],
              ["Sumber", "TeleGeography"],
            ], { text: "", color: "#0891b2" }));
            break;
          case "itu-fiber-hit":
            open(e.lngLat, popupNode(p.name || "Backbone Jaringan", [
              ["Medium", p.medium || "Fiber Optic"],
              ["Status", p.status || "Operational"],
              ["Sumber", "ITU - Broadband Map"],
              ["UID", String(p.uid ?? "-")],
            ], { text: "", color: p.color || "#10b981" }));
            break;
        }
      });

      // Kursor pointer + koordinat langsung
      map.on("mousemove", (e) => {
        map.getCanvas().style.cursor = pick(e.point) ? "pointer" : "";
        if (coordRef.current) coordRef.current.textContent = `${e.lngLat.lat.toFixed(5)}, ${e.lngLat.lng.toFixed(5)}`;
      });
      map.on("moveend", report);
      setReady(true);
    });
    return () => { popupRef.current?.remove(); markerRef.current?.remove(); markerRef.current = null; map.remove(); mapRef.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Data sel dimuat ulang HANYA saat subset wilayah berubah; filter atribut tidak menyentuh data
  useEffect(() => {
    if (!ready) return;
    (mapRef.current!.getSource("cells") as GeoJSONSource).setData(cellsToGeoJSON(cells, srcIdx));
  }, [ready, cells, srcIdx]);

  // Filter operator / teknologi / sampel → ekspresi filter layer (murah, dihitung GPU/worker)
  useEffect(() => {
    if (!ready) return;
    const m = mapRef.current!, expr = cellFilterExpr(filter);
    m.setFilter("cells-points", expr);
    m.setFilter("cells-heat", expr);
  }, [ready, filter]);

  // Hitungan dalam tampilan mengikuti filter & wilayah
  useEffect(() => { if (ready) report(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [ready, mask, grids]);

  // Batas wilayah
  useEffect(() => {
    if (!ready) return;
    (mapRef.current!.getSource("region") as GeoJSONSource).setData(regionFeature(region));
  }, [ready, region]);

  // Penanda koordinat hasil pencarian
  useEffect(() => {
    if (!ready) return;
    markerRef.current?.remove(); markerRef.current = null;
    if (marker) markerRef.current = new maplibregl.Marker({ color: "#0284c7" }).setLngLat(marker).addTo(mapRef.current!);
  }, [ready, marker]);

  // Visibilitas layer
  useEffect(() => {
    if (!ready) return;
    const m = mapRef.current!;
    const v = (b: boolean) => (b ? "visible" : "none");
    m.setLayoutProperty("cells-points", "visibility", v(show.cells && mode === "points"));
    m.setLayoutProperty("cells-heat", "visibility", v(show.cells && mode === "heat"));
    m.setLayoutProperty("towers", "visibility", v(show.towers));
    m.setLayoutProperty("cables-tg", "visibility", v(show.cables));
    m.setLayoutProperty("cables-tg-glow", "visibility", v(show.cables));
    m.setLayoutProperty("cables-tg-hit", "visibility", v(show.cables));
    m.setLayoutProperty("landing-points", "visibility", v(show.landingPoints));
    m.setLayoutProperty("itu-fiber", "visibility", v(show.ituFiber));
    m.setLayoutProperty("itu-fiber-glow", "visibility", v(show.ituFiber));
    m.setLayoutProperty("itu-fiber-hit", "visibility", v(show.ituFiber));
  }, [ready, show, mode]);

  // Ganti peta dasar tanpa memuat ulang style
  useEffect(() => {
    if (!ready) return;
    const m = mapRef.current!;
    for (const id of Object.keys(BASEMAPS)) m.setLayoutProperty(`base-${id}`, "visibility", id === basemap ? "visible" : "none");
  }, [ready, basemap]);

  // Pindah wilayah
  useEffect(() => {
    if (!ready || view.n === 0) return;
    const map = mapRef.current!;
    if (view.bounds) map.fitBounds(view.bounds, { padding: 60, maxZoom: 14, duration: 1200, essential: false });
    else map.flyTo({ center: view.center, zoom: view.zoom, duration: 1200, essential: false });
  }, [ready, view]);

  return (
    <>
      <style>{POPUP_CSS}</style>
      <div ref={box} className="absolute inset-0 h-full w-full" style={{ width: "100%", height: "100%" }} />
      {busy && (
        <div className="pointer-events-none absolute left-1/2 top-3 z-10 flex -translate-x-1/2 items-center gap-2 rounded-full bg-white/90 px-3 py-1 text-[11px] text-slate-700 shadow-md">
          <span className="h-3 w-3 animate-spin rounded-full border-2 border-slate-300 border-t-sky-500" />
          Memuat peta…
        </div>
      )}
      <div
        ref={coordRef}
        aria-hidden
        className="pointer-events-none absolute bottom-14 right-[104px] z-10 hidden rounded-md bg-white/90 px-2.5 py-1 font-mono text-[11px] tabular-nums text-slate-600 shadow-md md:block"
      >
        Arahkan kursor ke peta
      </div>
    </>
  );
}