-- A cursor can be replayed safely only when the payload is byte-for-byte equivalent
-- after server-side canonicalization.
ALTER TABLE "SyncCursor" ADD COLUMN "batchDigest" TEXT;
