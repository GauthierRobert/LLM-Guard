-- Initial schema: orgs, devices, events (TimescaleDB hypertable).
-- Mirrors api/alembic/versions/0001_initial.py.

CREATE EXTENSION IF NOT EXISTS timescaledb;

CREATE TABLE IF NOT EXISTS orgs (
    id          VARCHAR(64) PRIMARY KEY,
    name        VARCHAR(255) NOT NULL,
    created_at  TIMESTAMPTZ  DEFAULT now()
);

CREATE TABLE IF NOT EXISTS devices (
    id                UUID PRIMARY KEY,
    org_id            VARCHAR(64) NOT NULL REFERENCES orgs(id),
    user_hint         VARCHAR(254),
    extension_version VARCHAR(32),
    token_hash        VARCHAR(128) NOT NULL,
    created_at        TIMESTAMPTZ DEFAULT now(),
    last_seen_at      TIMESTAMPTZ,
    revoked           BOOLEAN NOT NULL DEFAULT false
);
CREATE INDEX IF NOT EXISTS ix_devices_org ON devices (org_id);

CREATE TABLE IF NOT EXISTS events (
    event_id           UUID        NOT NULL,
    timestamp          TIMESTAMPTZ NOT NULL,
    org_id             VARCHAR(64) NOT NULL,
    device_id          UUID        NOT NULL,
    user_hint          VARCHAR(254),
    hostname           VARCHAR(253) NOT NULL,
    llm                VARCHAR(32)  NOT NULL,
    action             VARCHAR(32)  NOT NULL,
    endpoint           VARCHAR(512),
    mode               VARCHAR(16)  NOT NULL,
    prompt_length      INTEGER      NOT NULL DEFAULT 0,
    mappings_count     INTEGER      NOT NULL DEFAULT 0,
    anonymized_preview TEXT,
    findings           JSONB        NOT NULL DEFAULT '[]'::jsonb,
    attachment         JSONB,
    extension_version  VARCHAR(32)  NOT NULL,
    ingested_at        TIMESTAMPTZ  DEFAULT now(),
    PRIMARY KEY (event_id, timestamp)
);
CREATE INDEX IF NOT EXISTS ix_events_org_ts    ON events (org_id, timestamp);
CREATE INDEX IF NOT EXISTS ix_events_device_ts ON events (device_id, timestamp);
CREATE INDEX IF NOT EXISTS ix_events_llm       ON events (llm);
CREATE INDEX IF NOT EXISTS ix_events_action    ON events (action);

SELECT create_hypertable('events', 'timestamp', if_not_exists => TRUE);

CREATE MATERIALIZED VIEW IF NOT EXISTS events_daily
WITH (timescaledb.continuous) AS
SELECT
    time_bucket('1 day', timestamp) AS day,
    org_id, llm, action,
    count(*) AS n,
    sum(prompt_length) AS total_prompt_length
FROM events
GROUP BY day, org_id, llm, action
WITH NO DATA;

SELECT add_continuous_aggregate_policy(
    'events_daily',
    start_offset      => INTERVAL '30 days',
    end_offset        => INTERVAL '1 hour',
    schedule_interval => INTERVAL '1 hour'
);

INSERT INTO orgs (id, name) VALUES ('default', 'Default Organization')
ON CONFLICT (id) DO NOTHING;
