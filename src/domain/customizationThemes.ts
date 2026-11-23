import { DEFAULT_CUSTOMIZATIONS } from './defaults';
import { sanitizeEventLayout } from './screenLayout';
import type {
  CustomizationSection,
  EventCustomizations,
  EventCustomizationsPatch,
  PredefinedThemeDefinition,
  PredefinedThemeId,
} from './types';

export const PREDEFINED_THEMES: readonly PredefinedThemeDefinition[] = [
  {
    id: 'caesbDefault',
    name: 'Padrão CAESB',
    customizations: structuredClone(DEFAULT_CUSTOMIZATIONS),
  },
  {
    id: 'lightModern',
    name: 'Claro Moderno',
    customizations: {
      texts: { ...DEFAULT_CUSTOMIZATIONS.texts },
      colors: {
        quizMainBackground: '#f0f4f8',
        quizPrimaryButtonBg: '#007bff',
        quizPrimaryButtonText: '#ffffff',
        quizSecondaryButtonBg: '#e9ecef',
        quizSecondaryButtonBorder: '#ced4da',
        quizSecondaryButtonText: '#212529',
        quizMainTextColor: '#212529',
        quizHighlightColor: '#0056b3',
        quizOptionBg: '#ffffff',
        quizOptionText: '#343a40',
        quizOptionCorrectBg: '#28a745',
        quizOptionIncorrectBg: '#dc3545',
        quizInputBorder: '#ced4da',
        quizInputPlaceholder: '#6c757d',
      },
      fontSizes: {
        ...DEFAULT_CUSTOMIZATIONS.fontSizes,
        mainFontFamily: 'Arial, Helvetica, sans-serif',
      },
      visualIdentity: {
        logoFileName: 'logo.png',
        logoUrl: null,
        customBackgroundFileName: '',
        customBackgroundUrl: null,
        enableCustomBackground: false,
        customBackgroundOpacity: 1,
      },
    },
  },
  {
    id: 'darkElegant',
    name: 'Escuro Elegante',
    customizations: {
      texts: { ...DEFAULT_CUSTOMIZATIONS.texts },
      colors: {
        quizMainBackground: '#1a1a2e',
        quizPrimaryButtonBg: '#e94560',
        quizPrimaryButtonText: '#ffffff',
        quizSecondaryButtonBg: '#16213e',
        quizSecondaryButtonBorder: '#0f3460',
        quizSecondaryButtonText: '#ffffff',
        quizMainTextColor: '#e0e0e0',
        quizHighlightColor: '#e94560',
        quizOptionBg: '#0f3460',
        quizOptionText: '#e0e0e0',
        quizOptionCorrectBg: '#51cf66',
        quizOptionIncorrectBg: '#ff6b6b',
        quizInputBorder: '#0f3460',
        quizInputPlaceholder: 'rgba(224, 224, 224, 0.5)',
      },
      fontSizes: {
        ...DEFAULT_CUSTOMIZATIONS.fontSizes,
        mainFontFamily: 'Verdana, Geneva, sans-serif',
      },
      visualIdentity: {
        logoFileName: 'logo.png',
        logoUrl: null,
        customBackgroundFileName: 'bg_dark_elegant.png',
        customBackgroundUrl: null,
        enableCustomBackground: true,
        customBackgroundOpacity: 0.3,
      },
    },
  },
];

// Mescla um patch parcial de personalizações preservando campos existentes não sobrescritos.
export function mergeEventCustomizations(
  base: EventCustomizations,
  patch?: EventCustomizationsPatch,
): EventCustomizations {
  return {
    texts: { ...base.texts, ...(patch?.texts ?? {}) },
    colors: { ...base.colors, ...(patch?.colors ?? {}) },
    fontSizes: { ...base.fontSizes, ...(patch?.fontSizes ?? {}) },
    visualIdentity: { ...base.visualIdentity, ...(patch?.visualIdentity ?? {}) },
    ...(patch?.layout !== undefined
      ? { layout: sanitizeEventLayout(patch.layout) }
      : base.layout !== undefined
        ? { layout: base.layout }
        : {}),
  };
}

// Aplica um tema pré-definido da galeria preservando textos personalizados e imagens em nuvem já vinculadas.
export function applyPredefinedTheme(
  current: EventCustomizations | undefined,
  themeId: PredefinedThemeId,
  options: { includeTexts?: boolean } = {},
): EventCustomizations {
  const base = current ? structuredClone(current) : structuredClone(DEFAULT_CUSTOMIZATIONS);
  const preset =
    PREDEFINED_THEMES.find((theme) => theme.id === themeId) ?? PREDEFINED_THEMES[0]!;
  const presetClone = structuredClone(preset.customizations);

  return {
    ...(base.layout !== undefined ? { layout: base.layout } : {}),
    texts: options.includeTexts ? presetClone.texts : base.texts,
    colors: presetClone.colors,
    fontSizes: presetClone.fontSizes,
    visualIdentity: {
      ...presetClone.visualIdentity,
      logoFileName: base.visualIdentity.logoFileName || presetClone.visualIdentity.logoFileName,
      logoUrl: base.visualIdentity.logoUrl ?? null,
      customBackgroundFileName:
        base.visualIdentity.customBackgroundUrl
          ? base.visualIdentity.customBackgroundFileName
          : presetClone.visualIdentity.customBackgroundFileName,
      customBackgroundUrl: base.visualIdentity.customBackgroundUrl ?? null,
    },
  };
}

// Restaura padrões de fábrica por seção específica ou globalmente ('all').
export function restoreDefaultCustomizations(
  current: EventCustomizations,
  section: CustomizationSection | 'all' = 'all',
): EventCustomizations {
  const defaults = structuredClone(DEFAULT_CUSTOMIZATIONS);
  if (section === 'all') {
    // O layout das telas tem editor próprio e não é afetado pela restauração visual.
    return current.layout !== undefined ? { ...defaults, layout: current.layout } : defaults;
  }

  const next = structuredClone(current);
  switch (section) {
    case 'texts':
      next.texts = defaults.texts;
      return next;
    case 'appearance':
      next.colors = defaults.colors;
      next.fontSizes = defaults.fontSizes;
      return next;
    case 'visualIdentity':
      next.visualIdentity = defaults.visualIdentity;
      return next;
  }
}
