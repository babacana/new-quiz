import { useState } from 'react';
import type { LayoutScreenId } from '../domain/screenLayout';
import type { EventCustomizations } from '../domain/types';
import { LayoutPreviewStage } from './LayoutPreviewStage';
import { PreviewResolutionControls } from './PreviewResolutionControls';
import { usePreviewResolution } from './usePreviewResolution';
import { cn } from './lib/utils';

export interface CustomizationPreviewProps {
  customizations: EventCustomizations;
  /** Aviso LGPD configurado no Evento (vazio = não aparece, como no Totem real). */
  lgpdNoticeText?: string;
}

const PREVIEW_TABS: readonly { id: LayoutScreenId; label: string }[] = [
  { id: 'initial', label: 'Tela Inicial' },
  { id: 'idle', label: 'Tela de Descanso' },
  { id: 'quiz', label: 'Tela de Quiz' },
  { id: 'result', label: 'Tela de Resultado' },
  { id: 'ranking', label: 'Tela de Ranking' },
];

// Pré-visualização ao vivo de textos, cores, fontes, logotipo e fundo: é o próprio Totem (mesmo componente da aba
// Layout das Telas), carregado em um iframe na resolução escolhida e reduzido apenas visualmente.
export function CustomizationPreview({
  customizations,
  lgpdNoticeText = '',
}: CustomizationPreviewProps) {
  const [previewScreen, setPreviewScreen] = useState<LayoutScreenId>('initial');
  const [quizAnswered, setQuizAnswered] = useState(false);
  const [resolution, persistResolution] = usePreviewResolution();

  return (
    <div className="space-y-3">
      <div
        className="flex flex-wrap gap-1.5 rounded-lg border border-border bg-muted/60 p-1"
        role="tablist"
        aria-label="Telas de pré-visualização"
      >
        {PREVIEW_TABS.map((tab) => {
          const isSelected = previewScreen === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={isSelected}
              className={cn(
                'flex-1 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors',
                isSelected
                  ? 'bg-primary text-primary-foreground shadow-xs'
                  : 'text-muted-foreground hover:bg-muted hover:text-foreground',
              )}
              onClick={() => setPreviewScreen(tab.id)}
            >
              {tab.label}
            </button>
          );
        })}
      </div>

      <PreviewResolutionControls
        resolution={resolution}
        onChange={persistResolution}
        idPrefix="customization"
      />

      {previewScreen === 'quiz' && (
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            className="h-4 w-4 rounded border-input"
            checked={quizAnswered}
            onChange={(e) => setQuizAnswered(e.target.checked)}
          />
          Mostrar a pergunta já respondida
        </label>
      )}

      <div id="customization-live-preview">
        <LayoutPreviewStage
          screenId={previewScreen}
          customizations={customizations}
          lgpdNoticeText={lgpdNoticeText}
          quizAnswered={quizAnswered}
          showConditional={false}
          highlightedElementId={null}
          interactive={false}
          width={resolution.width}
          height={resolution.height}
        />
      </div>
    </div>
  );
}
