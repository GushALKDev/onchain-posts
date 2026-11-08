/**
 * Database schema (ADR-016). Postgres is both the database and the job queue (SELECT ... FOR UPDATE SKIP LOCKED).
 * Privacy boundary (ADR-013): signer addresses are stored only as HMACs and signatures only encrypted with a key that
 * lives outside the database.
 */
export const MIGRATIONS: { version: string; sql: string }[] = [
  {
    version: '001_init',
    sql: `
-- Username registry. PoC rule: the first signer to post with a username claims it (ADR-012).
CREATE TABLE usernames (
  username    text PRIMARY KEY,
  signer_hmac bytea NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- Per post: RECEIVED -> STORED (or FAILED after repeated upload errors).
CREATE TABLE posts (
  post_hash        bytea PRIMARY KEY,
  username         text NOT NULL REFERENCES usernames (username),
  caption          text NOT NULL,
  created_at       bigint NOT NULL,          -- signed by the client, unix seconds
  image_hash       bytea NOT NULL,
  image_bytes      bytea,                    -- held until uploaded, then cleared
  image_meta       jsonb,                    -- {bytes, width, height}
  chain_ids        integer[] NOT NULL,
  signer_hmac      bytea NOT NULL,
  intent_nonce     bytea NOT NULL,
  intent_deadline  bigint NOT NULL,
  sig_commit       bytea NOT NULL,
  signature_enc    bytea NOT NULL,           -- AES-256-GCM, key outside the database
  receipt          jsonb NOT NULL,
  accepted_at      bigint NOT NULL,
  state            text NOT NULL CHECK (state IN ('RECEIVED', 'STORED', 'FAILED')),
  image_arweave_id text,
  post_arweave_id  text,
  attempts         integer NOT NULL DEFAULT 0,
  last_error       text,
  updated_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (signer_hmac, intent_nonce)
);
CREATE INDEX posts_received_idx ON posts (accepted_at) WHERE state = 'RECEIVED';

-- Per batch and chain: CREATED -> READY (manifest stored) -> SUBMITTED -> ANCHORED (soft) -> SETTLED (safe), or FAILED.
CREATE TABLE batches (
  id                  bigserial PRIMARY KEY,
  chain_id            integer NOT NULL,
  root                bytea NOT NULL,
  manifest            jsonb NOT NULL,
  manifest_arweave_id text,
  post_count          integer NOT NULL,
  state               text NOT NULL CHECK (state IN ('CREATED', 'READY', 'SUBMITTED', 'ANCHORED', 'SETTLED', 'FAILED')),
  sender              bytea,                 -- relayer address, public on-chain anyway
  nonce               bigint,
  tx_hash             bytea,
  tx_history          jsonb NOT NULL DEFAULT '[]',   -- every hash sent with this nonce (replacements)
  max_fee_per_gas     numeric,
  max_priority_fee    numeric,
  submitted_at        timestamptz,
  block_number        bigint,
  anchored_at         bigint,                -- block.timestamp of the anchor
  attempts            integer NOT NULL DEFAULT 0,
  last_error          text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX batches_chain_state_idx ON batches (chain_id, state);

-- Per (post, chain): QUEUED until batched; afterwards the state is the batch's state.
CREATE TABLE post_chains (
  post_hash  bytea NOT NULL REFERENCES posts (post_hash),
  chain_id   integer NOT NULL,
  anchor_by  bigint NOT NULL,
  state      text NOT NULL CHECK (state IN ('WAITING', 'QUEUED', 'BATCHED')),
  batch_id   bigint REFERENCES batches (id),
  queued_at  timestamptz,
  PRIMARY KEY (post_hash, chain_id)
);
CREATE INDEX post_chains_queue_idx ON post_chains (chain_id, queued_at) WHERE state = 'QUEUED';

-- Audit log of on-demand signature disclosures (ADR-013).
CREATE TABLE disclosure_log (
  id           bigserial PRIMARY KEY,
  post_hash    bytea NOT NULL REFERENCES posts (post_hash),
  signer_hmac  bytea NOT NULL,
  disclosed_at timestamptz NOT NULL DEFAULT now()
);
`,
  },
];
