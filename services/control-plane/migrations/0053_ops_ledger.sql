-- Ledger entries, month close, and daily FX rates. Additive; no foreign keys.

PRAGMA foreign_keys = ON;

CREATE TABLE ops_ledger_entries (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK(kind IN ('revenue', 'refund', 'credit', 'cost')),
  category TEXT NOT NULL CHECK(category IN (
    'plan', 'server', 'home_line', 'domain', 'control_plane',
    'claude_account', 'chatgpt_account', 'other'
  )),
  subject_type TEXT NOT NULL CHECK(subject_type IN (
    'user', 'node', 'home_exit', 'account', 'fleet'
  )),
  subject_id TEXT,
  amount_minor INTEGER NOT NULL CHECK(amount_minor >= 0),
  currency TEXT NOT NULL CHECK(length(currency) = 3),
  fx_rate_to_cny REAL,
  fx_date TEXT,
  cny_minor INTEGER NOT NULL,
  month TEXT NOT NULL CHECK(month GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]'),
  paid_at INTEGER,
  note TEXT CHECK(length(note) <= 500),
  reverses TEXT,
  reversed_by TEXT,
  created_by TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX ops_ledger_entries_month ON ops_ledger_entries(month);
CREATE INDEX ops_ledger_entries_subject_month
  ON ops_ledger_entries(subject_type, subject_id, month);

CREATE TABLE ops_month_close (
  month TEXT PRIMARY KEY CHECK(month GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]'),
  closed_at INTEGER NOT NULL,
  closed_by TEXT,
  revenue_cny_minor INTEGER NOT NULL,
  cost_cny_minor INTEGER NOT NULL,
  margin_cny_minor INTEGER NOT NULL,
  unreconciled INTEGER NOT NULL,
  notes TEXT
);

CREATE TABLE ops_fx_rates (
  day TEXT NOT NULL CHECK(day GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  base TEXT NOT NULL CHECK(length(base) = 3),
  quote TEXT NOT NULL CHECK(length(quote) = 3),
  rate REAL NOT NULL,
  fetched_at INTEGER NOT NULL,
  source TEXT NOT NULL,
  PRIMARY KEY (day, base, quote)
);
