"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { geocode, type PlaceResult } from "@/lib/region";
import type { Locale } from "@/lib/locale";

export type GeocodeState =
  | { status: "idle" }
  | { status: "loading"; q: string }
  | { status: "done"; q: string; results: PlaceResult[] }
  | { status: "error"; q: string; message: string };

/** Search for places with Nominatim; a new request or reset cancels the previous request. */
export function useGeocoder(locale: Locale) {
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
      const results = await geocode(query, c.signal, locale);
      if (!c.signal.aborted) setState({ status: "done", q: query, results });
    } catch (e) {
      if (c.signal.aborted || (e instanceof DOMException && e.name === "AbortError")) return;
      setState({ status: "error", q: query, message: "Location search failed. Check your connection and try again." });
    }
  }, [locale]);

  useEffect(() => () => ctrl.current?.abort(), []);
  return { state, run, reset };
}
