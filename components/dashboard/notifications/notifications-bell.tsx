import { createClient } from "@/lib/supabase/server";
import NotificationsBellClient from "./notifications-bell-client";
export type OrganizationInviteNotification = {
  id: string; token: string; organization_id: string; organization_name: string;
  role: string; created_at: string; expires_at: string | null;
};
export type BillingNotification = { id: string; title: string; message: string | null; resource_id: string; created_at: string };
export default async function NotificationsBell() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const [{ data, error }, { data: billing, error: billingError }] = await Promise.all([
    supabase.rpc("get_my_pending_notifications"),
    supabase.from("notifications").select("id,title,message,resource_id,created_at").eq("user_id", user.id).eq("read", false).like("type", "billing.%").order("created_at", { ascending: false }).limit(20).returns<BillingNotification[]>(),
  ]);
  if (error) console.error("Invitation notifications failed", error);
  if (billingError) console.error("Billing notifications failed", billingError);
  return <NotificationsBellClient invitations={(data ?? []) as OrganizationInviteNotification[]} billingNotifications={billing ?? []} />;
}
