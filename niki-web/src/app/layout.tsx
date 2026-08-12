import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";

import "./globals.css";

export const metadata: Metadata = {
  title: "Niki — Tu Mac, más cerca de ti",
  description:
    "Niki es tu agente personal para Mac: conversa, recuerda solo lo que eliges y actúa con tu permiso.",
};

export const viewport: Viewport = {
  colorScheme: "dark",
  themeColor: "#07090c",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="es">
      <body>{children}</body>
    </html>
  );
}
