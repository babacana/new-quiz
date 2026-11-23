import { useEffect, useRef, useState } from 'react';
import {
  LAYOUT_PREVIEW_HASH,
  isPreviewToEditorMessage,
  type EditorToPreviewMessage,
  type LayoutPreviewState,
} from './layoutPreviewProtocol';

export interface LayoutPreviewStageProps extends LayoutPreviewState {
  /** Resolução simulada: o iframe tem exatamente este tamanho, então as unidades vh/vw e media queries são as reais. */
  width: number;
  height: number;
  onSelectElement?: (elementId: string) => void;
  /** Arraste na prévia: novo deslocamento (em % do palco) do elemento. */
  onMoveElement?: (elementId: string, offsetXPercent: number, offsetYPercent: number) => void;
}

// Prévia fiel: carrega o próprio Totem (rota #layout-preview) em um iframe do tamanho exato da resolução
// escolhida e apenas o reduz visualmente (transform) para caber na tela do painel.
export function LayoutPreviewStage({
  width,
  height,
  onSelectElement,
  onMoveElement,
  ...state
}: LayoutPreviewStageProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const stateRef = useRef<LayoutPreviewState>(state);
  const [hostWidth, setHostWidth] = useState(0);

  const postState = () => {
    const target = iframeRef.current?.contentWindow;
    if (!target) {
      return;
    }
    const message: EditorToPreviewMessage = {
      source: 'layout-editor',
      type: 'state',
      state: stateRef.current,
    };
    target.postMessage(message, window.location.origin);
  };

  // Envia o estado atual a cada mudança (o iframe ainda carregando ignora e pede de novo ao ficar pronto).
  useEffect(() => {
    stateRef.current = state;
    postState();
  });

  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      if (
        event.origin !== window.location.origin ||
        event.source !== iframeRef.current?.contentWindow ||
        !isPreviewToEditorMessage(event.data)
      ) {
        return;
      }
      const message = event.data;
      if (message.type === 'ready') {
        postState();
      } else if (message.type === 'select') {
        onSelectElement?.(message.elementId);
      } else {
        onMoveElement?.(message.elementId, message.offsetXPercent, message.offsetYPercent);
      }
    };
    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  });

  useEffect(() => {
    const host = hostRef.current;
    if (!host) {
      return undefined;
    }
    const update = () => setHostWidth(host.clientWidth);
    update();
    if (typeof ResizeObserver === 'undefined') {
      return undefined;
    }
    const observer = new ResizeObserver(update);
    observer.observe(host);
    return () => observer.disconnect();
  }, []);

  const maxHeight = typeof window === 'undefined' ? 720 : Math.max(320, window.innerHeight * 0.72);
  const scale = Math.min(1, (hostWidth > 0 ? hostWidth : 280) / width, maxHeight / height);

  return (
    <div ref={hostRef} className="w-full">
      <div
        data-testid="layout-preview-frame"
        className="relative mx-auto overflow-hidden rounded-lg border border-border shadow-xs"
        style={{ width: Math.round(width * scale), height: Math.round(height * scale) }}
      >
        <iframe
          ref={iframeRef}
          title="Pré-visualização do Totem real"
          src={`/${LAYOUT_PREVIEW_HASH}`}
          onLoad={postState}
          style={{
            width,
            height,
            border: 0,
            display: 'block',
            transform: `scale(${scale})`,
            transformOrigin: 'top left',
          }}
        />
      </div>
    </div>
  );
}
