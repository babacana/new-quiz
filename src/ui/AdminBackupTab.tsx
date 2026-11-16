import { useState } from 'react';
import type { EventAdminController } from '../domain/eventAdminController';
import type { BackupRestoreResult, EventConfig } from '../domain/types';
import { triggerFileDownload } from './formatters';

export interface AdminBackupTabProps {
  controller: EventAdminController;
  events: EventConfig[];
  onWorkspaceRestored: () => Promise<void>;
  onStatusMessage: (type: 'success' | 'error', message: string) => void;
}

// Aba de Backup Completo (JSON) e Migração Nativa de Backups Legados do quiz-offline.
export function AdminBackupTab({
  controller,
  events,
  onWorkspaceRestored,
  onStatusMessage,
}: AdminBackupTabProps) {
  const [targetEventId, setTargetEventId] = useState<string>(
    () => events.find((ev) => ev.isActive)?.id ?? events[0]?.id ?? '',
  );
  const [pendingJson, setPendingJson] = useState<string | null>(null);
  const [pendingFileName, setPendingFileName] = useState<string>('');
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [lastResult, setLastResult] = useState<BackupRestoreResult | null>(null);
  const [busy, setBusy] = useState(false);

  const handleExportBackup = async () => {
    setBusy(true);
    try {
      const json = await controller.exportFullBackup();
      triggerFileDownload(
        'backup-completo-new-quiz.json',
        json,
        'application/json;charset=utf-8',
      );
      onStatusMessage('success', 'Backup completo exportado em JSON.');
    } catch (error) {
      onStatusMessage(
        'error',
        error instanceof Error ? error.message : 'Erro ao exportar backup completo.',
      );
    } finally {
      setBusy(false);
    }
  };

  const handleFileSelected = async (file: File | null) => {
    if (!file) {
      setPendingJson(null);
      setPendingFileName('');
      return;
    }
    const content =
      typeof file.text === 'function'
        ? await file.text()
        : await new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : '');
            reader.onerror = () => reject(new Error('Falha ao ler arquivo JSON selecionado.'));
            reader.readAsText(file);
          });
    setPendingJson(content);
    setPendingFileName(file.name);
  };

  const handleConfirmRestore = async () => {
    if (!pendingJson) {
      return;
    }
    setConfirmOpen(false);
    setBusy(true);
    try {
      const result = await controller.restoreBackup(pendingJson, {
        targetEventId: targetEventId || undefined,
      });
      setLastResult(result);
      await onWorkspaceRestored();
      onStatusMessage(
        'success',
        result.sourceFormat === 'legacy_quiz_offline'
          ? `Backup legado migrado: ${result.importedQuestionsCount} questão(ões), ${result.remappedAnswersCount} resposta(s) remapeada(s) e ${result.importedMatchesCount} Partida(s).`
          : `Backup restaurado: ${result.importedEventsCount} Evento(s), ${result.importedQuestionsCount} questão(ões) e ${result.importedMatchesCount} Partida(s).`,
      );
    } catch (error) {
      onStatusMessage(
        'error',
        error instanceof Error ? error.message : 'Erro ao restaurar arquivo de backup.',
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <section id="admin-backup-tab" className="admin-panel-card">
      <h3>Backup, Restauração e Migração Legada (quiz-offline)</h3>
      <p className="admin-subtitle">
        Exporte todo o estado da plataforma em JSON ou importe backups atuais e arquivos legados da
        pasta <code>quiz-offline/backup/</code> (FITABES 2025) com remapeamento automático de IDs.
      </p>

      <div className="customization-section-box">
        <h4>Exportação Completa</h4>
        <p className="operator-card-meta">
          Inclui Banco de Questões, Eventos, configurações, customizações, Partidas, Brindes e
          bloqueios.
        </p>
        <button
          type="button"
          className="admin-btn admin-btn-primary"
          disabled={busy}
          onClick={() => void handleExportBackup()}
        >
          Exportar Backup Completo (JSON)
        </button>
      </div>

      <div className="customization-section-box">
        <h4>Restaurar Backup ou Migrar JSON Legado</h4>
        <div className="customization-fields-grid">
          <div className="form-group">
            <label htmlFor="backup-target-event">Evento de Destino (para backup legado)</label>
            <select
              id="backup-target-event"
              value={targetEventId}
              onChange={(e) => setTargetEventId(e.target.value)}
            >
              {events.map((ev) => (
                <option key={ev.id} value={ev.id}>
                  {ev.name}
                </option>
              ))}
            </select>
          </div>

          <div className="form-group">
            <label htmlFor="backup-file-input">Arquivo de Backup (JSON)</label>
            <input
              id="backup-file-input"
              type="file"
              accept=".json,application/json"
              onChange={(e) => void handleFileSelected(e.target.files?.[0] ?? null)}
            />
            {pendingFileName && (
              <small className="operator-card-meta">Selecionado: {pendingFileName}</small>
            )}
          </div>
        </div>

        <button
          type="button"
          className="admin-btn admin-btn-danger"
          disabled={!pendingJson || busy}
          onClick={() => setConfirmOpen(true)}
        >
          Restaurar Backup
        </button>
      </div>

      {lastResult && (
        <div className="admin-alert admin-alert-success" role="status">
          <strong>Última restauração ({lastResult.sourceFormat}):</strong>{' '}
          {lastResult.importedQuestionsCount} questão(ões), {lastResult.remappedAnswersCount}{' '}
          resposta(s) remapeada(s), {lastResult.importedMatchesCount} Partida(s),{' '}
          {lastResult.importedPrizeClaimsCount} Brinde(s), {lastResult.importedLockoutsCount}{' '}
          bloqueio(s).
        </div>
      )}

      {confirmOpen && (
        <div
          id="backup-restore-confirm-modal"
          className="modal-overlay"
          role="dialog"
          aria-modal="true"
          aria-labelledby="backup-restore-confirm-title"
        >
          <div className="modal-content admin-modal">
            <h3 id="backup-restore-confirm-title" className="modal-title">
              Confirmar Restauração de Backup
            </h3>
            <p className="modal-text">
              Deseja restaurar o arquivo "{pendingFileName}"? Questões e registros do Evento
              selecionado serão atualizados.
            </p>
            <div className="modal-actions">
              <button
                type="button"
                className="admin-btn admin-btn-danger"
                onClick={() => void handleConfirmRestore()}
              >
                Confirmar Restauração
              </button>
              <button
                type="button"
                className="admin-btn admin-btn-secondary"
                onClick={() => setConfirmOpen(false)}
              >
                Cancelar
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
