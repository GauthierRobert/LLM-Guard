"""Initial schema: orgs, devices, events (TimescaleDB hypertable).

Revision ID: 0001_initial
Revises:
Create Date: 2026-04-20
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "0001_initial"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("CREATE EXTENSION IF NOT EXISTS timescaledb")

    op.create_table(
        "orgs",
        sa.Column("id", sa.String(64), primary_key=True),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )

    op.create_table(
        "devices",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("org_id", sa.String(64), sa.ForeignKey("orgs.id"), nullable=False, index=True),
        sa.Column("user_hint", sa.String(254)),
        sa.Column("extension_version", sa.String(32)),
        sa.Column("token_hash", sa.String(128), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("last_seen_at", sa.DateTime(timezone=True)),
        sa.Column("revoked", sa.Boolean, nullable=False, server_default=sa.false()),
    )

    op.create_table(
        "events",
        sa.Column("event_id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("timestamp", sa.DateTime(timezone=True), primary_key=True, index=True),
        sa.Column("org_id", sa.String(64), nullable=False),
        sa.Column("device_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("user_hint", sa.String(254)),
        sa.Column("hostname", sa.String(253), nullable=False),
        sa.Column("llm", sa.String(32), nullable=False),
        sa.Column("action", sa.String(32), nullable=False),
        sa.Column("endpoint", sa.String(512)),
        sa.Column("mode", sa.String(16), nullable=False),
        sa.Column("prompt_length", sa.Integer, nullable=False, server_default="0"),
        sa.Column("mappings_count", sa.Integer, nullable=False, server_default="0"),
        sa.Column("anonymized_preview", sa.Text),
        sa.Column("findings", postgresql.JSONB, nullable=False, server_default=sa.text("'[]'::jsonb")),
        sa.Column("extension_version", sa.String(32), nullable=False),
        sa.Column("ingested_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index("ix_events_org_ts", "events", ["org_id", "timestamp"])
    op.create_index("ix_events_device_ts", "events", ["device_id", "timestamp"])
    op.create_index("ix_events_llm", "events", ["llm"])
    op.create_index("ix_events_action", "events", ["action"])

    # Convert events into a TimescaleDB hypertable partitioned by timestamp.
    op.execute("SELECT create_hypertable('events', 'timestamp', if_not_exists => TRUE)")

    # Continuous aggregate: daily rollup per org/llm/action.
    op.execute(
        """
        CREATE MATERIALIZED VIEW IF NOT EXISTS events_daily
        WITH (timescaledb.continuous) AS
        SELECT
          time_bucket('1 day', timestamp) AS day,
          org_id, llm, action,
          count(*) AS n,
          sum(prompt_length) AS total_prompt_length
        FROM events
        GROUP BY day, org_id, llm, action
        WITH NO DATA
        """
    )
    op.execute(
        """
        SELECT add_continuous_aggregate_policy('events_daily',
          start_offset => INTERVAL '30 days',
          end_offset   => INTERVAL '1 hour',
          schedule_interval => INTERVAL '1 hour')
        """
    )


def downgrade() -> None:
    op.execute("DROP MATERIALIZED VIEW IF EXISTS events_daily")
    op.drop_index("ix_events_action", table_name="events")
    op.drop_index("ix_events_llm", table_name="events")
    op.drop_index("ix_events_device_ts", table_name="events")
    op.drop_index("ix_events_org_ts", table_name="events")
    op.drop_table("events")
    op.drop_table("devices")
    op.drop_table("orgs")
