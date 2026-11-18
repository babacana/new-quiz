import type {
  DirtySection,
  UnsavedChangesResolution,
  UnsavedNavigationPrompt,
} from '../domain/types';

/**
 * Controla o estado de alterações pendentes nos formulários administrativos
 * antes de trocar de aba, Evento, rota ou encerrar a sessão.
 */
export class UnsavedNavigationGuard {
  private readonly dirtySections = new Set<DirtySection>();

  markDirty(section: DirtySection, dirty = true): void {
    if (dirty) {
      this.dirtySections.add(section);
    } else {
      this.dirtySections.delete(section);
    }
  }

  clearDirty(section?: DirtySection): void {
    if (section) {
      this.dirtySections.delete(section);
      return;
    }
    this.dirtySections.clear();
  }

  isDirty(): boolean {
    return this.dirtySections.size > 0;
  }

  getDirtySections(): DirtySection[] {
    return Array.from(this.dirtySections);
  }

  checkUnsavedNavigation(): UnsavedNavigationPrompt {
    const dirtySections = Array.from(this.dirtySections);
    if (dirtySections.length === 0) {
      return {
        canProceedImmediately: true,
        dirtySections: [],
        message: '',
        options: ['save_and_leave', 'discard_and_leave', 'cancel'],
      };
    }

    return {
      canProceedImmediately: false,
      dirtySections,
      message: 'Há alterações não salvas no formulário atual. O que deseja fazer?',
      options: ['save_and_leave', 'discard_and_leave', 'cancel'],
    };
  }

  async resolveUnsavedNavigation(
    resolution: UnsavedChangesResolution,
    saveCallback?: () => Promise<void>,
  ): Promise<boolean> {
    if (resolution === 'cancel') {
      return false;
    }

    if (resolution === 'save_and_leave') {
      if (saveCallback) {
        await saveCallback();
      }
      this.clearDirty();
      return true;
    }

    this.clearDirty();
    return true;
  }
}
