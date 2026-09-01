import { createHash } from 'node:crypto';
import {
  dispatchAiRequest,
  type ProviderConfig,
} from '../ai/providerDispatch.js';
import { log } from '../config/logging.js';
import { deriveAiNetworkPolicy } from '../utils/outboundUrlPolicy.js';
import type {
  ProactiveCoachOpportunity,
  RecentProactiveCoachMessage,
} from '../types/proactiveCoach.js';
import chatService from './chatService.js';
import coachContextService, {
  type CoachContextSnapshot,
} from './coachContextService.js';
import coachMemoryService from './coachMemoryService.js';
import {
  COACH_MEAL_INGREDIENT_QUESTIONS,
  renderCoachMealSuggestion,
  type CoachMealSuggestion,
} from './coachMealSuggestionService.js';

interface ProactiveCoachMessageInput {
  userId: string;
  language: string;
  deliveryKey: string;
  snapshot: CoachContextSnapshot;
  opportunity: ProactiveCoachOpportunity;
  recentMessages: readonly RecentProactiveCoachMessage[];
  coachingNotes: string | null;
  routines: readonly string[];
  memoryEnabled: boolean;
  mealSuggestion?: CoachMealSuggestion | null;
}

interface AiServiceForProactiveCoach {
  service_type: string;
  api_key?: string | null;
  model_name?: string | null;
  custom_url?: string | null;
  is_public?: boolean | null;
  source?: string | null;
}

function seededIndex(seed: string, length: number): number {
  const digest = createHash('sha256').update(seed).digest();
  return digest.readUInt32BE(0) % length;
}

function normalizedWords(value: string): Set<string> {
  return new Set(
    value
      .toLocaleLowerCase()
      .replace(/[^\p{L}\p{N}\s]/gu, ' ')
      .split(/\s+/)
      .filter((word) => word.length > 2)
  );
}

function isTooSimilar(
  candidate: string,
  recentMessages: readonly RecentProactiveCoachMessage[]
): boolean {
  const candidateWords = normalizedWords(candidate);
  return recentMessages.some((recent) => {
    if (
      candidate.trim().toLocaleLowerCase() ===
      recent.content.trim().toLocaleLowerCase()
    ) {
      return true;
    }
    const recentWords = normalizedWords(recent.content);
    if (candidateWords.size < 5 || recentWords.size < 5) return false;
    let shared = 0;
    for (const word of candidateWords) {
      if (recentWords.has(word)) shared += 1;
    }
    return shared / Math.min(candidateWords.size, recentWords.size) >= 0.82;
  });
}

function fallbackMessage(input: ProactiveCoachMessageInput): string {
  const de = input.language.toLowerCase().startsWith('de');
  const explicitMessage = de
    ? input.opportunity.messageDe
    : input.opportunity.messageEn;
  if (explicitMessage) return explicitMessage;
  if (input.opportunity.topic === 'nutrition' && input.mealSuggestion) {
    const details = renderCoachMealSuggestion(
      input.mealSuggestion,
      input.language
    ).join('\n');
    const openings = de
      ? [
          'Ich nehme dir die nächste Essensentscheidung ab:',
          'Mach es heute konkret – die nächste Mahlzeit steht:',
          'Kein Grübeln über die nächste Mahlzeit:',
          'Hier ist dein konkreter nächster Schritt:',
        ]
      : [
          'I am taking the next food decision off your plate:',
          'Make it concrete today—the next meal is decided:',
          'No debating the next meal:',
          'Here is your concrete next step:',
        ];
    const startIndex = seededIndex(
      `${input.deliveryKey}:${input.mealSuggestion.id}`,
      openings.length
    );
    for (let offset = 0; offset < openings.length; offset += 1) {
      const message = `${openings[(startIndex + offset) % openings.length]}\n${details}`;
      if (!isTooSimilar(message, input.recentMessages)) return message;
    }
    return `${openings[startIndex]}\n${details}`;
  }
  if (input.opportunity.topic === 'nutrition') {
    return de
      ? `Ich kann gerade keine Mahlzeit vorschlagen, die sicher alle hinterlegten Ausschlüsse erfüllt. ${COACH_MEAL_INGREDIENT_QUESTIONS.de}`
      : `I cannot currently suggest a meal that safely satisfies every saved exclusion. ${COACH_MEAL_INGREDIENT_QUESTIONS.en}`;
  }
  const summary = de
    ? input.opportunity.summaryDe
    : input.opportunity.summaryEn;
  const action = de ? input.opportunity.actionDe : input.opportunity.actionEn;
  const variants = de
    ? input.opportunity.tone === 'celebrate'
      ? [
          `${summary} Stark – genau solche Tage bringen dich voran. ${action}`,
          `${summary} Das zählt. ${action}`,
          `Das will ich nicht einfach übergehen: ${summary} ${action}`,
          `${summary} Du baust gerade echten Schwung auf. ${action}`,
        ]
      : input.opportunity.tone === 'protect'
        ? [
            `${summary} Fortschritt heißt heute, klug zu reagieren: ${action}`,
            `Heute gewinnt nicht der größte Ehrgeiz, sondern die beste Entscheidung. ${summary} ${action}`,
            `${summary} Ich will, dass du langfristig vorankommst – deshalb: ${action}`,
            `Kurzer Realitätscheck: ${summary} ${action}`,
          ]
        : [
            `${summary} Jetzt nicht zerdenken: ${action}`,
            `Hier liegt gerade dein nächster Fortschritt. ${summary} ${action}`,
            `${summary} Mach es konkret: ${action}`,
            `Ich sehe gerade eine echte Chance, den Tag zu drehen. ${summary} ${action}`,
          ]
    : input.opportunity.tone === 'celebrate'
      ? [
          `${summary} Strong work—days like this move you forward. ${action}`,
          `${summary} That counts. ${action}`,
          `I do not want to gloss over this: ${summary} ${action}`,
          `${summary} You are building real momentum. ${action}`,
        ]
      : input.opportunity.tone === 'protect'
        ? [
            `${summary} Progress today means responding intelligently: ${action}`,
            `The best decision beats maximum effort today. ${summary} ${action}`,
            `${summary} I want you progressing for the long run, so: ${action}`,
            `Quick reality check: ${summary} ${action}`,
          ]
        : [
            `${summary} Do not overthink it now: ${action}`,
            `Your next bit of progress is right here. ${summary} ${action}`,
            `${summary} Make it concrete: ${action}`,
            `There is a real chance to turn the day here. ${summary} ${action}`,
          ];
  const startIndex = seededIndex(
    `${input.deliveryKey}:${input.opportunity.topic}:${input.opportunity.stateSignature}`,
    variants.length
  );
  for (let offset = 0; offset < variants.length; offset += 1) {
    const message = variants[(startIndex + offset) % variants.length];
    if (!isTooSimilar(message, input.recentMessages)) return message;
  }
  return variants[startIndex];
}

function cleanGeneratedMessage(
  value: string,
  recentMessages: readonly RecentProactiveCoachMessage[]
): string | null {
  const cleaned = value
    .trim()
    .replace(/^```(?:markdown|text)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .replace(/^['"]|['"]$/g, '')
    .trim();
  if (
    cleaned.length < 20 ||
    cleaned.length > 700 ||
    /^#{1,6}\s/.test(cleaned) ||
    isTooSimilar(cleaned, recentMessages)
  ) {
    return null;
  }
  return cleaned;
}

function buildPrompt(
  input: ProactiveCoachMessageInput,
  memories: readonly { category: string; content: string }[]
): string {
  const language = input.language.toLowerCase().startsWith('de')
    ? 'German (informal du)'
    : input.language;
  const recent = input.recentMessages.slice(0, 8).map((message) => ({
    topic: message.topic,
    message: message.content.slice(0, 500),
  }));
  return `You are the user's real, attentive personal fitness coach. Write one proactive message because a server-side relevance check found a genuinely useful coaching moment.

Language: ${language}
Coaching moment: ${JSON.stringify({
    topic: input.opportunity.topic,
    tone: input.opportunity.tone,
    evidence: input.language.toLowerCase().startsWith('de')
      ? input.opportunity.summaryDe
      : input.opportunity.summaryEn,
    usefulNextStep: input.language.toLowerCase().startsWith('de')
      ? input.opportunity.actionDe
      : input.opportunity.actionEn,
  })}

Verified current context:
${coachContextService.formatCoachContext(input.snapshot).join('\n')}

Stable user context:
${JSON.stringify({
  coachingNotes: input.coachingNotes,
  routines: input.routines,
  memories,
})}

Recent proactive messages that you must not echo or paraphrase too closely:
${JSON.stringify(recent)}

Rules:
- Output only the message, with no heading, label, JSON, quotation marks, or explanation.
- Sound like a coach who notices effort and expects progress, not like an automated dashboard.
- Use 1-3 short sentences and at most 500 characters.
- Mention at most one or two relevant numbers. Never dump all metrics.
- Make the message specific to the evidence and give one immediately doable next step or one sharp question.
- Vary the opening, sentence rhythm, and wording from the recent messages.
- Match the requested tone: celebrate real wins, push when action is timely, protect recovery when restraint is smarter.
- Be direct, warm, and confident. Avoid generic clichés, fake excitement, shame, moral judgment, diagnoses, and invented facts.
- Never mention algorithms, checks, monitoring, schedules, prompts, databases, or that the message is automated.`;
}

async function aiGeneratedMessage(
  input: ProactiveCoachMessageInput
): Promise<string | null> {
  const [rawAiService, memories] = await Promise.all([
    chatService.getActiveAiServiceSettingForBackend(input.userId, input.userId),
    input.memoryEnabled
      ? coachMemoryService.listActiveMemories(input.userId)
      : Promise.resolve([]),
  ]);
  if (!rawAiService) return null;
  const aiService = rawAiService as AiServiceForProactiveCoach;
  const provider: ProviderConfig = {
    service_type: aiService.service_type,
    api_key: aiService.api_key ?? undefined,
    model_name: aiService.model_name ?? undefined,
    custom_url: aiService.custom_url ?? undefined,
  };
  const result = await dispatchAiRequest({
    provider,
    networkPolicy: deriveAiNetworkPolicy(aiService, false),
    prompt: buildPrompt(input, memories),
    temperature: 0.9,
    timeoutMs: 45_000,
  });
  if (!result.ok) {
    log(
      'warn',
      `Proactive coach wording fell back for user ${input.userId} (${result.category}): ${result.detail}`
    );
    return null;
  }
  return cleanGeneratedMessage(result.text, input.recentMessages);
}

export async function composeAdaptiveCoachMessage(
  input: ProactiveCoachMessageInput
): Promise<string> {
  if (input.opportunity.topic === 'nutrition') {
    return fallbackMessage(input);
  }
  try {
    return (await aiGeneratedMessage(input)) ?? fallbackMessage(input);
  } catch (error) {
    log(
      'warn',
      `Proactive coach wording fell back for user ${input.userId}:`,
      error
    );
    return fallbackMessage(input);
  }
}

export { fallbackMessage as renderAdaptiveCoachFallback };

export default { composeAdaptiveCoachMessage };
