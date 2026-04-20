package com.llmguard.api.api.dto;

import com.fasterxml.jackson.annotation.JsonInclude;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.UUID;

/**
 * Wire contract from the extension. Mirrors shared/schema.json#/ (Event).
 * Unknown fields are rejected by Jackson config in IngestController.
 */
@JsonInclude(JsonInclude.Include.NON_NULL)
public record EventDto(
        @NotNull UUID eventId,
        @NotNull UUID deviceId,
        @NotBlank @Size(min = 1, max = 64) @Pattern(regexp = "^[a-zA-Z0-9_-]+$") String orgId,
        @Size(max = 254) String userHint,
        @NotNull OffsetDateTime timestamp,
        @NotBlank @Size(min = 1, max = 253) String hostname,
        @NotBlank @Pattern(regexp = "ChatGPT|Claude|Gemini|Copilot|Mistral|Perplexity|DeepSeek|Grok|Unknown") String llm,
        @NotBlank @Pattern(regexp = "CLEAN|ANONYMIZED|PII_DETECTED|BLOCKED|ATTACHMENT_CLEAN|ATTACHMENT_PII_DETECTED|ATTACHMENT_BLOCKED|ATTACHMENT_DETECTED|ATTACHMENT_UNSCANNED") String action,
        @Size(max = 512) String endpoint,
        @NotBlank @Pattern(regexp = "anonymize|block|visible") String mode,
        @Min(0) int promptLength,
        @Min(0) int mappingsCount,
        @Size(max = 200) String anonymizedPreview,
        @NotNull @Size(max = 50) @Valid List<FindingDto> findings,
        @Valid AttachmentDto attachment,
        @NotBlank @Pattern(regexp = "^\\d+\\.\\d+\\.\\d+$") String extensionVersion,
        @NotNull @Min(1) @Max(1) Integer schemaVersion) {
}
