package com.llmguard.api.persistence;

import java.time.OffsetDateTime;
import java.util.List;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface DeviceRepository extends JpaRepository<DeviceEntity, UUID> {

    List<DeviceEntity> findByOrgIdOrderByLastSeenAtDesc(String orgId);

    @Modifying
    @Query("update DeviceEntity d set d.revoked = true where d.id = :id and d.orgId = :org")
    int revokeByIdAndOrgId(@Param("id") UUID id, @Param("org") String orgId);

    /**
     * Upsert: insert a self-registered telemetry device, or bump last_seen_at
     * on an existing one. token_hash is set to '' on first sight because the
     * ingest filter does not currently persist the per-device HMAC hash (see
     * DeviceTokenService TODO). Revoked devices keep revoked=true.
     */
    @Modifying
    @Query(value = """
            INSERT INTO devices (id, org_id, user_hint, extension_version, token_hash, last_seen_at, revoked)
            VALUES (:id, :org, :userHint, :extVersion, '', :seenAt, false)
            ON CONFLICT (id) DO UPDATE
                SET last_seen_at      = EXCLUDED.last_seen_at,
                    extension_version = COALESCE(EXCLUDED.extension_version, devices.extension_version),
                    user_hint         = COALESCE(EXCLUDED.user_hint,         devices.user_hint)
            """, nativeQuery = true)
    int upsertTelemetry(@Param("id") UUID id,
                        @Param("org") String orgId,
                        @Param("userHint") String userHint,
                        @Param("extVersion") String extensionVersion,
                        @Param("seenAt") OffsetDateTime seenAt);

    /**
     * Ensure the org row exists so the devices.org_id FK is satisfied. Noop
     * if already present. Name defaults to the id when auto-registered.
     */
    @Modifying
    @Query(value = """
            INSERT INTO orgs (id, name) VALUES (:id, :id)
            ON CONFLICT (id) DO NOTHING
            """, nativeQuery = true)
    int ensureOrg(@Param("id") String orgId);
}
