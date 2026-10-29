import type { FilterSpecification } from "maplibre-gl";

/** Filter atribut sel. Diterapkan sebagai ekspresi filter layer (tanpa membangun ulang GeoJSON). */
export type CellFilter = { knownOps: number[]; ops: number[]; radios: number[]; minSamples: number };

/**
 * Ubah CellFilter menjadi ekspresi filter MapLibre. Harus setara dengan logika pada Dashboard:
 * teknologi terpilih, sampel ≥ minimum, dan operator terpilih — MNC yang tidak dikenal selalu lolos.
 */
export function cellFilterExpr(f: CellFilter): FilterSpecification {
  const NONE = ["==", ["get", "i"], -1]; // selalu salah; `match` tidak boleh punya daftar label kosong
  const radio = f.radios.length ? ["match", ["get", "radio"], f.radios, true, false] : NONE;
  const unknown = ["match", ["get", "mnc"], f.knownOps, false, true];
  const op = f.ops.length ? ["any", ["match", ["get", "mnc"], f.ops, true, false], unknown] : unknown;
  return ["all", radio, [">=", ["get", "samples"], f.minSamples], op] as unknown as FilterSpecification;
}
