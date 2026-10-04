"use client";

import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useInstallPrompt } from "@/hooks/useInstallPrompt";

const DISMISS_KEY = "syncme:pwa-dismissed";

/**
 * Install card for the lobby: Android gets a one-tap install button
 * (beforeinstallprompt needs a user gesture); iOS gets Share → "Add to
 * Home Screen" steps since Safari exposes no prompt event. Dismissible,
 * hidden entirely once installed.
 */
export function PwaInstallCard() {
  const { canPrompt, isIOSDevice, installed, promptInstall } =
    useInstallPrompt();
  const [dismissed, setDismissed] = useState<boolean>(() => {
    try {
      return localStorage.getItem(DISMISS_KEY) === "1";
    } catch {
      return false;
    }
  });
  const [busy, setBusy] = useState(false);
  const [showIOSSteps, setShowIOSSteps] = useState(false);

  if (installed || dismissed) return null;
  // Only iOS devices without a prompt event, or browsers holding a
  // deferred prompt, get the card — desktop Chrome without eligibility
  // criteria stays quiet.
  if (!canPrompt && !isIOSDevice) return null;

  const dismiss = () => {
    setDismissed(true);
    try {
      localStorage.setItem(DISMISS_KEY, "1");
    } catch {
      // ignore
    }
  };

  const handleInstall = async () => {
    setBusy(true);
    try {
      await promptInstall();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="w-full border-border bg-card/70 p-4 sm:p-5 backdrop-blur-xl shadow-lg rounded-2xl text-left">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1 space-y-1">
          <p className="text-sm font-bold text-foreground">
            Install PeerMates for the full experience
          </p>
          <p className="text-xs text-muted-foreground leading-relaxed">
            Fullscreen playback, faster loads, and home-screen access to your
            watch parties.
          </p>
        </div>
        <button
          type="button"
          onClick={dismiss}
          aria-label="Dismiss install prompt"
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:text-foreground cursor-pointer"
        >
          ✕
        </button>
      </div>

      <div className="mt-3">
        {canPrompt ? (
          <Button
            onClick={handleInstall}
            disabled={busy}
            className="w-full min-h-11 bg-[#333] dark:bg-white dark:text-black border text-white  text-xs font-semibold disabled:opacity-60"
          >
            {busy ? "Installing…" : "Install PeerMates"}
          </Button>
        ) : (
          <div className="space-y-2">
            <Button
              onClick={() => setShowIOSSteps((v) => !v)}
              aria-expanded={showIOSSteps}
              variant="outline"
              className="w-full min-h-11 text-xs"
            >
              {showIOSSteps ? "Hide iPhone steps ▲" : "📱 How to install on iPhone ▼"}
            </Button>
            {showIOSSteps && (
              <ol className="list-decimal space-y-1.5 rounded-xl border border-border/70 bg-background/50 px-4 py-3 pl-8 text-xs text-muted-foreground">
                <li>
                  Tap the <strong className="text-foreground">Share</strong>{" "}
                  button in Safari&apos;s toolbar (square with an arrow).
                </li>
                <li>
                  Scroll down and tap{" "}
                  <strong className="text-foreground">Add to Home Screen</strong>.
                </li>
                <li>
                  Tap <strong className="text-foreground">Add</strong> — PeerMates
                  opens fullscreen like a native app.
                </li>
              </ol>
            )}
          </div>
        )}
      </div>
    </Card>
  );
}
