// Jalankan: node scripts/prepare-data.mjs
// Mengubah data/510.csv (format OpenCellID, tanpa header) dan data/export.geojson (Overpass/OSM)
// menjadi file ringan di public/data/ yang dibaca dashboard.
import fs from "node:fs";

const RADIO = ["GSM", "UMTS", "LTE", "NR"];
const cols = { radio: [], mnc: [], area: [], cell: [], lon: [], lat: [], range: [], samples: [], updated: [] };

for (const line of fs.readFileSync("data/510.csv", "utf8").split("\n")) {
  if (!line.trim()) continue;
  const p = line.split(",");
  // radio,mcc,mnc,area,cell,unit,lon,lat,range,samples,changeable,created,updated,avgSignal
  const r = RADIO.indexOf(p[0]);
  if (r < 0) continue;
  cols.radio.push(r);
  cols.mnc.push(+p[2]);
  cols.area.push(+p[3]);
  cols.cell.push(+p[4]);
  cols.lon.push(+(+p[6]).toFixed(5));
  cols.lat.push(+(+p[7]).toFixed(5));
  cols.range.push(+p[8]);
  cols.samples.push(+p[9]);
  cols.updated.push(+p[12]);
}
fs.writeFileSync("public/data/cells.json", JSON.stringify(cols));

const gj = JSON.parse(fs.readFileSync("data/export.geojson", "utf8"));
const towers = [], cables = [];
for (const f of gj.features) {
  const pr = f.properties;
  if (f.geometry.type === "Point") {
    towers.push({
      type: "Feature",
      geometry: f.geometry,
      properties: {
        id: pr["@id"],
        name: pr.name || "",
        operator: pr.operator || "",
        height: pr.height ? parseFloat(pr.height) || 0 : 0,
        kind: pr["tower:type"] || pr.man_made || "",
        mobile: pr["communication:mobile_phone"] === "yes" ? 1 : 0,
      },
    });
  } else if (f.geometry.type === "LineString") {
    cables.push({ type: "Feature", geometry: f.geometry, properties: { name: pr.name || "Kabel", operator: pr.operator || "" } });
  }
}
fs.writeFileSync("public/data/towers.geojson", JSON.stringify({ type: "FeatureCollection", features: towers }));
fs.writeFileSync("public/data/cables.geojson", JSON.stringify({ type: "FeatureCollection", features: cables }));
console.log({ cells: cols.radio.length, towers: towers.length, cables: cables.length });
