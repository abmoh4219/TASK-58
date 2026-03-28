ALTER TABLE "RecipeStep"
  ADD COLUMN "cueText" VARCHAR(255),
  ADD COLUMN "targetTempC" INTEGER,
  ADD COLUMN "heatLevel" VARCHAR(32);

ALTER TABLE "RecipeStep"
  ADD CONSTRAINT "RecipeStep_targetTempC_range_check"
  CHECK ("targetTempC" IS NULL OR ("targetTempC" >= -50 AND "targetTempC" <= 500));
