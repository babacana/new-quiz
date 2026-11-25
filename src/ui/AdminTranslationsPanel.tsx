import { useCallback, useEffect, useState } from 'react';
import { Download, Languages, Upload } from 'lucide-react';
import type { TranslationImportPlan } from '../domain/admin/translationModule';
import type { EventAdminController } from '../domain/eventAdminController';
import {
  CONTENT_LANGUAGES,
  CONTENT_LANGUAGE_LABELS,
  getLanguageCompleteness,
} from '../domain/translations';
import type { EventConfig, Question } from '../domain/types';
import { describeSummary } from './translationLabels';
import { Button } from './components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './components/ui/card';
import { Input } from './components/ui/input';
import { Label } from './components/ui/label';
import { triggerFileDownload } from './formatters';

export interface AdminTranslationsPanelProps {
  controller: EventAdminController;
  event: EventConfig;
  /** Alterações de personalização ainda não salvas: o import recarregaria o Evento por cima delas. */
  hasUnsavedChanges: boolean;
  onEventsChanged: (preferredSelectedId?: string) => Promise<void>;
  onStatusMessage: (type: 'success' | 'error', message: string) => void;
}

async function readBuffer(file: File): Promise<ArrayBuffer> {
  if (typeof file.arrayBuffer === 'function') {
    return file.arrayBuffer();
  }
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as ArrayBuffer);
    reader.onerror = () => reject(new Error('Falha ao ler arquivo selecionado.'));
    reader.readAsArrayBuffer(file);
  });
}

// Traduções EN/ES do Evento sem IA/API: o ADM exporta a planilha, traduz por conta própria e importa.
export function AdminTranslationsPanel({
  controller,
  event,
  hasUnsavedChanges,
  onEventsChanged,
  onStatusMessage,
}: AdminTranslationsPanelProps) {
  const [questions, setQuestions] = useState<Question[]>([]);
  const [file, setFile] = useState<File | null>(null);
  const [review, setReview] = useState<{ data: ArrayBuffer; plan: TranslationImportPlan } | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const loadQuestions = useCallback(async () => {
    try {
      setQuestions(await controller.listAllQuestions(event.id));
    } catch {
      setQuestions([]);
    }
  }, [controller, event.id]);

  useEffect(() => {
    void loadQuestions();
  }, [loadQuestions, event.configVersion]);

  const handleExport = async () => {
    try {
      const content = await controller.exportTranslationsXlsx(event.id);
      triggerFileDownload(
        `traducoes-${event.slug || 'evento'}.xlsx`,
        content,
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      );
      onStatusMessage('success', 'Planilha de traduções exportada.');
    } catch (cause) {
      onStatusMessage('error', cause instanceof Error ? cause.message : 'Erro ao exportar traduções.');
    }
  };

  const handleReview = async () => {
    if (!file) return;
    setBusy(true);
    setError('');
    try {
      const data = await readBuffer(file);
      setReview({ data, plan: await controller.previewTranslationsXlsx(data, event.id) });
    } catch (cause) {
      setReview(null);
      setError(cause instanceof Error ? cause.message : 'Erro ao ler a planilha.');
    } finally {
      setBusy(false);
    }
  };

  const handleConfirm = async () => {
    if (!review) return;
    setBusy(true);
    try {
      const result = await controller.importTranslationsXlsx(review.data, event.id);
      onStatusMessage(
        'success',
        `Traduções importadas: ${result.updatedQuestionIds.length} pergunta(s) atualizada(s)` +
          (result.textsChanged > 0 ? ` e ${result.textsChanged} texto(s) do Evento.` : '.'),
      );
      setFile(null);
      setReview(null);
      await onEventsChanged(event.id);
      await loadQuestions();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Erro ao importar traduções.');
    } finally {
      setBusy(false);
    }
  };

  const hasChanges = review ? review.plan.questionsToUpdate > 0 || review.plan.textsChanged > 0 : false;

  return (
    <Card id="translations-panel">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg">
          <Languages className="h-5 w-5" /> Traduções (Inglês e Espanhol)
        </CardTitle>
        <CardDescription>
          Exporte a planilha com as perguntas e textos do Evento, traduza e importe de volta. O que
          ficar sem tradução aparece em português no Totem.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <ul className="space-y-1 text-sm" data-testid="translation-progress">
          {CONTENT_LANGUAGES.map((language) => {
            const status = getLanguageCompleteness(
              questions,
              event.customizations,
              event.settings,
              language,
            );
            return (
              <li key={language} data-language={language} data-complete={status.isComplete}>
                <strong>{status.isComplete ? '✓' : '⚠'}</strong>{' '}
                {describeSummary(language, status.questions, 'perguntas traduzidas')} ·{' '}
                {CONTENT_LANGUAGE_LABELS[language]}: {status.texts.complete} de {status.texts.total} textos
              </li>
            );
          })}
        </ul>

        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" size="sm" onClick={() => void handleExport()}>
            <Download className="h-4 w-4" /> Exportar planilha de traduções
          </Button>
        </div>

        <div className="space-y-2">
          <Label htmlFor="translations-file">Importar planilha traduzida (.xlsx)</Label>
          <Input
            id="translations-file"
            type="file"
            accept=".xlsx"
            disabled={busy || hasUnsavedChanges}
            onChange={(e) => {
              setFile(e.target.files?.[0] ?? null);
              setReview(null);
              setError('');
            }}
          />
          {hasUnsavedChanges && (
            <p className="text-sm text-muted-foreground">
              Salve ou descarte as alterações de personalização antes de importar traduções.
            </p>
          )}
          {error && (
            <p role="alert" className="whitespace-pre-line text-sm text-destructive">
              {error}
            </p>
          )}
          {review && (
            <div className="space-y-1 text-sm" aria-live="polite" data-testid="translation-review">
              <p>
                {hasChanges
                  ? `${review.plan.questionsToUpdate} pergunta(s) e ${review.plan.textsChanged} texto(s) a atualizar.`
                  : 'A planilha não contém alterações.'}
              </p>
              {review.plan.unknownQuestionIds.length > 0 && (
                <p className="text-amber-700 dark:text-amber-300">
                  IDs não encontrados no Banco de Questões (ignorados): {review.plan.unknownQuestionIds.join(', ')}.
                </p>
              )}
              {CONTENT_LANGUAGES.map((language) => {
                const after = review.plan.after[language];
                return (
                  <p key={language}>
                    {after.isComplete
                      ? `${CONTENT_LANGUAGE_LABELS[language]} ficará completo.`
                      : `${CONTENT_LANGUAGE_LABELS[language]} ficará com ${after.questions.missing + after.questions.partial} pergunta(s) e ${after.texts.missing} texto(s) sem tradução (aparecem em português).`}
                  </p>
                );
              })}
            </div>
          )}
          <Button
            type="button"
            size="sm"
            disabled={busy || !file || hasUnsavedChanges || (review !== null && !hasChanges)}
            onClick={() => void (review ? handleConfirm() : handleReview())}
          >
            <Upload className="h-4 w-4" />
            {busy ? 'Processando…' : review ? 'Confirmar importação' : 'Revisar planilha'}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
