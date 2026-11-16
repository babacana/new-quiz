import type { RandomSource } from './ports';

export const PAIRING_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

// Normaliza códigos curtos de Pareamento removendo espaços e convertendo para maiúsculas.
export function normalizePairingCode(raw: string): string {
  return raw.trim().toUpperCase();
}

// Gera um código curto alfanumérico legível (sem I, O, 0 ou 1) usando a fonte de aleatoriedade injetada.
export function generateShortPairingCode(random: RandomSource, length = 6): string {
  let code = '';
  for (let i = 0; i < length; i += 1) {
    const idx =
      Math.floor(random.next() * PAIRING_CODE_ALPHABET.length) % PAIRING_CODE_ALPHABET.length;
    code += PAIRING_CODE_ALPHABET[idx];
  }
  return code;
}

// Extrai o código de Pareamento a partir de texto bruto ou URL/query/hash de link de ativação.
export function extractPairingCodeFromInput(codeOrLink: string): string {
  const trimmed = codeOrLink.trim();
  if (!trimmed) {
    return '';
  }
  const queryOrHashMatch = trimmed.match(/[?&#](?:pairingCode|pairing|code)=([^&#]+)/i);
  if (queryOrHashMatch?.[1]) {
    return normalizePairingCode(decodeURIComponent(queryOrHashMatch[1]));
  }
  return normalizePairingCode(trimmed);
}

// Monta o link completo de ativação para o código de Pareamento informado.
export function buildTotemActivationLink(pairingCode: string, baseOrigin = ''): string {
  const cleanOrigin = baseOrigin.replace(/\/+$/, '');
  return `${cleanOrigin}/?pairingCode=${encodeURIComponent(normalizePairingCode(pairingCode))}`;
}
