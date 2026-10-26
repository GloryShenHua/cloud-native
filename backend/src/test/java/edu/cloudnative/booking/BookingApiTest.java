package edu.cloudnative.booking;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.*;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.web.servlet.MockMvc;

import java.sql.DriverManager;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.*;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

@SpringBootTest
@AutoConfigureMockMvc
class BookingApiTest {
    private static final String SCHEMA = "test_" + UUID.randomUUID().toString().replace("-", "");
    private static final String URL = requireEnvironment("TEST_DATABASE_URL");
    private static final String USER = requireEnvironment("TEST_DATABASE_USERNAME");
    private static final String PASSWORD = requireEnvironment("TEST_DATABASE_PASSWORD");

    @Autowired MockMvc mvc;
    @Autowired ObjectMapper json;
    @Autowired JdbcTemplate jdbc;

    @DynamicPropertySource
    static void database(DynamicPropertyRegistry properties) throws Exception {
        try (var connection = DriverManager.getConnection(URL, USER, PASSWORD);
             var statement = connection.createStatement()) {
            statement.execute("CREATE SCHEMA " + SCHEMA);
        }
        properties.add("spring.datasource.url", () -> URL + (URL.contains("?") ? "&" : "?") + "currentSchema=" + SCHEMA);
        properties.add("spring.datasource.username", () -> USER);
        properties.add("spring.datasource.password", () -> PASSWORD);
        properties.add("spring.flyway.default-schema", () -> SCHEMA);
    }

    @AfterAll
    static void removeTestSchema() throws Exception {
        try (var connection = DriverManager.getConnection(URL, USER, PASSWORD);
             var statement = connection.createStatement()) {
            statement.execute("DROP SCHEMA IF EXISTS " + SCHEMA + " CASCADE");
        }
    }

    @BeforeEach
    void clearReservations() {
        // Never touch the public/application schema; each run owns its random schema.
        jdbc.update("DELETE FROM reservations");
    }

    @Test
    void migrationSeedsAndHealthAreAvailable() throws Exception {
        mvc.perform(get("/actuator/health")).andExpect(status().isOk()).andExpect(jsonPath("$.status").value("UP"));
        mvc.perform(get("/api/venues")).andExpect(status().isOk()).andExpect(jsonPath("$[0].name").value("第一会议室"));
        mvc.perform(get("/api/venues/1")).andExpect(status().isOk()).andExpect(jsonPath("$.capacity").value(20));
    }

    @Test
    void createVenuePersistsAndReturnsLocation() throws Exception {
        JsonNode venue = json.readTree(mvc.perform(post("/api/venues").contentType(MediaType.APPLICATION_JSON)
                        .content(venuePayload("OPEN", "08:00", "20:00")))
                .andExpect(status().isCreated()).andExpect(header().exists("Location"))
                .andExpect(jsonPath("$.name").value("测试场地")).andReturn().getResponse().getContentAsString());
        assertThat(jdbc.queryForObject("SELECT name FROM venues WHERE id=?", String.class, venue.get("id").asLong()))
                .isEqualTo("测试场地");
    }

    @Test
    void reservationLifecycleAndFilters() throws Exception {
        long id = createReservation(1, "10:00", "11:00");
        mvc.perform(get("/api/reservations/{id}", id)).andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("ACTIVE"));
        mvc.perform(get("/api/reservations").param("venueId", "1").param("date", "2026-11-01")
                        .param("status", "ACTIVE"))
                .andExpect(status().isOk()).andExpect(jsonPath("$.length()").value(1));
        mvc.perform(get("/api/reservations").param("date", "2026-11-02"))
                .andExpect(status().isOk()).andExpect(jsonPath("$.length()").value(0));
        mvc.perform(post("/api/reservations/{id}/cancel", id)).andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("CANCELLED"));
        mvc.perform(delete("/api/reservations/{id}", id)).andExpect(status().isOk());
        long replacement = createReservation(1, "10:00", "11:00");
        assertThat(replacement).isNotEqualTo(id);
        assertThat(jdbc.queryForObject("SELECT status FROM reservations WHERE id=?", String.class, id)).isEqualTo("CANCELLED");
        mvc.perform(get("/api/reservations").param("status", "CANCELLED"))
                .andExpect(status().isOk()).andExpect(jsonPath("$.length()").value(1));
    }

    @ParameterizedTest
    @CsvSource({"10:00,11:00", "09:30,10:30", "10:30,11:30", "09:00,12:00", "10:15,10:45"})
    void allOverlapShapesAreRejected(String start, String end) throws Exception {
        createReservation(1, "10:00", "11:00");
        mvc.perform(post("/api/reservations").contentType(MediaType.APPLICATION_JSON)
                        .content(reservationPayload(1, start, end)))
                .andExpect(status().isConflict()).andExpect(jsonPath("$.error.code").value("RESERVATION_CONFLICT"));
        assertThat(jdbc.queryForObject("SELECT count(*) FROM reservations", Integer.class)).isEqualTo(1);
    }

    @Test
    void adjacentTimesOtherVenuesAndOtherDatesAreAllowed() throws Exception {
        createReservation(1, "10:00", "11:00");
        createReservation(1, "09:00", "10:00");
        createReservation(1, "11:00", "12:00");
        createReservation(2, "10:00", "11:00");
        mvc.perform(post("/api/reservations").contentType(MediaType.APPLICATION_JSON)
                        .content(reservationPayload(1, "10:00", "11:00").replace("2026-11-01", "2026-11-02")))
                .andExpect(status().isCreated());
    }

    @ParameterizedTest
    @CsvSource({"10:00,10:00", "11:00,10:00", "07:00,09:00", "21:00,23:00", "23:00,01:00", "10:00:00.001,11:00"})
    void invalidReservationTimesAreRejected(String start, String end) throws Exception {
        mvc.perform(post("/api/reservations").contentType(MediaType.APPLICATION_JSON)
                        .content(reservationPayload(1, start, end)))
                .andExpect(status().isBadRequest()).andExpect(jsonPath("$.error.code").value("INVALID_ARGUMENT"));
    }

    @Test
    void openingBoundariesAreAccepted() throws Exception {
        createReservation(1, "08:00", "22:00");
    }

    @Test
    void disabledAndMissingVenuesCannotBeBooked() throws Exception {
        mvc.perform(post("/api/reservations").contentType(MediaType.APPLICATION_JSON)
                        .content(reservationPayload(3, "10:00", "11:00"))).andExpect(status().isBadRequest());
        mvc.perform(post("/api/reservations").contentType(MediaType.APPLICATION_JSON)
                        .content(reservationPayload(999999, "10:00", "11:00"))).andExpect(status().isNotFound());
    }

    @Test
    void missingResourcesReturn404() throws Exception {
        mvc.perform(get("/api/venues/999999")).andExpect(status().isNotFound());
        mvc.perform(get("/api/reservations/999999")).andExpect(status().isNotFound());
        mvc.perform(post("/api/reservations/999999/cancel")).andExpect(status().isNotFound());
        mvc.perform(get("/api/unknown")).andExpect(status().isNotFound());
    }

    @Test
    void invalidJsonFieldsAndQueryParametersReturn400() throws Exception {
        for (String body : new String[]{"{}", "{", reservationPayload(1, "10:00", "11:00").replace("张同学", "   "),
                reservationPayload(1, "10:00", "11:00").replace("2026-11-01", "2026-02-30"),
                reservationPayload(1, "10:00", "11:00").replace("\"venueId\":1", "\"venueId\":0"),
                reservationPayload(1, "10:00", "11:00").replace("\"venueId\":1", "\"venueId\":\"one\""),
                reservationPayload(1, "10:00", "11:00").replace("\"venueId\":1", "\"unexpected\":true,\"venueId\":1")}) {
            mvc.perform(post("/api/reservations").contentType(MediaType.APPLICATION_JSON).content(body))
                    .andExpect(status().isBadRequest()).andExpect(jsonPath("$.error.code").value("INVALID_ARGUMENT"))
                    .andExpect(jsonPath("$.trace").doesNotExist());
        }
        for (String path : new String[]{"/api/venues/-1", "/api/venues/abc", "/api/venues?limit=0",
                "/api/venues?offset=-1", "/api/venues?limit=201", "/api/reservations?status=UNKNOWN",
                "/api/reservations?venueId=-1", "/api/reservations?date=wrong"}) {
            mvc.perform(get(path)).andExpect(status().isBadRequest());
        }
    }

    @Test
    void venueValidationRejectsInvalidHoursAndCapacity() throws Exception {
        for (String body : new String[]{venuePayload("OPEN", "20:00", "08:00"),
                venuePayload("OPEN", "08:00", "20:00").replace("\"capacity\":20", "\"capacity\":0"),
                venuePayload("OPEN", "08:00", "20:00").replace("\"capacity\":20", "\"capacity\":20.5"),
                venuePayload("OPEN", "08:00", "20:00").replace("\"status\":\"OPEN\"", "\"status\":0"),
                venuePayload("INVALID", "08:00", "20:00"),
                venuePayload("OPEN", "08:00", "20:00").replace("测试场地", "   ")}) {
            mvc.perform(post("/api/venues").contentType(MediaType.APPLICATION_JSON).content(body))
                    .andExpect(status().isBadRequest());
        }
    }

    @Test
    void paginationIsStable() throws Exception {
        createReservation(1, "10:00", "11:00");
        long second = createReservation(1, "11:00", "12:00");
        mvc.perform(get("/api/reservations?limit=1&offset=1")).andExpect(status().isOk())
                .andExpect(jsonPath("$.length()").value(1)).andExpect(jsonPath("$[0].id").value(second));
    }

    @Test
    void newestReservationsAreSortedBeforePagination() throws Exception {
        for (int day = 1; day <= 25; day++) {
            jdbc.update("""
                    INSERT INTO reservations (venue_id, organizer, reservation_date, start_time, end_time, purpose, status)
                    VALUES (1, 'ordering test', DATE '2026-11-01' + CAST(? AS INTEGER), '10:00', '11:00', 'ordering', 'ACTIVE')
                    """, day);
        }
        long newestId = jdbc.queryForObject("SELECT max(id) FROM reservations", Long.class);
        mvc.perform(get("/api/reservations?venueId=1&order=DESC&limit=20"))
                .andExpect(status().isOk()).andExpect(jsonPath("$.length()").value(20))
                .andExpect(jsonPath("$[0].id").value(newestId))
                .andExpect(jsonPath("$[19].id").value(newestId - 19));
        mvc.perform(get("/api/reservations?venueId=1&order=DESC&limit=20&offset=20"))
                .andExpect(status().isOk()).andExpect(jsonPath("$.length()").value(5))
                .andExpect(jsonPath("$[0].id").value(newestId - 20));
        mvc.perform(get("/api/reservations?venueId=1&order=DESC&date=2026-11-26&status=ACTIVE"))
                .andExpect(status().isOk()).andExpect(jsonPath("$.length()").value(1))
                .andExpect(jsonPath("$[0].id").value(newestId));
    }

    @Test
    void invalidReservationOrderReturns400() throws Exception {
        mvc.perform(get("/api/reservations?order=invalid"))
                .andExpect(status().isBadRequest()).andExpect(jsonPath("$.error.code").value("INVALID_ARGUMENT"));
    }

    @Test
    void venuePaginationContinuesAfterTwoHundredRows() throws Exception {
        // Additional data stays inside this test run's private schema.
        jdbc.update("""
                INSERT INTO venues (name, location, capacity, opening_time, closing_time, status)
                SELECT 'pagination venue ' || value, 'pagination test', 20, TIME '08:00', TIME '22:00', 'OPEN'
                FROM generate_series(1, 205) AS value
                """);
        var ids = jdbc.queryForList("SELECT id FROM venues ORDER BY id", Long.class);
        mvc.perform(get("/api/venues?limit=200&offset=0"))
                .andExpect(status().isOk()).andExpect(jsonPath("$.length()").value(200));
        mvc.perform(get("/api/venues?limit=200&offset=200"))
                .andExpect(status().isOk()).andExpect(jsonPath("$.length()").value(ids.size() - 200))
                .andExpect(jsonPath("$[0].id").value(ids.get(200)));
    }

    @Test
    void corsSupportsFrontendAndRejectsUnconfiguredOrigin() throws Exception {
        mvc.perform(options("/api/reservations").header("Origin", "http://localhost:5173")
                        .header("Access-Control-Request-Method", "POST").header("Access-Control-Request-Headers", "Content-Type"))
                .andExpect(status().isOk()).andExpect(header().string("Access-Control-Allow-Origin", "http://localhost:5173"));
        mvc.perform(options("/api/reservations").header("Origin", "https://unconfigured.example")
                        .header("Access-Control-Request-Method", "POST")).andExpect(status().isForbidden());
    }

    @Test
    void concurrentBookingsProduceOneSuccessAndOneConflict() throws Exception {
        try (var executor = Executors.newFixedThreadPool(2)) {
            var start = new CyclicBarrier(2);
            Callable<Integer> request = () -> {
                start.await(5, TimeUnit.SECONDS);
                return mvc.perform(post("/api/reservations").contentType(MediaType.APPLICATION_JSON)
                                .content(reservationPayload(1, "10:00", "11:00")))
                        .andReturn().getResponse().getStatus();
            };
            var first = executor.submit(request);
            var second = executor.submit(request);
            assertThat(new Integer[]{first.get(15, TimeUnit.SECONDS), second.get(15, TimeUnit.SECONDS)})
                    .containsExactlyInAnyOrder(201, 409);
            assertThat(jdbc.queryForObject("SELECT count(*) FROM reservations WHERE status='ACTIVE'", Integer.class)).isEqualTo(1);
        }
    }

    @Test
    void bookingWaitsForVenueLockAndSeesCommittedConflict() throws Exception {
        String scopedUrl = URL + (URL.contains("?") ? "&" : "?") + "currentSchema=" + SCHEMA;
        try (var connection = DriverManager.getConnection(scopedUrl, USER, PASSWORD);
             var executor = Executors.newSingleThreadExecutor()) {
            connection.setAutoCommit(false);
            try (var statement = connection.createStatement()) {
                statement.execute("SELECT id FROM venues WHERE id=1 FOR UPDATE");
                var started = new CountDownLatch(1);
                var response = executor.submit(() -> {
                    started.countDown();
                    return mvc.perform(post("/api/reservations").contentType(MediaType.APPLICATION_JSON)
                                    .content(reservationPayload(1, "10:00", "11:00")))
                            .andReturn().getResponse().getStatus();
                });
                assertThat(started.await(5, TimeUnit.SECONDS)).isTrue();
                Assertions.assertThrows(TimeoutException.class, () -> response.get(250, TimeUnit.MILLISECONDS));
                statement.execute("""
                        INSERT INTO reservations (venue_id, organizer, reservation_date, start_time, end_time, purpose, status)
                        VALUES (1, 'another transaction', '2026-11-01', '10:00', '11:00', 'lock test', 'ACTIVE')
                        """);
                connection.commit();
                assertThat(response.get(10, TimeUnit.SECONDS)).isEqualTo(409);
            }
        }
    }

    private long createReservation(long venueId, String start, String end) throws Exception {
        return json.readTree(mvc.perform(post("/api/reservations").contentType(MediaType.APPLICATION_JSON)
                        .content(reservationPayload(venueId, start, end)))
                .andExpect(status().isCreated()).andReturn().getResponse().getContentAsString()).get("id").asLong();
    }

    private String reservationPayload(long venueId, String start, String end) throws Exception {
        return json.writeValueAsString(Map.of("venueId", venueId, "organizer", "张同学", "reservationDate", "2026-11-01",
                "startTime", start, "endTime", end, "purpose", "小组讨论"));
    }

    private String venuePayload(String status, String opening, String closing) throws Exception {
        return json.writeValueAsString(Map.of("name", "测试场地", "location", "教学楼 B201", "capacity", 20,
                "openingTime", opening, "closingTime", closing, "status", status));
    }

    private static String requireEnvironment(String name) {
        String value = System.getenv(name);
        if (value == null || value.isBlank()) {
            throw new IllegalStateException("Set " + name + " or run: docker compose --profile test run --build --rm tests");
        }
        return value;
    }
}
