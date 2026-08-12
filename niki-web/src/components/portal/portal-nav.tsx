"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const items = [
  { href: "/dashboard", label: "Resumen", index: "01" },
  { href: "/usage", label: "Uso", index: "02" },
  { href: "/credits", label: "Créditos", index: "03" },
  { href: "/conversations", label: "Conversaciones", index: "04" },
  { href: "/devices", label: "Dispositivos", index: "05" },
  { href: "/settings", label: "Privacidad", index: "06" },
] as const;

export function PortalNav() {
  const pathname = usePathname();

  return (
    <nav className="portal-nav" aria-label="Portal personal">
      {items.map((item) => {
        const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
        return (
          <Link key={item.href} href={item.href} aria-current={active ? "page" : undefined}>
            <span aria-hidden="true">{item.index}</span>
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
