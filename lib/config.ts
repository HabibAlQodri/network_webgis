// CARTO Basemaps API Key
export const CARTO_API_KEY = process.env.NEXT_PUBLIC_CARTO_API_KEY || "cb1_4rip_1_aa7091ae5495a099f84bfd12";

// MNC Indonesia (MCC 510). Label bisa disesuaikan.
export const OPERATORS: Record<number, { name: string; color: string }> = {
  10: { name: "Telkomsel", color: "#ef4444" },
  1: { name: "Indosat", color: "#f5b301" },
  11: { name: "XL Axiata", color: "#3b82f6" },
  89: { name: "Tri", color: "#a855f7" },
  9: { name: "Smartfren", color: "#f97316" },
  21: { name: "Indosat (21)", color: "#ca8a04" },
  28: { name: "Fren", color: "#fb923c" },
  22: { name: "PSN (22)", color: "#94a3b8" },
};
export const OTHER_COLOR = "#64748b";

export const RADIOS = ["GSM", "UMTS", "LTE", "NR"] as const;
export const RADIO_COLORS = ["#f59e0b", "#10b981", "#38bdf8", "#f472b6"];

export const REGIONS = ["Nasional", "Sumatra", "Jawa", "Kalimantan", "Sulawesi", "Bali & Nusa Tenggara", "Maluku & Papua"] as const;
export type Region = (typeof REGIONS)[number];
export type Preset = { label: string; province: string; region: Region; center: [number, number]; zoom: number };

const P = (label: string, province: string, region: Region, lon: number, lat: number, zoom: number): Preset => ({ label, province, region, center: [lon, lat], zoom });

export const PRESETS: Preset[] = [
  P("Indonesia", "Seluruh nusantara", "Nasional", 118, -2.5, 4.2),
  // Sumatra
  P("Banda Aceh", "Aceh", "Sumatra", 95.32, 5.55, 11),
  P("Medan", "Sumatra Utara", "Sumatra", 98.67, 3.59, 10.8),
  P("Padang", "Sumatra Barat", "Sumatra", 100.36, -0.95, 11),
  P("Pekanbaru", "Riau", "Sumatra", 101.45, 0.51, 11),
  P("Batam", "Kepulauan Riau", "Sumatra", 104.03, 1.12, 11),
  P("Jambi", "Jambi", "Sumatra", 103.61, -1.61, 11),
  P("Palembang", "Sumatra Selatan", "Sumatra", 104.75, -2.98, 11),
  P("Bandar Lampung", "Lampung", "Sumatra", 105.26, -5.43, 11),
  // Jawa
  P("Jabodetabek", "DKI Jakarta, Banten, Jawa Barat", "Jawa", 106.85, -6.25, 9.6),
  P("Bandung", "Jawa Barat", "Jawa", 107.61, -6.91, 10.8),
  P("Semarang", "Jawa Tengah", "Jawa", 110.42, -6.99, 11),
  P("Yogyakarta", "DI Yogyakarta", "Jawa", 110.37, -7.8, 11),
  P("Surabaya", "Jawa Timur", "Jawa", 112.75, -7.27, 10.8),
  P("Malang", "Jawa Timur", "Jawa", 112.63, -7.98, 11),
  // Kalimantan
  P("Pontianak", "Kalimantan Barat", "Kalimantan", 109.33, -0.03, 11),
  P("Banjarmasin", "Kalimantan Selatan", "Kalimantan", 114.59, -3.32, 11),
  P("Balikpapan", "Kalimantan Timur", "Kalimantan", 116.83, -1.24, 11),
  P("Samarinda", "Kalimantan Timur", "Kalimantan", 117.15, -0.5, 11),
  // Sulawesi
  P("Makassar", "Sulawesi Selatan", "Sulawesi", 119.43, -5.15, 11),
  P("Palu", "Sulawesi Tengah", "Sulawesi", 119.87, -0.9, 11),
  P("Kendari", "Sulawesi Tenggara", "Sulawesi", 122.51, -3.97, 11),
  P("Manado", "Sulawesi Utara", "Sulawesi", 124.84, 1.47, 11),
  // Bali & Nusa Tenggara
  P("Denpasar", "Bali", "Bali & Nusa Tenggara", 115.19, -8.65, 10.6),
  P("Mataram", "Nusa Tenggara Barat", "Bali & Nusa Tenggara", 116.12, -8.58, 11),
  P("Kupang", "Nusa Tenggara Timur", "Bali & Nusa Tenggara", 123.61, -10.17, 11),
  // Maluku & Papua
  P("Ternate", "Maluku Utara", "Maluku & Papua", 127.38, 0.79, 11),
  P("Ambon", "Maluku", "Maluku & Papua", 128.18, -3.7, 11),
  P("Sorong", "Papua Barat Daya", "Maluku & Papua", 131.26, -0.88, 11),
  P("Jayapura", "Papua", "Maluku & Papua", 140.72, -2.53, 11),
];