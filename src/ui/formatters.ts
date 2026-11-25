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
export function formatAwardedAtPtBr(isoString: string, language: 'pt' | 'en' | 'es' = 'pt'): string {
  const dateObj = new Date(isoString);
  if (Number.isNaN(dateObj.getTime())) {
    return isoString;
  }
  const locale = language === 'pt' ? 'pt-BR' : language === 'en' ? 'en-US' : 'es-ES';
  const datePart = dateObj.toLocaleDateString(locale, {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
  const timePart = dateObj.toLocaleTimeString(locale, {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  const templates = {
    pt: `Participação em: ${datePart} às ${timePart}`,
    en: `Played on: ${datePart} at ${timePart}`,
    es: `Participación el: ${datePart} a las ${timePart}`,
  };
  return templates[language];
}

// Formata data/hora ISO em pt-BR (dd/MM/yyyy HH:mm:ss).
export function formatDateTimePtBr(isoString: string | null, fallback = '-'): string {
  if (!isoString) {
    return fallback;
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

// Formata horário do último ping/heartbeat de um Totem ou indica ausência de ping.
export function formatLastSeenPtBr(isoString: string | null): string {
  return formatDateTimePtBr(isoString, 'Sem ping registrado');
}

// Dispara download local de texto (CSV/JSON) no navegador com proteção para ambientes sem objectURL.
export function triggerFileDownload(filename: string, content: string | ArrayBuffer, mimeType: string): void {
  if (typeof URL.createObjectURL !== 'function') {
    return;
  }
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  if (typeof URL.revokeObjectURL === 'function') {
    URL.revokeObjectURL(url);
  }
}
