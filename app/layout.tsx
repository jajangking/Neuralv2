import type { Metadata, Viewport } from "next";
import { Inter, JetBrains_Mono, Space_Grotesk } from "next/font/google";
import "./globals.css";

const ui = Inter({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-ui",
});

const display = Space_Grotesk({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-display",
});

const mono = JetBrains_Mono({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-mono",
});

export const metadata: Metadata = {
  title: {
    default: "Neural Drive — Kendaraan Swakendali",
    template: "%s · Neural Drive",
  },
  description:
    "Simulator Swarm: jaringan saraf 5-8-2 dilatih dengan algoritma genetika untuk mengendarai track sendiri. Manual driving, sensor visual, dan editor track.",
  applicationName: "Neural Drive",
  authors: [{ name: "Neural Drive" }],
  keywords: ["neural network", "genetic algorithm", "self-driving", "simulation", "canvas"],
};

export const viewport: Viewport = {
  themeColor: "#06070a",
  colorScheme: "dark",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="id" className={`${ui.variable} ${display.variable} ${mono.variable}`}>
      <body>{children}</body>
    </html>
  );
}