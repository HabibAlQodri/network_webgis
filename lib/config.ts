// CARTO Basemaps API Key
export const CARTO_API_KEY = process.env.NEXT_PUBLIC_CARTO_API_KEY || "cb1_4rip_1_aa7091ae5495a099f84bfd12";

// MNC Indonesia (MCC 510). Label bisa disesuaikan.
export const OPERATORS: Record<number, { name: string; color: string }> = {
  10: { name: "Telkomsel", color: "#ef4444" },
  1: { name: "Indosat", color: "#facc15" },
  11: { name: "XL Axiata", color: "#3b82f6" },
  89: { name: "Tri", color: "#a855f7" },
  9: { name: "Smartfren", color: "#f97316" },
  21: { name: "Indosat (21)", color: "#eab308" },
  28: { name: "Fren", color: "#fb923c" },
  22: { name: "PSN (22)", color: "#94a3b8" },
};
export const OTHER_COLOR = "#64748b";

export const RADIOS = ["GSM", "UMTS", "LTE", "NR"] as const;
export const RADIO_COLORS = ["#f59e0b", "#10b981", "#38bdf8", "#f472b6"];

export const PRESETS = [
  { label: "Indonesia", center: [118, -2.5] as [number, number], zoom: 4.2 },
  { label: "Jabodetabek", center: [106.85, -6.25] as [number, number], zoom: 9.6 },
  { label: "Bandung", center: [107.61, -6.91] as [number, number], zoom: 10.8 },
  { label: "Surabaya", center: [112.75, -7.27] as [number, number], zoom: 10.8 },
  { label: "Medan", center: [98.67, 3.59] as [number, number], zoom: 10.8 },
];
