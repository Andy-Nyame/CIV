-- CreateEnum
CREATE TYPE "PlatformInvitationStatus" AS ENUM ('PENDING', 'ACCEPTED', 'EXPIRED', 'REVOKED');

-- CreateTable
CREATE TABLE "PlatformInvitation" (
    "id" UUID NOT NULL,
    "email" VARCHAR(320) NOT NULL,
    "role" "PlatformRole" NOT NULL,
    "status" "PlatformInvitationStatus" NOT NULL DEFAULT 'PENDING',
    "tokenHash" CHAR(64) NOT NULL,
    "invitedByUserId" UUID NOT NULL,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "acceptedAt" TIMESTAMPTZ(3),
    "revokedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "PlatformInvitation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlatformAuditEvent" (
    "id" UUID NOT NULL,
    "action" VARCHAR(150) NOT NULL,
    "actorUserId" UUID,
    "actorDisplayName" VARCHAR(320),
    "resourceType" VARCHAR(100) NOT NULL,
    "resourceId" VARCHAR(100),
    "metadata" JSONB,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PlatformAuditEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PlatformInvitation_tokenHash_key" ON "PlatformInvitation"("tokenHash");

-- CreateIndex
CREATE INDEX "PlatformInvitation_status_expiresAt_idx" ON "PlatformInvitation"("status", "expiresAt");

-- CreateIndex
CREATE INDEX "PlatformInvitation_email_status_idx" ON "PlatformInvitation"("email", "status");

-- CreateIndex
CREATE INDEX "PlatformInvitation_invitedByUserId_idx" ON "PlatformInvitation"("invitedByUserId");

-- CreateIndex
CREATE UNIQUE INDEX "PlatformInvitation_pending_email_key" ON "PlatformInvitation"("email") WHERE ("status" = 'PENDING');

-- CreateIndex
CREATE INDEX "PlatformAuditEvent_createdAt_idx" ON "PlatformAuditEvent"("createdAt");

-- CreateIndex
CREATE INDEX "PlatformAuditEvent_actorUserId_idx" ON "PlatformAuditEvent"("actorUserId");

-- CreateIndex
CREATE INDEX "PlatformAuditEvent_action_createdAt_idx" ON "PlatformAuditEvent"("action", "createdAt");

-- CreateIndex
CREATE INDEX "PlatformAuditEvent_resourceType_resourceId_idx" ON "PlatformAuditEvent"("resourceType", "resourceId");

-- Enforce the single active Platform Owner invariant at the database layer.
CREATE UNIQUE INDEX "PlatformMembership_single_active_owner_key" ON "PlatformMembership"("role") WHERE ("role" = 'PLATFORM_OWNER' AND "status" = 'ACTIVE');

-- AddForeignKey
ALTER TABLE "PlatformInvitation" ADD CONSTRAINT "PlatformInvitation_invitedByUserId_fkey" FOREIGN KEY ("invitedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlatformAuditEvent" ADD CONSTRAINT "PlatformAuditEvent_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
