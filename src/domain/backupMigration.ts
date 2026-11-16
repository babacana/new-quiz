import { mergeEventCustomizations } from './customizationThemes';
import { DEFAULT_CUSTOMIZATIONS, DEFAULT_SETTINGS } from './defaults';
import type { RandomSource } from './ports';
import type {
  DifficultyLevel,
  EventConfig,
  EventCustomizationsPatch,
  EventSettings,
  GiveUpLockoutRecord,
  MatchAnswer,
  MatchRecord,
  PlatformBackupPayload,
  PrizeClaimRecord,
  Question,
} from './types';

export interface LegacyQuizQuestionRaw {
  id: string | number;
  text: string;
  options: string[];
  correct?: number;
  correctIndex?: number;
  isDisabled?: boolean;
  difficulty?: string;
  tags?: string[];
}

export interface LegacyPlayerAttemptRaw {
  questionId: string | number;
  questionText?: string;
  options?: string[];
  selectedOptionText?: string;
  correctOptionIndex?: number;
  correctOptionText?: string;
  isCorrect?: boolean;
}

export interface LegacyParticipantRaw {
  name?: string;
  phone?: string;
  score?: number;
  time?: number;
  timeSeconds?: number;
  timestamp?: string;
  playedAt?: string;
  playerAttempts?: LegacyPlayerAttemptRaw[];
}

export interface LegacyPrizeWinnerRaw {
  phone?: string;
  timestamp?: string;
}

export interface LegacyGiveUpLockoutRaw {
  phone?: string;
  lockedAt?: string;
  expiresAt?: string;
}

export interface LegacyQuizOfflineBackupPayload {
  quizQuestions?: LegacyQuizQuestionRaw[];
  quizParticipants?: LegacyParticipantRaw[];
  quizSettings?: Partial<EventSettings>;
  quizCurrentEvent?: {
    eventName?: string;
    startTime?: string | null;
    endTime?: string | null;
    enableOutOfPeriodMessage?: boolean;
  } | null;
  quizPrizeWinnersData?: LegacyPrizeWinnerRaw[];
  quizPrizeWinners?: LegacyPrizeWinnerRaw[];
  quizGiveUpLockoutData?: LegacyGiveUpLockoutRaw[];
  quizGiveUpLockout?: LegacyGiveUpLockoutRaw[];
  quizThemeCustomizations?: EventCustomizationsPatch | null;
  quizCustomLogoFileName?: string | null;
}

function normalizeDifficulty(raw?: string): DifficultyLevel {
  if (raw === 'facil' || raw === 'moderado' || raw === 'dificil') {
    return raw;
  }
  return 'moderado';
}

function normalizeFourOptions(rawOptions: string[] | undefined): [string, string, string, string] {
  const padded = [
    String(rawOptions?.[0] ?? '').trim(),
    String(rawOptions?.[1] ?? '').trim(),
    String(rawOptions?.[2] ?? '').trim(),
    String(rawOptions?.[3] ?? '').trim(),
  ];
  return [padded[0]!, padded[1]!, padded[2]!, padded[3]!];
}

// Normaliza e remapeia IDs legados (ex: "q1", "q_imported_...") para IDs numéricos sequenciais (1..N).
export function normalizeAndMapQuizDataIds(
  legacyQuestions: readonly LegacyQuizQuestionRaw[],
  legacyParticipants: readonly LegacyParticipantRaw[],
): {
  questions: Question[];
  remappedParticipants: LegacyParticipantRaw[];
  remappedAnswersCount: number;
} {
  const idMap = new Map<string, number>();
  let nextId = 1;

  const questions: Question[] = legacyQuestions.map((raw) => {
    const newId = nextId;
    nextId += 1;
    idMap.set(String(raw.id), newId);

    const correctRaw = raw.correctIndex ?? raw.correct ?? 0;
    const correctIndex = Math.min(3, Math.max(0, Number(correctRaw) || 0));

    return {
      id: newId,
      text: String(raw.text ?? '').trim(),
      options: normalizeFourOptions(raw.options),
      correctIndex,
      difficulty: normalizeDifficulty(raw.difficulty),
      tags: Array.isArray(raw.tags)
        ? raw.tags.map((tag) => String(tag).trim().toLowerCase()).filter(Boolean)
        : [],
      isDisabled: Boolean(raw.isDisabled),
    };
  });

  let remappedAnswersCount = 0;
  const remappedParticipants = legacyParticipants.map((participant) => {
    if (!Array.isArray(participant.playerAttempts)) {
      return participant;
    }

    const updatedAttempts = participant.playerAttempts.map((attempt) => {
      const mappedId = idMap.get(String(attempt.questionId));
      if (mappedId !== undefined) {
        remappedAnswersCount += 1;
        return { ...attempt, questionId: mappedId };
      }
      return attempt;
    });

    return { ...participant, playerAttempts: updatedAttempts };
  });

  return { questions, remappedParticipants, remappedAnswersCount };
}

export function isLegacyQuizOfflineBackup(raw: unknown): raw is LegacyQuizOfflineBackupPayload {
  if (!raw || typeof raw !== 'object') {
    return false;
  }
  const obj = raw as Record<string, unknown>;
  return (
    Array.isArray(obj.quizQuestions) ||
    Array.isArray(obj.quizParticipants) ||
    typeof obj.quizSettings === 'object'
  );
}

export function isPlatformBackupPayload(raw: unknown): raw is PlatformBackupPayload {
  if (!raw || typeof raw !== 'object') {
    return false;
  }
  const obj = raw as Record<string, unknown>;
  return obj.formatVersion === 1 && Array.isArray(obj.events) && Array.isArray(obj.questions);
}

export function convertLegacyBackupToDomain(params: {
  legacy: LegacyQuizOfflineBackupPayload;
  targetEvent: EventConfig;
  random: RandomSource;
  nowIso: string;
}): {
  questions: Question[];
  updatedEvent: EventConfig;
  matches: MatchRecord[];
  prizeClaims: PrizeClaimRecord[];
  lockouts: GiveUpLockoutRecord[];
  remappedAnswersCount: number;
} {
  const { legacy, targetEvent, random, nowIso } = params;
  const { questions, remappedParticipants, remappedAnswersCount } = normalizeAndMapQuizDataIds(
    legacy.quizQuestions ?? [],
    legacy.quizParticipants ?? [],
  );

  const questionsById = new Map(questions.map((q) => [q.id, q]));

  const mergedSettings: EventSettings = {
    ...DEFAULT_SETTINGS,
    ...(legacy.quizSettings ?? {}),
    difficultyPercentages: {
      ...DEFAULT_SETTINGS.difficultyPercentages,
      ...(legacy.quizSettings?.difficultyPercentages ?? {}),
    },
  };

  let customizations = mergeEventCustomizations(
    targetEvent.customizations ?? DEFAULT_CUSTOMIZATIONS,
    legacy.quizThemeCustomizations ?? undefined,
  );
  if (legacy.quizCustomLogoFileName) {
    customizations = mergeEventCustomizations(customizations, {
      visualIdentity: { logoFileName: legacy.quizCustomLogoFileName },
    });
  }

  const updatedEvent: EventConfig = {
    ...structuredClone(targetEvent),
    startTime:
      legacy.quizCurrentEvent?.startTime !== undefined
        ? legacy.quizCurrentEvent.startTime
        : targetEvent.startTime,
    endTime:
      legacy.quizCurrentEvent?.endTime !== undefined
        ? legacy.quizCurrentEvent.endTime
        : targetEvent.endTime,
    enableOutOfPeriodMessage:
      legacy.quizCurrentEvent?.enableOutOfPeriodMessage ?? targetEvent.enableOutOfPeriodMessage,
    settings: mergedSettings,
    customizations,
    configVersion: targetEvent.configVersion + 1,
  };

  const matches: MatchRecord[] = remappedParticipants.map((participant) => {
    const matchId = random.uuid();
    const attempts = Array.isArray(participant.playerAttempts) ? participant.playerAttempts : [];
    const answers: MatchAnswer[] = attempts.map((attempt) => {
      const numericId = Number(attempt.questionId) || 0;
      const q = questionsById.get(numericId);
      const options = normalizeFourOptions(attempt.options ?? q?.options);
      const correctOptionIndex = attempt.correctOptionIndex ?? q?.correctIndex ?? 0;

      return {
        questionId: numericId,
        questionText: attempt.questionText ?? q?.text ?? '',
        options,
        selectedOptionText: attempt.selectedOptionText ?? '',
        correctOptionIndex,
        correctOptionText: attempt.correctOptionText ?? options[correctOptionIndex] ?? '',
        isCorrect: Boolean(attempt.isCorrect),
      };
    });

    return {
      id: matchId,
      eventId: updatedEvent.id,
      totemId: null,
      participantName: String(participant.name ?? 'PARTICIPANTE').trim(),
      participantPhone: String(participant.phone ?? '').trim(),
      score: Number(participant.score) || 0,
      totalQuestions: answers.length > 0 ? answers.length : mergedSettings.numberOfQuestions,
      timeSeconds: Number(participant.timeSeconds ?? participant.time) || 0,
      answers,
      playedAt: participant.playedAt ?? participant.timestamp ?? nowIso,
      syncedAt: nowIso,
    };
  });

  const legacyWinners = legacy.quizPrizeWinnersData ?? legacy.quizPrizeWinners ?? [];
  const prizeClaims: PrizeClaimRecord[] = [];
  const matchedMatchIdsWithPrize = new Set<string>();

  for (const winner of legacyWinners) {
    const phone = String(winner.phone ?? '').trim();
    if (!phone) {
      continue;
    }
    const candidateMatch =
      matches.find(
        (m) =>
          m.participantPhone === phone &&
          !matchedMatchIdsWithPrize.has(m.id) &&
          (!winner.timestamp || m.playedAt === winner.timestamp),
      ) ?? matches.find((m) => m.participantPhone === phone && !matchedMatchIdsWithPrize.has(m.id));

    if (!candidateMatch) {
      continue;
    }

    matchedMatchIdsWithPrize.add(candidateMatch.id);
    const awardedAt = winner.timestamp ?? candidateMatch.playedAt;
    prizeClaims.push({
      id: random.uuid(),
      eventId: updatedEvent.id,
      matchId: candidateMatch.id,
      totemId: null,
      participantName: candidateMatch.participantName,
      participantPhone: phone,
      status: 'delivered',
      awardedAt,
      deliveredAt: awardedAt,
    });
  }

  const legacyLockouts = legacy.quizGiveUpLockoutData ?? legacy.quizGiveUpLockout ?? [];
  const lockouts: GiveUpLockoutRecord[] = legacyLockouts
    .filter((item) => Boolean(item.phone?.trim()))
    .map((item) => ({
      id: random.uuid(),
      eventId: updatedEvent.id,
      totemId: null,
      participantPhone: item.phone!.trim(),
      lockedAt: item.lockedAt ?? nowIso,
      expiresAt: item.expiresAt ?? nowIso,
    }));

  return {
    questions,
    updatedEvent,
    matches,
    prizeClaims,
    lockouts,
    remappedAnswersCount,
  };
}
