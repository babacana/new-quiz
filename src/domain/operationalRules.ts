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
