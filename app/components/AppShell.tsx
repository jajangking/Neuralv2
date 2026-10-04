"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { IconBrush, IconCpu, IconSteering } from "./icons";

function Logo() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="5" cy="6" r="2.6" fill="currentColor" />
      <circle cx="5" cy="18" r="2.6" fill="currentColor" />
      <circle cx="12" cy="12" r="2.6" fill="currentColor" />
      <circle cx="19" cy="7" r="2.6" fill="currentColor" />
      <circle cx="19" cy="17" r="2.6" fill="currentColor" />
      <path
        d="M7.4 7.2 9.7 10.7M7.4 16.8l2.3-3.5M14.3 10.8l2.4-2.3M14.3 13.2l2.4 2.3"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        opacity="0.75"
      />
    </svg>
  );
}

const NAV = [
  { href: "/", label: "AI", Icon: IconCpu },
  { href: "/manual", label: "Manual", Icon: IconSteering },
  { href: "/draw", label: "Editor", Icon: IconBrush },
];

export default function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();

  return (
    <div className="shell">
      <header className="header">
        <Link href="/" className="brand" aria-label="Neural Drive">
          <span className="brand-mark">
            <Logo />
          </span>
          <span className="brand-text">
            <strong>Neural Drive</strong>
            <span>Swakendali</span>
          </span>
        </Link>

        <nav className="nav" aria-label="Navigasi utama">
          {NAV.map(({ href, label, Icon }) => {
            const active = href === "/" ? pathname === "/" || pathname === "/ai" : pathname.startsWith(href);
            return (
              <Link
                key={href}
                href={href}
                className={`nav-link${active ? " is-active" : ""}`}
                aria-current={active ? "page" : undefined}
              >
                <Icon size={14} />
                <span>{label}</span>
              </Link>
            );
          })}
        </nav>

        <div className="header-meta">
          <span className="chip is-accent">
            <i className="dot is-live" />
            5-8-2 MLP
          </span>
        </div>
      </header>

      <main className="main">{children}</main>
    </div>
  );
}