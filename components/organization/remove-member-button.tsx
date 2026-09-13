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
        className="sg-button sg-button-danger-solid sg-button-sm text-red-400"
      >
        <UserMinus size={13} />

        Remove
      </button>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-2">

      <span className="text-xs text-surface-muted">
        Remove {memberName}?
      </span>

      <button
        type="button"
        disabled={loading}
        onClick={() =>
          setConfirming(false)
        }
        className="sg-button sg-button-ghost sg-button-sm text-surface-muted disabled:opacity-50"
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
          className="sg-button sg-button-danger-solid sg-button-sm disabled:cursor-not-allowed disabled:opacity-50"
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