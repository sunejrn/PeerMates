import { AuthButton } from "@/components/auth/AuthButton";
import { RoomLobby } from "@/components/room/RoomLobby";
import { PwaInstallCard } from "@/components/pwa/PwaInstallCard";
import { GravityField } from "@/components/gravity-field";
import Link from "next/link";

export default function Home() {
  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground transition-colors duration-200">
      {/* Header / Navbar */}
      <header className="sticky top-0 z-50 flex h-16 w-full items-center justify-between border-b border-border/80 bg-background/80 px-4 sm:px-6 backdrop-blur-md">
        <div className="flex items-center gap-2 sm:gap-3 min-w-0">
          <span className="text-lg font-bold tracking-tight text-foreground">
            PeerMates
          </span>
          <span className="rounded-full border border-violet-500/30 bg-violet-500/10 px-2 py-0.5 text-[11px] font-medium text-violet-600 dark:text-violet-400 hidden xs:inline-block">
            Realtime Sync
          </span>
        </div>

        <div className="flex items-center gap-2 sm:gap-4">
          <nav className="flex items-center gap-1 text-sm" aria-label="Primary">
            <Link
              href="/rooms"
              className="rounded-lg px-3 min-h-11 hidden sm:flex items-center text-muted-foreground hover:text-foreground"
            >
              All Rooms
            </Link>
            <Link
              href="/settings"
              className="rounded-lg px-3 min-h-11 hidden sm:flex items-center text-muted-foreground hover:text-foreground"
            >
              Settings
            </Link>
          </nav>
          <AuthButton />
        </div>
      </header>

      {/* Hero & Lobby Section */}
      <main className="flex flex-1 flex-col items-center justify-center px-4 sm:px-6 lg:px-8 py-8 sm:py-16 text-center max-w-7xl mx-auto w-full relative overflow-hidden">

      <div className="pointer-events-none absolute inset-x-0 -top-48 mx-auto h-110 max-w-205 rounded-full bg-teal/10 blur-[130px]" />
        <div className="pointer-events-none absolute inset-x-0 top-40 mx-auto h-65 max-w-130 rounded-full bg-amber/5 blur-[100px]" />
        <GravityField />

        <div className="mx-auto max-w-3xl space-y-4 sm:space-y-6 mb-8 sm:mb-12">
          <h1 className="text-3xl sm:text-5xl lg:text-6xl font-extrabold tracking-tight text-foreground leading-tight">
            Watch videos together in <br className="hidden sm:inline" />
            <span className="bg-linear-to-r from-violet-600 via-indigo-600 to-pink-500 dark:from-violet-400 dark:via-purple-300 dark:to-pink-400 bg-clip-text text-transparent">
              frame-accurate sync
            </span>
          </h1>

          {/* the frame */}

{/* text */}
          <p className="mx-auto max-w-xl text-sm sm:text-base lg:text-lg leading-relaxed">
            Synchronized YouTube, MP4, and HLS streaming with live presence, chat,
            and automated host migration.
          </p>
        </div>

        {/* Responsive Room Creation Lobby */}
        <div className="w-full max-w-6xl mx-auto space-y-4">
          <RoomLobby />
          <PwaInstallCard />
        </div>
      </main>
    </div>
  );
}
