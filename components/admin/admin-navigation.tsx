"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Activity,
  ArrowLeft,
  Building2,
  ClipboardList,
  Gauge,
  Menu,
  RadioTower,
  Shield,
  Users,
  X,
} from "lucide-react";
import { useState } from "react";

const groups = [
  {
    label: "Platform",
    items: [["Overview", "/admin", Gauge]],
  },
  {
    label: "Management",
    items: [
      ["Organizations", "/admin/organizations", Building2],
      ["Users", "/admin/users", Users],
    ],
  },
  {
    label: "Operations",
    items: [
      ["Agent Releases", "/admin/agent-releases", RadioTower],
      ["System Health", "/admin/system", Activity],
    ],
  },
  {
    label: "Security",
    items: [["Audit", "/admin/audit", ClipboardList]],
  },
] as const;

function isActive(pathname: string, href: string) {
  if (href === "/admin") return pathname === href;
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function AdminDesktopNavigation({ roleLabel }: { roleLabel: string }) {
  const pathname = usePathname();

  return (
    <aside className="sg-admin-sidebar" aria-label="Platform administration">
      <Link href="/admin" className="sg-admin-brand">
        <span className="sg-admin-brand-mark"><Shield size={18} /></span>
        <span>
          <strong>SentinelGrid</strong>
          <small>Platform Admin</small>
        </span>
      </Link>

      <div className="sg-admin-role">
        <span className="sg-badge-dot" aria-hidden="true" />
        {roleLabel}
      </div>

      <div className="sg-admin-nav-groups">
        {groups.map((group) => (
          <div key={group.label} className="sg-admin-nav-group">
            <p>{group.label}</p>
            <nav>
              {group.items.map(([label, href, Icon]) => (
                <Link
                  key={href}
                  href={href}
                  className="sg-admin-nav-link"
                  aria-current={isActive(pathname, href) ? "page" : undefined}
                >
                  <Icon size={16} />
                  <span>{label}</span>
                </Link>
              ))}
            </nav>
          </div>
        ))}
      </div>

      <div className="sg-admin-sidebar-footer">
        <Link href="/dashboard" className="sg-admin-back">
          <ArrowLeft size={15} />
          Back to SentinelGrid
        </Link>
      </div>
    </aside>
  );
}

export function AdminMobileNavigation({ roleLabel }: { roleLabel: string }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  return (
    <>
      <header className="sg-admin-mobile-header">
        <Link href="/admin" className="sg-admin-mobile-brand" onClick={() => setOpen(false)}>
          <span className="sg-admin-brand-mark"><Shield size={17} /></span>
          <span>
            <strong>SentinelGrid</strong>
            <small>Admin</small>
          </span>
        </Link>

        <div className="sg-admin-mobile-controls">
          <span className="sg-admin-mobile-role">{roleLabel}</span>
          <button
            type="button"
            className="sg-admin-mobile-menu-button"
            aria-label={open ? "Close admin menu" : "Open admin menu"}
            aria-expanded={open}
            onClick={() => setOpen((value) => !value)}
          >
            {open ? <X size={18} /> : <Menu size={18} />}
          </button>
        </div>
      </header>

      {open && (
        <div className="sg-admin-mobile-menu">
          <div className="sg-admin-mobile-menu-inner">
            {groups.map((group) => (
              <div key={group.label} className="sg-admin-mobile-menu-group">
                <p>{group.label}</p>
                <nav>
                  {group.items.map(([label, href, Icon]) => (
                    <Link
                      key={href}
                      href={href}
                      aria-current={isActive(pathname, href) ? "page" : undefined}
                      onClick={() => setOpen(false)}
                    >
                      <Icon size={16} />
                      {label}
                    </Link>
                  ))}
                </nav>
              </div>
            ))}

            <Link href="/dashboard" className="sg-admin-mobile-back" onClick={() => setOpen(false)}>
              <ArrowLeft size={15} />
              Back to SentinelGrid
            </Link>
          </div>
        </div>
      )}
    </>
  );
}
