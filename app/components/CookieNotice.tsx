"use client";

import { useEffect, useState } from "react";

const KEY = "reel-cookie-notice";

// Reel only sets the strictly necessary sign-in cookie, which doesn't need
// consent — so this is a notice, not a consent wall: no pre-ticked boxes, no
// blocking, nothing to "accept". One dismissal, remembered in this browser.
export default function CookieNotice() {
  const [show, setShow] = useState(false);
  useEffect(() => {
    try { if (!localStorage.getItem(KEY)) setShow(true); } catch { /* storage blocked: skip the notice */ }
  }, []);
  if (!show) return null;
  const dismiss = () => {
    try { localStorage.setItem(KEY, "1"); } catch { /* ignore */ }
    setShow(false);
  };
  return (
    <div role="region" aria-label="Cookie notice"
      className="fixed inset-x-3 bottom-3 z-[90] mx-auto flex max-w-xl flex-col gap-3 rounded-2xl bg-card p-4 text-sm text-foreground shadow-lift ring-1 ring-border sm:flex-row sm:items-center">
      <p className="flex-1 text-muted-foreground">
        Reel only uses the cookies needed to keep you signed in. No ads, no trackers. <a href="/cookies" className="text-foreground underline underline-offset-2">Cookie policy</a>
      </p>
      <button onClick={dismiss} className="btn-pill btn-dark shrink-0 !px-5 !py-2 text-sm">Got it</button>
    </div>
  );
}
