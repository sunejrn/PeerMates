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
                <div className="relative cursor-pointer">
                  {member.image && !noAvatars ? (
                    <img
                      src={member.image}
                      alt={member.name}
                      loading="lazy"
                      className="h-8 w-8 rounded-full border border-border object-cover"
                    />
                  ) : (
                    <div
                      className="flex h-8 w-8 items-center justify-center rounded-full border border-border bg-muted text-xs font-semibold text-foreground"
                    >
                      {member.name.charAt(0).toUpperCase()}
                    </div>
                  )}

                  {/* Host / Co-host marker — text only */}
                  {isHost && (
                    <div className="absolute -top-1.5 -right-1 flex h-4 min-w-4 items-center justify-center rounded-lg border border-border bg-background px-1 text-[9px] font-semibold">
                      H
                    </div>
                  )}
                  {!isHost && isCohost && (
                    <div className="absolute -top-1.5 -right-1 flex h-4 min-w-4 items-center justify-center rounded-lg border border-border bg-background px-1 text-[9px] font-semibold">
                      C
                    </div>
                  )}
                </div>
              </TooltipTrigger>
              <TooltipContent
                side="bottom"
                className="border-border bg-popover text-popover-foreground text-xs shadow-none"
              >
                <div className="flex items-center gap-1.5 font-medium">
                  <span>
                    {member.name}
                    {isMe ? " (You)" : ""}
                  </span>
                  {isHost && (
                    <Badge
                      variant="outline"
                      className="text-[10px] px-1 py-0 rounded-lg"
                    >
                      Host
                    </Badge>
                  )}
                  {!isHost && isCohost && (
                    <Badge
                      variant="outline"
                      className="text-[10px] px-1 py-0 rounded-lg"
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
