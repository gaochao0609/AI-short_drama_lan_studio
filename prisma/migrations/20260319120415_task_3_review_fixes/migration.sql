-- CreateEnum
CREATE TYPE "ScriptSessionStatus" AS ENUM ('ACTIVE', 'COMPLETED', 'CANCELED');

-- AlterTable
ALTER TABLE "model_providers" ADD COLUMN     "max_retries" INTEGER NOT NULL DEFAULT 2,
ADD COLUMN     "timeout_ms" INTEGER NOT NULL DEFAULT 30000;

-- AlterTable
ALTER TABLE "script_sessions" DROP COLUMN "current_turn",
DROP COLUMN "is_complete",
ADD COLUMN     "completed_rounds" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "final_script_version_id" TEXT,
ADD COLUMN     "qa_records_json" JSONB,
ADD COLUMN     "status" "ScriptSessionStatus" NOT NULL DEFAULT 'ACTIVE';

-- AlterTable
ALTER TABLE "script_versions" ADD COLUMN     "body" TEXT,
ADD COLUMN     "clarification_qa_json" JSONB,
ADD COLUMN     "model_metadata_json" JSONB,
ADD COLUMN     "model_name" TEXT,
ADD COLUMN     "model_provider_key" TEXT,
ADD COLUMN     "source_idea" TEXT;

-- AlterTable
ALTER TABLE "storyboard_versions" ADD COLUMN     "model_metadata_json" JSONB,
ADD COLUMN     "model_name" TEXT,
ADD COLUMN     "model_provider_key" TEXT;

-- AlterTable
ALTER TABLE "task_steps" ADD COLUMN     "log" TEXT,
ADD COLUMN     "raw_response_summary" TEXT,
ADD COLUMN     "retry_count" INTEGER NOT NULL DEFAULT 0;

-- CreateIndex
CREATE UNIQUE INDEX "script_sessions_final_script_version_id_key" ON "script_sessions"("final_script_version_id");

-- AddForeignKey
ALTER TABLE "script_sessions" ADD CONSTRAINT "script_sessions_final_script_version_id_fkey" FOREIGN KEY ("final_script_version_id") REFERENCES "script_versions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
