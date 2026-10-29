"use client";

import * as React from "react";
import { createPortal } from "react-dom";
import { cn } from "cn";

type ModalSize = "sm" | "md" | "lg" | "xl" | "full";

const SIZE_CLASS: Record<ModalSize, string> = {
  sm: "sm:max-w-sm",
  md: "sm:max-w-md",
  lg: "sm:max-w-lg",
  xl: "sm:max-w-2xl",
  full: "sm:max-w-4xl",
};

interface ModalProps {
  open: boolean;
  onClose: () => void;
  children: React.ReactNode;
  /** Dialog width on sm+ screens. */
  size?: ModalSize;
  /** Extra classes merged onto the dialog surface. */
  className?: string;
  /** Accessible label / describedby wiring. */
  label?: string;
  labelledBy?: string;
  /** Hide the mobile drag handle (e.g. for tall multi-panel dialogs). */
  hideHandle?: boolean;
}

/**
 * Google Material 3 style modal: centered dialog on desktop, bottom sheet on
 * mobile, 28px corners, internal scroll, backdrop dismiss, Escape to close,
 * and body scroll lock. Fills every screen size without ever overflowing.
 */
export function Modal({
  open,
  onClose,
  children,
  size = "md",
  className,
  label,
  labelledBy,
  hideHandle = false,
}: ModalProps) {
  React.useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [open, onClose]);

  if (!open || typeof document === "undefined") return null;

  return createPortal(
    <div
      className="fixed inset-0 z-60 flex items-end justify-center sm:items-center sm:p-6"
      role="dialog"
      aria-modal="true"
      aria-label={label}
      aria-labelledby={labelledBy}
    >
      <div
        className="absolute inset-0 bg-black/50 supports-backdrop-filter:backdrop-blur-sm"
        onClick={onClose}
        aria-hidden
      />
      <div
        className={cn(
          "relative z-10 flex max-h-[92dvh] w-full flex-col overflow-hidden overscroll-contain rounded-t-[28px] border border-border bg-popover text-popover-foreground sm:max-h-[calc(100dvh-3rem)] sm:rounded-[28px]",
          SIZE_CLASS[size],
          className,
        )}
      >
        {!hideHandle && (
          <div className="flex shrink-0 justify-center pt-3 sm:hidden" aria-hidden>
            <span className="h-1 w-10 rounded-full bg-muted-foreground/40" />
          </div>
        )}
        {children}
      </div>
    </div>,
    document.body,
  );
}
