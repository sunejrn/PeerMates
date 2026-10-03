"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import {
  ESTIMATED_BITRATES,
  formatBytes,
  priceForRegion,
  type DataPrice,
} from "@/lib/data/pricing";

/**
 * Session data meter. Tracks NETWORK bytes for this page session:
 * - HLS: exact segment sizes reported by hls.js (measured).
 * - Local files: zero (on-device bytes, no network).
 * - YouTube / progressive MP4: estimated from watched seconds × an
 *   assumed bitrate (the page cannot measure iframe/progressive bytes),
 *   always labeled "~estimated".
 *
 * Cost = MB/1024 × per-country USD/GB, shown in the user's currency
 * selection (region auto-detected from locale, manually overridable).
 */
export function useDataMeter() {
  const bytesRef = useRef(0);
  const measuredRef = useRef(0);
  const estimatedRef = useRef(0);
  // Display snapshots (state) — refs are never read during render.
  const [totalBytes, setTotalBytes] = useState(0);
  const [measuredBytes, setMeasuredBytes] = useState(0);
  const [estimatedBytes, setEstimatedBytes] = useState(0);
  const [region, setRegionState] = useState<string | null>(null);
  const lastPushRef = useRef(0);

  const push = useCallback(() => {
    const now = Date.now();
    // Throttle re-renders: at most ~1/sec.
    if (now - lastPushRef.current < 900) return;
    lastPushRef.current = now;
    setTotalBytes(bytesRef.current);
    setMeasuredBytes(measuredRef.current);
    setEstimatedBytes(estimatedRef.current);
  }, []);

  const addBytes = useCallback(
    (bytes: number, measured: boolean) => {
      if (!Number.isFinite(bytes) || bytes <= 0) return;
      bytesRef.current += bytes;
      if (measured) measuredRef.current += bytes;
      else estimatedRef.current += bytes;
      push();
    },
    [push]
  );

  /** Estimate playback cost for `seconds` of a source type. */
  const addWatchSeconds = useCallback(
    (videoType: string, seconds: number) => {
      const bps = ESTIMATED_BITRATES[videoType] ?? ESTIMATED_BITRATES.mp4;
      if (!bps || seconds <= 0) return;
      addBytes((bps / 8) * seconds, false);
    },
    [addBytes]
  );

  const setRegion = useCallback((code: string | null) => {
    setRegionState(code);
  }, []);

  const reset = useCallback(() => {
    bytesRef.current = 0;
    measuredRef.current = 0;
    estimatedRef.current = 0;
    lastPushRef.current = 0;
    setTotalBytes(0);
    setMeasuredBytes(0);
    setEstimatedBytes(0);
  }, []);

  const price: DataPrice = useMemo(() => priceForRegion(region), [region]);

  const costText = useMemo(() => {
    const gb = totalBytes / (1024 * 1024 * 1024);
    const usd = gb * price.usdPerGB;
    const shown = usd < 0.01 && usd > 0 ? "<0.01" : usd.toFixed(2);
    return `~${price.symbol}${shown} ${price.currency}`;
  }, [price, totalBytes]);

  return {
    mbUsed: totalBytes / (1024 * 1024),
    measuredBytes,
    estimatedBytes,
    mbText: formatBytes(totalBytes),
    measuredText: formatBytes(measuredBytes),
    estimatedText: formatBytes(estimatedBytes),
    costText,
    price,
    region,
    setRegion,
    addBytes,
    addWatchSeconds,
    reset,
    flush: () => {
      lastPushRef.current = 0;
      push();
    },
  };
}
