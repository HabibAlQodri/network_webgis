"use client";
import dynamic from "next/dynamic";
import { useEffect, useMemo, useState } from "react";
import { OPERATORS, OTHER_COLOR, PRESETS, RADIOS, RADIO_COLORS } from "@/lib/config";
import { loadDataset, type Dataset } from "@/lib/data";
import type { Viewport } from "./MapView";

const MapView = dynamic(() => import("./MapView"), { ssr: false });
const fmt = (n: number) => n.toLocaleString("id-ID");

function Chip({ on, onClick, color, children }: { on: boolean; onClick: () => void; color?: string; children: React.ReactNode }) {
  return (
    <button onClick={onClick}
      className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs transition ${on ? "border-white/30 bg-white/10 text-white" : "border-white/10 text-zinc-500 hover:text-zinc-300"}`}>
      {color && <span className="h-2 w-2 rounded-full" style={{ background: on ? color : "#52525b" }} />}
      {children}
    </button>
  );
}

function Bar({ label, value, max, color }: { label: string; value: number; max: number; color: string }) {
  return (
    <div className="text-xs">
      <div className="mb-0.5 flex justify-between text-zinc-300"><span>{label}</span><span className="tabular-nums text-zinc-400">{fmt(value)}</span></div>
      <div className="h-1.5 rounded bg-white/5"><div className="h-full rounded" style={{ width: `${max ? (value / max) * 100 : 0}%`, background: color }} /></div>
    </div>
  );
}

const Section = ({ title, children }: { title: string; children: React.ReactNode }) => (
  <section className="space-y-2.5 border-b border-white/10 p-4">
    <h2 className="text-[11px] font-medium uppercase tracking-wider text-zinc-500">{title}</h2>
    {children}
  </section>
);

export default function Dashboard() {
  const [data, setData] = useState<Dataset | null>(null);
  const [error, setError] = useState("");
  const [ops, setOps] = useState<Set<number>>(new Set());
  const [radios, setRadios] = useState<Set<number>>(new Set([0, 1, 2, 3]));
  const [minSamples, setMinSamples] = useState(1);
  const [show, setShow] = useState({ cells: true, towers: true, cables: false });
  const [mode, setMode] = useState<"points" | "heat">("points");
  const [view, setView] = useState({ ...PRESETS[0], n: 0 });
  const [vp, setVp] = useState<Viewport>({ cells: 0, towers: 0 });

  useEffect(() => {
    loadDataset().then((d) => { setData(d); setOps(new Set(Object.keys(OPERATORS).map(Number))); }).catch((e) => setError(String(e)));
  }, []);

  // Hitung statistik + indeks sel yang lolos filter
  const calc = useMemo(() => {
    if (!data) return null;
    const c = data.cells, n = c.radio.length;
    const perOp = new Map<number, number>();
    const perRadio = [0, 0, 0, 0];
    const keep: number[] = [];
    let rangeSum = 0, latest = 0;
    for (let i = 0; i < n; i++) {
      if (!radios.has(c.radio[i]) || c.samples[i] < minSamples) continue;
      perOp.set(c.mnc[i], (perOp.get(c.mnc[i]) ?? 0) + 1);
      if (c.updated[i] > latest) latest = c.updated[i];
      if (!ops.has(c.mnc[i]) && OPERATORS[c.mnc[i]]) continue;
      perRadio[c.radio[i]]++;
      rangeSum += c.range[i];
      keep.push(i);
    }
    return { idx: Uint32Array.from(keep), perOp, perRadio, avgRange: keep.length ? rangeSum / keep.length : 0, latest, total: n };
  }, [data, ops, radios, minSamples]);

  const toggle = <T,>(s: Set<T>, v: T, set: (s: Set<T>) => void) => { const x = new Set(s); x.has(v) ? x.delete(v) : x.add(v); set(x); };

  if (error) return <div className="grid h-screen place-items-center text-red-400">Gagal memuat data: {error}</div>;
  if (!data || !calc) return <div className="grid h-screen place-items-center text-zinc-400">Memuat data…</div>;

  const opRows = [...calc.perOp.entries()].sort((a, b) => b[1] - a[1]);
  const maxOp = opRows[0]?.[1] ?? 0;
  const kpi = [
    ["Sel tampil", fmt(calc.idx.length)], ["Dalam peta", fmt(vp.cells)],
    ["Menara OSM", fmt(data.towers.features.length)], ["Rata² range", `${fmt(Math.round(calc.avgRange))} m`],
  ];

  return (
    <div className="flex h-screen flex-col bg-zinc-950 text-zinc-100 md:flex-row">
      <aside className="max-h-[45vh] w-full shrink-0 overflow-y-auto border-white/10 bg-zinc-900/60 md:max-h-none md:w-80 md:border-r">
        <header className="border-b border-white/10 p-4">
          <h1 className="text-base font-semibold">Peta Infrastruktur Seluler</h1>
          <p className="text-xs text-zinc-500">MCC 510 Indonesia · OpenCellID + OSM · data per {new Date(calc.latest * 1000).toLocaleDateString("id-ID")}</p>
        </header>

        <div className="grid grid-cols-2 gap-px border-b border-white/10 bg-white/10">
          {kpi.map(([k, v]) => (
            <div key={k} className="bg-zinc-900 p-3"><div className="text-[11px] text-zinc-500">{k}</div><div className="text-lg font-semibold tabular-nums">{v}</div></div>
          ))}
        </div>

        <Section title="Wilayah">
          <div className="flex flex-wrap gap-1.5">
            {PRESETS.map((p) => <Chip key={p.label} on={false} onClick={() => setView({ ...p, n: view.n + 1 })}>{p.label}</Chip>)}
          </div>
        </Section>

        <Section title="Layer">
          <div className="flex flex-wrap gap-1.5">
            <Chip on={show.cells} onClick={() => setShow({ ...show, cells: !show.cells })}>Sel BTS</Chip>
            <Chip on={show.towers} onClick={() => setShow({ ...show, towers: !show.towers })} color="#fde047">Menara OSM</Chip>
            <Chip on={show.cables} onClick={() => setShow({ ...show, cables: !show.cables })} color="#22d3ee">Kabel Laut (TeleGeography)</Chip>
          </div>
          <div className="flex gap-1.5">
            <Chip on={mode === "points"} onClick={() => setMode("points")}>Titik</Chip>
            <Chip on={mode === "heat"} onClick={() => setMode("heat")}>Heatmap</Chip>
          </div>
        </Section>

        <Section title="Operator">
          <div className="flex flex-wrap gap-1.5">
            {opRows.map(([mnc]) => OPERATORS[mnc] && (
              <Chip key={mnc} on={ops.has(mnc)} color={OPERATORS[mnc].color} onClick={() => toggle(ops, mnc, setOps)}>{OPERATORS[mnc].name}</Chip>
            ))}
          </div>
          <div className="space-y-2 pt-1">
            {opRows.map(([mnc, n]) => <Bar key={mnc} label={OPERATORS[mnc]?.name ?? `MNC ${mnc}`} value={n} max={maxOp} color={OPERATORS[mnc]?.color ?? OTHER_COLOR} />)}
          </div>
        </Section>

        <Section title="Teknologi">
          <div className="flex flex-wrap gap-1.5">
            {RADIOS.map((r, i) => <Chip key={r} on={radios.has(i)} color={RADIO_COLORS[i]} onClick={() => toggle(radios, i, setRadios)}>{r}</Chip>)}
          </div>
          <div className="space-y-2 pt-1">
            {RADIOS.map((r, i) => <Bar key={r} label={r} value={calc.perRadio[i]} max={Math.max(...calc.perRadio)} color={RADIO_COLORS[i]} />)}
          </div>
        </Section>

        <Section title={`Min. samples: ${minSamples}`}>
          <input type="range" min={1} max={30} value={minSamples} onChange={(e) => setMinSamples(+e.target.value)} className="w-full accent-sky-400" />
          <p className="text-[11px] text-zinc-500">Samples lebih tinggi = posisi sel lebih akurat.</p>
        </Section>
      </aside>

      <main className="relative min-h-[300px] flex-1">
        <MapView cells={data.cells} idx={calc.idx} towers={data.towers} show={show} mode={mode} view={view} onViewport={setVp} />
        <div className="pointer-events-none absolute bottom-6 left-3 rounded bg-black/60 px-2 py-1 text-[11px] text-zinc-300">
          Dalam tampilan: {fmt(vp.cells)} sel · {fmt(vp.towers)} menara
        </div>
      </main>
    </div>
  );
}
