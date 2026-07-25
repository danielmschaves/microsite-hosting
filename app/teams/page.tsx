import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { query } from "@/lib/db";
import { getWorkspacesFor } from "@/lib/teams";
import { FREE_SITE_LIMIT, FREE_STORAGE_BYTES } from "@/lib/plan";
import { AppBar } from "@/components/AppBar";
import { TeamsList } from "@/components/TeamsList";

export const dynamic = "force-dynamic";

export default async function TeamsPage() {
  const session = await auth();
  const email = session?.user?.email;
  if (!email) redirect("/");

  const workspaces = await getWorkspacesFor(email);

  const rows = await query<{ size_bytes: string }>(
    "SELECT size_bytes FROM sites WHERE owner_email = $1 AND deleted_at IS NULL",
    [email],
  );
  const usedBytes = rows.reduce((s, r) => s + Number(r.size_bytes), 0);

  return (
    <>
      <AppBar
        email={email}
        name={session.user?.name}
        active="teams"
        usedBytes={usedBytes}
        siteCount={rows.length}
        siteLimit={FREE_SITE_LIMIT}
        storageLimitBytes={FREE_STORAGE_BYTES}
      />
      <TeamsList
        workspaces={workspaces.map((w) => ({
          id: w.id,
          name: w.name,
          plan: w.plan,
          myRole: w.my_role,
          memberCount: w.member_count,
        }))}
      />
    </>
  );
}
