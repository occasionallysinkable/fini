-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "ActorKind" AS ENUM ('user', 'app', 'person');

-- CreateEnum
CREATE TYPE "ActivityFilterKind" AS ENUM ('reminders', 'overrides', 'dates', 'people', 'deletions');

-- CreateEnum
CREATE TYPE "TaskKind" AS ENUM ('commitment', 'own', 'habit', 'unassigned');

-- CreateEnum
CREATE TYPE "TaskStatus" AS ENUM ('active', 'done', 'cancelled', 'someday');

-- CreateEnum
CREATE TYPE "SetBy" AS ENUM ('user', 'app');

-- CreateEnum
CREATE TYPE "HillState" AS ENUM ('figuring', 'doing');

-- CreateEnum
CREATE TYPE "TaskSource" AS ENUM ('typed', 'voice', 'email', 'meeting', 'message');

-- CreateEnum
CREATE TYPE "TaskRole" AS ENUM ('asked_by', 'waiting_on', 'delegated_to', 'assignee');

-- CreateEnum
CREATE TYPE "BlockerState" AS ENUM ('waiting', 'late', 'cleared');

-- CreateEnum
CREATE TYPE "ReminderOutcome" AS ENUM ('fired', 'done', 'snoozed', 'withdrawn');

-- CreateEnum
CREATE TYPE "SnoozeReason" AS ENUM ('middle_of_something', 'wrong_time_of_day', 'waiting_on_someone');

-- CreateEnum
CREATE TYPE "RecurrencePattern" AS ENUM ('daily', 'weekdays', 'weekly', 'monthly_date', 'every_n_weeks');

-- CreateEnum
CREATE TYPE "RecurrenceMode" AS ENUM ('fixed', 'after_completion');

-- CreateEnum
CREATE TYPE "OverrideReasonCode" AS ENUM ('matters_more', 'estimate_wrong', 'wrong_time', 'fresh_info', 'free_text');

-- CreateEnum
CREATE TYPE "OverridePointsAt" AS ENUM ('rejected', 'chosen', 'both');

-- CreateEnum
CREATE TYPE "EngagementKind" AS ENUM ('open', 'planning_finished', 'capture');

-- CreateEnum
CREATE TYPE "Platform" AS ENUM ('desktop', 'mobile');

-- CreateTable
CREATE TABLE "user" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "email_verified" TIMESTAMP(3),
    "name" TEXT,
    "image" TEXT,
    "timezone" TEXT,
    "planning_hour" INTEGER,
    "waking_start" TEXT,
    "waking_end" TEXT,
    "settings" JSONB,

    CONSTRAINT "user_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "person" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "timezone" TEXT,
    "day_start" TEXT,
    "day_end" TEXT,
    "contact" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "person_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "project" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "parent_id" TEXT,
    "is_sequence" BOOLEAN NOT NULL DEFAULT false,
    "on_hold" BOOLEAN NOT NULL DEFAULT false,
    "review_interval_days" INTEGER,
    "last_reviewed_at" TIMESTAMP(3),
    "hill_state" "HillState",

    CONSTRAINT "project_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "category" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,

    CONSTRAINT "category_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "task" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "project_id" TEXT,
    "category_id" TEXT,
    "kind" "TaskKind" NOT NULL DEFAULT 'unassigned',
    "kind_is_explicit" BOOLEAN NOT NULL DEFAULT false,
    "reason" TEXT,
    "status" "TaskStatus" NOT NULL DEFAULT 'active',
    "due_date" DATE,
    "due_time" TEXT,
    "due_at_utc" TIMESTAMP(3),
    "due_zone" TEXT,
    "do_date" DATE,
    "do_date_set_by" "SetBy",
    "defer_until" DATE,
    "estimate_minutes" INTEGER,
    "actual_minutes" INTEGER,
    "splittable" BOOLEAN NOT NULL DEFAULT false,
    "min_chunk_minutes" INTEGER,
    "hill_state" "HillState",
    "block_start" TIMESTAMP(3),
    "block_end" TIMESTAMP(3),
    "block_placed_by" "SetBy",
    "recurrence_rule_id" TEXT,
    "occurrence_date" DATE,
    "source" "TaskSource",
    "push_count" INTEGER NOT NULL DEFAULT 0,
    "keep_count" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "modified_at" TIMESTAMP(3) NOT NULL,
    "completed_at" TIMESTAMP(3),
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "task_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "task_person" (
    "task_id" TEXT NOT NULL,
    "person_id" TEXT NOT NULL,
    "role" "TaskRole" NOT NULL,

    CONSTRAINT "task_person_pkey" PRIMARY KEY ("task_id","person_id","role")
);

-- CreateTable
CREATE TABLE "blocker" (
    "id" TEXT NOT NULL,
    "task_id" TEXT NOT NULL,
    "person_id" TEXT,
    "event_text" TEXT,
    "expected_by" DATE,
    "state" "BlockerState" NOT NULL DEFAULT 'waiting',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "cleared_at" TIMESTAMP(3),

    CONSTRAINT "blocker_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "task_dependency" (
    "task_id" TEXT NOT NULL,
    "blocked_by_task_id" TEXT NOT NULL,

    CONSTRAINT "task_dependency_pkey" PRIMARY KEY ("task_id","blocked_by_task_id")
);

-- CreateTable
CREATE TABLE "reminder" (
    "id" TEXT NOT NULL,
    "task_id" TEXT NOT NULL,
    "offset_minutes" INTEGER,
    "absolute_at" TIMESTAMP(3),
    "is_start_reminder" BOOLEAN NOT NULL DEFAULT false,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "next_fire_at_utc" TIMESTAMP(3),
    "snooze_count" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reminder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reminder_event" (
    "id" TEXT NOT NULL,
    "reminder_id" TEXT NOT NULL,
    "fired_at" TIMESTAMP(3) NOT NULL,
    "devices_delivered" INTEGER,
    "outcome" "ReminderOutcome" NOT NULL,
    "snooze_reason" "SnoozeReason",
    "snooze_minutes" INTEGER,

    CONSTRAINT "reminder_event_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shift" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "start_time" TEXT NOT NULL,
    "end_time" TEXT NOT NULL,
    "weekdays" BOOLEAN[],
    "capacity_minutes" INTEGER,
    "capacity_from_window" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "shift_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shift_category" (
    "shift_id" TEXT NOT NULL,
    "category_id" TEXT NOT NULL,

    CONSTRAINT "shift_category_pkey" PRIMARY KEY ("shift_id","category_id")
);

-- CreateTable
CREATE TABLE "recurrence_rule" (
    "id" TEXT NOT NULL,
    "pattern" "RecurrencePattern" NOT NULL,
    "weekdays" BOOLEAN[],
    "day_of_month" INTEGER,
    "n" INTEGER,
    "mode" "RecurrenceMode" NOT NULL,
    "template" JSONB NOT NULL,

    CONSTRAINT "recurrence_rule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "note" (
    "id" TEXT NOT NULL,
    "task_id" TEXT,
    "body" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "note_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "override" (
    "id" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "rejected_task_id" TEXT,
    "chosen_task_id" TEXT,
    "reason_code" "OverrideReasonCode",
    "reason_text" TEXT,
    "points_at" "OverridePointsAt" NOT NULL,

    CONSTRAINT "override_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "planning_session" (
    "id" TEXT NOT NULL,
    "for_date" DATE NOT NULL,
    "started_at" TIMESTAMP(3),
    "finished_at" TIMESTAMP(3),
    "question_count" INTEGER,
    "dropped_task_ids" JSONB NOT NULL,
    "ran_mid_day" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "planning_session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "activity" (
    "id" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actor" "ActorKind" NOT NULL,
    "actor_person_id" TEXT,
    "verb" TEXT NOT NULL,
    "task_id" TEXT,
    "summary" TEXT NOT NULL,
    "filter_kind" "ActivityFilterKind",
    "undo_payload" JSONB,
    "undo_expires_at" TIMESTAMP(3),

    CONSTRAINT "activity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "device" (
    "id" TEXT NOT NULL,
    "endpoint" TEXT NOT NULL,
    "keys" JSONB NOT NULL,
    "label" TEXT,
    "notifications_enabled" BOOLEAN NOT NULL DEFAULT true,
    "last_seen_at" TIMESTAMP(3),

    CONSTRAINT "device_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "saved_view" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "filter" JSONB NOT NULL,
    "columns" JSONB NOT NULL,
    "grouping" JSONB,
    "sort" JSONB,
    "position" INTEGER,

    CONSTRAINT "saved_view_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "engagement_event" (
    "id" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "kind" "EngagementKind" NOT NULL,
    "platform" "Platform" NOT NULL,

    CONSTRAINT "engagement_event_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "account" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "provider_account_id" TEXT NOT NULL,
    "refresh_token" TEXT,
    "access_token" TEXT,
    "expires_at" INTEGER,
    "token_type" TEXT,
    "scope" TEXT,
    "id_token" TEXT,
    "session_state" TEXT,

    CONSTRAINT "account_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "session" (
    "id" TEXT NOT NULL,
    "session_token" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "expires" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "verification_token" (
    "identifier" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "expires" TIMESTAMP(3) NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "user_email_key" ON "user"("email");

-- CreateIndex
CREATE UNIQUE INDEX "device_endpoint_key" ON "device"("endpoint");

-- CreateIndex
CREATE UNIQUE INDEX "account_provider_provider_account_id_key" ON "account"("provider", "provider_account_id");

-- CreateIndex
CREATE UNIQUE INDEX "session_session_token_key" ON "session"("session_token");

-- CreateIndex
CREATE UNIQUE INDEX "verification_token_token_key" ON "verification_token"("token");

-- CreateIndex
CREATE UNIQUE INDEX "verification_token_identifier_token_key" ON "verification_token"("identifier", "token");

-- AddForeignKey
ALTER TABLE "project" ADD CONSTRAINT "project_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "project"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task" ADD CONSTRAINT "task_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "project"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task" ADD CONSTRAINT "task_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "category"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task" ADD CONSTRAINT "task_recurrence_rule_id_fkey" FOREIGN KEY ("recurrence_rule_id") REFERENCES "recurrence_rule"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_person" ADD CONSTRAINT "task_person_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "task"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_person" ADD CONSTRAINT "task_person_person_id_fkey" FOREIGN KEY ("person_id") REFERENCES "person"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "blocker" ADD CONSTRAINT "blocker_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "task"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "blocker" ADD CONSTRAINT "blocker_person_id_fkey" FOREIGN KEY ("person_id") REFERENCES "person"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_dependency" ADD CONSTRAINT "task_dependency_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "task"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_dependency" ADD CONSTRAINT "task_dependency_blocked_by_task_id_fkey" FOREIGN KEY ("blocked_by_task_id") REFERENCES "task"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reminder" ADD CONSTRAINT "reminder_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "task"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reminder_event" ADD CONSTRAINT "reminder_event_reminder_id_fkey" FOREIGN KEY ("reminder_id") REFERENCES "reminder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shift_category" ADD CONSTRAINT "shift_category_shift_id_fkey" FOREIGN KEY ("shift_id") REFERENCES "shift"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shift_category" ADD CONSTRAINT "shift_category_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "category"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "note" ADD CONSTRAINT "note_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "task"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "activity" ADD CONSTRAINT "activity_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "task"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "activity" ADD CONSTRAINT "activity_actor_person_id_fkey" FOREIGN KEY ("actor_person_id") REFERENCES "person"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "account" ADD CONSTRAINT "account_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "session" ADD CONSTRAINT "session_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

