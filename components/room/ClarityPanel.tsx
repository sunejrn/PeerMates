"use client";

import { Card } from "@/components/ui/card";
import type { ClarityTier } from "@/lib/video/clarity";

const TIERS: { id: ClarityTier; label: string; hint?: string }[] = [
  { id: "off", label: "Off" },
  { id: "light", label: "Light" },
  { id: "ultra", label: "Ultra", hint: "Uses extra battery" },
];

/**
 * Clarity Engine switch: Off / Light (works everywhere) / Ultra (native
 * video with WebGL only). Ultra hides on sources without real pixels, with
 * a short note. 44px targets, Vercel-style bordered flat card.
 */
export function ClarityPanel({
  clarity,
  ultraAvailable,
  ultraNote,
  disabled,
  disabledReason,
  onChange,
}: {
  clarity: ClarityTier;
  ultraAvailable: boolean;
  ultraNote?: string | null;
  disabled: boolean;
  disabledReason?: string;
  onChange: (tier: ClarityTier) => void;
}) {
  const tiers = ultraAvailable ? TIERS : TIERS.filter((t) => t.id !== "ultra");
  return (
    <Card className="border-border bg-card p-3 sm:p-4 rounded-lg space-y-2">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-xs font-medium text-muted-foreground">Clarity</h3>
        {clarity === "ultra" && (
          <span className="rounded-lg border border-border px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
            🔋 extra battery
          </span>
        )}
      </div>
      <div
        className={`grid gap-1.5 ${tiers.length === 3 ? "grid-cols-3" : "grid-cols-2"}`}
        role="group"
        aria-label="Clarity level"
      >
        {tiers.map((t) => {
          const active = clarity === t.id;
          return (
            <button
              key={t.id}
              type="button"
              disabled={disabled}
              onClick={() => onChange(t.id)}
              aria-pressed={active}
              title={t.hint}
              className={`min-h-11 rounded-lg border text-xs font-medium cursor-pointer disabled:opacity-60 ${
                active
                  ? "border-foreground bg-foreground text-background"
                  : "border-border bg-background text-muted-foreground hover:text-foreground"
              }`}
            >
              {t.label}
            </button>
          );
        })}
      </div>
      {ultraNote && (
        <p className="text-[11px] text-muted-foreground" role="status">
          {ultraNote}
        </p>
      )}
      {!ultraAvailable && (
        <p className="text-[11px] text-muted-foreground">
          Clarity isn&apos;t available for this source — Ultra needs a direct video file.
        </p>
      )}
      {disabled && disabledReason && (
        <p className="text-[11px] text-muted-foreground">{disabledReason}</p>
      )}
    </Card>
  );
}
