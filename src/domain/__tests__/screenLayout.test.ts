import { describe, expect, it } from 'vitest';
import { mergeEventCustomizations, restoreDefaultCustomizations } from '../customizationThemes';
import { DEFAULT_CUSTOMIZATIONS } from '../defaults';
import {
  applyLayoutPreset,
  computeStageSize,
  moveLayoutElement,
  moveLayoutElementToZone,
  resetScreenLayout,
  resolveScreenLayout,
  sanitizeEventLayout,
  updateLayoutElement,
} from '../screenLayout';

describe('screenLayout', () => {
  it('sem layout salvo reproduz a distribuição original das telas', () => {
    const initial = resolveScreenLayout(undefined, 'initial');
    expect(initial.zones.top).toEqual([]);
    expect(initial.zones.bottom).toEqual([]);
    expect(initial.zones.center).toEqual([
      'logo',
      'title',
      'slogan',
      'statusMessage',
      'intro',
      'nameField',
      'phoneField',
      'lgpd',
      'startButton',
      'rankingButton',
    ]);

    const closed = resolveScreenLayout(undefined, 'closed');
    expect(closed.zones.center).toEqual(['logo', 'slogan', 'statusMessage', 'rankingButton']);
    // A logo estilizada também é opcional (oculta por padrão) na tela fechada
    const closedWithLogo = updateLayoutElement(undefined, 'closed', 'stylizedLogo', { visible: true });
    expect(resolveScreenLayout(closedWithLogo, 'closed').zones.center).toEqual([
      'logo',
      'stylizedLogo',
      'slogan',
      'statusMessage',
      'rankingButton',
    ]);
    // A mensagem do Evento é obrigatória na tela fechada
    expect(
      resolveScreenLayout(updateLayoutElement(undefined, 'closed', 'statusMessage', { visible: false }), 'closed')
        .elements.statusMessage?.visible,
    ).toBe(true);

    // Logo estilizada da Tela de Descanso é opcional: oculta até ser ativada, e só ativada vira override salvo
    expect(resolveScreenLayout(undefined, 'idle').zones.top).not.toContain('stylizedLogo');
    const shown = updateLayoutElement(undefined, 'idle', 'stylizedLogo', { visible: true });
    expect(shown.screens.idle?.elements).toEqual({ stylizedLogo: { visible: true } });
    expect(resolveScreenLayout(shown, 'idle').zones.top).toEqual(['logo', 'stylizedLogo', 'slogan']);

    const idle = resolveScreenLayout(undefined, 'idle');
    expect(idle.zones).toEqual({
      top: ['logo', 'slogan'],
      center: ['showcase'],
      bottom: ['callToAction'],
    });
  });

  it('move elementos entre zonas e reordena dentro da zona', () => {
    let layout = moveLayoutElementToZone(undefined, 'initial', 'startButton', 'bottom');
    layout = moveLayoutElementToZone(layout, 'initial', 'rankingButton', 'bottom');
    expect(resolveScreenLayout(layout, 'initial').zones.bottom).toEqual([
      'startButton',
      'rankingButton',
    ]);

    layout = moveLayoutElement(layout, 'initial', 'rankingButton', -1);
    expect(resolveScreenLayout(layout, 'initial').zones.bottom).toEqual([
      'rankingButton',
      'startButton',
    ]);
    // Já no topo da zona: nada muda.
    expect(moveLayoutElement(layout, 'initial', 'rankingButton', -1)).toEqual(layout);
  });

  it('guarda apenas as diferenças em relação ao padrão', () => {
    const layout = updateLayoutElement(undefined, 'idle', 'logo', { scalePercent: 130 });
    expect(layout.screens.idle?.elements).toEqual({ logo: { scalePercent: 130 } });
    expect(resetScreenLayout(layout, 'idle').screens).toEqual({});
    expect(updateLayoutElement(layout, 'idle', 'logo', { scalePercent: 100 }).screens.idle?.elements).toEqual({});
  });

  it('nunca oculta elementos obrigatórios e descarta valores inválidos', () => {
    const tampered = {
      version: 1,
      screens: {
        initial: {
          elements: {
            startButton: { visible: false, zone: 'bottom' },
            logo: { scalePercent: 9999, zone: 'nowhere', textColor: 'red; background:url(x)' },
            fantasma: { visible: false },
          },
        },
        desconhecida: { elements: {} },
      },
    };
    const resolved = resolveScreenLayout(tampered as never, 'initial');
    expect(resolved.elements.startButton?.visible).toBe(true);
    expect(resolved.elements.startButton?.zone).toBe('bottom');
    expect(resolved.elements.logo).toMatchObject({ scalePercent: 200, zone: 'center', textColor: null });
    expect(resolved.elements).not.toHaveProperty('fantasma');

    const clean = sanitizeEventLayout(tampered);
    expect(Object.keys(clean.screens)).toEqual(['initial']);
    expect(sanitizeEventLayout('lixo')).toEqual({ version: 1, screens: {} });
  });

  it('aplica modelos prontos substituindo apenas a tela escolhida', () => {
    const base = updateLayoutElement(undefined, 'initial', 'logo', { scalePercent: 150 });
    const withIdle = applyLayoutPreset(base, 'idle-minimal');
    expect(resolveScreenLayout(withIdle, 'idle').elements.showcase?.visible).toBe(false);
    expect(resolveScreenLayout(withIdle, 'initial').elements.logo?.scalePercent).toBe(150);

    const reset = applyLayoutPreset(withIdle, 'idle-default');
    expect(reset.screens.idle).toBeUndefined();
    expect(reset.screens.initial).toBeDefined();
  });

  it('o layout acompanha as customizações: mescla, preserva e sobrevive à restauração visual', () => {
    const layout = updateLayoutElement(undefined, 'idle', 'logo', { zone: 'bottom' });
    const merged = mergeEventCustomizations(DEFAULT_CUSTOMIZATIONS, { layout });
    expect(merged.layout).toEqual(layout);
    expect(mergeEventCustomizations(merged, { texts: { initialScreenTitle: 'X' } }).layout).toEqual(layout);
    expect(restoreDefaultCustomizations(merged, 'all').layout).toEqual(layout);
    expect(mergeEventCustomizations(DEFAULT_CUSTOMIZATIONS, {})).not.toHaveProperty('layout');
  });

  it('limita e arredonda o deslocamento fino', () => {
    const layout = updateLayoutElement(undefined, 'idle', 'logo', {
      offsetXPercent: 123,
      offsetYPercent: -3.14159,
    });
    expect(layout.screens.idle?.elements?.logo).toEqual({ offsetXPercent: 50, offsetYPercent: -3.1 });
  });

  it('cobre Quiz, Resultado e Ranking e mantém elementos essenciais visíveis', () => {
    const quiz = resolveScreenLayout(undefined, 'quiz');
    expect(quiz.zones.top).toEqual(['logo', 'progress', 'giveUp']);
    expect(quiz.zones.center).toEqual(['question', 'options', 'timeBar', 'postControls']);
    const tampered = {
      version: 1,
      screens: {
        quiz: { elements: { options: { visible: false }, timeBar: { visible: false }, postControls: { visible: false } } },
        result: { elements: { playAgainButton: { visible: false } } },
        ranking: { elements: { list: { visible: false }, backButton: { visible: false } } },
      },
    };
    expect(resolveScreenLayout(tampered as never, 'quiz').zones.center).toContain('options');
    expect(resolveScreenLayout(tampered as never, 'quiz').zones.center).toContain('timeBar');
    expect(resolveScreenLayout(tampered as never, 'result').zones.center).toContain('playAgainButton');
    expect(resolveScreenLayout(tampered as never, 'ranking').zones.center).toEqual(
      expect.arrayContaining(['list', 'backButton']),
    );
    expect(Object.keys(sanitizeEventLayout(tampered).screens).sort()).toEqual(['quiz', 'ranking', 'result']);
    expect(resolveScreenLayout(applyLayoutPreset(undefined, 'quiz-options-bottom'), 'quiz').zones.bottom).toEqual([
      'options',
      'timeBar',
      'postControls',
    ]);
  });

  it('calcula o palco 9:16 centralizado como o Totem real', () => {
    expect(computeStageSize(1080, 1920)).toEqual({ width: 1080, height: 1920 });
    expect(computeStageSize(1920, 1080)).toEqual({ width: 607.5, height: 1080 });
    expect(computeStageSize(390, 844)).toEqual({ width: 390, height: 844 });
  });
});

describe('margem de segurança (TV com overscan)', () => {
  it('é limitada, arredondada e some quando todos os lados são 0', async () => {
    const { sanitizeSafeMargin, setLayoutSafeMargin, safeMarginCssVars, hasSafeMargin } =
      await import('../screenLayout');
    expect(sanitizeSafeMargin({ topPercent: 0, rightPercent: 0, bottomPercent: 0, leftPercent: 0 })).toBeUndefined();
    expect(sanitizeSafeMargin({ topPercent: 99, bottomPercent: 2.34, leftPercent: -3 })).toEqual({
      topPercent: 15,
      rightPercent: 0,
      bottomPercent: 2.3,
      leftPercent: 0,
    });
    expect(safeMarginCssVars(undefined)).toEqual({});
    const layout = setLayoutSafeMargin(undefined, { topPercent: 4, rightPercent: 0, bottomPercent: 5, leftPercent: 0 });
    expect(hasSafeMargin(layout.safeMargin)).toBe(true);
    expect(safeMarginCssVars(layout.safeMargin)['--totem-safe-bottom']).toBe('5vh');
  });

  it('sobrevive a edições de elementos, modelos e restauração de tela', async () => {
    const { setLayoutSafeMargin, updateLayoutElement, resetScreenLayout, applyLayoutPreset, sanitizeEventLayout } =
      await import('../screenLayout');
    let layout = setLayoutSafeMargin(undefined, { topPercent: 3, rightPercent: 3, bottomPercent: 3, leftPercent: 3 });
    layout = updateLayoutElement(layout, 'initial', 'logo', { scalePercent: 120 });
    expect(layout.safeMargin?.topPercent).toBe(3);
    layout = applyLayoutPreset(layout, 'quiz-options-bottom');
    layout = resetScreenLayout(layout, 'initial');
    expect(sanitizeEventLayout(layout).safeMargin).toEqual(layout.safeMargin);
  });
});
