"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { P2PFileHostSession } from "@/lib/webrtc/fileShare";
import type { FileTransferNoticeState } from "@/components/room/FileTransferNotice";
import { formatBytes } from "@/lib/video/localfile";

interface SendFileMember {
  id: string;
  name: string;
  fileMatch?: boolean | null;
  role?: string;
}

interface SendFilePanelProps {
  slug: string;
  myId: string;
  myName: string;
  /** Host's loaded file — the bytes that get sent. */
  file: File | null;
  fileName?: string | null;
  members: SendFileMember[];
  /** Drives the persistent transfer card in the room layout. */
  onTransferChange?: (state: FileTransferNoticeState | null) => void;
}

/**
 * Host-only "Send file" panel for local-file rooms.
 *
 * The host picks which viewers receive the movie (checkboxes + select all);
 * each recipient gets a toast first, then the file streams peer-to-peer and
 * auto-loads into their player so everyone watches in sync. Only the host
 * (and co-hosts the host promotes) keep control.
 */
export function SendFilePanel({
  slug,
  myId,
  myName,
  file,
  fileName,
  members,
  onTransferChange,
}: SendFilePanelProps) {
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [sending, setSending] = useState(false);
  const [progress, setProgress] = useState<Record<string, { sent: number; size: number }>>({});
  const [doneIds, setDoneIds] = useState<Record<string, boolean>>({});
  const sessionRef = useRef<P2PFileHostSession | null>(null);
  const transferIdRef = useRef<string>("");
  const transferNameRef = useRef<string>("");
  const sentRef = useRef<Record<string, number>>({});
  const doneRef = useRef<Record<string, boolean>>({});

  const targets = useMemo(
    () => members.filter((m) => m.id !== myId),
    [members, myId]
  );
  const isSelected = (member: SendFileMember) =>
    selected[member.id] ?? member.fileMatch !== true;

  useEffect(() => {
    return () => {
      sessionRef.current?.stop();
      sessionRef.current = null;
    };
  }, []);

  const allSelected = targets.length > 0 && targets.every(isSelected);
  const selectedIds = targets.filter(isSelected).map((m) => m.id);

  const toggleAll = () => {
    setSelected(() => {
      const next: Record<string, boolean> = {};
      for (const m of targets) next[m.id] = !allSelected;
      return next;
    });
  };

  const handleSend = async () => {
    if (!file) {
      toast.error("Load your movie file first, then send it.");
      return;
    }
    if (selectedIds.length === 0) {
      toast.error("Select at least one viewer to send the file to.");
      return;
    }
    setSending(true);
    setDoneIds({});
    setProgress({});
    sentRef.current = {};
    doneRef.current = {};
    transferIdRef.current = `send-${Date.now()}`;
    transferNameRef.current = file.name;
    const totalBytes = Math.max(1, file.size * selectedIds.length);
    const notify = (next: {
      percent: number;
      phase: FileTransferNoticeState["phase"];
      detail?: string;
    }) => {
      onTransferChange?.({
        id: transferIdRef.current,
        name: transferNameRef.current,
        direction: "send",
        ...next,
      });
    };
    notify({
      percent: 1,
      phase: "sending",
      detail: `Sending to ${selectedIds.length} viewer${selectedIds.length === 1 ? "" : "s"}...`,
    });
    let failed = false;
    try {
      if (!sessionRef.current) {
        sessionRef.current = new P2PFileHostSession(slug, myId, myName || "Host");
      }
      const session = sessionRef.current;
      session.onProgress = (p) => {
        sentRef.current[p.userId] = p.sentBytes;
        setProgress((prev) => ({ ...prev, [p.userId]: { sent: p.sentBytes, size: p.size } }));
        const sent = selectedIds.reduce(
          (sum, id) => sum + (sentRef.current[id] ?? 0),
          0
        );
        notify({
          percent: Math.max(1, Math.min(99, Math.round((sent / totalBytes) * 100))),
          phase: "sending",
          detail: `Sending to ${selectedIds.length} viewer${selectedIds.length === 1 ? "" : "s"}...`,
        });
      };
      session.onDone = (userId) => {
        doneRef.current[userId] = true;
        setDoneIds((prev) => ({ ...prev, [userId]: true }));
        if (selectedIds.every((id) => doneRef.current[id])) {
          notify({
            percent: 100,
            phase: "ready",
            detail: "File sent. Press play to keep watching.",
          });
        }
      };
      session.onError = (userId, message) => {
        failed = true;
        const member = targets.find((m) => m.id === userId);
        toast.error(`${member?.name || "Viewer"}: ${message}`);
        notify({
          percent: 1,
          phase: "error",
          detail: `${member?.name || "Viewer"}: ${message}`,
        });
      };
      toast.success(`Sending ${file.name} to ${selectedIds.length} viewer${selectedIds.length === 1 ? "" : "s"}. Keep this tab open.`);
      // Sequential sends keep host uplink stable (parallel N×bitrate stalls).
      for (const viewerId of selectedIds) {
        try {
          await session.sendTo(file, viewerId);
        } catch (err) {
          failed = true;
          const member = targets.find((m) => m.id === viewerId);
          const message =
            err instanceof Error ? err.message : "Send failed.";
          toast.error(`${member?.name || "Viewer"}: ${message}`);
          notify({
            percent: 1,
            phase: "error",
            detail: `${member?.name || "Viewer"}: ${message}`,
          });
        }
      }
      if (!failed && selectedIds.every((id) => doneRef.current[id])) {
        notify({
          percent: 100,
          phase: "ready",
          detail: "File sent. Press play to keep watching.",
        });
        toast.success("File sent. Viewers can press play when ready.");
      }
    } finally {
      setSending(false);
    }
  };

  return (
    <Card className="border-border bg-card/60 p-3 sm:p-4 rounded-xl backdrop-blur-sm shadow-none space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-xs font-semibold tracking-wider text-muted-foreground">
          Send file to viewers
        </h3>
        <Badge variant="outline" className="text-[10px] text-muted-foreground">
          {selectedIds.length}/{targets.length} selected
        </Badge>
      </div>
      <p className="text-[11px] leading-relaxed text-muted-foreground">
        {file
          ? <>Sending <strong className="text-foreground">{fileName || file.name}</strong> ({formatBytes(file.size)}) peer-to-peer. Recipients get a toast, the file auto-loads on their device, and playback stays in sync. Only you (and co-hosts you promote) keep control.</>
          : "Load your movie in My Files above first. That file is what gets sent."}
      </p>

      {targets.length === 0 ? (
        <p className="text-[11px] text-muted-foreground">No viewers in the room yet. They&apos;ll appear here when they join.</p>
      ) : (
        <div className="space-y-2">
          <label className="flex min-h-11 cursor-pointer items-center gap-2 rounded-lg border border-border/70 bg-background/50 px-3 text-xs font-medium">
            <input
              type="checkbox"
              checked={allSelected}
              onChange={toggleAll}
              className="h-5 w-5 shrink-0 accent-violet-600"
              aria-label="Select all viewers"
            />
            Select all viewers
          </label>
          <div className="max-h-44 space-y-1 overflow-y-auto overscroll-contain no-scrollbar rounded-lg border border-border/60 p-1.5">
            {targets.map((m) => {
              const p = progress[m.id];
              const done = doneIds[m.id];
              return (
                <label
                  key={m.id}
                  className="flex min-h-11 cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-xs "
                >
                  <input
                    type="checkbox"
                    checked={isSelected(m)}
                    onChange={() =>
                      setSelected((prev) => ({ ...prev, [m.id]: !prev[m.id] }))
                    }
                    className="h-5 w-5 shrink-0 accent-violet-600"
                    aria-label={`Send file to ${m.name}`}
                  />
                  <span className="min-w-0 flex-1 truncate font-medium text-foreground">
                    {m.name}
                  </span>
                  {done ? (
                    <Badge className="bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/30 text-[10px] shrink-0">Sent ✓</Badge>
                  ) : p ? (
                    <span className="shrink-0 font-mono text-[10px] text-muted-foreground">
                      {Math.round((p.sent / Math.max(1, p.size)) * 100)}%
                    </span>
                  ) : m.fileMatch === true ? (
                    <Badge variant="outline" className="text-[10px] text-muted-foreground shrink-0">Has file</Badge>
                  ) : (
                    <Badge variant="outline" className="text-[10px] text-amber-700 dark:text-amber-300 border-amber-500/30 shrink-0">Needs file</Badge>
                  )}
                </label>
              );
            })}
          </div>
        </div>
      )}

      <Button
        onClick={handleSend}
        disabled={sending || !file || selectedIds.length === 0}
        className="w-full min-h-11 bg-[#333] dark:bg-[#f5f5f5] dark:text-[#333333] border text-[#f5f5f5] text-xs font-semibold disabled:opacity-50"
      >
        {sending ? "Sending… keep this tab open" : `Send file${selectedIds.length > 0 ? ` to ${selectedIds.length} viewer${selectedIds.length === 1 ? "" : "s"}` : ""}`}
      </Button>
    </Card>
  );
}
