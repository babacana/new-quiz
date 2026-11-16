import { useCallback, useEffect, useState } from 'react';
import { AlertCircle, CheckCircle2, RotateCcw, Save } from 'lucide-react';
import { DEFAULT_SETTINGS } from '../domain/defaults';
import type { EventAdminController } from '../domain/eventAdminController';
import type { EventConfig, EventSettings, Question } from '../domain/types';
import { Button } from './components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './components/ui/card';
import { Input } from './components/ui/input';
import { Label } from './components/ui/label';
import { cn } from './lib/utils';

export interface AdminSettingsTabProps {
  controller: EventAdminController;
  selectedEvent: EventConfig | null;
  allQuestions: Question[];
  onEventsChanged: (preferredSelectedId?: string) => Promise<void>;
  onRegisterSaveHandler: (handler: (() => Promise<void>) | null) => void;
  onStatusMessage: (type: 'success' | 'error', message: string) => void;
}

interface SettingsFormState {
  name: string;
  slug: string;
  startTimeLocal: string;
  endTimeLocal: string;
  enableOutOfPeriodMessage: boolean;
  isActive: boolean;
  settings: EventSettings;
  prizeStockRemainingInput: string;
  linkedQuestionIds: number[];
  tagsToLink: string;
}

function toDatetimeLocalValue(iso: string | null): string {
  if (!iso) {
    return '';
  }
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return '';
  }
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(
    date.getHours(),
  )}:${pad(date.getMinutes())}`;
}

function fromDatetimeLocalValue(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) {
    return trimmed;
  }
  return parsed.toISOString();
}

function buildFormStateFromEvent(event: EventConfig, linkedIds: number[]): SettingsFormState {
  return {
    name: event.name,
    slug: event.slug,
    startTimeLocal: toDatetimeLocalValue(event.startTime),
    endTimeLocal: toDatetimeLocalValue(event.endTime),
    enableOutOfPeriodMessage: event.enableOutOfPeriodMessage,
    isActive: event.isActive,
    settings: structuredClone(event.settings),
    prizeStockRemainingInput:
      event.prizeStockRemaining === null ? '' : String(event.prizeStockRemaining),
    linkedQuestionIds: [...linkedIds],
    tagsToLink: '',
  };
}

function buildEmptySettingsFormState(): SettingsFormState {
  return {
    name: '',
    slug: '',
    startTimeLocal: '',
    endTimeLocal: '',
    enableOutOfPeriodMessage: false,
    isActive: true,
    settings: structuredClone(DEFAULT_SETTINGS),
    prizeStockRemainingInput: '',
    linkedQuestionIds: [],
    tagsToLink: '',
  };
}

// Tela de Regras & Configurações do Evento selecionado, organizada em 4 sub-seções com sticky action bar.
export function AdminSettingsTab({
  controller,
  selectedEvent,
  allQuestions,
  onEventsChanged,
  onRegisterSaveHandler,
  onStatusMessage,
}: AdminSettingsTabProps) {
  const [formState, setFormState] = useState<SettingsFormState>(() =>
    buildEmptySettingsFormState(),
  );
  const [loadedLinkedIds, setLoadedLinkedIds] = useState<number[]>([]);
  const [isDirty, setIsDirty] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  const resetFromSelectedEvent = useCallback(
    (event: EventConfig, ids: number[]) => {
      setLoadedLinkedIds(ids);
      setFormState(buildFormStateFromEvent(event, ids));
      setIsDirty(false);
      controller.clearDirty('event');
      controller.clearDirty('settings');
    },
    [controller],
  );

  useEffect(() => {
    let cancelled = false;
    if (!selectedEvent) {
      setIsDirty(false);
      return;
    }

    void controller
      .getEventQuestionIds(selectedEvent.id)
      .then((ids) => {
        if (!cancelled) {
          resetFromSelectedEvent(selectedEvent, ids);
        }
      })
      .catch(() => {
        if (!cancelled) {
          resetFromSelectedEvent(selectedEvent, []);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [controller, resetFromSelectedEvent, selectedEvent]);

  const handleSaveCurrent = async () => {
    if (!selectedEvent) {
      return;
    }
    setIsSaving(true);
    try {
      const parsedStockRemaining =
        formState.prizeStockRemainingInput.trim() === ''
          ? null
          : Number(formState.prizeStockRemainingInput);

      const updated = await controller.updateEvent(selectedEvent.id, {
        name: formState.name,
        slug: formState.slug || undefined,
        startTime: fromDatetimeLocalValue(formState.startTimeLocal),
        endTime: fromDatetimeLocalValue(formState.endTimeLocal),
        enableOutOfPeriodMessage: formState.enableOutOfPeriodMessage,
        isActive: formState.isActive,
        settings: formState.settings,
        prizeStockRemaining: parsedStockRemaining,
        linkedQuestionIds: formState.linkedQuestionIds,
      });

      setIsDirty(false);
      await onEventsChanged(updated.id);
      onStatusMessage('success', `Evento "${updated.name}" salvo (v${updated.configVersion}).`);
    } catch (error) {
      onStatusMessage(
        'error',
        error instanceof Error ? error.message : 'Erro ao salvar configurações do Evento.',
      );
      throw error;
    } finally {
      setIsSaving(false);
    }
  };

  useEffect(() => {
    onRegisterSaveHandler(() => handleSaveCurrent());
    return () => onRegisterSaveHandler(null);
  });

  const markEventAndSettingsDirty = () => {
    setIsDirty(true);
    controller.markDirty('event');
    controller.markDirty('settings');
  };

  const updateSettingsField = <K extends keyof EventSettings>(
    field: K,
    value: EventSettings[K],
  ) => {
    markEventAndSettingsDirty();
    setFormState((prev) => ({
      ...prev,
      settings: {
        ...prev.settings,
        [field]: value,
      },
    }));
  };

  const updateDifficultyPercentage = (
    level: keyof EventSettings['difficultyPercentages'],
    value: number,
  ) => {
    markEventAndSettingsDirty();
    setFormState((prev) => ({
      ...prev,
      settings: {
        ...prev.settings,
        difficultyPercentages: {
          ...prev.settings.difficultyPercentages,
          [level]: Number.isFinite(value) ? value : 0,
        },
      },
    }));
  };

  const difficultySum =
    formState.settings.difficultyPercentages.facil +
    formState.settings.difficultyPercentages.moderado +
    formState.settings.difficultyPercentages.dificil;

  const handleLinkByTags = () => {
    const targetTags = new Set(
      formState.tagsToLink
        .split(',')
        .map((t) => t.trim().toLowerCase())
        .filter(Boolean),
    );
    const matchingIds = allQuestions
      .filter(
        (q) =>
          targetTags.size === 0 || q.tags.some((tag) => targetTags.has(tag.toLowerCase())),
      )
      .map((q) => q.id);

    if (targetTags.size > 0 && matchingIds.length === 0) {
      onStatusMessage(
        'error',
        'Nenhuma questão encontrada no Banco de Questões para as tags informadas.',
      );
      return;
    }

    markEventAndSettingsDirty();
    setFormState((prev) => ({ ...prev, linkedQuestionIds: matchingIds }));
    onStatusMessage(
      'success',
      `${matchingIds.length} questão(ões) selecionada(s) pelas tags. Salve o Evento para aplicar.`,
    );
  };

  const toggleLinkedQuestion = (questionId: number) => {
    markEventAndSettingsDirty();
    setFormState((prev) => {
      const exists = prev.linkedQuestionIds.includes(questionId);
      return {
        ...prev,
        linkedQuestionIds: exists
          ? prev.linkedQuestionIds.filter((id) => id !== questionId)
          : [...prev.linkedQuestionIds, questionId],
      };
    });
  };

  const handleDiscard = () => {
    if (!selectedEvent) {
      return;
    }
    resetFromSelectedEvent(selectedEvent, loadedLinkedIds);
  };

  if (!selectedEvent) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Regras &amp; Configurações</CardTitle>
          <CardDescription>
            Selecione ou crie um Evento na seção &ldquo;Eventos&rdquo; para configurar suas regras.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <form
      id="admin-event-form"
      className="space-y-6 pb-20"
      onSubmit={(e) => {
        e.preventDefault();
        void handleSaveCurrent().catch(() => undefined);
      }}
    >
      <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Regras &amp; Configurações</h1>
          <p className="text-sm text-muted-foreground">
            Editando <strong>{selectedEvent.name}</strong> (v{selectedEvent.configVersion})
          </p>
        </div>
      </div>

      {/* Sub-seção 1: Geral & Período */}
      <Card aria-labelledby="section-general-title">
        <CardHeader>
          <CardTitle id="section-general-title" className="text-lg">
            Geral &amp; Período
          </CardTitle>
          <CardDescription>
            Identificação do Evento, slug amigável e janela de funcionamento nos Totens.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="event-name-input">Nome do Evento</Label>
              <Input
                id="event-name-input"
                type="text"
                value={formState.name}
                onChange={(e) => {
                  markEventAndSettingsDirty();
                  setFormState((prev) => ({ ...prev, name: e.target.value }));
                }}
                required
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="event-slug-input">Slug (URL amigável)</Label>
              <Input
                id="event-slug-input"
                type="text"
                placeholder="gerado automaticamente se vazio"
                value={formState.slug}
                onChange={(e) => {
                  markEventAndSettingsDirty();
                  setFormState((prev) => ({ ...prev, slug: e.target.value }));
                }}
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="event-start-input">Início do Evento</Label>
              <Input
                id="event-start-input"
                type="datetime-local"
                value={formState.startTimeLocal}
                onChange={(e) => {
                  markEventAndSettingsDirty();
                  setFormState((prev) => ({ ...prev, startTimeLocal: e.target.value }));
                }}
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="event-end-input">Término do Evento</Label>
              <Input
                id="event-end-input"
                type="datetime-local"
                value={formState.endTimeLocal}
                onChange={(e) => {
                  markEventAndSettingsDirty();
                  setFormState((prev) => ({ ...prev, endTimeLocal: e.target.value }));
                }}
              />
            </div>
          </div>

          <div className="flex flex-col gap-2.5 pt-1 sm:flex-row sm:flex-wrap sm:gap-6">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={formState.isActive}
                onChange={(e) => {
                  markEventAndSettingsDirty();
                  setFormState((prev) => ({ ...prev, isActive: e.target.checked }));
                }}
                className="h-4 w-4 rounded border-input"
              />
              Evento Ativo
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={formState.enableOutOfPeriodMessage}
                onChange={(e) => {
                  markEventAndSettingsDirty();
                  setFormState((prev) => ({
                    ...prev,
                    enableOutOfPeriodMessage: e.target.checked,
                  }));
                }}
                className="h-4 w-4 rounded border-input"
              />
              Exibir mensagem fora do período de funcionamento
            </label>
          </div>
        </CardContent>
      </Card>

      {/* Sub-seção 2: Regras do Quiz */}
      <Card aria-labelledby="section-quiz-rules-title">
        <CardHeader>
          <CardTitle id="section-quiz-rules-title" className="text-lg">
            Regras do Quiz
          </CardTitle>
          <CardDescription>
            Temporizadores, comportamento do Totem, bloqueio por desistência e distribuição de dificuldades.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <div className="space-y-1.5">
              <Label htmlFor="setting-num-questions">Número de Perguntas</Label>
              <Input
                id="setting-num-questions"
                type="number"
                min={1}
                value={formState.settings.numberOfQuestions}
                onChange={(e) =>
                  updateSettingsField('numberOfQuestions', Number(e.target.value))
                }
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="setting-time-question">Tempo por Pergunta (5–120s)</Label>
              <Input
                id="setting-time-question"
                type="number"
                min={5}
                max={120}
                value={formState.settings.timePerQuestion}
                onChange={(e) =>
                  updateSettingsField('timePerQuestion', Number(e.target.value))
                }
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="setting-idle-timeout">Tempo de Inatividade (15–600s)</Label>
              <Input
                id="setting-idle-timeout"
                type="number"
                min={15}
                max={600}
                value={formState.settings.idleTimeoutSeconds}
                onChange={(e) =>
                  updateSettingsField('idleTimeoutSeconds', Number(e.target.value))
                }
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="setting-fade-out">Aviso Fade-out (3–30s)</Label>
              <Input
                id="setting-fade-out"
                type="number"
                min={3}
                max={30}
                value={formState.settings.fadeOutLeadTimeSeconds}
                onChange={(e) =>
                  updateSettingsField('fadeOutLeadTimeSeconds', Number(e.target.value))
                }
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="setting-ranking-count">Posições no Ranking</Label>
              <Input
                id="setting-ranking-count"
                type="number"
                min={1}
                value={formState.settings.rankingDisplayCount}
                onChange={(e) =>
                  updateSettingsField('rankingDisplayCount', Number(e.target.value))
                }
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="setting-giveup-lockout">
                Bloqueio por Desistência (minutos)
              </Label>
              <Input
                id="setting-giveup-lockout"
                type="number"
                min={0}
                value={formState.settings.giveUpLockoutMinutes}
                onChange={(e) =>
                  updateSettingsField('giveUpLockoutMinutes', Number(e.target.value))
                }
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="setting-kbd-height">Altura Teclado Virtual (20–60vh)</Label>
              <Input
                id="setting-kbd-height"
                type="number"
                min={20}
                max={60}
                value={formState.settings.virtualKeyboardHeight}
                onChange={(e) =>
                  updateSettingsField('virtualKeyboardHeight', Number(e.target.value))
                }
              />
            </div>
          </div>

          <div className="rounded-lg border border-border bg-muted/30 p-4 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <strong className="text-sm font-medium">
                Distribuição de Dificuldade (Soma deve ser 100%)
              </strong>
              <span
                id="difficulty-sum-indicator"
                className={cn(
                  'inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium',
                  difficultySum === 100
                    ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300'
                    : 'bg-destructive/15 text-destructive',
                )}
              >
                {difficultySum === 100 ? (
                  <CheckCircle2 className="h-3.5 w-3.5" />
                ) : (
                  <AlertCircle className="h-3.5 w-3.5" />
                )}
                Soma atual: {difficultySum}%
              </span>
            </div>

            <div className="grid gap-4 sm:grid-cols-3">
              <div className="space-y-1.5">
                <Label htmlFor="setting-diff-facil">Fácil (%)</Label>
                <Input
                  id="setting-diff-facil"
                  type="number"
                  min={0}
                  max={100}
                  value={formState.settings.difficultyPercentages.facil}
                  onChange={(e) =>
                    updateDifficultyPercentage('facil', Number(e.target.value))
                  }
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="setting-diff-moderado">Moderado (%)</Label>
                <Input
                  id="setting-diff-moderado"
                  type="number"
                  min={0}
                  max={100}
                  value={formState.settings.difficultyPercentages.moderado}
                  onChange={(e) =>
                    updateDifficultyPercentage('moderado', Number(e.target.value))
                  }
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="setting-diff-dificil">Difícil (%)</Label>
                <Input
                  id="setting-diff-dificil"
                  type="number"
                  min={0}
                  max={100}
                  value={formState.settings.difficultyPercentages.dificil}
                  onChange={(e) =>
                    updateDifficultyPercentage('dificil', Number(e.target.value))
                  }
                />
              </div>
            </div>
          </div>

          <div className="grid gap-2.5 sm:grid-cols-2">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={formState.settings.showCorrectAnswerOnWrong}
                onChange={(e) =>
                  updateSettingsField('showCorrectAnswerOnWrong', e.target.checked)
                }
                className="h-4 w-4 rounded border-input"
              />
              Mostrar alternativa correta quando errar
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={formState.settings.enableVirtualKeyboard}
                onChange={(e) =>
                  updateSettingsField('enableVirtualKeyboard', e.target.checked)
                }
                className="h-4 w-4 rounded border-input"
              />
              Habilitar Teclado Virtual
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={formState.settings.enableTimeAlertBorderPulse}
                onChange={(e) =>
                  updateSettingsField('enableTimeAlertBorderPulse', e.target.checked)
                }
                className="h-4 w-4 rounded border-input"
              />
              Pulso de borda no alerta de tempo
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={formState.settings.enableTimeAlertFlash}
                onChange={(e) =>
                  updateSettingsField('enableTimeAlertFlash', e.target.checked)
                }
                className="h-4 w-4 rounded border-input"
              />
              Flash visual crítico de tempo
            </label>
          </div>
        </CardContent>
      </Card>

      {/* Sub-seção 3: Brindes & Estoque */}
      <Card aria-labelledby="section-prizes-title">
        <CardHeader>
          <CardTitle id="section-prizes-title" className="text-lg">
            Brindes &amp; Estoque
          </CardTitle>
          <CardDescription>
            Critério de premiação, limite de estoque, Trava de Brinde por telefone e confirmação manual.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="space-y-1.5">
              <Label htmlFor="setting-min-score">Pontuação Mínima para Brinde</Label>
              <Input
                id="setting-min-score"
                type="number"
                min={1}
                value={formState.settings.minScoreForPrize}
                onChange={(e) =>
                  updateSettingsField('minScoreForPrize', Number(e.target.value))
                }
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="setting-prize-stock-limit">
                Limite de Estoque de Brindes (vazio = ilimitado)
              </Label>
              <Input
                id="setting-prize-stock-limit"
                type="number"
                min={0}
                value={
                  formState.settings.prizeStockLimit === null
                    ? ''
                    : formState.settings.prizeStockLimit
                }
                onChange={(e) => {
                  const val = e.target.value.trim();
                  const parsed = val === '' ? null : Number(val);
                  updateSettingsField('prizeStockLimit', parsed);
                  if (val === '') {
                    setFormState((prev) => ({ ...prev, prizeStockRemainingInput: '' }));
                  }
                }}
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="setting-prize-stock-remaining">
                Saldo Atual de Estoque de Brindes
              </Label>
              <Input
                id="setting-prize-stock-remaining"
                type="number"
                min={0}
                placeholder="Ilimitado"
                value={formState.prizeStockRemainingInput}
                onChange={(e) => {
                  markEventAndSettingsDirty();
                  setFormState((prev) => ({
                    ...prev,
                    prizeStockRemainingInput: e.target.value,
                  }));
                }}
              />
            </div>
          </div>

          <div className="flex flex-col gap-2.5 pt-1 sm:flex-row sm:flex-wrap sm:gap-6">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={formState.settings.enablePrizeLock}
                onChange={(e) => updateSettingsField('enablePrizeLock', e.target.checked)}
                className="h-4 w-4 rounded border-input"
              />
              Ativar Trava de Brinde por telefone
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={formState.settings.requireManualPrizeConfirmation}
                onChange={(e) =>
                  updateSettingsField('requireManualPrizeConfirmation', e.target.checked)
                }
                className="h-4 w-4 rounded border-input"
              />
              Exigir entrega manual de Brinde (Aguardando Retirada)
            </label>
          </div>
        </CardContent>
      </Card>

      {/* Sub-seção 4: Seleção de Questões */}
      <Card aria-labelledby="section-questions-title">
        <CardHeader>
          <CardTitle id="section-questions-title" className="text-lg">
            Seleção de Questões
          </CardTitle>
          <CardDescription>
            {formState.linkedQuestionIds.length === 0
              ? 'Usando todas as questões ativas do Banco de Questões'
              : `${formState.linkedQuestionIds.length} questão(ões) vinculada(s) a este Evento`}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-col gap-2 sm:flex-row">
            <Input
              type="text"
              aria-label="Tags para vincular questões"
              placeholder="Tags separadas por vírgula (ex: caesb, mananciais)"
              value={formState.tagsToLink}
              onChange={(e) =>
                setFormState((prev) => ({ ...prev, tagsToLink: e.target.value }))
              }
            />
            <Button type="button" variant="outline" onClick={handleLinkByTags}>
              Vincular por Tags
            </Button>
          </div>

          <div className="grid max-h-64 gap-2 overflow-y-auto rounded-md border border-border p-3 sm:grid-cols-2">
            {allQuestions.map((q) => (
              <label
                key={q.id}
                className="flex cursor-pointer items-start gap-2 rounded-md p-1.5 text-xs hover:bg-muted/50"
              >
                <input
                  type="checkbox"
                  checked={formState.linkedQuestionIds.includes(q.id)}
                  onChange={() => toggleLinkedQuestion(q.id)}
                  className="mt-0.5 h-4 w-4 shrink-0 rounded border-input"
                />
                <span className="leading-snug">
                  <strong>#{q.id}</strong> — {q.text.slice(0, 64)}
                  {q.text.length > 64 ? '...' : ''}
                </span>
              </label>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Barra inferior fixa exibida apenas quando houver alterações não salvas */}
      {isDirty && (
        <div
          data-testid="settings-sticky-action-bar"
          role="region"
          aria-label="Alterações pendentes"
          className="sticky bottom-0 z-20 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-card/95 px-4 py-3 shadow-lg backdrop-blur-xs"
        >
          <p className="text-sm font-medium text-foreground">
            Você tem alterações não salvas neste Evento.
          </p>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleDiscard}
              disabled={isSaving}
            >
              <RotateCcw className="h-4 w-4" />
              Descartar
            </Button>
            <Button id="save-event-btn" type="submit" size="sm" disabled={isSaving}>
              <Save className="h-4 w-4" />
              {isSaving ? 'Salvando...' : 'Salvar Configurações'}
            </Button>
          </div>
        </div>
      )}
    </form>
  );
}
