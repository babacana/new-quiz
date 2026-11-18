import { useEffect, useState } from 'react';
import { Archive, CheckCircle2, Cpu, Download, Upload } from 'lucide-react';
import type { EventAdminController } from '../domain/eventAdminController';
import type { BackupRestoreResult, EventConfig } from '../domain/types';
import { Button } from './components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from './components/ui/dialog';
import { Label } from './components/ui/label';
import { Select } from './components/ui/select';
import { triggerFileDownload } from './formatters';

export interface AdminBackupTabProps {
  controller: EventAdminController;
  events: EventConfig[];
  onWorkspaceRestored: () => Promise<void>;
  onOpenDevSimulator?: () => void;
  onStatusMessage: (type: 'success' | 'error', message: string) => void;
}

// Aba de Backup Completo (JSON), Migração Nativa de Backups Legados (quiz-offline) e Simulador do Sistema.
export function AdminBackupTab({
  controller,
  events,
  onWorkspaceRestored,
  onOpenDevSimulator,
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

  // Sincroniza o Evento de destino quando a lista de Eventos muda ou é carregada após a montagem.
  useEffect(() => {
    setTargetEventId((prev) => {
      if (prev && events.some((ev) => ev.id === prev)) {
        return prev;
      }
      return events.find((ev) => ev.isActive)?.id ?? events[0]?.id ?? '';
    });
  }, [events]);

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
    <section id="admin-backup-tab" className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold tracking-tight text-foreground">
          Backup, Restauração e Migração Legada (quiz-offline)
        </h2>
        <p className="text-sm text-muted-foreground">
          Exporte todo o estado da plataforma em JSON, importe backups legados de{' '}
          <code className="rounded bg-muted px-1 py-0.5 text-xs">quiz-offline/backup/</code>{' '}
          (FITABES 2025) com remapeamento automático de IDs ou abra o Simulador de Totem.
        </p>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* Card de Exportação Completa */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Archive className="h-4 w-4 text-primary" />
              Exportação Completa (JSON)
            </CardTitle>
            <CardDescription>
              Inclui Banco de Questões, Eventos, configurações, customizações visuais, Partidas,
              Brindes e bloqueios.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button
              type="button"
              disabled={busy}
              onClick={() => void handleExportBackup()}
            >
              <Download className="h-4 w-4" />
              Exportar Backup Completo (JSON)
            </Button>
          </CardContent>
        </Card>

        {/* Card de Acesso ao Simulador de Totem */}
        {onOpenDevSimulator && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Cpu className="h-4 w-4 text-primary" />
                Simulador de Totem (Modo Desenvolvedor)
              </CardTitle>
              <CardDescription>
                Teste telas, modais e estados temporais do Totem em memória isolada, sem afetar
                métricas ou brindes reais.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Button type="button" variant="secondary" onClick={onOpenDevSimulator}>
                <Cpu className="h-4 w-4" />
                Abrir Simulador de Totem
              </Button>
            </CardContent>
          </Card>
        )}
      </div>

      {/* Card de Restauração e Migrador Legado */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Upload className="h-4 w-4 text-primary" />
            Restaurar Backup ou Migrar JSON Legado
          </CardTitle>
          <CardDescription>
            Selecione o arquivo JSON (formato atual ou legado quiz-offline) e o Evento de destino
            para importação.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="backup-target-event">Evento de Destino (para backup legado)</Label>
              <Select
                id="backup-target-event"
                value={targetEventId}
                onChange={(e) => setTargetEventId(e.target.value)}
              >
                {events.map((ev) => (
                  <option key={ev.id} value={ev.id}>
                    {ev.name}
                  </option>
                ))}
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="backup-file-input">Arquivo de Backup (JSON)</Label>
              <input
                id="backup-file-input"
                type="file"
                accept=".json,application/json"
                className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm text-foreground file:mr-3 file:rounded file:border-0 file:bg-secondary file:px-2 file:py-0.5 file:text-xs file:font-medium file:text-secondary-foreground"
                onChange={(e) => void handleFileSelected(e.target.files?.[0] ?? null)}
              />
              {pendingFileName && (
                <p className="text-xs text-muted-foreground">Selecionado: {pendingFileName}</p>
              )}
            </div>
          </div>

          <div className="flex justify-end">
            <Button
              type="button"
              variant="destructive"
              disabled={!pendingJson || busy}
              onClick={() => setConfirmOpen(true)}
            >
              Restaurar Backup
            </Button>
          </div>
        </CardContent>
      </Card>

      {lastResult && (
        <div
          role="status"
          className="flex items-start gap-2.5 rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-4 text-sm text-emerald-900 dark:text-emerald-100"
        >
          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
          <div>
            <strong>Última restauração ({lastResult.sourceFormat}):</strong>{' '}
            {lastResult.importedQuestionsCount} questão(ões), {lastResult.remappedAnswersCount}{' '}
            resposta(s) remapeada(s), {lastResult.importedMatchesCount} Partida(s),{' '}
            {lastResult.importedPrizeClaimsCount} Brinde(s), {lastResult.importedLockoutsCount}{' '}
            bloqueio(s).
          </div>
        </div>
      )}

      {/* Modal de confirmação de restauração */}
      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent id="backup-restore-confirm-modal">
          <DialogHeader>
            <DialogTitle id="backup-restore-confirm-title">
              Confirmar Restauração de Backup
            </DialogTitle>
            <DialogDescription>
              Deseja restaurar o arquivo &ldquo;{pendingFileName}&rdquo;? Questões e registros do
              Evento selecionado serão atualizados.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setConfirmOpen(false)}>
              Cancelar
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={() => void handleConfirmRestore()}
            >
              Confirmar Restauração
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
