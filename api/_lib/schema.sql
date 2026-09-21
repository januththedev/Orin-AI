-- Orin AI Postgres schema (Neon). Run once in the Neon SQL editor.
-- One doc-store table mirrors the old Firestore collections, so the app
-- logic ports mechanically. Firebase Auth (tokens) is untouched.

CREATE TABLE IF NOT EXISTS orin_docs (
  collection TEXT NOT NULL,
  id TEXT NOT NULL,
  data JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (collection, id)
);

CREATE INDEX IF NOT EXISTS orin_docs_collection_idx ON orin_docs (collection);
