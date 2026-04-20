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
 */
public class DeviceTokenAuthFilter extends OncePerRequestFilter {

    private final DeviceTokenService tokens;

    public DeviceTokenAuthFilter(DeviceTokenService tokens) {
        this.tokens = tokens;
    }

    @Override
    protected boolean shouldNotFilter(HttpServletRequest request) {
        return !(request.getMethod().equalsIgnoreCase("POST")
                && request.getRequestURI().endsWith("/v1/events"));
    }

    @Override
    protected void doFilterInternal(HttpServletRequest req, HttpServletResponse res, FilterChain chain)
            throws ServletException, IOException {
        String auth = req.getHeader("Authorization");
        if (auth == null || !auth.regionMatches(true, 0, "Bearer ", 0, 7)) {
            res.sendError(HttpServletResponse.SC_UNAUTHORIZED, "Missing bearer token");
            return;
        }
        String token = auth.substring(7).trim();
        if (token.isEmpty()) {
            res.sendError(HttpServletResponse.SC_UNAUTHORIZED, "Empty token");
            return;
        }
        DevicePrincipal principal = tokens.authenticate(token);
        var authentication = new DeviceAuthentication(principal);
        SecurityContextHolder.getContext().setAuthentication(authentication);
        chain.doFilter(req, res);
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
