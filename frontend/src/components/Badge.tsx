import type { ReservationStatus, VenueStatus } from '../api/types';
import { reservationStatusLabel, venueStatusLabel } from '../lib/format';

export function VenueBadge({ status }: { status: VenueStatus }) {
  return (
    <span className={`badge badge--venue-${status.toLowerCase()}`}>{venueStatusLabel[status]}</span>
  );
}

export function ReservationBadge({ status }: { status: ReservationStatus }) {
  return (
    <span className={`badge badge--reservation-${status.toLowerCase()}`}>
      {reservationStatusLabel[status]}
    </span>
  );
}
