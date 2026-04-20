package com.llmguard.api.auth;

import com.llmguard.api.config.AppProperties;
import java.nio.charset.StandardCharsets;
import java.security.InvalidKeyException;
import java.security.NoSuchAlgorithmException;
import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import org.springframework.stereotype.Service;

/** HMAC-SHA256 of the device bearer token against the server secret. */
@Service
public class DeviceTokenService {

    private final AppProperties props;

    public DeviceTokenService(AppProperties props) {
        this.props = props;
    }

    public String hash(String token) {
        try {
            var mac = Mac.getInstance("HmacSHA256");
            mac.init(new SecretKeySpec(props.deviceTokenSecret().getBytes(StandardCharsets.UTF_8), "HmacSHA256"));
            byte[] digest = mac.doFinal(token.getBytes(StandardCharsets.UTF_8));
            var sb = new StringBuilder(digest.length * 2);
            for (byte b : digest) {
                sb.append(String.format("%02x", b));
            }
            return sb.toString();
        } catch (NoSuchAlgorithmException | InvalidKeyException e) {
            throw new IllegalStateException("HMAC-SHA256 unavailable", e);
        }
    }

    public DevicePrincipal authenticate(String token) {
        String h = hash(token);
        // TODO: look up devices.token_hash = :h; mark last_seen_at. Stub derives deviceId from hash prefix.
        return new DevicePrincipal(h.substring(0, 32), props.orgId());
    }
}
