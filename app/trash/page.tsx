import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { query } from "@/lib/db";
import { FREE_SITE_LIMIT, FREE_STORAGE_BYTES } from "@/lib/plan";
import { personalTrash, workspaceTrashFor } from "@/lib/trash";
import { AppBar } from "@/components/AppBar";
import { TrashPanel } from "@/components/TrashPanel";

export const dynamic = "force-dynamic";

export default async function TrashPage() {
  const session = await auth();
  const email = session?.user?.email;
  if (!email) redirect("/");

  const [personal, workspaces] = await Promise.all([
    personalTrash(email),
    workspaceTrashFor(email),
  ]);

  const live = await query<{ size_bytes: string }>(
    "SELECT size_bytes FROM sites WHERE owner_email = $1 AND deleted_at IS NULL",
    [email],
  );
  const usedBytes = live.reduce((s, r) => s + Number(r.size_bytes), 0);

  return (
    <>
      <AppBar
        email={email}
        name={session.user?.name}
        active="trash"
        usedBytes={usedBytes}
        siteCount={live.length}
        siteLimit={FREE_SITE_LIMIT}
        storageLimitBytes={FREE_STORAGE_BYTES}
      />
      <TrashPanel personal={personal} workspaces={workspaces} />
    </>
  );
}
