"use client";

import { useRef, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useLocalFilePick } from "@/hooks/useLocalFilePick";
import {
  compareFingerprints,
  createLocalObjectUrl,
  formatBytes,
  formatDuration,
  LOCAL_FILE_ACCEPT,
  RIGHTS_NOTICE,
  type LocalFingerprint,
} from "@/lib/video/localfile";

interface LocalFileGateProps {
  /** Host fingerprint to compare against (null while loading/failed). */
  hostFingerprint: LocalFingerprint | null;
  hostFileLoading: boolean;
  hostFileError: string | null;
  onRetryHostFile: () => void;
  /** Host/co-hosts may promote their file to the room file. */
  isPrivileged: boolean;
  /** Currently playing local file (if any). */
  hasActiveFile: boolean;
  activeFileName: string | null;
  activeMatch: boolean | null;
  onFileJoin: (
    file: File,
    objectUrl: string,
    fp: LocalFingerprint,
    match: boolean
  ) => void;
  onFileClear: () => void;
  /** Privileged: replace the room's file with this fingerprint. */
  onMakeRoomFile: (fp: LocalFingerprint, file: File) => Promise<void>;
  publishMatch: (match: boolean | null) => void;
}

export function MatchBadge({ match }: { match: boolean | null }) {
  if (match === true) {
    return (
      <Badge className="bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/30 text-[10px]">
        ✅ Match
      </Badge>
    );
  }
  if (match === false) {
    return (
      <Badge className="bg-red-500/15 text-red-600 dark:text-red-400 border-red-500/30 text-[10px]">
        ⚠️ Different file
      </Badge>
    );
  }
  return (
    <Badge variant="outline" className="text-[10px] text-muted-foreground">
      No file yet
    </Badge>
  );
}

/**
 * "My Files" gate: pick the same movie on this device, run the
 * compatibility pre-flight, fingerprint it, and compare against the host.
 * Nothing is uploaded — playback uses a per-device blob: URL.
 */
export function LocalFileGate({
  hostFingerprint,
  hostFileLoading,
  hostFileError,
  onRetryHostFile,
  isPrivileged,
  hasActiveFile,
  activeFileName,
  activeMatch,
  onFileJoin,
  onFileClear,
  onMakeRoomFile,
  publishMatch,
}: LocalFileGateProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const { file, preflight, fp, phase, progress, error, tip, pickFile, reset } =
    useLocalFilePick();
  const [rightsOk, setRightsOk] = useState(false);
  const [makingRoomFile, setMakingRoomFile] = useState(false);

  const cmp =
    hostFingerprint && fp ? compareFingerprints(hostFingerprint, fp) : null;
  // No host fingerprint (fetch failed) => can't verify; warn but allow.
  const unverifiable = !hostFingerprint && !!fp;

  const handleJoin = () => {
    if (!file || !fp || !rightsOk) return;
    const url = createLocalObjectUrl(file);
    const match = cmp ? cmp.match : true;
    publishMatch(cmp ? cmp.match : null);
    onFileJoin(file, url, fp, match);
  };

  const handleClear = () => {
    reset();
    setRightsOk(false);
    publishMatch(null);
    onFileClear();
  };

  const handleMakeRoomFile = async () => {
    if (!fp || !file) return;
    try {
      setMakingRoomFile(true);
      await onMakeRoomFile(fp, file);
    } finally {
      setMakingRoomFile(false);
    }
  };

  return (
    <Card className="border-border bg-card/60 p-3 sm:p-4 rounded-xl backdrop-blur-sm shadow-sm space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          📁 My Files — play from this device
        </h3>
        {hasActiveFile && <MatchBadge match={activeMatch} />}
      </div>

      {/* Host file reference */}
      {hostFileLoading ? (
        <div className="flex items-center gap-2 text-xs text-muted-foreground" role="status">
          <span className="h-4 w-4 animate-spin rounded-full border-2 border-violet-500 border-t-transparent" />
          Loading host file info…
        </div>
      ) : hostFileError || !hostFingerprint ? (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-xs text-amber-700 dark:text-amber-300 space-y-2">
          <p>⚠️ {hostFileError || "Host file info unavailable."}</p>
          <Button
            size="sm"
            variant="outline"
            onClick={onRetryHostFile}
            className="min-h-11 text-xs"
          >
            Retry
          </Button>
        </div>
      ) : (
        <div className="rounded-lg border border-border/70 bg-background/50 px-3 py-2 text-xs space-y-0.5">
          <p className="font-medium text-foreground truncate">
            🎬 Host file: {hostFingerprint.name}
          </p>
          <p className="text-[11px] text-muted-foreground font-mono">
            {formatBytes(hostFingerprint.size)} · {formatDuration(hostFingerprint.duration)}
          </p>
          <p className="text-[11px] text-muted-foreground">
            Pick this exact file on your device — timestamps sync, bytes stay local.
          </p>
        </div>
      )}

      {/* Active file compact bar */}
      {hasActiveFile ? (
        <div className="flex items-center gap-2 rounded-lg border border-border/70 bg-background/50 px-3 py-2">
          <span className="min-w-0 flex-1 truncate text-xs font-medium text-foreground">
            ▶ {activeFileName}
          </span>
          <Button
            size="sm"
            variant="outline"
            onClick={handleClear}
            className="min-h-11 text-xs shrink-0"
          >
            Change
          </Button>
        </div>
      ) : (
        <div className="space-y-2">
          <input
            ref={inputRef}
            type="file"
            accept={LOCAL_FILE_ACCEPT}
            className="hidden"
            aria-label="Choose a video file on this device"
            onChange={(e) => {
              const f = e.target.files?.[0] ?? null;
              setRightsOk(false);
              void pickFile(f);
              // Allow re-picking the same file.
              e.target.value = "";
            }}
          />
          <Button
            type="button"
            variant="outline"
            onClick={() => inputRef.current?.click()}
            className="w-full min-h-11 text-xs border-dashed"
          >
            📂 Choose movie file on this device
            {file ? ` — ${file.name}` : ""}
          </Button>

          {/* Preflight / fingerprint progress */}
          {(phase === "preflight" || phase === "fingerprint") && (
            <div className="space-y-1.5" role="status">
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <span className="h-4 w-4 animate-spin rounded-full border-2 border-violet-500 border-t-transparent" />
                {phase === "preflight"
                  ? "Checking compatibility…"
                  : `Fingerprinting (reads 3 × 1 MB, not the whole file)… ${Math.round(progress * 100)}%`}
              </div>
              {phase === "fingerprint" && (
                <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                  <div
                    className="h-full bg-violet-500 transition-all"
                    style={{ width: `${Math.round(progress * 100)}%` }}
                  />
                </div>
              )}
            </div>
          )}

          {/* Fatal preflight error with fix tip */}
          {phase === "error" && (
            <div className="rounded-lg border border-red-500/30 bg-red-500/5 px-3 py-2 text-xs space-y-1" role="alert">
              <p className="font-semibold text-red-600 dark:text-red-400">❌ {error}</p>
              {tip && <p className="text-muted-foreground">💡 {tip}</p>}
              <p className="text-muted-foreground">
                No matching file? You can still watch via “Stream from host” below.
              </p>
            </div>
          )}

          {/* Ready: file meta + comparison */}
          {phase === "ready" && fp && (
            <div className="rounded-lg border border-border/70 bg-background/50 px-3 py-2 text-xs space-y-2">
              <div className="flex items-center justify-between gap-2">
                <span className="min-w-0 truncate font-medium text-foreground">
                  {fp.name}
                </span>
                {cmp ? (
                  <MatchBadge match={cmp.match} />
                ) : (
                  <Badge variant="outline" className="text-[10px] text-muted-foreground shrink-0">
                    Unverified
                  </Badge>
                )}
              </div>
              <p className="text-[11px] text-muted-foreground font-mono">
                {formatBytes(fp.size)} · {formatDuration(fp.duration)}
              </p>
              {preflight?.warning && (
                <p className="text-[11px] text-amber-700 dark:text-amber-300">
                  ⚠️ {preflight.warning}
                </p>
              )}
              {cmp && !cmp.match && (
                <div className="space-y-1" role="alert">
                  <p className="font-semibold text-red-600 dark:text-red-400">
                    This looks like a different file than the host&apos;s.
                  </p>
                  <ul className="list-disc pl-4 text-muted-foreground space-y-0.5">
                    {cmp.reasons.map((r) => (
                      <li key={r}>{r}</li>
                    ))}
                  </ul>
                  <p className="text-muted-foreground">
                    💡 Tip: get the exact same file/cut as the host — different cuts drift
                    apart even when timestamps sync. Or use “Stream from host” below.
                  </p>
                </div>
              )}
              {unverifiable && (
                <p className="text-[11px] text-amber-700 dark:text-amber-300">
                  ⚠️ Host fingerprint unavailable — sync may drift if your file differs.
                </p>
              )}

              {/* Privileged: adopt this file as the room file */}
              {isPrivileged && cmp && !cmp.match && (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={makingRoomFile}
                  onClick={handleMakeRoomFile}
                  className="w-full min-h-11 text-xs border-cyan-500/40 text-cyan-700 dark:text-cyan-300"
                >
                  {makingRoomFile ? "Switching…" : "🎬 Use my file for everyone"}
                </Button>
              )}

              {/* Rights notice + join */}
              <label className="flex items-start gap-2 cursor-pointer rounded-md px-1 py-2 min-h-11">
                <input
                  type="checkbox"
                  checked={rightsOk}
                  onChange={(e) => setRightsOk(e.target.checked)}
                  className="mt-0.5 h-5 w-5 shrink-0 accent-violet-600"
                />
                <span className="text-[11px] leading-snug text-muted-foreground">
                  {RIGHTS_NOTICE}
                </span>
              </label>
              <Button
                onClick={handleJoin}
                disabled={!rightsOk}
                className="w-full min-h-11 bg-violet-600 hover:bg-violet-500 text-white text-xs font-semibold disabled:opacity-50"
              >
                ▶ Join synced playback
              </Button>
            </div>
          )}
        </div>
      )}
    </Card>
  );
}
