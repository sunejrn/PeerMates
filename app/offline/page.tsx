import Link from "next/link";

export const metadata = {
  title: "Offline — PeerMates",
  description: "You're offline. Reconnect to rejoin your party.",
};

/**
 * Offline shell: served by the service worker when navigations fail with
 * no cached page. Tiny, static, works with zero network.
 */
export default function OfflinePage() {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center bg-background px-4 text-center text-foreground">
      <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-violet-600/15 border border-violet-500/30 text-2xl">
        📡
      </div>
      <h1 className="mt-4 text-2xl font-bold tracking-tight">
        You&apos;re offline
      </h1>
      <p className="mt-2 max-w-sm text-sm text-muted-foreground leading-relaxed">
        PeerMates needs a connection for live parties. Check your network
        and try again — the app will resync to the host automatically.
      </p>
      <Link
        href="/"
        className="mt-6 inline-flex min-h-11 items-center rounded-xl bg-violet-600 px-5 text-sm font-semibold text-white hover:bg-violet-500"
      >
        Retry connection
      </Link>
    </div>
  );
}
