"use client";

import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { DATA_PRICES } from "@/lib/data/pricing";

interface DataPanelProps {
  dataSaver: boolean;
  audioOnly: boolean;
  onToggleSaver: (on: boolean) => void;
  onToggleAudio: (on: boolean) => void;
  mbText: string;
  measuredText: string;
  estimatedText: string;
  isEstimateOnly: boolean;
  costText: string;
  priceCountry: string;
  region: string | null;
  detectedRegion: string | null;
  onRegionChange: (code: string | null) => void;
  onResetMeter: () => void;
}

function Switch({
  checked,
  onChange,
  label,
  hint,
}: {
  checked: boolean;
  onChange: (on: boolean) => void;
  label: string;
  hint: string;
}) {
  return (
    <div className="flex items-center justify-between gap-2 rounded-lg border border-border/70 bg-background/50 px-3 py-2">
      <div className="space-y-0.5">
        <p className="text-xs font-medium text-foreground">{label}</p>
        <p className="text-[11px] text-muted-foreground">{hint}</p>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        onClick={() => onChange(!checked)}
        className={`relative h-11 w-16 shrink-0 rounded-full border transition-colors cursor-pointer ${
          checked ? "bg-emerald-500/80 border-emerald-500" : "bg-muted border-border"
        }`}
      >
        <span
          className={`absolute top-1/2 h-8 w-8 -translate-y-1/2 rounded-full bg-white shadow transition-all ${
            checked ? "left-[calc(100%-2.25rem)]" : "left-1"
          }`}
        />
      </button>
    </div>
  );
}

/**
 * Low-Data Mode + live session meter. Data Saver caps HLS quality, gates
 * avatar downloads, and pauses decoding in hidden tabs; audio-only hides
 * video (audio keeps playing). The meter shows measured (HLS) vs estimated
 * bytes plus an estimated cost from the per-country price table.
 */
export function DataPanel({
  dataSaver,
  audioOnly,
  onToggleSaver,
  onToggleAudio,
  mbText,
  measuredText,
  estimatedText,
  isEstimateOnly,
  costText,
  priceCountry,
  region,
  detectedRegion,
  onRegionChange,
  onResetMeter,
}: DataPanelProps) {
  const countries = Object.entries(DATA_PRICES).sort((a, b) =>
    a[1].country.localeCompare(b[1].country)
  );

  return (
    <Card className="border-border bg-card/60 p-3 sm:p-4 rounded-xl backdrop-blur-sm shadow-sm space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          📶 Low-Data Mode
        </h3>
        {dataSaver ? (
          <span className="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-medium text-emerald-700 dark:text-emerald-300">
            Saving data
          </span>
        ) : (
          <span className="rounded-full border border-border bg-muted/60 px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
            Full quality
          </span>
        )}
      </div>

      <div className="space-y-2">
        <Switch
          checked={dataSaver}
          onChange={onToggleSaver}
          label="Data Saver"
          hint="Caps stream quality, skips avatars, pauses hidden tabs."
        />
        <Switch
          checked={audioOnly}
          onChange={onToggleAudio}
          label="Audio-only mode"
          hint="Hides video, keeps the audio playing."
        />
      </div>

      {/* Live session meter */}
      <div className="rounded-lg border border-border/70 bg-background/50 px-3 py-2.5 space-y-2">
        <div className="flex items-end justify-between gap-2">
          <div>
            <p className="text-[11px] text-muted-foreground">Session data (video)</p>
            <p className="text-xl font-bold font-mono text-foreground leading-tight">
              {mbText}
            </p>
          </div>
          <div className="text-right">
            <p className="text-[11px] text-muted-foreground">Est. cost · {priceCountry}</p>
            <p className="text-sm font-bold font-mono text-foreground">{costText}</p>
          </div>
        </div>

        <p className="text-[11px] text-muted-foreground">
          Measured {measuredText}
          {isEstimateOnly ? (
            <> · <span title="YouTube/MP4 bytes can't be measured from the page">~{estimatedText} estimated</span></>
          ) : (
            <> · ~{estimatedText} estimated</>
          )}
        </p>

        <div className="flex gap-1.5">
          <select
            aria-label="Country for cost estimate"
            value={region ?? ""}
            onChange={(e) => onRegionChange(e.target.value || null)}
            className="h-11 min-w-0 flex-1 rounded-lg border border-border bg-background/80 px-2 text-xs text-foreground cursor-pointer"
          >
            <option value="">
              Auto{detectedRegion ? ` (${DATA_PRICES[detectedRegion]?.country ?? detectedRegion})` : ""}
            </option>
            {countries.map(([code, p]) => (
              <option key={code} value={code}>
                {p.country} (~{p.symbol}
                {p.usdPerGB}/GB)
              </option>
            ))}
          </select>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={onResetMeter}
            className="h-11 px-3 text-xs shrink-0"
          >
            Reset
          </Button>
        </div>
        <p className="text-[10px] leading-relaxed text-muted-foreground/80">
          Estimates only: HLS is measured exactly; YouTube/MP4 assume typical
          bitrates. Prices are approximate prepaid mobile-data rates.
        </p>
      </div>
    </Card>
  );
}
