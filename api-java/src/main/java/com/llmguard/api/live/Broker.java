package com.llmguard.api.live;

import java.io.IOException;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;
import org.springframework.web.socket.TextMessage;
import org.springframework.web.socket.WebSocketSession;

/**
 * In-process fan-out broker: maps orgId -> set of WebSocket sessions.
 * For multi-replica deployments, swap this for Redis Pub/Sub or Postgres LISTEN/NOTIFY.
 *
 * Hardening (2026-04): send failures now evict the dead session and are logged
 * at WARN with the session id + org so operators can correlate with the
 * access log. Previously, a half-closed socket stayed in the subscribers map
 * and each publish silently threw an IOException that was swallowed by
 * `catch (Exception ignored)`. Two visible effects of the old behaviour:
 *   1. `subscribers.get(orgId).size()` drifted upward as dead sockets
 *      accumulated, so ops had no way to see real subscriber counts.
 *   2. A burst of broken sockets meant every publish spent time calling
 *      `sendMessage` on closed sockets — measurable under load.
 */
@Component
public class Broker {

    private static final Logger log = LoggerFactory.getLogger(Broker.class);

    private final Map<String, Set<WebSocketSession>> subscribers = new ConcurrentHashMap<>();

    public void subscribe(String orgId, WebSocketSession session) {
        subscribers.computeIfAbsent(orgId, k -> ConcurrentHashMap.newKeySet()).add(session);
    }

    public void unsubscribe(String orgId, WebSocketSession session) {
        var set = subscribers.get(orgId);
        if (set != null) {
            set.remove(session);
            if (set.isEmpty()) subscribers.remove(orgId, set);
        }
    }

    public void publish(String orgId, String json) {
        var set = subscribers.get(orgId);
        if (set == null || set.isEmpty()) {
            return;
        }
        TextMessage msg = new TextMessage(json);
        for (WebSocketSession s : set) {
            if (!s.isOpen()) {
                evict(orgId, s, "not-open");
                continue;
            }
            try {
                s.sendMessage(msg);
            } catch (IOException | IllegalStateException e) {
                // Common causes: client disconnected mid-send, buffer full,
                // upgrade tunnel torn down. Best-effort delivery — evict and
                // log so dead subs don't accumulate in the map.
                evict(orgId, s, e.getClass().getSimpleName() + ": " + e.getMessage());
                closeQuietly(s);
            }
        }
    }

    /** Observability: how many live subscribers per org. Cheap for dashboards. */
    public int subscriberCount(String orgId) {
        var set = subscribers.get(orgId);
        return set == null ? 0 : set.size();
    }

    private void evict(String orgId, WebSocketSession session, String reason) {
        log.warn("Evicting WS subscriber org={} session={} reason={}", orgId, session.getId(), reason);
        var set = subscribers.get(orgId);
        if (set != null) set.remove(session);
    }

    private static void closeQuietly(WebSocketSession session) {
        try {
            if (session.isOpen()) session.close();
        } catch (Exception ignored) {
            // already dead, nothing to do.
        }
    }
}
