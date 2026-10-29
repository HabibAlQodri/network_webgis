
import fs from "node:fs";

async function fetchJSON(url) {
  console.log(`Fetching ${url}...`);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.json();
}

async function prepareSubmarineCables() {
  console.log("=== 1. Preparing Submarine Cables (TeleGeography - Indonesia) ===");
  const [indonesiaCountry, allCables, allLandingPoints] = await Promise.all([
    fetchJSON("https://www.submarinecablemap.com/api/v3/country/indonesia.json"),
    fetchJSON("https://www.submarinecablemap.com/api/v3/cable/cable-geo.json"),
    fetchJSON("https://www.submarinecablemap.com/api/v3/landing-point/landing-point-geo.json"),
  ]);

  const cableMetaMap = new Map();
  for (const c of indonesiaCountry.cables) {
    cableMetaMap.set(c.id, c);
  }
  console.log(`Found ${cableMetaMap.size} submarine cables landing in Indonesia.`);

  // Filter features belonging to Indonesia cables
  const indonesiaFeatures = [];
  for (const f of allCables.features) {
    const cableId = f.properties.id;
    if (!cableMetaMap.has(cableId)) continue;
    const meta = cableMetaMap.get(cableId);

    // If it's a MultiLineString, we can create separate LineString features or keep MultiLineString
    // Keeping MultiLineString or LineString: LineString per segment allows precise styling & hover
    if (f.geometry.type === "MultiLineString") {
      f.geometry.coordinates.forEach((coords, segIdx) => {
        indonesiaFeatures.push({
          type: "Feature",
          geometry: {
            type: "LineString",
            coordinates: coords,
          },
          properties: {
            id: cableId,
            name: meta.name || f.properties.name,
            color: f.properties.color || "#38bdf8",
            rfs_year: meta.rfs_year || null,
            is_planned: Boolean(meta.is_planned),
            landing_points: meta.landing_points ? meta.landing_points.join(", ") : "",
            landing_count: meta.landing_points ? meta.landing_points.length : 0,
            segment: segIdx,
            source: "TeleGeography",
          },
        });
      });
    } else if (f.geometry.type === "LineString") {
      indonesiaFeatures.push({
        type: "Feature",
        geometry: f.geometry,
        properties: {
          id: cableId,
          name: meta.name || f.properties.name,
          color: f.properties.color || "#38bdf8",
          rfs_year: meta.rfs_year || null,
          is_planned: Boolean(meta.is_planned),
          landing_points: meta.landing_points ? meta.landing_points.join(", ") : "",
          landing_count: meta.landing_points ? meta.landing_points.length : 0,
          segment: 0,
          source: "TeleGeography",
        },
      });
    }
  }

  // Indonesian landing points
  const idLandingPointIds = new Set(
    indonesiaCountry.landing_points_in_country ||
    indonesiaCountry.landing_points.filter((p) => p.endsWith("-indonesia"))
  );
  const landingPointFeatures = allLandingPoints.features
    .filter((f) => idLandingPointIds.has(f.properties.id))
    .map((f) => ({
      type: "Feature",
      geometry: f.geometry,
      properties: {
        id: f.properties.id,
        name: f.properties.name,
        country: "Indonesia",
      },
    }));

  const cablesGeoJSON = {
    type: "FeatureCollection",
    features: indonesiaFeatures,
  };
  const landingPointsGeoJSON = {
    type: "FeatureCollection",
    features: landingPointFeatures,
  };

  fs.writeFileSync("public/data/cables_telegeography.geojson", JSON.stringify(cablesGeoJSON));
  fs.writeFileSync("public/data/landing_points.geojson", JSON.stringify(landingPointsGeoJSON));
  console.log(`Saved ${indonesiaFeatures.length} cable segments and ${landingPointFeatures.length} landing points.`);
}

async function prepareITUFiber() {
  console.log("=== 2. Preparing Terrestrial Fiber Optic (ITU Broadband Map) ===");
  // Bounding box for Indonesia region
  const bbox = "94.5,-11.5,141.5,6.5";
  const url = `https://bbmaps.itu.int/geoserver/itu-geocatalogue/ows?service=WFS&version=1.0.0&request=GetFeature&typeName=itu-geocatalogue:trx_geocatalogue&bbox=${bbox}&maxFeatures=50000&outputFormat=application/json`;
  const raw = await fetchJSON(url);

  const formattedFeatures = [];
  for (const f of raw.features) {
    const p = f.properties;
    const typeInf = p.type_inf || "";
    const isFiber = typeInf.toLowerCase().includes("fibre") || typeInf.toLowerCase().includes("fiber");
    const status = p.status || (typeInf.includes("Operational") ? "Operational" : typeInf.includes("Planned") ? "Planned" : "Under Construction");

    // Set appropriate color
    let color = "#10b981"; // Operational Fibre default emerald
    if (isFiber) {
      if (status === "Planned") color = "#facc15"; // yellow
      else if (status === "Under Construction") color = "#fb923c"; // orange
      else color = "#10b981"; // emerald green
    } else {
      // Microwave
      color = status === "Planned" ? "#c084fc" : "#a855f7"; // purple
    }

    formattedFeatures.push({
      type: "Feature",
      id: f.id,
      geometry: f.geometry,
      properties: {
        uid: p.uid,
        name: p.type_inf || "Fiber Optic",
        type_inf: p.type_inf,
        medium: isFiber ? "Fiber Optic" : "Microwave",
        status,
        color,
        source: "ITU Broadband Map",
      },
    });
  }

  const ituGeoJSON = {
    type: "FeatureCollection",
    features: formattedFeatures,
  };

  fs.writeFileSync("public/data/itu_fiber.geojson", JSON.stringify(ituGeoJSON));
  console.log(`Saved ${formattedFeatures.length} ITU transmission/fiber features to public/data/itu_fiber.geojson.`);
}

async function main() {
  try {
    await prepareSubmarineCables();
    await prepareITUFiber();
    console.log("ALL DATA READY!");
  } catch (err) {
    console.error("Error preparing data:", err);
    process.exit(1);
  }
}

main();
