import type { Metadata } from "next";
import { Inter } from "next/font/google";
import type { ReactNode } from "react";

import { RootProviders } from "@/providers/root-providers";
import { DesktopShellBridge } from "@/components/desktop/desktop-shell-bridge";
import "@/app/globals.css";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Niki",
  description: "Niki, your Hermes control center.",
  icons: {
    icon: "/9e8329b0-0dd2-4354-9e44-223d350a2b73.png",
    shortcut: "/9e8329b0-0dd2-4354-9e44-223d350a2b73.png",
    apple: "/9e8329b0-0dd2-4354-9e44-223d350a2b73.png",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={`${inter.variable} font-sans`}>
        <RootProviders>{children}</RootProviders>
        <DesktopShellBridge />
      </body>
    </html>
  );
}
