import type { OfflinePrizeConflictAlert, PrizeClaimStatus } from '../domain/types';
import { Button } from './components/ui/button';
import { PRIZE_STATUS_LABELS } from './formatters';
import { cn } from './lib/utils';

export interface ParticipantStatusBadgesProps {
  prizeStatus: PrizeClaimStatus | null;
  hasOfflineConflict: boolean;
  hasActiveGiveUpLockout: boolean;
  showEmptyPrizeBadge?: boolean;
}

const BADGE_BASE_CLASS =
  'inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium';

const PRIZE_STATUS_BADGE_CLASS: Record<PrizeClaimStatus, string> = {
  delivered: 'border-emerald-500/30 bg-emerald-500/15 text-emerald-800 dark:text-emerald-300',
  awaiting_pickup: 'border-amber-500/30 bg-amber-500/15 text-amber-800 dark:text-amber-300',
  revoked: 'border-border bg-muted text-muted-foreground',
  offline_duplicate_conflict: 'border-destructive/30 bg-destructive/15 text-destructive',
};

// Emblemas padronizados de status do Brinde, Conflito Offline e Bloqueio por Desistência.
export function ParticipantStatusBadges({
  prizeStatus,
  hasOfflineConflict,
  hasActiveGiveUpLockout,
  showEmptyPrizeBadge = false,
}: ParticipantStatusBadgesProps) {
  return (
    <>
      {prizeStatus ? (
        <span className={cn(BADGE_BASE_CLASS, PRIZE_STATUS_BADGE_CLASS[prizeStatus])}>
          {PRIZE_STATUS_LABELS[prizeStatus]}
        </span>
      ) : (
        showEmptyPrizeBadge && (
          <span className={cn(BADGE_BASE_CLASS, 'border-border bg-muted text-muted-foreground')}>
            Sem Brinde
          </span>
        )
      )}
      {hasOfflineConflict && (
        <span
          className={cn(
            BADGE_BASE_CLASS,
            'border-destructive/40 bg-destructive/15 text-destructive',
          )}
        >
          Conflito Offline
        </span>
      )}
      {hasActiveGiveUpLockout && (
        <span
          className={cn(
            BADGE_BASE_CLASS,
            'border-orange-500/30 bg-orange-500/15 text-orange-800 dark:text-orange-300',
          )}
        >
          Bloqueado
        </span>
      )}
    </>
  );
}

export interface OfflineConflictBannerProps {
  conflicts: OfflinePrizeConflictAlert[];
  confirmButtonLabel: string;
  onConfirmDelivery: (claimId: string, participantName: string) => void;
  onRevokePhone?: (eventId: string, phone: string, participantName: string) => void;
  onFilterConflicts?: () => void;
}

// Alerta compartilhado para Conflito de Premiação Offline entre Operador e Relatórios do Admin.
export function OfflineConflictBanner({
  conflicts,
  confirmButtonLabel,
  onConfirmDelivery,
  onRevokePhone,
  onFilterConflicts,
}: OfflineConflictBannerProps) {
  if (conflicts.length === 0) {
    return null;
  }

  return (
    <div
      className="space-y-3 rounded-lg border border-destructive/40 bg-destructive/10 p-4 text-foreground"
      role="alert"
    >
      <div className="space-y-1">
        <h4 className="text-sm font-semibold text-destructive">
          Conflito de Premiação Offline ({conflicts.length})
        </h4>
        <p className="text-xs text-muted-foreground">
          Mais de um Totem premiou o mesmo telefone offline. Entregue apenas 1 Brinde para o
          telefone no Evento.
        </p>
      </div>
      <div className="space-y-2.5">
        {conflicts.map((conflict) => (
          <div
            key={`${conflict.eventId}-${conflict.participantPhone}`}
            className="flex flex-col gap-2 rounded-md border border-border bg-card p-3 sm:flex-row sm:items-center sm:justify-between"
          >
            <div className="min-w-0">
              <div className="text-sm font-medium text-card-foreground">
                <strong>{conflict.participantName}</strong> · {conflict.participantPhone} ·{' '}
                {conflict.eventName}
              </div>
              <div className="mt-0.5 text-xs text-muted-foreground">
                Status principal:{' '}
                {conflict.activePrizeStatus
                  ? PRIZE_STATUS_LABELS[conflict.activePrizeStatus]
                  : 'Sem Brinde ativo'}
                {' · '}
                Partidas envolvidas: {conflict.activeMatchId ?? 'n/d'} e{' '}
                {conflict.conflictClaims.map((c) => c.matchId).join(', ')}
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {conflict.activeClaimId && conflict.activePrizeStatus === 'awaiting_pickup' && (
                <Button
                  type="button"
                  size="sm"
                  onClick={() =>
                    onConfirmDelivery(conflict.activeClaimId!, conflict.participantName)
                  }
                >
                  {confirmButtonLabel}
                </Button>
              )}
              {onRevokePhone && (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() =>
                    onRevokePhone(
                      conflict.eventId,
                      conflict.participantPhone,
                      conflict.participantName,
                    )
                  }
                >
                  Despremiar
                </Button>
              )}
              {onFilterConflicts && (
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  onClick={onFilterConflicts}
                >
                  Filtrar Conflitos
                </Button>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
