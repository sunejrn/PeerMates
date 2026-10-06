"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { toast } from "sonner";

/**
 * Nickname-only gate for guests (no signup). Signed-in users never see this.
 * 44px targets, inline error state, safe-area aware.
 */
export function NicknameGate({
  roomTitle,
  slug,
  onJoin,
}: {
  roomTitle: string;
  slug: string;
  onJoin: (nickname: string) => void;
}) {
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const clean = name.trim().slice(0, 24);
    if (clean.length < 2) {
      setError("Pick a nickname with at least 2 characters.");
      return;
    }
    if (/^guest/i.test(clean) && clean.length < 7) {
      setError("That nickname is too generic — add something personal.");
      return;
    }
    setError(null);
    toast.success(`Welcome, ${clean}! 🎉`);
    onJoin(clean);
  };

  return (
    <main className="flex flex-1 items-center justify-center p-4 sm:p-6">
      <Card className="w-full max-w-md border-border bg-card/75 p-6 sm:p-8 text-center backdrop-blur-xl shadow-none rounded-2xl space-y-5">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-emerald-600/15 border border-emerald-500/30 text-2xl">
          <span aria-hidden>🍿</span>
        </div>
        <div className="space-y-2">
          <p className="inline-block rounded-full border border-violet-500/40 bg-violet-500/10 text-violet-600 dark:text-violet-400 text-xs px-2.5 py-0.5 font-mono">
            Party #{slug}
          </p>
          <h2 className="text-xl sm:text-2xl font-bold tracking-tight text-foreground">
            Join &ldquo;{roomTitle}&rdquo;
          </h2>
          <p className="text-xs sm:text-sm text-muted-foreground leading-relaxed">
            Just pick a nickname — no signup needed. The host controls playback;
            you can chat + react.
          </p>
        </div>
        <form onSubmit={submit} className="space-y-3 text-left">
          <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground" htmlFor="nickname">
            Your nickname
          </label>
          <Input
            id="nickname"
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              if (error) setError(null);
            }}
            placeholder="e.g. MovieFan42"
            maxLength={24}
            autoComplete="nickname"
            aria-label="Your nickname"
            className="h-12 min-h-11 bg-background/80 text-sm"
          />
          {error && (
            <p className="text-xs text-red-600 dark:text-red-400 rounded-lg border border-red-500/30 bg-red-500/5 px-3 py-2" role="alert">
              ❌ {error}
            </p>
          )}
          <Button
            type="submit"
            className="w-full h-12 min-h-11 bg-linear-to-r from-violet-600 to-indigo-600 hover:from-violet-500 hover:to-indigo-500 text-white font-semibold cursor-pointer"
          >
            Join party →
          </Button>
        </form>
        <p className="text-[11px] text-muted-foreground">
          Have an account? Sign in from the lobby for unlimited hosting.
        </p>
      </Card>
    </main>
  );
}
