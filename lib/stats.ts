import { coverageByGroup } from "./coverage";
import type { CellData } from "./data";

/** Kunci kelompok untuk semua MNC yang tidak ada di daftar operator. */
export const OTHER_OPERATOR = -1;

export type OperatorStat = {
  /** MNC, atau OTHER_OPERATOR untuk gabungan operator tak dikenal. */
  mnc: number;
  count: number;
  byRadio: [number, number, number, number];
  avgRange: number;
  medianRange: number;
  /** Luas gabungan lingkaran jangkauan (km²), tumpang tindih tidak dihitung ganda. */
  coverageKm2: number;
  /** Jumlah luas lingkaran tanpa memperhitungkan tumpang tindih (km²). */
  sumAreaKm2: number;
};

function median(sorted: Float64Array): number {
  const n = sorted.length;
  if (!n) return 0;
  return n % 2 ? sorted[(n - 1) / 2] : (sorted[n / 2 - 1] + sorted[n / 2]) / 2;
}

/**
 * Bandingkan operator pada himpunan sel `idx`. MNC di luar `known` digabung sebagai OTHER_OPERATOR.
 * Hasil diurutkan menurun berdasarkan jumlah sel.
 */
export function compareOperators(c: CellData, idx: ArrayLike<number>, known: ReadonlySet<number>, opts?: { coverage?: boolean }): OperatorStat[] {
  const groups = new Map<number, number[]>();
  for (let k = 0; k < idx.length; k++) {
    const i = idx[k], key = known.has(c.mnc[i]) ? c.mnc[i] : OTHER_OPERATOR;
    let g = groups.get(key);
    if (!g) groups.set(key, (g = []));
    g.push(i);
  }
  const cover = opts?.coverage === false ? new Map<number, number>() : coverageByGroup(c, groups);
  const stats: OperatorStat[] = [];
  for (const [mnc, ids] of groups) {
    const byRadio: [number, number, number, number] = [0, 0, 0, 0];
    const ranges = new Float64Array(ids.length);
    let sum = 0, area = 0;
    ids.forEach((i, k) => {
      byRadio[c.radio[i]]++;
      const r = c.range[i];
      ranges[k] = r; sum += r;
      area += Math.PI * (r / 1000) ** 2;
    });
    ranges.sort();
    stats.push({ mnc, count: ids.length, byRadio, avgRange: sum / ids.length, medianRange: median(ranges), // union nyata tak mungkin melebihi jumlah luas; rasterisasi kasar bisa sedikit melebihi → dibatasi
      coverageKm2: Math.min(cover.get(mnc) ?? 0, area), sumAreaKm2: area });
  }
  return stats.sort((a, b) => b.count - a.count);
}
