import type { AdminCloudPort, Clock, RandomSource } from '../ports';
import type { AuthSession } from '../types';

// Contrato de sessão e permissões compartilhado entre os módulos internos de gestão.
export interface AdminAuthGate {
  getSession(): AuthSession | null;
  requireAuthenticated(): AuthSession;
  requireStaff(): AuthSession;
  requireAdmin(): AuthSession;
}

// Contexto compartilhado de infraestrutura e autorização para os módulos administrativos.
export interface AdminDomainContext {
  readonly cloudGateway: AdminCloudPort;
  readonly clock?: Clock;
  readonly random: RandomSource;
  readonly auth: AdminAuthGate;
  nowIso(): string;
}

// Escapa um valor escalar conforme RFC 4180 para exportação CSV sem quebra de colunas.
export function escapeCsvField(value: string | number | boolean): string {
  const str = String(value);
  if (/[",\r\n]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}
