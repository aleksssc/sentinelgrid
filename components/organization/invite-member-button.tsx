"use client";

import {
  useEffect,
  useState,
} from "react";

import {
  Mail,
  ShieldCheck,
  UserPlus,
  X,
} from "lucide-react";


type InviteMemberButtonProps = {
  organizationId: string;

  action: (
    formData: FormData
  ) => void | Promise<void>;
};


export function InviteMemberButton({
  organizationId,
  action,
}: InviteMemberButtonProps) {
  const [open, setOpen] =
    useState(false);


  /* =========================
     ESC CLOSE
  ========================= */

  useEffect(() => {
    function handleEscape(
      event: KeyboardEvent
    ) {
      if (
        event.key === "Escape"
      ) {
        setOpen(false);
      }
    }

    if (open) {
      document.addEventListener(
        "keydown",
        handleEscape
      );
    }

    return () => {
      document.removeEventListener(
        "keydown",
        handleEscape
      );
    };
  }, [open]);


  return (
    <>

      {/* =========================
          OPEN BUTTON
      ========================= */}

      <button
        type="button"
        onClick={() =>
          setOpen(true)
        }
        className="
          inline-flex
          items-center
          gap-2
          rounded-xl
          bg-white
          px-4
          py-2.5
          text-sm
          font-medium
          text-black
          transition
          hover:bg-zinc-200
        "
      >
        <UserPlus size={16} />

        Invite member
      </button>


      {/* =========================
          MODAL
      ========================= */}

      {open && (
        <div
          className="
            fixed
            inset-0
            z-[100]
            flex
            items-center
            justify-center
            bg-black/70
            px-4
            backdrop-blur-sm
          "
          onMouseDown={() =>
            setOpen(false)
          }
        >

          <div
            className="
              w-full
              max-w-md
              overflow-hidden
              rounded-2xl
              border
              border-zinc-800
              bg-[#111317]
              shadow-2xl
              shadow-black/60
            "
            onMouseDown={(
              event
            ) =>
              event.stopPropagation()
            }
          >

            {/* =====================
                HEADER
            ====================== */}

            <div
              className="
                flex
                items-start
                justify-between
                gap-4
                border-b
                border-zinc-800
                px-6
                py-5
              "
            >

              <div className="flex items-start gap-3">

                <div
                  className="
                    flex
                    h-10
                    w-10
                    shrink-0
                    items-center
                    justify-center
                    rounded-xl
                    border
                    border-violet-500/20
                    bg-violet-500/10
                  "
                >
                  <UserPlus
                    size={18}
                    className="text-violet-400"
                  />
                </div>


                <div>

                  <h2 className="font-semibold text-white">
                    Invite member
                  </h2>

                  <p className="mt-1 text-sm leading-5 text-zinc-500">
                    Add someone to this organization and choose their access level.
                  </p>

                </div>

              </div>


              <button
                type="button"
                onClick={() =>
                  setOpen(false)
                }
                className="
                  flex
                  h-8
                  w-8
                  shrink-0
                  items-center
                  justify-center
                  rounded-lg
                  text-zinc-600
                  transition
                  hover:bg-zinc-800
                  hover:text-white
                "
              >
                <X size={17} />
              </button>

            </div>


            {/* =====================
                FORM
            ====================== */}

            <form
              action={action}
            >

              <input
                type="hidden"
                name="organization_id"
                value={
                  organizationId
                }
              />


              <div className="space-y-5 p-6">

                {/* =================
                    EMAIL
                ================== */}

                <div>

                  <label
                    htmlFor="invite-email"
                    className="
                      mb-2
                      block
                      text-sm
                      font-medium
                      text-zinc-300
                    "
                  >
                    Email address
                  </label>


                  <div className="relative">

                    <Mail
                      size={16}
                      className="
                        absolute
                        left-3.5
                        top-1/2
                        -translate-y-1/2
                        text-zinc-600
                      "
                    />

                    <input
                      id="invite-email"
                      name="email"
                      type="email"
                      required
                      autoFocus
                      placeholder="user@example.com"
                      className="
                        w-full
                        rounded-xl
                        border
                        border-zinc-800
                        bg-zinc-950
                        py-3
                        pl-10
                        pr-4
                        text-sm
                        text-white
                        outline-none
                        transition
                        placeholder:text-zinc-700
                        focus:border-violet-500/50
                        focus:ring-2
                        focus:ring-violet-500/10
                      "
                    />

                  </div>

                </div>


                {/* =================
                    ROLE
                ================== */}

                <div>

                  <label
                    htmlFor="invite-role"
                    className="
                      mb-2
                      block
                      text-sm
                      font-medium
                      text-zinc-300
                    "
                  >
                    Role
                  </label>


                  <div className="relative">

                    <ShieldCheck
                      size={16}
                      className="
                        pointer-events-none
                        absolute
                        left-3.5
                        top-1/2
                        -translate-y-1/2
                        text-zinc-600
                      "
                    />

                  <select
                    id="invite-role"
                    name="role"
                    defaultValue="member"
                    className="
                      w-full
                      appearance-none
                      rounded-xl
                      border
                      border-zinc-800
                      bg-zinc-950
                      py-3
                      pl-10
                      pr-10
                      text-sm
                      text-white
                      outline-none
                      transition
                      focus:border-violet-500/50
                      focus:ring-2
                      focus:ring-violet-500/10
                    "
                  >
                    <option value="member">
                      Member
                    </option>

                    <option value="admin">
                      Admin
                    </option>
                  </select>

                  </div>


                  <p className="mt-2 text-xs leading-5 text-zinc-600">
                    Members get standard access. Admins have elevated management permissions.
                  </p>

                </div>

              </div>


              {/* =====================
                  FOOTER
              ====================== */}

              <div
                className="
                  flex
                  items-center
                  justify-end
                  gap-3
                  border-t
                  border-zinc-800
                  bg-zinc-950/30
                  px-6
                  py-4
                "
              >

                <button
                  type="button"
                  onClick={() =>
                    setOpen(false)
                  }
                  className="
                    rounded-lg
                    px-4
                    py-2.5
                    text-sm
                    font-medium
                    text-zinc-500
                    transition
                    hover:bg-zinc-800
                    hover:text-white
                  "
                >
                  Cancel
                </button>


                <button
                  type="submit"
                  className="
                    inline-flex
                    items-center
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
                  "
                >
                  <UserPlus
                    size={15}
                  />

                  Send invite
                </button>

              </div>

            </form>

          </div>

        </div>
      )}

    </>
  );
}