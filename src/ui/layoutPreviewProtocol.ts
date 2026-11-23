import type { LayoutScreenId } from '../domain/screenLayout';
import type { EventCustomizations } from '../domain/types';

// Protocolo de mensagens entre o editor de layout (ADM) e a prévia, que roda o Totem real em um iframe.
export const LAYOUT_PREVIEW_HASH = '#layout-preview';

export interface LayoutPreviewState {
  screenId: LayoutScreenId;
  customizations: EventCustomizations;
  /** Aviso LGPD configurado no Evento (vazio = não aparece, como no Totem real). */
  lgpdNoticeText: string;
  /** Tela de Quiz: mostra a pergunta já respondida. */
  quizAnswered: boolean;
  /** Mostra elementos que só aparecem em certas situações (aviso do Evento, sincronização etc.). */
  showConditional: boolean;
  highlightedElementId: string | null;
}

export type EditorToPreviewMessage = {
  source: 'layout-editor';
  type: 'state';
  state: LayoutPreviewState;
};

export type PreviewToEditorMessage =
  | { source: 'layout-preview'; type: 'ready' }
  | { source: 'layout-preview'; type: 'select'; elementId: string }
  | {
      source: 'layout-preview';
      type: 'move';
      elementId: string;
      offsetXPercent: number;
      offsetYPercent: number;
    };

export function isEditorToPreviewMessage(data: unknown): data is EditorToPreviewMessage {
  const message = data as Partial<EditorToPreviewMessage> | null;
  return (
    !!message &&
    message.source === 'layout-editor' &&
    message.type === 'state' &&
    !!message.state &&
    typeof message.state === 'object' &&
    !!message.state.customizations
  );
}

export function isPreviewToEditorMessage(data: unknown): data is PreviewToEditorMessage {
  const message = data as { source?: unknown; type?: unknown } | null;
  return (
    !!message &&
    message.source === 'layout-preview' &&
    (message.type === 'ready' || message.type === 'select' || message.type === 'move')
  );
}
