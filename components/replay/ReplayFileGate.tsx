"use client";

import { useRef } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { useLocalFilePick } from "@/hooks/useLocalFilePick";
import {
  compareFingerprints,
  createLocalObjectUrl,
  formatBytes,
  LOCAL_FILE_ACCEPT,
  RIGHTS_NOTICE,
  type LocalFingerprint,
} from "@/lib/video/localfile";

/**
 * Local-file replay gate: the movie was never stored, so the viewer picks
 * their own copy and its fingerprint is checked against the party's.
 * Nothing uploads — bytes stay on device.
 */
export function ReplayFileGate({
  expected,
  onFile,
}: {
  /** Party fingerprint, or null when it expired (any file plays). */
  expected: LocalFingerprint | null;
  onFile: (file: File, url: string, match: boolean) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const pick = useLocalFilePick();

  const handle = (f: File | undefined) => {
    if (!f) return;
    void pick.pickFile(f);
  };

  const confirm = () => {
    if (!pick.file || !pick.fp || pick.phase !== "ready") return;
    const match = expected ? compareFingerprints(pick.fp, expected).match : true;
    onFile(pick.file, createLocalObjectUrl(pick.file), match);
  };

  return (
    <Card className="border-border bg-card p-4 sm:p-5 rounded-lg space-y-3 text-center">
      <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-lg bg-muted border border-border text-2xl" aria-hidden>
        📁
      </div>
      <h3 className="text-base font-semibold text-foreground">Bring your own copy</h3>
      <p className="text-xs text-muted-foreground leading-relaxed">
        {expected
          ? "This party used a local movie file (never uploaded). Pick the same file on this device — its fingerprint is checked automatically."
          : "Pick the movie file on this device to start the replay."}{" "}
        {pick.fp ? `Detected: ${pick.file?.name} (${formatBytes(pick.fp.size)}).` : ""}
      </p>
      <input
        ref={inputRef}
        type="file"
        accept={LOCAL_FILE_ACCEPT}
        className="hidden"
        aria-label="Choose the movie file"
        onChange={(e) => {
          const f = e.target.files?.[0] ?? null;
          e.target.value = "";
          handle(f ?? undefined);
        }}
      />
      {(pick.phase === "preflight" || pick.phase === "fingerprint") && (
        <p className="flex items-center justify-center gap-2 text-xs text-muted-foreground" role="status">
          <Spinner /> Checking your file…
        </p>
      )}
      {pick.phase === "error" && (
        <p className="text-xs text-red-600 dark:text-red-400" role="alert">❌ {pick.error}</p>
      )}
      <div className="flex flex-col min-[420px]:flex-row gap-2">
        <Button
          type="button"
          variant="outline"
          onClick={() => inputRef.current?.click()}
          className="h-12 min-h-11 flex-1 text-xs cursor-pointer"
        >
          Choose movie file…
        </Button>
        <Button
          type="button"
          onClick={confirm}
          disabled={pick.phase !== "ready" || !pick.file}
          className="h-12 min-h-11 flex-1 text-xs cursor-pointer disabled:opacity-50"
        >
          Start replay
        </Button>
      </div>
      <p className="text-[11px] text-muted-foreground">{RIGHTS_NOTICE}</p>
    </Card>
  );
}
