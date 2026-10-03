"use client";

import { PartyMember } from "@/lib/stream/realtimeClient";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Badge } from "@/components/ui/badge";

interface PresenceBarProps {
  members: PartyMember[];
  currentUserId: string;
  hostId: string;
  /** Data Saver: never download avatar images, render initials instead. */
  noAvatars?: boolean;
}

/** Max avatars rendered — counts stay exact so 500 viewers stay cheap. */
const MAX_AVATARS = 12;

export function PresenceBar({
  members,
  currentUserId,
  hostId,
  noAvatars = false,
}: PresenceBarProps) {
  const visible = members.slice(0, MAX_AVATARS);
  const overflow = members.length - visible.length;

  return (
    <div className="flex items-center gap-2 overflow-x-auto py-1 px-1 scrollbar-none">
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground font-medium mr-1 shrink-0">
        <span className="flex h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
        <span>Watching ({members.length}):</span>
      </div>

      <div className="flex -space-x-2 overflow-hidden items-center py-1">
        {visible.map((member) => {
          const isHost = member.id === hostId;
          const isCohost = member.role === "cohost";
          const isMe = member.id === currentUserId;

          return (
            <Tooltip key={member.id}>
              <TooltipTrigger>
                <div className="relative cursor-pointer transition-transform hover:z-20 hover:scale-110">
                  {member.image && !noAvatars ? (
                    <img
                      src={member.image}
                      alt={member.name}
                      loading="lazy"
                      className={`h-8 w-8 rounded-full border-2 object-cover ${
                        isHost
                          ? "border-amber-500 shadow-md shadow-amber-500/20"
                          : isCohost
                            ? "border-cyan-500"
                            : isMe
                              ? "border-violet-500"
                              : "border-border"
                      }`}
                    />
                  ) : (
                    <div
                      className={`flex h-8 w-8 items-center justify-center rounded-full border-2 text-xs font-bold text-white ${
                        isHost
                          ? "bg-amber-600 border-amber-500"
                          : isCohost
                            ? "bg-cyan-600 border-cyan-500"
                            : isMe
                              ? "bg-violet-600 border-violet-500"
                              : "bg-muted-foreground/40 border-border text-foreground"
                      }`}
                    >
                      {member.name.charAt(0).toUpperCase()}
                    </div>
                  )}

                  {/* Host Crown / Co-host Badge */}
                  {isHost && (
                    <div className="absolute -top-1.5 -right-1 flex h-4 w-4 items-center justify-center rounded-full bg-amber-500 text-[9px] text-black font-bold shadow">
                      👑
                    </div>
                  )}
                  {!isHost && isCohost && (
                    <div className="absolute -top-1.5 -right-1 flex h-4 w-4 items-center justify-center rounded-full bg-cyan-500 text-[9px] text-black font-bold shadow">
                      🎬
                    </div>
                  )}
                </div>
              </TooltipTrigger>
              <TooltipContent
                side="bottom"
                className="border-border bg-popover text-popover-foreground text-xs shadow-md"
              >
                <div className="flex items-center gap-1.5 font-medium">
                  <span>{member.name}</span>
                  {isMe && <span className="text-muted-foreground">(You)</span>}
                  {isHost && (
                    <Badge
                      variant="outline"
                      className="border-amber-500/40 bg-amber-500/10 text-amber-600 dark:text-amber-400 text-[10px] px-1 py-0"
                    >
                      Host
                    </Badge>
                  )}
                  {!isHost && isCohost && (
                    <Badge
                      variant="outline"
                      className="border-cyan-500/40 bg-cyan-500/10 text-cyan-600 dark:text-cyan-400 text-[10px] px-1 py-0"
                    >
                      Co-host
                    </Badge>
                  )}
                </div>
              </TooltipContent>
            </Tooltip>
          );
        })}
        {overflow > 0 && (
          <div
            className="flex h-8 min-w-8 items-center justify-center rounded-full border-2 border-border bg-muted px-1.5 text-[10px] font-bold text-muted-foreground"
            title={`${overflow} more viewers`}
          >
            +{overflow}
          </div>
        )}
      </div>
    </div>
  );
}
