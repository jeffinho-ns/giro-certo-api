-- Reportes de posts (denúncias)
CREATE TABLE IF NOT EXISTS "PostReport" (
  id TEXT PRIMARY KEY,
  "postId" TEXT NOT NULL REFERENCES "Post"(id) ON DELETE CASCADE,
  "reporterId" TEXT NOT NULL REFERENCES "User"(id) ON DELETE CASCADE,
  reason TEXT NOT NULL,
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'reviewed', 'resolved')),
  "createdAt" TIMESTAMP DEFAULT NOW(),
  UNIQUE("postId", "reporterId")
);

CREATE INDEX IF NOT EXISTS "PostReport_postId_idx" ON "PostReport"("postId");
CREATE INDEX IF NOT EXISTS "PostReport_status_idx" ON "PostReport"(status);
