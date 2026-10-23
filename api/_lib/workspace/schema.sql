-- Apply with: npm run db:migrate (DATABASE_URL must point at a Neon branch).
CREATE EXTENSION IF NOT EXISTS vector;
CREATE TABLE IF NOT EXISTS orin_workspace_accounts (
  id text PRIMARY KEY,
  clerk_id text UNIQUE NOT NULL,
  name text NOT NULL DEFAULT '',
  email text NOT NULL DEFAULT '',
  role text NOT NULL DEFAULT 'member' CHECK (role IN ('member','admin')),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS orin_workspace_conversations (
  id uuid PRIMARY KEY,
  account_id text NOT NULL REFERENCES orin_workspace_accounts(id),
  title text NOT NULL DEFAULT 'New conversation',
  thinking boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);
CREATE INDEX IF NOT EXISTS orin_workspace_history_idx ON orin_workspace_conversations(account_id, updated_at DESC, id);
CREATE TABLE IF NOT EXISTS orin_workspace_messages (
  id uuid PRIMARY KEY,
  conversation_id uuid NOT NULL REFERENCES orin_workspace_conversations(id),
  account_id text NOT NULL,
  request_id uuid NOT NULL,
  role text NOT NULL CHECK (role IN ('user','assistant')),
  content text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'complete',
  model text,
  metadata jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(account_id, request_id, role)
);
CREATE INDEX IF NOT EXISTS orin_workspace_messages_idx ON orin_workspace_messages(conversation_id, created_at, id);
CREATE TABLE IF NOT EXISTS orin_workspace_requests (
  id uuid PRIMARY KEY,
  account_id text NOT NULL,
  conversation_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  response jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
-- Config, encrypted credentials, model catalog, documents, audit, and leased jobs.
CREATE TABLE IF NOT EXISTS orin_workspace_records (
  kind text NOT NULL,
  id text NOT NULL,
  data jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(kind,id)
);
CREATE INDEX IF NOT EXISTS orin_workspace_records_kind_idx ON orin_workspace_records(kind, updated_at DESC);
CREATE TABLE IF NOT EXISTS orin_workspace_chunks (
  id uuid PRIMARY KEY,
  document_id text NOT NULL,
  version text NOT NULL,
  ordinal integer NOT NULL,
  title text NOT NULL,
  section text NOT NULL,
  content text NOT NULL,
  embedding_space text,
  embedding vector,
  search tsvector GENERATED ALWAYS AS (to_tsvector('simple', title || ' ' || section || ' ' || content)) STORED,
  UNIQUE(document_id, version, ordinal)
);
CREATE INDEX IF NOT EXISTS orin_workspace_chunks_fts_idx ON orin_workspace_chunks USING gin(search);
CREATE INDEX IF NOT EXISTS orin_workspace_chunks_doc_idx ON orin_workspace_chunks(document_id,version);
