-- WP3 · explicit sequence order.
--
-- A task's position within its project. Sequence projects expose their first
-- unfinished step, and "first" must mean lowest position — ordering by
-- created_at can neither insert a step into the middle of a sequence nor
-- reorder steps, and WP4's board and WP8's recurrence read this same order.
--
-- The column is added NOT NULL DEFAULT 0, then every existing row is backfilled
-- to its per-project creation rank (0, 1, 2, …), so today's data keeps exactly
-- the order it already had. New rows get their position from the app.

ALTER TABLE "task" ADD COLUMN "position" INTEGER NOT NULL DEFAULT 0;

WITH ranked AS (
  SELECT "id",
         ROW_NUMBER() OVER (PARTITION BY "project_id" ORDER BY "created_at", "id") - 1 AS rn
  FROM "task"
)
UPDATE "task" AS t
SET "position" = ranked.rn
FROM ranked
WHERE t."id" = ranked."id";
