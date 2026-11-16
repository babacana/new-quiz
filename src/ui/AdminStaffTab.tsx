import { useCallback, useEffect, useState } from 'react';
import type { EventAdminController } from '../domain/eventAdminController';
import type { UserProfile, UserRole } from '../domain/types';

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

  const handleRemoveMember = async (member: UserProfile) => {
    try {
      await controller.removeStaffAccount(member.id);
      await refreshStaff();
      onStatusMessage('success', `Acesso de "${member.name}" revogado com sucesso.`);
    } catch (error) {
      onStatusMessage(
        'error',
        error instanceof Error ? error.message : 'Erro ao revogar acesso do membro.',
      );
    }
  };

  return (
    <div id="admin-staff-tab" className="admin-tab-layout">
      <div className="admin-panel-card">
        <h3>Membros da Equipe do Estande ({staff.length})</h3>
        <div className="admin-events-list">
          {staff.map((member) => {
            const isCurrentSession = member.id === currentUserId;
            return (
              <div key={member.id} className="admin-event-row">
                <div>
                  <strong>{member.name}</strong> · <span>{member.email}</span>{' '}
                  {isCurrentSession && <span className="admin-badge active">Sessão atual</span>}
                </div>
                <div className="admin-row-actions">
                  <select
                    aria-label={`Perfil de ${member.email}`}
                    value={member.role}
                    disabled={isCurrentSession}
                    onChange={(e) =>
                      void handleRoleChange(member, e.target.value as UserRole)
                    }
                  >
                    <option value="operator">Operador</option>
                    <option value="admin">Administrador</option>
                  </select>
                  <button
                    type="button"
                    className="admin-btn admin-btn-danger"
                    disabled={isCurrentSession}
                    onClick={() => void handleRemoveMember(member)}
                  >
                    Revogar Acesso
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <form className="admin-panel-card" onSubmit={(e) => void handleCreateStaff(e)}>
        <h3>Cadastrar Membro da Equipe do Estande</h3>
        <div className="admin-form-grid">
          <div className="admin-field">
            <label htmlFor="staff-name-input">Nome Completo</label>
            <input
              id="staff-name-input"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
            />
          </div>

          <div className="admin-field">
            <label htmlFor="staff-email-input">E-mail</label>
            <input
              id="staff-email-input"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </div>

          <div className="admin-field">
            <label htmlFor="staff-password-input">Senha (mín. 6 caracteres)</label>
            <input
              id="staff-password-input"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </div>

          <div className="admin-field">
            <label htmlFor="staff-role-select">Perfil de Acesso</label>
            <select
              id="staff-role-select"
              value={role}
              onChange={(e) => setRole(e.target.value as UserRole)}
            >
              <option value="operator">Operador</option>
              <option value="admin">Administrador</option>
            </select>
          </div>
        </div>

        <div className="admin-form-footer">
          <button id="create-staff-btn" type="submit" className="admin-btn admin-btn-primary">
            Cadastrar Membro
          </button>
        </div>
      </form>
    </div>
  );
}
