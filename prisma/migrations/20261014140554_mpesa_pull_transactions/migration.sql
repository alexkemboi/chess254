-- AlterTable
ALTER TABLE "PaymentConfiguration" ADD COLUMN     "pullEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "pullLastSyncedAt" TIMESTAMP(3),
ADD COLUMN     "pullNominatedNumber" TEXT,
ADD COLUMN     "pullRegisteredAt" TIMESTAMP(3),
ADD COLUMN     "pullShortcode" TEXT;

-- CreateTable
CREATE TABLE "MpesaTransaction" (
    "id" TEXT NOT NULL,
    "transactionId" TEXT NOT NULL,
    "shortcode" TEXT NOT NULL,
    "transactionDate" TIMESTAMP(3) NOT NULL,
    "msisdn" TEXT,
    "sender" TEXT,
    "transactionType" TEXT,
    "billReference" TEXT,
    "amount" DECIMAL(12,2) NOT NULL,
    "organizationName" TEXT,
    "raw" JSONB NOT NULL,
    "matchStatus" TEXT NOT NULL DEFAULT 'UNMATCHED',
    "note" TEXT,
    "paymentId" TEXT,
    "pulledAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MpesaTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MpesaTransaction_transactionId_key" ON "MpesaTransaction"("transactionId");

-- CreateIndex
CREATE INDEX "MpesaTransaction_matchStatus_transactionDate_idx" ON "MpesaTransaction"("matchStatus", "transactionDate");

-- CreateIndex
CREATE INDEX "MpesaTransaction_billReference_idx" ON "MpesaTransaction"("billReference");

-- CreateIndex
CREATE INDEX "MpesaTransaction_paymentId_idx" ON "MpesaTransaction"("paymentId");

-- AddForeignKey
ALTER TABLE "MpesaTransaction" ADD CONSTRAINT "MpesaTransaction_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE SET NULL ON UPDATE CASCADE;
