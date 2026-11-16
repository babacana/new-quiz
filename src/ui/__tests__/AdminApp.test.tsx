import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { InMemoryCloudGateway } from '../../adapters/inMemoryCloudGateway';
import { EventAdminController } from '../../domain/eventAdminController';
import type { Clock, RandomSource } from '../../domain/ports';
import { AdminApp } from '../AdminApp';
import { AppRouter } from '../AppRouter';

class AdminUiClock implements Clock {
  private readonly baseMs = new Date('2026-11-16T12:00:00.000Z').getTime();

  now(): number {
    return this.baseMs;
  }

  toISOString(ms?: number): string {
    return new Date(ms ?? this.baseMs).toISOString();
  }
}

class AdminUiRandom implements RandomSource {
  private counter = 0;

  next(): number {
    return 0.25;
  }

  shuffle<T>(items: readonly T[]): T[] {
    return [...items];
  }

  uuid(): string {
    this.counter += 1;
    return `22222222-0000-4000-8000-0000000000${String(this.counter).padStart(2, '0')}`;
  }
}

function createAdminUiHarness() {
  const clock = new AdminUiClock();
  const random = new AdminUiRandom();
  const cloudGateway = new InMemoryCloudGateway({
    online: true,
    seedDefaultEvent: true,
    nowIso: () => clock.toISOString(),
  });
  const controller = new EventAdminController({ cloudGateway, clock, random });
  return { cloudGateway, controller };
}

async function signInThroughUi(email: string, password: string) {
  const user = userEvent.setup();
  const emailInput = screen.getByLabelText('E-mail');
  const passwordInput = screen.getByLabelText('Senha');
  await user.clear(emailInput);
  await user.type(emailInput, email);
  await user.clear(passwordInput);
  await user.type(passwordInput, password);
  await user.click(screen.getByRole('button', { name: 'Entrar' }));
  return user;
}

describe('AdminApp (T4 - Autenticação, Multi-Evento, Banco de Questões e Dirty Check)', () => {
  it('restringe Operador à visão de estande e libera painel completo para Administrador', async () => {
    const { controller } = createAdminUiHarness();
    const { rerender } = render(<AdminApp controller={controller} />);

    // Login como Operador
    const user = await signInThroughUi('operador@caesb.df.gov.br', 'OPERADOR2025!');

    expect(await screen.findByText(/Visão do Operador de Estande/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Banco de Questões' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Equipe do Estande' })).not.toBeInTheDocument();

    // Logout e login como Administrador
    await user.click(screen.getByRole('button', { name: 'Sair' }));
    expect(await screen.findByLabelText('E-mail')).toBeInTheDocument();

    rerender(<AdminApp controller={controller} />);
    await signInThroughUi('admin@caesb.df.gov.br', 'CAESB2025!');

    expect(await screen.findByRole('button', { name: 'Eventos e Configurações' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Banco de Questões' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Equipe do Estande' })).toBeInTheDocument();

    // Cadastra novo membro na aba Equipe do Estande, promove e revoga acesso
    await user.click(screen.getByRole('button', { name: 'Equipe do Estande' }));
    await user.type(screen.getByLabelText('Nome Completo'), 'Carlos Operador');
    await user.type(screen.getByLabelText('E-mail'), 'carlos@caesb.df.gov.br');
    await user.type(screen.getByLabelText('Senha (mín. 6 caracteres)'), 'CAESB_OP_26');
    await user.click(screen.getByRole('button', { name: 'Cadastrar Membro' }));

    expect(await screen.findByText('carlos@caesb.df.gov.br')).toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText('Perfil de carlos@caesb.df.gov.br'), 'admin');
    expect(await screen.findByText(/Perfil de "Carlos Operador" atualizado/i)).toBeInTheDocument();

    const revokeButtons = screen.getAllByRole('button', { name: 'Revogar Acesso' });
    await user.click(revokeButtons[revokeButtons.length - 1]);
    expect(await screen.findByText(/Acesso de "Carlos Operador" revogado/i)).toBeInTheDocument();
  });

  it('valida soma de percentuais 100%, clona Evento existente e exibe alerta de alterações não salvas', async () => {
    const { controller } = createAdminUiHarness();
    render(<AdminApp controller={controller} />);

    const user = await signInThroughUi('admin@caesb.df.gov.br', 'CAESB2025!');
    expect(await screen.findByDisplayValue('Quiz Interativo CAESB')).toBeInTheDocument();

    // Altera percentual Fácil para gerar soma inválida (90%) e valida mensagem de erro
    const facilInput = screen.getByLabelText('Fácil (%)');
    fireEvent.change(facilInput, { target: { value: '30' } });
    expect(screen.getByText(/Soma atual: 90%/i)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Salvar Evento e Configurações' }));
    expect(
      await screen.findByText(/soma dos percentuais de dificuldade deve ser exatamente 100%/i),
    ).toBeInTheDocument();

    // Corrige percentual e tenta navegar para outra aba sem salvar -> deve abrir modal Dirty Check
    fireEvent.change(facilInput, { target: { value: '40' } });
    expect(screen.getByText(/Soma atual: 100%/i)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Banco de Questões' }));
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Alterações Não Salvas' })).toBeInTheDocument();

    // Clicar em "Cancelar" mantém na aba Eventos
    await user.click(screen.getByRole('button', { name: 'Cancelar' }));
    expect(screen.getByDisplayValue('Quiz Interativo CAESB')).toBeInTheDocument();

    // Clicar novamente e escolher "Salvar e Sair" salva o Evento e navega para Banco de Questões
    await user.click(screen.getByRole('button', { name: 'Banco de Questões' }));
    await user.click(await screen.findByRole('button', { name: 'Salvar e Sair' }));
    expect(await screen.findByText('Banco de Questões Central')).toBeInTheDocument();

    // Volta para Eventos e clona o Evento existente
    await user.click(screen.getByRole('button', { name: 'Eventos e Configurações' }));
    await user.click(await screen.findByRole('button', { name: 'Clonar Evento' }));
    const cloneInput = await screen.findByLabelText('Nome do Novo Evento');
    await user.clear(cloneInput);
    await user.type(cloneInput, 'Feira Sustentável 2026');
    await user.click(screen.getByRole('button', { name: 'Confirmar Clonagem' }));

    expect(await screen.findByText('Feira Sustentável 2026')).toBeInTheDocument();
  });

  it('filtra, pré-visualiza, opera em lote e importa questões no Banco de Questões', async () => {
    const { controller } = createAdminUiHarness();
    render(<AdminApp controller={controller} />);

    const user = await signInThroughUi('admin@caesb.df.gov.br', 'CAESB2025!');
    await user.click(await screen.findByRole('button', { name: 'Banco de Questões' }));
    expect(await screen.findByText('Banco de Questões Central')).toBeInTheDocument();

    // Filtro por dificuldade difícil
    await user.selectOptions(screen.getByLabelText('Filtrar por dificuldade'), 'dificil');
    await waitFor(() => {
      expect(screen.getByText(/2 resultado\(s\)/i)).toBeInTheDocument();
    });

    // Busca por enunciado
    await user.selectOptions(screen.getByLabelText('Filtrar por dificuldade'), 'all');
    await user.type(screen.getByPlaceholderText(/Buscar por enunciado/i), 'lago artificial');
    await waitFor(() => {
      expect(screen.getByText(/1 resultado\(s\)/i)).toBeInTheDocument();
    });

    // Pré-visualização no formato do Quiz
    await user.click(screen.getByRole('button', { name: 'Pré-visualizar' }));
    expect(await screen.findByRole('dialog', { name: 'Pré-visualização da Questão no Quiz' })).toBeInTheDocument();
    expect(screen.getByText('Correta')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Fechar Pré-visualização' }));

    // Seleciona a questão encontrada e executa ação em lote (Desabilitar Selecionadas)
    await user.click(screen.getByLabelText('Selecionar questão #3'));
    await user.click(screen.getByRole('button', { name: 'Desabilitar Selecionadas' }));
    expect(await screen.findByText(/1 questão\(ões\) desabilitada\(s\)/i)).toBeInTheDocument();

    // Testa proteção de Dirty Check ao editar questão e tentar fechar o editor sem salvar
    await user.click(screen.getByRole('button', { name: 'Editar' }));
    const textInput = await screen.findByLabelText('Enunciado da Questão');
    await user.type(textInput, ' (editada)');
    await user.click(screen.getByRole('button', { name: 'Fechar Editor' }));
    expect(screen.getByRole('heading', { name: 'Alterações Não Salvas' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Sair sem Salvar' }));
    expect(screen.queryByLabelText('Enunciado da Questão')).not.toBeInTheDocument();

    // Exclui individualmente a questão #3 na linha da listagem
    await user.click(screen.getByRole('button', { name: 'Excluir questão #3' }));
    expect(await screen.findByText(/Questão #3 excluída\./i)).toBeInTheDocument();

    // Importa JSON no modo mesclar
    await user.click(screen.getByRole('button', { name: 'Importar JSON / CSV' }));
    const textarea = await screen.findByLabelText('Conteúdo JSON ou CSV');
    const jsonPayload = JSON.stringify([
      {
        text: 'Nova questão importada via UI?',
        options: ['Sim', 'Não', 'Talvez', 'Nenhuma'],
        correctIndex: 0,
        difficulty: 'Fácil',
        tags: ['ui'],
      },
    ]);
    fireEvent.change(textarea, { target: { value: jsonPayload } });
    await user.click(screen.getByRole('button', { name: 'Executar Importação' }));

    expect(await screen.findByText(/Importação concluída: 1 questão\(ões\) processadas/i)).toBeInTheDocument();
  });

  it('separa rotas do Totem público, #admin e #operador sem expor atalho administrativo no Totem', () => {
    window.location.hash = '';
    const { unmount } = render(<AppRouter />);
    expect(screen.queryByRole('button', { name: /Painel Admin/i })).not.toBeInTheDocument();
    unmount();

    window.location.hash = '#operador';
    const { unmount: unmountOp } = render(<AppRouter />);
    expect(screen.getByRole('heading', { name: 'Operação do Estande' })).toBeInTheDocument();
    unmountOp();

    window.location.hash = '#admin';
    render(<AppRouter />);
    expect(screen.getByRole('heading', { name: 'Painel Administrativo do Quiz' })).toBeInTheDocument();
    window.location.hash = '';
  });
});
