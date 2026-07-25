import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { query } from "@/lib/db";
import { getWorkspacesFor } from "@/lib/teams";
import {
  FREE_SITE_LIMIT,
  FREE_STORAGE_BYTES,
  FREE_PLAN,
  planForWorkspace,
  allowedTtlPresets,
} from "@/lib/plan";
import { AppBar } from "@/components/AppBar";
import { UploadForm } from "@/components/UploadForm";

export const dynamic = "force-dynamic";

export default async function UploadPage() {
  const session = await auth();
  const email = session?.user?.email;
  if (!email) redirect("/");

  const rows = await query<{ size_bytes: string }>(
    "SELECT size_bytes FROM sites WHERE owner_email = $1 AND deleted_at IS NULL",
    [email],
  );
  const usedBytes = rows.reduce((s, r) => s + Number(r.size_bytes), 0);
  const workspaces = await getWorkspacesFor(email);

  return (
    <>
      <AppBar
        email={email}
        name={session.user?.name}
        active="sites"
        usedBytes={usedBytes}
        siteCount={rows.length}
        siteLimit={FREE_SITE_LIMIT}
        storageLimitBytes={FREE_STORAGE_BYTES}
      />
      <UploadForm
        workspaces={workspaces.map((w) => {
          const plan = planForWorkspace(w);
          return {
            id: w.id,
            name: w.name,
            plan: plan.id,
            allowedTtls: allowedTtlPresets(plan, w.max_ttl_preset),
          };
        })}
        personalTtls={allowedTtlPresets(FREE_PLAN)}
      />
    </>
  );
}
