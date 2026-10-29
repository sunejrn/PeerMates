"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Spinner } from "@/components/ui/spinner";
import { toast } from "sonner";
import { useSession } from "@/lib/auth-client";
import { AuthModal } from "@/components/auth/AuthModal";
import { extractRoomCode, isValidRoomCode } from "@/lib/rooms/code";
import {
  clearPendingJoin,
  readPendingJoin,
  savePendingJoin,
} from "@/lib/rooms/pendingIntents";

/**
 * Join with a room code (or pasted invite link). Mobile-first: 44px targets,
 * errors surfaced as top-right toasts. No Join button — a complete valid code
 * redirects automatically. Signing in resumes the same join.
 */
export function JoinByCode({ compact = false }: { compact?: boolean }) {
  const router = useRouter();
  const { data: session, isPending: authPending } = useSession();
  const [code, setCode] = useState("");
  const [isJoining, setIsJoining] = useState(false);
  const [showAuthModal, setShowAuthModal] = useState(false);
  const attemptRef = useRef(0);

  // A code entered before the sign-in redirect is restored here, so the join
  // continues automatically once the user is back. Reading in an effect (not
  // the state initializer) keeps server and client markup in sync.
  useEffect(() => {
    const pending = readPendingJoin();
    if (!pending) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setCode(pending);
  }, []);

  const normalized = extractRoomCode(code);

  // Auto-join once a valid code/link is present (debounced while typing).
  useEffect(() => {
    if (authPending || !normalized || !isValidRoomCode(normalized)) {
      return;
    }
    const attemptId = ++attemptRef.current;
    const timer = setTimeout(async () => {
      if (!session?.user) {
        savePendingJoin(normalized);
        setShowAuthModal(true);
        return;
      }
      try {
        setIsJoining(true);
        // Verify the room exists before navigating (friendly toast, not 404).
        const res = await fetch(`/api/rooms/${normalized}`);
        if (attemptId !== attemptRef.current) return;
        if (!res.ok) {
          toast.error("No party found for that code. Check it and try again.");
          return;
        }
        clearPendingJoin();
        toast.success("Joining party.");
        router.push(`/room/${normalized}`);
      } catch {
        if (attemptId === attemptRef.current) {
          toast.error("Couldn't reach the party. Check your connection and retry.");
        }
      } finally {
        if (attemptId === attemptRef.current) setIsJoining(false);
      }
    }, 450);
    return () => clearTimeout(timer);
  }, [authPending, normalized, session?.user, router]);

  return (
    <Card
      className={`${
        compact ? "p-4 sm:p-5" : "p-5 sm:p-6"
      } w-full border-border bg-card/70 backdrop-blur-xl shadow-none rounded-2xl`}
    >
      <div className="space-y-3 text-left">
        <div className="space-y-1">
          <h3 className="text-base sm:text-lg text-card-foreground">
            join with a code
          </h3>
          <p className="text-xs text-muted-foreground">
            Enter the party code or paste the invite link.
          </p>
        </div>
        <Input
          value={code}
          onChange={(e) => {
            clearPendingJoin();
            setCode(e.target.value);
          }}
          placeholder="e.g. a1b2c3 or paste link"
          aria-label="Party code or invite link"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          inputMode="text"
          className="h-12 min-h-11 w-full bg-background/80 font-mono text-sm tracking-wide uppercase placeholder:normal-case placeholder:font-sans"
        />
        {code.trim() !== "" && normalized && (
          <p className="text-[11px] text-muted-foreground font-mono">
            Code detected:{" "}
            <span className="text-foreground">{normalized}</span>
          </p>
        )}
        {code.trim() !== "" && !normalized && (
          <p className="text-[11px] text-muted-foreground" role="alert">
            Enter a valid party code (e.g. a1b2c3) or paste the invite link.
          </p>
        )}
        {isJoining && (
          <p
            className="flex items-center gap-2 text-[11px] text-muted-foreground"
            role="status"
          >
            <Spinner className="shrink-0" /> Joining…
          </p>
        )}
      </div>

      <AuthModal
        open={showAuthModal}
        onOpenChange={setShowAuthModal}
        title="Sign in to join this party"
        description="Sign in to join the room. We saved the code — you'll continue automatically right after signing in."
      />
    </Card>
  );
}
