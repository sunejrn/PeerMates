"use client";

import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { useInstallPrompt } from "@/hooks/useInstallPrompt";
import { PwaInstallCard } from "@/components/pwa/PwaInstallCard";

const SHOWN_KEY = "peermates:pwa-toast-shown";
const FIVE_MINUTES_MS = 5 * 60 * 1000;

/**
 * Home-page install spotlight: shows a 5-minute dismissible (X) sonner
 * toast ONCE, then falls back to the inline install card.
 *
 * - Toast (first eligible visit): stays 5 minutes, X closes it any time.
 * - Card (after the toast goes away — X, timeout — or on later visits):
 *   the familiar inline card, dismissible via its own X (persisted).
 * - Installed / previously-dismissed: renders nothing.
 */
export function PwaInstallSpotlight() {
  const { canPrompt, isIOSDevice, installed, promptInstall } =
    useInstallPrompt();
  const [phase, setPhase] = useState<"idle" | "toast" | "card">("idle");
  const firedRef = useRef(false);

  useEffect(() => {
    if (phase !== "idle" || firedRef.current) return;
    let dismissed = false;
    try {
      dismissed = window.localStorage.getItem("syncme:pwa-dismissed") === "1";
    } catch {
      // storage blocked
    }
    if (installed || dismissed) return;
    if (!canPrompt && !isIOSDevice) return;

    let shownBefore = false;
    try {
      shownBefore = window.localStorage.getItem(SHOWN_KEY) === "1";
    } catch {
      // storage blocked
    }
    // Toast shows exactly once — afterwards the inline card takes over.
    if (shownBefore) {
      setPhase("card");
      return;
    }
    firedRef.current = true;
    try {
      window.localStorage.setItem(SHOWN_KEY, "1");
    } catch {
      // storage blocked — toast still shows this once per mount
    }
    setPhase("toast");
    toast("Install PeerMates for the full experience", {
      id: "pwa-install",
      description: canPrompt
        ? "Fullscreen playback, faster loads, and home-screen access to your watch parties."
        : "Tap Share → Add to Home Screen for fullscreen playback, faster loads, and home-screen access.",
      duration: FIVE_MINUTES_MS,
      closeButton: true,
      dismissible: true,
      action: canPrompt
        ? {
            label: "Install",
            onClick: () => {
              void promptInstall().then((ok) => {
                if (ok) toast.dismiss("pwa-install");
              });
            },
          }
        : undefined,
      onDismiss: () => setPhase("card"),
      onAutoClose: () => setPhase("card"),
    });
  }, [installed, canPrompt, isIOSDevice, phase, promptInstall]);

  if (phase !== "card") return null;
  return <PwaInstallCard />;
}
