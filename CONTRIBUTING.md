# Contributing to PeerMates

Thanks for helping out! This guide keeps contributions consistent with how the
app is already built. Please read it before opening a PR.

## Setup

```bash
npm install
cp .env.example .env.local   # then fill in the keys (see README env table)
npm run dev                  # http://localhost:3000
```

Apply DB migrations before working on DB-backed features:

```bash
# Preferred: run the SQL in migrations/ in your Neon SQL editor.
# Alternatively:
npx drizzle-kit migrate
```

Verify before you push:

```bash
npx tsc --noEmit
npm run build
```

Both must pass with zero errors.

## How we work

- **Small, focused PRs.** One feature or fix per PR. Keep the diff reviewable.
- **Don't break existing features.** Every change must leave `tsc` + `build`
  green and keep current rooms, chat, auth, and replay flows working.
- **Free tiers only.** No new paid services. New npm dependencies need a
  reason in the PR description — prefer zero-dependency solutions.
- **Use existing patterns.** Check `lib/`, `hooks/`, and a sibling API route
  before inventing something new.

## Rules that are enforced in review

1. **Server-side authorization, never UI-only.** Host/co-host powers
   (playback control, source changes, kicks, mutes, subtitle uploads, replay
   finalize) must be re-checked in the API route with `resolveActorId` +
   the Upstash role store (`getRole`), following `app/api/rooms/[slug]/moderation/route.ts`.
2. **Rate-limit new endpoints.** Add a budget to `RATE_LIMITS` in
   `lib/redis/ratelimit.ts` and enforce it with `checkRateLimit` + the
   `rateLimited()` helper.
3. **Redis with in-memory fallback.** New Redis state must follow
   `lib/redis/roles.ts`: Upstash first, module-level memory map when
   unconfigured, TTLs on room-scoped keys.
4. **Mobile-first.** 360px layout, 44px minimum tap targets, safe-area
   insets (`env(safe-area-inset-*)`), `dvh` units, no horizontal scroll.
   Test on iPhone Safari **and** Android Chrome (autoplay needs a user
   gesture, fullscreen APIs differ, codecs differ).
5. **Loading and error states everywhere.** Use the shared
   `components/ui/spinner.tsx` (`<Spinner className="size-8" />` for large
   loaders). Never leave a blank screen or a silent failure — toast with the
   server's reason.
6. **Never leak secrets.** API keys stay server-side (no `NEXT_PUBLIC_`
   prefix). Client code must never import server-only modules (`lib/ai.ts`,
   `lib/rooms/actor.ts`, `db/*`).
7. **No video bytes on the server.** Subtitles, chat media, and replay
   events store timestamps + text + CDN URLs only — never movie files.

## Screenshots

UI changes must include before/after screenshots (1440×900 desktop and
390×844 mobile, dark mode) in `public/screenshots/`, plus README updates if
the feature is user-facing. To capture: run the dev server, create a room
via `POST /api/rooms`, and screenshot `/`, `/room/<slug>`, and `/replay/<id>`.

## Reporting bugs

Include: what you tapped, room code (if shareable), device + browser,
expected vs actual behavior, and any console/dev-log errors. A screenshot
of the error overlay helps more than a paraphrase.

## License

By contributing, you agree your work is released under the MIT License
(see `LICENSE`).
