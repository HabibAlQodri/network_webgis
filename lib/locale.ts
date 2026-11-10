"use client";

import { useEffect, useState } from "react";

export type Locale = "en" | "id";

export function detectLocale(languages: readonly string[]): Locale {
  for (const language of languages) {
    const baseLanguage = language.toLowerCase().split("-")[0];
    if (baseLanguage === "id") return "id";
    if (baseLanguage === "en") return "en";
  }
  return "en";
}

export function useLocale(): Locale {
  const [locale, setLocale] = useState<Locale>("en");

  useEffect(() => {
    const updateLocale = () => setLocale(detectLocale(navigator.languages.length ? navigator.languages : [navigator.language]));
    updateLocale();
    window.addEventListener("languagechange", updateLocale);
    return () => window.removeEventListener("languagechange", updateLocale);
  }, []);

  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  return locale;
}

export function text(locale: Locale, english: string, indonesian: string): string {
  return locale === "id" ? indonesian : english;
}

export function formatNumber(value: number, locale: Locale): string {
  return value.toLocaleString(locale === "id" ? "id-ID" : "en-US");
}

export function localizeDataMessage(message: string, locale: Locale): string {
  if (locale !== "id") return message;
  if (message === "Cell site data is corrupted or has an invalid format.") return "Data BTS rusak atau formatnya tidak valid.";
  if (message === "Tower data is corrupted or has an invalid format.") return "Data menara rusak atau formatnya tidak valid.";
  if (message.startsWith("Could not connect to the server while loading ")) {
    const label = message.includes("cell site data") ? "data BTS" : "data menara";
    return `Tidak dapat terhubung ke server saat memuat ${label}. Periksa koneksi internet Anda.`;
  }
  if (message.startsWith("The ")) {
    const label = message.includes("cell site data") ? "data BTS" : "data menara";
    if (message.includes("file was not found")) return `Berkas ${label} tidak ditemukan di server.`;
    if (message.includes("corrupted or has an invalid format")) return `Berkas ${label} rusak atau formatnya tidak valid.`;
  }
  if (message.startsWith("The server encountered a problem")) return "Server bermasalah saat memuat data. Silakan coba lagi nanti.";
  if (message.startsWith("Cell site data failed to load")) return message.replace("Cell site data failed to load", "Data BTS gagal dimuat").replace("status", "kode");
  if (message.startsWith("Tower data failed to load")) return message.replace("Tower data failed to load", "Data menara gagal dimuat").replace("status", "kode");
  if (message === "Data could not be loaded due to an unexpected error.") return "Data tidak dapat dimuat karena terjadi kesalahan yang tidak terduga.";
  return message;
}
