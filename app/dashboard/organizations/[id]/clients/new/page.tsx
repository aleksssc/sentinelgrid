"use client";

import { useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";

import { createClient } from "@/lib/supabase/client";

import {
  ArrowLeft,
  Building2,
  Plus,
} from "lucide-react";

export default function NewClientPage() {
  const router = useRouter();
  const params = useParams();

  const organizationId = params.id as string;

  const supabase = createClient();

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(
    e: React.FormEvent<HTMLFormElement>
  ) {
    e.preventDefault();

    setError("");

    if (!name.trim()) {
      setError("Client name is required.");
      return;
    }

    setLoading(true);

    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();

    if (userError || !user) {
      setError("You must be logged in.");
      setLoading(false);
      return;
    }

    const { data, error: insertError } =
      await supabase
        .from("clients")
        .insert({
          organization_id: organizationId,
          name: name.trim(),
          description:
            description.trim() || null,
          created_by: user.id,
        })
        .select()
        .single();

    if (insertError) {
      console.error(insertError);

      if (insertError.code === "23505") {
        setError(
          "A client with this name already exists in this organization."
        );
      } else {
        setError("Could not create client.");
      }

      setLoading(false);
      return;
    }

    router.push(
      `/dashboard/organizations/${organizationId}/clients/${data.id}`
    );
  }

  return (
    <div className="sg-page-shell">
      <div className="sg-page">

        {/* BACK */}

        <Link
          href={`/dashboard/organizations/${organizationId}`}
          className="mb-6 inline-flex items-center gap-2 text-sm text-surface-muted transition hover:text-white"
        >
          <ArrowLeft size={16} />
          Back to organization
        </Link>

        {/* HEADER */}

        <div className="mb-8 flex items-start gap-4">

          <div className="flex h-12 w-12 items-center justify-center rounded-xl border border-surface-edge bg-surface text-zinc-400">
            <Building2 size={22} />
          </div>

          <div>
            <h1 className="sg-page-title">
              Create client
            </h1>

            <p className="mt-2 text-zinc-400">
              Add a new client to this organization.
            </p>
          </div>

        </div>

        {/* FORM CARD */}

        <form
          onSubmit={handleSubmit}
          className="sg-surface overflow-hidden"
        >

          <div className="border-b border-surface-edge px-6 py-5">

            <h2 className="sg-section-title">
              Client information
            </h2>

            <p className="mt-1 text-sm text-surface-muted">
              Basic information used to identify this client.
            </p>

          </div>

          <div className="space-y-6 p-6">

            {/* NAME */}

            <div>
              <label
                htmlFor="name"
                className="mb-2 block text-sm font-medium text-zinc-300"
              >
                Client name
              </label>

              <input
                id="name"
                type="text"
                placeholder="Example: Royal Óbidos"
                value={name}
                onChange={(e) =>
                  setName(e.target.value)
                }
                autoFocus
                className="sg-control w-full px-4 py-3"
              />

              <p className="mt-2 text-xs text-surface-muted">
                This name will appear throughout SentinelGrid.
              </p>
            </div>

            {/* DESCRIPTION */}

            <div>
              <label
                htmlFor="description"
                className="mb-2 block text-sm font-medium text-zinc-300"
              >
                Description
              </label>

              <textarea
                id="description"
                placeholder="Optional description..."
                value={description}
                onChange={(e) =>
                  setDescription(e.target.value)
                }
                rows={5}
                className="sg-control w-full resize-none px-4 py-3"
              />

              <p className="mt-2 text-xs text-surface-muted">
                You can use this field for notes or context about the client.
              </p>
            </div>

            {/* ERROR */}

            {error && (
              <div className="rounded-xl border border-red-900/50 bg-red-950/30 px-4 py-3 text-sm text-red-400">
                {error}
              </div>
            )}

          </div>

          {/* ACTIONS */}

          <div className="flex items-center justify-end gap-3 border-t border-surface-edge px-6 py-5">

            <Link
              href={`/dashboard/organizations/${organizationId}`}
              className="sg-button sg-button-secondary"
            >
              Cancel
            </Link>

            <button
              type="submit"
              disabled={loading}
              className="sg-button sg-button-primary disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Plus size={16} />

              {loading
                ? "Creating..."
                : "Create client"}
            </button>

          </div>

        </form>

      </div>
    </div>
  );
}