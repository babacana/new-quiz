import { describe, expect, it } from 'vitest';
import { UnsavedNavigationGuard } from '../navigationGuard';

describe('UnsavedNavigationGuard', () => {
  it('solicita confirmação com opções Salvar e Sair, Sair sem Salvar ou Cancelar quando há alterações pendentes', async () => {
    const guard = new UnsavedNavigationGuard();

    expect(guard.checkUnsavedNavigation().canProceedImmediately).toBe(true);
    expect(guard.isDirty()).toBe(false);

    guard.markDirty('event');
    guard.markDirty('settings');

    const prompt = guard.checkUnsavedNavigation();
    expect(prompt.canProceedImmediately).toBe(false);
    expect(prompt.dirtySections).toEqual(['event', 'settings']);
    expect(prompt.options).toEqual(['save_and_leave', 'discard_and_leave', 'cancel']);

    // Cancelar mantém alterações pendentes e bloqueia a saída.
    const cancelled = await guard.resolveUnsavedNavigation('cancel');
    expect(cancelled).toBe(false);
    expect(guard.isDirty()).toBe(true);

    // Salvar e Sair executa o callback de salvamento e limpa todas as seções sujas.
    let saved = false;
    const savedAndLeft = await guard.resolveUnsavedNavigation('save_and_leave', async () => {
      saved = true;
    });
    expect(saved).toBe(true);
    expect(savedAndLeft).toBe(true);
    expect(guard.isDirty()).toBe(false);

    // Sair sem Salvar descarta alterações sem executar salvamento.
    guard.markDirty('question');
    const discarded = await guard.resolveUnsavedNavigation('discard_and_leave');
    expect(discarded).toBe(true);
    expect(guard.isDirty()).toBe(false);

    // clearDirty específico remove somente a seção informada.
    guard.markDirty('customization');
    guard.markDirty('event');
    guard.clearDirty('customization');
    expect(guard.getDirtySections()).toEqual(['event']);
    guard.clearDirty();
    expect(guard.isDirty()).toBe(false);
  });
});
