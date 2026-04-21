package com.llmguard.api.audit;

import com.llmguard.api.auth.DevicePrincipal;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.core.annotation.Order;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

/**
 * Structured access log for all /v1/* requests. Emits a single key-value line
 * per request containing the fields a SOC auditor needs to prove compliance:
 * who (deviceId / JWT sub), what (method + path + query), when (timestamp),
 * from where (remote IP + UA), outcome (status + latency).
 *
 * Runs after the auth filter so we can capture the resolved principal. Uses
 * SLF4J with logger name `audit` so it can be routed to a dedicated file via
 * logback-spring.xml without polluting the app log.
 *
 * Deliberately skips health / actuator / websocket paths — those are high
 * volume and not sensitive.
 */
@Component
@Order(Integer.MAX_VALUE) // runs last in the chain (after auth populates context)
public class AuditLogFilter extends OncePerRequestFilter {

    private static final Logger audit = LoggerFactory.getLogger("audit");

    @Override
    protected boolean shouldNotFilter(HttpServletRequest request) {
        String p = request.getRequestURI();
        return p == null
                || p.startsWith("/v1/health")
                || p.startsWith("/actuator")
                || p.startsWith("/v1/live");
    }

    @Override
    protected void doFilterInternal(HttpServletRequest req, HttpServletResponse res, FilterChain chain)
            throws ServletException, IOException {
        long start = System.nanoTime();
        try {
            chain.doFilter(req, res);
        } finally {
            long elapsedMs = (System.nanoTime() - start) / 1_000_000L;
            String principal = resolvePrincipal();
            String query = req.getQueryString();
            audit.info(
                    "method={} path={} query={} status={} remote={} ua=\"{}\" principal={} latencyMs={}",
                    req.getMethod(),
                    req.getRequestURI(),
                    query == null ? "-" : sanitize(query),
                    res.getStatus(),
                    clientIp(req),
                    sanitize(req.getHeader("User-Agent")),
                    principal,
                    elapsedMs);
        }
    }

    private static String resolvePrincipal() {
        Authentication a = SecurityContextHolder.getContext().getAuthentication();
        if (a == null) return "anonymous";
        Object p = a.getPrincipal();
        if (p instanceof DevicePrincipal dp) return "device:" + dp.deviceId() + "/org:" + dp.orgId();
        if (p instanceof Jwt jwt) return "jwt:" + jwt.getSubject();
        return p == null ? "anonymous" : p.getClass().getSimpleName();
    }

    /** Prefer X-Forwarded-For when behind Caddy/nginx; else fall back to remote addr. */
    private static String clientIp(HttpServletRequest req) {
        String fwd = req.getHeader("X-Forwarded-For");
        if (fwd != null && !fwd.isBlank()) {
            int comma = fwd.indexOf(',');
            return sanitize((comma > 0 ? fwd.substring(0, comma) : fwd).trim());
        }
        return sanitize(req.getRemoteAddr());
    }

    /** Replace CR/LF + quotes to prevent log injection from UA / query strings. */
    private static String sanitize(String s) {
        if (s == null) return "-";
        return s.replace('\r', ' ').replace('\n', ' ').replace('"', '\'');
    }
}
