"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Spinner } from "@/components/ui/spinner";
import { toast } from "sonner";
import { extractRoomCode, isValidRoomCode } from "@/lib/rooms/code";

/**
 * Join with a room code (or pasted invite link). Mobile-first: 44px targets,
 * errors surfaced as top-right toasts, loading state, no horizontal scroll.
 */
export function JoinByCode({ compact = false }: { compact?: boolean }) {
  const router = useRouter();
  const [code, setCode] = useState("");
  const [isJoining, setIsJoining] = useState(false);

  const normalized = extractRoomCode(code);

  const handleJoin = async (e: React.FormEvent) => {
    e.preventDefault();
    const slug = extractRoomCode(code);
    if (!slug || !isValidRoomCode(slug)) {
      toast.error("Enter a valid party code (e.g. a1b2c3) or paste the invite link.");
      return;
    }
    try {
      setIsJoining(true);
      // Verify the room exists before navigating (friendly toast, not a 404 page).
      const res = await fetch(`/api/rooms/${slug}`);
      if (!res.ok) {
        toast.error("No party found for that code. Check it and try again.");
        return;
      }
      toast.success("Joining party.");
      router.push(`/room/${slug}`);
    } catch {
      toast.error("Couldn't reach the party. Check your connection and retry.");
    } finally {
      setIsJoining(false);
    }
  };

  return (
    <Card className={`${compact ? "p-4 sm:p-5" : "p-5 sm:p-6"} w-full border-border bg-card/70 backdrop-blur-xl shadow-none rounded-2xl`}>
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
            onChange={(e) => setCode(e.target.value)}
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
            className="h-12 min-h-11 min-w-11 px-5 bg-[#333] dark:bg-[#f5f5f5] dark:text-[#333333] border text-[#f5f5f5] font-semibold cursor-pointer shrink-0 disabled:opacity-50"
          >
            {isJoining ? (
              <span className="flex items-center gap-2">
                <Spinner className="text-[#f5f5f5]" />
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
      </form>
    </Card>
  );
}
