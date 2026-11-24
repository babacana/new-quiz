import { useCallback, useEffect, useMemo, useState } from 'react';
import { ChevronDown, ChevronUp, Eye, EyeOff, RotateCcw, Save } from 'lucide-react';
import {
  LAYOUT_LIMITS,
  LAYOUT_PRESETS,
  LAYOUT_SCREENS,
  applyLayoutPreset,
  getScreenDefinition,
  isScreenLayoutCustomized,
  moveLayoutElement,
  moveLayoutElementToZone,
  resetScreenLayout,
  resolveScreenLayout,
  updateLayoutElement,
  setLayoutSafeMargin,
  SAFE_MARGIN_LIMITS,
  type SafeMargin,
  type EventLayout,
  type LayoutAlign,
  type LayoutElementDefinition,
  type LayoutElementSettings,
  type LayoutScreenId,
  type LayoutZone,
} from '../domain/screenLayout';
import { DEFAULT_CUSTOMIZATIONS } from '../domain/defaults';
import type { EventAdminController } from '../domain/eventAdminController';
import type { EventConfig } from '../domain/types';
import { LayoutPreviewStage } from './LayoutPreviewStage';
import { PreviewResolutionControls } from './PreviewResolutionControls';
import { usePreviewResolution } from './usePreviewResolution';
import { Button } from './components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './components/ui/card';
import { Label } from './components/ui/label';
import { cn } from './lib/utils';
import type { UnsavedNavigationGuard } from './navigationGuard';

export interface AdminLayoutTabProps {
  controller: EventAdminController;
  navigationGuard: UnsavedNavigationGuard;
  events: EventConfig[];
  selectedEventId: string | null;
  onEventsChanged: (preferredSelectedId?: string) => Promise<void>;
  onRegisterSaveHandler: (handler: (() => Promise<void>) | null) => void;
  onStatusMessage: (type: 'success' | 'error', message: string) => void;
}

const ZONE_LABELS: Record<LayoutZone, string> = { top: 'Topo', center: 'Centro', bottom: 'Base' };
const ALIGN_LABELS: Record<LayoutAlign, string> = { start: 'Esquerda', center: 'Centro', end: 'Direita' };

function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
  disabled,
}: {
  label: string;
  value: T;
  options: ReadonlyArray<{ value: T; label: string }>;
  onChange: (next: T) => void;
  disabled?: boolean;
}) {
  return (
    <div role="group" aria-label={label} className="inline-flex rounded-md border border-border bg-muted/40 p-0.5">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          aria-pressed={value === option.value}
          disabled={disabled}
          onClick={() => onChange(option.value)}
          className={cn(
            'rounded px-2.5 py-1 text-xs font-medium transition-colors disabled:opacity-50',
            value === option.value
              ? 'bg-primary text-primary-foreground shadow-xs'
              : 'text-muted-foreground hover:bg-muted hover:text-foreground',
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

// Aba administrativa de Layout das telas do Totem: posição, ordem, tamanho e espaçamento de cada elemento com prévia fiel.
export function AdminLayoutTab({
  controller,
  navigationGuard,
  events,
  selectedEventId,
  onEventsChanged,
  onRegisterSaveHandler,
  onStatusMessage,
}: AdminLayoutTabProps) {
  const targetEvent = useMemo(
    () => events.find((ev) => ev.id === selectedEventId) ?? events[0] ?? null,
    [events, selectedEventId],
  );

  const [draft, setDraft] = useState<EventLayout | undefined>(targetEvent?.customizations.layout);
  const [isDirty, setIsDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [screenId, setScreenId] = useState<LayoutScreenId>('initial');
  const [selectedElementId, setSelectedElementId] = useState<string | null>(null);
  const [mobilePane, setMobilePane] = useState<'editor' | 'preview'>('editor');
  const [quizAnswered, setQuizAnswered] = useState(false);
  const [showConditional, setShowConditional] = useState(false);
  const [resolution, persistResolution] = usePreviewResolution();

  const resetFromEvent = useCallback(
    (ev: EventConfig) => {
      setDraft(ev.customizations.layout);
      setIsDirty(false);
      navigationGuard.clearDirty('layout');
    },
    [navigationGuard],
  );

  useEffect(() => {
    if (targetEvent) {
      resetFromEvent(targetEvent);
    }
  }, [targetEvent, resetFromEvent]);

  useEffect(() => {
    setSelectedElementId(null);
  }, [screenId]);

  const updateDraft = useCallback(
    (next: EventLayout) => {
      setDraft(next);
      setIsDirty(true);
      navigationGuard.markDirty('layout', true);
    },
    [navigationGuard],
  );

  const handleSave = useCallback(async () => {
    if (!targetEvent) {
      return;
    }
    setSaving(true);
    try {
      const saved = await controller.saveEventCustomizations(targetEvent.id, {
        layout: draft ?? { version: 1, screens: {} },
      });
      setIsDirty(false);
      navigationGuard.clearDirty('layout');
      onStatusMessage(
        'success',
        `Layout das telas salvo para "${saved.name}" (versão ${saved.configVersion}). Os Totens aplicam na próxima sincronização.`,
      );
      await onEventsChanged(saved.id);
    } catch (error) {
      onStatusMessage('error', error instanceof Error ? error.message : 'Erro ao salvar layout.');
    } finally {
      setSaving(false);
    }
  }, [controller, draft, navigationGuard, onEventsChanged, onStatusMessage, targetEvent]);

  useEffect(() => {
    onRegisterSaveHandler(handleSave);
    return () => onRegisterSaveHandler(null);
  }, [handleSave, onRegisterSaveHandler]);

  const screen = getScreenDefinition(screenId);
  const resolved = useMemo(() => resolveScreenLayout(draft, screenId), [draft, screenId]);
  const previewCustomizations = useMemo(
    () => ({ ...(targetEvent?.customizations ?? DEFAULT_CUSTOMIZATIONS), layout: draft }),
    [targetEvent, draft],
  );

  if (!targetEvent) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Layout das Telas</CardTitle>
          <CardDescription>Crie ou selecione um Evento para editar o layout.</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  const patchElement = (elementId: string, patch: Partial<LayoutElementSettings>) =>
    updateDraft(updateLayoutElement(draft, screenId, elementId, patch));

  const orderedElements: Array<{ definition: LayoutElementDefinition; zone: LayoutZone }> = [];
  (['top', 'center', 'bottom'] as const).forEach((zone) => {
    const inZone = screen.elements
      .filter((el) => resolved.elements[el.id]!.zone === zone)
      .sort(
        (a, b) =>
          resolved.elements[a.id]!.order - resolved.elements[b.id]!.order ||
          screen.elements.indexOf(a) - screen.elements.indexOf(b),
      );
    inZone.forEach((definition) => orderedElements.push({ definition, zone }));
  });

  const selectedDefinition = screen.elements.find((el) => el.id === selectedElementId) ?? null;
  const selectedSettings = selectedDefinition ? resolved.elements[selectedDefinition.id]! : null;
  const presets = LAYOUT_PRESETS.filter((preset) => preset.screenId === screenId);

  return (
    <div id="admin-layout-tab" className="space-y-6 pb-20">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Layout das Telas do Totem</h1>
          <p className="text-sm text-muted-foreground">
            Editando <strong>{targetEvent.name}</strong> (v{targetEvent.configVersion}) — posicione,
            reordene e redimensione cada elemento com prévia na resolução que você escolher.
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={!isScreenLayoutCustomized(draft, screenId)}
          onClick={() => updateDraft(resetScreenLayout(draft, screenId))}
        >
          <RotateCcw className="h-4 w-4" />
          Restaurar layout desta tela
        </Button>
      </div>

      <div
        role="tablist"
        aria-label="Telas editáveis"
        className="flex flex-wrap gap-1.5 rounded-lg border border-border bg-muted/60 p-1"
      >
        {LAYOUT_SCREENS.map((item) => (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={screenId === item.id}
            onClick={() => setScreenId(item.id)}
            className={cn(
              'flex-1 rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
              screenId === item.id
                ? 'bg-primary text-primary-foreground shadow-xs'
                : 'text-muted-foreground hover:bg-muted hover:text-foreground',
            )}
          >
            {item.label}
          </button>
        ))}
      </div>

      <SafeMarginCard
        margin={draft?.safeMargin ?? ZERO_SAFE_MARGIN}
        onChange={(margin) => updateDraft(setLayoutSafeMargin(draft, margin))}
      />

      <div
        data-testid="layout-mobile-toggle"
        className="inline-flex w-full rounded-lg border border-border bg-muted/40 p-1 lg:hidden"
      >
        <Button
          type="button"
          variant={mobilePane === 'editor' ? 'default' : 'ghost'}
          size="sm"
          className="flex-1"
          onClick={() => setMobilePane('editor')}
        >
          Editar
        </Button>
        <Button
          type="button"
          variant={mobilePane === 'preview' ? 'default' : 'ghost'}
          size="sm"
          className="flex-1"
          onClick={() => setMobilePane('preview')}
        >
          Pré-visualizar
        </Button>
      </div>

      <div className="lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:items-start lg:gap-6">
        <div className={cn('space-y-6', mobilePane !== 'editor' && 'hidden lg:block')}>
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Modelos prontos</CardTitle>
              <CardDescription>
                Comece por um modelo e ajuste os elementos depois. Aplicar um modelo substitui o
                layout atual desta tela.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid gap-2.5 sm:grid-cols-2">
                {presets.map((preset) => (
                  <button
                    key={preset.id}
                    type="button"
                    onClick={() => {
                      updateDraft(applyLayoutPreset(draft, preset.id));
                      setSelectedElementId(null);
                    }}
                    className="cursor-pointer rounded-lg border border-border bg-background p-3 text-left transition-colors hover:bg-accent hover:text-accent-foreground"
                  >
                    <span className="block text-sm font-medium">{preset.name}</span>
                    <span className="block text-xs text-muted-foreground">{preset.description}</span>
                  </button>
                ))}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Elementos da {screen.label}</CardTitle>
              <CardDescription>
                Escolha a zona (topo, centro ou base) e a ordem. Clique em um elemento — aqui ou na
                prévia — para ajustar tamanho, espaçamento, alinhamento e cor.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ul className="list-none space-y-2 p-0" data-testid="layout-element-list">
                {orderedElements.map(({ definition, zone }) => {
                  const settings = resolved.elements[definition.id]!;
                  const isSelected = selectedElementId === definition.id;
                  const zoneSiblings = orderedElements.filter((item) => item.zone === zone);
                  const position = zoneSiblings.findIndex((item) => item.definition.id === definition.id);
                  return (
                    <li
                      key={definition.id}
                      data-testid={`layout-element-${definition.id}`}
                      className={cn(
                        'rounded-lg border bg-background p-2.5',
                        isSelected ? 'border-primary ring-1 ring-primary' : 'border-border',
                        !settings.visible && 'opacity-60',
                      )}
                    >
                      <div className="flex flex-wrap items-center gap-2">
                        <button
                          type="button"
                          className="min-w-0 flex-1 cursor-pointer truncate text-left text-sm font-medium"
                          onClick={() => setSelectedElementId(isSelected ? null : definition.id)}
                          aria-expanded={isSelected}
                        >
                          {definition.label}
                        </button>
                        {definition.floating ? (
                          <span className="text-xs text-muted-foreground">Fixo no canto</span>
                        ) : (
                        <Segmented
                          label={`Zona de ${definition.label}`}
                          value={zone}
                          options={(['top', 'center', 'bottom'] as const).map((value) => ({
                            value,
                            label: ZONE_LABELS[value],
                          }))}
                          onChange={(next) =>
                            updateDraft(moveLayoutElementToZone(draft, screenId, definition.id, next))
                          }
                        />
                        )}
                        <div className="inline-flex gap-1">
                          {!definition.floating && (
                            <>
                          <Button
                            type="button"
                            variant="outline"
                            size="icon"
                            className="h-7 w-7"
                            aria-label={`Mover ${definition.label} para cima`}
                            disabled={position <= 0}
                            onClick={() => updateDraft(moveLayoutElement(draft, screenId, definition.id, -1))}
                          >
                            <ChevronUp className="h-4 w-4" />
                          </Button>
                          <Button
                            type="button"
                            variant="outline"
                            size="icon"
                            className="h-7 w-7"
                            aria-label={`Mover ${definition.label} para baixo`}
                            disabled={position === zoneSiblings.length - 1}
                            onClick={() => updateDraft(moveLayoutElement(draft, screenId, definition.id, 1))}
                          >
                            <ChevronDown className="h-4 w-4" />
                          </Button>
                            </>
                          )}
                          <Button
                            type="button"
                            variant="outline"
                            size="icon"
                            className="h-7 w-7"
                            aria-label={`${settings.visible ? 'Ocultar' : 'Mostrar'} ${definition.label}`}
                            aria-pressed={settings.visible}
                            disabled={definition.required}
                            title={definition.required ? 'Este elemento é obrigatório.' : undefined}
                            onClick={() => patchElement(definition.id, { visible: !settings.visible })}
                          >
                            {settings.visible ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
                          </Button>
                        </div>
                      </div>
                      {definition.hint && isSelected && (
                        <p className="mt-1.5 text-xs text-muted-foreground">{definition.hint}</p>
                      )}
                    </li>
                  );
                })}
              </ul>
            </CardContent>
          </Card>

          {selectedDefinition && selectedSettings && (
            <Card data-testid="layout-element-details">
              <CardHeader>
                <CardTitle className="text-lg">Ajustes: {selectedDefinition.label}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex flex-wrap items-center gap-3">
                  <Label>Alinhamento</Label>
                  <Segmented
                    label="Alinhamento do elemento"
                    value={selectedSettings.align}
                    options={(['start', 'center', 'end'] as const).map((value) => ({
                      value,
                      label: ALIGN_LABELS[value],
                    }))}
                    onChange={(align) => patchElement(selectedDefinition.id, { align })}
                  />
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="layout-scale">Tamanho ({selectedSettings.scalePercent}%)</Label>
                  <input
                    id="layout-scale"
                    type="range"
                    min={LAYOUT_LIMITS.scalePercent.min}
                    max={LAYOUT_LIMITS.scalePercent.max}
                    step={5}
                    value={selectedSettings.scalePercent}
                    className="w-full accent-primary"
                    onChange={(e) =>
                      patchElement(selectedDefinition.id, { scalePercent: Number(e.target.value) })
                    }
                  />
                </div>

                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label htmlFor="layout-space-before">
                      Espaço acima ({selectedSettings.spaceBeforeEm})
                    </Label>
                    <input
                      id="layout-space-before"
                      type="range"
                      min={LAYOUT_LIMITS.spaceEm.min}
                      max={LAYOUT_LIMITS.spaceEm.max}
                      step={0.5}
                      value={selectedSettings.spaceBeforeEm}
                      className="w-full accent-primary"
                      onChange={(e) =>
                        patchElement(selectedDefinition.id, { spaceBeforeEm: Number(e.target.value) })
                      }
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="layout-space-after">
                      Espaço abaixo ({selectedSettings.spaceAfterEm})
                    </Label>
                    <input
                      id="layout-space-after"
                      type="range"
                      min={LAYOUT_LIMITS.spaceEm.min}
                      max={LAYOUT_LIMITS.spaceEm.max}
                      step={0.5}
                      value={selectedSettings.spaceAfterEm}
                      className="w-full accent-primary"
                      onChange={(e) =>
                        patchElement(selectedDefinition.id, { spaceAfterEm: Number(e.target.value) })
                      }
                    />
                  </div>
                </div>

                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label htmlFor="layout-offset-x">
                      Deslocar na horizontal ({selectedSettings.offsetXPercent}%)
                    </Label>
                    <input
                      id="layout-offset-x"
                      type="range"
                      min={LAYOUT_LIMITS.offsetPercent.min}
                      max={LAYOUT_LIMITS.offsetPercent.max}
                      step={0.5}
                      value={selectedSettings.offsetXPercent}
                      className="w-full accent-primary"
                      onChange={(e) =>
                        patchElement(selectedDefinition.id, { offsetXPercent: Number(e.target.value) })
                      }
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="layout-offset-y">
                      Deslocar na vertical ({selectedSettings.offsetYPercent}%)
                    </Label>
                    <input
                      id="layout-offset-y"
                      type="range"
                      min={LAYOUT_LIMITS.offsetPercent.min}
                      max={LAYOUT_LIMITS.offsetPercent.max}
                      step={0.5}
                      value={selectedSettings.offsetYPercent}
                      className="w-full accent-primary"
                      onChange={(e) =>
                        patchElement(selectedDefinition.id, { offsetYPercent: Number(e.target.value) })
                      }
                    />
                  </div>
                  <p className="text-xs text-muted-foreground sm:col-span-2">
                    Percentual da largura/altura da tela, então vale para qualquer resolução. Você
                    também pode arrastar o elemento direto na prévia.
                  </p>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="sm:col-span-2 sm:justify-self-start"
                    disabled={selectedSettings.offsetXPercent === 0 && selectedSettings.offsetYPercent === 0}
                    onClick={() =>
                      patchElement(selectedDefinition.id, { offsetXPercent: 0, offsetYPercent: 0 })
                    }
                  >
                    Zerar deslocamento
                  </Button>
                </div>

                {selectedDefinition.supportsColor && (
                  <div className="flex flex-wrap items-center gap-3">
                    <label className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        className="h-4 w-4 rounded border-input"
                        checked={selectedSettings.textColor !== null}
                        onChange={(e) =>
                          patchElement(selectedDefinition.id, {
                            textColor: e.target.checked
                              ? previewCustomizations.colors.quizMainTextColor.startsWith('#')
                                ? previewCustomizations.colors.quizMainTextColor.slice(0, 7)
                                : '#ffffff'
                              : null,
                          })
                        }
                      />
                      Usar cor própria no texto
                    </label>
                    {selectedSettings.textColor !== null && (
                      <input
                        type="color"
                        aria-label="Cor do texto do elemento"
                        className="h-9 w-11 cursor-pointer rounded-md border border-input bg-background p-0.5"
                        value={selectedSettings.textColor.slice(0, 7)}
                        onChange={(e) => patchElement(selectedDefinition.id, { textColor: e.target.value })}
                      />
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
          )}
        </div>

        <div
          data-testid="layout-preview-pane"
          className={cn('lg:sticky lg:top-20 lg:self-start', mobilePane !== 'preview' && 'hidden lg:block')}
        >
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Pré-visualização ao vivo</CardTitle>
              <CardDescription>
                É o próprio Totem, carregado na resolução escolhida (com o mesmo CSS e a mesma regra de palco
                9:16 centralizado) e reduzido só visualmente para caber aqui.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <PreviewResolutionControls resolution={resolution} onChange={persistResolution} />

              {screenId === 'quiz' && (
                <div className="flex flex-wrap items-center gap-3">
                  <Label>Estado da pergunta na prévia</Label>
                  <Segmented
                    label="Estado da pergunta na prévia"
                    value={quizAnswered ? 'answered' : 'open'}
                    options={[
                      { value: 'open', label: 'Antes de responder' },
                      { value: 'answered', label: 'Após responder' },
                    ]}
                    onChange={(next) => setQuizAnswered(next === 'answered')}
                  />
                </div>
              )}

              <label className="flex items-start gap-2 text-sm">
                <input
                  type="checkbox"
                  className="mt-0.5 h-4 w-4 rounded border-input"
                  checked={showConditional}
                  onChange={(e) => setShowConditional(e.target.checked)}
                />
                <span>
                  Mostrar elementos condicionais de exemplo
                  <span className="block text-xs text-muted-foreground">
                    Aviso do Evento, aviso LGPD, aviso de sincronização, mensagem de gabarito
                    perfeito e a Tela de Descanso com o Evento fechado só aparecem no Totem em certas situações. Desligado, a prévia mostra o
                    caso comum.
                  </span>
                </span>
              </label>

              <LayoutPreviewStage
                quizAnswered={quizAnswered}
                screenId={screenId}
                customizations={previewCustomizations}
                lgpdNoticeText={targetEvent.settings.lgpdNoticeText ?? ''}
                showConditional={showConditional}
                width={resolution.width}
                height={resolution.height}
                highlightedElementId={selectedElementId}
                onSelectElement={setSelectedElementId}
                onMoveElement={(id, x, y) => {
                  // Arrastar não pode empurrar o elemento para fora dos limites salvos.
                  setDraft((current) =>
                    updateLayoutElement(current, screenId, id, {
                      offsetXPercent: x,
                      offsetYPercent: y,
                    }),
                  );
                  setIsDirty(true);
                  navigationGuard.markDirty('layout', true);
                }}
              />
            </CardContent>
          </Card>
        </div>
      </div>

      {isDirty && (
        <div
          data-testid="layout-sticky-action-bar"
          role="region"
          aria-label="Alterações pendentes de layout"
          className="sticky bottom-0 z-20 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-card/95 px-4 py-3 shadow-lg backdrop-blur-xs"
        >
          <p className="text-sm font-medium text-foreground">
            Você tem alterações não salvas no layout deste Evento.
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
              {saving ? 'Salvando...' : 'Salvar Layout'}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

const ZERO_SAFE_MARGIN: SafeMargin = { topPercent: 0, rightPercent: 0, bottomPercent: 0, leftPercent: 0 };

const SAFE_MARGIN_SIDES: ReadonlyArray<{ key: keyof SafeMargin; label: string }> = [
  { key: 'topPercent', label: 'Topo' },
  { key: 'bottomPercent', label: 'Base' },
  { key: 'leftPercent', label: 'Esquerda' },
  { key: 'rightPercent', label: 'Direita' },
];

// Para TVs que cortam as bordas (overscan): encolhe o conteúdo para dentro da área realmente visível.
function SafeMarginCard({
  margin,
  onChange,
}: {
  margin: SafeMargin;
  onChange: (margin: SafeMargin) => void;
}) {
  return (
    <Card data-testid="layout-safe-margin">
      <CardHeader>
        <CardTitle className="text-base">Margem de segurança (TV que corta as bordas)</CardTitle>
        <CardDescription>
          Se a TV corta o topo, a base ou as laterais, aumente a margem do lado cortado. Todas as telas
          encolhem para caber na área visível; o fundo continua preenchendo a tela. Em 0% nada muda.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {SAFE_MARGIN_SIDES.map(({ key, label }) => (
            <div key={key} className="space-y-1.5">
              <Label htmlFor={`safe-margin-${key}`}>
                {label} ({margin[key]}%)
              </Label>
              <input
                id={`safe-margin-${key}`}
                type="range"
                min={SAFE_MARGIN_LIMITS.min}
                max={SAFE_MARGIN_LIMITS.max}
                step={0.5}
                value={margin[key]}
                onChange={(event) => onChange({ ...margin, [key]: Number(event.target.value) })}
                className="w-full"
              />
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
