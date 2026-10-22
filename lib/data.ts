import type { FeatureCollection } from "geojson";

export type CellData = {
  radio: number[]; mnc: number[]; area: number[]; cell: number[];
  lon: number[]; lat: number[]; range: number[]; samples: number[]; updated: number[];
};

export type Dataset = {
  cells: CellData;
  towers: FeatureCollection;
};

export async function loadDataset(): Promise<Dataset> {
  const [cells, towers] = await Promise.all([
    fetch("/data/cells.json").then((r) => r.json()),
    fetch("/data/towers.geojson").then((r) => r.json()),
  ]);
  return { cells, towers };
}

export function cellsToGeoJSON(c: CellData, idx: ArrayLike<number>): FeatureCollection {
  const features = new Array(idx.length);
  for (let k = 0; k < idx.length; k++) {
    const i = idx[k];
    features[k] = {
      type: "Feature",
      geometry: { type: "Point", coordinates: [c.lon[i], c.lat[i]] },
      properties: { i, mnc: c.mnc[i], radio: c.radio[i], range: c.range[i], samples: c.samples[i], area: c.area[i], cell: c.cell[i], updated: c.updated[i] },
    };
  }
  return { type: "FeatureCollection", features };
}
