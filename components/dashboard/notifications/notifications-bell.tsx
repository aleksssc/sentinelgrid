import { createClient } from "@/lib/supabase/server";

import NotificationsBellClient
  from "./notifications-bell-client";


export type OrganizationInviteNotification = {
  id: string;
  token: string;
  organization_id: string;
  organization_name: string;
  role: string;
  created_at: string;
  expires_at: string | null;
};


export default async function NotificationsBell() {
  const supabase =
    await createClient();


  const {
    data: { user },
  } = await supabase.auth.getUser();


  if (!user) {
    return null;
  }


  const {
    data,
    error,
  } = await supabase.rpc(
    "get_my_pending_notifications"
  );


  if (error) {
    console.error(
      "Notifications error:",
      error
    );
  }


  const invitations =
    (data ?? []) as OrganizationInviteNotification[];


  return (
    <NotificationsBellClient
      invitations={invitations}
    />
  );
}