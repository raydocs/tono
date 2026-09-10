-- Follow-ups (reply / await customer / callback / verified / note) and the two
-- incident fields that close the morning loop: next check time, and how the
-- incident was closed. `closure` is enforced in code — SQLite ALTER cannot add
-- a CHECK safely. Retention: follow-ups with done_at older than 400 days.
CREATE TABLE ops_followups (
  id TEXT PRIMARY KEY,
  subject_type TEXT NOT NULL CHECK(subject_type IN ('user','incident','node')),
  subject_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('reply','await_customer','callback','verified','note')),
  body TEXT NOT NULL CHECK(length(body) <= 2000),
  due_at INTEGER,
  done_at INTEGER,
  created_by TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX ops_followups_subject ON ops_followups(subject_type, subject_id, created_at DESC);
CREATE INDEX ops_followups_due_open ON ops_followups(due_at) WHERE done_at IS NULL;

ALTER TABLE ops_incidents ADD COLUMN next_check_at INTEGER;
ALTER TABLE ops_incidents ADD COLUMN closure TEXT;
