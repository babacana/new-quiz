import { useMemo, useState } from 'react';
import { Check, FolderOpen, Image as ImageIcon, RefreshCw, Trash2 } from 'lucide-react';
import type { EventConfig, EventVisualAssetRecord, VisualAssetKind } from '../domain/types';
import { Button } from './components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from './components/ui/dialog';
import { formatDateTimePtBr } from './formatters';
import { cn } from './lib/utils';

export interface VisualAssetLibraryProps {
  assets: EventVisualAssetRecord[];
  loading: boolean;
  events: EventConfig[];
  currentEventId: string;
  activeLogoUrl: string | null;
  activeBackgroundUrl: string | null;
  onRefresh: () => void;
  onSelectAsset: (asset: EventVisualAssetRecord) => void;
  onDeleteAsset: (asset: EventVisualAssetRecord) => Promise<void>;
}

type LibraryScopeFilter = 'all' | 'current';

function formatAssetSize(sizeBytes: number | null): string | null {
  if (sizeBytes === null || !Number.isFinite(sizeBytes) || sizeBytes < 0) {
    return null;
  }
  if (sizeBytes < 1024) {
    return `${sizeBytes} B`;
  }
  const kb = sizeBytes / 1024;
  if (kb < 1024) {
    return `${kb.toFixed(1)} KB`;
  }
  const mb = kb / 1024;
  return `${mb.toFixed(2)} MB`;
}

// Galeria de imagens enviadas ao Supabase Storage com reaproveitamento entre Eventos e exclusão segura.
export function VisualAssetLibrary({
  assets,
  loading,
  events,
  currentEventId,
  activeLogoUrl,
  activeBackgroundUrl,
  onRefresh,
  onSelectAsset,
  onDeleteAsset,
}: VisualAssetLibraryProps) {
  const [scope, setScope] = useState<LibraryScopeFilter>('all');
  const [assetToDelete, setAssetToDelete] = useState<EventVisualAssetRecord | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const eventNameById = useMemo(
    () => new Map(events.map((ev) => [ev.id, ev.name])),
    [events],
  );

  // Mapeia cada URL de ativo aos nomes dos Eventos salvos que a utilizam atualmente.
  const usingEventNamesByUrl = useMemo(() => {
    const usage = new Map<string, string[]>();
    for (const ev of events) {
      const { logoUrl, customBackgroundUrl } = ev.customizations.visualIdentity;
      if (logoUrl) {
        const list = usage.get(logoUrl) ?? [];
        if (!list.includes(ev.name)) {
          list.push(ev.name);
        }
        usage.set(logoUrl, list);
      }
      if (customBackgroundUrl) {
        const list = usage.get(customBackgroundUrl) ?? [];
        if (!list.includes(ev.name)) {
          list.push(ev.name);
        }
        usage.set(customBackgroundUrl, list);
      }
    }
    return usage;
  }, [events]);

  const scopedAssets = useMemo(
    () =>
      scope === 'current'
        ? assets.filter((item) => item.eventId === currentEventId)
        : assets,
    [assets, currentEventId, scope],
  );

  const logoAssets = useMemo(
    () => scopedAssets.filter((item) => item.kind === 'logo'),
    [scopedAssets],
  );

  const backgroundAssets = useMemo(
    () => scopedAssets.filter((item) => item.kind === 'background'),
    [scopedAssets],
  );

  const handleConfirmDelete = async () => {
    if (!assetToDelete) {
      return;
    }
    setIsDeleting(true);
    try {
      await onDeleteAsset(assetToDelete);
      setAssetToDelete(null);
    } finally {
      setIsDeleting(false);
    }
  };

  const renderAssetSection = (
    kind: VisualAssetKind,
    title: string,
    items: EventVisualAssetRecord[],
    activeUrl: string | null,
  ) => (
    <div
      data-testid={`visual-asset-grid-${kind}`}
      className="space-y-2.5"
    >
      <div className="flex items-center justify-between">
        <h4 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
          {title} ({items.length})
        </h4>
      </div>

      {items.length === 0 ? (
        <div className="rounded-md border border-dashed border-border bg-muted/20 px-3 py-4 text-center text-xs text-muted-foreground">
          Nenhuma imagem encontrada nesta categoria
          {scope === 'current' ? ' para este Evento.' : '.'}
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {items.map((asset) => {
            const isSelected = Boolean(activeUrl && asset.url === activeUrl);
            const usingEvents = usingEventNamesByUrl.get(asset.url) ?? [];
            const isUsedBySavedEvent = usingEvents.length > 0;
            const isFromCurrentEvent = asset.eventId === currentEventId;
            const originLabel = isFromCurrentEvent
              ? 'Este Evento'
              : (eventNameById.get(asset.eventId) ?? 'Outro Evento');
            const sizeLabel = formatAssetSize(asset.sizeBytes);

            return (
              <div
                key={asset.storagePath}
                className={cn(
                  'flex flex-col justify-between rounded-lg border bg-card p-2.5 shadow-xs transition-all',
                  isSelected
                    ? 'border-primary ring-2 ring-primary/40'
                    : 'border-border hover:border-primary/40',
                )}
              >
                <div className="space-y-2">
                  <div className="relative flex h-20 w-full items-center justify-center overflow-hidden rounded-md border border-border/60 bg-slate-900/90 p-1.5">
                    <img
                      src={asset.url}
                      alt={`Miniatura ${asset.fileName}`}
                      className={cn(
                        'max-h-full max-w-full',
                        kind === 'logo' ? 'object-contain' : 'h-full w-full object-cover',
                      )}
                      loading="lazy"
                    />
                    <div className="absolute top-1.5 left-1.5 flex flex-wrap gap-1">
                      {isSelected && (
                        <span className="inline-flex items-center gap-0.5 rounded bg-primary px-1.5 py-0.5 text-[10px] font-semibold text-primary-foreground shadow-xs">
                          <Check className="h-2.5 w-2.5" />
                          Selecionada
                        </span>
                      )}
                      {isUsedBySavedEvent && (
                        <span
                          title={`Em uso por: ${usingEvents.join(', ')}`}
                          className="inline-flex items-center rounded bg-emerald-500/90 px-1.5 py-0.5 text-[10px] font-semibold text-white shadow-xs"
                        >
                          Em uso
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="min-w-0 space-y-0.5">
                    <p
                      title={asset.fileName}
                      className="truncate text-xs font-medium text-foreground"
                    >
                      {asset.fileName}
                    </p>
                    <p
                      title={originLabel}
                      className="truncate text-[11px] text-muted-foreground"
                    >
                      Origem: <span className="font-medium">{originLabel}</span>
                      {sizeLabel ? ` · ${sizeLabel}` : ''}
                    </p>
                    {asset.createdAt && (
                      <p className="truncate text-[10px] text-muted-foreground">
                        {formatDateTimePtBr(asset.createdAt)}
                      </p>
                    )}
                  </div>
                </div>

                <div className="mt-2.5 flex items-center gap-1.5 pt-1">
                  <Button
                    type="button"
                    size="sm"
                    variant={isSelected ? 'secondary' : 'outline'}
                    className="h-7 flex-1 text-xs"
                    disabled={isSelected}
                    aria-label={`Usar imagem ${asset.fileName}`}
                    onClick={() => onSelectAsset(asset)}
                  >
                    {isSelected ? 'Selecionada' : 'Usar'}
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="h-7 w-7 shrink-0 p-0 text-destructive hover:bg-destructive/10 hover:text-destructive disabled:opacity-40"
                    disabled={isUsedBySavedEvent}
                    aria-label={`Excluir imagem ${asset.fileName}`}
                    title={
                      isUsedBySavedEvent
                        ? `Não pode ser excluída porque está salva em: ${usingEvents.join(', ')}`
                        : `Excluir ${asset.fileName} do armazenamento`
                    }
                    onClick={() => setAssetToDelete(asset)}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );

  return (
    <div
      data-testid="visual-asset-library"
      className="space-y-4 rounded-lg border border-border bg-muted/15 p-3.5"
    >
      <div className="flex flex-col gap-2.5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2">
          <FolderOpen className="h-4 w-4 text-primary" />
          <div>
            <h3 className="text-sm font-semibold text-foreground">
              Biblioteca de Imagens Enviadas
            </h3>
            <p className="text-xs text-muted-foreground">
              Reaproveite logotipos e planos de fundo enviados neste ou em outros Eventos.
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          <div className="inline-flex rounded-md border border-border bg-background p-0.5">
            <button
              type="button"
              aria-label="Exibir imagens de todos os Eventos"
              className={cn(
                'rounded px-2.5 py-1 text-xs font-medium transition-colors',
                scope === 'all'
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:text-foreground',
              )}
              onClick={() => setScope('all')}
            >
              Todos os Eventos
            </button>
            <button
              type="button"
              aria-label="Exibir apenas imagens deste Evento"
              className={cn(
                'rounded px-2.5 py-1 text-xs font-medium transition-colors',
                scope === 'current'
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:text-foreground',
              )}
              onClick={() => setScope('current')}
            >
              Apenas este Evento
            </button>
          </div>

          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-7 gap-1 px-2 text-xs"
            disabled={loading}
            aria-label="Atualizar biblioteca de imagens"
            onClick={onRefresh}
          >
            <RefreshCw className={cn('h-3.5 w-3.5', loading && 'animate-spin')} />
            Atualizar
          </Button>
        </div>
      </div>

      {renderAssetSection('logo', 'Logotipos enviados', logoAssets, activeLogoUrl)}
      {renderAssetSection(
        'background',
        'Planos de Fundo enviados',
        backgroundAssets,
        activeBackgroundUrl,
      )}

      <Dialog
        open={Boolean(assetToDelete)}
        onOpenChange={(open) => {
          if (!open && !isDeleting) {
            setAssetToDelete(null);
          }
        }}
      >
        <DialogContent id="delete-visual-asset-modal">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ImageIcon className="h-4 w-4 text-destructive" />
              Excluir Imagem do Armazenamento
            </DialogTitle>
            <DialogDescription>
              Tem certeza que deseja excluir permanentemente a imagem{' '}
              <strong>{assetToDelete?.fileName}</strong> do Supabase Storage? Esta ação não pode
              ser desfeita.
            </DialogDescription>
          </DialogHeader>

          {assetToDelete && (
            <div className="flex items-center gap-3 rounded-md border border-border bg-muted/30 p-2.5">
              <div className="flex h-14 w-20 shrink-0 items-center justify-center overflow-hidden rounded bg-slate-900 p-1">
                <img
                  src={assetToDelete.url}
                  alt={assetToDelete.fileName}
                  className="max-h-full max-w-full object-contain"
                />
              </div>
              <div className="min-w-0 text-xs">
                <p className="truncate font-semibold text-foreground">{assetToDelete.fileName}</p>
                <p className="text-muted-foreground">
                  Tipo: {assetToDelete.kind === 'logo' ? 'Logotipo' : 'Plano de Fundo'}
                </p>
                <p className="truncate text-muted-foreground">
                  Evento de origem:{' '}
                  {assetToDelete.eventId === currentEventId
                    ? 'Este Evento'
                    : (eventNameById.get(assetToDelete.eventId) ?? 'Outro Evento')}
                </p>
              </div>
            </div>
          )}

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={isDeleting}
              onClick={() => setAssetToDelete(null)}
            >
              Cancelar
            </Button>
            <Button
              id="confirm-delete-visual-asset-btn"
              type="button"
              variant="destructive"
              disabled={isDeleting}
              onClick={() => void handleConfirmDelete()}
            >
              {isDeleting ? 'Excluindo...' : 'Confirmar Exclusão'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
