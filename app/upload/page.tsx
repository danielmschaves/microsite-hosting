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

export default async function UploadPage({
  searchParams,
}: {
  searchParams: Promise<{ slug?: string }>;
}) {
  const session = await auth();
  const email = session?.user?.email;
  if (!email) redirect("/");

  // /upload?slug=x — the "Edit" buttons land here; publishing to a slug you
  // own creates a new version at the same URL.
  const { slug: slugParam } = await searchParams;
  let editSlug: string | null = null;
  if (slugParam) {
    const owned = await query(
      "SELECT 1 FROM sites WHERE slug = $1 AND deleted_at IS NULL AND lower(owner_email) = $2",
      [slugParam, email.toLowerCase()],
    );
    if (owned.length > 0) editSlug = slugParam;
  }

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
        editSlug={editSlug}
      />
    </>
  );
}
