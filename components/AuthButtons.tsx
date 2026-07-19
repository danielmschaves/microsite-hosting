import { signIn, signOut } from "@/auth";

export function SignIn({ provider, label }: { provider: string; label: string }) {
  return (
    <form
      action={async () => {
        "use server";
        await signIn(provider, { redirectTo: "/dashboard" });
      }}
    >
      <button className="btn" type="submit">
        {label}
      </button>
    </form>
  );
}

export function SignOut() {
  return (
    <form
      action={async () => {
        "use server";
        await signOut({ redirectTo: "/" });
      }}
    >
      <button className="btn secondary" type="submit">
        Sign out
      </button>
    </form>
  );
}
