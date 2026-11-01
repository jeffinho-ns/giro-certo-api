-- RSVP de eventos sociais (presença sincronizada entre dispositivos).
-- Idempotente.

CREATE TABLE IF NOT EXISTS "EventRsvp" (
  id TEXT PRIMARY KEY,
  "eventId" TEXT NOT NULL REFERENCES "SocialEvent"(id) ON DELETE CASCADE,
  "userId" TEXT NOT NULL REFERENCES "User"(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN ('going', 'maybe', 'declined')),
  "createdAt" TIMESTAMP DEFAULT NOW(),
  "updatedAt" TIMESTAMP DEFAULT NOW(),
  UNIQUE("eventId", "userId")
);

CREATE INDEX IF NOT EXISTS "EventRsvp_eventId_idx" ON "EventRsvp"("eventId");
CREATE INDEX IF NOT EXISTS "EventRsvp_userId_idx" ON "EventRsvp"("userId");
CREATE INDEX IF NOT EXISTS "EventRsvp_eventId_status_idx" ON "EventRsvp"("eventId", status);
