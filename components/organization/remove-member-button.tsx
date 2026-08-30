"use client";

import { useState } from "react";
import {
  Loader2,
  UserMinus,
} from "lucide-react";

type RemoveMemberButtonProps = {
  memberName: string;
  memberId: string;
  organizationId: string;

  action: (
    formData: FormData
  ) => void | Promise<void>;
};

export function RemoveMemberButton({
  memberName,
  memberId,
  organizationId,
  action,
}: RemoveMemberButtonProps) {
  const [confirming, setConfirming] =
    useState(false);

  const [loading, setLoading] =
    useState(false);

  if (!confirming) {
    return (
      <button
        type="button"
        onClick={() =>
          setConfirming(true)
        }
        className="
          flex
          h-8
          items-center
          gap-1.5
          rounded-lg
          border
          border-red-500/20
          bg-red-500/[0.05]
          px-3
          text-xs
          font-medium
          text-red-400
          transition
          hover:bg-red-500/10
          hover:border-red-500/30
        "
      >
        <UserMinus size={13} />

        Remove
      </button>
    );
  }

  return (
    <div className="flex items-center gap-2">

      <span className="text-xs text-zinc-500">
        Remove {memberName}?
      </span>

      <button
        type="button"
        disabled={loading}
        onClick={() =>
          setConfirming(false)
        }
        className="
          rounded-lg
          px-2.5
          py-1.5
          text-xs
          text-zinc-500
          transition
          hover:bg-zinc-800
          hover:text-white
          disabled:opacity-50
        "
      >
        Cancel
      </button>

      <form
        action={action}
        onSubmit={() =>
          setLoading(true)
        }
      >
        <input
          type="hidden"
          name="organization_id"
          value={organizationId}
        />

        <input
          type="hidden"
          name="member_id"
          value={memberId}
        />

        <button
          type="submit"
          disabled={loading}
          className="
            flex
            items-center
            gap-1.5
            rounded-lg
            bg-red-500
            px-3
            py-1.5
            text-xs
            font-medium
            text-white
            transition
            hover:bg-red-600
            disabled:cursor-not-allowed
            disabled:opacity-50
          "
        >
          {loading ? (
            <>
              <Loader2
                size={13}
                className="animate-spin"
              />

              Removing...
            </>
          ) : (
            <>
              <UserMinus size={13} />

              Confirm
            </>
          )}
        </button>
      </form>

    </div>
  );
}