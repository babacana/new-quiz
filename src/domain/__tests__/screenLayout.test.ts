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

  it('calcula o palco 9:16 centralizado como o Totem real', () => {
    expect(computeStageSize(1080, 1920)).toEqual({ width: 1080, height: 1920 });
    expect(computeStageSize(1920, 1080)).toEqual({ width: 607.5, height: 1080 });
    expect(computeStageSize(390, 844)).toEqual({ width: 390, height: 844 });
  });
});
