package com.llmguard.api.api.dto;

import com.fasterxml.jackson.annotation.JsonInclude;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;

@JsonInclude(JsonInclude.Include.NON_NULL)
public record AttachmentDto(
        @Pattern(regexp = "^[a-f0-9]*$") @Size(max = 64) String sha256,
        @Size(max = 128) String mimeType,
        @Min(0) Integer sizeBytes,
        @Min(0) Integer extractedChars,
        Boolean truncated,
        @Size(max = 32) String extractorId,
        Boolean unavailable,
        Boolean passwordProtected) {
}
