CREATE TABLE venues (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    name VARCHAR(100) NOT NULL CHECK (btrim(name) <> ''),
    location VARCHAR(255) NOT NULL CHECK (btrim(location) <> ''),
    capacity INTEGER NOT NULL CHECK (capacity > 0),
    opening_time TIME(0) NOT NULL,
    closing_time TIME(0) NOT NULL,
    status VARCHAR(16) NOT NULL CHECK (status IN ('OPEN', 'DISABLED')),
    CONSTRAINT valid_opening_hours CHECK (opening_time < closing_time)
);

CREATE TABLE reservations (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    venue_id BIGINT NOT NULL REFERENCES venues(id),
    organizer VARCHAR(100) NOT NULL CHECK (btrim(organizer) <> ''),
    reservation_date DATE NOT NULL,
    start_time TIME(0) NOT NULL,
    end_time TIME(0) NOT NULL,
    purpose VARCHAR(500) NOT NULL CHECK (btrim(purpose) <> ''),
    status VARCHAR(16) NOT NULL CHECK (status IN ('ACTIVE', 'CANCELLED')),
    CONSTRAINT valid_reservation_times CHECK (start_time < end_time)
);

CREATE INDEX idx_reservation_active_slot
    ON reservations (venue_id, reservation_date, start_time, end_time)
    WHERE status = 'ACTIVE';
CREATE INDEX idx_reservation_date ON reservations (reservation_date, id);
