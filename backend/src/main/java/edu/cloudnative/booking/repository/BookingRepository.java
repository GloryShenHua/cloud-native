package edu.cloudnative.booking.repository;

import edu.cloudnative.booking.api.CreateReservationRequest;
import edu.cloudnative.booking.api.CreateVenueRequest;
import edu.cloudnative.booking.model.*;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Repository;

import java.time.LocalDate;
import java.time.LocalTime;
import java.util.List;
import java.util.Optional;

@Repository
public class BookingRepository {
    private final JdbcClient jdbc;

    private static final RowMapper<Venue> VENUE = (rs, n) -> new Venue(
            rs.getLong("id"), rs.getString("name"), rs.getString("location"),
            rs.getInt("capacity"), rs.getObject("opening_time", LocalTime.class),
            rs.getObject("closing_time", LocalTime.class), VenueStatus.valueOf(rs.getString("status")));
    private static final RowMapper<Reservation> RESERVATION = (rs, n) -> new Reservation(
            rs.getLong("id"), rs.getLong("venue_id"), rs.getString("organizer"),
            rs.getObject("reservation_date", LocalDate.class), rs.getObject("start_time", LocalTime.class),
            rs.getObject("end_time", LocalTime.class), rs.getString("purpose"),
            ReservationStatus.valueOf(rs.getString("status")));

    public BookingRepository(JdbcClient jdbc) { this.jdbc = jdbc; }

    public List<Venue> listVenues(int limit, int offset) {
        return jdbc.sql("SELECT * FROM venues ORDER BY id LIMIT :limit OFFSET :offset")
                .param("limit", limit).param("offset", offset).query(VENUE).list();
    }

    public Optional<Venue> findVenue(long id) {
        return jdbc.sql("SELECT * FROM venues WHERE id = :id").param("id", id).query(VENUE).optional();
    }

    public Optional<Venue> lockVenue(long id) {
        return jdbc.sql("SELECT * FROM venues WHERE id = :id FOR UPDATE")
                .param("id", id).query(VENUE).optional();
    }

    public Venue createVenue(CreateVenueRequest request) {
        return jdbc.sql("""
                INSERT INTO venues (name, location, capacity, opening_time, closing_time, status)
                VALUES (:name, :location, :capacity, :opening, :closing, :status) RETURNING *
                """)
                .param("name", request.name().strip()).param("location", request.location().strip())
                .param("capacity", request.capacity()).param("opening", request.openingTime())
                .param("closing", request.closingTime()).param("status", request.status().name())
                .query(VENUE).single();
    }

    public boolean hasConflict(CreateReservationRequest request) {
        return jdbc.sql("""
                SELECT EXISTS (
                    SELECT 1 FROM reservations
                    WHERE venue_id = :venueId AND reservation_date = :date AND status = 'ACTIVE'
                      AND start_time < :end AND end_time > :start
                )
                """)
                .param("venueId", request.venueId()).param("date", request.reservationDate())
                .param("start", request.startTime()).param("end", request.endTime())
                .query(Boolean.class).single();
    }

    public Reservation createReservation(CreateReservationRequest request) {
        return jdbc.sql("""
                INSERT INTO reservations
                    (venue_id, organizer, reservation_date, start_time, end_time, purpose, status)
                VALUES (:venueId, :organizer, :date, :start, :end, :purpose, 'ACTIVE') RETURNING *
                """)
                .param("venueId", request.venueId()).param("organizer", request.organizer().strip())
                .param("date", request.reservationDate()).param("start", request.startTime())
                .param("end", request.endTime()).param("purpose", request.purpose().strip())
                .query(RESERVATION).single();
    }

    public List<Reservation> listReservations(Long venueId, LocalDate date,
                                              ReservationStatus status, SortDirection order, int limit, int offset) {
        StringBuilder sql = new StringBuilder("SELECT * FROM reservations WHERE 1=1");
        if (venueId != null) sql.append(" AND venue_id = :venueId");
        if (date != null) sql.append(" AND reservation_date = :date");
        if (status != null) sql.append(" AND status = :status");
        // Only the validated enum is used as SQL syntax; request values remain bound parameters.
        sql.append(" ORDER BY id ").append(order.name()).append(" LIMIT :limit OFFSET :offset");
        var query = jdbc.sql(sql.toString()).param("limit", limit).param("offset", offset);
        if (venueId != null) query.param("venueId", venueId);
        if (date != null) query.param("date", date);
        if (status != null) query.param("status", status.name());
        return query.query(RESERVATION).list();
    }

    public Optional<Reservation> findReservation(long id) {
        return jdbc.sql("SELECT * FROM reservations WHERE id = :id")
                .param("id", id).query(RESERVATION).optional();
    }

    public Reservation cancelReservation(long id) {
        return jdbc.sql("UPDATE reservations SET status = 'CANCELLED' WHERE id = :id RETURNING *")
                .param("id", id).query(RESERVATION).single();
    }
}
