ALTER TYPE "TaskType" ADD VALUE IF NOT EXISTS 'ASSET_SCRIPT_PARSE';

CREATE TYPE "AssetCategory" AS ENUM (
  'SCRIPT_SOURCE',
  'SCRIPT_GENERATED',
  'IMAGE_SOURCE',
  'IMAGE_GENERATED',
  'VIDEO_GENERATED'
);

CREATE TYPE "AssetOrigin" AS ENUM ('UPLOAD', 'SYSTEM');

ALTER TABLE "assets"
  ADD COLUMN "category" "AssetCategory",
  ADD COLUMN "origin" "AssetOrigin";

CREATE TABLE "project_workflow_bindings" (
  "id" TEXT NOT NULL,
  "project_id" TEXT NOT NULL,
  "storyboard_script_asset_id" TEXT,
  "image_reference_asset_ids" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "video_reference_asset_ids" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "project_workflow_bindings_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "asset_source_links" (
  "id" TEXT NOT NULL,
  "asset_id" TEXT NOT NULL,
  "source_asset_id" TEXT NOT NULL,
  "role" TEXT NOT NULL,
  "order_index" INTEGER NOT NULL DEFAULT 0,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "asset_source_links_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "project_workflow_bindings_project_id_key" ON "project_workflow_bindings"("project_id");
CREATE INDEX "project_workflow_bindings_storyboard_script_asset_id_idx" ON "project_workflow_bindings"("storyboard_script_asset_id");
CREATE INDEX "asset_source_links_asset_id_idx" ON "asset_source_links"("asset_id");
CREATE INDEX "asset_source_links_source_asset_id_idx" ON "asset_source_links"("source_asset_id");
CREATE UNIQUE INDEX "asset_source_links_asset_id_source_asset_id_role_order_index_key"
  ON "asset_source_links"("asset_id", "source_asset_id", "role", "order_index");

ALTER TABLE "project_workflow_bindings"
  ADD CONSTRAINT "project_workflow_bindings_project_id_fkey"
  FOREIGN KEY ("project_id")
  REFERENCES "projects"("id")
  ON DELETE CASCADE
  ON UPDATE CASCADE;

ALTER TABLE "project_workflow_bindings"
  ADD CONSTRAINT "project_workflow_bindings_storyboard_script_asset_id_fkey"
  FOREIGN KEY ("storyboard_script_asset_id")
  REFERENCES "assets"("id")
  ON DELETE SET NULL
  ON UPDATE CASCADE;

ALTER TABLE "asset_source_links"
  ADD CONSTRAINT "asset_source_links_asset_id_fkey"
  FOREIGN KEY ("asset_id")
  REFERENCES "assets"("id")
  ON DELETE CASCADE
  ON UPDATE CASCADE;

ALTER TABLE "asset_source_links"
  ADD CONSTRAINT "asset_source_links_source_asset_id_fkey"
  FOREIGN KEY ("source_asset_id")
  REFERENCES "assets"("id")
  ON DELETE CASCADE
  ON UPDATE CASCADE;
