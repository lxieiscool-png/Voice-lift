"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/app/lib/supabase/client";

export default function AuthCallback() {
  const router = useRouter();

  useEffect(() => {
    const supabase = createClient();

    // With implicit flow, Supabase automatically reads the token from the URL hash.
    // Just wait for the session to be set, then redirect home.
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "SIGNED_IN" && session) {
        subscription.unsubscribe();
        router.replace("/");
      }
    });

    // Fallback — if no auth event fires in 3s, go home anyway
    const t = setTimeout(() => { subscription.unsubscribe(); router.replace("/"); }, 3000);

    return () => { subscription.unsubscribe(); clearTimeout(t); };
  }, [router]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-black">
      <p className="text-zinc-500 text-sm animate-pulse">Signing you in…</p>
    </div>
  );
}
