import Link from "next/link";

export const metadata = {
  title: "Offline",
  description: "Reconnect to rejoin.",
};

/**
 * Offline shell: served by the service worker when navigations fail with
 * no cached page. Tiny, static, works with zero network.
 */
export default function OfflinePage() {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center bg-[#f5f5f5] dark:bg-[#333] px-4 text-center text-foreground">
      <h1 className="mt-4 text-2xl tracking-tight">
        You&apos;re offline
      </h1>
      <p className="mt-2 max-w-sm text-sm text-muted-foreground leading-relaxed">
        Check your network and try again. The app will resync to the host automatically.
      </p>
      <Link
        href="/"
        className="mt-6 inline-flex min-h-11 items-center rounded-xl px-5 text-sm underline "
      >
        Retry connection
      </Link>
    </div>
  );
}
