package com.llmguard.api.config;

import java.util.Arrays;
import java.util.List;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.context.annotation.Primary;
import org.springframework.web.cors.CorsConfiguration;
import org.springframework.web.cors.UrlBasedCorsConfigurationSource;

@Configuration
public class CorsConfig {

    @Bean
    @Primary
    UrlBasedCorsConfigurationSource corsConfigurationSource(AppProperties props) {
        var cfg = new CorsConfiguration();
        List<String> origins = Arrays.stream(props.corsOrigins().split(","))
                .map(String::trim)
                .filter(s -> !s.isEmpty())
                .toList();
        // setAllowedOriginPatterns (not setAllowedOrigins) so wildcard schemes
        // like "chrome-extension://*" work alongside allowCredentials=true.
        cfg.setAllowedOriginPatterns(origins);
        cfg.setAllowedMethods(List.of("GET", "POST", "OPTIONS"));
        cfg.setAllowedHeaders(List.of("Authorization", "Content-Type"));
        cfg.setAllowCredentials(true);

        var source = new UrlBasedCorsConfigurationSource();
        source.registerCorsConfiguration("/v1/**", cfg);
        return source;
    }
}
