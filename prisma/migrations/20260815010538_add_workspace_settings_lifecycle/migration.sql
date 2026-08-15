-- AlterTable
ALTER TABLE "Workspace" ADD COLUMN     "address" TEXT,
ADD COLUMN     "businessTin" VARCHAR(100),
ADD COLUMN     "country" CHAR(2) NOT NULL DEFAULT 'GH',
ADD COLUMN     "currency" CHAR(3) NOT NULL DEFAULT 'GHS',
ADD COLUMN     "email" VARCHAR(320),
ADD COLUMN     "phone" VARCHAR(50),
ADD COLUMN     "registrationNumber" VARCHAR(100);

-- CreateTable
CREATE TABLE "WorkspaceLogo" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "storageKey" VARCHAR(1024) NOT NULL,
    "mimeType" VARCHAR(50) NOT NULL,
    "width" INTEGER NOT NULL,
    "height" INTEGER NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "checksum" CHAR(64) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "WorkspaceLogo_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "WorkspaceLogo_workspaceId_key" ON "WorkspaceLogo"("workspaceId");

-- CreateIndex
CREATE UNIQUE INDEX "WorkspaceLogo_storageKey_key" ON "WorkspaceLogo"("storageKey");

-- AddForeignKey
ALTER TABLE "WorkspaceLogo" ADD CONSTRAINT "WorkspaceLogo_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
