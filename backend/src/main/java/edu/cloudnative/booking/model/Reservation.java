package edu.cloudnative.booking.model;

import java.time.LocalDate;
import java.time.LocalTime;

public record Reservation(long id, long venueId, String organizer,
                          LocalDate reservationDate, LocalTime startTime, LocalTime endTime,
                          String purpose, ReservationStatus status) {}
