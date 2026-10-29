import { AuthButton } from "@/components/auth/AuthButton";
import { RoomLobby } from "@/components/room/RoomLobby";
import { PwaInstallSpotlight } from "@/components/pwa/PwaInstallSpotlight";
import { GravityField } from "@/components/gravity-field";
import Link from "next/link";

export default function Home() {
  return (
    <div className="relative flex min-h-screen flex-col bg-background text-foreground transition-colors duration-200">
      <GravityField />
      {/* Header / Navbar */}
      <header className="sticky top-0 z-50 flex h-16 w-full items-center justify-between bg-background/80 px-4 sm:px-6 backdrop-blur-md">
        <div className="flex items-center gap-2 sm:gap-3 min-w-0">
          <span className="text-lg tracking-tight text-foreground">
            peermates
          </span>
          <span className="rounded-full border border-violet-500/30 bg-violet-500/10 px-2 py-0.5 text-[11px] text-violet-600 dark:text-violet-400 hidden xs:inline-block">
            live sync
          </span>
        </div>

        <div className="flex items-center gap-2 sm:gap-4">
          <nav className="flex items-center gap-1 text-sm" aria-label="Primary">
            <Link
              href="/rooms"
              className="rounded-lg px-3 min-h-11 hidden sm:flex items-center text-muted-foreground "
            >
              All Rooms
            </Link>
            <Link
              href="/settings"
              className="rounded-lg px-3 min-h-11 hidden sm:flex items-center text-muted-foreground "
            >
              Settings
            </Link>
          </nav>
          <AuthButton />
        </div>
      </header>

      {/* Mobile nav (small screens): same destinations as the desktop navbar,
          always reachable whether signed in or not. */}
      <nav
        className="relative z-10 flex sm:hidden items-center gap-1 border-b border-border/80 bg-background/80 px-4 py-1 text-sm backdrop-blur-md"
        aria-label="Mobile"
      >
        <Link
          href="/rooms"
          className="flex min-h-11 flex-1 items-center justify-center rounded-lg text-muted-foreground "
        >
          All Rooms
        </Link>
        <Link
          href="/settings"
          className="flex min-h-11 flex-1 items-center justify-center rounded-lg text-muted-foreground "
        >
          Settings
        </Link>
      </nav>

      {/* Hero & Lobby Section */}
      <main className="relative z-10 flex flex-1 flex-col items-center justify-center px-4 sm:px-6 lg:px-8 py-8 sm:py-16 text-center max-w-7xl mx-auto w-full overflow-hidden">
        <div className="pointer-events-none absolute inset-x-0 -top-48 mx-auto h-110 max-w-205 rounded-full bg-teal/10 blur-[130px]" />
        <div className="pointer-events-none absolute inset-x-0 top-40 mx-auto h-65 max-w-130 rounded-full bg-amber/5 blur-[100px]" />

        <div className="mx-auto max-w-3xl space-y-4 sm:space-y-6 mb-8 sm:mb-12">
          <p className="mx-auto max-w-xl text-sm sm:text-base lg:text-lg leading-relaxed">
            Watch movies from your own device together, perfectly in sync
            with live chat and presence.
          </p>
        </div>

        {/* Responsive Room Creation Lobby */}
        <div className="w-full max-w-6xl mx-auto space-y-4">
          <RoomLobby />
          <PwaInstallSpotlight />
        </div>
      </main>
    </div>
  );
}
