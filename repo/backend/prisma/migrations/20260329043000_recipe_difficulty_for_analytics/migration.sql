CREATE TYPE "RecipeDifficulty" AS ENUM ('EASY', 'MEDIUM', 'HARD', 'EXPERT');

ALTER TABLE "Recipe"
  ADD COLUMN "difficulty" "RecipeDifficulty" NOT NULL DEFAULT 'MEDIUM';

CREATE INDEX "Recipe_difficulty_idx"
ON "Recipe"("difficulty");
