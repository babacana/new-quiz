import { useState } from 'react';
import { Calendar, Copy, LayoutDashboard, Plus, Power, SlidersHorizontal } from 'lucide-react';
import { DEFAULT_SETTINGS } from '../domain/defaults';
import type { EventAdminController } from '../domain/eventAdminController';
import type { EventConfig } from '../domain/types';
import {
  CONTENT_LANGUAGES,
  CONTENT_LANGUAGE_LABELS,
  getLanguageCompleteness,
} from '../domain/translations';
import { Button } from './components/ui/button';
import { EventStatusBadge } from './components/EventStatusBadge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from './components/ui/dialog';
import { Input } from './components/ui/input';
import { Label } from './components/ui/label';
import { formatDateTimePtBr } from './formatters';
import { cn } from './lib/utils';

export interface AdminEventsTabProps {
  controller: EventAdminController;
  events: EventConfig[];
  selectedEventId: string | null;
  onSelectEventAndNavigate: (eventId: string, targetTab: 'overview' | 'settings') => void;
  onEventsChanged: (preferredSelectedId?: string) => Promise<void>;
  onStatusMessage: (type: 'success' | 'error', message: string) => void;
}

function formatPeriodSummary(ev: EventConfig): string {
  if (!ev.startTime && !ev.endTime) {
    return 'Sem restrição de período';
  }
  const start = ev.startTime ? formatDateTimePtBr(ev.startTime) : 'Início livre';
  const end = ev.endTime ? formatDateTimePtBr(ev.endTime) : 'Sem término';
  return `${start} — ${end}`;
}

function formatStockLabel(ev: EventConfig): string {
  return ev.prizeStockRemaining === null ? 'Ilimitado' : String(ev.prizeStockRemaining);
}

// Tela global de Gestão de Eventos: listagem responsiva (tabela desktop / cards mobile), criação, clonagem e ativação.
export function AdminEventsTab({
  controller,
  events,
  selectedEventId,
  onSelectEventAndNavigate,
  onEventsChanged,
  onStatusMessage,
}: AdminEventsTabProps) {
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [newName, setNewName] = useState('');
  const [newSlug, setNewSlug] = useState('');
  const [newIsActive, setNewIsActive] = useState(true);
  const [isSubmittingCreate, setIsSubmittingCreate] = useState(false);

  const [cloneSourceEvent, setCloneSourceEvent] = useState<EventConfig | null>(null);
  const [cloneName, setCloneName] = useState('');
  const [isSubmittingClone, setIsSubmittingClone] = useState(false);

  const handleOpenCreate = () => {
    setNewName('');
    setNewSlug('');
    setNewIsActive(true);
    setCreateDialogOpen(true);
  };

  const handleCreateEvent = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmittingCreate(true);
    try {
      const created = await controller.createEvent({
        name: newName,
        slug: newSlug.trim() || undefined,
        isActive: newIsActive,
        settings: structuredClone(DEFAULT_SETTINGS),
      });
      setCreateDialogOpen(false);
      await onEventsChanged(created.id);
      onStatusMessage('success', `Evento "${created.name}" criado com sucesso.`);
    } catch (error) {
      onStatusMessage(
        'error',
        error instanceof Error ? error.message : 'Erro ao criar Evento.',
      );
    } finally {
      setIsSubmittingCreate(false);
    }
  };

  const handleOpenClone = (ev: EventConfig) => {
    setCloneSourceEvent(ev);
    setCloneName(`${ev.name} (Cópia)`);
  };

  const handleConfirmClone = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!cloneSourceEvent) {
      return;
    }
    setIsSubmittingClone(true);
    try {
      const cloned = await controller.cloneEvent(cloneSourceEvent.id, {
        name: cloneName,
      });
      setCloneSourceEvent(null);
      setCloneName('');
      await onEventsChanged(cloned.id);
      onStatusMessage(
        'success',
        `Evento "${cloned.name}" clonado a partir de "${cloneSourceEvent.name}".`,
      );
    } catch (error) {
      onStatusMessage(
        'error',
        error instanceof Error ? error.message : 'Erro ao clonar Evento.',
      );
    } finally {
      setIsSubmittingClone(false);
    }
  };

  // Aviso (não bloqueante) ao ativar com traduções incompletas: o que faltar aparece em português.
  const describeIncompleteTranslations = async (event: EventConfig): Promise<string> => {
    try {
      const questions = await controller.listAllQuestions(event.id);
      const parts = CONTENT_LANGUAGES.flatMap((language) => {
        const status = getLanguageCompleteness(questions, event.customizations, event.settings, language);
        if (status.isComplete) {
          return [];
        }
        const missingQuestions = status.questions.missing + status.questions.partial;
        return [`${CONTENT_LANGUAGE_LABELS[language]}: ${missingQuestions} pergunta(s) e ${status.texts.missing} texto(s) sem tradução`];
      });
      return parts.length > 0
        ? ` Atenção, traduções incompletas (aparecem em português): ${parts.join('; ')}.`
        : '';
    } catch {
      return '';
    }
  };

  const handleToggleActive = async (ev: EventConfig) => {
    try {
      const updated = await controller.setEventActive(ev.id, !ev.isActive);
      await onEventsChanged(updated.id);
      const translationWarning = updated.isActive
        ? await describeIncompleteTranslations(updated)
        : '';
      onStatusMessage(
        'success',
        `Evento "${updated.name}" ${updated.isActive ? 'ativado' : 'encerrado'} com sucesso.${translationWarning}`,
      );
    } catch (error) {
      onStatusMessage(
        'error',
        error instanceof Error ? error.message : 'Não foi possível alterar o status do Evento.',
      );
    }
  };

  const renderStatusBadge = (ev: EventConfig) => (
    <EventStatusBadge isActive={ev.isActive} />
  );

  const renderRowActions = (ev: EventConfig, compact = false) => (
    <div className={cn('flex flex-wrap items-center gap-2', !compact && 'justify-end')}>
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => onSelectEventAndNavigate(ev.id, 'overview')}
      >
        <LayoutDashboard className="h-3.5 w-3.5" />
        Visão Geral
      </Button>
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => onSelectEventAndNavigate(ev.id, 'settings')}
      >
        <SlidersHorizontal className="h-3.5 w-3.5" />
        Configurar
      </Button>
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => handleOpenClone(ev)}
      >
        <Copy className="h-3.5 w-3.5" />
        Clonar Evento
      </Button>
      <Button
        type="button"
        variant={ev.isActive ? 'secondary' : 'default'}
        size="sm"
        onClick={() => void handleToggleActive(ev)}
      >
        <Power className="h-3.5 w-3.5" />
        {ev.isActive ? 'Encerrar' : 'Ativar'}
      </Button>
    </div>
  );

  return (
    <div id="admin-events-tab" className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Eventos</h1>
          <p className="text-sm text-muted-foreground">
            Gerencie edições de feiras e congressos, clone configurações ou altere o status de operação.
          </p>
        </div>
        <Button id="new-event-btn" type="button" onClick={handleOpenCreate}>
          <Plus className="h-4 w-4" />
          Novo Evento
        </Button>
      </div>

      {events.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center gap-3 py-10 text-center">
            <Calendar className="h-8 w-8 text-muted-foreground" />
            <div>
              <p className="font-medium">Nenhum Evento cadastrado</p>
              <p className="text-sm text-muted-foreground">
                Crie o primeiro Evento para configurar perguntas, aparência e parear Totens.
              </p>
            </div>
            <Button type="button" onClick={handleOpenCreate}>
              <Plus className="h-4 w-4" />
              Criar Primeiro Evento
            </Button>
          </CardContent>
        </Card>
      ) : (
        <>
          {/* Tabela responsiva para desktop (md+) */}
          <Card data-testid="events-desktop-table" className="hidden md:block">
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Eventos Cadastrados ({events.length})</CardTitle>
              <CardDescription>
                Clique em &ldquo;Visão Geral&rdquo; ou &ldquo;Configurar&rdquo; para abrir o contexto do Evento.
              </CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-sm">
                  <thead>
                    <tr className="border-y border-border bg-muted/40 text-left text-xs font-medium text-muted-foreground uppercase">
                      <th className="px-4 py-3">Evento</th>
                      <th className="px-4 py-3">Período</th>
                      <th className="px-4 py-3">Quiz / Estoque</th>
                      <th className="px-4 py-3">Status</th>
                      <th className="px-4 py-3 text-right">Ações</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {events.map((ev) => {
                      const isSelected = ev.id === selectedEventId;
                      return (
                        <tr
                          key={ev.id}
                          className={cn(
                            'transition-colors hover:bg-muted/30',
                            isSelected && 'bg-primary/5',
                          )}
                        >
                          <td className="px-4 py-3">
                            <div className="font-medium text-foreground">{ev.name}</div>
                            <div className="text-xs text-muted-foreground">
                              Slug: <code>{ev.slug}</code> · v{ev.configVersion}
                            </div>
                          </td>
                          <td className="px-4 py-3 text-xs text-muted-foreground">
                            {formatPeriodSummary(ev)}
                          </td>
                          <td className="px-4 py-3 text-xs text-muted-foreground">
                            <div>{ev.settings.numberOfQuestions} perguntas</div>
                            <div>Estoque: {formatStockLabel(ev)}</div>
                          </td>
                          <td className="px-4 py-3">{renderStatusBadge(ev)}</td>
                          <td className="px-4 py-3">{renderRowActions(ev)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>

          {/* Cards empilhados para mobile (< md) sem scroll horizontal */}
          <div data-testid="events-mobile-cards" className="space-y-3 md:hidden">
            {events.map((ev) => {
              const isSelected = ev.id === selectedEventId;
              return (
                <Card
                  key={ev.id}
                  className={cn(isSelected && 'border-primary/60 ring-1 ring-primary/30')}
                >
                  <CardHeader className="pb-2">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <CardTitle className="truncate text-base">{ev.name}</CardTitle>
                        <CardDescription className="truncate text-xs">
                          <code>{ev.slug}</code> · v{ev.configVersion}
                        </CardDescription>
                      </div>
                      {renderStatusBadge(ev)}
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <div className="grid grid-cols-2 gap-2 text-xs text-muted-foreground">
                      <div>
                        <span className="block font-medium text-foreground">Perguntas</span>
                        {ev.settings.numberOfQuestions} por Partida
                      </div>
                      <div>
                        <span className="block font-medium text-foreground">Estoque Brindes</span>
                        {formatStockLabel(ev)}
                      </div>
                      <div className="col-span-2">
                        <span className="block font-medium text-foreground">Período</span>
                        {formatPeriodSummary(ev)}
                      </div>
                    </div>
                    {renderRowActions(ev, true)}
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </>
      )}

      {/* Modal de criação de Evento */}
      <Dialog open={createDialogOpen} onOpenChange={setCreateDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Novo Evento</DialogTitle>
            <DialogDescription>
              Crie um novo Evento com as configurações padrão. Você poderá ajustar regras e questões em seguida.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={(e) => void handleCreateEvent(e)} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="new-event-name-input">Nome do Evento</Label>
              <Input
                id="new-event-name-input"
                type="text"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="Ex.: Feira das Águas 2026"
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="new-event-slug-input">Slug (URL amigável, opcional)</Label>
              <Input
                id="new-event-slug-input"
                type="text"
                value={newSlug}
                onChange={(e) => setNewSlug(e.target.value)}
                placeholder="gerado automaticamente se vazio"
              />
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={newIsActive}
                onChange={(e) => setNewIsActive(e.target.checked)}
                className="h-4 w-4 rounded border-input"
              />
              Evento Ativo imediatamente
            </label>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setCreateDialogOpen(false)}
                disabled={isSubmittingCreate}
              >
                Cancelar
              </Button>
              <Button type="submit" disabled={isSubmittingCreate}>
                {isSubmittingCreate ? 'Criando...' : 'Criar Evento'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Modal de clonagem de Evento */}
      <Dialog
        open={Boolean(cloneSourceEvent)}
        onOpenChange={(open) => {
          if (!open) {
            setCloneSourceEvent(null);
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Clonar Evento</DialogTitle>
            <DialogDescription>
              Origem: <strong>{cloneSourceEvent?.name}</strong>. Todas as regras, textos, cores e
              questões vinculadas serão copiados.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={(e) => void handleConfirmClone(e)} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="clone-event-name-input">Nome do Novo Evento</Label>
              <Input
                id="clone-event-name-input"
                type="text"
                value={cloneName}
                onChange={(e) => setCloneName(e.target.value)}
                required
              />
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setCloneSourceEvent(null)}
                disabled={isSubmittingClone}
              >
                Cancelar
              </Button>
              <Button id="confirm-clone-event-btn" type="submit" disabled={isSubmittingClone}>
                {isSubmittingClone ? 'Clonando...' : 'Confirmar Clonagem'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
