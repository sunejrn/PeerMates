"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { AuthButton } from "@/components/auth/AuthButton";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Spinner } from "@/components/ui/spinner";
import {
  getRoomHistory,
  deleteRoomFromHistory,
  timeAgo,
  type RoomHistoryEntry,
} from "@/lib/rooms/history";

export default function AllRoomsPage() {
  const [rooms, setRooms] = useState<RoomHistoryEntry[] | null>(null);

  useEffect(() => {
    setRooms(getRoomHistory());
  }, []);

  const handleDelete = (slug: string) => {
    deleteRoomFromHistory(slug);
    setRooms(getRoomHistory());
  };

  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground">
      <header className="sticky top-0 z-50 flex h-16 w-full items-center justify-between border-b border-border/80 bg-background/80 px-4 sm:px-6 backdrop-blur-md">
        <div className="flex items-center gap-2 sm:gap-3 min-w-0">
          <Link href="/" className="text-lg font-bold tracking-tight">
            PeerMates
          </Link>
          <nav className="flex items-center gap-1 text-sm" aria-label="Primary">
            <Link
              href="/rooms"
              aria-current="page"
              className="rounded-lg bg-muted px-3 min-h-11 flex items-center font-medium"
            >
              All Rooms
            </Link>
            <Link
              href="/settings"
              className="rounded-lg px-3 min-h-11 flex items-center text-muted-foreground hover:text-foreground"
            >
              Settings
            </Link>
          </nav>
        </div>
        <div className="flex items-center gap-2 sm:gap-4">
          <AuthButton />
        </div>
      </header>

      <main className="mx-auto w-full max-w-3xl flex-1 px-4 sm:px-6 py-8">
        <div className="mb-6 space-y-1">
          <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight">All Rooms</h1>
          <p className="text-sm text-muted-foreground">
            Every party you created or joined on this device. Rooms disappear
            automatically 30 days after your last visit (toggle in Settings).
          </p>
        </div>

        {rooms === null ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground" role="status">
            <Spinner className="shrink-0" /> Loading your rooms…
          </div>
        ) : rooms.length === 0 ? (
          <Card className="p-8 text-center space-y-3">
            <p className="text-sm font-medium">No rooms yet</p>
            <p className="text-xs text-muted-foreground">
              Create a party or join one with a code — it will show up here.
            </p>
            <Button onClick={() => (window.location.href = "/")} className="min-h-11">
              Back to Lobby
            </Button>
          </Card>
        ) : (
          <div
            className="no-scrollbar space-y-3 overflow-y-auto overscroll-contain pr-0.5"
            style={{ maxHeight: "calc(100dvh - 16rem)" }}
            role="list"
            aria-label="Your rooms"
          >
            {rooms.map((r) => (
              <Card key={r.slug} role="listitem" className="p-4 flex items-center gap-3">
                <div className="min-w-0 flex-1 space-y-1">
                  <div className="flex items-center gap-2 min-w-0">
                    <Link
                      href={`/room/${r.slug}`}
                      className="truncate text-sm font-semibold hover:underline"
                      title={r.title}
                    >
                      {r.title}
                    </Link>
                    {r.videoType && (
                      <Badge variant="outline" className="text-[10px] font-mono uppercase shrink-0">
                        {r.videoType}
                      </Badge>
                    )}
                  </div>
                  <p className="truncate font-mono text-[11px] text-muted-foreground">
                    #{r.slug}
                    {r.hostName ? ` · host ${r.hostName}` : ""} · {timeAgo(r.lastVisit)}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <Link
                    href={`/room/${r.slug}`}
                    className="inline-flex min-h-11 items-center justify-center rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground"
                  >
                    Rejoin
                  </Link>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => handleDelete(r.slug)}
                    aria-label={`Delete room ${r.title}`}
                    className="min-h-11"
                  >
                    Delete
                  </Button>
                </div>
              </Card>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
