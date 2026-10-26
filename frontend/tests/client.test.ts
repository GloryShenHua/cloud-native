import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, api, describeError } from '../src/api/client';

afterEach(() => vi.unstubAllGlobals());

function respond(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status });
}

describe('complete venue loading', () => {
  it('loads beyond the first 200 records without losing later venues', async () => {
    const records = Array.from({ length: 205 }, (_, index) => ({ id: index + 1 }));
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(respond(records.slice(0, 200)))
      .mockResolvedValueOnce(respond(records.slice(200)));
    vi.stubGlobal('fetch', fetchMock);

    expect(await api.listAllVenues()).toEqual(records);
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      '/api/venues?limit=200&offset=0', '/api/venues?limit=200&offset=200',
    ]);
  });

  it('finishes when a full batch is followed by an empty page', async () => {
    const records = Array.from({ length: 200 }, (_, index) => ({ id: index + 1 }));
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(respond(records)).mockResolvedValueOnce(respond([])));
    expect(await api.listAllVenues()).toEqual(records);
  });

  it('reports a later page failure instead of showing an incomplete list as complete', async () => {
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(respond(Array.from({ length: 200 }, (_, index) => ({ id: index + 1 }))))
      .mockResolvedValueOnce(respond({ error: { code: 'DATABASE_UNAVAILABLE', message: 'internal' } }, 503)));
    await expect(api.listAllVenues()).rejects.toMatchObject({ status: 503, code: 'DATABASE_UNAVAILABLE' });
  });
});

it.each(['DATABASE_UNAVAILABLE', 'INTERNAL_ERROR', 'HTTP_403', 'NETWORK_UNREACHABLE'])
  ('keeps diagnostic details out of user guidance for %s', (code) => {
    const guidance = describeError(new ApiError(503, code, 'HTTP SQL postgres /api CORS_ALLOWED_ORIGINS'));
    expect(guidance.title + guidance.hint).not.toMatch(/HTTP|SQL|postgres|\/api|CORS/);
  });
