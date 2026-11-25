import type { FormEvent } from 'react';
import { useLanguage } from '../../i18n';
import type {
  TotemLocalDiagnostics,
  TotemSessionSnapshot,
} from '../../domain/types';
import {
  TOTEM_ONLINE_STATUS_LABELS,
  formatAwardedAtPtBr,
  formatLastSeenPtBr,
} from '../formatters';

export type ActiveTotemModal =
  | { type: 'alert'; message: string }
  | { type: 'incorrect' }
  | { type: 'top3' }
  | { type: 'give-up' }
  | { type: 'pin-prompt' }
  | { type: 'diagnostics' }
  | { type: 'pairing' }
  | null;

export interface TotemModalsProps {
  activeModal: ActiveTotemModal;
  snapshot: TotemSessionSnapshot;
  showPairingModal: boolean;
  diagnostics: TotemLocalDiagnostics | null;
  activationInput: string;
  pinInput: string;
  pinError: string | null;
  diagnosticsSyncMessage: string | null;
  isForcingSync: boolean;
  localSoundMuted: boolean;
  onActivationInputChange: (value: string) => void;
  onActivateWithCodeSubmit: (e: FormEvent) => void;
  onPinInputChange: (value: string) => void;
  onPinSubmit: (e: FormEvent) => void;
  onConfirmGiveUp: () => void;
  onDismissWinnerAlready: () => void;
  onForceDiagnosticsSync: () => void;
  onToggleLocalSound: () => void;
  onCloseModal: () => void;
}

// Modais operacionais do Totem (alertas, gabarito de erros, já premiado, Top 3, desistência, pareamento e diagnóstico).
export function TotemModals({
  activeModal,
  snapshot,
  showPairingModal,
  diagnostics,
  activationInput,
  pinInput,
  pinError,
  diagnosticsSyncMessage,
  isForcingSync,
  localSoundMuted,
  onActivationInputChange,
  onActivateWithCodeSubmit,
  onPinInputChange,
  onPinSubmit,
  onConfirmGiveUp,
  onDismissWinnerAlready,
  onForceDiagnosticsSync,
  onToggleLocalSound,
  onCloseModal,
}: TotemModalsProps) {
  const texts = snapshot.event.customizations.texts;
  const { t, td, language } = useLanguage();

  return (
    <>
      {activeModal?.type === 'alert' && (
        <div
          id="alert-modal"
          className="modal-overlay"
          role="dialog"
          aria-modal="true"
          aria-labelledby="alert-modal-title"
        >
          <div className="modal-content">
            <h3 id="alert-modal-title" className="modal-title">
              {t('modal.attention')}
            </h3>
            <p id="alert-message" className="modal-text">
              {activeModal.message}
            </p>
            <button
              id="alert-ok-btn"
              type="button"
              className="btn modal-close-btn"
              onClick={onCloseModal}
            >
              {t('modal.ok')}
            </button>
          </div>
        </div>
      )}

      {activeModal?.type === 'incorrect' && snapshot.lastResult && (
        <div
          id="incorrect-answers-modal"
          className="modal-overlay"
          role="dialog"
          aria-modal="true"
          aria-labelledby="incorrect-answers-modal-title"
        >
          <div className="modal-content">
            <h3 id="incorrect-answers-modal-title" className="modal-title">
              {td(texts.modalIncorrectAnswersTitle)}
            </h3>
            <div id="incorrect-answers-list" className="modal-scrollable-content">
              {snapshot.lastResult.incorrectAnswers.map((item) => (
                <div key={item.questionId} className="question-review-item">
                  <h4>{item.questionText}</h4>
                  <p className="participant-answer">
                    <span className="review-label">{t('modal.yourAnswer')}</span>
                    <span className="review-value-participant">{item.selectedOptionText}</span>
                  </p>
                  <p className="correct-answer-review">
                    <span className="review-label">{t('modal.correctAnswer')}</span>
                    <span className="review-value-correct">{item.correctOptionText}</span>
                  </p>
                </div>
              ))}
            </div>
            <button
              id="close-incorrect-answers-modal-btn"
              type="button"
              className="btn modal-close-btn"
              onClick={onCloseModal}
            >
              {t('modal.close')}
            </button>
          </div>
        </div>
      )}

      {snapshot.alreadyWonModal && (
        <div
          id="winner-already-modal"
          className="modal-overlay"
          role="dialog"
          aria-modal="true"
          aria-labelledby="winner-already-modal-title"
        >
          <div className="modal-content">
            <h3 id="winner-already-modal-title" className="modal-title">
              {td(texts.modalAlreadyWonTitle)}
            </h3>
            <p id="winner-already-main-message" className="modal-text">
              {td(texts.modalAlreadyWonMessage)}
            </p>
            <p id="winner-already-timestamp" className="modal-timestamp">
              {formatAwardedAtPtBr(snapshot.alreadyWonModal.awardedAt, language)}
            </p>
            <button
              id="close-winner-already-modal-btn"
              type="button"
              className="btn modal-close-btn"
              onClick={onDismissWinnerAlready}
            >
              {t('modal.understood')}
            </button>
          </div>
        </div>
      )}

      {activeModal?.type === 'top3' && snapshot.lastResult && snapshot.lastResult.isTop3 && (
        <div
          id="top3-congrats-modal"
          className="modal-overlay"
          role="dialog"
          aria-modal="true"
          aria-labelledby="top3-modal-title"
        >
          <div className="modal-content">
            <h3 id="top3-modal-title" className="modal-title">
              {t('modal.top3Title')}
            </h3>
            <div id="top3-modal-message-content">
              <p>
                {t('modal.top3Congrats', { name: snapshot.lastResult.participantName })}
              </p>
              <p>{t('modal.top3Message')}</p>
              <p>
                <span className="msg-rank-highlight">
                  TOP {snapshot.lastResult.rankingPosition}
                </span>
              </p>
            </div>
            <button
              id="close-top3-congrats-modal-btn"
              type="button"
              className="btn modal-close-btn"
              onClick={onCloseModal}
            >
              {t('modal.top3Ok')}
            </button>
          </div>
        </div>
      )}

      {activeModal?.type === 'give-up' && (
        <div
          id="confirm-modal"
          className="modal-overlay modal-type-danger"
          role="dialog"
          aria-modal="true"
          aria-labelledby="confirm-modal-title"
        >
          <div className="modal-content">
            <h3 id="confirm-modal-title" className="modal-title">
              {t('modal.confirmTitle')}
            </h3>
            <p id="confirm-message" className="modal-text">
              {t('modal.giveUpMessage')}
            </p>
            <div className="modal-actions">
              <button
                id="confirm-proceed-btn"
                type="button"
                className="btn btn-danger"
                onClick={onConfirmGiveUp}
              >
                {t('modal.leave')}
              </button>
              <button
                id="confirm-cancel-btn"
                type="button"
                className="btn-secondary"
                onClick={onCloseModal}
              >
                {t('modal.cancel')}
              </button>
            </div>
          </div>
        </div>
      )}

      {showPairingModal && (
        <div
          id="totem-pairing-modal"
          className="modal-overlay"
          role="dialog"
          aria-modal="true"
          aria-labelledby="totem-pairing-title"
        >
          <div className="modal-content">
            <h3 id="totem-pairing-title" className="modal-title">
              Pareamento do Totem
            </h3>
            <p className="modal-text">
              Autorize este código no Painel Administrativo para vincular o Totem a um Evento:
            </p>
            <p className="totem-pairing-code-box">
              <strong id="totem-pairing-code">{snapshot.pairing.pairingCode ?? '------'}</strong>
            </p>

            <form className="totem-modal-form" onSubmit={onActivateWithCodeSubmit}>
              <div className="form-group">
                <label htmlFor="totem-activation-input">Código ou Link de Ativação</label>
                <input
                  id="totem-activation-input"
                  type="text"
                  value={activationInput}
                  onChange={(e) => onActivationInputChange(e.target.value)}
                  placeholder="Ex.: ABC123 ou ?pairingCode=ABC123"
                />
              </div>

              {snapshot.lastValidationError && (
                <p className="totem-modal-error" role="alert">
                  {snapshot.lastValidationError}
                </p>
              )}

              <div className="modal-actions">
                <button id="totem-activate-code-btn" type="submit" className="btn">
                  Ativar com Código
                </button>
                {activeModal?.type === 'pairing' &&
                  snapshot.pairing.status !== 'awaiting_authorization' && (
                    <button type="button" className="btn-secondary" onClick={onCloseModal}>
                      Fechar
                    </button>
                  )}
              </div>
            </form>
          </div>
        </div>
      )}

      {activeModal?.type === 'pin-prompt' && (
        <div
          id="totem-pin-modal"
          className="modal-overlay"
          role="dialog"
          aria-modal="true"
          aria-labelledby="totem-pin-title"
        >
          <div className="modal-content">
            <h3 id="totem-pin-title" className="modal-title">
              Acesso ao Diagnóstico Local
            </h3>
            <p className="modal-text">
              Informe o PIN numérico rápido configurado para este Totem:
            </p>
            <form className="totem-modal-form" onSubmit={onPinSubmit}>
              <div className="form-group">
                <label htmlFor="totem-pin-input">PIN do Totem</label>
                <input
                  id="totem-pin-input"
                  type="password"
                  inputMode="numeric"
                  autoComplete="off"
                  value={pinInput}
                  onChange={(e) => onPinInputChange(e.target.value)}
                />
              </div>

              {pinError && (
                <p id="totem-pin-error" className="totem-modal-error" role="alert">
                  {pinError}
                </p>
              )}

              <div className="modal-actions">
                <button id="totem-pin-submit-btn" type="submit" className="btn">
                  Acessar Diagnóstico
                </button>
                <button
                  id="totem-pin-cancel-btn"
                  type="button"
                  className="btn-secondary"
                  onClick={onCloseModal}
                >
                  Cancelar
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {activeModal?.type === 'diagnostics' && diagnostics && (
        <div
          id="totem-diagnostics-modal"
          className="modal-overlay"
          role="dialog"
          aria-modal="true"
          aria-labelledby="totem-diagnostics-title"
        >
          <div className="modal-content">
            <h3 id="totem-diagnostics-title" className="modal-title">
              Diagnóstico Local do Totem
            </h3>

            <dl className="totem-diagnostics-list">
              <div>
                <dt>Status de Conexão</dt>
                <dd id="diagnostics-connection-status">
                  {TOTEM_ONLINE_STATUS_LABELS[diagnostics.isOnline ? 'online' : 'offline']}
                </dd>
              </div>
              <div>
                <dt>Evento Atual</dt>
                <dd id="diagnostics-event-name">
                  {diagnostics.eventName} (v{diagnostics.configVersion})
                </dd>
              </div>
              <div>
                <dt>Totem</dt>
                <dd id="diagnostics-totem-name">
                  {diagnostics.totemName ?? 'Não vinculado'}
                </dd>
              </div>
              <div>
                <dt>Código do Totem</dt>
                <dd id="diagnostics-totem-code">
                  {diagnostics.pairingCode ?? diagnostics.totemId ?? 'Não pareado'}
                </dd>
              </div>
              <div>
                <dt>Itens pendentes na syncQueue</dt>
                <dd id="diagnostics-pending-sync">{diagnostics.pendingSyncCount}</dd>
              </div>
              <div>
                <dt>Último Ping</dt>
                <dd id="diagnostics-last-ping">
                  {formatLastSeenPtBr(diagnostics.lastHeartbeatAt)}
                </dd>
              </div>
              <div>
                <dt>Área visível (viewport)</dt>
                <dd id="diagnostics-viewport">{describeViewport()}</dd>
              </div>
              <div>
                <dt>Tela física / zoom</dt>
                <dd id="diagnostics-screen">{describeScreen()}</dd>
              </div>
            </dl>

            {diagnosticsSyncMessage && (
              <p id="diagnostics-sync-status" className="modal-text" role="status">
                {diagnosticsSyncMessage}
              </p>
            )}

            <div className="modal-actions">
              <button
                id="diagnostics-toggle-sound-btn"
                type="button"
                className="btn-secondary"
                onClick={onToggleLocalSound}
              >
                {localSoundMuted ? 'Ativar Som Local' : 'Silenciar Som Local'}
              </button>
              <button
                id="diagnostics-force-sync-btn"
                type="button"
                className="btn"
                disabled={isForcingSync}
                onClick={onForceDiagnosticsSync}
              >
                {isForcingSync ? 'Sincronizando...' : 'Forçar Sincronização'}
              </button>
              <button
                id="close-diagnostics-modal-btn"
                type="button"
                className="btn-secondary"
                onClick={onCloseModal}
              >
                Fechar Diagnóstico
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

// Ajuda a descobrir por que a TV corta a imagem: compara a área que o navegador diz ter com a tela real.
function describeViewport(): string {
  if (typeof window === 'undefined') {
    return '-';
  }
  return `${window.innerWidth} × ${window.innerHeight} px`;
}

function describeScreen(): string {
  if (typeof window === 'undefined') {
    return '-';
  }
  const ratio = Math.round(window.devicePixelRatio * 100) / 100;
  return `${window.screen.width} × ${window.screen.height} px · zoom ${ratio}×`;
}
