"use client";

import { useMemo, useRef, useState } from "react";
import { PartyMember, RoomRole } from "@/lib/stream/realtimeClient";
import { ControlRequestItem } from "@/hooks/useWatchSync";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { toast } from "sonner";

interface ViewerListProps {
  members: PartyMember[];
  currentUserId: string;
  hostId: string;
  /** True for host + co-hosts (may kick/mute). */
  isPrivileged: boolean;
  /** True only for the host (may promote/demote + approve requests). */
  isHost: boolean;
  mutedIds?: string[];
  controlRequests?: ControlRequestItem[];
  /** "My Files" rooms: show per-viewer Match / Different file badges. */
  showFileMatch?: boolean;
  /** Data Saver: never download avatar images, render initials instead. */
  noAvatars?: boolean;
  onPromote: (userId: string) => Promise<void>;
  onDemote: (userId: string) => Promise<void>;
  onKick: (userId: string) => Promise<void>;
  onMute: (userId: string) => Promise<void>;
  onUnmute: (userId: string) => Promise<void>;
  onApproveRequest: (userId: string) => Promise<void>;
  onDenyRequest: (userId: string) => Promise<void>;
}

const ROW_HEIGHT = 64;
// Five rows visible, then scroll — scrollbar hidden for a clean look.
const LIST_MAX_HEIGHT = 320;
const OVERSCAN = 5;

function RoleBadge({ role }: { role: RoomRole }) {
  if (role === "host") {
    return (
      <Badge variant="outline" className="text-[10px] px-1.5 rounded-lg">
        Host
      </Badge>
    );
  }
  if (role === "cohost") {
    return (
      <Badge variant="outline" className="text-[10px] px-1.5 rounded-lg">
        Co-host
      </Badge>
    );
  }
  return (
    <Badge variant="outline" className="text-[10px] px-1.5 text-muted-foreground rounded-lg">
      Viewer
    </Badge>
  );
}

function FileMatchBadge({ match }: { match: boolean | null | undefined }) {
  if (match === true) {
    return (
      <Badge variant="outline" className="text-[10px] px-1.5 rounded-lg">
        Match
      </Badge>
    );
  }
  if (match === false) {
    return (
      <Badge variant="outline" className="text-[10px] px-1.5 rounded-lg">
        Different file
      </Badge>
    );
  }
  return (
    <Badge variant="outline" className="text-[10px] px-1.5 text-muted-foreground rounded-lg">
      No file
    </Badge>
  );
}

function Avatar({ member, ring, noAvatars = false }: { member: PartyMember; ring: string; noAvatars?: boolean }) {
  if (member.image && !noAvatars) {
    return (
      <img
        src={member.image}
        alt={member.name}
        loading="lazy"
        className={`h-9 w-9 shrink-0 rounded-full border-2 object-cover ${ring}`}
      />
    );
  }
  return (
    <div
      className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-xs font-semibold bg-muted text-foreground border ${ring}`}
    >
      {member.name.charAt(0).toUpperCase()}
    </div>
  );
}

/**
 * Virtualized viewer list: stays fast with 500 members by rendering only
 * the visible window (+ overscan). Counts are always exact; rows are
 * expandable so action buttons keep 44px tap targets without horizontal
 * scrolling at 360px.
 */
export function ViewerList({
  members,
  currentUserId,
  hostId,
  isPrivileged,
  isHost,
  mutedIds = [],
  controlRequests = [],
  showFileMatch = false,
  noAvatars = false,
  onPromote,
  onDemote,
  onKick,
  onMute,
  onUnmute,
  onApproveRequest,
  onDenyRequest,
}: ViewerListProps) {
  const [query, setQuery] = useState("");
  const [scrollTop, setScrollTop] = useState(0);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const mutedSet = useMemo(() => new Set(mutedIds), [mutedIds]);

  const sorted = useMemo(() => {
    const rank = (m: PartyMember) =>
      m.id === hostId ? 0 : m.role === "cohost" ? 1 : 2;
    const q = query.trim().toLowerCase();
    return [...members]
      .sort((a, b) => rank(a) - rank(b) || a.joinedAt - b.joinedAt)
      .filter((m) => !q || m.name.toLowerCase().includes(q));
  }, [members, hostId, query]);

  const cohostCount = useMemo(
    () => members.filter((m) => m.role === "cohost").length,
    [members]
  );

  // Windowing math
  const totalHeight = sorted.length * ROW_HEIGHT;
  const viewportH = Math.min(LIST_MAX_HEIGHT, Math.max(ROW_HEIGHT * 3, totalHeight));
  const startIdx = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN);
  const endIdx = Math.min(
    sorted.length,
    Math.ceil((scrollTop + viewportH) / ROW_HEIGHT) + OVERSCAN
  );
  const visible = sorted.slice(startIdx, endIdx);

  const runAction = async (id: string, fn: (uid: string) => Promise<void>) => {
    try {
      setPendingId(`${id}`);
      await fn(id);
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Action failed. Try again.");
    } finally {
      setPendingId(null);
    }
  };

  const canModerate = (m: PartyMember) => {
    if (!isPrivileged || m.id === currentUserId || m.id === hostId) return false;
    // Co-hosts may only moderate viewers; the host may moderate anyone
    // except themselves (handled above).
    if (!isHost && m.role !== "viewer") return false;
    return true;
  };

  return (
    <Card className="border-border bg-card rounded-lg overflow-hidden">
      <div className="px-3 sm:px-4 pt-3 pb-2 space-y-2">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-xs font-medium text-muted-foreground">
            People
          </h3>
          <span className="text-[11px] font-mono text-muted-foreground">
            {members.length} watching
            {cohostCount > 0 && ` · ${cohostCount} co-host${cohostCount === 1 ? "" : "s"}`}
          </span>
        </div>

        {/* Pending control requests (host sees approve/deny) */}
        {isPrivileged && controlRequests.length > 0 && (
          <div className="rounded-lg border border-border bg-muted p-2 space-y-1.5">
            <p className="text-[11px] font-medium px-1">
              {controlRequests.length} control request{controlRequests.length === 1 ? "" : "s"}
            </p>
            {controlRequests.map((r) => (
              <div
                key={r.userId}
                className="flex items-center gap-2 rounded-lg bg-background px-2 py-1.5"
              >
                <span className="min-w-0 flex-1 truncate text-xs font-medium">
                  {r.name}
                </span>
                {isHost ? (
                  <div className="flex shrink-0 gap-1.5">
                    <Button
                      size="sm"
                      disabled={pendingId === r.userId}
                      onClick={() => runAction(r.userId, onApproveRequest)}
                      className="min-h-11 px-3 text-xs rounded-lg"
                    >
                      {pendingId === r.userId ? "…" : "Approve"}
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={pendingId === r.userId}
                      onClick={() => runAction(r.userId, onDenyRequest)}
                      className="min-h-11 px-3 text-xs"
                    >
                      Dismiss
                    </Button>
                  </div>
                ) : (
                  <span className="text-[10px] text-muted-foreground shrink-0">
                    Host approval needed
                  </span>
                )}
              </div>
            ))}
          </div>
        )}

        {members.length > 8 && (
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search viewers..."
            aria-label="Search viewers"
            className="h-11 bg-background/80 text-sm"
          />
        )}
      </div>

      {sorted.length === 0 ? (
        <p className="px-4 pb-4 text-xs text-muted-foreground">
          {query ? "No viewers match your search." : "No one else is here yet."}
        </p>
      ) : (
        <div
          ref={scrollRef}
          onScroll={(e) => setScrollTop((e.target as HTMLDivElement).scrollTop)}
          className="no-scrollbar overflow-y-auto overscroll-contain"
          style={{ maxHeight: LIST_MAX_HEIGHT }}
          role="list"
          aria-label="Room viewers"
        >
          <div style={{ height: totalHeight, position: "relative" }}>
            {visible.map((m, i) => {
              const idx = startIdx + i;
              const isMe = m.id === currentUserId;
              const expanded = expandedId === m.id;
              const busy = pendingId === m.id;
              const showActions = canModerate(m);
              return (
                <div
                  key={m.id}
                  role="listitem"
                  style={{
                    position: "absolute",
                    top: idx * ROW_HEIGHT,
                    left: 0,
                    right: 0,
                    height: ROW_HEIGHT,
                  }}
                  className="border-t border-border/50 first:border-t-0"
                >
                  <button
                    type="button"
                    onClick={() =>
                      setExpandedId((prev) => (prev === m.id ? null : m.id))
                    }
                    aria-expanded={expanded}
                    className="flex min-h-[44px] w-full items-center gap-2.5 px-3 sm:px-4 py-2 text-left hover:bg-muted/40 transition-colors cursor-pointer"
                  >
                    <Avatar
                      member={m}
                      noAvatars={noAvatars}
                      ring="border-border"
                    />
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-1.5">
                        <span className="truncate text-xs font-semibold text-foreground">
                          {m.name}
                        </span>
                        {isMe && (
                          <span className="text-[10px] text-muted-foreground shrink-0">
                            (You)
                          </span>
                        )}
                      </span>
                      <span className="mt-0.5 flex items-center gap-1.5 flex-wrap">
                        <RoleBadge role={m.role} />
                        {mutedSet.has(m.id) && (
                          <Badge variant="outline" className="text-[10px] px-1.5 rounded-lg">
                            Muted
                          </Badge>
                        )}
                        {showFileMatch && <FileMatchBadge match={m.fileMatch} />}
                      </span>
                    </span>
                    {showActions && (
                      <span
                        className={`shrink-0 text-muted-foreground transition-transform text-xs ${expanded ? "rotate-180" : ""}`}
                        aria-hidden
                      >
                        ▼
                      </span>
                    )}
                  </button>

                  {expanded && showActions && (
                    <div className="absolute top-full left-0 right-0 z-20 flex items-center gap-1.5 border-y border-border bg-card px-3 sm:px-4 py-2 shadow-xl">
                      {isHost && m.role === "viewer" && (
                        <Button
                          size="sm"
                          disabled={busy}
                          onClick={() => runAction(m.id, onPromote)}
                          className="min-h-11 px-3 text-[11px] rounded-lg"
                        >
                          {busy ? "…" : "Make co-host"}
                        </Button>
                      )}
                      {isHost && m.role === "cohost" && (
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={busy}
                          onClick={() => runAction(m.id, onDemote)}
                          className="min-h-11 px-3 text-[11px]"
                        >
                          {busy ? "…" : "Demote"}
                        </Button>
                      )}
                      {mutedSet.has(m.id) ? (
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={busy}
                          onClick={() => runAction(m.id, onUnmute)}
                          className="min-h-11 px-3 text-[11px]"
                        >
                          {busy ? "…" : "Unmute"}
                        </Button>
                      ) : (
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={busy}
                          onClick={() => runAction(m.id, onMute)}
                          className="min-h-11 px-3 text-[11px]"
                        >
                          {busy ? "…" : "Mute"}
                        </Button>
                      )}
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={busy}
                        onClick={() => runAction(m.id, onKick)}
                        className="min-h-11 px-3 text-[11px] rounded-lg"
                      >
                        {busy ? "…" : "Kick"}
                      </Button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </Card>
  );
}
