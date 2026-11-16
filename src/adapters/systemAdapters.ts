import type { Clock, RandomSource } from '../domain/ports';

// Implementação padrão de relógio usando a hora do sistema.
export class SystemClock implements Clock {
  now(): number {
    return Date.now();
  }

  toISOString(ms?: number): string {
    return new Date(ms ?? this.now()).toISOString();
  }
}

// Implementação padrão de aleatoriedade usando Math.random e Fisher-Yates.
export class CryptoRandomSource implements RandomSource {
  next(): number {
    return Math.random();
  }

  shuffle<T>(items: readonly T[]): T[] {
    const copy = [...items];
    for (let i = copy.length - 1; i > 0; i--) {
      const j = Math.floor(this.next() * (i + 1));
      const temp = copy[i];
      copy[i] = copy[j];
      copy[j] = temp;
    }
    return copy;
  }

  uuid(): string {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
    // Fallback determinístico em formato UUID v4 para ambientes sem Web Crypto completo.
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (char) => {
      const r = Math.floor(this.next() * 16);
      const v = char === 'x' ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  }
}
