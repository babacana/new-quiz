import type { PrizeClaimStatus } from './types';

// Extrai apenas dígitos numéricos de um telefone para buscas e comparações tolerantes à máscara.
export function normalizePhoneDigits(phone: string): string {
  return phone.replace(/\D/g, '');
}

// Verifica se nome ou telefone correspondem à busca textual ou numérica informada.
export function matchesParticipantSearch(name: string, phone: string, search: string): boolean {
  const query = search.trim().toLowerCase();
  if (!query) {
    return true;
  }
  if (name.toLowerCase().includes(query) || phone.toLowerCase().includes(query)) {
    return true;
  }
  const queryDigits = normalizePhoneDigits(query);
  return queryDigits.length > 0 && normalizePhoneDigits(phone).includes(queryDigits);
}

// Chave composta determinística para indexação por Evento e telefone de Participante.
export function toEventPhoneKey(eventId: string, participantPhone: string): string {
  return `${eventId}::${participantPhone}`;
}

// Verifica se um registro de Brinde representa premiação ativa (entregue ou aguardando retirada).
export function isActivePrizeClaim(claim: { status: PrizeClaimStatus }): boolean {
  return claim.status === 'delivered' || claim.status === 'awaiting_pickup';
}

// Ordena Partidas para Ranking: maior pontuação, menor tempo gasto e desempate cronológico.
export function sortRankingMatches<
  T extends { score: number; timeSeconds: number; playedAt: string },
>(matches: readonly T[]): T[] {
  return [...matches].sort(
    (a, b) =>
      b.score - a.score ||
      a.timeSeconds - b.timeSeconds ||
      a.playedAt.localeCompare(b.playedAt),
  );
}

// Converte string YYYY-MM-DD ou ISO em timestamp de início/fim de dia para filtros de período.
export function parseDateBoundary(
  dateStr: string | undefined,
  bound: 'start' | 'end',
): number | null {
  if (!dateStr) {
    return null;
  }
  if (dateStr.includes('T')) {
    const parsed = Date.parse(dateStr);
    return Number.isFinite(parsed) ? parsed : null;
  }
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr.trim());
  if (!match) {
    const fallback = Date.parse(dateStr);
    return Number.isFinite(fallback) ? fallback : null;
  }
  const [, year, month, day] = match;
  return bound === 'start'
    ? new Date(Number(year), Number(month) - 1, Number(day), 0, 0, 0, 0).getTime()
    : new Date(Number(year), Number(month) - 1, Number(day), 23, 59, 59, 999).getTime();
}

// Pagina listas em memória preservando limites seguros de página e tamanho.
export function paginateItems<T>(
  items: readonly T[],
  requestedPage = 1,
  requestedPageSize = 20,
): {
  items: T[];
  totalItems: number;
  totalPages: number;
  currentPage: number;
  pageSize: number;
} {
  const pageSize = Math.max(1, Math.floor(requestedPageSize));
  const totalItems = items.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
  const currentPage = Math.min(Math.max(1, Math.floor(requestedPage)), totalPages);
  const startIndex = (currentPage - 1) * pageSize;

  return {
    items: items.slice(startIndex, startIndex + pageSize),
    totalItems,
    totalPages,
    currentPage,
    pageSize,
  };
}

// Calcula o novo expiresAt ISO para encerrar um bloqueio por desistência considerando skew de relógio.
export function computeExpiredLockoutIso(
  lockedAt: string,
  expiresAt: string,
  nowMs: number,
): string | null {
  const lockedMs = Date.parse(lockedAt);
  const targetMs = Number.isFinite(lockedMs) ? Math.min(lockedMs, nowMs) : nowMs;
  const currentExpiresMs = Date.parse(expiresAt);
  if (Number.isFinite(currentExpiresMs) && currentExpiresMs <= targetMs) {
    return null;
  }
  return new Date(targetMs).toISOString();
}

// Seleciona no máximo 1 Brinde Aguardando Retirada entregável por telefone em cada Evento.
export function selectDeliverableClaimIds<
  T extends { id: string; eventId: string; participantPhone: string; status: PrizeClaimStatus },
>(candidates: readonly T[], alreadyDeliveredKeys: Set<string>): string[] {
  const eligibleIds: string[] = [];
  for (const candidate of candidates) {
    if (candidate.status !== 'awaiting_pickup') {
      continue;
    }
    const key = toEventPhoneKey(candidate.eventId, candidate.participantPhone);
    if (alreadyDeliveredKeys.has(key)) {
      continue;
    }
    alreadyDeliveredKeys.add(key);
    eligibleIds.push(candidate.id);
  }
  return eligibleIds;
}
