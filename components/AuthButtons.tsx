import { signIn, signOut } from "@/auth";

/** Google "G" mark (multicolor conic) matching the design. */
function GoogleMark() {
  return (
    <span
      style={{
        width: 18,
        height: 18,
        borderRadius: 5,
        background:
          "conic-gradient(from -45deg,#ea4335,#fbbc05,#34a853,#4285f4,#ea4335)",
        display: "grid",
        placeItems: "center",
        font: "800 11px/1 var(--font-ui)",
        color: "#fff",
      }}
    >
      G
    </span>
  );
}

function GitHubMark() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M12 .5a11.5 11.5 0 0 0-3.64 22.42c.58.11.79-.25.79-.56v-2c-3.2.7-3.88-1.37-3.88-1.37-.53-1.34-1.29-1.7-1.29-1.7-1.05-.72.08-.7.08-.7 1.16.08 1.77 1.19 1.77 1.19 1.03 1.77 2.7 1.26 3.36.96.1-.75.4-1.26.73-1.55-2.56-.29-5.25-1.28-5.25-5.7 0-1.26.45-2.29 1.19-3.1-.12-.29-.52-1.46.11-3.05 0 0 .97-.31 3.18 1.18a11 11 0 0 1 5.79 0c2.2-1.49 3.17-1.18 3.17-1.18.63 1.59.23 2.76.11 3.05.74.81 1.19 1.84 1.19 3.1 0 4.43-2.69 5.41-5.26 5.69.41.36.78 1.05.78 2.12v3.14c0 .31.21.68.8.56A11.5 11.5 0 0 0 12 .5Z" />
    </svg>
  );
}

/** Google/GitHub sign-in button as an Auth.js server-action form. */
export function ProviderSignIn({
  provider,
  callbackUrl = "/dashboard",
}: {
  provider: "google" | "github";
  callbackUrl?: string;
}) {
  const isGoogle = provider === "google";
  const style: React.CSSProperties = isGoogle
    ? {
        background: "#fff",
        border: "1px solid rgba(0,0,0,.12)",
        color: "#1f2430",
      }
    : {
        background: "var(--surface-3)",
        border: "1px solid var(--border-strong)",
        color: "var(--text)",
      };

  return (
    <form
      action={async () => {
        "use server";
        await signIn(provider, { redirectTo: callbackUrl });
      }}
    >
      <button
        type="submit"
        style={{
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          gap: 10,
          width: "100%",
          padding: 12,
          borderRadius: "var(--r-md)",
          font: "600 14px/1 var(--font-ui)",
          cursor: "pointer",
          ...style,
        }}
      >
        {isGoogle ? <GoogleMark /> : <GitHubMark />}
        Continue with {isGoogle ? "Google" : "GitHub"}
      </button>
    </form>
  );
}

export function SignOutButton({
  variant = "icon",
}: {
  variant?: "icon" | "full";
}) {
  return (
    <form
      action={async () => {
        "use server";
        await signOut({ redirectTo: "/" });
      }}
    >
      {variant === "icon" ? (
        <button type="submit" className="icon-btn" aria-label="Sign out" style={{ width: 32, height: 32 }}>
          <LogOutMark />
        </button>
      ) : (
        <button type="submit" className="btn btn-neutral">
          <LogOutMark />
          Sign out
        </button>
      )}
    </form>
  );
}

function LogOutMark() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
      <polyline points="16 17 21 12 16 7" />
      <line x1="21" y1="12" x2="9" y2="12" />
    </svg>
  );
}
