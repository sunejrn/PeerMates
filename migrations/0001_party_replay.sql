-- Party Replay tables (timestamps + text only; video bytes are never stored).
-- Apply to Neon with: npx drizzle-kit migrate
CREATE TYPE "public"."replay_visibility" AS ENUM('public', 'circle', 'private');--> statement-breakpoint
CREATE TABLE "party_replays" (
	"id" text PRIMARY KEY NOT NULL,
	"room_slug" text NOT NULL,
	"title" text DEFAULT 'PeerMates Party' NOT NULL,
	"video_type" "video_type" DEFAULT 'youtube' NOT NULL,
	"video_source" text,
	"file_fingerprint" jsonb,
	"duration_sec" double precision DEFAULT 0 NOT NULL,
	"viewer_count" integer DEFAULT 0 NOT NULL,
	"visibility" "replay_visibility" DEFAULT 'public' NOT NULL,
	"buckets" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"peaks" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"highlights" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"top_emoji" text,
	"host_id" text NOT NULL,
	"host_name" text,
	"ended_at" timestamp DEFAULT now() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "party_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"replay_id" text,
	"room_slug" text NOT NULL,
	"user_id" text NOT NULL,
	"user_name" text,
	"type" text NOT NULL,
	"video_time" double precision DEFAULT 0 NOT NULL,
	"payload" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "party_events_replay_idx" ON "party_events" USING btree ("replay_id","video_time");--> statement-breakpoint
CREATE INDEX "party_events_room_idx" ON "party_events" USING btree ("room_slug","video_time");--> statement-breakpoint
CREATE INDEX "party_replays_room_idx" ON "party_replays" USING btree ("room_slug");
