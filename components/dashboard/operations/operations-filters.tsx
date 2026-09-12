"use client";

import { useEffect, useId, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ChevronDown, Clock3, Loader2, Search, SlidersHorizontal, X } from "lucide-react";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuRadioGroup,
  DropdownMenuRadioItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  operationsHref, parseOperationsFilters,
  type OperationsFilters, type OperationsKind,
} from "@/lib/operations/filters";

const control = "h-10 w-full rounded-xl border border-zinc-800 bg-[#090a0c] px-3 text-sm text-zinc-200 outline-none transition hover:border-zinc-700 focus-visible:border-emerald-500/50 focus-visible:ring-2 focus-visible:ring-emerald-500/20";
type Option = { id: string; name: string };

export default function OperationsFilterBar({ kind, filters, statuses, placeholder }: {
  kind: OperationsKind; filters: OperationsFilters; statuses: Option[]; placeholder: string;
}) {
  const router = useRouter();
  const [state, setState] = useState({ server: filters, draft: filters });
  const [waiting, setWaiting] = useState(false);
  const [pending, startTransition] = useTransition();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const composing = useRef(false);
  const { draft } = state;

  // A completed search must not replace text typed while that request was running.
  if (state.server !== filters) {
    setState({ server: filters, draft: {
      ...filters,
      query: draft.query === state.server.query ? filters.query : draft.query,
      status: draft.status === state.server.status ? filters.status : draft.status,
      days: draft.days === state.server.days ? filters.days : draft.days,
    } });
  }

  useEffect(() => {
    function restoreLocation() {
      if (timer.current) clearTimeout(timer.current);
      timer.current = null;
      setWaiting(false);
      const restored = parseOperationsFilters(Object.fromEntries(new URLSearchParams(window.location.search)), kind);
      setState((current) => ({ ...current, draft: restored }));
    }
    window.addEventListener("popstate", restoreLocation);
    return () => {
      if (timer.current) clearTimeout(timer.current);
      window.removeEventListener("popstate", restoreLocation);
    };
  }, [kind]);

  function cancelSearch() {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    setWaiting(false);
  }

  function navigate(next: OperationsFilters) {
    const href = operationsHref(kind, next, { query: next.query.trim(), page: 1 });
    if (pending || href !== operationsHref(kind, filters)) {
      startTransition(() => router.replace(href, { scroll: false }));
    }
  }

  function change(overrides: Partial<OperationsFilters>, debounce = false) {
    cancelSearch();
    const next = { ...draft, ...overrides, page: 1 };
    setState((current) => ({ ...current, draft: next }));
    if (debounce) {
      setWaiting(true);
      timer.current = setTimeout(() => {
        timer.current = null;
        setWaiting(false);
        navigate(next);
      }, 250);
    } else {
      navigate(next);
    }
  }

  const busy = waiting || pending;
  const filtered = Boolean(draft.query || draft.status !== "all" || filters.page > 1 || (kind === "incidents" && draft.days !== 7));
  return (
    <form action={`/dashboard/${kind}`} method="get" role="search" aria-label={`${kind} filters`}
      onSubmit={(event) => { event.preventDefault(); cancelSearch(); navigate(draft); }}
      className="grid items-end gap-3 border-b border-white/[0.07] p-5 sm:grid-cols-2 xl:flex xl:px-6">
      <input type="hidden" name="source" value={filters.source} />
      <label className="block min-w-0 sm:col-span-2 xl:flex-1">
        <span className="mb-2 block text-xs font-medium text-zinc-400">Search</span>
        <span className="relative block">
          <Search size={15} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-zinc-600" aria-hidden="true" />
          <input ref={input} name="q" value={draft.query} maxLength={100} placeholder={placeholder} autoComplete="off"
            onChange={(event) => {
              const query = event.target.value;
              if (composing.current) setState((current) => ({ ...current, draft: { ...current.draft, query } }));
              else change({ query }, true);
            }}
            onCompositionStart={() => { composing.current = true; cancelSearch(); }}
            onCompositionEnd={(event) => { composing.current = false; change({ query: event.currentTarget.value }, true); }}
            className={`${control} pl-10 pr-10 placeholder:text-zinc-600`} />
          {draft.query && <button type="button" aria-label="Clear search" onClick={() => { change({ query: "" }); input.current?.focus(); }}
            className="absolute right-2 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-md text-zinc-500 outline-none transition hover:bg-zinc-800 hover:text-white focus-visible:ring-2 focus-visible:ring-emerald-500">
            <X size={14} />
          </button>}
        </span>
      </label>
      {kind === "incidents" && <FilterDropdown label="Requested / recorded" name="days" value={String(draft.days)}
        options={[1, 7, 30, 90].map((days) => ({ id: String(days), name: `Last ${days === 1 ? "24 hours" : `${days} days`}` }))}
        icon={<Clock3 size={15} />} onChange={(value) => change({ days: Number(value) })} />}
      {!!statuses.length && <FilterDropdown label="Status" name="status" value={draft.status}
        options={[{ id: "all", name: "All signals" }, ...statuses]}
        icon={<SlidersHorizontal size={15} />} onChange={(value) => change({ status: value })} />}
      <div className="flex h-10 min-w-[112px] items-center gap-3 sm:col-span-2 xl:justify-end">
        {filtered && <button type="button" onClick={() => { change({ query: "", status: "all", days: 7 }); input.current?.focus(); }}
          className="rounded-lg px-2 py-1.5 text-xs text-zinc-400 outline-none transition hover:bg-white/5 hover:text-white focus-visible:ring-2 focus-visible:ring-emerald-500">Reset</button>}
        <span role="status" aria-live="polite" className="inline-flex items-center gap-1.5 text-xs text-zinc-500">
          {busy ? <><Loader2 size={13} aria-hidden="true" className="animate-spin motion-reduce:animate-none" />Updating...</> : <span className="sr-only">Filters applied</span>}
        </span>
      </div>
    </form>
  );
}

function FilterDropdown({ label, name, value, options, icon, onChange }: {
  label: string; name: string; value: string; options: Option[]; icon: React.ReactNode; onChange: (value: string) => void;
}) {
  const id = useId();
  return (
    <div className="min-w-0 xl:w-48">
      <span id={id} className="mb-2 block text-xs font-medium text-zinc-400">{label}</span>
      <input type="hidden" name={name} value={value} />
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button type="button" aria-labelledby={`${id} ${id}-value`}
            className={`${control} group flex items-center gap-2.5 text-left data-[state=open]:border-emerald-500/40 data-[state=open]:bg-[#111518]`}>
            <span aria-hidden="true" className="shrink-0 text-zinc-500 group-data-[state=open]:text-emerald-400">{icon}</span>
            <span id={`${id}-value`} className="flex-1 truncate">{options.find((option) => option.id === value)?.name}</span>
            <ChevronDown size={14} aria-hidden="true" className="shrink-0 text-zinc-500 transition-transform duration-150 group-data-[state=open]:rotate-180 motion-reduce:transition-none" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" sideOffset={6}
          className="w-[var(--radix-dropdown-menu-trigger-width)] min-w-44 rounded-xl border-zinc-800 bg-[#0d0f12] p-1.5 text-zinc-300 shadow-2xl shadow-black/50 duration-150 motion-reduce:animate-none">
          <DropdownMenuRadioGroup aria-labelledby={id} value={value} onValueChange={onChange}>
            {options.map((option) => <DropdownMenuRadioItem key={option.id} value={option.id}
              className="cursor-pointer rounded-lg py-2.5 pr-3 text-sm focus:bg-white/[0.06] focus:text-white data-[state=checked]:bg-emerald-500/10 data-[state=checked]:text-emerald-400">{option.name}</DropdownMenuRadioItem>)}
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
