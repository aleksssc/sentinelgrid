export function OrganizationSelector({ organizations, selectedId }: { organizations: { id: string; name: string; setup_completed: boolean }[]; selectedId?: string }) {
  const available = organizations.filter((o) => o.setup_completed);
  return <form action="/dashboard/organizations/select" method="post" className="flex flex-wrap items-center gap-2">
    <label htmlFor="organization-selector" className="sr-only">Organization</label>
    <select id="organization-selector" name="organizationId" defaultValue={selectedId ?? ""} required className="max-w-48 rounded-lg border border-surface-edge bg-surface p-2 text-sm text-white">
      <option value="" disabled>Select organization</option>{available.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
    </select><button className="sg-button sg-button-secondary" type="submit">Switch</button>
  </form>;
}
