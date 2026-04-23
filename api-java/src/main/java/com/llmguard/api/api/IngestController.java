package com.llmguard.api.api;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.llmguard.api.api.dto.EventBatchDto;
import com.llmguard.api.api.dto.EventDto;
import com.llmguard.api.api.dto.IngestResultDto;
import com.llmguard.api.live.Broker;
import com.llmguard.api.persistence.DeviceRepository;
import com.llmguard.api.persistence.EventEntity;
import com.llmguard.api.persistence.EventRepository;
import jakarta.validation.Valid;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import org.springframework.http.MediaType;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/v1")
public class IngestController {

    private final EventRepository repo;
    private final DeviceRepository devices;
    private final Broker broker;
    private final ObjectMapper objectMapper;

    public IngestController(EventRepository repo, DeviceRepository devices, Broker broker, ObjectMapper objectMapper) {
        this.repo = repo;
        this.devices = devices;
        this.broker = broker;
        this.objectMapper = objectMapper;
    }

    @PostMapping(value = "/events", consumes = MediaType.APPLICATION_JSON_VALUE)
    @Transactional
    public IngestResultDto ingest(@RequestBody @Valid EventBatchDto batch) {
        List<UUID> ids = batch.events().stream().map(EventDto::eventId).toList();
        Set<UUID> seen = new HashSet<>(repo.findExistingIds(ids));

        // Upsert each distinct deviceId so the Devices dashboard knows the
        // fleet shape and last-seen time without needing a separate enrolment
        // endpoint. Latest row wins for user_hint / extension_version.
        Map<UUID, EventDto> latestPerDevice = new HashMap<>();
        for (EventDto ev : batch.events()) {
            EventDto prev = latestPerDevice.get(ev.deviceId());
            if (prev == null || ev.timestamp().isAfter(prev.timestamp())) {
                latestPerDevice.put(ev.deviceId(), ev);
            }
        }
        OffsetDateTime seenAt = OffsetDateTime.now(ZoneOffset.UTC);
        Set<String> touchedOrgs = new HashSet<>();
        for (EventDto latest : latestPerDevice.values()) {
            if (touchedOrgs.add(latest.orgId())) {
                devices.ensureOrg(latest.orgId());
            }
            devices.upsertTelemetry(
                    latest.deviceId(), latest.orgId(),
                    latest.userHint(), latest.extensionVersion(), seenAt);
        }

        List<EventEntity> rows = new ArrayList<>(batch.events().size());
        List<EventDto> toPublish = new ArrayList<>();
        for (EventDto ev : batch.events()) {
            if (seen.contains(ev.eventId())) {
                continue;
            }
            var row = new EventEntity();
            row.setEventId(ev.eventId());
            row.setTimestamp(ev.timestamp());
            row.setOrgId(ev.orgId());
            row.setDeviceId(ev.deviceId());
            row.setUserHint(ev.userHint());
            row.setHostname(ev.hostname());
            row.setLlm(ev.llm());
            row.setAction(ev.action());
            row.setEndpoint(ev.endpoint());
            row.setMode(ev.mode());
            row.setPromptLength(ev.promptLength());
            row.setMappingsCount(ev.mappingsCount());
            row.setAnonymizedPreview(ev.anonymizedPreview());
            row.setFindings(ev.findings().stream()
                    .map(f -> Map.<String, Object>of(
                            "type", f.type(),
                            "severity", f.severity(),
                            "count", f.count()))
                    .toList());
            if (ev.attachment() != null) {
                row.setAttachment(objectMapper.convertValue(ev.attachment(), Map.class));
            }
            row.setExtensionVersion(ev.extensionVersion());
            rows.add(row);
            toPublish.add(ev);
        }

        repo.saveAll(rows);

        for (EventDto ev : toPublish) {
            try {
                broker.publish(ev.orgId(), objectMapper.writeValueAsString(ev));
            } catch (Exception ignored) {
                // Broker publish is best-effort.
            }
        }

        return new IngestResultDto(rows.size(), seen.size());
    }
}
