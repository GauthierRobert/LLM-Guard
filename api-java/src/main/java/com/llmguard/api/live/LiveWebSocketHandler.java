package com.llmguard.api.live;

import java.net.URI;
import java.util.Objects;
import org.springframework.stereotype.Component;
import org.springframework.web.socket.CloseStatus;
import org.springframework.web.socket.WebSocketSession;
import org.springframework.web.socket.handler.TextWebSocketHandler;

@Component
public class LiveWebSocketHandler extends TextWebSocketHandler {

    private final Broker broker;

    public LiveWebSocketHandler(Broker broker) {
        this.broker = broker;
    }

    @Override
    public void afterConnectionEstablished(WebSocketSession session) {
        session.getAttributes().put("org", orgFromUri(session.getUri()));
        broker.subscribe((String) session.getAttributes().get("org"), session);
    }

    @Override
    public void afterConnectionClosed(WebSocketSession session, CloseStatus status) {
        String org = (String) session.getAttributes().get("org");
        if (org != null) {
            broker.unsubscribe(org, session);
        }
    }

    private static String orgFromUri(URI uri) {
        if (uri == null || uri.getQuery() == null) {
            return "default";
        }
        for (String pair : uri.getQuery().split("&")) {
            int eq = pair.indexOf('=');
            if (eq > 0 && Objects.equals(pair.substring(0, eq), "org")) {
                return pair.substring(eq + 1);
            }
        }
        return "default";
    }
}
