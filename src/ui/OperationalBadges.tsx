import type { OfflinePrizeConflictAlert, PrizeClaimStatus } from '../domain/types';
import { PRIZE_STATUS_LABELS } from './formatters';

export interface ParticipantStatusBadgesProps {
  prizeStatus: PrizeClaimStatus | null;
  hasOfflineConflict: boolean;
  hasActiveGiveUpLockout: boolean;
  showEmptyPrizeBadge?: boolean;
}

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
        <span className={`admin-badge prize-badge-${prizeStatus}`}>
          {PRIZE_STATUS_LABELS[prizeStatus]}
        </span>
      ) : (
        showEmptyPrizeBadge && <span className="admin-badge closed">Sem Brinde</span>
      )}
      {hasOfflineConflict && <span className="admin-badge conflict-badge">Conflito Offline</span>}
      {hasActiveGiveUpLockout && <span className="admin-badge lockout-badge">Bloqueado</span>}
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
    <div className="admin-alert-conflict" role="alert">
      <h4>Conflito de Premiação Offline ({conflicts.length})</h4>
      <p>
        Mais de um Totem premiou o mesmo telefone offline. Entregue apenas 1 Brinde para o telefone
        no Evento.
      </p>
      <div className="operator-conflict-list">
        {conflicts.map((conflict) => (
          <div
            key={`${conflict.eventId}-${conflict.participantPhone}`}
            className="operator-conflict-item"
          >
            <div>
              <strong>{conflict.participantName}</strong> · {conflict.participantPhone} ·{' '}
              {conflict.eventName}
              <div className="operator-card-meta">
                Status principal:{' '}
                {conflict.activePrizeStatus
                  ? PRIZE_STATUS_LABELS[conflict.activePrizeStatus]
                  : 'Sem Brinde ativo'}
                {' · '}
                Partidas envolvidas: {conflict.activeMatchId ?? 'n/d'} e{' '}
                {conflict.conflictClaims.map((c) => c.matchId).join(', ')}
              </div>
            </div>
            <div className="operator-card-actions">
              {conflict.activeClaimId && conflict.activePrizeStatus === 'awaiting_pickup' && (
                <button
                  type="button"
                  className="admin-btn admin-btn-primary operator-tap-btn"
                  onClick={() =>
                    onConfirmDelivery(conflict.activeClaimId!, conflict.participantName)
                  }
                >
                  {confirmButtonLabel}
                </button>
              )}
              {onRevokePhone && (
                <button
                  type="button"
                  className="admin-btn admin-btn-secondary"
                  onClick={() =>
                    onRevokePhone(
                      conflict.eventId,
                      conflict.participantPhone,
                      conflict.participantName,
                    )
                  }
                >
                  Despremiar
                </button>
              )}
              {onFilterConflicts && (
                <button
                  type="button"
                  className="admin-btn admin-btn-secondary"
                  onClick={onFilterConflicts}
                >
                  Filtrar Conflitos
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
