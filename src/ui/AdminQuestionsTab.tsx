import { useCallback, useEffect, useState } from 'react';
import {
  Download,
  Eye,
  Pencil,
  Plus,
  Search,
  Trash2,
  Upload,
} from 'lucide-react';
import type { EventAdminController } from '../domain/eventAdminController';
import type {
  DifficultyLevel,
  PaginatedQuestionsResult,
  PreparedQuestion,
  Question,
  QuestionSortField,
  QuestionStatusFilter,
  QuestionsImportMode,
  SortDirection,
} from '../domain/types';
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
import { DIFFICULTY_LABELS, triggerFileDownload } from './formatters';
import { cn } from './lib/utils';
import type { UnsavedNavigationGuard } from './navigationGuard';

export interface AdminQuestionsTabProps {
  controller: EventAdminController;
  navigationGuard: UnsavedNavigationGuard;
  onRequestGuardedAction: (proceed: () => void) => void;
  onQuestionsChanged: () => Promise<void>;
  onRegisterSaveHandler: (handler: (() => Promise<void>) | null) => void;
  onStatusMessage: (type: 'success' | 'error', message: string) => void;
}

interface QuestionEditorState {
  editingId: number | null;
  text: string;
  options: [string, string, string, string];
  correctIndex: number;
  difficulty: DifficultyLevel;
  tagsInput: string;
  isDisabled: boolean;
}

function buildEmptyQuestionEditor(): QuestionEditorState {
  return {
    editingId: null,
    text: '',
    options: ['', '', '', ''],
    correctIndex: 0,
    difficulty: 'moderado',
    tagsInput: '',
    isDisabled: false,
  };
}

// Aba administrativa do Banco de Questões Central (tabela desktop / cards mobile, CRUD, lote, preview e CSV/JSON).
export function AdminQuestionsTab({
  controller,
  navigationGuard,
  onRequestGuardedAction,
  onQuestionsChanged,
  onRegisterSaveHandler,
  onStatusMessage,
}: AdminQuestionsTabProps) {
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [difficultyFilter, setDifficultyFilter] = useState<'all' | DifficultyLevel>('all');
  const [statusFilter, setStatusFilter] = useState<QuestionStatusFilter>('all');
  const [sortBy, setSortBy] = useState<QuestionSortField>('id');
  const [sortDirection, setSortDirection] = useState<SortDirection>('asc');
  const [page, setPage] = useState(1);
  const [pageSize] = useState(10);

  // Aplica debounce de 300ms na busca textual para evitar reconsultas por tecla digitada.
  useEffect(() => {
    if (search === debouncedSearch) {
      return;
    }
    const timerId = window.setTimeout(() => {
      setDebouncedSearch(search);
      setPage(1);
    }, 300);
    return () => window.clearTimeout(timerId);
  }, [search, debouncedSearch]);

  const [queryResult, setQueryResult] = useState<PaginatedQuestionsResult>({
    items: [],
    totalItems: 0,
    totalPages: 1,
    currentPage: 1,
    pageSize: 10,
    counts: {
      total: 0,
      active: 0,
      disabled: 0,
      byDifficulty: { facil: 0, moderado: 0, dificil: 0 },
    },
  });

  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [isEditorOpen, setIsEditorOpen] = useState(false);
  const [editorState, setEditorState] = useState<QuestionEditorState>(() =>
    buildEmptyQuestionEditor(),
  );
  const [previewData, setPreviewData] = useState<PreparedQuestion | null>(null);
  const [isImportOpen, setIsImportOpen] = useState(false);
  const [importFormat, setImportFormat] = useState<'json' | 'csv'>('json');
  const [importMode, setImportMode] = useState<QuestionsImportMode>('merge');
  const [importContent, setImportContent] = useState('');
  const [isWorkbookOpen, setIsWorkbookOpen] = useState(false);
  const [workbookFile, setWorkbookFile] = useState<File | null>(null);
  const [workbookReview, setWorkbookReview] = useState<{
    data: ArrayBuffer;
    changes: Array<{ id: number; text: string }>;
  } | null>(null);
  const [workbookError, setWorkbookError] = useState('');
  const [workbookBusy, setWorkbookBusy] = useState(false);

  const refreshList = useCallback(async () => {
    try {
      const result = await controller.queryQuestions({
        search: debouncedSearch,
        difficulties: difficultyFilter === 'all' ? undefined : [difficultyFilter],
        status: statusFilter,
        sortBy,
        sortDirection,
        page,
        pageSize,
      });
      setQueryResult(result);
    } catch (error) {
      onStatusMessage(
        'error',
        error instanceof Error ? error.message : 'Erro ao carregar Banco de Questões.',
      );
    }
  }, [
    controller,
    difficultyFilter,
    onStatusMessage,
    page,
    pageSize,
    debouncedSearch,
    sortBy,
    sortDirection,
    statusFilter,
  ]);

  useEffect(() => {
    void refreshList();
  }, [refreshList]);

  const handleSaveEditor = useCallback(async () => {
    try {
      const tags = editorState.tagsInput
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean);

      if (editorState.editingId !== null) {
        const updated = await controller.updateQuestion(editorState.editingId, {
          text: editorState.text,
          options: editorState.options,
          correctIndex: editorState.correctIndex,
          difficulty: editorState.difficulty,
          tags,
          isDisabled: editorState.isDisabled,
        });
        onStatusMessage('success', `Questão #${updated.id} atualizada com sucesso.`);
      } else {
        const created = await controller.createQuestion({
          text: editorState.text,
          options: editorState.options,
          correctIndex: editorState.correctIndex,
          difficulty: editorState.difficulty,
          tags,
          isDisabled: editorState.isDisabled,
        });
        onStatusMessage('success', `Questão #${created.id} adicionada ao Banco de Questões.`);
      }

      navigationGuard.clearDirty('question');
      setIsEditorOpen(false);
      await refreshList();
      await onQuestionsChanged();
    } catch (error) {
      onStatusMessage(
        'error',
        error instanceof Error ? error.message : 'Erro ao salvar questão.',
      );
      throw error;
    }
  }, [controller, editorState, navigationGuard, onQuestionsChanged, onStatusMessage, refreshList]);

  useEffect(() => {
    if (!isEditorOpen) {
      onRegisterSaveHandler(null);
      return;
    }
    onRegisterSaveHandler(() => handleSaveEditor());
    return () => onRegisterSaveHandler(null);
  }, [handleSaveEditor, isEditorOpen, onRegisterSaveHandler]);

  const toggleSelectId = (id: number) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id],
    );
  };

  const toggleSelectAllPage = () => {
    const pageIds = queryResult.items.map((q) => q.id);
    const allSelected = pageIds.length > 0 && pageIds.every((id) => selectedIds.includes(id));
    if (allSelected) {
      setSelectedIds((prev) => prev.filter((id) => !pageIds.includes(id)));
    } else {
      setSelectedIds((prev) => Array.from(new Set([...prev, ...pageIds])));
    }
  };

  const handleBatchDisabled = async (isDisabled: boolean) => {
    if (selectedIds.length === 0) {
      return;
    }
    try {
      const count = await controller.setQuestionsDisabled(selectedIds, isDisabled);
      setSelectedIds([]);
      await refreshList();
      await onQuestionsChanged();
      onStatusMessage(
        'success',
        `${count} questão(ões) ${isDisabled ? 'desabilitada(s)' : 'habilitada(s)'}.`,
      );
    } catch (error) {
      onStatusMessage(
        'error',
        error instanceof Error ? error.message : 'Erro na operação em lote.',
      );
    }
  };

  const handleBatchDelete = async () => {
    if (selectedIds.length === 0) {
      return;
    }
    try {
      const count = await controller.deleteQuestions(selectedIds);
      setSelectedIds([]);
      await refreshList();
      await onQuestionsChanged();
      onStatusMessage('success', `${count} questão(ões) excluída(s).`);
    } catch (error) {
      onStatusMessage(
        'error',
        error instanceof Error ? error.message : 'Erro ao excluir questões.',
      );
    }
  };

  const handleExport = async (format: 'json' | 'csv' | 'xlsx') => {
    try {
      const content =
        format === 'json'
          ? await controller.exportQuestionsJson()
          : format === 'csv'
            ? await controller.exportQuestionsCsv()
            : await controller.exportQuestionsXlsx();
      const mimeTypes = {
        json: 'application/json',
        csv: 'text/csv;charset=utf-8;',
        xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      };
      triggerFileDownload(
        `banco-questoes.${format}`,
        content,
        mimeTypes[format],
      );
      onStatusMessage(
        'success',
        `Exportação ${format.toUpperCase()} concluída (${queryResult.counts.total} questões).`,
      );
    } catch (error) {
      onStatusMessage(
        'error',
        error instanceof Error ? error.message : 'Erro ao exportar questões.',
      );
    }
  };

  const handleWorkbookSubmit = async () => {
    if (!workbookFile || workbookBusy) return;
    setWorkbookBusy(true);
    setWorkbookError('');
    try {
      if (!workbookReview) {
        const data = await workbookFile.arrayBuffer();
        const changes = await controller.previewQuestionsXlsx(data);
        setWorkbookReview({ data, changes });
        return;
      }

      const count = await controller.importQuestionsXlsx(workbookReview.data, workbookReview.changes);
      setIsWorkbookOpen(false);
      await refreshList();
      await onQuestionsChanged();
      onStatusMessage('success', `${count} questão(ões) atualizada(s) pela planilha.`);
    } catch (error) {
      setWorkbookReview(null);
      const message = error instanceof Error ? error.message : 'Erro ao importar planilha.';
      setWorkbookError(message);
      if (workbookReview) onStatusMessage('error', message);
    } finally {
      setWorkbookBusy(false);
    }
  };

  const handleImportSubmit = async () => {
    try {
      const result =
        importFormat === 'json'
          ? await controller.importQuestionsJson(importContent, importMode)
          : await controller.importQuestionsCsv(importContent, importMode);

      setIsImportOpen(false);
      setImportContent('');
      await refreshList();
      await onQuestionsChanged();
      onStatusMessage(
        'success',
        `Importação concluída: ${result.importedCount} questão(ões) processadas (${result.totalAfterImport} no acervo).`,
      );
    } catch (error) {
      onStatusMessage(
        'error',
        error instanceof Error ? error.message : 'Erro ao importar arquivo.',
      );
    }
  };

  const handleDeleteSingle = async (questionId: number) => {
    try {
      await controller.deleteQuestions([questionId]);
      setSelectedIds((prev) => prev.filter((id) => id !== questionId));
      if (isEditorOpen && editorState.editingId === questionId) {
        navigationGuard.clearDirty('question');
        setIsEditorOpen(false);
      }
      await refreshList();
      await onQuestionsChanged();
      onStatusMessage('success', `Questão #${questionId} excluída.`);
    } catch (error) {
      onStatusMessage(
        'error',
        error instanceof Error ? error.message : 'Erro ao excluir questão.',
      );
    }
  };

  const openEditQuestion = (question: Question) => {
    setEditorState({
      editingId: question.id,
      text: question.text,
      options: [...question.options],
      correctIndex: question.correctIndex,
      difficulty: question.difficulty,
      tagsInput: question.tags.join(', '),
      isDisabled: question.isDisabled,
    });
    setIsEditorOpen(true);
  };

  const renderStatusPill = (q: Question) => (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium',
        q.isDisabled
          ? 'bg-muted text-muted-foreground'
          : 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300',
      )}
    >
      {q.isDisabled ? 'Desabilitada' : 'Ativa'}
    </span>
  );

  const renderDifficultyPill = (difficulty: DifficultyLevel) => (
    <span className="inline-flex items-center rounded-full bg-secondary px-2 py-0.5 text-xs font-medium text-secondary-foreground">
      {DIFFICULTY_LABELS[difficulty]}
    </span>
  );

  const renderQuestionTags = (tags: string[]) =>
    tags.length > 0 ? (
      <div className="mt-1 flex flex-wrap gap-1">
        {tags.map((tag) => (
          <span key={tag} className="rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
            #{tag}
          </span>
        ))}
      </div>
    ) : null;

  const renderQuestionActions = (q: Question, compact = false) => (
    <div className={cn('flex flex-wrap items-center gap-1.5', !compact && 'justify-end')}>
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => setPreviewData(controller.previewQuestion(q))}
      >
        <Eye className="h-3.5 w-3.5" />
        Pré-visualizar
      </Button>
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => onRequestGuardedAction(() => openEditQuestion(q))}
      >
        <Pencil className="h-3.5 w-3.5" />
        Editar
      </Button>
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => {
          void controller.setQuestionsDisabled([q.id], !q.isDisabled).then(async () => {
            await refreshList();
            await onQuestionsChanged();
          });
        }}
      >
        {q.isDisabled ? 'Habilitar' : 'Desabilitar'}
      </Button>
      <Button
        type="button"
        variant="destructive"
        size="sm"
        aria-label={`Excluir questão #${q.id}`}
        onClick={() => void handleDeleteSingle(q.id)}
      >
        <Trash2 className="h-3.5 w-3.5" />
        Excluir
      </Button>
    </div>
  );

  return (
    <div id="admin-questions-tab" className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Banco de Questões Central</h1>
          <p className="text-sm text-muted-foreground">
            Total: {queryResult.counts.total} · Ativas: {queryResult.counts.active} ·
            Desabilitadas: {queryResult.counts.disabled}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button
            id="new-question-btn"
            type="button"
            onClick={() =>
              onRequestGuardedAction(() => {
                setEditorState(buildEmptyQuestionEditor());
                setIsEditorOpen(true);
              })
            }
          >
            <Plus className="h-4 w-4" />
            Nova Questão
          </Button>
          <Button type="button" variant="outline" size="sm" onClick={() => void handleExport('xlsx')}>
            <Download className="h-4 w-4" />
            Baixar planilha (.xlsx)
          </Button>
          <Button type="button" variant="outline" size="sm" onClick={() => {
            setWorkbookFile(null);
            setWorkbookReview(null);
            setWorkbookError('');
            setIsWorkbookOpen(true);
          }}>
            <Upload className="h-4 w-4" />
            Importar planilha (.xlsx)
          </Button>
          <Button type="button" variant="outline" size="sm" onClick={() => void handleExport('json')}>
            <Download className="h-4 w-4" />
            Exportar JSON
          </Button>
          <Button type="button" variant="outline" size="sm" onClick={() => void handleExport('csv')}>
            <Download className="h-4 w-4" />
            Exportar CSV
          </Button>
          <Button
            id="open-import-questions-btn"
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setIsImportOpen(true)}
          >
            <Upload className="h-4 w-4" />
            Importar JSON / CSV
          </Button>
        </div>
      </div>

      {/* Barra de busca e filtros */}
      <Card>
        <CardContent className="pt-6 space-y-4">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            <div className="relative sm:col-span-2 lg:col-span-1">
              <Search className="pointer-events-none absolute top-2.5 left-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                id="question-search-input"
                type="text"
                className="pl-8"
                placeholder="Buscar por enunciado, tag ou ID..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>

            <Select
              id="question-difficulty-filter"
              aria-label="Filtrar por dificuldade"
              value={difficultyFilter}
              onChange={(e) => {
                setDifficultyFilter(e.target.value as 'all' | DifficultyLevel);
                setPage(1);
              }}
            >
              <option value="all">Todas as Dificuldades</option>
              <option value="facil">Fácil</option>
              <option value="moderado">Moderado</option>
              <option value="dificil">Difícil</option>
            </Select>

            <Select
              id="question-status-filter"
              aria-label="Filtrar por status"
              value={statusFilter}
              onChange={(e) => {
                setStatusFilter(e.target.value as QuestionStatusFilter);
                setPage(1);
              }}
            >
              <option value="all">Todos os Status</option>
              <option value="active">Somente Ativas</option>
              <option value="disabled">Somente Desabilitadas</option>
            </Select>

            <Select
              aria-label="Ordenar questões por"
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as QuestionSortField)}
            >
              <option value="id">Ordenar por ID</option>
              <option value="text">Ordenar por Enunciado</option>
              <option value="difficulty">Ordenar por Dificuldade</option>
              <option value="status">Ordenar por Status</option>
            </Select>

            <Select
              aria-label="Direção da ordenação"
              value={sortDirection}
              onChange={(e) => setSortDirection(e.target.value as SortDirection)}
            >
              <option value="asc">Crescente</option>
              <option value="desc">Decrescente</option>
            </Select>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-3">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={
                  queryResult.items.length > 0 &&
                  queryResult.items.every((q) => selectedIds.includes(q.id))
                }
                onChange={toggleSelectAllPage}
                className="h-4 w-4 rounded border-input"
              />
              Selecionar Página ({selectedIds.length} selecionada(s))
            </label>
            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={selectedIds.length === 0}
                onClick={() => void handleBatchDisabled(false)}
              >
                Habilitar Selecionadas
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={selectedIds.length === 0}
                onClick={() => void handleBatchDisabled(true)}
              >
                Desabilitar Selecionadas
              </Button>
              <Button
                type="button"
                variant="destructive"
                size="sm"
                disabled={selectedIds.length === 0}
                onClick={() => void handleBatchDelete()}
              >
                Excluir Selecionadas
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {queryResult.items.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            Nenhuma questão encontrada com os filtros atuais.
          </CardContent>
        </Card>
      ) : (
        <>
          {/* Tabela para desktop (md+) */}
          <Card data-testid="questions-desktop-table" className="hidden md:block">
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-sm">
                  <thead>
                    <tr className="border-b border-border bg-muted/40 text-left text-xs font-medium text-muted-foreground uppercase">
                      <th className="w-10 px-4 py-3">Sel.</th>
                      <th className="px-4 py-3">Questão</th>
                      <th className="px-4 py-3">Dificuldade</th>
                      <th className="px-4 py-3">Status</th>
                      <th className="px-4 py-3 text-right">Ações</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {queryResult.items.map((q) => (
                      <tr
                        key={q.id}
                        className={cn(
                          'transition-colors hover:bg-muted/30',
                          q.isDisabled && 'opacity-65',
                        )}
                      >
                        <td className="px-4 py-3 align-top">
                          <input
                            type="checkbox"
                            aria-label={`Selecionar questão #${q.id}`}
                            checked={selectedIds.includes(q.id)}
                            onChange={() => toggleSelectId(q.id)}
                            className="mt-1 h-4 w-4 rounded border-input"
                          />
                        </td>
                        <td className="px-4 py-3">
                          <div className="font-medium text-foreground">
                            <span className="mr-1.5 text-muted-foreground">#{q.id}</span>
                            {q.text}
                          </div>
                          {renderQuestionTags(q.tags)}
                        </td>
                        <td className="px-4 py-3 align-top">{renderDifficultyPill(q.difficulty)}</td>
                        <td className="px-4 py-3 align-top">{renderStatusPill(q)}</td>
                        <td className="px-4 py-3 align-top">{renderQuestionActions(q)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>

          {/* Cards empilhados para mobile (< md) */}
          <div data-testid="questions-mobile-cards" className="space-y-3 md:hidden">
            {queryResult.items.map((q) => (
              <Card key={q.id} className={cn(q.isDisabled && 'opacity-70')}>
                <CardContent className="space-y-3 pt-4">
                  <div className="flex items-start justify-between gap-2">
                    <label className="flex items-center gap-2 text-xs font-semibold text-muted-foreground">
                      <input
                        type="checkbox"
                        aria-label={`Selecionar questão #${q.id}`}
                        checked={selectedIds.includes(q.id)}
                        onChange={() => toggleSelectId(q.id)}
                        className="h-4 w-4 rounded border-input"
                      />
                      #{q.id}
                    </label>
                    <div className="flex flex-wrap items-center gap-1.5">
                      {renderDifficultyPill(q.difficulty)}
                      {renderStatusPill(q)}
                    </div>
                  </div>
                  <p className="text-sm font-medium leading-snug">{q.text}</p>
                  {renderQuestionTags(q.tags)}
                  {renderQuestionActions(q, true)}
                </CardContent>
              </Card>
            ))}
          </div>
        </>
      )}

      {/* Paginação */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={queryResult.currentPage <= 1}
          onClick={() => setPage((prev) => Math.max(1, prev - 1))}
        >
          Anterior
        </Button>
        <span className="text-xs text-muted-foreground">
          Página {queryResult.currentPage} de {queryResult.totalPages} ({queryResult.totalItems}{' '}
          resultado(s))
        </span>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={queryResult.currentPage >= queryResult.totalPages}
          onClick={() => setPage((prev) => Math.min(queryResult.totalPages, prev + 1))}
        >
          Próxima
        </Button>
      </div>

      {/* Painel Editor de Questão */}
      {isEditorOpen && (
        <Card id="question-editor-panel" role="region" aria-label="Editor de Questão">
          <CardHeader className="flex flex-row items-center justify-between gap-2">
            <div>
              <CardTitle className="text-lg">
                {editorState.editingId !== null
                  ? `Editar Questão #${editorState.editingId}`
                  : 'Nova Questão'}
              </CardTitle>
              <CardDescription>
                Preencha enunciado, 4 alternativas, resposta correta e tags de classificação.
              </CardDescription>
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => onRequestGuardedAction(() => setIsEditorOpen(false))}
            >
              Fechar Editor
            </Button>
          </CardHeader>

          <CardContent>
            <form
              className="space-y-4"
              onSubmit={(e) => {
                e.preventDefault();
                void handleSaveEditor().catch(() => undefined);
              }}
            >
              <div className="space-y-1.5">
                <Label htmlFor="question-text-input">Enunciado da Questão</Label>
                <textarea
                  id="question-text-input"
                  rows={3}
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  value={editorState.text}
                  onChange={(e) => {
                    navigationGuard.markDirty('question');
                    setEditorState((prev) => ({ ...prev, text: e.target.value }));
                  }}
                  required
                />
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                {[0, 1, 2, 3].map((optIdx) => (
                  <div key={optIdx} className="space-y-1.5">
                    <Label htmlFor={`question-option-${optIdx}`}>
                      Alternativa {String.fromCharCode(65 + optIdx)}
                    </Label>
                    <Input
                      id={`question-option-${optIdx}`}
                      type="text"
                      value={editorState.options[optIdx]}
                      onChange={(e) => {
                        navigationGuard.markDirty('question');
                        const nextOpts: [string, string, string, string] = [
                          ...editorState.options,
                        ];
                        nextOpts[optIdx] = e.target.value;
                        setEditorState((prev) => ({ ...prev, options: nextOpts }));
                      }}
                      required
                    />
                  </div>
                ))}
              </div>

              <div className="grid gap-3 sm:grid-cols-3">
                <div className="space-y-1.5">
                  <Label htmlFor="question-correct-select">Alternativa Correta</Label>
                  <Select
                    id="question-correct-select"
                    value={editorState.correctIndex}
                    onChange={(e) => {
                      navigationGuard.markDirty('question');
                      setEditorState((prev) => ({
                        ...prev,
                        correctIndex: Number(e.target.value),
                      }));
                    }}
                  >
                    <option value={0}>Alternativa A</option>
                    <option value={1}>Alternativa B</option>
                    <option value={2}>Alternativa C</option>
                    <option value={3}>Alternativa D</option>
                  </Select>
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="question-difficulty-select">Dificuldade</Label>
                  <Select
                    id="question-difficulty-select"
                    value={editorState.difficulty}
                    onChange={(e) => {
                      navigationGuard.markDirty('question');
                      setEditorState((prev) => ({
                        ...prev,
                        difficulty: e.target.value as DifficultyLevel,
                      }));
                    }}
                  >
                    <option value="facil">Fácil</option>
                    <option value="moderado">Moderado</option>
                    <option value="dificil">Difícil</option>
                  </Select>
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="question-tags-input">Tags (separadas por vírgula)</Label>
                  <Input
                    id="question-tags-input"
                    type="text"
                    value={editorState.tagsInput}
                    onChange={(e) => {
                      navigationGuard.markDirty('question');
                      setEditorState((prev) => ({ ...prev, tagsInput: e.target.value }));
                    }}
                  />
                </div>
              </div>

              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={editorState.isDisabled}
                  onChange={(e) => {
                    navigationGuard.markDirty('question');
                    setEditorState((prev) => ({ ...prev, isDisabled: e.target.checked }));
                  }}
                  className="h-4 w-4 rounded border-input"
                />
                Desabilitada (não sorteada no Quiz)
              </label>

              <div className="flex justify-end">
                <Button id="save-question-btn" type="submit">
                  Salvar Questão
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      {/* Modal de Pré-visualização no formato do Totem */}
      <Dialog
        open={Boolean(previewData)}
        onOpenChange={(open) => {
          if (!open) {
            setPreviewData(null);
          }
        }}
      >
        <DialogContent id="question-preview-modal" aria-label="Pré-visualização da Questão no Quiz">
          <DialogHeader>
            <div className="flex items-center justify-between gap-2 pr-6">
              <DialogTitle>Pré-visualização no Quiz</DialogTitle>
              {previewData && renderDifficultyPill(previewData.difficulty)}
            </div>
            <DialogDescription>
              Simulação da apresentação da questão e alternativas embarcadas no Totem.
            </DialogDescription>
          </DialogHeader>
          {previewData && (
            <div className="space-y-3">
              <p className="text-base font-medium leading-snug">{previewData.text}</p>
              <div className="space-y-2">
                {previewData.shuffledOptions.map((opt, idx) => (
                  <div
                    key={`${previewData.id}-${idx}`}
                    className={cn(
                      'flex items-center justify-between rounded-md border px-3 py-2 text-sm',
                      opt.isCorrect
                        ? 'border-emerald-500/60 bg-emerald-500/10 text-emerald-800 dark:text-emerald-200'
                        : 'border-border bg-background',
                    )}
                  >
                    <span>{opt.text}</span>
                    {opt.isCorrect && <strong className="text-xs uppercase">Correta</strong>}
                  </div>
                ))}
              </div>
            </div>
          )}
          <DialogFooter>
            <Button type="button" onClick={() => setPreviewData(null)}>
              Fechar Pré-visualização
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={isWorkbookOpen} onOpenChange={(open) => {
        if (!workbookBusy) setIsWorkbookOpen(open);
      }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Importar planilha de questões</DialogTitle>
            <DialogDescription>
              Envie a planilha baixada do banco. Preserve a aba Questões, o cabeçalho e os IDs.
              A importação atualiza questões existentes.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="workbook-file">Arquivo Excel (.xlsx)</Label>
            <Input id="workbook-file" type="file" accept=".xlsx" disabled={workbookBusy}
              onChange={(event) => {
                setWorkbookFile(event.target.files?.[0] ?? null);
                setWorkbookReview(null);
                setWorkbookError('');
              }}
            />
            {workbookError && (
              <p role="alert" className="whitespace-pre-line text-sm text-destructive">{workbookError}</p>
            )}
            {workbookReview && (
              <div className="space-y-2" aria-live="polite">
                <p>{workbookReview.changes.length
                  ? `${workbookReview.changes.length} questão(ões) a atualizar.`
                  : 'A planilha não contém alterações.'}</p>
                {workbookReview.changes.length > 0 && (
                  <ul className="max-h-48 list-disc overflow-y-auto pl-5 text-sm">
                    {workbookReview.changes.map(({ id, text }) => <li key={id}>#{id} {text}</li>)}
                  </ul>
                )}
              </div>
            )}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" disabled={workbookBusy}
              onClick={() => setIsWorkbookOpen(false)}>Fechar</Button>
            <Button type="button" onClick={() => void handleWorkbookSubmit()}
              disabled={workbookBusy || !workbookFile || workbookReview?.changes.length === 0}>
              {workbookBusy ? 'Processando…' : workbookReview ? 'Confirmar alterações' : 'Revisar planilha'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Modal de Importação JSON / CSV */}
      <Dialog open={isImportOpen} onOpenChange={setIsImportOpen}>
        <DialogContent id="import-questions-modal" aria-label="Importar Questões">
          <DialogHeader>
            <DialogTitle>Importar Banco de Questões</DialogTitle>
            <DialogDescription>
              Carregue um arquivo .json ou .csv ou cole o conteúdo diretamente abaixo.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="import-format-select">Formato do Arquivo</Label>
                <Select
                  id="import-format-select"
                  value={importFormat}
                  onChange={(e) => setImportFormat(e.target.value as 'json' | 'csv')}
                >
                  <option value="json">JSON</option>
                  <option value="csv">CSV</option>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="import-mode-select">Modo de Importação</Label>
                <Select
                  id="import-mode-select"
                  value={importMode}
                  onChange={(e) => setImportMode(e.target.value as QuestionsImportMode)}
                >
                  <option value="merge">Adicionar / Mesclar ao acervo atual</option>
                  <option value="replace">Substituir todo o Banco de Questões</option>
                </Select>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="import-file-input">Carregar arquivo (.json ou .csv)</Label>
              <Input
                id="import-file-input"
                type="file"
                accept=".json,.csv,application/json,text/csv"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (!file) {
                    return;
                  }
                  if (file.name.toLowerCase().endsWith('.csv')) {
                    setImportFormat('csv');
                  } else if (file.name.toLowerCase().endsWith('.json')) {
                    setImportFormat('json');
                  }
                  void file.text().then((text) => setImportContent(text));
                }}
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="import-content-textarea">Conteúdo JSON ou CSV</Label>
              <textarea
                id="import-content-textarea"
                rows={6}
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-xs font-mono text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                value={importContent}
                onChange={(e) => setImportContent(e.target.value)}
                placeholder="Cole aqui o conteúdo JSON ou CSV..."
              />
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setIsImportOpen(false)}>
              Cancelar
            </Button>
            <Button
              id="confirm-import-questions-btn"
              type="button"
              onClick={() => void handleImportSubmit()}
            >
              Executar Importação
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
