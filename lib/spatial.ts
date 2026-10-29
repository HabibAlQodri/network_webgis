/** Batas persegi: [barat, selatan, timur, utara] dalam derajat. */
export type BBox = [number, number, number, number];

/**
 * Indeks grid seragam (format CSR) untuk titik. Dibangun sekali O(n), lalu kueri
 * bounding-box hanya memeriksa titik di bucket yang tumpang tindih — bukan seluruh dataset.
 * Tidak menangani garis tanggal internasional (data Indonesia tidak melintasinya).
 */
export class PointGrid {
  private readonly nx: number;
  private readonly ny: number;
  private readonly x0: number;
  private readonly y0: number;
  private readonly offsets: Uint32Array; // awal tiap bucket di `order`
  private readonly order: Uint32Array;   // indeks titik, terkelompok per bucket

  constructor(private readonly lon: ArrayLike<number>, private readonly lat: ArrayLike<number>, private readonly cellDeg = 0.1) {
    const n = lon.length;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (let i = 0; i < n; i++) {
      if (lon[i] < minX) minX = lon[i]; if (lon[i] > maxX) maxX = lon[i];
      if (lat[i] < minY) minY = lat[i]; if (lat[i] > maxY) maxY = lat[i];
    }
    if (n === 0) { minX = minY = 0; maxX = maxY = 0; }
    this.x0 = minX; this.y0 = minY;
    this.nx = Math.floor((maxX - minX) / cellDeg) + 1;
    this.ny = Math.floor((maxY - minY) / cellDeg) + 1;
    const counts = new Uint32Array(this.nx * this.ny + 1);
    const bucket = new Uint32Array(n);
    for (let i = 0; i < n; i++) {
      const b = this.bucketOf(lon[i], lat[i]);
      bucket[i] = b; counts[b + 1]++;
    }
    for (let b = 0; b < this.nx * this.ny; b++) counts[b + 1] += counts[b];
    this.offsets = counts;
    const cursor = counts.slice(0, this.nx * this.ny);
    this.order = new Uint32Array(n);
    for (let i = 0; i < n; i++) this.order[cursor[bucket[i]]++] = i;
  }

  private bucketOf(x: number, y: number) {
    return Math.floor((y - this.y0) / this.cellDeg) * this.nx + Math.floor((x - this.x0) / this.cellDeg);
  }

  /** Panggil `fn(i)` untuk tiap titik di dalam bbox (batas inklusif). */
  forEachInBBox(b: BBox, fn: (i: number) => void): void {
    const [w, s, e, n] = b;
    if (!(w <= e && s <= n) || this.order.length === 0) return;
    const c0 = Math.max(0, Math.floor((w - this.x0) / this.cellDeg));
    const c1 = Math.min(this.nx - 1, Math.floor((e - this.x0) / this.cellDeg));
    const r0 = Math.max(0, Math.floor((s - this.y0) / this.cellDeg));
    const r1 = Math.min(this.ny - 1, Math.floor((n - this.y0) / this.cellDeg));
    for (let r = r0; r <= r1; r++) {
      for (let c = c0; c <= c1; c++) {
        const bk = r * this.nx + c;
        for (let k = this.offsets[bk]; k < this.offsets[bk + 1]; k++) {
          const i = this.order[k];
          const x = this.lon[i], y = this.lat[i];
          if (x >= w && x <= e && y >= s && y <= n) fn(i);
        }
      }
    }
  }

  /** Jumlah titik dalam bbox; bila `mask` diberikan, hanya titik dengan mask[i] !== 0. */
  count(b: BBox, mask?: Uint8Array): number {
    let k = 0;
    this.forEachInBBox(b, (i) => { if (!mask || mask[i]) k++; });
    return k;
  }
}

export const inBBox = (lon: number, lat: number, b: BBox) => lon >= b[0] && lon <= b[2] && lat >= b[1] && lat <= b[3];
