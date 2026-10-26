// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { api } from '../src/api/client';
import type { Venue } from '../src/api/types';
import { ToastProvider } from '../src/components/ToastProvider';
import { VenuesPage } from '../src/pages/VenuesPage';

vi.mock('../src/api/client', async (original) => ({
  ...await original<typeof import('../src/api/client')>(),
  api: { listAllVenues: vi.fn() },
}));

const venues: Venue[] = Array.from({ length: 205 }, (_, index) => ({
  id: index + 1, name: `测试场地 ${index + 1}`, location: `区域 ${index + 1}`,
  capacity: 20, openingTime: '08:00:00', closingTime: '22:00:00',
  status: index % 2 === 0 ? 'OPEN' : 'DISABLED',
}));

beforeEach(() => vi.mocked(api.listAllVenues).mockResolvedValue(venues));
afterEach(() => { cleanup(); vi.clearAllMocks(); });

function openPage() {
  return render(<MemoryRouter><ToastProvider><VenuesPage /></ToastProvider></MemoryRouter>);
}

it('paginates all venues and allows returning to the previous page', async () => {
  openPage();
  await screen.findByRole('heading', { name: '测试场地 1', exact: true });
  expect(screen.getAllByRole('article')).toHaveLength(12);
  fireEvent.click(screen.getByRole('button', { name: '下一页' }));
  expect(screen.getByRole('heading', { name: '测试场地 13', exact: true })).toBeDefined();
  expect(screen.queryByRole('heading', { name: '测试场地 1', exact: true })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '上一页' }));
  expect(screen.getByRole('heading', { name: '测试场地 1', exact: true })).toBeDefined();
});

it('searches later records and resets pagination after changing filters', async () => {
  openPage();
  await screen.findByRole('heading', { name: '测试场地 1', exact: true });
  fireEvent.click(screen.getByRole('button', { name: '下一页' }));
  fireEvent.change(screen.getByLabelText('关键词'), { target: { value: '测试场地 205' } });
  expect(screen.getByRole('heading', { name: '测试场地 205', exact: true })).toBeDefined();
  expect(screen.getAllByRole('article')).toHaveLength(1);
  expect(screen.getByRole('button', { name: '下一页' }).hasAttribute('disabled')).toBe(true);
  fireEvent.change(screen.getByLabelText('状态'), { target: { value: 'DISABLED' } });
  expect(screen.getByText('没有匹配的场地')).toBeDefined();
  expect(screen.queryAllByRole('article')).toHaveLength(0);
});

it('shows the last partial page without offering an extra empty page', async () => {
  openPage();
  await screen.findByRole('heading', { name: '测试场地 1', exact: true });
  for (let page = 1; page < 18; page++) fireEvent.click(screen.getByRole('button', { name: '下一页' }));
  expect(screen.getAllByRole('article')).toHaveLength(1);
  expect(screen.getByRole('heading', { name: '测试场地 205', exact: true })).toBeDefined();
  expect(screen.getByRole('button', { name: '下一页' }).hasAttribute('disabled')).toBe(true);
});
