import { useCallback, useEffect, useState } from 'react';
import { ShieldCheck, Trash2, UserPlus, Users } from 'lucide-react';
import type { EventAdminController } from '../domain/eventAdminController';
import type { UserProfile, UserRole } from '../domain/types';
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
import { Select } from './components/ui/select';
import { cn } from './lib/utils';

export interface AdminStaffTabProps {
  controller: EventAdminController;
  onStatusMessage: (type: 'success' | 'error', message: string) => void;
}

const ROLE_LABELS: Record<UserRole, string> = {
  admin: 'Administrador',
  operator: 'Operador',
};

// Aba administrativa para cadastro, alteração de perfil e revogação de contas da Equipe do Estande.
export function AdminStaffTab({ controller, onStatusMessage }: AdminStaffTabProps) {
  const [staff, setStaff] = useState<UserProfile[]>([]);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<UserRole>('operator');
  const [memberToRevoke, setMemberToRevoke] = useState<UserProfile | null>(null);

  const currentUserId = controller.getSession()?.user.id ?? null;

  const refreshStaff = useCallback(async () => {
    try {
      const list = await controller.listStaffAccounts();
      setStaff(list);
    } catch (error) {
      onStatusMessage(
        'error',
        error instanceof Error ? error.message : 'Erro ao listar Equipe do Estande.',
      );
    }
  }, [controller, onStatusMessage]);

  useEffect(() => {
    void refreshStaff();
  }, [refreshStaff]);

  const handleCreateStaff = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const created = await controller.createStaffAccount({ name, email, password, role });
      setName('');
      setEmail('');
      setPassword('');
      setRole('operator');
      await refreshStaff();
      onStatusMessage(
        'success',
        `Conta "${created.name}" (${ROLE_LABELS[created.role]}) cadastrada na Equipe do Estande.`,
      );
    } catch (error) {
      onStatusMessage(
        'error',
        error instanceof Error ? error.message : 'Erro ao cadastrar membro da Equipe do Estande.',
      );
    }
  };

  const handleRoleChange = async (member: UserProfile, nextRole: UserRole) => {
    try {
      const updated = await controller.updateStaffRole(member.id, nextRole);
      await refreshStaff();
      onStatusMessage(
        'success',
        `Perfil de "${updated.name}" atualizado para ${ROLE_LABELS[updated.role]}.`,
      );
    } catch (error) {
      onStatusMessage(
        'error',
        error instanceof Error ? error.message : 'Erro ao atualizar perfil do membro.',
      );
    }
  };

  const handleConfirmRevoke = async () => {
    if (!memberToRevoke) {
      return;
    }
    const target = memberToRevoke;
    setMemberToRevoke(null);
    try {
      await controller.removeStaffAccount(target.id);
      await refreshStaff();
      onStatusMessage('success', `Acesso de "${target.name}" revogado com sucesso.`);
    } catch (error) {
      onStatusMessage(
        'error',
        error instanceof Error ? error.message : 'Erro ao revogar acesso do membro.',
      );
    }
  };

  return (
    <div id="admin-staff-tab" className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold tracking-tight text-foreground">Equipe do Estande</h2>
        <p className="text-sm text-muted-foreground">
          Gerencie contas de Administrador e Operador para acesso ao painel de gestão e operação de
          brindes.
        </p>
      </div>

      {/* Tabela desktop */}
      <Card data-testid="staff-desktop-table" className="hidden md:block">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Users className="h-4 w-4 text-primary" />
            Membros da Equipe do Estande ({staff.length})
          </CardTitle>
          <CardDescription>
            Altere o perfil de acesso ou revogue credenciais de membros quando necessário.
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-y border-border bg-muted/40 text-left text-xs font-medium text-muted-foreground uppercase">
                  <th className="px-4 py-3">Membro</th>
                  <th className="px-4 py-3">E-mail</th>
                  <th className="px-4 py-3">Perfil de Acesso</th>
                  <th className="px-4 py-3 text-right">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {staff.map((member) => {
                  const isCurrentSession = member.id === currentUserId;
                  return (
                    <tr key={member.id} className="transition-colors hover:bg-muted/30">
                      <td className="px-4 py-3 font-medium text-foreground">
                        <div className="flex items-center gap-2">
                          <span>{member.name}</span>
                          {isCurrentSession && (
                            <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/15 px-2 py-0.5 text-xs font-medium text-emerald-700 dark:text-emerald-300">
                              <ShieldCheck className="h-3 w-3" />
                              Sessão atual
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">{member.email}</td>
                      <td className="px-4 py-3">
                        <Select
                          aria-label={`Perfil de ${member.email}`}
                          className="h-8 w-40 px-2 text-xs"
                          value={member.role}
                          disabled={isCurrentSession}
                          onChange={(e) =>
                            void handleRoleChange(member, e.target.value as UserRole)
                          }
                        >
                          <option value="operator">Operador</option>
                          <option value="admin">Administrador</option>
                        </Select>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <Button
                          type="button"
                          size="sm"
                          variant="destructive"
                          disabled={isCurrentSession}
                          onClick={() => setMemberToRevoke(member)}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                          Revogar Acesso
                        </Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* Cards mobile */}
      <div data-testid="staff-mobile-cards" className="space-y-3 md:hidden">
        {staff.map((member) => {
          const isCurrentSession = member.id === currentUserId;
          return (
            <Card key={member.id}>
              <CardHeader className="pb-2">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <CardTitle className="truncate text-base">{member.name}</CardTitle>
                    <CardDescription className="truncate text-xs">{member.email}</CardDescription>
                  </div>
                  <span
                    className={cn(
                      'inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-xs font-medium',
                      member.role === 'admin'
                        ? 'bg-primary/10 text-primary'
                        : 'bg-secondary text-secondary-foreground',
                    )}
                  >
                    {ROLE_LABELS[member.role]}
                  </span>
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                {isCurrentSession && (
                  <p className="text-xs font-medium text-emerald-700 dark:text-emerald-300">
                    Sessão atual ativa
                  </p>
                )}
                <div className="space-y-1.5">
                  <Label htmlFor={`staff-role-mobile-${member.id}`}>Perfil do Membro</Label>
                  <Select
                    id={`staff-role-mobile-${member.id}`}
                    aria-label={`Perfil mobile de ${member.email}`}
                    value={member.role}
                    disabled={isCurrentSession}
                    onChange={(e) => void handleRoleChange(member, e.target.value as UserRole)}
                  >
                    <option value="operator">Operador</option>
                    <option value="admin">Administrador</option>
                  </Select>
                </div>
                <Button
                  type="button"
                  size="sm"
                  variant="destructive"
                  className="w-full"
                  disabled={isCurrentSession}
                  onClick={() => setMemberToRevoke(member)}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  Revogar Acesso
                </Button>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Formulário de cadastro */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <UserPlus className="h-4 w-4 text-primary" />
            Cadastrar Membro da Equipe do Estande
          </CardTitle>
          <CardDescription>
            Crie uma nova conta de Operador (entrega de brindes) ou Administrador (acesso total).
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={(e) => void handleCreateStaff(e)} className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <div className="space-y-1.5">
                <Label htmlFor="staff-name-input">Nome Completo</Label>
                <Input
                  id="staff-name-input"
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Ex.: Maria Silva"
                  required
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="staff-email-input">E-mail</Label>
                <Input
                  id="staff-email-input"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="maria@caesb.df.gov.br"
                  required
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="staff-password-input">Senha (mín. 6 caracteres)</Label>
                <Input
                  id="staff-password-input"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="staff-role-select">Perfil de Acesso</Label>
                <Select
                  id="staff-role-select"
                  value={role}
                  onChange={(e) => setRole(e.target.value as UserRole)}
                >
                  <option value="operator">Operador</option>
                  <option value="admin">Administrador</option>
                </Select>
              </div>
            </div>

            <div className="flex justify-end">
              <Button id="create-staff-btn" type="submit">
                Cadastrar Membro
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      {/* Modal de confirmação de revogação */}
      <Dialog
        open={Boolean(memberToRevoke)}
        onOpenChange={(open) => {
          if (!open) setMemberToRevoke(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Confirmar Revogação de Acesso</DialogTitle>
            <DialogDescription>
              Deseja revogar o acesso de &ldquo;{memberToRevoke?.name}&rdquo; (
              {memberToRevoke?.email})? O usuário não poderá mais entrar no painel.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setMemberToRevoke(null)}>
              Cancelar
            </Button>
            <Button type="button" variant="destructive" onClick={() => void handleConfirmRevoke()}>
              Confirmar Revogação
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
