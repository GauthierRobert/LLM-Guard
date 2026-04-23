package com.llmguard.api.api;

import com.llmguard.api.api.dto.DeviceDto;
import com.llmguard.api.config.AppProperties;
import com.llmguard.api.persistence.DeviceEntity;
import com.llmguard.api.persistence.DeviceRepository;
import com.llmguard.api.persistence.EventRepository;
import java.time.Duration;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.Authentication;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/v1/devices")
public class DevicesController {

    private final DeviceRepository devices;
    private final EventRepository events;
    private final AppProperties props;

    public DevicesController(DeviceRepository devices, EventRepository events, AppProperties props) {
        this.devices = devices;
        this.events = events;
        this.props = props;
    }

    @GetMapping
    public List<DeviceDto> list(Authentication authentication) {
        String orgId = orgId(authentication);
        OffsetDateTime since = OffsetDateTime.now(ZoneOffset.UTC).minus(Duration.ofDays(1));

        // Pull per-device 24h counts in a single query so the N+1 is avoided.
        Map<UUID, Long> counts = new HashMap<>();
        for (Object[] row : events.countByDeviceSince(orgId, since)) {
            counts.put((UUID) row[0], ((Number) row[1]).longValue());
        }

        return devices.findByOrgIdOrderByLastSeenAtDesc(orgId).stream()
                .map(d -> new DeviceDto(
                        d.getId(),
                        d.getUserHint(),
                        d.getExtensionVersion(),
                        d.getCreatedAt(),
                        d.getLastSeenAt(),
                        d.isRevoked(),
                        counts.getOrDefault(d.getId(), 0L)))
                .toList();
    }

    @PostMapping("/{id}/revoke")
    @Transactional
    public ResponseEntity<?> revoke(@PathVariable UUID id, Authentication authentication) {
        String orgId = orgId(authentication);
        int updated = devices.revokeByIdAndOrgId(id, orgId);
        if (updated == 0) {
            return ResponseEntity.status(HttpStatus.NOT_FOUND)
                    .body(Map.of("error", "not_found", "id", id.toString()));
        }
        return ResponseEntity.ok(Map.of("id", id.toString(), "revoked", true));
    }

    private String orgId(Authentication authentication) {
        if (authentication != null && authentication.getPrincipal() instanceof Jwt jwt) {
            Object claim = jwt.getClaims().getOrDefault("org_id", props.orgId());
            return claim.toString();
        }
        return props.orgId();
    }
}
