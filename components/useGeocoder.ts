"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { geocode, type PlaceResult } from "@/lib/region";

export type GeocodeState =
  | { status: "idle" }
  | { status: "loading"; q: string }
  | { status: "done"; q: string; results: PlaceResult[] }
  | { status: "error"; q: string; message: string };

/** Pencarian tempat (Nominatim) dengan pembatalan: permintaan baru/reset membatalkan yang sebelumnya. */
export function useGeocoder() {
  const [state, setState] = useState<GeocodeState>({ status: "idle" });
  const ctrl = useRef<AbortController | null>(null);

  const reset = useCallback(() => { ctrl.current?.abort(); ctrl.current = null; setState({ status: "idle" }); }, []);

  const run = useCallback(async (q: string) => {
    const query = q.trim();
    if (query.length < 2) return;
    ctrl.current?.abort();
    const c = (ctrl.current = new AbortController());
    setState({ status: "loading", q: query });
    try {
      const results = await geocode(query, c.signal);
      if (!c.signal.aborted) setState({ status: "done", q: query, results });
    } catch (e) {
      if (c.signal.aborted || (e instanceof DOMException && e.name === "AbortError")) return;
      setState({ status: "error", q: query, message: "Pencarian lokasi gagal. Periksa koneksi lalu coba lagi." });
    }
  }, []);

  useEffect(() => () => ctrl.current?.abort(), []);
  return { state, run, reset };
}
