package edu.cloudnative.booking.api;

import edu.cloudnative.booking.model.*;
import edu.cloudnative.booking.service.BookingService;
import jakarta.validation.Valid;
import jakarta.validation.constraints.*;
import org.springframework.format.annotation.DateTimeFormat;
import org.springframework.http.ResponseEntity;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.*;

import java.net.URI;
import java.time.LocalDate;
import java.util.List;

@Validated
@RestController
@RequestMapping("/api")
public class BookingController {
    private final BookingService service;

    public BookingController(BookingService service) { this.service = service; }

    @GetMapping("/venues")
    public List<Venue> listVenues(@RequestParam(defaultValue = "100") @Min(1) @Max(200) int limit,
                                  @RequestParam(defaultValue = "0") @Min(0) int offset) {
        return service.listVenues(limit, offset);
    }

    @GetMapping("/venues/{id}")
    public Venue getVenue(@PathVariable @Positive long id) { return service.getVenue(id); }

    @PostMapping("/venues")
    public ResponseEntity<Venue> createVenue(@Valid @RequestBody CreateVenueRequest request) {
        Venue venue = service.createVenue(request);
        return ResponseEntity.created(URI.create("/api/venues/" + venue.id())).body(venue);
    }

    @PostMapping("/reservations")
    public ResponseEntity<Reservation> createReservation(@Valid @RequestBody CreateReservationRequest request) {
        Reservation reservation = service.createReservation(request);
        return ResponseEntity.created(URI.create("/api/reservations/" + reservation.id())).body(reservation);
    }

    @GetMapping("/reservations")
    public List<Reservation> listReservations(
            @RequestParam(required = false) @Positive Long venueId,
            @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate date,
            @RequestParam(required = false) ReservationStatus status,
            @RequestParam(defaultValue = "100") @Min(1) @Max(200) int limit,
            @RequestParam(defaultValue = "0") @Min(0) int offset) {
        return service.listReservations(venueId, date, status, limit, offset);
    }

    @GetMapping("/reservations/{id}")
    public Reservation getReservation(@PathVariable @Positive long id) { return service.getReservation(id); }

    @PostMapping("/reservations/{id}/cancel")
    public Reservation cancelReservation(@PathVariable @Positive long id) { return service.cancelReservation(id); }

    @DeleteMapping("/reservations/{id}")
    public Reservation deleteReservation(@PathVariable @Positive long id) { return service.cancelReservation(id); }
}
