"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/app/lib/supabase/client";

export default function AuthCallback() {
  const router = useRouter();

  useEffect(() => {
    const supabase = createClient();
    const params   = new URLSearchParams(window.location.search);
    const code     = params.get("code");
    const error    = params.get("error");
    const errorDesc = params.get("error_description");

    if (error) {
      router.replace(`/?auth_error=${encodeURIComponent(errorDesc || error)}`);
      return;
    }

    if (code) {
      // Exchange code client-side — this has access to the PKCE verifier in localStorage
      supabase.auth.exchangeCodeForSession(code).then(({ error: exchangeError }) => {
        if (exchangeError) {
          router.replace(`/?auth_error=${encodeURIComponent(exchangeError.message)}`);
        } else {
          router.replace("/");
        }
      });
      return;
    }

    // No code — check if already signed in (e.g. implicit flow token in hash)
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) {
        router.replace("/");
      } else {
        router.replace("/");
      }
    });
  }, [router]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-black">
      <p className="text-zinc-500 text-sm animate-pulse">Signing you in…</p>
    </div>
  );
}
