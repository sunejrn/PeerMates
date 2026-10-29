"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Spinner } from "@/components/ui/spinner";
import { toast } from "sonner";
import { useSession } from "@/lib/auth-client";
import { AuthModal } from "@/components/auth/AuthModal";
import { JoinByCode } from "@/components/room/JoinByCode";
import { useLocalFilePick } from "@/hooks/useLocalFilePick";
import {
  formatBytes,
  formatDuration,
  LOCAL_FILE_ACCEPT,
  RIGHTS_NOTICE,
  type LocalFingerprint,
} from "@/lib/video/localfile";
import {
  deleteLocalFile,
  fpFileKey,
  loadLocalFileRecord,
  PENDING_CREATE_FILE_KEY,
  roomFileKey,
  saveLocalFile,
  saveRoomFingerprintCache,
} from "@/lib/video/localFileDb";
import {
  clearPendingCreate,
  readPendingCreate,
  savePendingCreate,
} from "@/lib/rooms/pendingIntents";

function defaultTitle(file: File | null): string {
  return file?.name.replace(/\.[^.]+$/, "") || "";
}

export function RoomLobby() {
  const router = useRouter();
  const { data: session, isPending: authPending } = useSession();
  const [title, setTitle] = useState("");
  const [isCreating, setIsCreating] = useState(false);
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [rightsOk, setRightsOk] = useState(false);
  const filePick = useLocalFilePick();
  const resumeRanRef = useRef(false);

  /** Server error codes → human messages (never show raw codes in toasts). */
  const friendlyCreateError = (data: {
    error?: string;
    message?: string;
    retryAfter?: number;
  }) => {
    if (data.error === "RATE_LIMITED") {
      const wait =
        typeof data.retryAfter === "number" && data.retryAfter > 0
          ? ` Try again in ${data.retryAfter}s.`
          : "";
      return `Too many rooms created.${wait}`;
    }
    return data.message || data.error || "Could not create the room.";
  };

  const createLocalFileRoom = useCallback(
    async (file: File, fp: LocalFingerprint, roomTitle: string) => {
      setIsCreating(true);
      try {
        const res = await fetch("/api/rooms", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            title: roomTitle.trim() || defaultTitle(file) || "PeerMates Party",
            localFile: fp,
          }),
        });

        const data = await res.json().catch(() => ({}));
        if (!res.ok || data.error) {
          if (data.error === "AUTH_REQUIRED") {
            // Session expired mid-flow: preserve the exact same pick and
            // finish automatically after sign-in.
            savePendingCreate({ title: roomTitle, fp });
            await saveLocalFile(PENDING_CREATE_FILE_KEY, file, fp.fpId);
            setShowAuthModal(true);
            return;
          }
          throw new Error(friendlyCreateError(data));
        }

        // Keep the picked file on this device so the room can load it
        // immediately (no second picker) and on future revisits.
        await Promise.all([
          saveLocalFile(roomFileKey(data.slug), file, fp.fpId),
          saveLocalFile(fpFileKey(fp.fpId), file, fp.fpId),
        ]).catch(() => false);
        await deleteLocalFile(PENDING_CREATE_FILE_KEY);
        clearPendingCreate();
        saveRoomFingerprintCache(data.slug, fp);

        toast.success("Party created.");
        router.push(`/room/${data.slug}`);
      } catch (err: unknown) {
        toast.error(
          err instanceof Error ? err.message : "Could not create the party."
        );
      } finally {
        setIsCreating(false);
      }
    },
    [router]
  );

  const handleCreateRoom = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!filePick.file || !filePick.fp || filePick.phase !== "ready") {
      toast.error("Pick a playable video file first.");
      return;
    }
    if (!rightsOk) {
      toast.error("Confirm you have the right to play this file.");
      return;
    }

    // No guest creation: sign in first, then finish this exact room setup
    // automatically (title + file are persisted locally).
    if (!session?.user) {
      savePendingCreate({ title: title.trim(), fp: filePick.fp });
      await saveLocalFile(
        PENDING_CREATE_FILE_KEY,
        filePick.file,
        filePick.fp.fpId
      );
      setShowAuthModal(true);
      return;
    }

    await createLocalFileRoom(filePick.file, filePick.fp, title);
  };

  // After the OAuth round-trip, pick up the saved intent and create the room
  // without making the user re-enter the title or re-pick the movie.
  useEffect(() => {
    if (resumeRanRef.current || authPending || !session?.user) return;
    const pending = readPendingCreate();
    if (!pending) return;
    resumeRanRef.current = true;
    void (async () => {
      const stored = await loadLocalFileRecord(PENDING_CREATE_FILE_KEY);
      if (!stored || stored.fpId !== pending.fp.fpId) {
        clearPendingCreate();
        toast.error("Sign-in complete. Please pick your movie file once more.");
        return;
      }
      await createLocalFileRoom(stored.file, pending.fp, pending.title);
    })();
  }, [authPending, session?.user, createLocalFileRoom]);

  return (
    <div className="w-full">
      <div className="grid grid-cols-1 lg:grid-cols-2 items-stretch justify-center gap-6 max-w-5xl mx-auto">
        {/* Form Card */}
        <Card className="w-full border-border bg-card/70 p-5 sm:p-8 backdrop-blur-xl shadow-none rounded-2xl flex flex-col justify-between">
          <div className="space-y-2 mb-6 text-left">
            <h2 className="text-xl sm:text-2xl text-card-foreground tracking-tight">
              create a room
            </h2>
            <p className="text-xs sm:text-sm text-muted-foreground">
              Pick a movie from your device
            </p>
          </div>

          <form
            onSubmit={handleCreateRoom}
            className="space-y-4 sm:space-y-5 text-left flex-1 flex flex-col justify-between"
          >
            <div className="space-y-4">
              <div className="space-y-1.5">
                <label className="text-xs text-muted-foreground">
                  party title (optional)
                </label>
                <Input
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="e.g. Movie night with friends"
                  className="h-11 sm:h-10 bg-background/80 border-input text-foreground focus-visible:ring-violet-500 text-sm"
                />
              </div>

              <div className="space-y-2">
                <span className="text-xs text-muted-foreground">
                  your movie file
                </span>
                <label className="flex min-h-11 cursor-pointer items-center justify-center rounded-lg border border-dashed border-border bg-background/60 px-3 py-2 text-xs text-foreground  transition-all">
                  <input
                    type="file"
                    accept={LOCAL_FILE_ACCEPT}
                    className="hidden"
                    aria-label="Choose a movie file on this device"
                    onChange={(e) => {
                      const f = e.target.files?.[0] ?? null;
                      setRightsOk(false);
                      if (f && !title) {
                        setTitle(defaultTitle(f));
                      }
                      void filePick.pickFile(f);
                      e.target.value = "";
                    }}
                  />
                  📂 {filePick.file ? filePick.file.name : "Choose movie file…"}
                </label>

                {(filePick.phase === "preflight" ||
                  filePick.phase === "fingerprint") && (
                  <div className="space-y-1.5" role="status">
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <Spinner className="shrink-0 text-violet-500" />
                      {filePick.phase === "preflight"
                        ? "Checking compatibility…"
                        : `Fingerprinting (3 × 1 MB)… ${Math.round(
                            filePick.progress * 100
                          )}%`}
                    </div>
                    {filePick.phase === "fingerprint" && (
                      <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                        <div
                          className="h-full bg-violet-500 transition-all"
                          style={{
                            width: `${Math.round(filePick.progress * 100)}%`,
                          }}
                        />
                      </div>
                    )}
                  </div>
                )}

                {filePick.phase === "error" && (
                  <div
                    className="rounded-lg border border-red-500/30 bg-red-500/5 px-3 py-2 text-xs space-y-1"
                    role="alert"
                  >
                    <p className="text-red-600 dark:text-red-400">
                      ❌ {filePick.error}
                    </p>
                    {filePick.tip && (
                      <p className="text-muted-foreground">💡 {filePick.tip}</p>
                    )}
                  </div>
                )}

                {filePick.phase === "ready" && filePick.fp && (
                  <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 px-3 py-2 text-xs space-y-1">
                    <p className="text-emerald-700 dark:text-emerald-300">
                      ✅ Playable here. {formatBytes(filePick.fp.size)} ·{" "}
                      {formatDuration(filePick.fp.duration)}
                    </p>
                    {filePick.preflight?.warning && (
                      <p className="text-amber-700 dark:text-amber-300">
                        ⚠️ {filePick.preflight.warning}
                      </p>
                    )}
                    <p className="text-muted-foreground">
                      Your pick is saved on this device, so the room opens
                      straight into the movie without asking again.
                    </p>
                  </div>
                )}

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
              </div>
            </div>

            {/* Submit Button - large 44px+ tap target */}
            <Button
              type="submit"
              disabled={
                isCreating ||
                filePick.phase !== "ready" ||
                !filePick.fp ||
                !rightsOk
              }
              className="w-full h-12 sm:h-11 mt-4 bg-[#333] dark:bg-[#f5f5f5] dark:text-[#333333] border text-[#f5f5f5] shadow-none transition-all cursor-pointer"
            >
              {isCreating ? (
                <span className="flex items-center gap-2">
                  <Spinner className="text-[#f5f5f5]" />
                  creating room...
                </span>
              ) : (
                "create room"
              )}
            </Button>
          </form>
        </Card>

        {/* Join with a code — second column on lg/xl, stacked on mobile */}
        <div className="flex w-full">
          <JoinByCode />
        </div>
      </div>

      <AuthModal
        open={showAuthModal}
        onOpenChange={setShowAuthModal}
        title="Sign in to create this party"
        description="Sign in to create a room. Your title and movie file are saved — the room is created automatically right after you sign in."
      />
    </div>
  );
}
