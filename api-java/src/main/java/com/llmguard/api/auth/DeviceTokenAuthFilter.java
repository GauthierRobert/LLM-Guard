package com.llmguard.api.auth;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.util.List;
import org.springframework.security.authentication.AbstractAuthenticationToken;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.web.filter.OncePerRequestFilter;

/**
 * Validates a bearer token on POST /v1/events and stores the DevicePrincipal
 * in the SecurityContext for the controller to consume.
 *
 * Pre-auth rate limit: if the client IP has exceeded MAX_FAILURES in the
 * current window the request is rejected with 429 before we even hash the
 * token. This defends against blind brute-force of the device token space.
 */
public class DeviceTokenAuthFilter extends OncePerRequestFilter {

    private final DeviceTokenService tokens;
    private final AuthRateLimiter rateLimiter;

    public DeviceTokenAuthFilter(DeviceTokenService tokens, AuthRateLimiter rateLimiter) {
        this.tokens = tokens;
        this.rateLimiter = rateLimiter;
    }

    @Override
    protected boolean shouldNotFilter(HttpServletRequest request) {
        return !(request.getMethod().equalsIgnoreCase("POST")
                && request.getRequestURI().endsWith("/v1/events"));
    }

    @Override
    protected void doFilterInternal(HttpServletRequest req, HttpServletResponse res, FilterChain chain)
            throws ServletException, IOException {
        String ip = clientIp(req);
        if (rateLimiter.isBlocked(ip)) {
            res.setHeader("Retry-After", "60");
            res.sendError(429, "Too many failed auth attempts");
            return;
        }

        String auth = req.getHeader("Authorization");
        if (auth == null || !auth.regionMatches(true, 0, "Bearer ", 0, 7)) {
            rateLimiter.recordFailure(ip);
            res.sendError(HttpServletResponse.SC_UNAUTHORIZED, "Missing bearer token");
            return;
        }
        String token = auth.substring(7).trim();
        if (token.isEmpty()) {
            rateLimiter.recordFailure(ip);
            res.sendError(HttpServletResponse.SC_UNAUTHORIZED, "Empty token");
            return;
        }
        DevicePrincipal principal;
        try {
            principal = tokens.authenticate(token);
        } catch (RuntimeException ex) {
            rateLimiter.recordFailure(ip);
            res.sendError(HttpServletResponse.SC_UNAUTHORIZED, "Invalid token");
            return;
        }
        rateLimiter.recordSuccess(ip);
        var authentication = new DeviceAuthentication(principal);
        SecurityContextHolder.getContext().setAuthentication(authentication);
        chain.doFilter(req, res);
    }

    /** Mirror AuditLogFilter so rate limiting honours X-Forwarded-For behind a proxy. */
    private static String clientIp(HttpServletRequest req) {
        String fwd = req.getHeader("X-Forwarded-For");
        if (fwd != null && !fwd.isBlank()) {
            int comma = fwd.indexOf(',');
            return (comma > 0 ? fwd.substring(0, comma) : fwd).trim();
        }
        return req.getRemoteAddr();
    }

    static final class DeviceAuthentication extends AbstractAuthenticationToken {
        private final DevicePrincipal principal;

        DeviceAuthentication(DevicePrincipal principal) {
            super(List.of(new SimpleGrantedAuthority("ROLE_DEVICE")));
            this.principal = principal;
            setAuthenticated(true);
        }

        @Override public Object getCredentials() { return ""; }
        @Override public Object getPrincipal() { return principal; }
    }
}
