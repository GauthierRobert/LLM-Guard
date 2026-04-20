package com.llmguard.api;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.exc.UnrecognizedPropertyException;
import com.fasterxml.jackson.datatype.jsr310.JavaTimeModule;
import com.llmguard.api.api.dto.EventBatchDto;
import com.llmguard.api.api.dto.EventDto;
import jakarta.validation.Validation;
import jakarta.validation.Validator;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.Test;

class EventDtoValidationTest {

    private static final ObjectMapper M = new ObjectMapper()
            .registerModule(new JavaTimeModule())
            .configure(com.fasterxml.jackson.databind.DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES, true);

    private static final Validator V = Validation.buildDefaultValidatorFactory().getValidator();

    private static String validJson() {
        return """
               {
                 "eventId": "%s",
                 "deviceId": "%s",
                 "orgId": "acme",
                 "userHint": null,
                 "timestamp": "2026-04-20T12:00:00Z",
                 "hostname": "chatgpt.com",
                 "llm": "ChatGPT",
                 "action": "ANONYMIZED",
                 "endpoint": "/api/conversation",
                 "mode": "anonymize",
                 "promptLength": 120,
                 "mappingsCount": 2,
                 "anonymizedPreview": "[EMAIL_1] for [PHONE_2]",
                 "findings": [{"type": "Email", "severity": "high", "count": 1}],
                 "attachment": null,
                 "extensionVersion": "2.0.0",
                 "schemaVersion": 1
               }
               """.formatted(UUID.randomUUID(), UUID.randomUUID());
    }

    @Test
    void acceptsValidPayload() throws Exception {
        EventDto ev = M.readValue(validJson(), EventDto.class);
        assertTrue(V.validate(ev).isEmpty());
    }

    @Test
    void rejectsBadAction() throws Exception {
        EventDto ev = M.readValue(validJson().replace("\"ANONYMIZED\"", "\"HACK\""), EventDto.class);
        assertFalse(V.validate(ev).isEmpty());
    }

    @Test
    void rejectsExtraFields() {
        String bad = validJson().replace("\"schemaVersion\": 1",
                "\"promptPreview\": \"leaked\",\n  \"schemaVersion\": 1");
        assertThrows(UnrecognizedPropertyException.class, () -> M.readValue(bad, EventDto.class));
    }

    @Test
    void batchEnforcesMaxLength() throws Exception {
        EventDto one = M.readValue(validJson(), EventDto.class);
        List<EventDto> many = new ArrayList<>(Collections.nCopies(501, one));
        var batch = new EventBatchDto(many);
        assertFalse(V.validate(batch).isEmpty());
    }
}
