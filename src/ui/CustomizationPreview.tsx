import { useState } from 'react';
import type { EventCustomizations } from '../domain/types';
import { EventLogoImage } from './EventLogoImage';
import { cn } from './lib/utils';
import { buildThemeCssVariables, resolvePreviewVisualAssets } from './themeCss';

export interface CustomizationPreviewProps {
  customizations: EventCustomizations;
}

type PreviewScreenTab = 'initial' | 'quiz' | 'result';

const PREVIEW_TABS: readonly { id: PreviewScreenTab; label: string }[] = [
  { id: 'initial', label: 'Tela Inicial' },
  { id: 'quiz', label: 'Tela de Quiz' },
  { id: 'result', label: 'Tela de Resultado' },
];

// Pré-visualização interativa ao vivo das alterações de textos, cores, fontes, logotipo e fundo.
export function CustomizationPreview({ customizations }: CustomizationPreviewProps) {
  const [previewScreen, setPreviewScreen] = useState<PreviewScreenTab>('initial');
  const themeStyle = buildThemeCssVariables(customizations);
  const { logoSrc, backgroundSrc } = resolvePreviewVisualAssets(customizations);
  const { texts, colors, visualIdentity } = customizations;

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

      <div
        id="customization-live-preview"
        className="relative min-h-[320px] overflow-hidden rounded-xl border border-border p-5 shadow-xs"
        style={{
          ...themeStyle,
          backgroundImage: 'linear-gradient(165deg, var(--quiz-bg-start), var(--quiz-bg-end))',
          color: colors.quizMainTextColor,
        }}
      >
        {backgroundSrc && (
          <div
            className="pointer-events-none absolute inset-0 z-0 bg-cover bg-center bg-no-repeat"
            style={{
              backgroundImage: `url(${backgroundSrc})`,
              opacity: visualIdentity.customBackgroundOpacity,
            }}
            aria-hidden="true"
          />
        )}

        <div className="relative z-10 flex flex-col items-center gap-3 text-center">
          <EventLogoImage
            src={logoSrc}
            alt="Pré-visualização do logotipo"
            className="max-h-14 w-auto object-contain"
          />

          {previewScreen === 'initial' && (
            <div className="flex w-full flex-col items-center gap-2.5">
              <h4 style={{ color: colors.quizHighlightColor }}>{texts.initialScreenTitle}</h4>
              <p
                style={{
                  fontSize: customizations.fontSizes.initialSloganFontSize,
                  color: colors.quizMainTextColor,
                }}
              >
                {texts.initialScreenSlogan}
              </p>
              <input
                type="text"
                readOnly
                value=""
                placeholder={texts.inputNamePlaceholder}
                className="w-full max-w-xs rounded-md border bg-background/10 px-3 py-1.5 text-center text-sm"
                style={{
                  borderColor: colors.quizInputBorder,
                  color: colors.quizMainTextColor,
                }}
              />
              <div className="flex flex-wrap justify-center gap-2">
                <button
                  type="button"
                  className="rounded-lg border border-transparent px-3.5 py-2 font-semibold"
                  style={{
                    backgroundColor: colors.quizPrimaryButtonBg,
                    color: colors.quizPrimaryButtonText,
                    fontSize: customizations.fontSizes.mainButtonsFontSize,
                  }}
                >
                  {texts.initialScreenStartButton}
                </button>
                <button
                  type="button"
                  className="rounded-lg border px-3.5 py-2 font-semibold"
                  style={{
                    backgroundColor: colors.quizSecondaryButtonBg,
                    borderColor: colors.quizSecondaryButtonBorder,
                    color: colors.quizSecondaryButtonText,
                    fontSize: customizations.fontSizes.mainButtonsFontSize,
                  }}
                >
                  {texts.initialScreenRankingButton}
                </button>
              </div>
            </div>
          )}

          {previewScreen === 'quiz' && (
            <div className="flex w-full flex-col items-center gap-2.5">
              <p
                style={{
                  fontSize: customizations.fontSizes.questionTextFontSize,
                  color: colors.quizMainTextColor,
                  fontWeight: 600,
                }}
              >
                Qual é o principal serviço prestado pela CAESB no DF?
              </p>
              <div className="flex w-full flex-col gap-2 text-left text-sm">
                <div
                  className="rounded-lg px-3 py-2 font-semibold"
                  style={{
                    backgroundColor: colors.quizOptionCorrectBg,
                    color: '#ffffff',
                  }}
                >
                  A) Saneamento básico e água tratada
                </div>
                <div
                  className="rounded-lg px-3 py-2 font-semibold"
                  style={{
                    backgroundColor: colors.quizOptionBg,
                    color: colors.quizOptionText,
                  }}
                >
                  B) Transporte coletivo
                </div>
              </div>
              <button
                type="button"
                className="rounded-lg border border-transparent px-3.5 py-2 font-semibold"
                style={{
                  backgroundColor: colors.quizPrimaryButtonBg,
                  color: colors.quizPrimaryButtonText,
                  fontSize: customizations.fontSizes.mainButtonsFontSize,
                }}
              >
                {texts.quizScreenNextButton}
              </button>
            </div>
          )}

          {previewScreen === 'result' && (
            <div className="flex w-full flex-col items-center gap-2.5">
              <h4 style={{ color: colors.quizHighlightColor }}>MARIA CLARA,</h4>
              <p style={{ color: colors.quizOptionCorrectBg, fontWeight: 700 }}>
                {texts.resultScreenPrizeWon}
              </p>
              <p style={{ color: colors.quizMainTextColor }}>{texts.resultScreenAllCorrect}</p>
              <div className="flex flex-wrap justify-center gap-2">
                <button
                  type="button"
                  className="rounded-lg border px-3.5 py-2 font-semibold"
                  style={{
                    backgroundColor: colors.quizSecondaryButtonBg,
                    borderColor: colors.quizSecondaryButtonBorder,
                    color: colors.quizSecondaryButtonText,
                  }}
                >
                  {texts.resultScreenRankingButton}
                </button>
                <button
                  type="button"
                  className="rounded-lg border border-transparent px-3.5 py-2 font-semibold"
                  style={{
                    backgroundColor: colors.quizPrimaryButtonBg,
                    color: colors.quizPrimaryButtonText,
                  }}
                >
                  {texts.resultScreenPlayAgainButton}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
