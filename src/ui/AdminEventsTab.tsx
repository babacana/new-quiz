import { useEffect, useState } from 'react';
import { DEFAULT_SETTINGS } from '../domain/defaults';
import type { EventAdminController } from '../domain/eventAdminController';
import type { EventConfig, EventSettings, Question } from '../domain/types';

export interface AdminEventsTabProps {
  controller: EventAdminController;
  events: EventConfig[];
  allQuestions: Question[];
  selectedEventId: string | null;
  onSelectEvent: (eventId: string) => void;
  onRequestGuardedAction: (proceed: () => void) => void;
  onEventsChanged: (preferredSelectedId?: string) => Promise<void>;
  onRegisterSaveHandler: (handler: (() => Promise<void>) | null) => void;
  onStatusMessage: (type: 'success' | 'error', message: string) => void;
}

interface EventFormState {
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

function buildFormStateFromEvent(event: EventConfig, linkedIds: number[]): EventFormState {
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

function buildEmptyEventFormState(): EventFormState {
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

// Aba administrativa de Gestão Multi-Evento, Configurações do Jogo e Clonagem.
export function AdminEventsTab({
  controller,
  events,
  allQuestions,
  selectedEventId,
  onSelectEvent,
  onRequestGuardedAction,
  onEventsChanged,
  onRegisterSaveHandler,
  onStatusMessage,
}: AdminEventsTabProps) {
  const [isCreatingNew, setIsCreatingNew] = useState(false);
  const [cloneSourceEvent, setCloneSourceEvent] = useState<EventConfig | null>(null);
  const [cloneName, setCloneName] = useState('');
  const [formState, setFormState] = useState<EventFormState>(() => buildEmptyEventFormState());
  const [isSaving, setIsSaving] = useState(false);

  const selectedEvent = events.find((ev) => ev.id === selectedEventId) ?? null;

  useEffect(() => {
    let cancelled = false;
    if (isCreatingNew) {
      setFormState(buildEmptyEventFormState());
      return;
    }
    if (!selectedEvent) {
      return;
    }

    void controller
      .getEventQuestionIds(selectedEvent.id)
      .then((ids) => {
        if (!cancelled) {
          setFormState(buildFormStateFromEvent(selectedEvent, ids));
        }
      })
      .catch(() => {
        if (!cancelled) {
          setFormState(buildFormStateFromEvent(selectedEvent, []));
        }
      });

    return () => {
      cancelled = true;
    };
  }, [controller, isCreatingNew, selectedEvent]);

  const handleSaveCurrent = async () => {
    setIsSaving(true);
    try {
      const parsedStockRemaining =
        formState.prizeStockRemainingInput.trim() === ''
          ? null
          : Number(formState.prizeStockRemainingInput);

      const payload = {
        name: formState.name,
        slug: formState.slug || undefined,
        startTime: fromDatetimeLocalValue(formState.startTimeLocal),
        endTime: fromDatetimeLocalValue(formState.endTimeLocal),
        enableOutOfPeriodMessage: formState.enableOutOfPeriodMessage,
        isActive: formState.isActive,
        settings: formState.settings,
        prizeStockRemaining: parsedStockRemaining,
        linkedQuestionIds: formState.linkedQuestionIds,
      };

      if (isCreatingNew) {
        const created = await controller.createEvent(payload);
        setIsCreatingNew(false);
        await onEventsChanged(created.id);
        onStatusMessage('success', `Evento "${created.name}" criado com sucesso.`);
      } else if (selectedEvent) {
        const updated = await controller.updateEvent(selectedEvent.id, payload);
        await onEventsChanged(updated.id);
        onStatusMessage('success', `Evento "${updated.name}" salvo (v${updated.configVersion}).`);
      }
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

  const handleToggleActive = async (ev: EventConfig) => {
    try {
      const updated = await controller.setEventActive(ev.id, !ev.isActive);
      await onEventsChanged(updated.id);
      onStatusMessage(
        'success',
        `Evento "${updated.name}" ${updated.isActive ? 'ativado' : 'encerrado'} com sucesso.`,
      );
    } catch (error) {
      onStatusMessage(
        'error',
        error instanceof Error ? error.message : 'Não foi possível alterar o status do Evento.',
      );
    }
  };

  const handleConfirmClone = async () => {
    if (!cloneSourceEvent) {
      return;
    }
    try {
      const cloned = await controller.cloneEvent(cloneSourceEvent.id, {
        name: cloneName,
      });
      setCloneSourceEvent(null);
      setCloneName('');
      setIsCreatingNew(false);
      await onEventsChanged(cloned.id);
      onStatusMessage(
        'success',
        `Evento "${cloned.name}" clonado a partir de "${cloneSourceEvent.name}".`,
      );
    } catch (error) {
      onStatusMessage(
        'error',
        error instanceof Error ? error.message : 'Erro ao clonar Evento.',
      );
    }
  };

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

  return (
    <div id="admin-events-tab" className="admin-tab-layout">
      <div className="admin-panel-card">
        <div className="admin-section-header">
          <h3>Eventos Cadastrados ({events.length})</h3>
          <button
            id="new-event-btn"
            type="button"
            className="admin-btn admin-btn-primary"
            onClick={() => onRequestGuardedAction(() => setIsCreatingNew(true))}
          >
            + Novo Evento
          </button>
        </div>

        <div className="admin-events-list">
          {events.map((ev) => (
            <div
              key={ev.id}
              className={`admin-event-row ${
                !isCreatingNew && selectedEvent?.id === ev.id ? 'selected' : ''
              }`}
            >
              <div className="admin-event-info">
                <div className="admin-event-title">
                  <strong>{ev.name}</strong>
                  <span className={`admin-badge ${ev.isActive ? 'active' : 'closed'}`}>
                    {ev.isActive ? 'Ativo' : 'Encerrado'}
                  </span>
                  <span className="admin-badge version">v{ev.configVersion}</span>
                </div>
                <small>
                  Slug: <code>{ev.slug}</code> · Perguntas: {ev.settings.numberOfQuestions} ·
                  Estoque:{' '}
                  {ev.prizeStockRemaining === null ? 'Ilimitado' : ev.prizeStockRemaining}
                </small>
              </div>
              <div className="admin-row-actions">
                <button
                  type="button"
                  className="admin-btn admin-btn-secondary"
                  onClick={() =>
                    onRequestGuardedAction(() => {
                      setIsCreatingNew(false);
                      onSelectEvent(ev.id);
                    })
                  }
                >
                  Editar
                </button>
                <button
                  type="button"
                  className="admin-btn admin-btn-secondary"
                  onClick={() =>
                    onRequestGuardedAction(() => {
                      setCloneSourceEvent(ev);
                      setCloneName(`${ev.name} (Cópia)`);
                    })
                  }
                >
                  Clonar Evento
                </button>
                <button
                  type="button"
                  className="admin-btn admin-btn-secondary"
                  onClick={() => void handleToggleActive(ev)}
                >
                  {ev.isActive ? 'Encerrar' : 'Ativar'}
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>

      {(isCreatingNew || selectedEvent) && (
        <form
          id="admin-event-form"
          className="admin-panel-card"
          onSubmit={(e) => {
            e.preventDefault();
            void handleSaveCurrent().catch(() => undefined);
          }}
        >
          <div className="admin-section-header">
            <h3>
              {isCreatingNew
                ? 'Criar Novo Evento'
                : `Editar Evento: ${selectedEvent?.name ?? ''}`}
            </h3>
            {isCreatingNew && (
              <button
                type="button"
                className="admin-btn admin-btn-secondary"
                onClick={() => onRequestGuardedAction(() => setIsCreatingNew(false))}
              >
                Cancelar Criação
              </button>
            )}
          </div>

          <div className="admin-form-grid">
            <div className="admin-field">
              <label htmlFor="event-name-input">Nome do Evento</label>
              <input
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

            <div className="admin-field">
              <label htmlFor="event-slug-input">Slug (URL amigável)</label>
              <input
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

            <div className="admin-field">
              <label htmlFor="event-start-input">Início do Evento</label>
              <input
                id="event-start-input"
                type="datetime-local"
                value={formState.startTimeLocal}
                onChange={(e) => {
                  markEventAndSettingsDirty();
                  setFormState((prev) => ({ ...prev, startTimeLocal: e.target.value }));
                }}
              />
            </div>

            <div className="admin-field">
              <label htmlFor="event-end-input">Término do Evento</label>
              <input
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

          <div className="admin-checkbox-row">
            <label>
              <input
                type="checkbox"
                checked={formState.isActive}
                onChange={(e) => {
                  markEventAndSettingsDirty();
                  setFormState((prev) => ({ ...prev, isActive: e.target.checked }));
                }}
              />
              Evento Ativo
            </label>
            <label>
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
              />
              Exibir mensagem fora do período de funcionamento
            </label>
          </div>

          <hr className="admin-divider" />
          <h4>Regras do Jogo e Comportamento do Totem</h4>

          <div className="admin-form-grid">
            <div className="admin-field">
              <label htmlFor="setting-num-questions">Número de Perguntas</label>
              <input
                id="setting-num-questions"
                type="number"
                min={1}
                value={formState.settings.numberOfQuestions}
                onChange={(e) =>
                  updateSettingsField('numberOfQuestions', Number(e.target.value))
                }
              />
            </div>

            <div className="admin-field">
              <label htmlFor="setting-time-question">Tempo por Pergunta (5–120s)</label>
              <input
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

            <div className="admin-field">
              <label htmlFor="setting-idle-timeout">Tempo de Inatividade (15–600s)</label>
              <input
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

            <div className="admin-field">
              <label htmlFor="setting-fade-out">Aviso Fade-out (3–30s)</label>
              <input
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

            <div className="admin-field">
              <label htmlFor="setting-min-score">Pontuação Mínima para Brinde</label>
              <input
                id="setting-min-score"
                type="number"
                min={1}
                value={formState.settings.minScoreForPrize}
                onChange={(e) =>
                  updateSettingsField('minScoreForPrize', Number(e.target.value))
                }
              />
            </div>

            <div className="admin-field">
              <label htmlFor="setting-ranking-count">Posições no Ranking</label>
              <input
                id="setting-ranking-count"
                type="number"
                min={1}
                value={formState.settings.rankingDisplayCount}
                onChange={(e) =>
                  updateSettingsField('rankingDisplayCount', Number(e.target.value))
                }
              />
            </div>

            <div className="admin-field">
              <label htmlFor="setting-giveup-lockout">
                Bloqueio por Desistência (minutos)
              </label>
              <input
                id="setting-giveup-lockout"
                type="number"
                min={0}
                value={formState.settings.giveUpLockoutMinutes}
                onChange={(e) =>
                  updateSettingsField('giveUpLockoutMinutes', Number(e.target.value))
                }
              />
            </div>

            <div className="admin-field">
              <label htmlFor="setting-kbd-height">Altura Teclado Virtual (20–60vh)</label>
              <input
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

            <div className="admin-field">
              <label htmlFor="setting-prize-stock-limit">
                Limite de Estoque de Brindes (vazio = ilimitado)
              </label>
              <input
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
                  if (isCreatingNew || val === '') {
                    setFormState((prev) => ({ ...prev, prizeStockRemainingInput: val }));
                  }
                }}
              />
            </div>

            <div className="admin-field">
              <label htmlFor="setting-prize-stock-remaining">
                Saldo Atual de Estoque de Brindes
              </label>
              <input
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

          <div className="admin-difficulty-box">
            <div className="admin-difficulty-header">
              <strong>Distribuição de Dificuldade (Soma deve ser 100%)</strong>
              <span
                id="difficulty-sum-indicator"
                className={`admin-badge ${difficultySum === 100 ? 'active' : 'error'}`}
              >
                Soma atual: {difficultySum}%
              </span>
            </div>
            <div className="admin-form-grid">
              <div className="admin-field">
                <label htmlFor="setting-diff-facil">Fácil (%)</label>
                <input
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

              <div className="admin-field">
                <label htmlFor="setting-diff-moderado">Moderado (%)</label>
                <input
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

              <div className="admin-field">
                <label htmlFor="setting-diff-dificil">Difícil (%)</label>
                <input
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

          <div className="admin-checkbox-row">
            <label>
              <input
                type="checkbox"
                checked={formState.settings.enablePrizeLock}
                onChange={(e) => updateSettingsField('enablePrizeLock', e.target.checked)}
              />
              Ativar Trava de Brinde por telefone
            </label>
            <label>
              <input
                type="checkbox"
                checked={formState.settings.requireManualPrizeConfirmation}
                onChange={(e) =>
                  updateSettingsField('requireManualPrizeConfirmation', e.target.checked)
                }
              />
              Exigir entrega manual de Brinde (Aguardando Retirada)
            </label>
            <label>
              <input
                type="checkbox"
                checked={formState.settings.showCorrectAnswerOnWrong}
                onChange={(e) =>
                  updateSettingsField('showCorrectAnswerOnWrong', e.target.checked)
                }
              />
              Mostrar alternativa correta quando errar
            </label>
            <label>
              <input
                type="checkbox"
                checked={formState.settings.enableVirtualKeyboard}
                onChange={(e) =>
                  updateSettingsField('enableVirtualKeyboard', e.target.checked)
                }
              />
              Habilitar Teclado Virtual
            </label>
            <label>
              <input
                type="checkbox"
                checked={formState.settings.enableTimeAlertBorderPulse}
                onChange={(e) =>
                  updateSettingsField('enableTimeAlertBorderPulse', e.target.checked)
                }
              />
              Pulso de borda no alerta de tempo
            </label>
            <label>
              <input
                type="checkbox"
                checked={formState.settings.enableTimeAlertFlash}
                onChange={(e) =>
                  updateSettingsField('enableTimeAlertFlash', e.target.checked)
                }
              />
              Flash visual crítico de tempo
            </label>
          </div>

          <hr className="admin-divider" />
          <h4>
            Vínculo de Questões ao Evento (
            {formState.linkedQuestionIds.length === 0
              ? 'Usando todas do Banco de Questões'
              : `${formState.linkedQuestionIds.length} selecionada(s)`}
            )
          </h4>

          <div className="admin-inline-bar">
            <input
              type="text"
              aria-label="Tags para vincular questões"
              placeholder="Tags separadas por vírgula (ex: caesb, mananciais)"
              value={formState.tagsToLink}
              onChange={(e) =>
                setFormState((prev) => ({ ...prev, tagsToLink: e.target.value }))
              }
            />
            <button
              type="button"
              className="admin-btn admin-btn-secondary"
              onClick={handleLinkByTags}
            >
              Vincular por Tags
            </button>
          </div>

          <div className="admin-linked-questions-grid">
            {allQuestions.map((q) => (
              <label key={q.id} className="admin-linked-question-chip">
                <input
                  type="checkbox"
                  checked={formState.linkedQuestionIds.includes(q.id)}
                  onChange={() => toggleLinkedQuestion(q.id)}
                />
                <span>
                  #{q.id} — {q.text.slice(0, 48)}
                  {q.text.length > 48 ? '...' : ''}
                </span>
              </label>
            ))}
          </div>

          <div className="admin-form-footer">
            <button
              id="save-event-btn"
              type="submit"
              className="admin-btn admin-btn-primary"
              disabled={isSaving}
            >
              {isSaving ? 'Salvando...' : 'Salvar Evento e Configurações'}
            </button>
          </div>
        </form>
      )}

      {cloneSourceEvent && (
        <div className="modal-overlay" role="dialog" aria-modal="true" aria-label="Clonar Evento">
          <div className="modal-content admin-modal">
            <h3 className="modal-title">Clonar Evento</h3>
            <p className="modal-text">
              Origem: <strong>{cloneSourceEvent.name}</strong>. Todas as regras, textos,
              cores e questões vinculadas serão copiados.
            </p>
            <div className="admin-field">
              <label htmlFor="clone-event-name-input">Nome do Novo Evento</label>
              <input
                id="clone-event-name-input"
                type="text"
                value={cloneName}
                onChange={(e) => setCloneName(e.target.value)}
              />
            </div>
            <div className="modal-actions">
              <button
                id="confirm-clone-event-btn"
                type="button"
                className="admin-btn admin-btn-primary"
                onClick={() => void handleConfirmClone()}
              >
                Confirmar Clonagem
              </button>
              <button
                type="button"
                className="admin-btn admin-btn-secondary"
                onClick={() => setCloneSourceEvent(null)}
              >
                Cancelar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
