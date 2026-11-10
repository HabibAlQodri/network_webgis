import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { siteUrl } from "@/lib/site";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Jejaringnusa | Mobile Network Infrastructure Map",
  description: "A map of Indonesia's mobile network infrastructure, including cell sites, towers, submarine cables, and fiber networks.",
  metadataBase: new URL(siteUrl),
  applicationName: "Jejaringnusa",
  keywords: [
    "Indonesia mobile network map",
    "telecommunications infrastructure",
    "cell towers",
    "submarine cables",
    "fiber optic network",
  ],
  alternates: {
    canonical: "/",
  },
  openGraph: {
    type: "website",
    url: siteUrl,
    siteName: "Jejaringnusa",
    title: "Jejaringnusa | Mobile Network Infrastructure Map",
    description: "Explore Indonesia's mobile network infrastructure, including cell sites, towers, submarine cables, and fiber networks.",
    locale: "en_US",
    images: [
      {
        url: "/Jejaringnusa_removebg.png",
        alt: "Jejaringnusa",
      },
    ],
  },
  twitter: {
    card: "summary",
    title: "Jejaringnusa | Mobile Network Infrastructure Map",
    description: "Explore Indonesia's mobile network infrastructure, including cell sites, towers, submarine cables, and fiber networks.",
    images: ["/Jejaringnusa_removebg.png"],
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
    },
  },
  icons: {
    icon: "/Jejaringnusa_removebg.png",
  },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
