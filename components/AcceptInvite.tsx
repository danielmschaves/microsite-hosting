"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check } from "lucide-react";

export function AcceptInvite({ token }: { token: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function accept() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/invites/${token}`, { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) setError(data.error || "Failed to accept the invite.");
      else router.push(`/teams/${data.workspaceId}`);
    } catch {
      setError("Network error.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button onClick={accept} disabled={busy} className="btn btn-primary" style={{ width: "100%", padding: 12, font: "700 14px/1 var(--font-ui)" }}>
        <Check size={16} />
        {busy ? "Joining…" : "Accept invite"}
      </button>
      {error && (
        <div style={{ marginTop: 14, padding: "9px 12px", borderRadius: "var(--r-md)", background: "var(--danger-soft)", border: "1px solid var(--danger-border)", color: "var(--text)", font: "500 12px/1.4 var(--font-ui)" }}>
          {error}
        </div>
      )}
    </>
  );
}
