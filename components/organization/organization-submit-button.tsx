"use client";

import { useFormStatus } from "react-dom";
import { Loader2 } from "lucide-react";

export function OrganizationSubmitButton() {
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      disabled={pending}
      className="
        inline-flex
        min-w-44
        items-center
        justify-center
        gap-2
        rounded-lg
        bg-white
        px-4
        py-2.5
        text-sm
        font-medium
        text-black
        transition
        hover:bg-zinc-200
        disabled:cursor-not-allowed
        disabled:opacity-60
      "
    >
      {pending ? (
        <>
          <Loader2
            size={16}
            className="animate-spin"
          />

          Creating...
        </>
      ) : (
        "Create organization"
      )}
    </button>
  );
}