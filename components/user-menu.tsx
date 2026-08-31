"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import {
  ChevronDown,
  LogOut,
  CreditCard,
  UserRound,
  Loader2,
} from "lucide-react";

import { createClient } from "@/lib/supabase/client";

export function UserMenu() {
  const router = useRouter();
  const supabase = createClient();

  const menuRef = useRef<HTMLDivElement>(null);

  const [open, setOpen] = useState(false);

  const [email, setEmail] = useState("");
  const [name, setName] = useState("");

  const [avatarUrl, setAvatarUrl] =
    useState<string | null>(null);

  const [plan, setPlan] = useState("Free");

  const [loading, setLoading] = useState(true);

  const [loggingOut, setLoggingOut] =
    useState(false);


  // =========================================
  // LOAD USER + BILLING PLAN
  // =========================================

  useEffect(() => {
    async function loadUser() {
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) {
        setLoading(false);
        return;
      }

      setEmail(
        user.email ?? ""
      );

      setName(
        user.user_metadata?.full_name ||
          user.user_metadata?.name ||
          user.email?.split("@")[0] ||
          "User"
      );

      setAvatarUrl(
        user.user_metadata?.avatar_url ||
          user.user_metadata?.picture ||
          null
      );


      // =====================================
      // LOAD SUBSCRIPTION
      // =====================================

      const {
        data: subscription,
      } = await supabase
        .from("account_subscriptions")
        .select("plan")
        .eq(
          "user_id",
          user.id
        )
        .maybeSingle();


      if (subscription?.plan) {
        setPlan(
          subscription.plan
            .charAt(0)
            .toUpperCase() +
            subscription.plan.slice(1)
        );
      } else {
        setPlan("Free");
      }


      setLoading(false);
    }


    loadUser();

  }, [supabase]);


  // =========================================
  // PROFILE UPDATE EVENT
  // =========================================

  useEffect(() => {
    function handleProfileUpdated(
      event: Event
    ) {

      const customEvent =
        event as CustomEvent<{
          name?: string;
          email?: string;
          avatarUrl?: string | null;
        }>;


      const data =
        customEvent.detail;


      if (
        data.name !==
        undefined
      ) {
        setName(
          data.name
        );
      }


      if (
        data.email !==
        undefined
      ) {
        setEmail(
          data.email
        );
      }


      if (
        data.avatarUrl !==
        undefined
      ) {
        setAvatarUrl(
          data.avatarUrl
        );
      }

    }


    window.addEventListener(
      "sentinelgrid-profile-updated",
      handleProfileUpdated
    );


    return () => {

      window.removeEventListener(
        "sentinelgrid-profile-updated",
        handleProfileUpdated
      );

    };

  }, []);


  // =========================================
  // CLICK OUTSIDE + ESCAPE
  // =========================================

  useEffect(() => {

    function handleClickOutside(
      event: MouseEvent
    ) {

      if (
        menuRef.current &&
        !menuRef.current.contains(
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
        event.key ===
        "Escape"
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


  // =========================================
  // LOGOUT
  // =========================================

  async function handleLogout() {

    setLoggingOut(true);

    await supabase
      .auth
      .signOut();

    router.push(
      "/auth/login"
    );

    router.refresh();

  }


  // =========================================
  // INITIALS
  // =========================================

  const initials =
    name
      .split(" ")
      .map(
        word =>
          word[0]
      )
      .join("")
      .substring(0, 2)
      .toUpperCase() ||
    "U";


  // =========================================
  // LOADING
  // =========================================

  if (loading) {

    return (

      <div className="
        flex
        h-10
        items-center
        gap-2
        px-2
        text-zinc-500
      ">

        <Loader2
          size={16}
          className="animate-spin"
        />

        <span className="text-xs">
          Loading...
        </span>

      </div>

    );

  }


  // =========================================
  // RENDER
  // =========================================

  return (

    <div
      ref={menuRef}
      className="relative"
    >

      {/* =====================================
          USER BUTTON
      ===================================== */}

      <button
        type="button"
        onClick={() =>
          setOpen(
            current =>
              !current
          )
        }
        className="
          flex
          h-11
          max-w-[270px]
          items-center
          gap-3
          rounded-xl
          border
          border-transparent
          px-2.5
          text-left
          outline-none
          transition
          hover:border-zinc-800
          hover:bg-zinc-900
          focus-visible:border-zinc-700
        "
      >

        {/* AVATAR */}

        {avatarUrl ? (

          <div
            className="
              h-8
              w-8
              shrink-0
              rounded-lg
              bg-cover
              bg-center
            "
            style={{
              backgroundImage:
                `url("${avatarUrl}")`,
            }}
          />

        ) : (

          <div className="
            flex
            h-8
            w-8
            shrink-0
            items-center
            justify-center
            rounded-lg
            bg-zinc-800
            text-xs
            font-semibold
            text-white
          ">
            {initials}
          </div>

        )}


        {/* NAME + PLAN */}

        <div className="
          min-w-0
          flex-1
        ">

          <p className="
            truncate
            text-sm
            font-medium
            text-white
          ">
            {name}
          </p>


          <p className="
            truncate
            text-[11px]
            text-zinc-500
          ">
            {plan} Plan
          </p>

        </div>


        <ChevronDown
          size={15}
          className={`
            shrink-0
            text-zinc-500
            transition-transform
            ${
              open
                ? "rotate-180"
                : ""
            }
          `}
        />

      </button>



      {/* =====================================
          DROPDOWN
      ===================================== */}

      {open && (

        <div
          className="
            absolute
            right-0
            top-full
            z-50
            mt-2
            w-64
            overflow-hidden
            rounded-xl
            border
            border-zinc-800
            bg-zinc-900
            shadow-2xl
            shadow-black/50
          "
        >

          {/* =================================
              USER INFO
          ================================= */}

          <div className="
            border-b
            border-zinc-800
            px-4
            py-4
          ">

            <div className="
              flex
              items-center
              justify-between
              gap-3
            ">

              <p className="
                truncate
                text-sm
                font-semibold
                text-white
              ">
                {name}
              </p>


              <span className="
                shrink-0
                rounded-md
                border
                border-zinc-700
                bg-zinc-800
                px-2
                py-0.5
                text-[10px]
                font-semibold
                uppercase
                tracking-wide
                text-zinc-300
              ">
                {plan}
              </span>

            </div>


            <p className="
              mt-1
              truncate
              text-xs
              text-zinc-500
            ">
              {email}
            </p>

          </div>



          {/* =================================
              ACTIONS
          ================================= */}

          <div className="p-1.5">

            {/* PROFILE */}

            <button
              type="button"
              onClick={() => {

                setOpen(false);

                router.push(
                  "/dashboard/profile"
                );

              }}
              className="
                flex
                w-full
                items-center
                gap-3
                rounded-lg
                px-3
                py-2.5
                text-sm
                text-zinc-300
                transition
                hover:bg-zinc-800
                hover:text-white
              "
            >

              <UserRound
                size={17}
              />

              Edit profile

            </button>


            {/* BILLING */}

            <button
              type="button"
              onClick={() => {

                setOpen(false);

                router.push(
                  "/dashboard/billing"
                );

              }}
              className="
                flex
                w-full
                items-center
                gap-3
                rounded-lg
                px-3
                py-2.5
                text-sm
                text-zinc-300
                transition
                hover:bg-zinc-800
                hover:text-white
              "
            >

              <CreditCard
                size={17}
              />

              Billing

            </button>

          </div>



          {/* =================================
              SIGN OUT
          ================================= */}

          <div className="
            border-t
            border-zinc-800
            p-1.5
          ">

            <button
              type="button"
              onClick={
                handleLogout
              }
              disabled={
                loggingOut
              }
              className="
                flex
                w-full
                items-center
                gap-3
                rounded-lg
                px-3
                py-2.5
                text-sm
                text-red-400
                transition
                hover:bg-red-500/10
                disabled:cursor-not-allowed
                disabled:opacity-50
              "
            >

              {loggingOut ? (

                <Loader2
                  size={17}
                  className="
                    animate-spin
                  "
                />

              ) : (

                <LogOut
                  size={17}
                />

              )}


              {loggingOut
                ? "Signing out..."
                : "Sign out"}

            </button>

          </div>

        </div>

      )}

    </div>

  );
}