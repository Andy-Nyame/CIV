-- CreateTable
CREATE TABLE "ProfilePhoto" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "storageKey" VARCHAR(1024) NOT NULL,
    "mimeType" VARCHAR(50) NOT NULL,
    "width" INTEGER NOT NULL,
    "height" INTEGER NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "checksum" CHAR(64) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "ProfilePhoto_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ProfilePhoto_userId_key" ON "ProfilePhoto"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "ProfilePhoto_storageKey_key" ON "ProfilePhoto"("storageKey");

-- AddForeignKey
ALTER TABLE "ProfilePhoto" ADD CONSTRAINT "ProfilePhoto_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
