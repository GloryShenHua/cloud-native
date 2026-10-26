export type VenueStatus = 'OPEN' | 'DISABLED';
export type ReservationStatus = 'ACTIVE' | 'CANCELLED';

export interface Venue {
  id: number;
  name: string;
  location: string;
  capacity: number;
  /** HH:mm:ss，例如 08:00:00 */
  openingTime: string;
  closingTime: string;
  status: VenueStatus;
}

export interface Reservation {
  id: number;
  venueId: number;
  organizer: string;
  /** YYYY-MM-DD */
  reservationDate: string;
  /** HH:mm:ss */
  startTime: string;
  endTime: string;
  purpose: string;
  status: ReservationStatus;
}

export interface CreateVenueInput {
  name: string;
  location: string;
  capacity: number;
  openingTime: string;
  closingTime: string;
  status: VenueStatus;
}

export interface CreateReservationInput {
  venueId: number;
  organizer: string;
  reservationDate: string;
  startTime: string;
  endTime: string;
  purpose: string;
}

export interface ReservationQuery {
  venueId?: number;
  date?: string;
  status?: ReservationStatus;
  order?: 'ASC' | 'DESC';
  limit?: number;
  offset?: number;
}

export interface FieldIssue {
  field: string;
  message: string;
}
