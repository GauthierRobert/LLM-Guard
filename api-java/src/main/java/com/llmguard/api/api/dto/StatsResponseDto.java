package com.llmguard.api.api.dto;

import java.util.Map;

public record StatsResponseDto(
        long total,
        long clean,
        long flagged,
        long blocked,
        long anonymized,
        Map<String, Long> byLlm,
        Map<String, Long> byType) {
}
