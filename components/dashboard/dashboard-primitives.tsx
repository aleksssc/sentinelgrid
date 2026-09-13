import type { ComponentProps, ReactNode } from "react";
import { cn } from "@/lib/utils";

export function PageHeader({ title, description, eyebrow, icon, actions, badge, compact = false }: {
  title: ReactNode;
  badge?: ReactNode;
  compact?: boolean;
  description?: ReactNode;
  eyebrow?: ReactNode;
  icon?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header className={compact ? "sg-organization-header" : "sg-page-header"}>
      <div className={compact ? "sg-organization-heading" : "flex min-w-0 items-start gap-4"}>
        {icon && <span className={compact ? "sg-client-icon" : "sg-page-icon"} aria-hidden="true">{icon}</span>}
        <div className="min-w-0">
          {eyebrow && <p className="sg-eyebrow">{eyebrow}</p>}
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2"><h1 className="sg-page-title">{title}</h1>{badge}</div>
          {description && <p className="sg-page-description">{description}</p>}
        </div>
      </div>
      {actions && <div className="sg-page-actions">{actions}</div>}
    </header>
  );
}

export function Surface({ className, ...props }: ComponentProps<"section">) {
  return <section className={cn("sg-surface", className)} {...props} />;
}

export function SectionHeader({ title, description, icon, actions, level = 2 }: {
  title: ReactNode;
  description?: ReactNode;
  icon?: ReactNode;
  actions?: ReactNode;
  level?: 2 | 3;
}) {
  const Heading = level === 3 ? "h3" : "h2";
  return (
    <div className="sg-panel-header">
      <div className="flex min-w-0 items-start gap-3">
        {icon && <span className="sg-section-icon" aria-hidden="true">{icon}</span>}
        <div className="min-w-0">
          <Heading className="sg-section-title">{title}</Heading>
          {description && <p className="sg-section-description">{description}</p>}
        </div>
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

const statTones = {
  neutral: "text-zinc-400",
  success: "text-emerald-400",
  warning: "text-amber-400",
  danger: "text-red-400",
  info: "text-sky-400",
};

export function StatCard({ label, value, icon, description, tone = "neutral" }: {
  label: string;
  value: ReactNode;
  icon: ReactNode;
  description?: ReactNode;
  tone?: keyof typeof statTones;
}) {
  return (
    <div className="sg-surface sg-stat">
      <div className="flex items-center justify-between gap-3">
        <p className="sg-stat-label">{label}</p>
        <span className={cn("sg-stat-icon", statTones[tone])} aria-hidden="true">{icon}</span>
      </div>
      <p className="sg-stat-value">{value}</p>
      {description && <p className="sg-meta mt-2">{description}</p>}
    </div>
  );
}

export function EmptyState({ title, description, icon, action, className }: {
  title: string;
  description: ReactNode;
  icon: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("sg-empty", className)}>
      <span className="sg-empty-icon" aria-hidden="true">{icon}</span>
      <h3 className="sg-section-title">{title}</h3>
      <p className="sg-section-description mx-auto max-w-md">{description}</p>
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

export function CompactSummary({ label, items }: {
  label: string;
  items: { label: string; value: ReactNode; icon: ReactNode; tone?: "neutral" | "success" | "warning" | "danger" }[];
}) {
  return <dl aria-label={label} className="sg-compact-summary">
    {items.map((item) => <div key={item.label}>
      <dt><span aria-hidden="true">{item.icon}</span>{item.label}</dt>
      <dd className="sg-semantic-text" data-tone={item.tone ?? "neutral"}>{item.value}</dd>
    </div>)}
  </dl>;
}
