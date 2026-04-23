package com.llmguard.api.persistence;

import java.time.OffsetDateTime;
import java.util.Collection;
import java.util.List;
import java.util.UUID;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface EventRepository extends JpaRepository<EventEntity, EventEntity.Key> {

    @Query("select e.eventId from EventEntity e where e.eventId in :ids")
    List<UUID> findExistingIds(@Param("ids") Collection<UUID> ids);

    @Query("""
           select e from EventEntity e
           where e.orgId = :org and e.timestamp >= :since
             and (:llm is null or e.llm = :llm)
             and (:action is null or e.action = :action)
           order by e.timestamp desc
           """)
    List<EventEntity> findPage(
            @Param("org") String org,
            @Param("since") OffsetDateTime since,
            @Param("llm") String llm,
            @Param("action") String action,
            Pageable page);

    @Query("""
           select e.action, count(e) from EventEntity e
           where e.orgId = :org and e.timestamp >= :since
           group by e.action
           """)
    List<Object[]> countByAction(@Param("org") String org, @Param("since") OffsetDateTime since);

    @Query("""
           select e.llm, count(e) from EventEntity e
           where e.orgId = :org and e.timestamp >= :since
           group by e.llm
           """)
    List<Object[]> countByLlm(@Param("org") String org, @Param("since") OffsetDateTime since);

    @Query(value = """
            SELECT f->>'type' AS t, SUM((f->>'count')::int) AS c
            FROM events, jsonb_array_elements(findings) AS f
            WHERE org_id = :org AND timestamp >= :since
            GROUP BY t ORDER BY c DESC LIMIT 50
            """, nativeQuery = true)
    List<Object[]> countByFindingType(@Param("org") String org, @Param("since") OffsetDateTime since);

    @Query("""
           select e.deviceId, count(e) from EventEntity e
           where e.orgId = :org and e.timestamp >= :since
           group by e.deviceId
           """)
    List<Object[]> countByDeviceSince(@Param("org") String org, @Param("since") OffsetDateTime since);
}
