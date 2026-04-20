package com.llmguard.api.api;

import com.llmguard.api.api.dto.StatsResponseDto;
import com.llmguard.api.config.AppProperties;
import com.llmguard.api.persistence.EventEntity;
import com.llmguard.api.persistence.EventRepository;
import java.time.Duration;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.springframework.data.domain.PageRequest;
import org.springframework.security.core.Authentication;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/v1")
public class QueryController {

    private static final Map<String, Duration> RANGE_MAP = Map.of(
            "1h", Duration.ofHours(1),
            "24h", Duration.ofDays(1),
            "7d", Duration.ofDays(7),
            "30d", Duration.ofDays(30));

    private final EventRepository repo;
    private final AppProperties props;

    public QueryController(EventRepository repo, AppProperties props) {
        this.repo = repo;
        this.props = props;
    }

    @GetMapping("/stats")
    public StatsResponseDto stats(
            @RequestParam(defaultValue = "24h") String range,
            Authentication authentication) {
        String orgId = orgId(authentication);
        OffsetDateTime since = since(range);

        Map<String, Long> byAction = asLongMap(repo.countByAction(orgId, since));
        Map<String, Long> byLlm = asLongMap(repo.countByLlm(orgId, since));
        Map<String, Long> byType = asLongMap(repo.countByFindingType(orgId, since));

        return new StatsResponseDto(
                byAction.values().stream().mapToLong(Long::longValue).sum(),
                byAction.getOrDefault("CLEAN", 0L),
                byAction.getOrDefault("PII_DETECTED", 0L),
                byAction.getOrDefault("BLOCKED", 0L),
                byAction.getOrDefault("ANONYMIZED", 0L),
                byLlm,
                byType);
    }

    @GetMapping("/events")
    public Map<String, Object> events(
            @RequestParam(defaultValue = "50") int limit,
            @RequestParam(defaultValue = "0") int offset,
            @RequestParam(required = false) String severity,
            @RequestParam(required = false) String llm,
            @RequestParam(required = false) String action,
            @RequestParam(defaultValue = "24h") String range,
            Authentication authentication) {
        int clamped = Math.clamp(limit, 1, 500);
        int skip = Math.max(0, offset);
        int page = skip / clamped;

        List<EventEntity> rows = repo.findPage(
                orgId(authentication), since(range), llm, action,
                PageRequest.of(page, clamped));

        List<Map<String, Object>> items = rows.stream()
                .filter(r -> severity == null || matchSeverity(r, severity))
                .map(this::toWireJson)
                .toList();
        return Map.of("items", items, "limit", clamped, "offset", skip);
    }

    private boolean matchSeverity(EventEntity e, String sev) {
        List<Map<String, Object>> findings = e.getFindings();
        if (findings == null) return false;
        for (var f : findings) {
            if (sev.equals(f.get("severity"))) return true;
        }
        return false;
    }

    private Map<String, Object> toWireJson(EventEntity r) {
        var out = new LinkedHashMap<String, Object>();
        out.put("eventId", r.getEventId().toString());
        out.put("timestamp", r.getTimestamp().toString());
        out.put("deviceId", r.getDeviceId().toString());
        out.put("userHint", r.getUserHint());
        out.put("hostname", r.getHostname());
        out.put("llm", r.getLlm());
        out.put("action", r.getAction());
        out.put("endpoint", r.getEndpoint());
        out.put("mode", r.getMode());
        out.put("promptLength", r.getPromptLength());
        out.put("mappingsCount", r.getMappingsCount());
        out.put("anonymizedPreview", r.getAnonymizedPreview());
        out.put("findings", r.getFindings());
        out.put("attachment", r.getAttachment());
        out.put("extensionVersion", r.getExtensionVersion());
        return out;
    }

    private String orgId(Authentication authentication) {
        if (authentication != null && authentication.getPrincipal() instanceof Jwt jwt) {
            Object claim = jwt.getClaims().getOrDefault("org_id", props.orgId());
            return claim.toString();
        }
        return props.orgId();
    }

    private static OffsetDateTime since(String range) {
        Duration d = RANGE_MAP.getOrDefault(range, RANGE_MAP.get("24h"));
        return OffsetDateTime.now(ZoneOffset.UTC).minus(d);
    }

    @SuppressWarnings({"unchecked", "rawtypes"})
    private static Map<String, Long> asLongMap(List<Object[]> rows) {
        var out = new LinkedHashMap<String, Long>();
        for (Object[] r : rows) {
            out.put(String.valueOf(r[0]), ((Number) r[1]).longValue());
        }
        return out;
    }
}
