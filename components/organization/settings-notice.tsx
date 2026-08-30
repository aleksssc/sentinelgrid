"use client";

import {
  useEffect,
  useState,
} from "react";

import {
  CheckCircle2,
} from "lucide-react";

type Props = {
  message: string;
  compact?: boolean;
};

export function SettingsNotice({
  message,
  compact = false,
}: Props) {
  const [
    mounted,
    setMounted,
  ] = useState(true);

  const [
    visible,
    setVisible,
  ] = useState(false);

  useEffect(() => {
    /*
      Pequeno delay para permitir
      a animação de entrada
    */
    const enterTimer =
      window.setTimeout(() => {
        setVisible(true);
      }, 30);

    /*
      Começa fade-out
    */
    const exitTimer =
      window.setTimeout(() => {
        setVisible(false);
      }, 2700);

    /*
      Remove depois da animação
    */
    const removeTimer =
      window.setTimeout(() => {
        setMounted(false);

        const url =
          new URL(
            window.location.href
          );

        url.searchParams.delete(
          "notice"
        );

        window.history.replaceState(
          {},
          "",
          `${url.pathname}${url.search}${url.hash}`
        );
      }, 3000);

    return () => {
      window.clearTimeout(
        enterTimer
      );

      window.clearTimeout(
        exitTimer
      );

      window.clearTimeout(
        removeTimer
      );
    };
  }, [message]);

  if (!mounted) {
    return null;
  }

  const animation =
    visible
      ? "translate-y-0 opacity-100"
      : "-translate-y-1 opacity-0";

  /* =========================
     COMPACT
  ========================= */

  if (compact) {
    return (
      <div
        className={`
          flex
          items-center
          gap-2
          text-sm
          text-emerald-400
          transition-all
          duration-300
          ease-out
          ${animation}
        `}
      >
        <CheckCircle2
          size={16}
          className="shrink-0"
        />

        <span>
          {message}
        </span>
      </div>
    );
  }

  /* =========================
     FULL
  ========================= */

  return (
    <div
      className={`
        flex
        items-center
        gap-2
        border-b
        border-zinc-800
        bg-emerald-500/[0.025]
        px-6
        py-3
        text-sm
        text-emerald-400
        transition-all
        duration-300
        ease-out
        ${animation}
      `}
    >
      <CheckCircle2
        size={16}
        className="shrink-0"
      />

      <span>
        {message}
      </span>
    </div>
  );
}