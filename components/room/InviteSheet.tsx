"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { qrImageUrl, roomUrl, whatsappShareUrl } from "@/lib/rooms/code";

interface InviteSheetProps {
  slug: string;
  title?: string;
  trigger?: React.ReactNode;
}

/**
 * Invite others: copy link, Share to WhatsApp (one tap), native share sheet,
 * and QR code for in-person sharing. Bottom-sheet on mobile, 44px targets,
 * safe-area insets, loading + error states.
 */
export function InviteSheet({ slug, title, trigger }: InviteSheetProps) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [qrError, setQrError] = useState(false);
  const link = roomUrl(slug);
  // Portaled to document.body on mount (see below) — never inline.
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
  }, []);

  // Escape closes the sheet.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open ]);

  const handleCopy = async () => {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(link);
      } else {
        const ta = document.createElement("textarea");
        ta.value = link;
        ta.style.position = "fixed";
        ta.style.opacity = "0";
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        document.body.removeChild(ta);
      }
      setCopied(true);
      toast.success("Invite link copied — send it to your friends!");
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("Copy failed — long-press the link to copy it.");
    }
  };

  const handleNativeShare = async () => {
    try {
      if (navigator.share) {
        await navigator.share({
          title: title ? `PeerMates: ${title}` : "PeerMates party",
          text: `Join my PeerMates party${title ? ` "${title}"` : ""}!`,
          url: link,
        });
      } else {
        await handleCopy();
      }
    } catch {
      // user dismissed the sheet — not an error
    }
  };

  return (
    <>
      {trigger ? (
        <span onClick={() => setOpen(true)} className="inline-flex">{trigger}</span>
      ) : (
        <Button
          size="sm"
          variant="outline"
          onClick={() => setOpen(true)}
          className="border-border bg-card/80 text-xs text-foreground hover:bg-muted h-11 min-w-11 px-2.5 sm:px-3 sm:h-9 cursor-pointer"
          aria-label="Invite friends to this party"
        >
          📩 <span className="hidden sm:inline ml-1">Invite</span>
        </Button>
      )}

      {mounted &&
        open &&
        createPortal(
          <div className="fixed inset-0 z-[60]" role="dialog" aria-modal="true" aria-label="Invite friends">
          <div className="absolute inset-0 bg-black/60" onClick={() => setOpen(false)} />
          <div className="absolute inset-x-0 bottom-0 mx-auto w-full max-w-md rounded-t-2xl border-t border-border bg-card p-4 sm:p-5 pb-[max(env(safe-area-inset-bottom),1rem)] space-y-4 max-h-[85dvh] overflow-y-auto">
            <div className="mx-auto h-1 w-10 rounded-full bg-muted" aria-hidden />
            <div className="text-center space-y-1">
              <h3 className="text-base font-bold text-foreground">📩 Invite friends</h3>
              <p className="text-xs text-muted-foreground">
                Anyone with the link joins as a guest — no signup needed.
              </p>
            </div>

            {/* Link row */}
            <div className="flex items-center gap-2 rounded-xl border border-border bg-background/60 p-2 pl-3">
              <span className="min-w-0 flex-1 truncate font-mono text-xs text-foreground">{link}</span>
              <Button
                size="sm"
                onClick={handleCopy}
                className="h-11 min-w-11 px-4 bg-violet-600 hover:bg-violet-500 text-white text-xs font-semibold cursor-pointer shrink-0"
              >
                {copied ? "✓ Copied" : "Copy"}
              </Button>
            </div>

            {/* One-tap share actions */}
            <div className="grid grid-cols-2 gap-2">
              <a
                href={whatsappShareUrl(slug, title)}
                target="_blank"
                rel="noopener noreferrer"
                className="flex min-h-11 items-center justify-center gap-2 rounded-xl bg-[#25D366] px-3 text-sm font-bold text-white"
                aria-label="Share to WhatsApp"
              >
                <span aria-hidden>💬</span> WhatsApp
              </a>
              <button
                type="button"
                onClick={handleNativeShare}
                className="flex min-h-11 items-center justify-center gap-2 rounded-xl border border-border bg-background px-3 text-sm font-semibold text-foreground cursor-pointer"
              >
                <span aria-hidden>📤</span> More…
              </button>
            </div>

            {/* QR for in-person sharing */}
            <div className="flex flex-col items-center gap-2 rounded-xl border border-border/70 bg-muted/30 p-3">
              <span className="text-xs font-semibold text-foreground">📷 Scan to join in person</span>
              {!qrError ? (
                <img
                  src={qrImageUrl(slug)}
                  alt={`QR code for party ${slug}`}
                  width={192}
                  height={192}
                  loading="lazy"
                  onError={() => setQrError(true)}
                  className="h-48 w-48 rounded-lg border border-border bg-white p-1"
                />
              ) : (
                <p className="text-xs text-muted-foreground px-4 py-6 text-center" role="status">
                  QR unavailable offline — the link above works the same.
                </p>
              )}
              <span className="font-mono text-xs font-bold tracking-widest text-muted-foreground uppercase">
                Code: {slug}
              </span>
            </div>

            <button
              type="button"
              onClick={() => setOpen(false)}
              className="flex min-h-11 w-full items-center justify-center rounded-xl text-sm text-muted-foreground cursor-pointer"
            >
              Close
            </button>
          </div>
          </div>,
          document.body
        )}
    </>
  );
}
