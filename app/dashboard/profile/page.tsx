"use client";

import { ChangeEvent, useEffect, useState } from "react";
import { Camera, Loader2, Save } from "lucide-react";
import { createClient } from "@/lib/supabase/client";

export default function ProfilePage() {
  const supabase = createClient();

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);

  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);

  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    async function loadUser() {
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) return;

      setEmail(user.email ?? "");

      setName(
        user.user_metadata?.full_name ||
          user.user_metadata?.name ||
          ""
      );

      setAvatarUrl(
        user.user_metadata?.avatar_url || null
      );
    }

    loadUser();
  }, []);

  async function uploadAvatar(
    event: ChangeEvent<HTMLInputElement>
  ) {
    const file = event.target.files?.[0];

    if (!file) return;

    setUploading(true);
    setError("");
    setMessage("");

    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      setError("User not found.");
      setUploading(false);
      return;
    }

    // valida tamanho
    if (file.size > 5 * 1024 * 1024) {
      setError("The image cannot be larger than 5 MB.");
      setUploading(false);
      return;
    }

    const extension = file.name.split(".").pop()?.toLowerCase();

    const filePath = `${user.id}/avatar.${extension}`;

    const { error: uploadError } = await supabase.storage
      .from("avatars")
      .upload(filePath, file, {
        upsert: true,
      });

    if (uploadError) {
      setError(uploadError.message);
      setUploading(false);
      return;
    }

    const {
      data: { publicUrl },
    } = supabase.storage
      .from("avatars")
      .getPublicUrl(filePath);

    // evita cache da foto antiga
    const avatarWithCacheBust =
      `${publicUrl}?t=${Date.now()}`;

    const { error: updateError } =
      await supabase.auth.updateUser({
        data: {
          avatar_url: avatarWithCacheBust,
        },
      });

    if (updateError) {
      setError(updateError.message);
      setUploading(false);
      return;
    }

    setAvatarUrl(avatarWithCacheBust);

    window.dispatchEvent(
    new CustomEvent("sentinelgrid-profile-updated", {
        detail: {
        name,
        email,
        avatarUrl: avatarWithCacheBust,
        },
    })
    );

    setMessage("Profile picture updated successfully.");
    setUploading(false);
  }

  async function saveProfile() {
    setSaving(true);
    setError("");
    setMessage("");

    if (!name.trim()) {
      setError("Display name cannot be empty.");
      setSaving(false);
      return;
    }

    const { error } = await supabase.auth.updateUser({
      data: {
        full_name: name.trim(),
      },
    });

    if (error) {
      setError(error.message);
      setSaving(false);
      return;
    }

    window.dispatchEvent(
        new CustomEvent("sentinelgrid-profile-updated", {
            detail: {
            name: name.trim(),
            email,
            avatarUrl,
            },
        })
    );

    setMessage("Profile updated successfully.");
    setSaving(false);
  }

  const initials =
    name
      .split(" ")
      .filter(Boolean)
      .map((word) => word[0])
      .join("")
      .substring(0, 2)
      .toUpperCase() || "U";

  return (
    <main className="p-8">
      <div className="mx-auto max-w-4xl">

        {/* HEADER */}
        <div className="mb-8">
          <h1 className="text-3xl font-bold">
            Edit profile
          </h1>

          <p className="mt-2 text-zinc-400">
            Manage your personal information and profile picture.
          </p>
        </div>

        {/* PROFILE CARD */}
        <div className="overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-900">

          <div className="border-b border-zinc-800 px-6 py-5">
            <h2 className="text-lg font-semibold">
              Profile information
            </h2>

            <p className="mt-1 text-sm text-zinc-500">
              This information is displayed in your SentinelGrid account.
            </p>
          </div>

          <div className="p-6">

            {/* AVATAR */}
            <div className="mb-8 flex items-center gap-5">

              <div className="relative">

                {avatarUrl ? (
                  <img
                    src={avatarUrl}
                    alt="Profile"
                    className="h-20 w-20 rounded-2xl object-cover"
                  />
                ) : (
                  <div className="flex h-20 w-20 items-center justify-center rounded-2xl bg-zinc-800 text-xl font-semibold">
                    {initials}
                  </div>
                )}

                <label
                  className="
                    absolute -bottom-2 -right-2
                    flex h-8 w-8 cursor-pointer
                    items-center justify-center
                    rounded-lg border border-zinc-700
                    bg-zinc-900
                    transition
                    hover:bg-zinc-800
                  "
                >
                  {uploading ? (
                    <Loader2
                      size={15}
                      className="animate-spin"
                    />
                  ) : (
                    <Camera size={15} />
                  )}

                  <input
                    type="file"
                    accept="image/png,image/jpeg,image/webp"
                    onChange={uploadAvatar}
                    disabled={uploading}
                    className="hidden"
                  />
                </label>

              </div>

              <div>
                <p className="font-medium">
                  Profile picture
                </p>

                <p className="mt-1 text-sm text-zinc-500">
                  JPG, PNG or WebP. Maximum 5 MB.
                </p>
              </div>

            </div>

            {/* DISPLAY NAME */}
            <div className="mb-5">
              <label
                htmlFor="display-name"
                className="mb-2 block text-sm font-medium text-zinc-300"
              >
                Display name
              </label>

              <input
                id="display-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Your name"
                className="
                  w-full rounded-xl
                  border border-zinc-700
                  bg-zinc-950
                  px-4 py-3
                  text-white
                  outline-none
                  transition
                  focus:border-zinc-500
                "
              />
            </div>

            {/* EMAIL */}
            <div className="mb-6">
              <label
                htmlFor="email"
                className="mb-2 block text-sm font-medium text-zinc-300"
              >
                Email
              </label>

              <input
                id="email"
                value={email}
                disabled
                className="
                  w-full cursor-not-allowed
                  rounded-xl
                  border border-zinc-800
                  bg-zinc-950
                  px-4 py-3
                  text-zinc-500
                "
              />

              <p className="mt-2 text-xs text-zinc-600">
                Email changes will be available later.
              </p>
            </div>

            {/* MESSAGES */}
            {message && (
              <div className="mb-5 rounded-xl border border-emerald-900 bg-emerald-950/30 px-4 py-3 text-sm text-emerald-400">
                {message}
              </div>
            )}

            {error && (
              <div className="mb-5 rounded-xl border border-red-900 bg-red-950/30 px-4 py-3 text-sm text-red-400">
                {error}
              </div>
            )}

            {/* SAVE */}
            <div className="flex justify-end">
              <button
                type="button"
                onClick={saveProfile}
                disabled={saving}
                className="
                  flex items-center gap-2
                  rounded-xl
                  bg-white
                  px-5 py-2.5
                  font-medium text-black
                  transition
                  hover:bg-zinc-200
                  disabled:cursor-not-allowed
                  disabled:opacity-50
                "
              >
                {saving ? (
                  <Loader2
                    size={17}
                    className="animate-spin"
                  />
                ) : (
                  <Save size={17} />
                )}

                {saving ? "Saving..." : "Save changes"}
              </button>
            </div>

          </div>
        </div>

      </div>
    </main>
  );
}