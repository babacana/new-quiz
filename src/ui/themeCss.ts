import type { CSSProperties } from 'react';
import type { EventCustomizations } from '../domain/types';
import { resolveVisualAssetPaths } from '../domain/visualAssetUtils';

// Mapeia cores e tipografia configuráveis do Evento para variáveis CSS do Totem e da pré-visualização.
export function buildThemeCssVariables(customizations: EventCustomizations): CSSProperties {
  const { colors, fontSizes } = customizations;
  return {
    '--quiz-main-background': colors.quizMainBackground,
    '--quiz-primary-button-bg': colors.quizPrimaryButtonBg,
    '--quiz-primary-button-text': colors.quizPrimaryButtonText,
    '--quiz-secondary-button-bg': colors.quizSecondaryButtonBg,
    '--quiz-secondary-button-border': colors.quizSecondaryButtonBorder,
    '--quiz-secondary-button-text': colors.quizSecondaryButtonText,
    '--quiz-main-text-color': colors.quizMainTextColor,
    '--quiz-highlight-color': colors.quizHighlightColor,
    '--quiz-option-bg': colors.quizOptionBg,
    '--quiz-option-text': colors.quizOptionText,
    '--quiz-option-correct-bg': colors.quizOptionCorrectBg,
    '--quiz-option-incorrect-bg': colors.quizOptionIncorrectBg,
    '--quiz-input-border': colors.quizInputBorder,
    '--quiz-input-placeholder': colors.quizInputPlaceholder,
    '--initial-slogan-font-size': fontSizes.initialSloganFontSize,
    '--idle-call-to-action-font-size': fontSizes.idleCallToActionFontSize,
    '--main-buttons-font-size': fontSizes.mainButtonsFontSize,
    '--question-text-font-size': fontSizes.questionTextFontSize,
    '--font-family': fontSizes.mainFontFamily,
    backgroundColor: colors.quizMainBackground,
    color: colors.quizMainTextColor,
    fontFamily: fontSizes.mainFontFamily,
  } as CSSProperties;
}

// Resolve URL exibível de logotipo/fundo no Admin (pré-visualização) com fallback seguro.
export function resolvePreviewVisualAssets(customizations: EventCustomizations): {
  logoSrc: string;
  backgroundSrc: string | null;
} {
  return resolveVisualAssetPaths(customizations.visualIdentity, {}, { allowRemoteFallback: true });
}
