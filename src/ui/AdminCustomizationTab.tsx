import { useCallback, useEffect, useMemo, useState } from 'react';
import { Eye, Image, Palette, Pencil, RotateCcw, Save, Type } from 'lucide-react';
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
  EventVisualAssetRecord,
  PredefinedThemeId,
  VisualAssetKind,
} from '../domain/types';
import { CustomizationPreview } from './CustomizationPreview';
import { VisualAssetLibrary } from './VisualAssetLibrary';
import { Button } from './components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './components/ui/card';
import { Input } from './components/ui/input';
import { Label } from './components/ui/label';
import { cn } from './lib/utils';
import type { UnsavedNavigationGuard } from './navigationGuard';

export interface AdminCustomizationTabProps {
  controller: EventAdminController;
  navigationGuard: UnsavedNavigationGuard;
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

// Aba administrativa de Aparência do Totem: sub-seções SaaS, split-view desktop, alternância Editar/Pré-visualizar mobile e sticky action bar.
export function AdminCustomizationTab({
  controller,
  navigationGuard,
  events,
  selectedEventId,
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
  const [isDirty, setIsDirty] = useState(false);
  const [mobilePane, setMobilePane] = useState<'editor' | 'preview'>('editor');
  const [uploadingKind, setUploadingKind] = useState<VisualAssetKind | null>(null);
  const [saving, setSaving] = useState(false);
  const [visualAssets, setVisualAssets] = useState<EventVisualAssetRecord[]>([]);
  const [loadingAssets, setLoadingAssets] = useState(false);

  const loadVisualAssets = useCallback(async () => {
    setLoadingAssets(true);
    try {
      const list = await controller.listEventVisualAssets();
      setVisualAssets(list);
    } catch {
      // Falha ao listar imagens existentes não impede a edição do Evento.
    } finally {
      setLoadingAssets(false);
    }
  }, [controller]);

  useEffect(() => {
    void loadVisualAssets();
  }, [loadVisualAssets, targetEvent?.id]);

  const resetFromEvent = useCallback(
    (ev: EventConfig) => {
      setDraft(structuredClone(ev.customizations));
      setIsDirty(false);
      navigationGuard.clearDirty('customization');
    },
    [navigationGuard],
  );

  useEffect(() => {
    if (targetEvent) {
      resetFromEvent(targetEvent);
    }
  }, [targetEvent, resetFromEvent]);

  const markDraftDirty = useCallback(
    (next: EventCustomizations) => {
      setDraft(next);
      setIsDirty(true);
      navigationGuard.markDirty('customization', true);
    },
    [navigationGuard],
  );

  const handleSave = useCallback(async () => {
    if (!targetEvent) {
      return;
    }
    setSaving(true);
    try {
      // O layout das telas tem editor próprio (aba Layout das Telas) e não deve ser sobrescrito aqui.
      const saved = await controller.saveEventCustomizations(targetEvent.id, {
        texts: draft.texts,
        colors: draft.colors,
        fontSizes: draft.fontSizes,
        visualIdentity: draft.visualIdentity,
      });
      setIsDirty(false);
      navigationGuard.clearDirty('customization');
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
  }, [controller, draft, navigationGuard, onEventsChanged, onStatusMessage, targetEvent]);

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
      void loadVisualAssets();
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

  const handleSelectLibraryAsset = (asset: EventVisualAssetRecord) => {
    const next: EventCustomizations = structuredClone(draft);
    if (asset.kind === 'logo') {
      next.visualIdentity.logoFileName = asset.fileName;
      next.visualIdentity.logoUrl = asset.url;
    } else {
      next.visualIdentity.customBackgroundFileName = asset.fileName;
      next.visualIdentity.customBackgroundUrl = asset.url;
      next.visualIdentity.enableCustomBackground = true;
    }
    markDraftDirty(next);
    onStatusMessage(
      'success',
      `${asset.kind === 'logo' ? 'Logotipo' : 'Plano de fundo'} "${asset.fileName}" aplicado na pré-visualização. Salve para publicar.`,
    );
  };

  const handleDeleteLibraryAsset = async (asset: EventVisualAssetRecord) => {
    try {
      await controller.deleteEventVisualAsset(asset.storagePath);

      if (asset.kind === 'logo' && draft.visualIdentity.logoUrl === asset.url) {
        const fallbackLogo = targetEvent?.customizations.visualIdentity;
        const next: EventCustomizations = structuredClone(draft);
        next.visualIdentity.logoUrl =
          fallbackLogo?.logoUrl && fallbackLogo.logoUrl !== asset.url
            ? fallbackLogo.logoUrl
            : DEFAULT_CUSTOMIZATIONS.visualIdentity.logoUrl;
        next.visualIdentity.logoFileName =
          fallbackLogo?.logoUrl && fallbackLogo.logoUrl !== asset.url
            ? fallbackLogo.logoFileName
            : DEFAULT_CUSTOMIZATIONS.visualIdentity.logoFileName;
        setDraft(next);
      } else if (
        asset.kind === 'background' &&
        draft.visualIdentity.customBackgroundUrl === asset.url
      ) {
        const fallbackBg = targetEvent?.customizations.visualIdentity;
        const next: EventCustomizations = structuredClone(draft);
        const keepSaved =
          fallbackBg?.customBackgroundUrl && fallbackBg.customBackgroundUrl !== asset.url;
        next.visualIdentity.customBackgroundUrl = keepSaved
          ? fallbackBg.customBackgroundUrl
          : DEFAULT_CUSTOMIZATIONS.visualIdentity.customBackgroundUrl;
        next.visualIdentity.customBackgroundFileName = keepSaved
          ? fallbackBg.customBackgroundFileName
          : DEFAULT_CUSTOMIZATIONS.visualIdentity.customBackgroundFileName;
        if (!keepSaved) {
          next.visualIdentity.enableCustomBackground = false;
        }
        setDraft(next);
      }

      await loadVisualAssets();
      onStatusMessage('success', `Imagem "${asset.fileName}" excluída do armazenamento.`);
    } catch (error) {
      onStatusMessage(
        'error',
        error instanceof Error ? error.message : 'Erro ao excluir imagem do armazenamento.',
      );
      throw error;
    }
  };

  if (!targetEvent) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Personalização Visual do Evento</CardTitle>
          <CardDescription>Crie ou selecione um Evento para personalizar.</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  const opacityPercent = Math.round(draft.visualIdentity.customBackgroundOpacity * 100);

  return (
    <div id="admin-customization-tab" className="space-y-6 pb-20">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Personalização Visual do Evento</h1>
          <p className="text-sm text-muted-foreground">
            Editando <strong>{targetEvent.name}</strong> (v{targetEvent.configVersion}) — mudanças
            refletem no preview isolado do Totem.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant="destructive"
            size="sm"
            onClick={() => handleRestoreSection('all')}
          >
            <RotateCcw className="h-4 w-4" />
            Restaurar Padrões
          </Button>
        </div>
      </div>

      {/* Alternância Editar / Pré-visualizar em telas menores */}
      <div
        data-testid="customization-mobile-toggle"
        className="inline-flex w-full rounded-lg border border-border bg-muted/40 p-1 lg:hidden"
      >
        <Button
          type="button"
          variant={mobilePane === 'editor' ? 'default' : 'ghost'}
          size="sm"
          className="flex-1"
          onClick={() => setMobilePane('editor')}
        >
          <Pencil className="h-4 w-4" />
          Editar
        </Button>
        <Button
          type="button"
          variant={mobilePane === 'preview' ? 'default' : 'ghost'}
          size="sm"
          className="flex-1"
          onClick={() => setMobilePane('preview')}
        >
          <Eye className="h-4 w-4" />
          Pré-visualizar
        </Button>
      </div>

      {/* Split-view no desktop (lg+) */}
      <div className="lg:grid lg:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)] lg:items-start lg:gap-6">
        <div
          data-testid="customization-editor-pane"
          data-mobile-visible={mobilePane === 'editor' ? 'true' : 'false'}
          className={cn('space-y-6', mobilePane !== 'editor' && 'hidden lg:block')}
        >
          {/* Sub-seção 1: Galeria de Temas */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-lg">
                <Palette className="h-4 w-4 text-muted-foreground" />
                Galeria de Temas Pré-Definidos
              </CardTitle>
              <CardDescription>
                Aplique um tema base instantaneamente e ajuste os detalhes abaixo se desejar.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
                {PREDEFINED_THEMES.map((theme) => (
                  <button
                    key={theme.id}
                    type="button"
                    onClick={() => handleApplyTheme(theme.id)}
                    className="flex cursor-pointer items-center gap-2.5 rounded-lg border border-border bg-background p-2.5 text-left text-sm font-medium transition-colors hover:bg-accent hover:text-accent-foreground"
                  >
                    <span
                      className="h-6 w-6 shrink-0 rounded-full border-2"
                      style={{
                        backgroundColor: theme.customizations.colors.quizMainBackground,
                        borderColor: theme.customizations.colors.quizPrimaryButtonBg,
                      }}
                    />
                    <span className="truncate">{theme.name}</span>
                  </button>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* Sub-seção 2: Identidade Visual (Logo & Plano de Fundo) */}
          <Card>
            <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
              <div>
                <CardTitle className="flex items-center gap-2 text-lg">
                  <Image className="h-4 w-4 text-muted-foreground" />
                  Identidade Visual (Logotipo e Fundo)
                </CardTitle>
                <CardDescription>
                  Envie logotipo e imagem de fundo armazenados na nuvem para uso offline nos Totens.
                </CardDescription>
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => handleRestoreSection('visualIdentity')}
              >
                Restaurar Identidade Visual
              </Button>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="upload-logo-input">Upload de Logotipo</Label>
                  <Input
                    id="upload-logo-input"
                    type="file"
                    accept="image/*"
                    disabled={uploadingKind === 'logo'}
                    onChange={(e) => {
                      const file = e.target.files?.[0] ?? null;
                      e.target.value = '';
                      void handleAssetUpload('logo', file);
                    }}
                  />
                  <p className="truncate text-xs text-muted-foreground">
                    Atual: {draft.visualIdentity.logoUrl || draft.visualIdentity.logoFileName}
                  </p>
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="upload-background-input">Upload de Plano de Fundo</Label>
                  <Input
                    id="upload-background-input"
                    type="file"
                    accept="image/*"
                    disabled={uploadingKind === 'background'}
                    onChange={(e) => {
                      const file = e.target.files?.[0] ?? null;
                      e.target.value = '';
                      void handleAssetUpload('background', file);
                    }}
                  />
                  <p className="truncate text-xs text-muted-foreground">
                    Atual:{' '}
                    {draft.visualIdentity.customBackgroundUrl ||
                      draft.visualIdentity.customBackgroundFileName ||
                      'Nenhum'}
                  </p>
                </div>
              </div>

              <div className="grid gap-4 sm:grid-cols-2 sm:items-center">
                <label className="flex items-center gap-2 text-sm">
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
                    className="h-4 w-4 rounded border-input"
                  />
                  Ativar plano de fundo personalizado
                </label>

                <div className="space-y-1.5">
                  <Label htmlFor="background-opacity-slider">
                    Opacidade do Plano de Fundo ({opacityPercent}%)
                  </Label>
                  <input
                    id="background-opacity-slider"
                    type="range"
                    min={0}
                    max={100}
                    value={opacityPercent}
                    className="w-full accent-primary"
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

              <VisualAssetLibrary
                assets={visualAssets}
                loading={loadingAssets}
                events={events}
                currentEventId={targetEvent.id}
                activeLogoUrl={draft.visualIdentity.logoUrl ?? null}
                activeBackgroundUrl={draft.visualIdentity.customBackgroundUrl ?? null}
                onRefresh={() => void loadVisualAssets()}
                onSelectAsset={handleSelectLibraryAsset}
                onDeleteAsset={handleDeleteLibraryAsset}
              />
            </CardContent>
          </Card>

          {/* Sub-seção 3: Cores e Tipografia */}
          <Card>
            <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
              <div>
                <CardTitle className="flex items-center gap-2 text-lg">
                  <Type className="h-4 w-4 text-muted-foreground" />
                  Cores e Tipografia
                </CardTitle>
                <CardDescription>
                  Paleta completa do Totem e tamanhos de fonte para leitura à distância.
                </CardDescription>
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => handleRestoreSection('appearance')}
              >
                Restaurar Aparência
              </Button>
            </CardHeader>
            <CardContent className="space-y-5">
              <div className="grid gap-3 sm:grid-cols-2">
                {COLOR_FIELD_LABELS.map(({ key, label }) => (
                  <div key={key} className="space-y-1.5">
                    <Label htmlFor={`color-${key}`}>{label}</Label>
                    <div className="flex items-center gap-2">
                      <input
                        id={`color-${key}`}
                        type="color"
                        className="h-9 w-11 shrink-0 cursor-pointer rounded-md border border-input bg-background p-0.5"
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
                      <Input
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

              <div className="grid gap-3 sm:grid-cols-2">
                {FONT_FIELD_LABELS.map(({ key, label }) => (
                  <div key={key} className="space-y-1.5">
                    <Label htmlFor={`font-${key}`}>{label}</Label>
                    <Input
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
            </CardContent>
          </Card>

          {/* Sub-seção 4: Textos da Interface */}
          <Card>
            <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
              <div>
                <CardTitle className="text-lg">Textos da Interface</CardTitle>
                <CardDescription>
                  Mensagens exibidas nas telas do Totem e nos modais de feedback.
                </CardDescription>
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => handleRestoreSection('texts')}
              >
                Restaurar Textos
              </Button>
            </CardHeader>
            <CardContent>
              <div className="grid gap-3 sm:grid-cols-2">
                {TEXT_FIELD_LABELS.map(({ key, label }) => (
                  <div key={key} className="space-y-1.5">
                    <Label htmlFor={`text-${key}`}>{label}</Label>
                    <Input
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
            </CardContent>
          </Card>
        </div>

        {/* Coluna de Preview ao Vivo Isolado */}
        <div
          data-testid="customization-preview-pane"
          data-mobile-visible={mobilePane === 'preview' ? 'true' : 'false'}
          className={cn(
            'lg:sticky lg:top-20 lg:self-start',
            mobilePane !== 'preview' && 'hidden lg:block',
          )}
        >
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Pré-Visualização ao Vivo</CardTitle>
              <CardDescription>
                É o próprio Totem na resolução escolhida, com as cores, textos e fontes atuais (reduzido só visualmente para caber aqui).
              </CardDescription>
            </CardHeader>
            <CardContent>
              <CustomizationPreview
                customizations={draft}
                lgpdNoticeText={targetEvent.settings.lgpdNoticeText ?? ''}
              />
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Barra inferior fixa exibida quando houver alterações não salvas */}
      {isDirty && (
        <div
          data-testid="customization-sticky-action-bar"
          role="region"
          aria-label="Alterações pendentes de aparência"
          className="sticky bottom-0 z-20 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-card/95 px-4 py-3 shadow-lg backdrop-blur-xs"
        >
          <p className="text-sm font-medium text-foreground">
            Você tem alterações não salvas na aparência deste Evento.
          </p>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => resetFromEvent(targetEvent)}
              disabled={saving}
            >
              <RotateCcw className="h-4 w-4" />
              Descartar
            </Button>
            <Button type="button" size="sm" onClick={() => void handleSave()} disabled={saving}>
              <Save className="h-4 w-4" />
              {saving ? 'Salvando...' : 'Salvar Personalização'}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
