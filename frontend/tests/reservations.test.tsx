// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { Link, MemoryRouter } from 'react-router-dom';
import { api } from '../src/api/client';
import type { Reservation } from '../src/api/types';
import { ToastProvider } from '../src/components/ToastProvider';
import { ReservationsPage } from '../src/pages/ReservationsPage';

vi.mock('../src/api/client', async (original) => ({
  ...await original<typeof import('../src/api/client')>(),
  api: { listAllVenues: vi.fn(), listReservations: vi.fn() },
}));

const records: Reservation[] = Array.from({ length: 21 }, (_, index) => ({
  id: index + 1, venueId: 1, organizer: `预约人${index + 1}`, reservationDate: '2026-11-01',
  startTime: '10:00:00', endTime: '11:00:00', purpose: '评审', status: 'ACTIVE',
}));

beforeEach(() => vi.mocked(api.listAllVenues).mockResolvedValue([]));
afterEach(() => { cleanup(); vi.resetAllMocks(); });

function openPage() {
  render(<MemoryRouter><ToastProvider>
    <Link to="/reservations?venueId=2">切换场地筛选</Link>
    <ReservationsPage />
  </ToastProvider></MemoryRouter>);
}

it('does not offer an empty next page when there are exactly 20 reservations', async () => {
  vi.mocked(api.listReservations).mockResolvedValue(records.slice(0, 20));
  openPage();
  await screen.findByText('预约人20');
  expect(screen.getByRole('button', { name: '下一页' }).hasAttribute('disabled')).toBe(true);
});

it('uses a lookahead record without skipping it on the next page', async () => {
  vi.mocked(api.listReservations).mockImplementation(async (query = {}) =>
    records.slice(query.offset ?? 0, (query.offset ?? 0) + (query.limit ?? 100)));
  openPage();
  await screen.findByText('预约人20');
  expect(screen.queryByText('预约人21')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '下一页' }));
  await screen.findByText('预约人21');
  expect(screen.queryByText('预约人20')).toBeNull();
  expect(screen.getByRole('button', { name: '下一页' }).hasAttribute('disabled')).toBe(true);
});

it('keeps the previous-page control when records disappear from a later page', async () => {
  vi.mocked(api.listReservations).mockResolvedValueOnce(records).mockResolvedValue([]);
  openPage();
  await screen.findByText('预约人20');
  fireEvent.click(screen.getByRole('button', { name: '下一页' }));
  await screen.findByText('没有符合条件的预约');
  expect(screen.getByRole('button', { name: '上一页' }).hasAttribute('disabled')).toBe(false);
});

it('updates the API filter when navigation changes the query string', async () => {
  vi.mocked(api.listReservations).mockResolvedValue([]);
  openPage();
  await screen.findByText('没有符合条件的预约');
  fireEvent.click(screen.getByRole('link', { name: '切换场地筛选' }));
  await vi.waitFor(() => expect(api.listReservations).toHaveBeenLastCalledWith(
    expect.objectContaining({ venueId: 2, offset: 0 }),
  ));
});
