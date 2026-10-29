import type { CellData } from "./data";

export type CoverageOptions = {
  /** Sisi grid terkecil (km). Default 0,25. */
  minCellKm?: number;
  /** Jumlah piksel maksimum per sisi grid. Default 2500 (≤ 6,25 juta piksel). */
  maxDim?: number;
};

/**
 * Luas gabungan (union) lingkaran jangkauan per kelompok, dalam km², lewat rasterisasi grid:
 * tiap lingkaran mengisi rentang piksel per baris (`fill` native), sehingga tumpang tindih tidak
 * dihitung ganda. Semua kelompok memakai grid yang sama agar hasilnya sebanding.
 *
 * Ini perkiraan kasar: `range` pada data crowdsourced adalah radius estimasi, bukan kuat sinyal
 * yang terukur. Lingkaran lebih kecil dari satu piksel dihitung minimal satu piksel.
 */
export function coverageByGroup(c: CellData, groups: Map<number, ArrayLike<number>>, opts: CoverageOptions = {}): Map<number, number> {
  const minCell = opts.minCellKm ?? 0.25, maxDim = opts.maxDim ?? 2500;
  const out = new Map<number, number>();

  // Bounding box seluruh lingkaran
  let minLat = Infinity, maxLat = -Infinity, minLon = Infinity, maxLon = -Infinity, any = false;
  for (const idx of groups.values()) for (let k = 0; k < idx.length; k++) {
    const i = idx[k], rDegLat = c.range[i] / 111_320;
    any = true;
    if (c.lat[i] - rDegLat < minLat) minLat = c.lat[i] - rDegLat;
    if (c.lat[i] + rDegLat > maxLat) maxLat = c.lat[i] + rDegLat;
    if (c.lon[i] < minLon) minLon = c.lon[i]; if (c.lon[i] > maxLon) maxLon = c.lon[i];
  }
  if (!any) { for (const key of groups.keys()) out.set(key, 0); return out; }

  const lat0 = (minLat + maxLat) / 2, KY = 110.57, KX = 111.32 * Math.cos((lat0 * Math.PI) / 180);
  const maxR = Math.max(...[...groups.values()].map((idx) => { let m = 0; for (let k = 0; k < idx.length; k++) m = Math.max(m, c.range[idx[k]]); return m; })) / 1000;
  const x0 = minLon * KX - maxR, y0 = minLat * KY - maxR;
  const wKm = (maxLon - minLon) * KX + 2 * maxR, hKm = (maxLat - minLat) * KY + 2 * maxR;
  const g = Math.max(minCell, Math.max(wKm, hKm) / maxDim);
  const W = Math.ceil(wKm / g) + 1, H = Math.ceil(hKm / g) + 1;
  const bits = new Uint8Array(W * H);

  for (const [key, idx] of groups) {
    bits.fill(0);
    for (let k = 0; k < idx.length; k++) {
      const i = idx[k];
      const cx = (c.lon[i] * KX - x0) / g, cy = (c.lat[i] * KY - y0) / g;
      const r = Math.max(c.range[i] / 1000, g / 2) / g; // radius dalam piksel
      const rowA = Math.max(0, Math.floor(cy - r)), rowB = Math.min(H - 1, Math.floor(cy + r));
      for (let row = rowA; row <= rowB; row++) {
        const dy = row + 0.5 - cy;
        if (dy * dy > r * r) continue;
        const half = Math.sqrt(r * r - dy * dy);
        const a = Math.max(0, Math.floor(cx - half)), b = Math.min(W - 1, Math.floor(cx + half));
        if (b >= a) bits.fill(1, row * W + a, row * W + b + 1);
      }
    }
    let n = 0;
    for (let p = 0; p < bits.length; p++) n += bits[p];
    out.set(key, n * g * g);
  }
  return out;
}
