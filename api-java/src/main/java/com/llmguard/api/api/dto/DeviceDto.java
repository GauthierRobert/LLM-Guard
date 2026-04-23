package com.llmguard.api.api.dto;

import com.fasterxml.jackson.annotation.JsonInclude;
import java.time.OffsetDateTime;
import java.util.UUID;

@JsonInclude(JsonInclude.Include.NON_NULL)
public record DeviceDto(
        UUID id,
        String userHint,
        String extensionVersion,
        OffsetDateTime createdAt,
        OffsetDateTime lastSeenAt,
        boolean revoked,
        long eventCount24h) {
}
