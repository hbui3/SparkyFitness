import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AxiosInstance } from 'axios';
import { SpeedianceApiClient } from '../integrations/speediance/speedianceApiClient.js';

describe('SpeedianceApiClient', () => {
  const post = vi.fn();
  const get = vi.fn();
  const httpClient = { post, get } as unknown as AxiosInstance;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('logs in via verifyIdentity and byPass without exposing credentials in headers', async () => {
    post
      .mockResolvedValueOnce({
        data: { code: 0, data: { isExist: true, hasPwd: true } },
      })
      .mockResolvedValueOnce({
        data: { code: 0, data: { token: 'session-token', appUserId: 42 } },
      });
    const client = new SpeedianceApiClient({
      region: 'EU',
      timezone: 'Europe/Berlin',
      httpClient,
    });

    await client.login('local-test@example.com', 'local-test-password');

    expect(post).toHaveBeenNthCalledWith(
      1,
      '/api/app/v2/login/verifyIdentity',
      { type: 2, userIdentity: 'local-test@example.com' },
      expect.objectContaining({
        headers: expect.objectContaining({ Host: 'euapi.speediance.com' }),
      })
    );
    const verifyHeaders = post.mock.calls[0]?.[2]?.headers;
    expect(verifyHeaders).not.toHaveProperty('Token');
    expect(verifyHeaders).not.toHaveProperty('password');
  });

  it('uses the authenticated mobile headers when reading workout history', async () => {
    post
      .mockResolvedValueOnce({
        data: { data: { isExist: true, hasPwd: true } },
      })
      .mockResolvedValueOnce({
        data: { data: { token: 'token-1', appUserId: 'user-1' } },
      });
    get.mockResolvedValueOnce({ data: { data: [{ trainingId: 7 }] } });
    const client = new SpeedianceApiClient({
      region: 'EU',
      timezone: 'Europe/Berlin',
      httpClient,
    });
    await client.login('local-test@example.com', 'local-test-password');

    const records = await client.getTrainingRecords('2026-08-01', '2026-08-18');

    expect(records).toEqual([{ trainingId: 7 }]);
    expect(get).toHaveBeenCalledWith(
      '/api/mobile/v2/report/userTrainingDataRecord',
      expect.objectContaining({
        params: { startDate: '2026-08-01', endDate: '2026-08-18' },
        headers: expect.objectContaining({
          App_user_id: 'user-1',
          Token: 'token-1',
          Timezone: 'Europe/Berlin',
        }),
      })
    );
  });

  it('routes every known workout type to its canonical info and detail resources', async () => {
    post
      .mockResolvedValueOnce({
        data: { data: { isExist: true, hasPwd: true } },
      })
      .mockResolvedValueOnce({
        data: { data: { token: 'token-1', appUserId: 'user-1' } },
      });
    get.mockResolvedValue({ data: { data: [] } });
    const client = new SpeedianceApiClient({
      region: 'EU',
      timezone: 'Europe/Berlin',
      httpClient,
    });
    await client.login('local-test@example.com', 'local-test-password');

    const cases = [
      [1, 'freeTraining', 'freeTraining'],
      [2, 'courseTrainingInfo', 'courseTrainingInfoDetail'],
      [5, 'cttTrainingInfo', 'cttTrainingInfoDetail'],
      [7, 'freeTraining', 'freeTrainingDetail'],
      [9, 'aiCourseTrainingInfo', 'aiCourseTrainingInfoDetail'],
    ] as const;

    for (const [type, infoResource, detailResource] of cases) {
      await client.getTrainingInfo(`info id ${type}`, type);
      await client.getTrainingDetail(`detail/id/${type}`, type);

      expect(get).toHaveBeenNthCalledWith(
        (type === 1 ? 0 : cases.findIndex(([item]) => item === type) * 2) + 1,
        `/api/app/trainingInfo/${infoResource}/info%20id%20${type}`,
        expect.any(Object)
      );
      expect(get).toHaveBeenNthCalledWith(
        (type === 1 ? 0 : cases.findIndex(([item]) => item === type) * 2) + 2,
        `/api/app/trainingInfo/${detailResource}/detail%2Fid%2F${type}`,
        expect.any(Object)
      );
    }
  });

  it('rejects unknown workout types instead of querying a colliding table', async () => {
    const client = new SpeedianceApiClient({
      region: 'EU',
      timezone: 'Europe/Berlin',
      httpClient,
    });

    await expect(client.getTrainingDetail('unknown', 99)).rejects.toThrow(
      'Unsupported Speediance training type 99.'
    );
    expect(get).not.toHaveBeenCalled();
  });

  it('loads exercise muscle metadata from the action-library group', async () => {
    post
      .mockResolvedValueOnce({
        data: { data: { isExist: true, hasPwd: true } },
      })
      .mockResolvedValueOnce({
        data: { data: { token: 'token-1', appUserId: 'user-1' } },
      });
    get.mockResolvedValueOnce({
      data: { data: { mainMuscleGroupName: 'Pecs' } },
    });
    const client = new SpeedianceApiClient({
      region: 'EU',
      timezone: 'Europe/Berlin',
      httpClient,
    });
    await client.login('local-test@example.com', 'local-test-password');

    await expect(client.getActionLibraryGroup('group/id 1')).resolves.toEqual({
      mainMuscleGroupName: 'Pecs',
    });
    expect(get).toHaveBeenCalledWith(
      '/api/app/actionLibraryGroup/group%2Fid%201',
      expect.objectContaining({
        params: { isDisplay: 0 },
        headers: expect.objectContaining({ Token: 'token-1' }),
      })
    );
  });

  it('loads Free Lift action metadata so its group and muscles can be resolved', async () => {
    post
      .mockResolvedValueOnce({
        data: { data: { isExist: true, hasPwd: true } },
      })
      .mockResolvedValueOnce({
        data: { data: { token: 'token-1', appUserId: 'user-1' } },
      });
    get.mockResolvedValueOnce({
      data: { data: { groupId: 199, mainMuscleGroupName: 'Biceps' } },
    });
    const client = new SpeedianceApiClient({
      region: 'EU',
      timezone: 'Europe/Berlin',
      httpClient,
    });
    await client.login('local-test@example.com', 'local-test-password');

    await expect(client.getActionLibrary('action/id 1')).resolves.toEqual({
      groupId: 199,
      mainMuscleGroupName: 'Biceps',
    });
    expect(get).toHaveBeenCalledWith(
      '/api/app/actionLibrary/action%2Fid%201',
      expect.objectContaining({
        headers: expect.objectContaining({ Token: 'token-1' }),
      })
    );
  });
});
