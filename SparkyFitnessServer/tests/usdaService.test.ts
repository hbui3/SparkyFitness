import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../config/logging.js', () => ({ log: vi.fn() }));

import { searchUsdaFoods } from '../integrations/usda/usdaService.js';

describe('searchUsdaFoods', () => {
  const realFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  function searchResponse() {
    return new Response(
      JSON.stringify({
        foods: [],
        currentPage: 1,
        totalPages: 1,
        totalHits: 0,
      }),
      { status: 200, headers: { 'content-type': 'application/json' } }
    );
  }

  function requestOf(fetchMock: ReturnType<typeof vi.fn>) {
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    return { url: new URL(url), init, body: JSON.parse(init.body as string) };
  }

  // USDA's gateway intermittently rejects GET searches carrying a dataType
  // filter with a bare nginx 400 (#2675), so the search goes out as a POST.
  it('searches with a POST JSON body instead of GET query params', async () => {
    const fetchMock = vi.fn().mockResolvedValue(searchResponse());
    globalThis.fetch = fetchMock;

    await searchUsdaFoods('chicken breast', 'test-api-key');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const { url, init } = requestOf(fetchMock);
    expect(init.method).toBe('POST');
    expect(new Headers(init.headers).get('content-type')).toBe(
      'application/json'
    );
    expect(url.pathname).toBe('/fdc/v1/foods/search');
    expect(url.searchParams.get('api_key')).toBe('test-api-key');
    expect(url.searchParams.has('query')).toBe(false);
    expect(url.searchParams.has('dataType')).toBe(false);
  });

  it('requests the non-branded datasets by default as a dataType array', async () => {
    const fetchMock = vi.fn().mockResolvedValue(searchResponse());
    globalThis.fetch = fetchMock;

    await searchUsdaFoods('chicken breast', 'test-api-key');

    expect(requestOf(fetchMock).body.dataType).toEqual([
      'Foundation',
      'SR Legacy',
      'Survey (FNDDS)',
    ]);
  });

  it('sends the query and paging in the body', async () => {
    const fetchMock = vi.fn().mockResolvedValue(searchResponse());
    globalThis.fetch = fetchMock;

    await searchUsdaFoods('chicken breast', 'test-api-key', 2, 25);

    const { body } = requestOf(fetchMock);
    expect(body.query).toBe('chicken breast');
    expect(body.pageNumber).toBe(2);
    expect(body.pageSize).toBe(25);
  });

  it('omits dataType when no dataset filter is given', async () => {
    const fetchMock = vi.fn().mockResolvedValue(searchResponse());
    globalThis.fetch = fetchMock;

    await searchUsdaFoods('chicken breast', 'test-api-key', 1, 50, '');

    expect(requestOf(fetchMock).body).not.toHaveProperty('dataType');
  });

  it('throws with the response text when USDA rejects the search', async () => {
    globalThis.fetch = vi
      .fn()
      .mockResolvedValue(
        new Response('<html>400 Bad Request</html>', { status: 400 })
      );

    await expect(
      searchUsdaFoods('chicken breast', 'test-api-key')
    ).rejects.toThrow('USDA API error: <html>400 Bad Request</html>');
  });
});
