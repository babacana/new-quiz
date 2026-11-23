// Layout configurável das telas do Totem: posição, ordem, tamanho e espaçamento de cada elemento.
// Guardado de forma esparsa em `customizations.layout` (jsonb do Evento): só o que foi alterado é
// salvo, então Eventos antigos (sem layout) continuam idênticos ao visual original.

export type LayoutScreenId = 'initial' | 'idle' | 'quiz' | 'result' | 'ranking';
export type LayoutZone = 'top' | 'center' | 'bottom';
export type LayoutAlign = 'start' | 'center' | 'end';

export const LAYOUT_ZONES: readonly LayoutZone[] = ['top', 'center', 'bottom'];

export const LAYOUT_LIMITS = {
  scalePercent: { min: 50, max: 200 },
  spaceEm: { min: 0, max: 8 },
  offsetPercent: { min: -50, max: 50 },
} as const;

export interface LayoutElementSettings {
  visible: boolean;
  zone: LayoutZone;
  /** Posição dentro da zona (menor aparece primeiro). */
  order: number;
  align: LayoutAlign;
  scalePercent: number;
  spaceBeforeEm: number;
  spaceAfterEm: number;
  /** Deslocamento fino em % da largura/altura do palco (relativo: acompanha a resolução). */
  offsetXPercent: number;
  offsetYPercent: number;
  /** Cor de texto própria do elemento; `null` mantém a cor do tema. */
  textColor: string | null;
}

export interface ScreenLayoutOverrides {
  elements?: Record<string, Partial<LayoutElementSettings>>;
}

export interface EventLayout {
  version: 1;
  screens: Partial<Record<LayoutScreenId, ScreenLayoutOverrides>>;
}

export interface LayoutElementDefinition {
  id: string;
  label: string;
  hint?: string;
  defaultZone: LayoutZone;
  /** Elemento indispensável para o Totem funcionar: não pode ser ocultado. */
  required?: boolean;
  supportsColor?: boolean;
  /** Posicionado de forma absoluta no canto da tela: sem zona, só deslocamento. */
  floating?: boolean;
}

export interface LayoutScreenDefinition {
  id: LayoutScreenId;
  label: string;
  elements: readonly LayoutElementDefinition[];
}

// Ordem do catálogo = ordem original de renderização de cada tela.
export const LAYOUT_SCREENS: readonly LayoutScreenDefinition[] = [
  {
    id: 'initial',
    label: 'Tela Inicial',
    elements: [
      { id: 'logo', label: 'Logotipo', defaultZone: 'center' },
      { id: 'title', label: 'Título', defaultZone: 'center', supportsColor: true },
      { id: 'slogan', label: 'Slogan', defaultZone: 'center', supportsColor: true },
      {
        id: 'statusMessage',
        label: 'Aviso do Evento',
        hint: 'Aparece só quando o Evento ainda não começou ou já terminou.',
        defaultZone: 'center',
      },
      { id: 'intro', label: 'Texto "Preencha seus dados"', defaultZone: 'center', supportsColor: true },
      { id: 'nameField', label: 'Campo Nome', defaultZone: 'center', required: true },
      { id: 'phoneField', label: 'Campo Telefone', defaultZone: 'center', required: true },
      { id: 'lgpd', label: 'Aviso LGPD', defaultZone: 'center', supportsColor: true },
      { id: 'startButton', label: 'Botão Iniciar Quiz', defaultZone: 'center', required: true },
      { id: 'rankingButton', label: 'Botão Ver Ranking', defaultZone: 'center' },
    ],
  },
  {
    id: 'idle',
    label: 'Tela de Descanso',
    elements: [
      { id: 'logo', label: 'Logotipo', defaultZone: 'top' },
      { id: 'slogan', label: 'Slogan', defaultZone: 'top', supportsColor: true },
      { id: 'showcase', label: 'Vitrine (pódio e estatísticas)', defaultZone: 'center' },
      {
        id: 'callToAction',
        label: 'Chamada "Toque para começar"',
        hint: 'Também exibe os avisos de Evento encerrado ou em breve.',
        defaultZone: 'bottom',
        required: true,
        supportsColor: true,
      },
    ],
  },
  {
    id: 'quiz',
    label: 'Tela de Quiz',
    elements: [
      { id: 'logo', label: 'Logotipo', defaultZone: 'top' },
      {
        id: 'progress',
        label: 'Cabeçalho (dificuldade, contador, progresso e tempo)',
        defaultZone: 'top',
      },
      { id: 'question', label: 'Texto da pergunta', defaultZone: 'center', required: true, supportsColor: true },
      { id: 'options', label: 'Alternativas', defaultZone: 'center', required: true },
      {
        id: 'timeBar',
        label: 'Barra de tempo da pergunta',
        hint: 'Também controla o tempo esgotado da pergunta.',
        defaultZone: 'center',
        required: true,
      },
      {
        id: 'postControls',
        label: 'Botão Próxima Pergunta',
        hint: 'Aparece depois de responder. Use "Após responder" na prévia para posicioná-lo.',
        defaultZone: 'center',
        required: true,
      },
      { id: 'giveUp', label: 'Botão Desistir (×)', defaultZone: 'top', floating: true },
    ],
  },
  {
    id: 'result',
    label: 'Tela de Resultado',
    elements: [
      { id: 'logo', label: 'Logotipo', defaultZone: 'center' },
      { id: 'participantName', label: 'Nome do Participante', defaultZone: 'center', supportsColor: true },
      { id: 'prizeMessage', label: 'Mensagem de Brinde', defaultZone: 'center' },
      {
        id: 'syncNotice',
        label: 'Aviso de sincronização',
        hint: 'Aparece só quando há sincronização pendente.',
        defaultZone: 'center',
      },
      { id: 'summary', label: 'Desempenho, tempo e ranking', defaultZone: 'center', supportsColor: true },
      { id: 'allCorrect', label: 'Mensagem de gabarito perfeito', defaultZone: 'center' },
      { id: 'incorrectButton', label: 'Botão "Onde Eu Errei?"', defaultZone: 'center' },
      { id: 'rankingButton', label: 'Botão Ver Ranking', defaultZone: 'center' },
      { id: 'playAgainButton', label: 'Botão Jogar Novamente', defaultZone: 'center', required: true },
    ],
  },
  {
    id: 'ranking',
    label: 'Tela de Ranking',
    elements: [
      { id: 'logo', label: 'Logotipo', defaultZone: 'center' },
      { id: 'title', label: 'Título', defaultZone: 'center', supportsColor: true },
      { id: 'list', label: 'Lista do Ranking', defaultZone: 'center', required: true },
      { id: 'backButton', label: 'Botão Voltar ao Início', defaultZone: 'center', required: true },
    ],
  },
] as const;

export function getScreenDefinition(screenId: LayoutScreenId): LayoutScreenDefinition {
  return LAYOUT_SCREENS.find((screen) => screen.id === screenId) ?? LAYOUT_SCREENS[0]!;
}

export const EMPTY_EVENT_LAYOUT: EventLayout = { version: 1, screens: {} };

export interface ResolvedScreenLayout {
  screenId: LayoutScreenId;
  /** Configuração final de todos os elementos do catálogo da tela. */
  elements: Record<string, LayoutElementSettings>;
  /** Elementos visíveis, já ordenados, por zona. */
  zones: Record<LayoutZone, string[]>;
}

const HEX_COLOR = /^#(?:[0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i;

function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, value));
}

function roundTenth(value: number): number {
  return Math.round(value * 10) / 10;
}

function defaultElementSettings(
  definition: LayoutElementDefinition,
  index: number,
): LayoutElementSettings {
  return {
    visible: true,
    zone: definition.defaultZone,
    order: index * 10,
    align: 'center',
    scalePercent: 100,
    spaceBeforeEm: 0,
    spaceAfterEm: 0,
    offsetXPercent: 0,
    offsetYPercent: 0,
    textColor: null,
  };
}

function sanitizeElement(
  definition: LayoutElementDefinition,
  base: LayoutElementSettings,
  raw: Partial<LayoutElementSettings> | undefined,
): LayoutElementSettings {
  if (!raw || typeof raw !== 'object') {
    return base;
  }
  const { scalePercent, spaceEm, offsetPercent } = LAYOUT_LIMITS;
  return {
    visible: definition.required ? true : typeof raw.visible === 'boolean' ? raw.visible : base.visible,
    zone: LAYOUT_ZONES.includes(raw.zone as LayoutZone) ? (raw.zone as LayoutZone) : base.zone,
    order: clampNumber(raw.order, -10_000, 10_000, base.order),
    align:
      raw.align === 'start' || raw.align === 'center' || raw.align === 'end'
        ? raw.align
        : base.align,
    scalePercent: clampNumber(raw.scalePercent, scalePercent.min, scalePercent.max, base.scalePercent),
    spaceBeforeEm: clampNumber(raw.spaceBeforeEm, spaceEm.min, spaceEm.max, base.spaceBeforeEm),
    spaceAfterEm: clampNumber(raw.spaceAfterEm, spaceEm.min, spaceEm.max, base.spaceAfterEm),
    offsetXPercent: roundTenth(
      clampNumber(raw.offsetXPercent, offsetPercent.min, offsetPercent.max, base.offsetXPercent),
    ),
    offsetYPercent: roundTenth(
      clampNumber(raw.offsetYPercent, offsetPercent.min, offsetPercent.max, base.offsetYPercent),
    ),
    textColor:
      raw.textColor === null
        ? null
        : typeof raw.textColor === 'string' && HEX_COLOR.test(raw.textColor)
          ? raw.textColor
          : base.textColor,
  };
}

// Combina o layout salvo (possivelmente antigo, incompleto ou adulterado) com os padrões da tela.
// Nunca lança: valores inválidos voltam ao padrão e elementos obrigatórios permanecem visíveis.
export function resolveScreenLayout(
  layout: EventLayout | null | undefined,
  screenId: LayoutScreenId,
): ResolvedScreenLayout {
  const definition = getScreenDefinition(screenId);
  const overrides =
    layout && typeof layout === 'object' ? layout.screens?.[screenId]?.elements : undefined;
  const safeOverrides = overrides && typeof overrides === 'object' ? overrides : {};

  const elements: Record<string, LayoutElementSettings> = {};
  definition.elements.forEach((element, index) => {
    const base = defaultElementSettings(element, index);
    elements[element.id] = sanitizeElement(element, base, safeOverrides[element.id]);
  });

  const zones: Record<LayoutZone, string[]> = { top: [], center: [], bottom: [] };
  const catalogIndex = new Map(definition.elements.map((element, index) => [element.id, index]));
  for (const zone of LAYOUT_ZONES) {
    zones[zone] = definition.elements
      .filter((element) => elements[element.id]!.visible && elements[element.id]!.zone === zone)
      .map((element) => element.id)
      .sort(
        (a, b) =>
          elements[a]!.order - elements[b]!.order || catalogIndex.get(a)! - catalogIndex.get(b)!,
      );
  }

  return { screenId, elements, zones };
}

// Normaliza o layout vindo do banco/backup: descarta telas e elementos desconhecidos.
export function sanitizeEventLayout(raw: unknown): EventLayout {
  if (!raw || typeof raw !== 'object') {
    return structuredClone(EMPTY_EVENT_LAYOUT);
  }
  const rawScreens = (raw as { screens?: unknown }).screens;
  const screens: EventLayout['screens'] = {};
  if (rawScreens && typeof rawScreens === 'object') {
    for (const screen of LAYOUT_SCREENS) {
      const rawElements = (rawScreens as Record<string, ScreenLayoutOverrides | undefined>)[screen.id]
        ?.elements;
      if (!rawElements || typeof rawElements !== 'object') {
        continue;
      }
      const resolved = resolveScreenLayout({ version: 1, screens: { [screen.id]: { elements: rawElements } } }, screen.id);
      screens[screen.id] = { elements: toSparseElements(screen.id, resolved) };
    }
  }
  return { version: 1, screens };
}

function toSparseElements(
  screenId: LayoutScreenId,
  resolved: ResolvedScreenLayout,
): Record<string, Partial<LayoutElementSettings>> {
  const definition = getScreenDefinition(screenId);
  const result: Record<string, Partial<LayoutElementSettings>> = {};
  definition.elements.forEach((element, index) => {
    const base = defaultElementSettings(element, index);
    const current = resolved.elements[element.id]!;
    const diff: Partial<LayoutElementSettings> = {};
    (Object.keys(base) as Array<keyof LayoutElementSettings>).forEach((key) => {
      if (current[key] !== base[key]) {
        (diff as Record<string, unknown>)[key] = current[key];
      }
    });
    if (Object.keys(diff).length > 0) {
      result[element.id] = diff;
    }
  });
  return result;
}

// Aplica uma alteração a um elemento e devolve novo layout (esparso, sem valores iguais ao padrão).
export function updateLayoutElement(
  layout: EventLayout | null | undefined,
  screenId: LayoutScreenId,
  elementId: string,
  patch: Partial<LayoutElementSettings>,
): EventLayout {
  const resolved = resolveScreenLayout(layout, screenId);
  const current = resolved.elements[elementId];
  if (!current) {
    return layout ? structuredClone(layout) : structuredClone(EMPTY_EVENT_LAYOUT);
  }
  const merged = { ...current, ...patch };
  const nextElements = { ...resolved.elements, [elementId]: merged };
  return replaceScreenElements(layout, screenId, nextElements);
}

function replaceScreenElements(
  layout: EventLayout | null | undefined,
  screenId: LayoutScreenId,
  elements: Record<string, LayoutElementSettings>,
): EventLayout {
  const sanitized = resolveScreenLayout(
    { version: 1, screens: { [screenId]: { elements } } },
    screenId,
  );
  return {
    version: 1,
    screens: {
      ...(layout?.screens ?? {}),
      [screenId]: { elements: toSparseElements(screenId, sanitized) },
    },
  };
}

// Move o elemento para cima/baixo dentro da sua zona, reatribuindo ordens estáveis (0, 10, 20…).
export function moveLayoutElement(
  layout: EventLayout | null | undefined,
  screenId: LayoutScreenId,
  elementId: string,
  direction: -1 | 1,
): EventLayout {
  const resolved = resolveScreenLayout(layout, screenId);
  const zone = resolved.elements[elementId]?.zone;
  if (!zone) {
    return layout ? structuredClone(layout) : structuredClone(EMPTY_EVENT_LAYOUT);
  }
  // Considera também elementos ocultos da zona para a ordem permanecer previsível ao reexibir.
  const definition = getScreenDefinition(screenId);
  const inZone = definition.elements
    .map((element, index) => ({ id: element.id, index }))
    .filter(({ id }) => resolved.elements[id]!.zone === zone)
    .sort(
      (a, b) =>
        resolved.elements[a.id]!.order - resolved.elements[b.id]!.order || a.index - b.index,
    )
    .map(({ id }) => id);
  const from = inZone.indexOf(elementId);
  const to = from + direction;
  if (from < 0 || to < 0 || to >= inZone.length) {
    return layout ? structuredClone(layout) : structuredClone(EMPTY_EVENT_LAYOUT);
  }
  [inZone[from], inZone[to]] = [inZone[to]!, inZone[from]!];
  const nextElements = { ...resolved.elements };
  inZone.forEach((id, position) => {
    nextElements[id] = { ...nextElements[id]!, order: position * 10 };
  });
  return replaceScreenElements(layout, screenId, nextElements);
}

// Move o elemento para outra zona, posicionando-o no fim dela.
export function moveLayoutElementToZone(
  layout: EventLayout | null | undefined,
  screenId: LayoutScreenId,
  elementId: string,
  zone: LayoutZone,
): EventLayout {
  const resolved = resolveScreenLayout(layout, screenId);
  const current = resolved.elements[elementId];
  if (!current || current.zone === zone) {
    return layout ? structuredClone(layout) : structuredClone(EMPTY_EVENT_LAYOUT);
  }
  const maxOrder = Math.max(
    -10,
    ...Object.entries(resolved.elements)
      .filter(([id, el]) => id !== elementId && el.zone === zone)
      .map(([, el]) => el.order),
  );
  return updateLayoutElement(layout, screenId, elementId, { zone, order: maxOrder + 10 });
}

export function resetScreenLayout(
  layout: EventLayout | null | undefined,
  screenId: LayoutScreenId,
): EventLayout {
  const screens = { ...(layout?.screens ?? {}) };
  delete screens[screenId];
  return { version: 1, screens };
}

export function isScreenLayoutCustomized(
  layout: EventLayout | null | undefined,
  screenId: LayoutScreenId,
): boolean {
  const elements = layout?.screens?.[screenId]?.elements;
  return Boolean(elements && Object.keys(elements).length > 0);
}

export interface LayoutPresetDefinition {
  id: string;
  name: string;
  description: string;
  screenId: LayoutScreenId;
  elements: Record<string, Partial<LayoutElementSettings>>;
}

// Modelos prontos: ponto de partida que o administrador ajusta depois.
export const LAYOUT_PRESETS: readonly LayoutPresetDefinition[] = [
  {
    id: 'initial-default',
    name: 'Padrão (tudo centralizado)',
    description: 'Visual original: todos os elementos agrupados no centro.',
    screenId: 'initial',
    elements: {},
  },
  {
    id: 'initial-header-top',
    name: 'Cabeçalho no topo, ações embaixo',
    description: 'Logo e título no alto, campos ao centro, botões na base da tela.',
    screenId: 'initial',
    elements: {
      logo: { zone: 'top', order: 0 },
      title: { zone: 'top', order: 10 },
      slogan: { zone: 'top', order: 20 },
      statusMessage: { zone: 'top', order: 30 },
      startButton: { zone: 'bottom', order: 0 },
      rankingButton: { zone: 'bottom', order: 10 },
      lgpd: { zone: 'bottom', order: -10 },
    },
  },
  {
    id: 'initial-logo-large',
    name: 'Logo em destaque',
    description: 'Logotipo grande no topo e o restante agrupado ao centro.',
    screenId: 'initial',
    elements: {
      logo: { zone: 'top', order: 0, scalePercent: 140, spaceBeforeEm: 1 },
    },
  },
  {
    id: 'idle-default',
    name: 'Padrão',
    description: 'Visual original: logo e slogan no topo, vitrine ao centro, chamada embaixo.',
    screenId: 'idle',
    elements: {},
  },
  {
    id: 'idle-cta-top',
    name: 'Chamada em destaque no topo',
    description: 'Chamada grande no alto, vitrine ao centro e logo na base.',
    screenId: 'idle',
    elements: {
      callToAction: { zone: 'top', order: 0, scalePercent: 110 },
      logo: { zone: 'bottom', order: 0 },
      slogan: { zone: 'bottom', order: 10 },
    },
  },
  {
    id: 'idle-minimal',
    name: 'Minimalista',
    description: 'Só logo e chamada, sem vitrine de pódio.',
    screenId: 'idle',
    elements: {
      logo: { zone: 'center', order: 0, scalePercent: 130 },
      slogan: { zone: 'center', order: 10 },
      showcase: { visible: false },
      callToAction: { zone: 'bottom' },
    },
  },
  {
    id: 'quiz-default',
    name: 'Padrão',
    description: 'Visual original: logo e cabeçalho no topo, pergunta e alternativas ao centro.',
    screenId: 'quiz',
    elements: {},
  },
  {
    id: 'quiz-options-bottom',
    name: 'Alternativas na base',
    description: 'Pergunta ao centro e alternativas e barra de tempo coladas embaixo, mais fáceis de tocar.',
    screenId: 'quiz',
    elements: {
      options: { zone: 'bottom', order: 0 },
      timeBar: { zone: 'bottom', order: 10 },
      postControls: { zone: 'bottom', order: 20 },
    },
  },
  {
    id: 'quiz-focus',
    name: 'Foco na pergunta',
    description: 'Sem logotipo, com a pergunta em destaque.',
    screenId: 'quiz',
    elements: {
      logo: { visible: false },
      question: { scalePercent: 120 },
    },
  },
  {
    id: 'result-default',
    name: 'Padrão (tudo centralizado)',
    description: 'Visual original da Tela de Resultado.',
    screenId: 'result',
    elements: {},
  },
  {
    id: 'result-actions-bottom',
    name: 'Botões na base',
    description: 'Resultado ao centro e botões de ação na base da tela.',
    screenId: 'result',
    elements: {
      logo: { zone: 'top', order: 0 },
      incorrectButton: { zone: 'bottom', order: 0 },
      rankingButton: { zone: 'bottom', order: 10 },
      playAgainButton: { zone: 'bottom', order: 20 },
    },
  },
  {
    id: 'ranking-default',
    name: 'Padrão',
    description: 'Visual original do Ranking.',
    screenId: 'ranking',
    elements: {},
  },
  {
    id: 'ranking-header-top',
    name: 'Cabeçalho no topo, botão na base',
    description: 'Logo e título no alto, lista ao centro e botão Voltar fixo na base.',
    screenId: 'ranking',
    elements: {
      logo: { zone: 'top', order: 0 },
      title: { zone: 'top', order: 10 },
      backButton: { zone: 'bottom', order: 0 },
    },
  },
];

// Substitui a configuração de uma tela pelo modelo escolhido.
export function applyLayoutPreset(
  layout: EventLayout | null | undefined,
  presetId: string,
): EventLayout {
  const preset = LAYOUT_PRESETS.find((candidate) => candidate.id === presetId);
  if (!preset) {
    return layout ? structuredClone(layout) : structuredClone(EMPTY_EVENT_LAYOUT);
  }
  const cleared = resetScreenLayout(layout, preset.screenId);
  const resolved = resolveScreenLayout(
    { version: 1, screens: { [preset.screenId]: { elements: preset.elements } } },
    preset.screenId,
  );
  return {
    version: 1,
    screens: {
      ...cleared.screens,
      ...(Object.keys(preset.elements).length > 0
        ? { [preset.screenId]: { elements: toSparseElements(preset.screenId, resolved) } }
        : {}),
    },
  };
}

export interface PreviewResolution {
  id: string;
  label: string;
  width: number;
  height: number;
}

export const PREVIEW_RESOLUTIONS: readonly PreviewResolution[] = [
  { id: 'totem-1080x1920', label: 'Totem retrato · 1080 × 1920', width: 1080, height: 1920 },
  { id: 'hd-720x1280', label: 'Retrato HD · 720 × 1280', width: 720, height: 1280 },
  { id: 'fhd-1920x1080', label: 'Full HD paisagem · 1920 × 1080', width: 1920, height: 1080 },
  { id: 'tablet-768x1024', label: 'Tablet retrato · 768 × 1024', width: 768, height: 1024 },
  { id: 'tablet-1024x768', label: 'Tablet paisagem · 1024 × 768', width: 1024, height: 768 },
  { id: 'phone-390x844', label: 'Celular · 390 × 844', width: 390, height: 844 },
];

export const PREVIEW_DIMENSION_LIMITS = { min: 240, max: 7680 } as const;

export function clampPreviewDimension(value: number): number {
  if (!Number.isFinite(value)) {
    return PREVIEW_DIMENSION_LIMITS.min;
  }
  return Math.round(
    Math.min(PREVIEW_DIMENSION_LIMITS.max, Math.max(PREVIEW_DIMENSION_LIMITS.min, value)),
  );
}

// Reproduz a regra do Totem real: o palco mantém no máximo a proporção 9:16 e é centralizado.
export function computeStageSize(width: number, height: number): { width: number; height: number } {
  if (width / height > 9 / 16) {
    return { width: Math.min(width, (height * 9) / 16), height };
  }
  return { width, height };
}
