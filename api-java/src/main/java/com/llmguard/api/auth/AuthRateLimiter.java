package com.llmguard.api.auth;

import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicInteger;
import org.springframework.stereotype.Component;

/**
 * In-memory sliding-window rate limiter for bearer-token auth failures.
 *
 * Scope: per client IP. An attacker brute-forcing device tokens gets 429 after
 * 10 failed attempts inside a 60-second window, regardless of whether they
 * vary the token or not. Successful auths reset the counter for that IP so
 * legitimate clients with occasional typos aren't penalized.
 *
 * Deliberately process-local: rate limiting across a cluster is usually done
 * one layer out (Caddy/nginx, Envoy, Cloudflare). This class is the last
 * line of defence for single-node deployments. For multi-replica setups,
 * swap the backing map for Redis.
 *
 * Memory bound: the map grows by one entry per distinct IP; a sweeper cleans
 * stale entries on each check to keep it O(active IPs).
 */
@Component
public class AuthRateLimiter {

    static final int MAX_FAILURES = 10;
    static final long WINDOW_MS = 60_000L;
    static final long CLEANUP_EVERY_MS = 300_000L; // 5 minutes

    private final Map<String, Entry> counters = new ConcurrentHashMap<>();
    private volatile long lastCleanup = System.currentTimeMillis();

    private static final class Entry {
        final AtomicInteger failures = new AtomicInteger(0);
        volatile long windowStart = System.currentTimeMillis();
    }

    /** Returns true if this IP is currently blocked. Does NOT increment. */
    public boolean isBlocked(String ip) {
        if (ip == null || ip.isBlank()) return false;
        maybeCleanup();
        Entry e = counters.get(ip);
        if (e == null) return false;
        long now = System.currentTimeMillis();
        if (now - e.windowStart > WINDOW_MS) {
            // Window elapsed — counter stale, effectively unblocked.
            return false;
        }
        return e.failures.get() >= MAX_FAILURES;
    }

    /** Call on every auth failure; returns true once the IP crosses the limit. */
    public boolean recordFailure(String ip) {
        if (ip == null || ip.isBlank()) return false;
        Entry e = counters.computeIfAbsent(ip, k -> new Entry());
        long now = System.currentTimeMillis();
        if (now - e.windowStart > WINDOW_MS) {
            // Rotate window.
            e.windowStart = now;
            e.failures.set(1);
            return false;
        }
        return e.failures.incrementAndGet() >= MAX_FAILURES;
    }

    /** Call on success so one typo doesn't slowly accumulate into a block. */
    public void recordSuccess(String ip) {
        if (ip == null || ip.isBlank()) return;
        counters.remove(ip);
    }

    private void maybeCleanup() {
        long now = System.currentTimeMillis();
        if (now - lastCleanup < CLEANUP_EVERY_MS) return;
        lastCleanup = now;
        counters.entrySet().removeIf(kv -> now - kv.getValue().windowStart > WINDOW_MS * 2);
    }
}
