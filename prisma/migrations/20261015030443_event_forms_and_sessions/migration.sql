-- CreateEnum
CREATE TYPE "EventRegistrationMode" AS ENUM ('ACCOUNT', 'FORM');

-- CreateEnum
CREATE TYPE "FeeStatus" AS ENUM ('UNPAID', 'PARTIAL', 'PAID');

-- DropIndex
DROP INDEX "EventRegistration_eventId_userId_key";

-- AlterTable
ALTER TABLE "Event" ADD COLUMN     "archivedAt" TIMESTAMP(3),
ADD COLUMN     "confirmationMessage" TEXT,
ADD COLUMN     "eligibility" TEXT,
ADD COLUMN     "formFields" JSONB NOT NULL DEFAULT '[]',
ADD COLUMN     "minSessions" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "onlinePayment" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "paymentInstructions" TEXT,
ADD COLUMN     "registrationIntro" TEXT,
ADD COLUMN     "registrationMode" "EventRegistrationMode" NOT NULL DEFAULT 'ACCOUNT',
ADD COLUMN     "sessionLabel" TEXT NOT NULL DEFAULT 'Session',
ADD COLUMN     "submitLabel" TEXT;

-- AlterTable
ALTER TABLE "EventRegistration" ADD COLUMN     "amountPaid" DECIMAL(12,2) NOT NULL DEFAULT 0,
ADD COLUMN     "answers" JSONB,
ADD COLUMN     "contactEmail" TEXT,
ADD COLUMN     "contactName" TEXT,
ADD COLUMN     "contactPhone" TEXT,
ADD COLUMN     "declaredReference" TEXT,
ADD COLUMN     "feeStatus" "FeeStatus" NOT NULL DEFAULT 'UNPAID',
ADD COLUMN     "participantName" TEXT,
ADD COLUMN     "paymentMethod" TEXT;

-- AlterTable
ALTER TABLE "OrderItem" ADD COLUMN     "eventRegistrationItemId" TEXT;

-- CreateTable
CREATE TABLE "EventSession" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "paymentDeadline" TIMESTAMP(3),
    "capacity" INTEGER,
    "position" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "EventSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EventPackage" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "price" DECIMAL(12,2) NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "EventPackage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EventRegistrationItem" (
    "id" TEXT NOT NULL,
    "registrationId" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "packageId" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "price" DECIMAL(12,2) NOT NULL,
    "paidAt" TIMESTAMP(3),

    CONSTRAINT "EventRegistrationItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EventPaymentRecord" (
    "id" TEXT NOT NULL,
    "registrationId" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "method" TEXT NOT NULL,
    "reference" TEXT,
    "note" TEXT,
    "paymentId" TEXT,
    "recordedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EventPaymentRecord_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "EventSession_eventId_position_idx" ON "EventSession"("eventId", "position");

-- CreateIndex
CREATE INDEX "EventPackage_eventId_position_idx" ON "EventPackage"("eventId", "position");

-- CreateIndex
CREATE INDEX "EventRegistrationItem_sessionId_idx" ON "EventRegistrationItem"("sessionId");

-- CreateIndex
CREATE UNIQUE INDEX "EventRegistrationItem_registrationId_sessionId_key" ON "EventRegistrationItem"("registrationId", "sessionId");

-- CreateIndex
CREATE INDEX "EventPaymentRecord_registrationId_idx" ON "EventPaymentRecord"("registrationId");

-- CreateIndex
CREATE INDEX "EventRegistration_eventId_userId_idx" ON "EventRegistration"("eventId", "userId");

-- CreateIndex
CREATE INDEX "OrderItem_eventRegistrationItemId_idx" ON "OrderItem"("eventRegistrationItemId");

-- AddForeignKey
ALTER TABLE "EventSession" ADD CONSTRAINT "EventSession_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventPackage" ADD CONSTRAINT "EventPackage_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventRegistrationItem" ADD CONSTRAINT "EventRegistrationItem_registrationId_fkey" FOREIGN KEY ("registrationId") REFERENCES "EventRegistration"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventRegistrationItem" ADD CONSTRAINT "EventRegistrationItem_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "EventSession"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventRegistrationItem" ADD CONSTRAINT "EventRegistrationItem_packageId_fkey" FOREIGN KEY ("packageId") REFERENCES "EventPackage"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventPaymentRecord" ADD CONSTRAINT "EventPaymentRecord_registrationId_fkey" FOREIGN KEY ("registrationId") REFERENCES "EventRegistration"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_eventRegistrationItemId_fkey" FOREIGN KEY ("eventRegistrationItemId") REFERENCES "EventRegistrationItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Permissions for the new event capabilities. Only added to an already-seeded
-- matrix (an empty matrix falls back to code defaults); re-running is a no-op.
INSERT INTO "Permission" ("id", "key", "description", "group")
SELECT 'perm_events_publish', 'events.publish', 'Publish, unpublish, cancel and archive events', 'Events'
WHERE EXISTS (SELECT 1 FROM "RolePermission")
ON CONFLICT ("key") DO NOTHING;

INSERT INTO "Permission" ("id", "key", "description", "group")
SELECT 'perm_events_sensitive', 'events.sensitive', 'View registrants'' health and safety answers', 'Events'
WHERE EXISTS (SELECT 1 FROM "RolePermission")
ON CONFLICT ("key") DO NOTHING;

INSERT INTO "RolePermission" ("role", "permissionId")
SELECT 'ADMIN', p."id" FROM "Permission" p
WHERE p."key" IN ('events.publish', 'events.sensitive') AND EXISTS (SELECT 1 FROM "RolePermission")
ON CONFLICT DO NOTHING;
