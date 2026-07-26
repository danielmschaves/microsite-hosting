// Email adapter (Resend via plain fetch — no SDK). Follows the project's
// env-detection pattern: when unconfigured, sending becomes a logged no-op and
// callers surface the actionable link in the UI instead. Email is always a
// convenience here, never a dependency.

export const emailEnabled = Boolean(
  process.env.RESEND_API_KEY && process.env.EMAIL_FROM,
);

export interface EmailMessage {
  to: string;
  subject: string;
  html: string;
  text: string;
}

export async function sendEmail(msg: EmailMessage): Promise<{ sent: boolean }> {
  if (!emailEnabled) {
    console.log(`[email] disabled — would send to ${msg.to}: ${msg.subject}`);
    return { sent: false };
  }
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: process.env.EMAIL_FROM,
        to: [msg.to],
        subject: msg.subject,
        html: msg.html,
        text: msg.text,
      }),
    });
    if (!res.ok) {
      console.error(`[email] Resend responded ${res.status}: ${await res.text()}`);
      return { sent: false };
    }
    return { sent: true };
  } catch (err) {
    console.error("[email] send failed", err);
    return { sent: false };
  }
}

/** Invite email for a workspace. */
export function inviteEmail(opts: {
  workspaceName: string;
  invitedBy: string;
  inviteUrl: string;
}): Omit<EmailMessage, "to"> {
  const { workspaceName, invitedBy, inviteUrl } = opts;
  return {
    subject: `${invitedBy} invited you to "${workspaceName}" on MicroBuild`,
    text: `${invitedBy} invited you to join the "${workspaceName}" workspace on MicroBuild.\n\nAccept the invite:\n${inviteUrl}\n\nThis link expires in 14 days.`,
    html: `<div style="font-family:system-ui,sans-serif;max-width:480px;margin:0 auto;padding:24px">
  <h2 style="margin:0 0 12px">Join ${escapeHtml(workspaceName)} on MicroBuild</h2>
  <p style="color:#555;line-height:1.5">${escapeHtml(invitedBy)} invited you to collaborate in the
  <strong>${escapeHtml(workspaceName)}</strong> workspace — private, self-expiring HTML sites shared with your team.</p>
  <p style="margin:24px 0"><a href="${inviteUrl}" style="background:#5b4dff;color:#fff;padding:12px 20px;border-radius:8px;text-decoration:none;font-weight:600">Accept invite</a></p>
  <p style="color:#999;font-size:13px">This link expires in 14 days. If you weren't expecting it, ignore this email.</p>
</div>`,
  };
}

/** Expiry reminder (T-48h / T-2h). One-click extend deep-links the site page. */
export function expiryEmail(opts: {
  slug: string;
  window: "48h" | "2h";
  expiresAt: Date;
  siteUrl: string;
  manageUrl: string;
}): Omit<EmailMessage, "to"> {
  const when = opts.window === "48h" ? "in about 2 days" : "in about 2 hours";
  return {
    subject: `"${opts.slug}" expires ${when} on MicroBuild`,
    text: `Your site "${opts.slug}" (${opts.siteUrl}) expires ${when} (${opts.expiresAt.toISOString()}).\n\nExtend it in one click from the site page:\n${opts.manageUrl}\n\nAfter expiry it moves to the trash for 7 days, then storage is deleted.`,
    html: `<div style="font-family:system-ui,sans-serif;max-width:480px;margin:0 auto;padding:24px">
  <h2 style="margin:0 0 12px">${escapeHtml(opts.slug)} expires ${when}</h2>
  <p style="color:#555;line-height:1.5">The site stops serving at
  <strong>${opts.expiresAt.toUTCString()}</strong>, then sits in the trash for 7 days before
  storage is deleted.</p>
  <p style="margin:24px 0"><a href="${opts.manageUrl}" style="background:#5b4dff;color:#fff;padding:12px 20px;border-radius:8px;text-decoration:none;font-weight:600">Extend TTL</a></p>
  <p style="color:#999;font-size:13px">You get one reminder at T-48h and one at T-2h. Extending resets both.</p>
</div>`,
  };
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
