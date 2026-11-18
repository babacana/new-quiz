import type { AdminCloudPort } from '../ports';
import type { AuthSession, CreateStaffAccountInput, UserProfile, UserRole } from '../types';
import type { AdminAuthGate } from './adminContext';

// Módulo de domínio para autenticação, validação RBAC e gestão de contas da Equipe do Estande.
export class StaffAuthModule implements AdminAuthGate {
  private readonly cloudGateway: AdminCloudPort;
  private session: AuthSession | null = null;

  constructor(cloudGateway: AdminCloudPort) {
    this.cloudGateway = cloudGateway;
  }

  async login(email: string, password: string): Promise<AuthSession> {
    if (!email.trim() || !password) {
      throw new Error('Informe e-mail e senha para entrar.');
    }
    const session = await this.cloudGateway.authenticate(email, password);
    this.session = session;
    return structuredClone(session);
  }

  async restoreSession(): Promise<AuthSession | null> {
    const existing = await this.cloudGateway.getCurrentSession();
    this.session = existing;
    return existing ? structuredClone(existing) : null;
  }

  async logout(): Promise<void> {
    await this.cloudGateway.signOut();
    this.session = null;
  }

  getSession(): AuthSession | null {
    return this.session ? structuredClone(this.session) : null;
  }

  getCurrentRole(): UserRole | null {
    return this.session?.user.role ?? null;
  }

  canAccessAdminPanel(): boolean {
    return this.session?.user.role === 'admin';
  }

  canAccessOperatorPanel(): boolean {
    return this.session?.user.role === 'admin' || this.session?.user.role === 'operator';
  }

  requireAuthenticated(): AuthSession {
    if (!this.session) {
      throw new Error('Sessão não autenticada. Faça login para continuar.');
    }
    return this.session;
  }

  requireStaff(): AuthSession {
    const session = this.requireAuthenticated();
    if (session.user.role !== 'admin' && session.user.role !== 'operator') {
      throw new Error('Acesso negado: perfil sem permissão operacional.');
    }
    return session;
  }

  requireAdmin(): AuthSession {
    const session = this.requireAuthenticated();
    if (session.user.role !== 'admin') {
      throw new Error(
        'Acesso negado: apenas o perfil Administrador pode realizar esta operação.',
      );
    }
    return session;
  }

  async listStaffAccounts(): Promise<UserProfile[]> {
    this.requireAdmin();
    return this.cloudGateway.listStaffProfiles();
  }

  async createStaffAccount(input: CreateStaffAccountInput): Promise<UserProfile> {
    this.requireAdmin();

    const name = input.name.trim();
    const email = input.email.trim().toLowerCase();
    if (!name) {
      throw new Error('O nome do membro da Equipe do Estande é obrigatório.');
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      throw new Error('Informe um e-mail válido.');
    }
    if (!input.password || input.password.length < 6) {
      throw new Error('A senha deve possuir no mínimo 6 caracteres.');
    }
    if (input.role !== 'admin' && input.role !== 'operator') {
      throw new Error('Perfil inválido. Utilize admin ou operator.');
    }

    return this.cloudGateway.createStaffProfile({
      name,
      email,
      password: input.password,
      role: input.role,
    });
  }

  async updateStaffRole(profileId: string, role: UserRole): Promise<UserProfile> {
    const session = this.requireAdmin();
    if (session.user.id === profileId) {
      throw new Error('Não é permitido alterar o próprio perfil enquanto autenticado.');
    }
    if (role !== 'admin' && role !== 'operator') {
      throw new Error('Perfil inválido. Utilize admin ou operator.');
    }
    return this.cloudGateway.updateStaffProfileRole(profileId, role);
  }

  async removeStaffAccount(profileId: string): Promise<void> {
    const session = this.requireAdmin();
    if (session.user.id === profileId) {
      throw new Error('Não é permitido revogar o próprio acesso da sessão atual.');
    }
    await this.cloudGateway.deleteStaffProfile(profileId);
  }
}
