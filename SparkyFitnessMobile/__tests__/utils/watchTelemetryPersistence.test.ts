import AsyncStorage from '@react-native-async-storage/async-storage';
import { AESEncryptionKey, AESSealedData, aesDecryptAsync } from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';
import WatchConnectivity from '../../modules/watch-connectivity';
import {
  deleteWatchTelemetryForConfig,
  deserializeWatchTelemetry,
  mergeWatchTelemetry,
  readWatchTelemetry,
  serializeWatchTelemetry,
  writeWatchTelemetry,
  __resetWatchTelemetryKeyForTests,
  type WatchTelemetrySessionState,
} from '../../src/utils/watchTelemetryPersistence';

jest.mock('../../modules/watch-connectivity', () => ({
  __esModule: true,
  default: {
    pendingHeartRateBatches: jest.fn(async () => []),
    ackHeartRateBatches: jest.fn(async () => undefined),
  },
}));

const OWNER = 'config-a';
const BUFFER_KEY = `sparky.watchTelemetryBuffer.${OWNER}`;

function create(entryDate: string | null): WatchTelemetrySessionState {
  return {
    samples: new Map(),
    energy: new Map(),
    durations: new Map(),
    durationFromTimeline: false,
    handledBatchClientIds: new Set(),
    entryDate,
    unposted: false,
    endedAt: null,
    attribution: null,
  };
}

function session(
  overrides: Partial<WatchTelemetrySessionState> = {}
): WatchTelemetrySessionState {
  return { ...create('2026-09-25'), ...overrides };
}

describe('watchTelemetryPersistence', () => {
  it('round-trips an unposted session and drops an empty posted one', () => {
    const sessions = new Map<string, WatchTelemetrySessionState>([
      [
        'session-1',
        session({
          samples: new Map([
            [
              'ex-1',
              [
                { t: '2026-09-25T15:00:00.000Z', bpm: 120 },
                { t: '2026-09-25T15:00:10.000Z', bpm: 130 },
              ],
            ],
          ]),
          energy: new Map([['ex-1', 12.5]]),
          handledBatchClientIds: new Set(['batch-1']),
          unposted: true,
          endedAt: 1000,
        }),
      ],
      ['session-empty', session({ entryDate: null })],
    ]);

    const restored = deserializeWatchTelemetry(
      serializeWatchTelemetry(sessions),
      create
    );

    expect([...restored.keys()]).toEqual(['session-1']);
    expect(restored.get('session-1')?.samples.get('ex-1')).toEqual([
      { t: '2026-09-25T15:00:00.000Z', bpm: 120 },
      { t: '2026-09-25T15:00:10.000Z', bpm: 130 },
    ]);
    expect(restored.get('session-1')?.energy.get('ex-1')).toBe(12.5);
    expect(
      restored.get('session-1')?.handledBatchClientIds.has('batch-1')
    ).toBe(true);
    expect(restored.get('session-1')?.unposted).toBe(true);
  });

  it('fills an empty live session from storage and asks for a flush', () => {
    const live = new Map<string, WatchTelemetrySessionState>([
      ['session-1', create('2026-09-25')],
    ]);
    const saved = new Map<string, WatchTelemetrySessionState>([
      [
        'session-1',
        session({
          samples: new Map([
            [
              'ex-1',
              [
                { t: '2026-09-25T15:00:00.000Z', bpm: 120 },
                { t: '2026-09-25T15:00:10.000Z', bpm: 130 },
              ],
            ],
          ]),
          handledBatchClientIds: new Set(['batch-1']),
          unposted: true,
        }),
      ],
    ]);

    expect(mergeWatchTelemetry(live, saved, create)).toBe(true);
    expect(live.get('session-1')?.unposted).toBe(true);
    expect(live.get('session-1')?.samples.get('ex-1')).toHaveLength(2);
  });

  it('does not mark a session unposted again after a flush already cleared it', () => {
    const live = new Map<string, WatchTelemetrySessionState>([
      [
        'session-1',
        session({
          samples: new Map([
            [
              'ex-1',
              [
                { t: '2026-09-25T15:00:00.000Z', bpm: 120 },
                { t: '2026-09-25T15:00:10.000Z', bpm: 130 },
              ],
            ],
          ]),
          unposted: false,
        }),
      ],
    ]);
    const saved = new Map<string, WatchTelemetrySessionState>([
      [
        'session-1',
        session({
          samples: new Map([
            ['ex-1', [{ t: '2026-09-25T15:00:00.000Z', bpm: 120 }]],
          ]),
          unposted: true,
        }),
      ],
    ]);

    expect(mergeWatchTelemetry(live, saved, create)).toBe(false);
    expect(live.get('session-1')?.unposted).toBe(false);
  });

  it('re-arms a session when the saved buffer still has samples the live one does not', () => {
    const live = new Map<string, WatchTelemetrySessionState>([
      [
        'session-1',
        session({
          samples: new Map([
            ['ex-1', [{ t: '2026-09-25T15:00:00.000Z', bpm: 120 }]],
          ]),
          unposted: false,
        }),
      ],
    ]);
    const saved = new Map<string, WatchTelemetrySessionState>([
      [
        'session-1',
        session({
          samples: new Map([
            [
              'ex-1',
              [
                { t: '2026-09-25T15:00:00.000Z', bpm: 120 },
                { t: '2026-09-25T15:01:00.000Z', bpm: 140 },
              ],
            ],
          ]),
          unposted: true,
        }),
      ],
    ]);

    expect(mergeWatchTelemetry(live, saved, create)).toBe(true);
    expect(live.get('session-1')?.unposted).toBe(true);
    expect(live.get('session-1')?.samples.get('ex-1')).toHaveLength(2);
  });

  it('skips a corrupt session and still restores the valid one', () => {
    const raw = JSON.stringify({
      good: {
        samples: [['ex-1', [{ t: '2026-09-25T15:00:00.000Z', bpm: 120 }]]],
        unposted: true,
      },
      bad: { samples: { 'ex-1': [{ t: 'nope' }] } },
    });

    const restored = deserializeWatchTelemetry(raw, create);

    expect([...restored.keys()]).toEqual(['good']);
    expect(restored.get('good')?.samples.get('ex-1')).toHaveLength(1);
  });

  it('adds a live batch onto the saved energy instead of keeping the larger', () => {
    const live = new Map<string, WatchTelemetrySessionState>([
      [
        'session-1',
        session({
          energy: new Map([['ex-1', 4]]),
          handledBatchClientIds: new Set(['batch-new']),
        }),
      ],
    ]);
    const saved = new Map<string, WatchTelemetrySessionState>([
      [
        'session-1',
        session({
          energy: new Map([['ex-1', 9]]),
          handledBatchClientIds: new Set(['batch-old']),
          unposted: true,
        }),
      ],
    ]);

    mergeWatchTelemetry(live, saved, create);
    expect(live.get('session-1')?.energy.get('ex-1')).toBe(13);
  });

  it('does not add saved energy whose batches the live session already applied', () => {
    const live = new Map<string, WatchTelemetrySessionState>([
      [
        'session-1',
        session({
          energy: new Map([['ex-1', 4]]),
          handledBatchClientIds: new Set(['batch-shared']),
        }),
      ],
    ]);
    const saved = new Map<string, WatchTelemetrySessionState>([
      [
        'session-1',
        session({
          energy: new Map([['ex-1', 9]]),
          handledBatchClientIds: new Set(['batch-old', 'batch-shared']),
        }),
      ],
    ]);

    mergeWatchTelemetry(live, saved, create);
    expect(live.get('session-1')?.energy.get('ex-1')).toBe(9);
  });

  it('stores ciphertext and reads it back', async () => {
    await writeWatchTelemetry(
      new Map([
        [
          'session-1',
          session({
            unposted: true,
            energy: new Map([['ex-1', 4]]),
          }),
        ],
      ]),
      OWNER
    );

    const stored = await AsyncStorage.getItem(BUFFER_KEY);
    expect(stored?.startsWith('{')).toBe(false);
    const restored = await readWatchTelemetry(create, OWNER);
    expect(restored.get('session-1')?.energy.get('ex-1')).toBe(4);
    expect(restored.get('session-1')?.unposted).toBe(true);
  });

  it('still reads a buffer written before encryption', async () => {
    await AsyncStorage.setItem(
      BUFFER_KEY,
      serializeWatchTelemetry(
        new Map([
          [
            'session-1',
            session({
              samples: new Map([
                ['ex-1', [{ t: '2026-09-25T15:00:00.000Z', bpm: 120 }]],
              ]),
              unposted: true,
            }),
          ],
        ])
      )
    );

    const restored = await readWatchTelemetry(create, OWNER);
    expect(restored.get('session-1')?.samples.get('ex-1')).toHaveLength(1);
  });

  it('leaves the ciphertext in place when the key cannot be read', async () => {
    await AsyncStorage.setItem(BUFFER_KEY, 'sealed-not-plaintext');
    __resetWatchTelemetryKeyForTests();
    (SecureStore.getItemAsync as jest.Mock).mockRejectedValueOnce(
      new Error('locked')
    );

    await expect(readWatchTelemetry(create, OWNER)).rejects.toThrow('locked');
    expect(await AsyncStorage.getItem(BUFFER_KEY)).toBe('sealed-not-plaintext');
  });

  it('deletes a buffer under the shared key instead of giving it to a config', async () => {
    await AsyncStorage.clear();
    await AsyncStorage.setItem(
      'sparky.watchTelemetryBuffer',
      serializeWatchTelemetry(
        new Map([
          [
            'session-1',
            session({ energy: new Map([['ex-1', 5]]), unposted: true }),
          ],
        ])
      )
    );

    const restored = await readWatchTelemetry(create, OWNER);
    expect(restored.size).toBe(0);
    expect(
      await AsyncStorage.getItem('sparky.watchTelemetryBuffer')
    ).toBeNull();
    expect(await AsyncStorage.getItem(BUFFER_KEY)).toBeNull();
  });

  it('neither reads nor writes telemetry without a server config', async () => {
    await AsyncStorage.clear();
    await writeWatchTelemetry(
      new Map([
        [
          'session-1',
          session({ energy: new Map([['ex-1', 2]]), unposted: true }),
        ],
      ]),
      OWNER
    );

    expect((await readWatchTelemetry(create, null)).size).toBe(0);
    await expect(
      writeWatchTelemetry(
        new Map([['session-1', session({ unposted: true })]]),
        null
      )
    ).rejects.toThrow('no owning server config');
    const mine = await readWatchTelemetry(create, OWNER);
    expect(mine.get('session-1')?.energy.get('ex-1')).toBe(2);
  });

  it("forgets a deleted config's buffer and its queued batches", async () => {
    await AsyncStorage.clear();
    await writeWatchTelemetry(
      new Map([['session-1', session({ unposted: true })]]),
      OWNER
    );
    await writeWatchTelemetry(
      new Map([['session-2', session({ unposted: true })]]),
      'config-b'
    );
    const native = WatchConnectivity as unknown as {
      pendingHeartRateBatches: jest.Mock;
      ackHeartRateBatches: jest.Mock;
    };
    native.pendingHeartRateBatches.mockResolvedValueOnce([
      {
        clientId: 'hr-a',
        ownerId: OWNER,
        sessionId: 's',
        exerciseEntryId: 'e',
        samples: [],
      },
      {
        queueId: 'q-a',
        ownerId: OWNER,
        sessionId: 's',
        exerciseEntryId: 'e',
        samples: [],
      },
      {
        clientId: 'hr-b',
        ownerId: 'config-b',
        sessionId: 's',
        exerciseEntryId: 'e',
        samples: [],
      },
    ]);

    await deleteWatchTelemetryForConfig(OWNER);

    expect(await AsyncStorage.getItem(BUFFER_KEY)).toBeNull();
    expect(
      await AsyncStorage.getItem('sparky.watchTelemetryBuffer.config-b')
    ).not.toBeNull();
    expect(native.ackHeartRateBatches).toHaveBeenCalledWith(['hr-a', 'q-a']);
  });

  it('keeps one account buffer when another account writes', async () => {
    await AsyncStorage.clear();
    const saved = new Map<string, WatchTelemetrySessionState>([
      [
        'session-a',
        session({ energy: new Map([['ex-a', 3]]), unposted: true }),
      ],
    ]);
    await writeWatchTelemetry(saved, 'account-a');
    await writeWatchTelemetry(new Map(), 'account-b');

    const other = await readWatchTelemetry(session, 'account-b');
    const mine = await readWatchTelemetry(session, 'account-a');
    expect(other.size).toBe(0);
    expect(mine.get('session-a')?.energy.get('ex-a')).toBe(3);
  });

  it('lets the later snapshot win when an earlier write is still in flight', async () => {
    const written: string[] = [];
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let started: () => void = () => {};
    const firstWriteStarted = new Promise<void>((resolve) => {
      started = resolve;
    });
    const setItem = jest
      .spyOn(AsyncStorage, 'setItem')
      .mockImplementation(async (_key, value) => {
        written.push(value);
        if (written.length === 1) {
          started();
          await gate;
        }
      });

    const older = new Map<string, WatchTelemetrySessionState>([
      [
        'session-1',
        session({ unposted: true, energy: new Map([['ex-1', 4]]) }),
      ],
    ]);
    const newer = new Map<string, WatchTelemetrySessionState>([
      [
        'session-1',
        session({ unposted: false, energy: new Map([['ex-1', 4]]) }),
      ],
    ]);

    try {
      const first = writeWatchTelemetry(older, OWNER);
      const second = writeWatchTelemetry(newer, OWNER);
      await firstWriteStarted;
      release();
      await first;
      await second;

      expect(written).toHaveLength(2);
      const plain = await openStored(written[1]);
      expect(written[1].includes('"unposted"')).toBe(false);
      expect(JSON.parse(plain)['session-1'].unposted).toBe(false);
    } finally {
      setItem.mockRestore();
    }
  });
});

async function openStored(stored: string): Promise<string> {
  const encoded = await SecureStore.getItemAsync('sparky.watchTelemetryKey');
  const key = await AESEncryptionKey.import(encoded ?? '', 'base64');
  const bytes = (await aesDecryptAsync(
    AESSealedData.fromCombined(stored),
    key
  )) as Uint8Array;
  return new TextDecoder().decode(bytes);
}
