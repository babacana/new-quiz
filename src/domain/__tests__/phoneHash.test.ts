import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { hashEventPhone, resolveLockoutPhoneHash, resolvePrizeClaimPhoneHash, sha256Hex } from '../phoneHash';

function nodeSha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

describe('phoneHash', () => {
  it('calcula digest SHA-256 idêntico ao crypto nativo do Node para ASCII e UTF-8', () => {
    const samples = [
      '',
      'abc',
      'event-1::61999998888',
      'Evento Caésb Água Pura 🚀 :: Brasília-DF',
      'a'.repeat(55),
      'a'.repeat(56),
      'a'.repeat(64),
      'a'.repeat(130),
    ];

    for (const input of samples) {
      expect(sha256Hex(input)).toBe(nodeSha256(input));
    }
  });

  it('gera hash salgado com eventId normalizando apenas os dígitos do telefone', () => {
    const hashFormatted = hashEventPhone('evt-2026', '(61) 99999-1234');
    const hashDigits = hashEventPhone('evt-2026', '61999991234');
    const hashOtherEvent = hashEventPhone('evt-2027', '61999991234');

    expect(hashFormatted).toBe(hashDigits);
    expect(hashFormatted).toBe(nodeSha256('evt-2026::61999991234'));
    expect(hashOtherEvent).not.toBe(hashFormatted);
  });

  it('resolve phoneHash priorizando hash já presente em Trava de Brinde e Bloqueio', () => {
    const explicitHash = 'deadbeef'.repeat(8);
    expect(
      resolvePrizeClaimPhoneHash({
        eventId: 'evt-1',
        phoneHash: explicitHash,
        participantPhone: '(61) 99999-0000',
      }),
    ).toBe(explicitHash);

    expect(
      resolvePrizeClaimPhoneHash({
        eventId: 'evt-1',
        participantPhone: '(61) 99999-0000',
      }),
    ).toBe(hashEventPhone('evt-1', '61999990000'));

    expect(
      resolveLockoutPhoneHash({
        eventId: 'evt-1',
        participantPhone: '(61) 98888-1111',
      }),
    ).toBe(hashEventPhone('evt-1', '61988881111'));
  });
});
