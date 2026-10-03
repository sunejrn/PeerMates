"use client";

import { useCallback, useRef, useState } from "react";
import {
  fingerprintFile,
  preflightFile,
  type LocalFingerprint,
  type PreflightResult,
} from "@/lib/video/localfile";

export type PickPhase = "idle" | "preflight" | "fingerprint" | "ready" | "error";

/**
 * Shared pick -> preflight -> fingerprint flow for "My Files".
 * Used by the lobby creator and the in-room file gate so both behave the
 * same. Never reads the whole file: preflight loads metadata only and
 * fingerprinting hashes three 1MB slices.
 */
export function useLocalFilePick() {
  const [file, setFileState] = useState<File | null>(null);
  const [preflight, setPreflight] = useState<PreflightResult | null>(null);
  const [fp, setFp] = useState<LocalFingerprint | null>(null);
  const [phase, setPhase] = useState<PickPhase>("idle");
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [tip, setTip] = useState<string | null>(null);
  const runId = useRef(0);

  const pickFile = useCallback(async (f: File | null) => {
    const id = ++runId.current;
    setFileState(f);
    setFp(null);
    setError(null);
    setTip(null);
    setProgress(0);
    if (!f) {
      setPreflight(null);
      setPhase("idle");
      return;
    }
    setPhase("preflight");
    const pre = await preflightFile(f);
    if (id !== runId.current) return;
    setPreflight(pre);
    if (!pre.playable) {
      setPhase("error");
      setError(pre.fatal || "This file won't play on this device.");
      setTip(pre.tip);
      return;
    }
    setPhase("fingerprint");
    try {
      const fpRes = await fingerprintFile(f, (p) => {
        if (id === runId.current) setProgress(p.fraction);
      });
      if (id !== runId.current) return;
      setFp(fpRes);
      setPhase("ready");
    } catch (e) {
      if (id !== runId.current) return;
      setPhase("error");
      setError(e instanceof Error ? e.message : "Fingerprinting failed.");
      setTip("Try selecting the file again.");
    }
  }, []);

  const reset = useCallback(() => {
    runId.current++;
    setFileState(null);
    setPreflight(null);
    setFp(null);
    setPhase("idle");
    setProgress(0);
    setError(null);
    setTip(null);
  }, []);

  return { file, preflight, fp, phase, progress, error, tip, pickFile, reset };
}
