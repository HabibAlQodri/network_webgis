"use client";
import { useEffect, useRef, useState } from "react";
import * as maplibregl from "maplibre-gl";
import type { Map as MLMap, GeoJSONSource } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import type { FeatureCollection, Point } from "geojson";
import { CARTO_API_KEY, OPERATORS, OTHER_COLOR, RADIOS } from "@/lib/config";
import { cellsToGeoJSON, type CellData } from "@/lib/data";

export type Viewport = { cells: number; towers: number };
type Props = {
  cells: CellData;
  idx: Uint32Array;
  towers: FeatureCollection;
  show: { cells: boolean; towers: boolean; cables: boolean };
  mode: "points" | "heat";
  view: { center: [number, number]; zoom: number; n: number };
  onViewport: (v: Viewport) => void;
};

const colorExpr = [
  "match", ["get", "mnc"],
  ...Object.entries(OPERATORS).flatMap(([k, v]) => [Number(k), v.color]),
  OTHER_COLOR,
] as unknown as maplibregl.ExpressionSpecification;

function popupNode(title: string, rows: [string, string][]) {
  const el = document.createElement("div");
  el.style.cssText = "font:12px system-ui;color:#0f172a;min-width:150px";
  const h = document.createElement("div");
  h.style.cssText = "font-weight:600;margin-bottom:4px";
  h.textContent = title;
  el.appendChild(h);
  for (const [k, v] of rows) {
    const r = document.createElement("div");
    r.style.cssText = "display:flex;justify-content:space-between;gap:12px";
    const a = document.createElement("span"); a.style.opacity = ".6"; a.textContent = k;
    const b = document.createElement("span"); b.textContent = v;
    r.append(a, b); el.appendChild(r);
  }
  return el;
}

export default function MapView({ cells, idx, towers, show, mode, view, onViewport }: Props) {
  const box = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MLMap | null>(null);
  const [ready, setReady] = useState(false);
  const latest = useRef({ cells, idx, towers, onViewport });
  latest.current = { cells, idx, towers, onViewport };

  const report = () => {
    const map = mapRef.current; if (!map) return;
    const b = map.getBounds();
    const { cells: c, idx: ix, towers: t } = latest.current;
    let nc = 0, nt = 0;
    for (let k = 0; k < ix.length; k++) { const i = ix[k]; if (b.contains([c.lon[i], c.lat[i]])) nc++; }
    for (const f of t.features) { if (b.contains((f.geometry as Point).coordinates as [number, number])) nt++; }
    latest.current.onViewport({ cells: nc, towers: nt });
  };

  useEffect(() => {
    const map = new maplibregl.Map({
      container: box.current!,
      center: view.center, zoom: view.zoom,
      style: {
        version: 8,
        sources: {
          base: {
            type: "raster",
            tileSize: 256,
            attribution: "© OpenStreetMap © CARTO",
            tiles: ["a", "b", "c", "d"].map(
              (s) => `https://${s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png?key=${CARTO_API_KEY}`
            ),
          },
        },
        layers: [{ id: "base", type: "raster", source: "base" }],
      },
    });
    mapRef.current = map;
    map.on("error", (e) => console.error("MapLibre error:", e.error));
    map.on("load", () => console.log("MapLibre load OK"));
    const ro = new ResizeObserver(() => map.resize());
    ro.observe(box.current!);
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
    map.addControl(new maplibregl.ScaleControl(), "bottom-right");

    map.on("load", () => {
      map.addSource("cables", { type: "geojson", data: "/data/cables.geojson" });
      map.addSource("cables-tg", { type: "geojson", data: "/data/cables_telegeography.geojson" });
      map.addSource("cells", { type: "geojson", data: cellsToGeoJSON(latest.current.cells, latest.current.idx) });
      map.addSource("towers", { type: "geojson", data: latest.current.towers });
      // Layer kabel lama (legacy lokal)
      map.addLayer({ id: "cables", type: "line", source: "cables", layout: { visibility: "none" }, paint: { "line-color": "#22d3ee", "line-width": 1.5, "line-opacity": 0.6, "line-dasharray": [2, 2] } });
      // Layer kabel TeleGeography – warna per kabel dari properti `color`
      map.addLayer({
        id: "cables-tg-glow", type: "line", source: "cables-tg",
        layout: { "line-cap": "round", "line-join": "round" },
        paint: { "line-color": ["coalesce", ["get", "color"], "#22d3ee"], "line-width": 4, "line-opacity": 0.18, "line-blur": 4 },
      });
      map.addLayer({
        id: "cables-tg", type: "line", source: "cables-tg",
        layout: { "line-cap": "round", "line-join": "round" },
        paint: { "line-color": ["coalesce", ["get", "color"], "#22d3ee"], "line-width": 1.5, "line-opacity": 0.85 },
      });
      map.addLayer({ id: "cells-heat", type: "heatmap", source: "cells", layout: { visibility: "none" },
        paint: { "heatmap-radius": ["interpolate", ["linear"], ["zoom"], 4, 6, 10, 18, 14, 30], "heatmap-intensity": 0.8, "heatmap-opacity": 0.85 } });
      map.addLayer({ id: "cells-points", type: "circle", source: "cells",
        paint: { "circle-color": colorExpr, "circle-opacity": 0.75,
          "circle-radius": ["interpolate", ["linear"], ["zoom"], 4, 1, 9, 2.5, 13, 5, 16, 9] } });
      map.addLayer({ id: "towers", type: "circle", source: "towers",
        paint: { "circle-color": "#fde047", "circle-stroke-color": "#000", "circle-stroke-width": 1,
          "circle-radius": ["interpolate", ["linear"], ["zoom"], 4, 1.5, 10, 4, 15, 7] } });

      map.on("click", "cells-points", (e) => {
        const p = e.features?.[0]?.properties; if (!p) return;
        const op = OPERATORS[p.mnc]?.name ?? `MNC ${p.mnc}`;
        new maplibregl.Popup().setLngLat(e.lngLat).setDOMContent(popupNode(`${op} · ${RADIOS[p.radio]}`, [
          ["TAC", String(p.area)], ["Cell ID", String(p.cell)], ["Range", `${p.range} m`],
          ["Samples", String(p.samples)], ["Update", new Date(p.updated * 1000).toLocaleDateString("id-ID")],
        ])).addTo(map);
      });
      map.on("click", "towers", (e) => {
        const p = e.features?.[0]?.properties; if (!p) return;
        new maplibregl.Popup().setLngLat(e.lngLat).setDOMContent(popupNode(p.name || "Menara (OSM)", [
          ["Operator", p.operator || "-"], ["Tipe", p.kind || "-"],
          ["Tinggi", p.height ? `${p.height} m` : "-"], ["OSM", String(p.id)],
        ])).addTo(map);
      });
      // Popup kabel TeleGeography
      map.on("click", "cables-tg", (e) => {
        const p = e.features?.[0]?.properties; if (!p) return;
        new maplibregl.Popup().setLngLat(e.lngLat).setDOMContent(popupNode(`🌊 ${p.name}`, [
          ["Sumber", "TeleGeography"],
          ["ID", String(p.id ?? "-")],
        ])).addTo(map);
      });
      for (const l of ["cells-points", "towers", "cables-tg"]) {
        map.on("mouseenter", l, () => (map.getCanvas().style.cursor = "pointer"));
        map.on("mouseleave", l, () => (map.getCanvas().style.cursor = ""));
      }
      map.on("moveend", report);
      setReady(true);
    });
    return () => { map.remove(); mapRef.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Data sel mengikuti filter
  useEffect(() => {
    if (!ready) return;
    (mapRef.current!.getSource("cells") as GeoJSONSource).setData(cellsToGeoJSON(cells, idx));
    report();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, cells, idx]);

  // Visibilitas layer
  useEffect(() => {
    if (!ready) return;
    const m = mapRef.current!;
    const v = (b: boolean) => (b ? "visible" : "none");
    m.setLayoutProperty("cells-points", "visibility", v(show.cells && mode === "points"));
    m.setLayoutProperty("cells-heat", "visibility", v(show.cells && mode === "heat"));
    m.setLayoutProperty("towers", "visibility", v(show.towers));
    m.setLayoutProperty("cables", "visibility", "none"); // kabel lokal disembunyikan
    m.setLayoutProperty("cables-tg", "visibility", v(show.cables));
    m.setLayoutProperty("cables-tg-glow", "visibility", v(show.cables));
  }, [ready, show, mode]);

  // Pindah wilayah
  useEffect(() => {
    if (ready && view.n > 0) mapRef.current!.flyTo({ center: view.center, zoom: view.zoom, duration: 1200 });
  }, [ready, view]);

  return <div ref={box} className="absolute inset-0 h-full w-full" style={{ width: "100%", height: "100%" }} />;
}