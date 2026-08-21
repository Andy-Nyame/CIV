-- CreateEnum
CREATE TYPE "DocumentTemplateKind" AS ENUM ('BUILT_IN', 'WORKSPACE');

-- CreateEnum
CREATE TYPE "DocumentTemplateState" AS ENUM ('ACTIVE', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "DocumentTemplateVersionState" AS ENUM ('DRAFT', 'PUBLISHED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "DocumentTemplatePageSize" AS ENUM ('A4');

-- CreateTable
CREATE TABLE "DocumentTemplate" (
    "id" UUID NOT NULL,
    "workspaceId" UUID,
    "code" VARCHAR(80) NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "description" TEXT NOT NULL,
    "kind" "DocumentTemplateKind" NOT NULL,
    "state" "DocumentTemplateState" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "DocumentTemplate_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "DocumentTemplate_workspace_scope_check" CHECK (
        ("kind" = 'BUILT_IN' AND "workspaceId" IS NULL)
        OR ("kind" = 'WORKSPACE' AND "workspaceId" IS NOT NULL)
    )
);

-- CreateTable
CREATE TABLE "DocumentTemplateVersion" (
    "id" UUID NOT NULL,
    "templateId" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "state" "DocumentTemplateVersionState" NOT NULL DEFAULT 'DRAFT',
    "layoutSchemaVersion" INTEGER NOT NULL,
    "pageSize" "DocumentTemplatePageSize" NOT NULL,
    "layoutManifest" JSONB NOT NULL,
    "layoutChecksum" CHAR(64) NOT NULL,
    "rendererCompatibilityVersion" INTEGER NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "DocumentTemplateVersion_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "DocumentTemplateVersion_positive_versions_check" CHECK (
        "version" > 0
        AND "layoutSchemaVersion" > 0
        AND "rendererCompatibilityVersion" > 0
    ),
    CONSTRAINT "DocumentTemplateVersion_checksum_check" CHECK (
        "layoutChecksum" ~ '^[0-9a-f]{64}$'
    )
);

-- CreateIndex
CREATE UNIQUE INDEX "DocumentTemplate_code_key" ON "DocumentTemplate"("code");

-- CreateIndex
CREATE INDEX "DocumentTemplate_kind_state_idx" ON "DocumentTemplate"("kind", "state");

-- CreateIndex
CREATE INDEX "DocumentTemplate_workspaceId_state_idx" ON "DocumentTemplate"("workspaceId", "state");

-- CreateIndex
CREATE INDEX "DocumentTemplateVersion_templateId_state_version_idx" ON "DocumentTemplateVersion"("templateId", "state", "version");

-- CreateIndex
CREATE INDEX "DocumentTemplateVersion_state_idx" ON "DocumentTemplateVersion"("state");

-- CreateIndex
CREATE UNIQUE INDEX "DocumentTemplateVersion_templateId_version_key" ON "DocumentTemplateVersion"("templateId", "version");

-- AddForeignKey
ALTER TABLE "DocumentTemplate" ADD CONSTRAINT "DocumentTemplate_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentTemplateVersion" ADD CONSTRAINT "DocumentTemplateVersion_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "DocumentTemplate"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
