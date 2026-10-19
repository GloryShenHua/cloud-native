package edu.cloudnative.booking.api;

import jakarta.validation.constraints.*;
import java.time.LocalDate;
import java.time.LocalTime;

public record CreateReservationRequest(
        @NotNull @Positive Long venueId,
        @NotBlank @Size(max = 100) String organizer,
        @NotNull LocalDate reservationDate,
        @NotNull LocalTime startTime,
        @NotNull LocalTime endTime,
        @NotBlank @Size(max = 500) String purpose) {}
