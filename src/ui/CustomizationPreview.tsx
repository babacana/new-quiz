import { useState } from 'react';
import type { EventCustomizations } from '../domain/types';
import { EventLogoImage } from './EventLogoImage';
import { buildThemeCssVariables, resolvePreviewVisualAssets } from './themeCss';

export interface CustomizationPreviewProps {
  customizations: EventCustomizations;
}

type PreviewScreenTab = 'initial' | 'quiz' | 'result';

// Pré-visualização interativa ao vivo das alterações de textos, cores, fontes, logotipo e fundo.
export function CustomizationPreview({ customizations }: CustomizationPreviewProps) {
  const [previewScreen, setPreviewScreen] = useState<PreviewScreenTab>('initial');
  const themeStyle = buildThemeCssVariables(customizations);
  const { logoSrc, backgroundSrc } = resolvePreviewVisualAssets(customizations);
  const { texts, colors, visualIdentity } = customizations;

  return (
    <div className="customization-preview-wrapper">
      <div className="customization-preview-toolbar" role="tablist" aria-label="Telas de pré-visualização">
        <button
          type="button"
          role="tab"
          aria-selected={previewScreen === 'initial'}
          className={`admin-tab-btn ${previewScreen === 'initial' ? 'active' : ''}`}
          onClick={() => setPreviewScreen('initial')}
        >
          Tela Inicial
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={previewScreen === 'quiz'}
          className={`admin-tab-btn ${previewScreen === 'quiz' ? 'active' : ''}`}
          onClick={() => setPreviewScreen('quiz')}
        >
          Tela de Quiz
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={previewScreen === 'result'}
          className={`admin-tab-btn ${previewScreen === 'result' ? 'active' : ''}`}
          onClick={() => setPreviewScreen('result')}
        >
          Tela de Resultado
        </button>
      </div>

      <div
        id="customization-live-preview"
        className="customization-live-preview-stage"
        style={themeStyle}
      >
        {backgroundSrc && (
          <div
            className="quiz-custom-background-layer"
            style={{
              backgroundImage: `url(${backgroundSrc})`,
              opacity: visualIdentity.customBackgroundOpacity,
            }}
            aria-hidden="true"
          />
        )}

        <div className="customization-preview-inner">
          <EventLogoImage
            src={logoSrc}
            alt="Pré-visualização do logotipo"
            className="customization-preview-logo"
          />

          {previewScreen === 'initial' && (
            <div className="customization-preview-screen">
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
                style={{
                  borderColor: colors.quizInputBorder,
                  color: colors.quizMainTextColor,
                }}
              />
              <div className="customization-preview-buttons">
                <button
                  type="button"
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
            <div className="customization-preview-screen">
              <p
                style={{
                  fontSize: customizations.fontSizes.questionTextFontSize,
                  color: colors.quizMainTextColor,
                  fontWeight: 600,
                }}
              >
                Qual é o principal serviço prestado pela CAESB no DF?
              </p>
              <div className="customization-preview-options">
                <div
                  className="customization-preview-option"
                  style={{
                    backgroundColor: colors.quizOptionCorrectBg,
                    color: '#ffffff',
                  }}
                >
                  A) Saneamento básico e água tratada
                </div>
                <div
                  className="customization-preview-option"
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
            <div className="customization-preview-screen">
              <h4 style={{ color: colors.quizHighlightColor }}>MARIA CLARA,</h4>
              <p style={{ color: colors.quizOptionCorrectBg, fontWeight: 700 }}>
                {texts.resultScreenPrizeWon}
              </p>
              <p style={{ color: colors.quizMainTextColor }}>{texts.resultScreenAllCorrect}</p>
              <div className="customization-preview-buttons">
                <button
                  type="button"
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
