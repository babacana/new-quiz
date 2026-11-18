import {
  buildTotemActivationLink,
  generateShortPairingCode,
  normalizePairingCode,
} from '../pairingUtils';
import type {
  AuthorizeTotemPairingInput,
  DispatchRemoteCommandInput,
  RemoteCommandPayload,
  TotemChannelEvent,
  TotemRecord,
} from '../types';
import type { AdminDomainContext } from './adminContext';

const TOTEM_HEARTBEAT_STALE_MS = 90_000;

// Módulo de domínio responsável por Pareamento de Totens, monitoramento ao vivo e comandos remotos.
export class TotemFleetModule {
  private readonly ctx: AdminDomainContext;

  constructor(ctx: AdminDomainContext) {
    this.ctx = ctx;
  }

  async authorizeTotemPairing(input: AuthorizeTotemPairingInput): Promise<TotemRecord> {
    this.ctx.auth.requireAdmin();

    const name = input.name.trim();
    if (!name) {
      throw new Error('O nome do Totem é obrigatório.');
    }

    const pinCode = input.pinCode.trim();
    if (!/^\d{4,8}$/.test(pinCode)) {
      throw new Error('O PIN local do Totem deve conter entre 4 e 8 dígitos numéricos.');
    }

    const events = await this.ctx.cloudGateway.listEvents();
    if (!events.some((ev) => ev.id === input.eventId)) {
      throw new Error('Evento selecionado para Pareamento não encontrado.');
    }

    const pairingCode = input.pairingCode?.trim()
      ? normalizePairingCode(input.pairingCode)
      : generateShortPairingCode(this.ctx.random, 6);
    if (!/^[A-Z0-9]{4,12}$/.test(pairingCode)) {
      throw new Error(
        'Código de Pareamento inválido. Utilize de 4 a 12 caracteres alfanuméricos.',
      );
    }

    return this.ctx.cloudGateway.authorizeTotemPairing({
      id: this.ctx.random.uuid(),
      pairingCode,
      deviceToken: this.ctx.random.uuid(),
      name,
      pinCode,
      eventId: input.eventId,
    });
  }

  buildTotemActivationLink(pairingCode: string, baseOrigin = ''): string {
    return buildTotemActivationLink(pairingCode, baseOrigin);
  }

  async listTotems(): Promise<TotemRecord[]> {
    this.ctx.auth.requireAdmin();
    const totems = await this.ctx.cloudGateway.listTotems();
    const nowMs = this.ctx.clock ? this.ctx.clock.now() : Date.now();
    return totems.map((totem) => {
      if (totem.onlineStatus !== 'online' || !totem.lastSeenAt) {
        return totem;
      }
      const lastSeenMs = Date.parse(totem.lastSeenAt);
      if (Number.isFinite(lastSeenMs) && nowMs - lastSeenMs > TOTEM_HEARTBEAT_STALE_MS) {
        return {
          ...totem,
          onlineStatus: 'offline',
        };
      }
      return totem;
    });
  }

  subscribeTotemUpdates(listener: (event: TotemChannelEvent) => void): () => void {
    return this.ctx.cloudGateway.subscribeTotemChannel(listener);
  }

  async deleteTotemsInBatch(totemIds: string[]): Promise<string[]> {
    this.ctx.auth.requireAdmin();
    const normalizedIds = Array.from(
      new Set(totemIds.map((id) => id.trim()).filter(Boolean)),
    );
    if (normalizedIds.length === 0) {
      throw new Error('Selecione ao menos um Totem para exclusão.');
    }
    return this.ctx.cloudGateway.deleteTotems(normalizedIds);
  }

  async deleteTotem(totemId: string): Promise<void> {
    await this.deleteTotemsInBatch([totemId]);
  }

  async dispatchRemoteCommand(input: DispatchRemoteCommandInput): Promise<RemoteCommandPayload> {
    this.ctx.auth.requireAdmin();

    if (!input.targetTotemId && !input.targetEventId) {
      throw new Error('Informe um Totem ou Evento de destino para o comando remoto.');
    }

    let targetConfigVersion: number | undefined;
    if (input.type === 'SWITCH_EVENT') {
      if (!input.eventId) {
        throw new Error('Informe o Evento de destino para trocar.');
      }
      const events = await this.ctx.cloudGateway.listEvents();
      const targetEvent = events.find((ev) => ev.id === input.eventId);
      if (!targetEvent) {
        throw new Error(`Evento de destino não encontrado (${input.eventId}).`);
      }
      targetConfigVersion = targetEvent.configVersion;
    }

    const command: RemoteCommandPayload = {
      id: this.ctx.random.uuid(),
      type: input.type,
      targetTotemId: input.targetTotemId ?? null,
      targetEventId: input.targetEventId ?? null,
      eventId: input.eventId,
      targetScreen: input.targetScreen,
      configVersion: targetConfigVersion,
      issuedAt: this.ctx.nowIso(),
    };

    return this.ctx.cloudGateway.dispatchRemoteCommand(command);
  }

  async switchTotemEvent(
    target: { totemId?: string; eventId?: string },
    newEventId: string,
  ): Promise<RemoteCommandPayload> {
    return this.dispatchRemoteCommand({
      type: 'SWITCH_EVENT',
      targetTotemId: target.totemId ?? null,
      targetEventId: target.eventId ?? null,
      eventId: newEventId,
      targetScreen: 'initial-screen',
    });
  }

  async forceSyncTotems(
    target: { totemId?: string; eventId?: string },
  ): Promise<RemoteCommandPayload> {
    return this.dispatchRemoteCommand({
      type: 'FORCE_SYNC',
      targetTotemId: target.totemId ?? null,
      targetEventId: target.eventId ?? null,
    });
  }

  async reloadTotemScreen(
    target: { totemId?: string; eventId?: string },
    targetScreen: 'initial-screen' | 'idle-screen' = 'initial-screen',
  ): Promise<RemoteCommandPayload> {
    return this.dispatchRemoteCommand({
      type: 'RELOAD_SCREEN',
      targetTotemId: target.totemId ?? null,
      targetEventId: target.eventId ?? null,
      targetScreen,
    });
  }
}
