import type {
  DifficultyLevel,
  PrizeClaimStatus,
  TotemOnlineStatus,
  TotemScreenId,
} from '../domain/types';

export const DIFFICULTY_LABELS: Record<DifficultyLevel, string> = {
  facil: 'Fácil',
  moderado: 'Moderado',
  dificil: 'Difícil',
};

export const PRIZE_STATUS_LABELS: Record<PrizeClaimStatus, string> = {
  delivered: 'Entregue',
  awaiting_pickup: 'Aguardando Retirada',
  revoked: 'Revogado',
  offline_duplicate_conflict: 'Conflito Offline',
};

export const TOTEM_SCREEN_LABELS: Record<TotemScreenId, string> = {
  'idle-screen': 'Descanso',
  'initial-screen': 'Inicial',
  'quiz-screen': 'Em Partida',
  'result-screen': 'Resultado',
  'ranking-screen': 'Ranking',
};

export const TOTEM_ONLINE_STATUS_LABELS: Record<TotemOnlineStatus, string> = {
  online: 'Online',
  offline: 'Offline',
};

// Formata quantidade inteira de segundos no padrão MM:SS.
export function formatTimeMMSS(totalSeconds: number): string {
  if (!Number.isFinite(totalSeconds) || totalSeconds < 0) {
    return '00:00';
  }
  const wholeSeconds = Math.floor(totalSeconds);
  const minutes = Math.floor(wholeSeconds / 60);
  const seconds = wholeSeconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

// Formata data/hora ISO para exibição amigável na Trava de Brinde (dd/MM/yyyy às HH:mm).
export function formatAwardedAtPtBr(isoString: string): string {
  const dateObj = new Date(isoString);
  if (Number.isNaN(dateObj.getTime())) {
    return isoString;
  }
  const datePart = dateObj.toLocaleDateString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
  const timePart = dateObj.toLocaleTimeString('pt-BR', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  return `Participação em: ${datePart} às ${timePart}`;
}

// Formata horário do último ping/heartbeat de um Totem ou indica ausência de ping.
export function formatLastSeenPtBr(isoString: string | null): string {
  if (!isoString) {
    return 'Sem ping registrado';
  }
  const dateObj = new Date(isoString);
  if (Number.isNaN(dateObj.getTime())) {
    return isoString;
  }
  return dateObj.toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
}
