package edu.cloudnative.booking.model;

import java.time.LocalTime;

public record Venue(long id, String name, String location, int capacity,
                    LocalTime openingTime, LocalTime closingTime, VenueStatus status) {}
