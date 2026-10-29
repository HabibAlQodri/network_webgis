import type { Feature, FeatureCollection, Point } from "geojson";
import type { CellData } from "./data";

export type ExportNames = {
  operator: (mnc: number) => string;
  radio: (r: number) => string;
};

const MCC = 510; // Indonesia
const iso = (unix: number) => new Date(unix * 1000).toISOString().slice(0, 10);

export const CSV_COLUMNS = ["radio", "mcc", "mnc", "operator", "tac", "cell_id", "lon", "lat", "range_m", "samples", "updated"] as const;

/** Escape sel CSV (RFC 4180) dan netralkan awalan rumus spreadsheet (=, +, -, @) pada teks. */
export function csvCell(v: string | number): string {
  if (typeof v === "number") return String(v);
  const t = /^[=+\-@\t\r]/.test(v) ? `'${v}` : v;
  return /[",\n\r]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
}

export function cellsToCSV(c: CellData, idx: ArrayLike<number>, names: ExportNames): string {
  const lines: string[] = new Array(idx.length + 1);
  lines[0] = CSV_COLUMNS.join(",");
  for (let k = 0; k < idx.length; k++) {
    const i = idx[k];
    lines[k + 1] = [
      csvCell(names.radio(c.radio[i])), MCC, c.mnc[i], csvCell(names.operator(c.mnc[i])), c.area[i], c.cell[i],
      c.lon[i], c.lat[i], c.range[i], c.samples[i], iso(c.updated[i]),
    ].join(",");
  }
  return lines.join("\n") + "\n";
}

export function cellsToExportGeoJSON(c: CellData, idx: ArrayLike<number>, names: ExportNames): FeatureCollection<Point> {
  const features: Feature<Point>[] = new Array(idx.length);
  for (let k = 0; k < idx.length; k++) {
    const i = idx[k];
    features[k] = {
      type: "Feature",
      geometry: { type: "Point", coordinates: [c.lon[i], c.lat[i]] },
      properties: {
        radio: names.radio(c.radio[i]), mcc: MCC, mnc: c.mnc[i], operator: names.operator(c.mnc[i]),
        tac: c.area[i], cell_id: c.cell[i], range_m: c.range[i], samples: c.samples[i], updated: iso(c.updated[i]),
      },
    };
  }
  return { type: "FeatureCollection", features };
}

/** Nama berkas aman: huruf kecil, tanda hubung, tanpa karakter khusus. */
export function exportFilename(parts: string[], ext: "csv" | "geojson", date = new Date()): string {
  const slug = parts.filter(Boolean).join("_").normalize("NFKD").replace(/[^\w\s-]/g, "").trim().replace(/\s+/g, "-").toLowerCase();
  return `${slug || "sel-bts"}_${date.toISOString().slice(0, 10)}.${ext}`;
}

/** Picu unduhan di browser. */
export function download(filename: string, mime: string, text: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: `${mime};charset=utf-8` }));
  const a = document.createElement("a");
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
