"use client";

import { useFormStatus } from "react-dom";
import { Loader2 } from "lucide-react";

export function OrganizationSubmitButton() {
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      disabled={pending}
      className="sg-button sg-button-primary min-w-44 disabled:cursor-not-allowed disabled:opacity-60"
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