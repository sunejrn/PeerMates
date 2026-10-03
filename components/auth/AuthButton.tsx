"use client";

import { useSession, signIn, signOut } from "@/lib/auth-client";
import { Button } from "@/components/ui/button";
import { useState } from "react";

export function AuthButton() {
  const { data: session, isPending } = useSession();
  const [pendingProvider, setPendingProvider] = useState<
    "google" | "github" | null
  >(null);

  const handleSocialSignIn = async (provider: "google" | "github") => {
    try {
      setPendingProvider(provider);
      await signIn.social({
        provider,
        callbackURL: window.location.href,
      });
    } catch (err) {
      console.error("Sign in error:", err);
    } finally {
      setPendingProvider(null);
    }
  };

  if (isPending) {
    return (
      <div className="flex items-center gap-2">
        <div className="h-9 w-20 animate-pulse rounded-md bg-muted" />
      </div>
    );
  }

  if (session?.user) {
    return (
      <div className="flex items-center gap-2 sm:gap-3">
        {session.user.image ? (
          <img
            src={session.user.image}
            alt={session.user.name || "User"}
            className="h-8 w-8 rounded-full border border-border object-cover"
          />
        ) : (
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-violet-600 font-semibold text-white text-xs">
            {session.user.name?.charAt(0) || "U"}
          </div>
        )}
        <span className="text-xs sm:text-sm font-medium text-foreground hidden sm:inline-block max-w-30 truncate">
          {session.user.name}
        </span>
        <Button
          variant="outline"
          size="sm"
          onClick={() => signOut()}
          className="h-8 text-xs border-border bg-card/80 text-foreground hover:bg-muted"
        >
          Sign Out
        </Button>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <Button
        size="sm"
        onClick={() => handleSocialSignIn("google")}
        disabled={pendingProvider !== null}
        aria-label="Sign in with Google"
        className="h-11 gap-2 bg-foreground text-background hover:bg-foreground/90 font-medium text-xs sm:text-sm cursor-pointer shadow-sm px-3"
      >
        <svg
          className="h-4 w-4 shrink-0"
          viewBox="0 0 24 24"
          aria-hidden="true"
        >
          <path
            fill="#4285F4"
            d="M23.5 12.3c0-.9-.1-1.5-.3-2.3H12v4.5h6.5c-.1 1.1-.8 2.7-2.4 3.8v.1l3.5 2.7h.1c2.2-2 3.8-5 3.8-8.8z"
          />
          <path
            fill="#34A853"
            d="M12 24c3.2 0 5.9-1.1 7.9-2.9l-3.8-2.9c-1 .7-2.4 1.2-4.1 1.2-3.1 0-5.8-2.1-6.8-5h-.1l-3.6 2.8v.1C3.4 21.3 7.4 24 12 24z"
          />
          <path
            fill="#FBBC05"
            d="M5.2 14.4c-.2-.7-.4-1.5-.4-2.4s.1-1.7.4-2.4h-.1l-3.6-2.8v.1C.5 8.6 0 10.2 0 12s.5 3.4 1.4 4.9l3.8-2.5z"
          />
          <path
            fill="#EA4335"
            d="M12 4.7c1.8 0 3 .8 3.7 1.4l3.3-3.2C17.9 1.1 15.2 0 12 0 7.4 0 3.4 2.7 1.4 6.7l3.8 2.9c1-2.9 3.7-4.9 6.8-4.9z"
          />
        </svg>
        <span>
          {pendingProvider === "google" ? "Connecting..." : "Google"}
        </span>
      </Button>
      <Button
        size="sm"
        onClick={() => handleSocialSignIn("github")}
        disabled={pendingProvider !== null}
        aria-label="Sign in with GitHub"
        title="Sign in with GitHub"
        className="h-11 w-11 bg-foreground text-background hover:bg-foreground/90 cursor-pointer shadow-sm px-0"
      >
        <svg
          className="h-4 w-4 fill-current shrink-0"
          viewBox="0 0 24 24"
          aria-hidden="true"
        >
          <path
            fillRule="evenodd"
            clipRule="evenodd"
            d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.53 1.032 1.53 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z"
          />
        </svg>
      </Button>
    </div>
  );
}
