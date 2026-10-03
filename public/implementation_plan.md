# Implementation Plan: PeerMates - Real-Time Synchronized Watch Party App

Build a host-authoritative, real-time synchronized watch party web application (**PeerMates**) using Next.js 16 (App Router), TypeScript, Tailwind CSS, shadcn/ui, Better-Auth, Neon (PostgreSQL) + Drizzle ORM, Upstash Redis, and the GetStream Chat SDK for real-time events, chat, and presence.

## User Review Required

> [!IMPORTANT]
> **Environment Variables Setup**:
> For the database, auth, Redis, and GetStream, the following credentials are required in `.env.local`:
> - `DATABASE_URL` (Neon Postgres connection string)
> - `BETTER_AUTH_SECRET` (Random secret for Better-Auth)
> - `BETTER_AUTH_URL` (e.g. `http://localhost:3000`)
> - `STREAM_API_KEY` & `STREAM_API_SECRET` (GetStream.io Chat credentials)
> - `UPSTASH_REDIS_REST_URL` & `UPSTASH_REDIS_REST_TOKEN` (Upstash Redis REST credentials)
>
> We will generate a `.env.example` and provide graceful fallbacks or mock/demo modes where helpful so you can verify each component smoothly during development if keys are pending.

---

## Architecture & Data Flow

```mermaid
graph TD
  UserHost[Host Client] -->|1. Play / Pause / Seek / 3s Heartbeat| StreamChannel[GetStream Channel: watchparty:slug]
  UserHost -->|2. Write State| UpstashRedis[(Upstash Redis: room:slug:state)]
  StreamChannel -->|3. Broadcast playback events| FollowerClient[Follower Clients]
  FollowerClient -->|On Join: Instant State Fetch| RedisAPI[/api/rooms/slug/state]
  RedisAPI --> UpstashRedis
  FollowerClient -->|Calculate Drift > 0.5s| LocalPlayer[Follower Video Player]
  UserHost -->|Control actions| HostPlayer[Host Video Player]
```

---

## Implementation Phases (Step-by-Step)

### Phase 1: Foundation (Auth, Database & Schema)
- **Dependencies**:
  - Install Better-Auth (`better-auth`)
  - Install Drizzle ORM + kit (`drizzle-orm`, `drizzle-kit`, `@neondatabase/serverless`)
  - Install Upstash Redis (`@upstash/redis`)
  - Install TanStack Query (`@tanstack/react-query`)
  - Install Sonner toast (`sonner`) and additional shadcn components (`input`, `avatar`, `tooltip`, `scroll-area`, `dialog`, `badge`)
- **Database & Drizzle Schema**:
  - `lib/db/schema.ts`:
    - Better-Auth core tables: `users`, `sessions`, `accounts`, `verifications`
    - `rooms`: `id` (uuid pk), `slug` (unique short code), `hostId` (fk -> users.id), `videoSource` (text URL), `videoType` ('youtube' | 'hls' | 'mp4'), `streamChannelId` (text), `isActive` (boolean), `createdAt`, `updatedAt`
    - `room_participants`: `id` (uuid pk), `roomId` (fk -> rooms.id), `userId` (fk -> users.id), `role` ('host' | 'viewer'), `joinedAt`, `lastSeenAt`
    - `playback_events`: `id`, `roomId`, `eventType`, `position`, `emittedBy`, `createdAt`
  - `lib/db/index.ts`: Neon serverless client connection
  - `drizzle.config.ts`: Drizzle config for migrations
- **Better-Auth Setup**:
  - `lib/auth.ts`: Better-Auth server configuration with Drizzle adapter and email/password or guest/credential auth
  - `lib/auth-client.ts`: Better-Auth client react hooks
  - `app/api/auth/[...all]/route.ts`: Better-Auth handler
- **Verification of Phase 1**:
  - Verify database schema generation (`drizzle-kit generate`), auth signup/login flow, and Next.js page rendering.

---

### Phase 2: Room Creation & Metadata API
- **API Endpoints**:
  - `POST /api/rooms`: Auth-gated. Validates URL (detects YouTube vs MP4 vs HLS .m3u8), generates unique short slug (e.g. `nanoid(6)`), inserts into `rooms`, registers creator as host in `room_participants`, initializes Redis state `room:{slug}:state`.
  - `GET /api/rooms/[slug]`: Returns room metadata (title, video source, video type, host user details, active status).
  - `POST /api/rooms/[slug]/join`: Records user in `room_participants`, issues Stream client token for this user.
- **UI**:
  - `components/room/RoomLobby.tsx`: Sleek hero section with video URL input, format indicator badge (YouTube / MP4 / HLS), "Create Party" button, and list of public or recent rooms.
  - Page `app/room/[slug]/page.tsx`: Room container layout.

---

### Phase 3: Video Player Abstraction
- Unified video controller interface:
  ```ts
  interface UnifiedPlayerRef {
    play: () => Promise<void> | void;
    pause: () => void;
    seek: (seconds: number) => void;
    getCurrentTime: () => number;
    getDuration: () => number;
    isPaused: () => boolean;
  }
  ```
- **Components**:
  - `components/player/YouTubePlayer.tsx`: Custom YouTube IFrame wrapper using YouTube IFrame API (`window.YT.Player`), handling play/pause/seek events and postMessage safety.
  - `components/player/NativeVideoPlayer.tsx`: HTML5 `<video>` player supporting native MP4 and HLS streaming using `hls.js`.
  - `components/player/VideoPlayer.tsx`: Façade component dynamically rendering either YouTube or NativeVideoPlayer while providing a consistent controller API to the host/follower sync engine.
  - Testable standalone video controls (play, pause, seek scrubber, volume, fullscreen).

---

### Phase 4: GetStream Realtime Integration (Chat & Presence)
- **Backend**:
  - `lib/stream/server.ts`: Server-side `StreamChat` client using `STREAM_API_KEY` and `STREAM_API_SECRET`.
  - `POST /api/stream/token`: Auth-gated route generating user Stream token (`serverClient.createToken(userId)`).
- **Client & Custom UI**:
  - Initialize headless `stream-chat` client.
  - Connect user to Stream channel `watchparty:${room.slug}` with `channel.watch()`.
  - `components/chat/ChatPanel.tsx`: Custom shadcn chat panel using `ScrollArea`, `Input`, send button, and formatted message list (timestamps, user avatar, username).
  - `components/room/PresenceBar.tsx`: Dynamic avatar list with online tooltips powered by `channel.state.members` and `presence.changed` events.

---

### Phase 5: The Sync Engine (Host-Authoritative Algorithm)
- **Redis Live State Service (`lib/redis/roomState.ts`)**:
  - `setRoomState(slug, { currentTime, isPlaying, playbackRate, serverTimestamp, hostId })`
  - `getRoomState(slug)`
  - `GET /api/rooms/[slug]/state`: Endpoint for late joiners to fetch instant authoritative state.
- **Host Logic (`hooks/useHostSync.ts`)**:
  - Listen to player `onPlay`, `onPause`, `onSeek`.
  - On event: emit `channel.sendEvent({ type: 'playback.play' | 'playback.pause' | 'playback.seek', position, serverTimestamp: Date.now() })`.
  - Also update Redis state immediately on each event.
  - Every 3 seconds while playing: emit `playback.heartbeat` with current time and update Redis.
- **Follower Logic (`hooks/useFollowerSync.ts`)**:
  - On room join: immediately fetch state from `/api/rooms/[slug]/state`, seek player to `currentTime + (Date.now() - serverTimestamp)/1000`, set play/pause state.
  - Listen to `channel.on('playback.*')`:
    1. Compute `expectedPosition = event.position + (Date.now() - event.serverTimestamp) / 1000`.
    2. Compute `drift = expectedPosition - player.getCurrentTime()`.
    3. If `Math.abs(drift) > 0.5s` and not debounced (1s cooldown since last seek): seek player to `expectedPosition`.
    4. Sync `isPlaying` state (play if event says playing, pause if event says paused).
- **Sync Status Indicator (`components/room/SyncStatusIndicator.tsx`)**:
  - Displays green "Synced" (< 0.2s drift), yellow "Syncing..." (> 0.5s drift), or red "Disconnected".

---

### Phase 6: Host Migration & Buffer Handling
- **Host Disconnect Handling**:
  - Stream presence watcher detects when `hostId` leaves the channel (`member.removed` or `user.presence.changed`).
  - Remaining participants identify the longest-tenured member (`joinedAt`).
  - The new host claims leadership via `/api/rooms/[slug]/host` or emits `room.host_changed`.
  - Redis `hostId` updated.
- **Host Buffering Broadcast**:
  - If host player enters `buffering` state, host emits `playback.buffering` to temporarily pause followers so they don't run ahead.
  - When host resumes, emits `playback.play`.

---

### Phase 7: Polish & Mobile Responsiveness
- Room header with shareable link, one-click copy with Sonner toast notification.
- Host controls bar (transfer host, change video URL, sync force-reload).
- Request host button for viewers.
- Premium UI with glassmorphism, responsive cinema mode, theatre chat toggle.

---

## Verification Plan

### Phase 1 Verification
1. Verify package installation without conflicting peer deps (Next 16 + React 19).
2. Verify Drizzle schema compilation and Better-Auth endpoint responding.
3. Test authentication UI (sign up, sign in).

### Phase 2 Verification
1. Test room creation with YouTube URL (`https://www.youtube.com/watch?v=...`) and direct MP4/HLS URL.
2. Verify `/api/rooms` creates database record, generates slug, and returns correct metadata.
3. Verify navigation to `/room/[slug]`.

### Phase 3 Verification
1. Test YouTube video playback, pause, seek using unified controls.
2. Test direct MP4 / HLS video playback, pause, seek using native/hls.js controls.

### Phase 4 Verification
1. Verify Stream token issuance via `/api/stream/token`.
2. Test chat message sending and receiving in real-time.
3. Verify presence avatars show active users in the room.

### Phase 5 Verification (Sync Engine)
1. Open two browser windows with the same room slug (one host, one viewer).
2. Host hits play -> Viewer plays within ~0.5s.
3. Host hits pause -> Viewer pauses immediately.
4. Host seeks to 1:30 -> Viewer seeks to 1:30.
5. New viewer joins mid-playback -> Starts at current playback position (fetched from Redis), not 0:00.

### Phase 6 & 7 Verification
1. Host closes tab -> Remaining viewer is promoted to host within seconds.
2. Test responsive layouts and copy room link toast.
