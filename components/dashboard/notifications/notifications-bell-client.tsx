"use client";

import {
  useEffect,
  useRef,
  useState,
  useTransition,
} from "react";

import { useRouter } from "next/navigation";

import {
  Bell,
  Building2,
  Check,
  CheckCheck,
  X,
} from "lucide-react";

import {
  acceptInvitationNotification,
  declineInvitationNotification,
} from "@/app/dashboard/notification-actions";

import type {
  OrganizationInviteNotification,
} from "../../notifications-bell";


export default function NotificationsBellClient({
  invitations,
}: {
  invitations:
    OrganizationInviteNotification[];
}) {
  const router =
    useRouter();


  const containerRef =
    useRef<HTMLDivElement>(
      null
    );


  const [
    open,
    setOpen,
  ] = useState(false);


  const [
    items,
    setItems,
  ] = useState(
    invitations
  );


  const [
    processingToken,
    setProcessingToken,
  ] =
    useState<string | null>(
      null
    );


  const [
    message,
    setMessage,
  ] =
    useState<string | null>(
      null
    );


  const [
    isPending,
    startTransition,
  ] = useTransition();


  /* =========================
     SYNC SERVER DATA
  ========================= */

  useEffect(() => {
    setItems(
      invitations
    );
  }, [invitations]);


  /* =========================
     CLICK OUTSIDE
  ========================= */

  useEffect(() => {
    function handleClickOutside(
      event: MouseEvent
    ) {
      if (
        containerRef.current &&
        !containerRef.current.contains(
          event.target as Node
        )
      ) {
        setOpen(false);
      }
    }


    function handleEscape(
      event: KeyboardEvent
    ) {
      if (
        event.key === "Escape"
      ) {
        setOpen(false);
      }
    }


    document.addEventListener(
      "mousedown",
      handleClickOutside
    );

    document.addEventListener(
      "keydown",
      handleEscape
    );


    return () => {
      document.removeEventListener(
        "mousedown",
        handleClickOutside
      );

      document.removeEventListener(
        "keydown",
        handleEscape
      );
    };
  }, []);


  /* =========================
     ACCEPT
  ========================= */

  function handleAccept(
    invitation:
      OrganizationInviteNotification
  ) {
    setMessage(null);

    setProcessingToken(
      invitation.token
    );


    startTransition(
      async () => {
        const result =
          await acceptInvitationNotification(
            invitation.token
          );


        if (!result.success) {
          setMessage(
            result.error ??
              "Unable to accept invitation."
          );

          setProcessingToken(
            null
          );

          return;
        }


        setItems(
          (current) =>
            current.filter(
              (item) =>
                item.id !==
                invitation.id
            )
        );


        setMessage(
          `Joined ${invitation.organization_name}.`
        );


        setProcessingToken(
          null
        );


        router.refresh();
      }
    );
  }


  /* =========================
     DECLINE
  ========================= */

  function handleDecline(
    invitation:
      OrganizationInviteNotification
  ) {
    setMessage(null);

    setProcessingToken(
      invitation.token
    );


    startTransition(
      async () => {
        const result =
          await declineInvitationNotification(
            invitation.token
          );


        if (!result.success) {
          setMessage(
            result.error ??
              "Unable to decline invitation."
          );

          setProcessingToken(
            null
          );

          return;
        }


        setItems(
          (current) =>
            current.filter(
              (item) =>
                item.id !==
                invitation.id
            )
        );


        setProcessingToken(
          null
        );


        router.refresh();
      }
    );
  }


  const count =
    items.length;


  return (
    <div
      ref={containerRef}
      className="relative"
    >

      {/* BELL */}

      <button
        type="button"
        onClick={() =>
          setOpen(
            (current) =>
              !current
          )
        }
        className="relative flex h-9 w-9 items-center justify-center rounded-lg border border-white/10 bg-white/[0.025] text-zinc-400 transition hover:bg-white/[0.06] hover:text-white"
        aria-label="Notifications"
      >
        <Bell size={17} />


        {count > 0 && (
          <span className="absolute -right-1 -top-1 flex min-h-[17px] min-w-[17px] items-center justify-center rounded-full bg-blue-500 px-1 text-[9px] font-bold text-white">
            {count > 9
              ? "9+"
              : count}
          </span>
        )}

      </button>


      {/* DROPDOWN */}

      {open && (
        <div className="absolute right-0 top-12 z-50 w-[390px] overflow-hidden rounded-xl border border-white/10 bg-[#111317] shadow-2xl">

          {/* HEADER */}

          <div className="flex items-center justify-between border-b border-white/[0.08] px-4 py-3.5">

            <div>

              <h3 className="text-sm font-semibold text-white">
                Notifications
              </h3>

              <p className="mt-0.5 text-[11px] text-zinc-500">
                Updates that need your attention.
              </p>

            </div>


            {count > 0 && (
              <span className="rounded-full border border-blue-500/20 bg-blue-500/10 px-2 py-1 text-[10px] font-medium text-blue-400">
                {count} pending
              </span>
            )}

          </div>


          {/* MESSAGE */}

          {message && (
            <div className="border-b border-white/[0.06] bg-emerald-500/[0.05] px-4 py-2.5 text-xs text-emerald-400">
              {message}
            </div>
          )}


          {/* EMPTY */}

          {count === 0 ? (

            <div className="px-6 py-10 text-center">

              <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-full border border-white/10 bg-white/[0.03]">

                <CheckCheck
                  size={17}
                  className="text-zinc-500"
                />

              </div>

              <p className="text-sm font-medium text-white">
                You&apos;re all caught up
              </p>

              <p className="mt-1 text-xs text-zinc-500">
                No new notifications.
              </p>

            </div>

          ) : (

            <div className="max-h-[430px] overflow-y-auto">

              {items.map(
                (invitation) => {

                  const processing =
                    processingToken ===
                    invitation.token;


                  return (
                    <div
                      key={
                        invitation.id
                      }
                      className="border-b border-white/[0.06] p-4 last:border-b-0"
                    >

                      <div className="flex gap-3">

                        {/* ICON */}

                        <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg border border-blue-500/20 bg-blue-500/10">

                          <Building2
                            size={16}
                            className="text-blue-400"
                          />

                        </div>


                        {/* CONTENT */}

                        <div className="min-w-0 flex-1">

                          <div className="flex items-start justify-between gap-2">

                            <div>

                              <p className="text-sm font-medium text-white">
                                Organization invitation
                              </p>

                              <p className="mt-1 text-xs leading-5 text-zinc-400">
                                You&apos;ve been invited to join{" "}

                                <span className="font-medium text-zinc-200">
                                  {
                                    invitation.organization_name
                                  }
                                </span>

                                {" "}as{" "}

                                <span className="capitalize">
                                  {
                                    invitation.role
                                  }
                                </span>
                                .
                              </p>

                            </div>


                            <span className="flex-shrink-0 rounded border border-yellow-500/20 bg-yellow-500/10 px-1.5 py-0.5 text-[9px] font-medium text-yellow-400">
                              Pending
                            </span>

                          </div>


                          {/* ACTIONS */}

                          <div className="mt-3 flex items-center gap-2">

                            <button
                              type="button"
                              disabled={
                                processing ||
                                isPending
                              }
                              onClick={() =>
                                handleDecline(
                                  invitation
                                )
                              }
                              className="flex h-8 items-center gap-1.5 rounded-md border border-white/10 px-3 text-[11px] font-medium text-zinc-400 transition hover:bg-white/[0.05] hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
                            >
                              <X size={13} />

                              Decline
                            </button>


                            <button
                              type="button"
                              disabled={
                                processing ||
                                isPending
                              }
                              onClick={() =>
                                handleAccept(
                                  invitation
                                )
                              }
                              className="flex h-8 items-center gap-1.5 rounded-md bg-white px-3 text-[11px] font-medium text-black transition hover:bg-zinc-200 disabled:cursor-not-allowed disabled:opacity-40"
                            >
                              <Check
                                size={13}
                              />

                              {processing
                                ? "Processing..."
                                : "Accept"}
                            </button>

                          </div>

                        </div>

                      </div>

                    </div>
                  );
                }
              )}

            </div>

          )}

        </div>
      )}

    </div>
  );
}