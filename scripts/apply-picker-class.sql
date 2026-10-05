-- Optional manual apply for Movie Night Picker + Class Mode tables.
-- The app runs WITHOUT this (Neon mirrors are best-effort, Redis stays live).
-- Apply once with: psql $DATABASE_URL -f scripts/apply-picker-class.sql
CREATE TABLE IF NOT EXISTS "picker_candidates" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "room_slug" text NOT NULL,
  "title" text DEFAULT 'Untitled pick' NOT NULL,
  "kind" text DEFAULT 'link' NOT NULL,
  "url" text,
  "fp_id" text,
  "fingerprint" jsonb,
  "added_by" text NOT NULL,
  "added_by_name" text,
  "winner" boolean DEFAULT false NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL
);
CREATE TABLE IF NOT EXISTS "picker_votes" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "room_slug" text NOT NULL,
  "candidate_id" text NOT NULL,
  "voter_id" text NOT NULL,
  "voter_name" text,
  "voter_image" text,
  "created_at" timestamp DEFAULT now() NOT NULL
);
CREATE TABLE IF NOT EXISTS "class_rooms" (
  "room_slug" text PRIMARY KEY NOT NULL,
  "enabled" boolean DEFAULT true NOT NULL,
  "created_by" text,
  "created_at" timestamp DEFAULT now() NOT NULL
);
CREATE TABLE IF NOT EXISTS "class_polls" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "room_slug" text NOT NULL,
  "question" text NOT NULL,
  "options" jsonb DEFAULT '[]' NOT NULL,
  "correct_index" integer,
  "is_open" boolean DEFAULT true NOT NULL,
  "revealed" boolean DEFAULT false NOT NULL,
  "created_by" text,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "closed_at" timestamp
);
CREATE TABLE IF NOT EXISTS "class_poll_votes" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "room_slug" text NOT NULL,
  "poll_id" text NOT NULL,
  "voter_id" text NOT NULL,
  "choice" integer DEFAULT 0 NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL
);
CREATE TABLE IF NOT EXISTS "class_questions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "room_slug" text NOT NULL,
  "text" text NOT NULL,
  "author_id" text NOT NULL,
  "author_name" text,
  "upvotes" integer DEFAULT 0 NOT NULL,
  "answered" boolean DEFAULT false NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL
);
CREATE TABLE IF NOT EXISTS "class_question_votes" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "room_slug" text NOT NULL,
  "question_id" text NOT NULL,
  "voter_id" text NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL
);
CREATE TABLE IF NOT EXISTS "class_notes" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "room_slug" text NOT NULL,
  "user_id" text NOT NULL,
  "text" text NOT NULL,
  "video_time" double precision DEFAULT 0 NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL
);
CREATE TABLE IF NOT EXISTS "class_attendance" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "room_slug" text NOT NULL,
  "user_id" text NOT NULL,
  "user_name" text,
  "joined_at" timestamp DEFAULT now() NOT NULL,
  "last_seen_at" timestamp DEFAULT now() NOT NULL,
  "total_seconds" integer DEFAULT 0 NOT NULL
);
