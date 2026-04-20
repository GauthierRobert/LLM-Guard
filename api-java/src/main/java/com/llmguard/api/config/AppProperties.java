package com.llmguard.api.config;

import org.springframework.boot.context.properties.ConfigurationProperties;

@ConfigurationProperties(prefix = "llmguard")
public record AppProperties(
        String orgId,
        String deviceTokenSecret,
        String corsOrigins,
        String keycloakAudience) {
}
