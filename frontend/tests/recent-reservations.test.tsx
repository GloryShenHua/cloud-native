// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { ApiError, api } from '../src/api/client';
import type { Reservation, ReservationQuery, Venue } from '../src/api/types';
import { ToastProvider } from '../src/components/ToastProvider';
import { VenueDetailPage } from '../src/pages/VenueDetailPage';
import { BookingForm } from '../src/components/BookingForm';

vi.mock('../src/api/client', async (original) => ({
  ...await original<typeof import('../src/api/client')>(),
  api: { getVenue: vi.fn(), listReservations: vi.fn(), createReservation: vi.fn() },
}));

const venue: Venue = { id: 1, name: '测试场地', location: '测试区', capacity: 20,
  openingTime: '08:00:00', closingTime: '22:00:00', status: 'OPEN' };

afterEach(() => { cleanup(); vi.clearAllMocks(); });

it('shows the latest 20 records when a venue has more than 20 reservations', async () => {
  const records: Reservation[] = Array.from({ length: 25 }, (_, index) => ({
    id: index + 1, venueId: 1, organizer: `预约人${index + 1}`, reservationDate: '2026-11-01',
    startTime: '10:00:00', endTime: '11:00:00', purpose: '讨论', status: 'CANCELLED',
  }));
  vi.mocked(api.getVenue).mockResolvedValue(venue);
  vi.mocked(api.listReservations).mockImplementation(async (query: ReservationQuery = {}) => {
    if (query.status === 'ACTIVE') return [];
    return (query.order === 'DESC' ? [...records].reverse() : records).slice(0, query.limit);
  });
  const view = render(<MemoryRouter initialEntries={['/venues/1']}><ToastProvider><Routes>
    <Route path="/venues/:id" element={<VenueDetailPage />} />
  </Routes></ToastProvider></MemoryRouter>);

  await screen.findByText('#25', { exact: true });
  const ids = Array.from(view.container.querySelectorAll('.timeline-id'), (element) => element.textContent);
  expect(ids).toHaveLength(20);
  expect(ids[0]).toBe('#25');
  expect(ids[19]).toBe('#6');
  expect(ids).not.toContain('#1');
});

it('shows a useful conflict message without HTTP codes or internal error identifiers', async () => {
  vi.mocked(api.createReservation).mockRejectedValue(new ApiError(409, 'RESERVATION_CONFLICT', 'internal HTTP 409'));
  render(<BookingForm venue={venue} date="2026-11-01" onDateChange={vi.fn()} bookedSlots={[]}
    onCreated={vi.fn()} onRefreshSlots={vi.fn()} />);
  fireEvent.change(screen.getByLabelText('预约人 / 组织'), { target: { value: '研发团队' } });
  fireEvent.change(screen.getByLabelText('使用目的'), { target: { value: '评审' } });
  // jsdom does not implement scrolling; keep the test focused on the visible message.
  const scroll = vi.fn();
  const previous = HTMLElement.prototype.scrollIntoView;
  HTMLElement.prototype.scrollIntoView = scroll;
  try {
    fireEvent.click(screen.getByRole('button', { name: '提交预约' }));
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('预约时间冲突');
    expect(alert.textContent).not.toMatch(/HTTP|RESERVATION_CONFLICT|internal/);
  } finally {
    HTMLElement.prototype.scrollIntoView = previous;
  }
});
