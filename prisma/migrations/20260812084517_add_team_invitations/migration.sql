-- AlterTable
ALTER TABLE "Invitation"
ADD COLUMN "tokenHash" CHAR(64) NOT NULL,
ADD COLUMN "acceptedAt" TIMESTAMPTZ(3),
ADD COLUMN "revokedAt" TIMESTAMPTZ(3);

-- CreateIndex
CREATE UNIQUE INDEX "Invitation_tokenHash_key" ON "Invitation"("tokenHash");
