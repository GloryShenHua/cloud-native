package edu.cloudnative.booking.service;

import edu.cloudnative.booking.api.*;
import edu.cloudnative.booking.model.*;
import edu.cloudnative.booking.repository.BookingRepository;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Isolation;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDate;
import java.time.LocalTime;
import java.util.List;

@Service
public class BookingService {
    private final BookingRepository repository;

    public BookingService(BookingRepository repository) { this.repository = repository; }

    public List<Venue> listVenues(int limit, int offset) { return repository.listVenues(limit, offset); }

    public Venue getVenue(long id) {
        return repository.findVenue(id).orElseThrow(() -> ApiException.notFound("场地不存在"));
    }

    @Transactional
    public Venue createVenue(CreateVenueRequest request) {
        validateTimes(request.openingTime(), request.closingTime());
        return repository.createVenue(request);
    }

    @Transactional(isolation = Isolation.READ_COMMITTED)
    public Reservation createReservation(CreateReservationRequest request) {
        validateTimes(request.startTime(), request.endTime());
        // Serialize writes for one venue across all API instances. The lock stays until commit.
        Venue venue = repository.lockVenue(request.venueId())
                .orElseThrow(() -> ApiException.notFound("场地不存在"));
        if (venue.status() != VenueStatus.OPEN) throw ApiException.invalid("场地已停用，无法预约");
        if (request.startTime().isBefore(venue.openingTime()) || request.endTime().isAfter(venue.closingTime())) {
            throw ApiException.invalid("预约时间必须在场地开放时间内");
        }
        if (repository.hasConflict(request)) {
            throw new ApiException(HttpStatus.CONFLICT, "RESERVATION_CONFLICT", "该场地在所选时间段已有有效预约");
        }
        return repository.createReservation(request);
    }

    public List<Reservation> listReservations(Long venueId, LocalDate date,
                                              ReservationStatus status, int limit, int offset) {
        return repository.listReservations(venueId, date, status, limit, offset);
    }

    public Reservation getReservation(long id) {
        return repository.findReservation(id).orElseThrow(() -> ApiException.notFound("预约不存在"));
    }

    @Transactional(isolation = Isolation.READ_COMMITTED)
    public Reservation cancelReservation(long id) {
        Reservation reservation = getReservation(id);
        // Use the same lock order as creation, so cancellation and rebooking are consistent.
        repository.lockVenue(reservation.venueId()).orElseThrow(() -> ApiException.notFound("场地不存在"));
        return repository.cancelReservation(id);
    }

    private static void validateTimes(LocalTime start, LocalTime end) {
        if (start.getNano() != 0 || end.getNano() != 0) throw ApiException.invalid("时间最多精确到秒");
        if (!start.isBefore(end)) throw ApiException.invalid("开始时间必须早于结束时间，暂不支持跨天时段");
    }
}
