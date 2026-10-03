import { AuthButton } from "@/components/auth/AuthButton";
import { RoomLobby } from "@/components/room/RoomLobby";
import { PwaInstallCard } from "@/components/pwa/PwaInstallCard";

export default function Home() {
  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground transition-colors duration-200">
      {/* Header / Navbar */}
      <header className="sticky top-0 z-50 flex h-16 w-full items-center justify-between border-b border-border/80 bg-background/80 px-4 sm:px-6 backdrop-blur-md">
        <div className="flex items-center gap-2 sm:gap-3 min-w-0">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-linear-to-tr from-violet-600 via-indigo-600 to-pink-500 shadow-md shadow-violet-500/20">
            <svg
              className="h-5 w-5 text-white"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z"
              />
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
              />
            </svg>
          </div>
          <span className="text-lg font-bold tracking-tight text-foreground">
            PeerMates
          </span>
          <span className="rounded-full border border-violet-500/30 bg-violet-500/10 px-2 py-0.5 text-[11px] font-medium text-violet-600 dark:text-violet-400 hidden xs:inline-block">
            Realtime Sync
          </span>
        </div>

        <div className="flex items-center gap-2 sm:gap-4">
          <AuthButton />
        </div>
      </header>

      {/* Hero & Lobby Section */}
      <main className="flex flex-1 flex-col items-center justify-center px-4 sm:px-6 lg:px-8 py-8 sm:py-16 text-center max-w-7xl mx-auto w-full">
        <div className="mx-auto max-w-3xl space-y-4 sm:space-y-6 mb-8 sm:mb-12">
          <div className="inline-flex items-center gap-2 rounded-full border border-border bg-card/80 px-3.5 py-1.5 text-xs text-muted-foreground backdrop-blur-sm shadow-sm">
            <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
            Host-Authoritative Realtime Playback
          </div>

          <h1 className="text-3xl sm:text-5xl lg:text-6xl font-extrabold tracking-tight text-foreground leading-tight">
            Watch videos together in <br className="hidden sm:inline" />
            <span className="bg-linear-to-r from-violet-600 via-indigo-600 to-pink-500 dark:from-violet-400 dark:via-purple-300 dark:to-pink-400 bg-clip-text text-transparent">
              frame-accurate sync
            </span>
          </h1>

          <p className="mx-auto max-w-xl text-sm sm:text-base lg:text-lg text-muted-foreground leading-relaxed">
            Synchronized YouTube, MP4, and HLS streaming with live presence, chat,
            and automated host migration.
          </p>
        </div>

        {/* Responsive Room Creation Lobby */}
        <div className="w-full max-w-2xl lg:max-w-4xl mx-auto space-y-4">
          <RoomLobby />
          <PwaInstallCard />
        </div>
      </main>
    </div>
  );
}
