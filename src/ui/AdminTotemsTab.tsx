import { useCallback, useEffect, useState } from 'react';
import {
  ArrowRightLeft,
  Check,
  Copy,
  Link2,
  Monitor,
  RefreshCw,
  RotateCcw,
  Send,
  Wifi,
  WifiOff,
} from 'lucide-react';
import type { EventAdminController } from '../domain/eventAdminController';
import type { EventConfig, TotemRecord } from '../domain/types';
import { Button } from './components/ui/button';
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
import {
  TOTEM_ONLINE_STATUS_LABELS,
  TOTEM_SCREEN_LABELS,
  formatLastSeenPtBr,
} from './formatters';
import { cn } from './lib/utils';

export interface AdminTotemsTabProps {
  controller: EventAdminController;
  events: EventConfig[];
  onStatusMessage: (type: 'success' | 'error', message: string) => void;
}

type ReloadTargetScreen = 'initial-screen' | 'idle-screen';

type PendingBatchCommand =
  | { type: 'switch-event'; targetEventId: string; newEventId: string }
  | { type: 'force-sync'; targetEventId: string }
  | { type: 'reload-screen'; targetEventId: string; screen: ReloadTargetScreen };

const SELECT_CLASSES =
  'flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm text-foreground shadow-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50';

function resolveValidEventId(currentId: string, events: EventConfig[]): string {
  return currentId && events.some((e) => e.id === currentId) ? currentId : (events[0]?.id ?? '');
}

// Aba administrativa de Pareamento de Totens, Monitoramento ao Vivo e Comandos Remotos.
export function AdminTotemsTab({
  controller,
  events,
  onStatusMessage,
}: AdminTotemsTabProps) {
  const [totems, setTotems] = useState<TotemRecord[]>([]);
  const [pairingCodeInput, setPairingCodeInput] = useState('');
  const [totemNameInput, setTotemNameInput] = useState('');
  const [pinCodeInput, setPinCodeInput] = useState('1234');
  const [selectedEventId, setSelectedEventId] = useState<string>(() => events[0]?.id ?? '');
  const [generatedActivationLink, setGeneratedActivationLink] = useState<string | null>(null);
  const [copiedLink, setCopiedLink] = useState(false);

  const [batchTargetEventId, setBatchTargetEventId] = useState<string>(() => events[0]?.id ?? '');
  const [batchSwitchEventId, setBatchSwitchEventId] = useState<string>(() => events[0]?.id ?? '');
  const [batchReloadScreen, setBatchReloadScreen] =
    useState<ReloadTargetScreen>('initial-screen');
  const [pendingBatchCommand, setPendingBatchCommand] = useState<PendingBatchCommand | null>(null);

  const [rowEventSelection, setRowEventSelection] = useState<Record<string, string>>({});
  const [rowReloadSelection, setRowReloadSelection] = useState<
    Record<string, ReloadTargetScreen>
  >({});
  const [mobileCommandTotem, setMobileCommandTotem] = useState<TotemRecord | null>(null);

  useEffect(() => {
    if (events.length === 0) {
      return;
    }
    setSelectedEventId((prev) => resolveValidEventId(prev, events));
    setBatchTargetEventId((prev) => resolveValidEventId(prev, events));
    setBatchSwitchEventId((prev) => resolveValidEventId(prev, events));
  }, [events]);

  const refreshTotems = useCallback(async () => {
    try {
      const list = await controller.listTotems();
      setTotems(list);
      setRowEventSelection((prev) => {
        const next: Record<string, string> = { ...prev };
        for (const totem of list) {
          if (!next[totem.id]) {
            next[totem.id] = totem.eventId ?? events[0]?.id ?? '';
          }
        }
        return next;
      });
    } catch (error) {
      onStatusMessage(
        'error',
        error instanceof Error ? error.message : 'Erro ao listar Totens pareados.',
      );
    }
  }, [controller, events, onStatusMessage]);

  useEffect(() => {
    void refreshTotems();
    const unsubscribe = controller.subscribeTotemUpdates(() => {
      void refreshTotems();
    });
    const refreshInterval = window.setInterval(() => {
      void refreshTotems();
    }, 30_000);
    return () => {
      unsubscribe();
      window.clearInterval(refreshInterval);
    };
  }, [controller, refreshTotems]);

  const handleAuthorizePairing = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const authorized = await controller.authorizeTotemPairing({
        pairingCode: pairingCodeInput.trim() || undefined,
        name: totemNameInput,
        pinCode: pinCodeInput,
        eventId: selectedEventId,
      });
      const origin = typeof window !== 'undefined' ? window.location.origin : '';
      const link = controller.buildTotemActivationLink(authorized.pairingCode, origin);
      setGeneratedActivationLink(link);
      setCopiedLink(false);
      setPairingCodeInput('');
      setTotemNameInput('');
      await refreshTotems();
      onStatusMessage(
        'success',
        `Totem "${authorized.name}" pareado com código ${authorized.pairingCode}.`,
      );
    } catch (error) {
      onStatusMessage(
        'error',
        error instanceof Error ? error.message : 'Erro ao autorizar Pareamento do Totem.',
      );
    }
  };

  const handleCopyActivationLink = async () => {
    if (!generatedActivationLink) {
      return;
    }
    try {
      await navigator.clipboard?.writeText(generatedActivationLink);
      setCopiedLink(true);
      onStatusMessage('success', 'Link de ativação copiado para a área de transferência.');
    } catch {
      onStatusMessage('error', 'Não foi possível copiar o link de ativação.');
    }
  };

  const handleRunCommand = async (action: () => Promise<unknown>, successMessage: string) => {
    try {
      await action();
      await refreshTotems();
      onStatusMessage('success', successMessage);
    } catch (error) {
      onStatusMessage(
        'error',
        error instanceof Error ? error.message : 'Erro ao enviar comando remoto.',
      );
    }
  };

  const handleConfirmBatchCommand = async () => {
    if (!pendingBatchCommand) {
      return;
    }
    const cmd = pendingBatchCommand;
    setPendingBatchCommand(null);

    if (cmd.type === 'switch-event') {
      await handleRunCommand(
        () => controller.switchTotemEvent({ eventId: cmd.targetEventId }, cmd.newEventId),
        'Comando SWITCH_EVENT enviado para os Totens do Evento.',
      );
      return;
    }
    if (cmd.type === 'force-sync') {
      await handleRunCommand(
        () => controller.forceSyncTotems({ eventId: cmd.targetEventId }),
        'Comando FORCE_SYNC enviado para os Totens do Evento.',
      );
      return;
    }
    await handleRunCommand(
      () => controller.reloadTotemScreen({ eventId: cmd.targetEventId }, cmd.screen),
      'Comando RELOAD_SCREEN enviado para os Totens do Evento.',
    );
  };

  const eventNameById = new Map(events.map((ev) => [ev.id, ev.name]));

  const renderStatusBadges = (totem: TotemRecord) => {
    const isOnline = totem.onlineStatus === 'online';
    return (
      <div className="flex flex-wrap items-center gap-1.5">
        <span
          className={cn(
            'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium',
            isOnline
              ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300'
              : 'bg-rose-500/15 text-rose-700 dark:text-rose-300',
          )}
        >
          {isOnline ? <Wifi className="h-3 w-3" /> : <WifiOff className="h-3 w-3" />}
          {TOTEM_ONLINE_STATUS_LABELS[totem.onlineStatus]}
        </span>
        <span
          className={cn(
            'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium',
            totem.isPaired
              ? 'bg-primary/10 text-primary'
              : 'bg-amber-500/15 text-amber-700 dark:text-amber-300',
          )}
        >
          {totem.isPaired ? 'Pareado' : 'Aguardando Autorização'}
        </span>
      </div>
    );
  };

  return (
    <div id="admin-totems-tab" className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-2xl font-bold tracking-tight text-foreground">
            Totens e Pareamento
          </h2>
          <p className="text-sm text-muted-foreground">
            Autorize dispositivos, acompanhe telemetria ao vivo e envie comandos remotos por Totem
            ou por Evento.
          </p>
        </div>
        <Button type="button" variant="outline" onClick={() => void refreshTotems()}>
          <RefreshCw className="h-4 w-4" />
          Atualizar Lista
        </Button>
      </div>

      {/* Formulário de autorização de pareamento */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Link2 className="h-4 w-4 text-primary" />
            Autorizar Pareamento de Totem
          </CardTitle>
          <CardDescription>
            Informe o código exibido no Totem ou deixe em branco para gerar um código e link de
            ativação automaticamente.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={(e) => void handleAuthorizePairing(e)} className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <div className="space-y-1.5">
                <Label htmlFor="totem-pairing-code-input">Código de Pareamento</Label>
                <Input
                  id="totem-pairing-code-input"
                  type="text"
                  value={pairingCodeInput}
                  onChange={(e) => setPairingCodeInput(e.target.value.toUpperCase())}
                  placeholder="Opcional (ex.: ABC123)"
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="totem-name-input">Nome do Totem</Label>
                <Input
                  id="totem-name-input"
                  type="text"
                  value={totemNameInput}
                  onChange={(e) => setTotemNameInput(e.target.value)}
                  placeholder="Ex.: Totem Estande 01"
                  required
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="totem-pin-code-input">PIN Local</Label>
                <Input
                  id="totem-pin-code-input"
                  type="text"
                  inputMode="numeric"
                  value={pinCodeInput}
                  onChange={(e) => setPinCodeInput(e.target.value)}
                  required
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="totem-event-select">Evento Vinculado</Label>
                <select
                  id="totem-event-select"
                  className={SELECT_CLASSES}
                  value={selectedEventId}
                  onChange={(e) => setSelectedEventId(e.target.value)}
                  required
                >
                  {events.map((ev) => (
                    <option key={ev.id} value={ev.id}>
                      {ev.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-end gap-2">
              <Button id="authorize-totem-btn" type="submit" disabled={events.length === 0}>
                Autorizar Pareamento
              </Button>
            </div>

            {generatedActivationLink && (
              <div
                role="status"
                className="flex flex-col gap-2 rounded-md border border-emerald-500/30 bg-emerald-500/10 p-3 text-sm sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="min-w-0 space-y-0.5">
                  <p className="font-medium text-emerald-800 dark:text-emerald-200">
                    Link de ativação gerado:
                  </p>
                  <code
                    id="generated-activation-link"
                    className="block break-all text-xs text-emerald-900 dark:text-emerald-100"
                  >
                    {generatedActivationLink}
                  </code>
                </div>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => void handleCopyActivationLink()}
                >
                  {copiedLink ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                  {copiedLink ? 'Copiado' : 'Copiar Link'}
                </Button>
              </div>
            )}
          </form>
        </CardContent>
      </Card>

      {/* Monitoramento ao vivo: Tabela Desktop + Cards Mobile */}
      {totems.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center gap-2 py-12 text-center">
            <Monitor className="h-8 w-8 text-muted-foreground" />
            <p className="font-medium text-foreground">Nenhum Totem cadastrado</p>
            <p className="text-sm text-muted-foreground">
              Autorize um Totem acima ou aguarde um dispositivo solicitar pareamento.
            </p>
          </CardContent>
        </Card>
      ) : (
        <>
          <Card data-testid="totems-desktop-table" className="hidden md:block">
            <CardHeader className="pb-3">
              <CardTitle className="text-base">
                Monitoramento ao Vivo dos Totens ({totems.length})
              </CardTitle>
              <CardDescription>
                Telemetria em tempo real e envio de comandos individuais por dispositivo.
              </CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-sm">
                  <thead>
                    <tr className="border-y border-border bg-muted/40 text-left text-xs font-medium text-muted-foreground uppercase">
                      <th className="px-4 py-3">Totem</th>
                      <th className="px-4 py-3">Status</th>
                      <th className="px-4 py-3">Tela / Telemetria</th>
                      <th className="px-4 py-3">Evento</th>
                      <th className="px-4 py-3 text-right">Comandos Remotos</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {totems.map((totem) => {
                      const targetEventId =
                        rowEventSelection[totem.id] ?? totem.eventId ?? events[0]?.id ?? '';
                      const targetReloadScreen = rowReloadSelection[totem.id] ?? 'initial-screen';
                      return (
                        <tr key={totem.id} className="transition-colors hover:bg-muted/30">
                          <td className="px-4 py-3 align-top">
                            <div className="font-medium text-foreground">{totem.name}</div>
                            <div className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">
                              <code>{totem.pairingCode}</code>
                              <span>·</span>
                              <span>v{totem.configVersion}</span>
                            </div>
                          </td>
                          <td className="px-4 py-3 align-top">{renderStatusBadges(totem)}</td>
                          <td className="px-4 py-3 align-top text-xs text-muted-foreground">
                            <div className="font-medium text-foreground">
                              Tela: {TOTEM_SCREEN_LABELS[totem.currentScreen]}
                            </div>
                            <div>Último ping: {formatLastSeenPtBr(totem.lastSeenAt)}</div>
                            <div>Fila local: {totem.pendingSyncCount} item(ns)</div>
                          </td>
                          <td className="px-4 py-3 align-top text-xs text-muted-foreground">
                            {totem.eventId
                              ? (eventNameById.get(totem.eventId) ?? totem.eventId)
                              : 'Não vinculado'}
                          </td>
                          <td className="px-4 py-3 align-top">
                            {totem.isPaired ? (
                              <div className="flex flex-col items-end gap-2">
                                <div className="flex items-center gap-1.5">
                                  <select
                                    aria-label={`Trocar Evento de ${totem.name}`}
                                    className="h-8 rounded-md border border-input bg-background px-2 text-xs text-foreground"
                                    value={targetEventId}
                                    onChange={(e) =>
                                      setRowEventSelection((prev) => ({
                                        ...prev,
                                        [totem.id]: e.target.value,
                                      }))
                                    }
                                  >
                                    {events.map((ev) => (
                                      <option key={ev.id} value={ev.id}>
                                        {ev.name}
                                      </option>
                                    ))}
                                  </select>
                                  <Button
                                    type="button"
                                    size="sm"
                                    variant="outline"
                                    disabled={!targetEventId}
                                    onClick={() =>
                                      void handleRunCommand(
                                        () =>
                                          controller.switchTotemEvent(
                                            { totemId: totem.id },
                                            targetEventId,
                                          ),
                                        `Comando Trocar Evento enviado para "${totem.name}".`,
                                      )
                                    }
                                  >
                                    Trocar Evento
                                  </Button>
                                  <Button
                                    type="button"
                                    size="sm"
                                    variant="outline"
                                    onClick={() =>
                                      void handleRunCommand(
                                        () => controller.forceSyncTotems({ totemId: totem.id }),
                                        `Comando Forçar Sincronização enviado para "${totem.name}".`,
                                      )
                                    }
                                  >
                                    Forçar Sincronização
                                  </Button>
                                </div>

                                <div className="flex items-center gap-1.5">
                                  <select
                                    aria-label={`Tela de reinício de ${totem.name}`}
                                    className="h-8 rounded-md border border-input bg-background px-2 text-xs text-foreground"
                                    value={targetReloadScreen}
                                    onChange={(e) =>
                                      setRowReloadSelection((prev) => ({
                                        ...prev,
                                        [totem.id]: e.target.value as ReloadTargetScreen,
                                      }))
                                    }
                                  >
                                    <option value="initial-screen">Tela Inicial</option>
                                    <option value="idle-screen">Tela de Descanso</option>
                                  </select>
                                  <Button
                                    type="button"
                                    size="sm"
                                    variant="outline"
                                    onClick={() =>
                                      void handleRunCommand(
                                        () =>
                                          controller.reloadTotemScreen(
                                            { totemId: totem.id },
                                            targetReloadScreen,
                                          ),
                                        `Comando Reiniciar Tela enviado para "${totem.name}".`,
                                      )
                                    }
                                  >
                                    Reiniciar Tela
                                  </Button>
                                </div>
                              </div>
                            ) : (
                              <span className="block text-right text-xs text-muted-foreground">
                                Aguardando pareamento
                              </span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>

          <div data-testid="totems-mobile-cards" className="space-y-3 md:hidden">
            {totems.map((totem) => (
              <Card key={totem.id}>
                <CardHeader className="pb-2">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <CardTitle className="truncate text-base">{totem.name}</CardTitle>
                      <CardDescription className="text-xs">
                        <code>{totem.pairingCode}</code> · v{totem.configVersion}
                      </CardDescription>
                    </div>
                    {renderStatusBadges(totem)}
                  </div>
                </CardHeader>
                <CardContent className="space-y-3 text-xs text-muted-foreground">
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <span className="block font-medium text-foreground">Tela Atual</span>
                      {TOTEM_SCREEN_LABELS[totem.currentScreen]}
                    </div>
                    <div>
                      <span className="block font-medium text-foreground">Fila Local</span>
                      {totem.pendingSyncCount} item(ns)
                    </div>
                    <div className="col-span-2">
                      <span className="block font-medium text-foreground">Evento</span>
                      {totem.eventId
                        ? (eventNameById.get(totem.eventId) ?? totem.eventId)
                        : 'Não vinculado'}
                    </div>
                    <div className="col-span-2">
                      <span className="block font-medium text-foreground">Último ping</span>
                      {formatLastSeenPtBr(totem.lastSeenAt)}
                    </div>
                  </div>
                  {totem.isPaired && (
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="w-full"
                      onClick={() => setMobileCommandTotem(totem)}
                    >
                      <Send className="h-3.5 w-3.5" />
                      Comandos Remotos
                    </Button>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        </>
      )}

      {/* Comandos Remotos em Lote por Evento */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Comandos Remotos em Lote por Evento</CardTitle>
          <CardDescription>
            Dispare atualizações simultâneas para todos os Totens vinculados a um Evento.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="space-y-1.5">
              <Label htmlFor="batch-target-event-select">Evento Alvo do Comando</Label>
              <select
                id="batch-target-event-select"
                className={SELECT_CLASSES}
                value={batchTargetEventId}
                onChange={(e) => setBatchTargetEventId(e.target.value)}
              >
                {events.map((ev) => (
                  <option key={ev.id} value={ev.id}>
                    {ev.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="batch-switch-event-select">Novo Evento em Lote</Label>
              <select
                id="batch-switch-event-select"
                className={SELECT_CLASSES}
                value={batchSwitchEventId}
                onChange={(e) => setBatchSwitchEventId(e.target.value)}
              >
                {events.map((ev) => (
                  <option key={ev.id} value={ev.id}>
                    {ev.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="batch-reload-screen-select">Tela de Destino em Lote</Label>
              <select
                id="batch-reload-screen-select"
                className={SELECT_CLASSES}
                value={batchReloadScreen}
                onChange={(e) => setBatchReloadScreen(e.target.value as ReloadTargetScreen)}
              >
                <option value="initial-screen">Tela Inicial</option>
                <option value="idle-screen">Tela de Descanso</option>
              </select>
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="secondary"
              disabled={!batchTargetEventId || !batchSwitchEventId}
              onClick={() =>
                setPendingBatchCommand({
                  type: 'switch-event',
                  targetEventId: batchTargetEventId,
                  newEventId: batchSwitchEventId,
                })
              }
            >
              <ArrowRightLeft className="h-4 w-4" />
              Trocar Evento de Todos os Totens
            </Button>
            <Button
              type="button"
              variant="secondary"
              disabled={!batchTargetEventId}
              onClick={() =>
                setPendingBatchCommand({
                  type: 'force-sync',
                  targetEventId: batchTargetEventId,
                })
              }
            >
              <RefreshCw className="h-4 w-4" />
              Forçar Sincronização do Evento
            </Button>
            <Button
              type="button"
              variant="secondary"
              disabled={!batchTargetEventId}
              onClick={() =>
                setPendingBatchCommand({
                  type: 'reload-screen',
                  targetEventId: batchTargetEventId,
                  screen: batchReloadScreen,
                })
              }
            >
              <RotateCcw className="h-4 w-4" />
              Reiniciar Tela do Evento
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Modal de Comandos Remotos Individuais no Mobile */}
      <Dialog
        open={Boolean(mobileCommandTotem)}
        onOpenChange={(open) => {
          if (!open) setMobileCommandTotem(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Comandos Remotos · {mobileCommandTotem?.name}</DialogTitle>
            <DialogDescription>
              Envie comandos individuais para o Totem selecionado.
            </DialogDescription>
          </DialogHeader>
          {mobileCommandTotem && (
            <div className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="mobile-totem-switch-select">Trocar Evento</Label>
                <div className="flex gap-2">
                  <select
                    id="mobile-totem-switch-select"
                    className={SELECT_CLASSES}
                    value={
                      rowEventSelection[mobileCommandTotem.id] ??
                      mobileCommandTotem.eventId ??
                      events[0]?.id ??
                      ''
                    }
                    onChange={(e) =>
                      setRowEventSelection((prev) => ({
                        ...prev,
                        [mobileCommandTotem.id]: e.target.value,
                      }))
                    }
                  >
                    {events.map((ev) => (
                      <option key={ev.id} value={ev.id}>
                        {ev.name}
                      </option>
                    ))}
                  </select>
                  <Button
                    type="button"
                    size="sm"
                    onClick={() => {
                      const targetId =
                        rowEventSelection[mobileCommandTotem.id] ??
                        mobileCommandTotem.eventId ??
                        events[0]?.id ??
                        '';
                      void handleRunCommand(
                        () => controller.switchTotemEvent({ totemId: mobileCommandTotem.id }, targetId),
                        `Comando Trocar Evento enviado para "${mobileCommandTotem.name}".`,
                      );
                      setMobileCommandTotem(null);
                    }}
                  >
                    Aplicar
                  </Button>
                </div>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="mobile-totem-reload-select">Reiniciar Tela</Label>
                <div className="flex gap-2">
                  <select
                    id="mobile-totem-reload-select"
                    className={SELECT_CLASSES}
                    value={rowReloadSelection[mobileCommandTotem.id] ?? 'initial-screen'}
                    onChange={(e) =>
                      setRowReloadSelection((prev) => ({
                        ...prev,
                        [mobileCommandTotem.id]: e.target.value as ReloadTargetScreen,
                      }))
                    }
                  >
                    <option value="initial-screen">Tela Inicial</option>
                    <option value="idle-screen">Tela de Descanso</option>
                  </select>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      const screen = rowReloadSelection[mobileCommandTotem.id] ?? 'initial-screen';
                      void handleRunCommand(
                        () =>
                          controller.reloadTotemScreen({ totemId: mobileCommandTotem.id }, screen),
                        `Comando Reiniciar Tela enviado para "${mobileCommandTotem.name}".`,
                      );
                      setMobileCommandTotem(null);
                    }}
                  >
                    Reiniciar
                  </Button>
                </div>
              </div>

              <Button
                type="button"
                variant="secondary"
                className="w-full"
                onClick={() => {
                  void handleRunCommand(
                    () => controller.forceSyncTotems({ totemId: mobileCommandTotem.id }),
                    `Comando Forçar Sincronização enviado para "${mobileCommandTotem.name}".`,
                  );
                  setMobileCommandTotem(null);
                }}
              >
                <RefreshCw className="h-4 w-4" />
                Forçar Sincronização
              </Button>
            </div>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setMobileCommandTotem(null)}>
              Fechar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Modal de Confirmação de Comando em Lote */}
      <Dialog
        open={Boolean(pendingBatchCommand)}
        onOpenChange={(open) => {
          if (!open) setPendingBatchCommand(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Confirmar Comando em Lote</DialogTitle>
            <DialogDescription>
              {pendingBatchCommand?.type === 'switch-event' &&
                `Todos os Totens do Evento "${
                  eventNameById.get(pendingBatchCommand.targetEventId) ??
                  pendingBatchCommand.targetEventId
                }" serão migrados para "${
                  eventNameById.get(pendingBatchCommand.newEventId) ??
                  pendingBatchCommand.newEventId
                }".`}
              {pendingBatchCommand?.type === 'force-sync' &&
                `Todos os Totens do Evento "${
                  eventNameById.get(pendingBatchCommand.targetEventId) ??
                  pendingBatchCommand.targetEventId
                }" receberão o comando de sincronização forçada.`}
              {pendingBatchCommand?.type === 'reload-screen' &&
                `Todos os Totens do Evento "${
                  eventNameById.get(pendingBatchCommand.targetEventId) ??
                  pendingBatchCommand.targetEventId
                }" reiniciarão para a ${
                  pendingBatchCommand.screen === 'idle-screen'
                    ? 'Tela de Descanso'
                    : 'Tela Inicial'
                }.`}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setPendingBatchCommand(null)}>
              Cancelar
            </Button>
            <Button type="button" onClick={() => void handleConfirmBatchCommand()}>
              Confirmar Envio
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
