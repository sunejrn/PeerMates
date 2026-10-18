"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
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
      toast.success("Invite link copied. Send it to your friends.");
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("Copy failed. Long press the link to copy it.");
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
          className="border-border bg-card/80 text-xs text-foreground  h-11 min-w-11 px-2.5 sm:px-3 sm:h-9 cursor-pointer"
          aria-label="Invite friends to this party"
        >
          📩 <span className="hidden sm:inline ml-1">Invite</span>
        </Button>
      )}

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        size="md"
        label="Invite friends"
        className="p-5 pb-[max(env(safe-area-inset-bottom),1.25rem)] sm:p-6"
      >
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain">
          <div className="text-center space-y-1">
            <h3 className="text-lg font-semibold text-foreground">📩 Invite friends</h3>
            <p className="text-sm text-muted-foreground">
              Anyone with the link joins as a guest. No signup needed.
            </p>
          </div>

          {/* Link row */}
          <div className="flex items-center gap-2 rounded-xl border border-border bg-background/60 p-2 pl-3">
            <span className="min-w-0 flex-1 truncate font-mono text-xs text-foreground">{link}</span>
            <Button
              size="sm"
              onClick={handleCopy}
              className="h-11 min-w-11 px-4 bg-violet-600  text-[#f5f5f5] text-xs font-semibold cursor-pointer shrink-0"
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
              className="flex min-h-11 items-center justify-center gap-2 rounded-xl bg-[#25D366] px-3 text-sm font-bold text-[#f5f5f5]"
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
                className="h-48 w-48 rounded-lg border border-border bg-[#f5f5f5] p-1"
              />
            ) : (
              <p className="text-xs text-muted-foreground px-4 py-6 text-center" role="status">
                QR unavailable offline. The link above works the same.
              </p>
            )}
            <span className="font-mono text-xs font-bold tracking-widest text-muted-foreground uppercase">
              Code: {slug}
            </span>
          </div>

          <button
            type="button"
            onClick={() => setOpen(false)}
            className="flex min-h-11 w-full items-center justify-center rounded-xl border border-border text-sm font-medium text-foreground cursor-pointer"
          >
            Close
          </button>
        </div>
      </Modal>
    </>
  );
}
