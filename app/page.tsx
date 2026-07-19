import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { SignIn } from "@/components/AuthButtons";

export const dynamic = "force-dynamic";

export default async function Home() {
  const session = await auth();
  if (session?.user) {
    redirect("/dashboard");
  }

  const hasGoogle = Boolean(
    process.env.AUTH_GOOGLE_ID && process.env.AUTH_GOOGLE_SECRET,
  );
  const hasGitHub = Boolean(
    process.env.AUTH_GITHUB_ID && process.env.AUTH_GITHUB_SECRET,
  );

  return (
    <>
      <div className="header">
        <Link className="brand" href="/">
          Shipsite
        </Link>
      </div>
      <div className="container">
        <div className="panel">
          <h1>Ship an HTML file. Get a private link.</h1>
          <p className="muted">
            Drag in a self-contained HTML page, share a link protected by your
            login, and let it expire automatically. No downloads, no orphaned
            files.
          </p>
          <div className="row" style={{ marginTop: 20 }}>
            {hasGoogle && <SignIn provider="google" label="Sign in with Google" />}
            {hasGitHub && <SignIn provider="github" label="Sign in with GitHub" />}
          </div>
          {!hasGoogle && !hasGitHub && (
            <div className="notice err">
              No OAuth providers are configured. Set AUTH_GOOGLE_ID /
              AUTH_GITHUB_ID (and secrets) in your environment.
            </div>
          )}
        </div>
      </div>
    </>
  );
}
