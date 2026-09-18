"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type ElementType } from "react";
import { usePathname } from "next/navigation";
import { BrandLogo } from "@/components/brand-logo";
import { useAppearance } from "@/components/dashboard/appearance-provider";
import { LayoutDashboard, Activity, Building2, Globe2, TriangleAlert, Bell, Bot, Wrench, ChevronRight, Menu, X, PanelLeftClose, PanelLeftOpen } from "lucide-react";

const operations = [
  { name: "Incidents", href: "/dashboard/incidents", icon: TriangleAlert },
  { name: "Alerts", href: "/dashboard/alerts", icon: Bell },
  { name: "Agents", href: "/dashboard/agents", icon: Bot },
];
const utilities = [{ name: "Tools", href: "/dashboard/tools", icon: Wrench }];

type SidebarLink = { name: string; href: string; icon: ElementType; exact?: boolean };

export default function DashboardSidebar({ organizationId }: { organizationId: string }) {
  const pathname = usePathname();
  const { preferences, toggleSidebar, ready } = useAppearance();
  const expanded =
  preferences.rememberSidebar
    ? preferences.sidebarExpanded
    : preferences.sidebar === "expanded";
  const [mobileOpen, setMobileOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const wasMobileOpen = useRef(false);

  useEffect(() => { setMobileOpen(false); }, [pathname]);

  useEffect(() => {
    const media = window.matchMedia("(min-width: 1024px)");
    function closeOnDesktop() { if (media.matches) setMobileOpen(false); }
    media.addEventListener("change", closeOnDesktop);
    return () => media.removeEventListener("change", closeOnDesktop);
  }, []);

  useEffect(() => {
    const root = document.documentElement;
    if (!mobileOpen) {
      delete root.dataset.sgMobileNavigation;
      if (wasMobileOpen.current) trigger.current?.focus({ preventScroll: true });
      wasMobileOpen.current = false;
      return;
    }

    root.dataset.sgMobileNavigation = "open";
    wasMobileOpen.current = true;
    const focusFrame = window.requestAnimationFrame(() => closeButton.current?.focus({ preventScroll: true }));
    function onKeyDown(event: KeyboardEvent) { if (event.key === "Escape") setMobileOpen(false); }
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.cancelAnimationFrame(focusFrame);
      window.removeEventListener("keydown", onKeyDown);
      delete root.dataset.sgMobileNavigation;
    };
  }, [mobileOpen]);

  const navigation: SidebarLink[] = [
    { name: "Overview", href: "/dashboard", icon: LayoutDashboard, exact: true },
    { name: "Clients", href: `/dashboard/organizations/${organizationId}`, icon: Building2 },
    { name: "Monitors", href: "/dashboard/monitors", icon: Activity },
    { name: "Domains & DNS", href: "/dashboard/domains", icon: Globe2 },
  ];

  function renderLink({ name, href, icon: Icon, exact }: SidebarLink) {
    const active = name === "Clients" ? pathname.startsWith("/dashboard/organizations/") : exact ? pathname === href : pathname === href || pathname.startsWith(`${href}/`);
    return <div key={name} className="sg-sidebar-item" data-active={active || undefined}>
      <Link prefetch={false} href={href} aria-label={name} title={name} aria-current={active ? "page" : undefined} onClick={() => setMobileOpen(false)} className="sg-sidebar-link group">
        <Icon size={18} strokeWidth={active ? 2 : 1.75} aria-hidden="true" />
        <span className="sg-sidebar-label flex-1">{name}</span>
        <ChevronRight size={14} className="sg-sidebar-chevron" aria-hidden="true" />
      </Link>
    </div>;
  }

  function content(mobile: boolean) {
    return <>
      <div className="sg-sidebar-brand">
        <Link prefetch={false} href="/dashboard" aria-label="SentinelGrid overview" onClick={() => setMobileOpen(false)}>
          <BrandLogo variant="mark" className="sg-sidebar-mark" />
          <BrandLogo variant="lockup" className="sg-sidebar-lockup" />
        </Link>
        {mobile && <button ref={closeButton} type="button" className="sg-button sg-button-ghost sg-button-icon" aria-label="Close navigation" onClick={() => setMobileOpen(false)}><X size={18} /></button>}
      </div>
      <div className="sg-sidebar-navigation">
        {([{ label: "Workspace", links: navigation }, { label: "Operations", links: operations }, { label: "Utilities", links: utilities }]).map(({ label, links }) => <div key={label} className="sg-sidebar-group">
          <p className="sg-sidebar-section">{label}</p>
          <nav aria-label={label} className="space-y-1">{links.map(renderLink)}</nav>
        </div>)}
      </div>
      {!mobile && <div className="sg-sidebar-footer"><button type="button" disabled={!ready} className="sg-sidebar-link w-full" onClick={toggleSidebar} title={expanded ? "Collapse sidebar" : "Expand sidebar"} aria-label={expanded ? "Collapse sidebar" : "Expand sidebar"} aria-expanded={expanded}>
        {expanded ? <PanelLeftClose size={18} /> : <PanelLeftOpen size={18} />}<span className="sg-sidebar-label">Collapse sidebar</span>
      </button></div>}
    </>;
  }

  return <>
    <aside className="sg-sidebar sg-desktop-sidebar" aria-label="Main navigation">{content(false)}</aside>
    <button ref={trigger} type="button" className="sg-mobile-menu-trigger sg-button sg-button-ghost sg-button-icon" aria-label="Open navigation" aria-expanded={mobileOpen} aria-controls="dashboard-mobile-navigation" aria-haspopup="dialog" onClick={() => setMobileOpen(true)}><Menu size={20} /></button>
    {mobileOpen && <div id="dashboard-mobile-navigation" className="sg-mobile-navigation" role="dialog" aria-modal="true" aria-label="Main navigation" onMouseDown={(event) => { if (event.target === event.currentTarget) setMobileOpen(false); }}>
      <aside className="sg-sidebar sg-mobile-sidebar">{content(true)}</aside>
    </div>}
  </>;
}
