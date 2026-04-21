package com.llmguard.api.persistence;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.IdClass;
import jakarta.persistence.Index;
import jakarta.persistence.Table;
import java.io.Serializable;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

@Entity
@Table(name = "events", indexes = {
        @Index(name = "ix_events_org_ts", columnList = "org_id, timestamp"),
        @Index(name = "ix_events_device_ts", columnList = "device_id, timestamp"),
        @Index(name = "ix_events_llm", columnList = "llm"),
        @Index(name = "ix_events_action", columnList = "action")
})
@IdClass(EventEntity.Key.class)
public class EventEntity {

    @Id
    @Column(name = "event_id", nullable = false)
    private UUID eventId;

    @Id
    @Column(name = "timestamp", nullable = false)
    private OffsetDateTime timestamp;

    @Column(name = "org_id", nullable = false, length = 64)
    private String orgId;

    @Column(name = "device_id", nullable = false)
    private UUID deviceId;

    @Column(name = "user_hint", length = 254)
    private String userHint;

    @Column(name = "hostname", nullable = false, length = 253)
    private String hostname;

    @Column(name = "llm", nullable = false, length = 32)
    private String llm;

    @Column(name = "action", nullable = false, length = 32)
    private String action;

    @Column(name = "endpoint", length = 512)
    private String endpoint;

    @Column(name = "mode", nullable = false, length = 16)
    private String mode;

    @Column(name = "prompt_length", nullable = false)
    private int promptLength;

    @Column(name = "mappings_count", nullable = false)
    private int mappingsCount;

    @Column(name = "anonymized_preview", columnDefinition = "text")
    private String anonymizedPreview;

    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "findings", nullable = false, columnDefinition = "jsonb")
    private List<Map<String, Object>> findings;

    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "attachment", columnDefinition = "jsonb")
    private Map<String, Object> attachment;

    @Column(name = "extension_version", nullable = false, length = 32)
    private String extensionVersion;

    @Column(name = "ingested_at", insertable = false, updatable = false)
    private OffsetDateTime ingestedAt;

    public UUID getEventId() { return eventId; }
    public void setEventId(UUID eventId) { this.eventId = eventId; }
    public OffsetDateTime getTimestamp() { return timestamp; }
    public void setTimestamp(OffsetDateTime timestamp) { this.timestamp = timestamp; }
    public String getOrgId() { return orgId; }
    public void setOrgId(String orgId) { this.orgId = orgId; }
    public UUID getDeviceId() { return deviceId; }
    public void setDeviceId(UUID deviceId) { this.deviceId = deviceId; }
    public String getUserHint() { return userHint; }
    public void setUserHint(String userHint) { this.userHint = userHint; }
    public String getHostname() { return hostname; }
    public void setHostname(String hostname) { this.hostname = hostname; }
    public String getLlm() { return llm; }
    public void setLlm(String llm) { this.llm = llm; }
    public String getAction() { return action; }
    public void setAction(String action) { this.action = action; }
    public String getEndpoint() { return endpoint; }
    public void setEndpoint(String endpoint) { this.endpoint = endpoint; }
    public String getMode() { return mode; }
    public void setMode(String mode) { this.mode = mode; }
    public int getPromptLength() { return promptLength; }
    public void setPromptLength(int promptLength) { this.promptLength = promptLength; }
    public int getMappingsCount() { return mappingsCount; }
    public void setMappingsCount(int mappingsCount) { this.mappingsCount = mappingsCount; }
    public String getAnonymizedPreview() { return anonymizedPreview; }
    public void setAnonymizedPreview(String anonymizedPreview) { this.anonymizedPreview = anonymizedPreview; }
    public List<Map<String, Object>> getFindings() { return findings; }
    public void setFindings(List<Map<String, Object>> findings) { this.findings = findings; }
    public Map<String, Object> getAttachment() { return attachment; }
    public void setAttachment(Map<String, Object> attachment) { this.attachment = attachment; }
    public String getExtensionVersion() { return extensionVersion; }
    public void setExtensionVersion(String extensionVersion) { this.extensionVersion = extensionVersion; }
    public OffsetDateTime getIngestedAt() { return ingestedAt; }

    public record Key(UUID eventId, OffsetDateTime timestamp) implements Serializable {
        public Key() { this(null, null); }
    }
}
