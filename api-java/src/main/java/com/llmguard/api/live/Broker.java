package com.llmguard.api.live;

import java.util.Map;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import org.springframework.stereotype.Component;
import org.springframework.web.socket.TextMessage;
import org.springframework.web.socket.WebSocketSession;

/**
 * In-process fan-out broker: maps orgId -> set of WebSocket sessions.
 * For multi-replica deployments, swap this for Redis Pub/Sub or Postgres LISTEN/NOTIFY.
 */
@Component
public class Broker {

    private final Map<String, Set<WebSocketSession>> subscribers = new ConcurrentHashMap<>();

    public void subscribe(String orgId, WebSocketSession session) {
        subscribers.computeIfAbsent(orgId, k -> ConcurrentHashMap.newKeySet()).add(session);
    }

    public void unsubscribe(String orgId, WebSocketSession session) {
        var set = subscribers.get(orgId);
        if (set != null) {
            set.remove(session);
        }
    }

    public void publish(String orgId, String json) {
        var set = subscribers.get(orgId);
        if (set == null) {
            return;
        }
        for (WebSocketSession s : set) {
            if (s.isOpen()) {
                try {
                    s.sendMessage(new TextMessage(json));
                } catch (Exception ignored) {
                    // swallow — reliable delivery is not in scope for the realtime tail.
                }
            }
        }
    }
}
