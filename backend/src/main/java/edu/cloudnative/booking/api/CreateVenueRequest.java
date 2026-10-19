package edu.cloudnative.booking.api;

import edu.cloudnative.booking.model.VenueStatus;
import jakarta.validation.constraints.*;
import java.time.LocalTime;

public record CreateVenueRequest(
        @NotBlank @Size(max = 100) String name,
        @NotBlank @Size(max = 255) String location,
        @NotNull @Positive Integer capacity,
        @NotNull LocalTime openingTime,
        @NotNull LocalTime closingTime,
        @NotNull VenueStatus status) {}
