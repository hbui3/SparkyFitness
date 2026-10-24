/**
 * Synthesizes interval audio cues in the browser via Web Audio API.
 * Avoids any external audio asset loading / network dependencies.
 */

let audioCtx: AudioContext | null = null;

function getAudioContext(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  try {
    if (!audioCtx) {
      const AudioCtxClass =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext })
          .webkitAudioContext;
      if (AudioCtxClass) {
        audioCtx = new AudioCtxClass();
      }
    }
    if (audioCtx && audioCtx.state === 'suspended') {
      void audioCtx.resume();
    }
    return audioCtx;
  } catch {
    return null;
  }
}

export type IntervalCueType = 'countdown' | 'work' | 'rest' | 'finish';

function playTone(
  ctx: AudioContext,
  freq: number,
  startTime: number,
  duration: number,
  maxGain = 0.2,
  type: OscillatorType = 'sine'
): void {
  try {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, startTime);
    gain.gain.setValueAtTime(maxGain, startTime);
    gain.gain.exponentialRampToValueAtTime(0.0001, startTime + duration);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(startTime);
    osc.stop(startTime + duration + 0.02);
  } catch {
    // Audio synthesis failure should never crash the UI
  }
}

export function playIntervalCue(cue: IntervalCueType): void {
  const ctx = getAudioContext();
  if (!ctx) return;

  const now = ctx.currentTime;

  switch (cue) {
    case 'countdown': {
      // Crisp, short 880Hz beep (3, 2, 1)
      playTone(ctx, 880, now, 0.09, 0.18, 'sine');
      break;
    }
    case 'work': {
      // Energetic, clean modern fitness chime (C6 -> E6 + C7 sparkle)
      playTone(ctx, 1046.5, now, 0.18, 0.22, 'triangle');
      playTone(ctx, 1318.5, now + 0.08, 0.35, 0.25, 'sine');
      playTone(ctx, 2093.0, now + 0.08, 0.25, 0.12, 'sine');
      break;
    }
    case 'rest': {
      // Smooth, gentle descending 2-tone rest cue (E5 -> A4)
      playTone(ctx, 659.25, now, 0.16, 0.18, 'sine');
      playTone(ctx, 440.0, now + 0.09, 0.32, 0.18, 'sine');
      break;
    }
    case 'finish': {
      // Triumphant ascending fanfare chord
      playTone(ctx, 523.25, now, 0.22, 0.18, 'triangle');
      playTone(ctx, 659.25, now + 0.09, 0.22, 0.2, 'triangle');
      playTone(ctx, 783.99, now + 0.18, 0.28, 0.22, 'triangle');
      playTone(ctx, 1046.5, now + 0.28, 0.65, 0.25, 'sine');
      break;
    }
  }
}
