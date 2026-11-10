import type { Feature, FeatureCollection, Point } from "geojson";
import type { CellData } from "./data";

export type ExportNames = {
  operator: (mnc: number) => string;
  radio: (r: number) => string;
};

const MCC = 510; // Indonesia
const iso = (unix: number) => new Date(unix * 1000).toISOString().slice(0, 10);

export const CSV_COLUMNS = ["radio", "mcc", "mnc", "operator", "tac", "cell_id", "lon", "lat", "range_m", "samples", "updated"] as const;

/** Escape CSV cells according to RFC 4180 and neutralize spreadsheet formula prefixes. */
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

/** Create a filesystem-safe, lowercase filename. */
export function exportFilename(parts: string[], ext: "csv" | "geojson" | "png", date = new Date()): string {
  const slug = parts.filter(Boolean).join("_").normalize("NFKD").replace(/[^\w\s-]/g, "").trim().replace(/\s+/g, "-").toLowerCase();
  return `${slug || "cell-sites"}_${date.toISOString().slice(0, 10)}.${ext}`;
}

/** Trigger a browser download. */
export function download(filename: string, mime: string, content: string | Blob): void {
  const blob = typeof content === "string"
    ? new Blob([content], { type: `${mime};charset=utf-8` })
    : content;
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Export a canvas as a PNG file. Reject when the browser cannot serialize the canvas. */
export function downloadCanvasAsPNG(filename: string, canvas: Pick<HTMLCanvasElement, "toBlob">): Promise<void> {
  return new Promise((resolve, reject) => {
    try {
      canvas.toBlob((blob) => {
        if (!blob) {
          reject(new Error("The browser could not create a PNG image from the map canvas."));
          return;
        }
        download(filename, "image/png", blob);
        resolve();
      }, "image/png");
    } catch (error) {
      reject(error);
    }
  });
}
