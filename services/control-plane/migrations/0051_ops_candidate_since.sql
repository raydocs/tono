-- Unix seconds when the current candidate verdict was first observed.
-- NULL when candidate_verdict equals the committed verdict (no pending flip).
-- candidate_streak stays: tests and telemetry still read consecutive passes.
ALTER TABLE ops_node_status ADD COLUMN candidate_since INTEGER;
