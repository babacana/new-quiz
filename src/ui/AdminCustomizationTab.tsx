import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  PREDEFINED_THEMES,
  applyPredefinedTheme,
  restoreDefaultCustomizations,
} from '../domain/customizationThemes';
import { DEFAULT_CUSTOMIZATIONS } from '../domain/defaults';
import type { EventAdminController } from '../domain/eventAdminController';
import type {
  CustomizationSection,
  EventConfig,
  EventCustomizationColors,
  EventCustomizationFontSizes,
  EventCustomizationTexts,
  EventCustomizations,
  PredefinedThemeId,
  VisualAssetKind,
} from '../domain/types';
import { CustomizationPreview } from './CustomizationPreview';

export interface AdminCustomizationTabProps {
  controller: EventAdminController;
  events: EventConfig[];
  selectedEventId: string | null;
  onSelectEvent: (eventId: string) => void;
  onEventsChanged: (preferredSelectedId?: string) => Promise<void>;
  onRegisterSaveHandler: (handler: (() => Promise<void>) | null) => void;
  onStatusMessage: (type: 'success' | 'error', message: string) => void;
}

const TEXT_FIELD_LABELS: Array<{ key: keyof EventCustomizationTexts; label: string }> = [
  { key: 'initialScreenTitle', label: 'Título da Tela Inicial' },
  { key: 'initialScreenSlogan', label: 'Slogan da Tela Inicial' },
  { key: 'initialScreenStartButton', label: 'Botão Iniciar Quiz' },
  { key: 'initialScreenRankingButton', label: 'Botão Ver Ranking (Inicial)' },
  { key: 'idleScreenCallToAction', label: 'Chamada da Tela de Descanso' },
  { key: 'inputNamePlaceholder', label: 'Placeholder do Nome' },
  { key: 'inputPhonePlaceholder', label: 'Placeholder do Telefone' },
  { key: 'quizScreenNextButton', label: 'Botão Próxima Pergunta' },
  { key: 'quizScreenFinalizeButton', label: 'Botão Finalizar Quiz' },
  { key: 'resultScreenPrizeWon', label: 'Mensagem de Brinde Ganho' },
  { key: 'resultScreenPrizeNotWon', label: 'Mensagem de Não Premiado' },
  { key: 'resultScreenAllCorrect', label: 'Mensagem de Gabarito Perfeito' },
  { key: 'resultScreenRankingButton', label: 'Botão Ver Ranking (Resultado)' },
  { key: 'resultScreenPlayAgainButton', label: 'Botão Jogar Novamente' },
  { key: 'rankingScreenTitle', label: 'Título do Ranking Geral' },
  { key: 'rankingScreenBackButton', label: 'Botão Voltar ao Início' },
  { key: 'modalAlreadyWonTitle', label: 'Título Modal Trava de Brinde' },
  { key: 'modalAlreadyWonMessage', label: 'Mensagem Modal Trava de Brinde' },
  { key: 'modalIncorrectAnswersTitle', label: 'Título Modal Gabarito de Erros' },
  { key: 'modalAllCorrectMessage', label: 'Mensagem Modal 100% Correto' },
];

const COLOR_FIELD_LABELS: Array<{ key: keyof EventCustomizationColors; label: string }> = [
  { key: 'quizMainBackground', label: 'Fundo Principal' },
  { key: 'quizMainTextColor', label: 'Texto Principal' },
  { key: 'quizHighlightColor', label: 'Cor de Destaque' },
  { key: 'quizPrimaryButtonBg', label: 'Botão Primário (Fundo)' },
  { key: 'quizPrimaryButtonText', label: 'Botão Primário (Texto)' },
  { key: 'quizSecondaryButtonBg', label: 'Botão Secundário (Fundo)' },
  { key: 'quizSecondaryButtonBorder', label: 'Botão Secundário (Borda)' },
  { key: 'quizSecondaryButtonText', label: 'Botão Secundário (Texto)' },
  { key: 'quizOptionBg', label: 'Alternativa (Fundo)' },
  { key: 'quizOptionText', label: 'Alternativa (Texto)' },
  { key: 'quizOptionCorrectBg', label: 'Alternativa Correta' },
  { key: 'quizOptionIncorrectBg', label: 'Alternativa Incorreta' },
  { key: 'quizInputBorder', label: 'Borda dos Campos' },
  { key: 'quizInputPlaceholder', label: 'Placeholder dos Campos' },
];

const FONT_FIELD_LABELS: Array<{ key: keyof EventCustomizationFontSizes; label: string }> = [
  { key: 'mainFontFamily', label: 'Família da Fonte' },
  { key: 'initialSloganFontSize', label: 'Tamanho do Slogan' },
  { key: 'idleCallToActionFontSize', label: 'Tamanho da Chamada Descanso' },
  { key: 'mainButtonsFontSize', label: 'Tamanho dos Botões' },
  { key: 'questionTextFontSize', label: 'Tamanho da Pergunta' },
];

async function readFileAsBytes(file: File): Promise<Uint8Array> {
  if (typeof file.arrayBuffer === 'function') {
    const buffer = await file.arrayBuffer();
    return new Uint8Array(buffer);
  }
  return new Promise<Uint8Array>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      if (result instanceof ArrayBuffer) {
        resolve(new Uint8Array(result));
      } else {
        resolve(new Uint8Array());
      }
    };
    reader.onerror = () => reject(new Error('Falha ao ler arquivo selecionado.'));
    reader.readAsArrayBuffer(file);
  });
}

// Aba administrativa de Personalização Visual por Evento (temas, upload de imagens, edição e pré-visualização).
export function AdminCustomizationTab({
  controller,
  events,
  selectedEventId,
  onSelectEvent,
  onEventsChanged,
  onRegisterSaveHandler,
  onStatusMessage,
}: AdminCustomizationTabProps) {
  const targetEvent = useMemo(
    () => events.find((ev) => ev.id === selectedEventId) ?? events[0] ?? null,
    [events, selectedEventId],
  );

  const [draft, setDraft] = useState<EventCustomizations>(() =>
    structuredClone(targetEvent?.customizations ?? DEFAULT_CUSTOMIZATIONS),
  );
  const [uploadingKind, setUploadingKind] = useState<VisualAssetKind | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (targetEvent) {
      setDraft(structuredClone(targetEvent.customizations));
      controller.clearDirty('customization');
    }
  }, [targetEvent, controller]);

  const markDraftDirty = useCallback(
    (next: EventCustomizations) => {
      setDraft(next);
      controller.markDirty('customization', true);
    },
    [controller],
  );

  const handleSave = useCallback(async () => {
    if (!targetEvent) {
      return;
    }
    setSaving(true);
    try {
      const saved = await controller.saveEventCustomizations(targetEvent.id, draft);
      onStatusMessage(
        'success',
        `Personalização visual salva para "${saved.name}" (versão ${saved.configVersion}).`,
      );
      await onEventsChanged(saved.id);
    } catch (error) {
      onStatusMessage(
        'error',
        error instanceof Error ? error.message : 'Erro ao salvar personalização visual.',
      );
    } finally {
      setSaving(false);
    }
  }, [controller, draft, onEventsChanged, onStatusMessage, targetEvent]);

  useEffect(() => {
    onRegisterSaveHandler(handleSave);
    return () => onRegisterSaveHandler(null);
  }, [handleSave, onRegisterSaveHandler]);

  const handleApplyTheme = (themeId: PredefinedThemeId) => {
    const next = applyPredefinedTheme(draft, themeId);
    markDraftDirty(next);
    const themeName = PREDEFINED_THEMES.find((t) => t.id === themeId)?.name ?? themeId;
    onStatusMessage('success', `Tema "${themeName}" aplicado à pré-visualização. Salve para publicar.`);
  };

  const handleRestoreSection = (section: CustomizationSection | 'all') => {
    const next = restoreDefaultCustomizations(draft, section);
    markDraftDirty(next);
    onStatusMessage(
      'success',
      section === 'all'
        ? 'Todas as personalizações foram restauradas ao padrão CAESB.'
        : 'Seção restaurada para os valores padrão.',
    );
  };

  const handleAssetUpload = async (kind: VisualAssetKind, file: File | null) => {
    if (!targetEvent || !file) {
      return;
    }
    setUploadingKind(kind);
    try {
      const bytes = await readFileAsBytes(file);
      const uploaded = await controller.uploadEventVisualAsset({
        eventId: targetEvent.id,
        kind,
        fileName: file.name,
        mimeType: file.type || 'image/png',
        bytes,
      });

      const next: EventCustomizations = structuredClone(draft);
      if (kind === 'logo') {
        next.visualIdentity.logoFileName = uploaded.fileName;
        next.visualIdentity.logoUrl = uploaded.url;
      } else {
        next.visualIdentity.customBackgroundFileName = uploaded.fileName;
        next.visualIdentity.customBackgroundUrl = uploaded.url;
        next.visualIdentity.enableCustomBackground = true;
      }
      markDraftDirty(next);
      onStatusMessage(
        'success',
        `${kind === 'logo' ? 'Logotipo' : 'Plano de fundo'} enviado para a nuvem (${uploaded.fileName}).`,
      );
    } catch (error) {
      onStatusMessage(
        'error',
        error instanceof Error ? error.message : 'Erro ao enviar imagem para a nuvem.',
      );
    } finally {
      setUploadingKind(null);
    }
  };

  if (!targetEvent) {
    return (
      <section className="admin-panel-card">
        <p className="admin-empty-hint">Crie ou selecione um Evento para personalizar.</p>
      </section>
    );
  }

  const opacityPercent = Math.round(draft.visualIdentity.customBackgroundOpacity * 100);

  return (
    <section id="admin-customization-tab" className="admin-panel-card">
      <div className="admin-panel-header">
        <div>
          <h3>Personalização Visual do Evento</h3>
          <p className="admin-subtitle">
            Aplique temas pré-definidos, envie logotipo e plano de fundo para a nuvem e visualize
            em tempo real.
          </p>
        </div>

        <div className="admin-panel-actions">
          <label className="operator-event-select-label">
            <span>Evento Selecionado</span>
            <select
              aria-label="Evento para Personalizar"
              value={targetEvent.id}
              onChange={(e) => onSelectEvent(e.target.value)}
            >
              {events.map((ev) => (
                <option key={ev.id} value={ev.id}>
                  {ev.name}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            className="admin-btn admin-btn-danger"
            onClick={() => handleRestoreSection('all')}
          >
            Restaurar Padrões
          </button>
          <button
            type="button"
            className="admin-btn admin-btn-primary"
            disabled={saving}
            onClick={() => void handleSave()}
          >
            {saving ? 'Salvando...' : 'Salvar Personalização'}
          </button>
        </div>
      </div>

      <div className="customization-layout-grid">
        <div className="customization-editors-column">
          <div className="customization-section-box">
            <h4>Galeria de Temas Pré-Definidos</h4>
            <div className="themes-gallery-grid">
              {PREDEFINED_THEMES.map((theme) => (
                <button
                  key={theme.id}
                  type="button"
                  className="theme-preset-card"
                  onClick={() => handleApplyTheme(theme.id)}
                >
                  <span
                    className="theme-preset-swatch"
                    style={{
                      backgroundColor: theme.customizations.colors.quizMainBackground,
                      borderColor: theme.customizations.colors.quizPrimaryButtonBg,
                    }}
                  />
                  <strong>{theme.name}</strong>
                </button>
              ))}
            </div>
          </div>

          <div className="customization-section-box">
            <div className="customization-section-header">
              <h4>Identidade Visual (Logotipo e Fundo)</h4>
              <button
                type="button"
                className="admin-btn admin-btn-secondary"
                onClick={() => handleRestoreSection('visualIdentity')}
              >
                Restaurar Identidade Visual
              </button>
            </div>

            <div className="customization-fields-grid">
              <div className="form-group">
                <label htmlFor="upload-logo-input">Upload de Logotipo</label>
                <input
                  id="upload-logo-input"
                  type="file"
                  accept="image/*"
                  disabled={uploadingKind === 'logo'}
                  onChange={(e) => void handleAssetUpload('logo', e.target.files?.[0] ?? null)}
                />
                <small className="operator-card-meta">
                  Atual: {draft.visualIdentity.logoUrl || draft.visualIdentity.logoFileName}
                </small>
              </div>

              <div className="form-group">
                <label htmlFor="upload-background-input">Upload de Plano de Fundo</label>
                <input
                  id="upload-background-input"
                  type="file"
                  accept="image/*"
                  disabled={uploadingKind === 'background'}
                  onChange={(e) =>
                    void handleAssetUpload('background', e.target.files?.[0] ?? null)
                  }
                />
                <small className="operator-card-meta">
                  Atual:{' '}
                  {draft.visualIdentity.customBackgroundUrl ||
                    draft.visualIdentity.customBackgroundFileName ||
                    'Nenhum'}
                </small>
              </div>
            </div>

            <div className="customization-fields-grid">
              <label className="admin-checkbox-label">
                <input
                  type="checkbox"
                  checked={draft.visualIdentity.enableCustomBackground}
                  onChange={(e) =>
                    markDraftDirty({
                      ...draft,
                      visualIdentity: {
                        ...draft.visualIdentity,
                        enableCustomBackground: e.target.checked,
                      },
                    })
                  }
                />
                Ativar plano de fundo personalizado
              </label>

              <div className="form-group">
                <label htmlFor="background-opacity-slider">
                  Opacidade do Plano de Fundo ({opacityPercent}%)
                </label>
                <input
                  id="background-opacity-slider"
                  type="range"
                  min={0}
                  max={100}
                  value={opacityPercent}
                  onChange={(e) =>
                    markDraftDirty({
                      ...draft,
                      visualIdentity: {
                        ...draft.visualIdentity,
                        customBackgroundOpacity: Number(e.target.value) / 100,
                      },
                    })
                  }
                />
              </div>
            </div>
          </div>

          <div className="customization-section-box">
            <div className="customization-section-header">
              <h4>Cores e Tipografia</h4>
              <button
                type="button"
                className="admin-btn admin-btn-secondary"
                onClick={() => handleRestoreSection('appearance')}
              >
                Restaurar Aparência
              </button>
            </div>

            <div className="customization-colors-grid">
              {COLOR_FIELD_LABELS.map(({ key, label }) => (
                <div key={key} className="form-group">
                  <label htmlFor={`color-${key}`}>{label}</label>
                  <div className="color-input-pair">
                    <input
                      id={`color-${key}`}
                      type="color"
                      value={
                        /^#[0-9a-fA-F]{6}$/.test(draft.colors[key])
                          ? draft.colors[key]
                          : '#002244'
                      }
                      onChange={(e) =>
                        markDraftDirty({
                          ...draft,
                          colors: { ...draft.colors, [key]: e.target.value },
                        })
                      }
                    />
                    <input
                      type="text"
                      aria-label={`${label} (Hex)`}
                      value={draft.colors[key]}
                      onChange={(e) =>
                        markDraftDirty({
                          ...draft,
                          colors: { ...draft.colors, [key]: e.target.value },
                        })
                      }
                    />
                  </div>
                </div>
              ))}
            </div>

            <div className="customization-fields-grid">
              {FONT_FIELD_LABELS.map(({ key, label }) => (
                <div key={key} className="form-group">
                  <label htmlFor={`font-${key}`}>{label}</label>
                  <input
                    id={`font-${key}`}
                    type="text"
                    value={draft.fontSizes[key]}
                    onChange={(e) =>
                      markDraftDirty({
                        ...draft,
                        fontSizes: { ...draft.fontSizes, [key]: e.target.value },
                      })
                    }
                  />
                </div>
              ))}
            </div>
          </div>

          <div className="customization-section-box">
            <div className="customization-section-header">
              <h4>Textos da Interface</h4>
              <button
                type="button"
                className="admin-btn admin-btn-secondary"
                onClick={() => handleRestoreSection('texts')}
              >
                Restaurar Textos
              </button>
            </div>

            <div className="customization-fields-grid">
              {TEXT_FIELD_LABELS.map(({ key, label }) => (
                <div key={key} className="form-group">
                  <label htmlFor={`text-${key}`}>{label}</label>
                  <input
                    id={`text-${key}`}
                    type="text"
                    value={draft.texts[key]}
                    onChange={(e) =>
                      markDraftDirty({
                        ...draft,
                        texts: { ...draft.texts, [key]: e.target.value },
                      })
                    }
                  />
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="customization-preview-column">
          <h4>Pré-Visualização ao Vivo</h4>
          <CustomizationPreview customizations={draft} />
        </div>
      </div>
    </section>
  );
}
