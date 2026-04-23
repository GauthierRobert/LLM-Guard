package com.llmguard.api.config;

import com.llmguard.api.audit.AuditLogFilter;
import com.llmguard.api.auth.AuthRateLimiter;
import com.llmguard.api.auth.DeviceTokenAuthFilter;
import com.llmguard.api.auth.DeviceTokenService;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.HttpMethod;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.http.SessionCreationPolicy;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.security.web.authentication.UsernamePasswordAuthenticationFilter;
import org.springframework.web.cors.CorsConfigurationSource;

/**
 * Three-chain security:
 *   1. POST /v1/events — device bearer token (HMAC check + DevicePrincipal).
 *   2. GET  /v1/stats, /v1/events — Keycloak OIDC JWT (stubbed permitAll when issuer blank).
 *   3. Everything else (health, websocket handshake) — open.
 */
@Configuration
public class SecurityConfig {

    @Bean
    SecurityFilterChain filterChain(
            HttpSecurity http,
            DeviceTokenService tokens,
            AuthRateLimiter rateLimiter,
            CorsConfigurationSource corsSource,
            AuditLogFilter auditLogFilter,
            @Value("${spring.security.oauth2.resourceserver.jwt.issuer-uri:}") String keycloakIssuer)
            throws Exception {

        boolean jwtEnabled = keycloakIssuer != null && !keycloakIssuer.isBlank();

        http
            .cors(c -> c.configurationSource(corsSource))
            .csrf(csrf -> csrf.disable())
            .sessionManagement(s -> s.sessionCreationPolicy(SessionCreationPolicy.STATELESS))
            .authorizeHttpRequests(auth -> auth
                .requestMatchers("/v1/health", "/actuator/**", "/v1/live").permitAll()
                // POST ingest is enforced by DeviceTokenAuthFilter; permit for the chain.
                .requestMatchers(HttpMethod.POST, "/v1/events").permitAll()
                .requestMatchers(HttpMethod.GET, "/v1/events", "/v1/stats", "/v1/findings/**", "/v1/devices", "/v1/devices/**")
                    .access((auth2, ctx) -> new org.springframework.security.authorization.AuthorizationDecision(
                            !jwtEnabled || auth2.get().isAuthenticated()))
                .requestMatchers(HttpMethod.POST, "/v1/devices/*/revoke")
                    .access((auth2, ctx) -> new org.springframework.security.authorization.AuthorizationDecision(
                            !jwtEnabled || auth2.get().isAuthenticated()))
                .anyRequest().permitAll())
            .addFilterBefore(new DeviceTokenAuthFilter(tokens, rateLimiter), UsernamePasswordAuthenticationFilter.class)
            // Registered directly here — @Component + @Order alone isn't enough when
            // Spring Security builds its own chain; this line guarantees every
            // /v1/* request is observed and logged with the resolved principal.
            .addFilterAfter(auditLogFilter, DeviceTokenAuthFilter.class);

        if (jwtEnabled) {
            http.oauth2ResourceServer(oauth -> oauth.jwt(jwt -> {}));
        }

        return http.build();
    }
}
