import type { AxiosInstance } from 'axios';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  IGPSportApiClient,
  IGPSportApiError,
} from '../integrations/igpsport/igpsportApiClient.js';
import {
  igpsportRegionFromBaseUrl,
  normalizeIGPSportBaseUrl,
} from '../integrations/igpsport/igpsportConfig.js';

describe('iGPSPORT configuration', () => {
  it('defaults to the global API and rejects arbitrary hosts', () => {
    expect(igpsportRegionFromBaseUrl(null)).toBe('Global');
    expect(normalizeIGPSportBaseUrl('https://prod.zh.igpsport.com')).toBe(
      'https://prod.zh.igpsport.com'
    );
    expect(() =>
      normalizeIGPSportBaseUrl('https://example.com/service')
    ).toThrow('Unsupported iGPSPORT region endpoint.');
  });
});

describe('IGPSportApiClient', () => {
  const post = vi.fn();
  const get = vi.fn();
  const downloadFetch = vi.fn<typeof fetch>();
  const httpClient = { post, get } as unknown as AxiosInstance;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('logs in with the web app contract without placing credentials in headers', async () => {
    post.mockResolvedValue({
      data: { code: 200, data: { access_token: 'access-token' } },
    });
    const client = new IGPSportApiClient({
      region: 'Global',
      timezone: 'Europe/Berlin',
      httpClient,
      downloadFetch,
    });

    await client.login('rider@example.com', 'local-password');

    expect(post).toHaveBeenCalledWith(
      '/service/auth/account/login',
      {
        appId: 'igpsport-web',
        username: 'rider@example.com',
        password: 'local-password',
      },
      {
        headers: expect.objectContaining({
          timezone: 'Europe/Berlin',
          'qiwu-app-version': '1.0.0',
        }),
      }
    );
    expect(post.mock.calls[0]?.[2]?.headers).not.toHaveProperty(
      'Authorization'
    );
  });

  it('loads a filtered FIT activity page with the authenticated web endpoint', async () => {
    post.mockResolvedValue({
      data: { code: 0, data: { access_token: 'access-token' } },
    });
    get.mockResolvedValue({
      data: {
        code: 0,
        data: {
          rows: [
            {
              rideId: 123,
              title: 'Morning Ride',
              startTime: '2026-08-18 08:00:00',
              productName: 'iGS800',
            },
          ],
          pageNo: 1,
          totalPage: 2,
          totalRows: 21,
        },
      },
    });
    const client = new IGPSportApiClient({
      region: 'Global',
      timezone: 'Europe/Berlin',
      httpClient,
      downloadFetch,
    });
    await client.login('rider@example.com', 'local-password');

    const page = await client.getActivitiesPage('2026-08-01', '2026-08-18', 1);

    expect(page.activities[0]).toEqual({
      rideId: '123',
      title: 'Morning Ride',
      startTime: '2026-08-18 08:00:00',
      productName: 'iGS800',
    });
    expect(page.totalPages).toBe(2);
    expect(get).toHaveBeenCalledWith(
      '/service/web-gateway/web-analyze/activity/queryMyActivity',
      expect.objectContaining({
        params: {
          pageNo: 1,
          pageSize: 20,
          beginTime: '2026-08-01',
          endTime: '2026-08-18',
          reqType: '0',
          sort: '1',
        },
        headers: expect.objectContaining({
          Authorization: 'Bearer access-token',
        }),
      })
    );
  });

  it('downloads a signed public FIT URL without leaking the account token', async () => {
    downloadFetch.mockResolvedValue(
      new Response(new Uint8Array([1, 2, 3]), {
        status: 200,
        headers: { 'content-length': '3' },
      })
    );
    const client = new IGPSportApiClient({
      region: 'Global',
      timezone: 'Europe/Berlin',
      httpClient,
      downloadFetch,
    });

    const buffer = await client.downloadFitFile(
      'https://activity-files.example.net/signed.fit'
    );

    expect([...buffer]).toEqual([1, 2, 3]);
    expect(downloadFetch).toHaveBeenCalledWith(
      new URL('https://activity-files.example.net/signed.fit'),
      { headers: undefined }
    );
  });

  it('rejects non-HTTPS FIT download URLs', async () => {
    const client = new IGPSportApiClient({
      region: 'Global',
      timezone: 'Europe/Berlin',
      httpClient,
      downloadFetch,
    });

    await expect(
      client.downloadFitFile('http://127.0.0.1/private.fit')
    ).rejects.toBeInstanceOf(IGPSportApiError);
    expect(downloadFetch).not.toHaveBeenCalled();
  });
});
