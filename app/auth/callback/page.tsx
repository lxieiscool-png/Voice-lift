"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/app/lib/supabase/client";

export default function AuthCallback() {
  const router = useRouter();

  useEffect(() => {
    // OAuth providers report failures (denied access, expired code, etc.) as
    // #error=...&error_description=... in the hash for the implicit flow.
    // This was never being checked, so any failed sign-in silently bounced
    // the user home with zero explanation — the page.tsx side already has a
    // fully-built authError banner for exactly this, it just never received
    // anything to show.
    const hashParams = new URLSearchParams(window.location.hash.slice(1));
    const oauthError = hashParams.get("error_description") || hashParams.get("error");
    if (oauthError) {
      router.replace(`/?auth_error=${encodeURIComponent(oauthError)}`);
      return;
    }

    const supabase = createClient();

    // With implicit flow, Supabase automatically reads the token from the URL hash.
    // Just wait for the session to be set, then redirect home.
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "SIGNED_IN" && session) {
        subscription.unsubscribe();
        router.replace("/");
      }
    });

    // Fallback — if no auth event and no OAuth error fired in 3s, something
    // still went wrong (expired link, network issue) — say so instead of
    // pretending sign-in worked.
    const t = setTimeout(() => {
      subscription.unsubscribe();
      router.replace("/?auth_error=" + encodeURIComponent("Sign-in timed out. Please try again."));
    }, 3000);

    return () => { subscription.unsubscribe(); clearTimeout(t); };
  }, [router]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-black">
      <p className="text-zinc-500 text-sm animate-pulse">Signing you in…</p>
    </div>
  );
}
