import NextAuth, { type NextAuthConfig } from "next-auth";
import Google from "next-auth/providers/google";
import GitHub from "next-auth/providers/github";
import Credentials from "next-auth/providers/credentials";

// Dev-only email login: lets you sign in as any email without configuring OAuth
// apps, so the auth-gated flows (upload, allowlist, serving) can be tested
// locally. NEVER enable in production — it authenticates anyone.
const devLogin = process.env.AUTH_DEV_LOGIN === "true";

// Only register providers whose credentials are present. This keeps the app
// bootable locally even if you've only configured one of Google/GitHub.
const providers: NextAuthConfig["providers"] = [];
if (process.env.AUTH_GOOGLE_ID && process.env.AUTH_GOOGLE_SECRET) {
  providers.push(
    Google({
      clientId: process.env.AUTH_GOOGLE_ID,
      clientSecret: process.env.AUTH_GOOGLE_SECRET,
    }),
  );
}
if (process.env.AUTH_GITHUB_ID && process.env.AUTH_GITHUB_SECRET) {
  providers.push(
    GitHub({
      clientId: process.env.AUTH_GITHUB_ID,
      clientSecret: process.env.AUTH_GITHUB_SECRET,
    }),
  );
}
if (devLogin) {
  providers.push(
    Credentials({
      id: "dev",
      name: "Dev email",
      credentials: { email: { label: "Email", type: "email" } },
      authorize: (creds) => {
        const email = String(creds?.email || "").trim().toLowerCase();
        if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return null;
        return { id: email, email, name: email.split("@")[0] };
      },
    }),
  );
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  // JWT sessions (no DB adapter) — the viewer allowlist is checked against the
  // session email, so we don't need Auth.js to persist users.
  session: { strategy: "jwt" },
  trustHost: true,
  // Branded login wall (see app/login/page.tsx). Unauthenticated viewers of a
  // private site land here with their callbackUrl preserved.
  pages: { signIn: "/login" },
  providers,
});

/** Which sign-in methods are available — used to render only working buttons. */
export const enabledProviders = {
  google: Boolean(process.env.AUTH_GOOGLE_ID && process.env.AUTH_GOOGLE_SECRET),
  github: Boolean(process.env.AUTH_GITHUB_ID && process.env.AUTH_GITHUB_SECRET),
  dev: devLogin,
};
