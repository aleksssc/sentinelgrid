import Link from "next/link";
import type { ReactNode } from "react";
import { ArrowLeft } from "lucide-react";
import { cn } from "@/lib/utils";

export function AdminPageHeader({
  eyebrow,
  title,
  description,
  backHref,
  backLabel,
  badges,
}: {
  eyebrow?: string;
  title: ReactNode;
  description?: ReactNode;
  backHref?: string;
  backLabel?: string;
  badges?: ReactNode;
}) {
  return (
    <header className="sg-admin-page-header">
      {backHref && (
        <Link href={backHref} className="sg-admin-breadcrumb">
          <ArrowLeft size={14} />
          {backLabel ?? "Back"}
        </Link>
      )}

      <div className="sg-admin-page-heading">
        <div className="min-w-0">
          {eyebrow && <p className="sg-admin-eyebrow">{eyebrow}</p>}
          <h1 className="sg-admin-page-title">{title}</h1>
          {description && <div className="sg-admin-page-description">{description}</div>}
        </div>

        {badges && <div className="sg-admin-page-badges">{badges}</div>}
      </div>
    </header>
  );
}

export type AdminMetric = {
  label: string;
  value: ReactNode;
  meta?: ReactNode;
  tone?: "neutral" | "success" | "warning" | "danger" | "info";
};

export function AdminMetricStrip({
  label,
  items,
}: {
  label: string;
  items: AdminMetric[];
}) {
  return (
    <dl className="sg-admin-metric-strip" aria-label={label}>
      {items.map((item) => (
        <div key={item.label} className="sg-admin-metric" data-tone={item.tone ?? "neutral"}>
          <dt>{item.label}</dt>
          <dd>{item.value}</dd>
          {item.meta && <p>{item.meta}</p>}
        </div>
      ))}
    </dl>
  );
}

export function AdminSection({
  title,
  description,
  action,
  children,
  className,
}: {
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("sg-admin-section", className)}>
      <div className="sg-admin-section-header">
        <div className="min-w-0">
          <h2>{title}</h2>
          {description && <p>{description}</p>}
        </div>
        {action && <div className="sg-admin-section-action">{action}</div>}
      </div>
      {children}
    </section>
  );
}

export function AdminDefinitionGrid({
  items,
  columns = 2,
}: {
  items: { label: string; value: ReactNode; mono?: boolean }[];
  columns?: 1 | 2;
}) {
  return (
    <dl className="sg-admin-definition-grid" data-columns={columns}>
      {items.map((item) => (
        <div key={item.label}>
          <dt>{item.label}</dt>
          <dd className={item.mono ? "font-mono" : undefined}>{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}
