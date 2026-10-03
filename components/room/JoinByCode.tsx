"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { toast } from "sonner";
import { extractRoomCode, isValidRoomCode } from "@/lib/rooms/code";

/**
 * Join with a room code (or pasted invite link). Mobile-first: 44px targets,
 * inline error state, loading state, no horizontal scroll.
 */
export function JoinByCode({ compact = false }: { compact?: boolean }) {
  const router = useRouter();
  const [code, setCode] = useState("");
  const [isJoining, setIsJoining] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const normalized = extractRoomCode(code);

  const handleJoin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const slug = extractRoomCode(code);
    if (!slug || !isValidRoomCode(slug)) {
      setError("Enter a valid party code (e.g. a1b2c3) or paste the invite link.");
      return;
    }
    try {
      setIsJoining(true);
      // Verify the room exists before navigating (friendly error, not a 404 page).
      const res = await fetch(`/api/rooms/${slug}`);
      if (!res.ok) {
        setError("No party found for that code — check it and try again.");
        return;
      }
      toast.success("Joining watch party…");
      router.push(`/room/${slug}`);
    } catch {
      setError("Couldn't reach the party. Check your connection and retry.");
    } finally {
      setIsJoining(false);
    }
  };

  return (
    <Card className={`${compact ? "p-4 sm:p-5" : "p-5 sm:p-6"} w-full border-border bg-card/70 backdrop-blur-xl shadow-xl rounded-2xl`}>
      <form onSubmit={handleJoin} className="space-y-3 text-left">
        <div className="space-y-1">
          <h3 className="text-base sm:text-lg font-bold text-card-foreground flex items-center gap-2">
            🔑 Join with a code
          </h3>
          <p className="text-xs text-muted-foreground">
            Got an invite? Enter the 6-letter party code or paste the invite link.
          </p>
        </div>
        <div className="flex flex-col min-[420px]:flex-row gap-2">
          <Input
            value={code}
            onChange={(e) => {
              setCode(e.target.value);
              if (error) setError(null);
            }}
            placeholder="e.g. a1b2c3 or paste link"
            aria-label="Party code or invite link"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            inputMode="text"
            className="h-12 min-h-11 flex-1 bg-background/80 font-mono text-sm tracking-wide uppercase placeholder:normal-case placeholder:font-sans"
          />
          <Button
            type="submit"
            disabled={isJoining || (code.trim() !== "" && !normalized)}
            className="h-12 min-h-11 min-w-11 px-5 bg-emerald-600 hover:bg-emerald-500 text-white font-semibold cursor-pointer shrink-0 disabled:opacity-50"
          >
            {isJoining ? (
              <span className="flex items-center gap-2">
                <span className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
                Joining…
              </span>
            ) : (
              "Join party"
            )}
          </Button>
        </div>
        {code.trim() !== "" && normalized && (
          <p className="text-[11px] text-muted-foreground font-mono">
            Code detected: <span className="font-bold text-foreground">{normalized}</span>
          </p>
        )}
        {error && (
          <p className="text-xs text-red-600 dark:text-red-400 rounded-lg border border-red-500/30 bg-red-500/5 px-3 py-2" role="alert">
            ❌ {error}
          </p>
        )}
      </form>
    </Card>
  );
}
