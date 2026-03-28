ALTER TABLE "Recipe"
  ADD COLUMN "cuisineTags" TEXT[] DEFAULT ARRAY[]::TEXT[];

CREATE TABLE "RecipeViewEvent" (
  "id" UUID NOT NULL,
  "recipeId" UUID NOT NULL,
  "userId" UUID,
  "sessionId" VARCHAR(100),
  "viewedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "RecipeViewEvent_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "RecipeViewEvent_recipeId_viewedAt_idx"
ON "RecipeViewEvent"("recipeId", "viewedAt");

CREATE INDEX "RecipeViewEvent_userId_viewedAt_idx"
ON "RecipeViewEvent"("userId", "viewedAt");

CREATE INDEX "RecipeViewEvent_sessionId_viewedAt_idx"
ON "RecipeViewEvent"("sessionId", "viewedAt");

ALTER TABLE "RecipeViewEvent"
  ADD CONSTRAINT "RecipeViewEvent_recipeId_fkey"
  FOREIGN KEY ("recipeId") REFERENCES "Recipe"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "RecipeViewEvent"
  ADD CONSTRAINT "RecipeViewEvent_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
