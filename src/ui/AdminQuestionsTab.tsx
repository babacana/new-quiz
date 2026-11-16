import { useCallback, useEffect, useState } from 'react';
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
import { DIFFICULTY_LABELS, triggerFileDownload } from './formatters';

export interface AdminQuestionsTabProps {
  controller: EventAdminController;
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

// Aba administrativa do Banco de Questões Central (CRUD, filtros, lote, preview e JSON/CSV).
export function AdminQuestionsTab({
  controller,
  onRequestGuardedAction,
  onQuestionsChanged,
  onRegisterSaveHandler,
  onStatusMessage,
}: AdminQuestionsTabProps) {
  const [search, setSearch] = useState('');
  const [difficultyFilter, setDifficultyFilter] = useState<'all' | DifficultyLevel>('all');
  const [statusFilter, setStatusFilter] = useState<QuestionStatusFilter>('all');
  const [sortBy, setSortBy] = useState<QuestionSortField>('id');
  const [sortDirection, setSortDirection] = useState<SortDirection>('asc');
  const [page, setPage] = useState(1);
  const [pageSize] = useState(10);

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

  const refreshList = useCallback(async () => {
    try {
      const result = await controller.queryQuestions({
        search,
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
    search,
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
  }, [controller, editorState, onQuestionsChanged, onStatusMessage, refreshList]);

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

  const handleExport = async (format: 'json' | 'csv') => {
    try {
      const content =
        format === 'json'
          ? await controller.exportQuestionsJson()
          : await controller.exportQuestionsCsv();
      triggerFileDownload(
        `banco-questoes.${format}`,
        content,
        format === 'json' ? 'application/json' : 'text/csv;charset=utf-8;',
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
        controller.clearDirty('question');
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

  return (
    <div id="admin-questions-tab" className="admin-tab-layout">
      <div className="admin-panel-card">
        <div className="admin-section-header">
          <div>
            <h3>Banco de Questões Central</h3>
            <small>
              Total: {queryResult.counts.total} · Ativas: {queryResult.counts.active} ·
              Desabilitadas: {queryResult.counts.disabled}
            </small>
          </div>
          <div className="admin-row-actions">
            <button
              id="new-question-btn"
              type="button"
              className="admin-btn admin-btn-primary"
              onClick={() =>
                onRequestGuardedAction(() => {
                  setEditorState(buildEmptyQuestionEditor());
                  setIsEditorOpen(true);
                })
              }
            >
              + Nova Questão
            </button>
            <button
              type="button"
              className="admin-btn admin-btn-secondary"
              onClick={() => void handleExport('json')}
            >
              Exportar JSON
            </button>
            <button
              type="button"
              className="admin-btn admin-btn-secondary"
              onClick={() => void handleExport('csv')}
            >
              Exportar CSV
            </button>
            <button
              id="open-import-questions-btn"
              type="button"
              className="admin-btn admin-btn-secondary"
              onClick={() => setIsImportOpen(true)}
            >
              Importar JSON / CSV
            </button>
          </div>
        </div>

        <div className="admin-filters-bar">
          <input
            id="question-search-input"
            type="text"
            placeholder="Buscar por enunciado, tag ou ID..."
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
          />

          <select
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
          </select>

          <select
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
          </select>

          <select
            aria-label="Ordenar questões por"
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as QuestionSortField)}
          >
            <option value="id">Ordenar por ID</option>
            <option value="text">Ordenar por Enunciado</option>
            <option value="difficulty">Ordenar por Dificuldade</option>
            <option value="status">Ordenar por Status</option>
          </select>

          <select
            aria-label="Direção da ordenação"
            value={sortDirection}
            onChange={(e) => setSortDirection(e.target.value as SortDirection)}
          >
            <option value="asc">Crescente</option>
            <option value="desc">Decrescente</option>
          </select>
        </div>

        <div className="admin-batch-bar">
          <label className="admin-select-all-label">
            <input
              type="checkbox"
              checked={
                queryResult.items.length > 0 &&
                queryResult.items.every((q) => selectedIds.includes(q.id))
              }
              onChange={toggleSelectAllPage}
            />
            Selecionar Página ({selectedIds.length} selecionada(s))
          </label>
          <div className="admin-row-actions">
            <button
              type="button"
              className="admin-btn admin-btn-secondary"
              disabled={selectedIds.length === 0}
              onClick={() => void handleBatchDisabled(false)}
            >
              Habilitar Selecionadas
            </button>
            <button
              type="button"
              className="admin-btn admin-btn-secondary"
              disabled={selectedIds.length === 0}
              onClick={() => void handleBatchDisabled(true)}
            >
              Desabilitar Selecionadas
            </button>
            <button
              type="button"
              className="admin-btn admin-btn-danger"
              disabled={selectedIds.length === 0}
              onClick={() => void handleBatchDelete()}
            >
              Excluir Selecionadas
            </button>
          </div>
        </div>

        <div className="admin-questions-list">
          {queryResult.items.length === 0 ? (
            <p className="admin-empty-text">Nenhuma questão encontrada com os filtros atuais.</p>
          ) : (
            queryResult.items.map((q) => (
              <div
                key={q.id}
                className={`admin-question-row ${q.isDisabled ? 'disabled-row' : ''}`}
              >
                <div className="admin-question-main">
                  <input
                    type="checkbox"
                    aria-label={`Selecionar questão #${q.id}`}
                    checked={selectedIds.includes(q.id)}
                    onChange={() => toggleSelectId(q.id)}
                  />
                  <div>
                    <div className="admin-question-badges">
                      <strong>#{q.id}</strong>
                      <span className="admin-badge">{DIFFICULTY_LABELS[q.difficulty]}</span>
                      <span className={`admin-badge ${q.isDisabled ? 'closed' : 'active'}`}>
                        {q.isDisabled ? 'Desabilitada' : 'Ativa'}
                      </span>
                      {q.tags.map((tag) => (
                        <span key={tag} className="admin-tag-chip">
                          #{tag}
                        </span>
                      ))}
                    </div>
                    <p className="admin-question-text">{q.text}</p>
                  </div>
                </div>
                <div className="admin-row-actions">
                  <button
                    type="button"
                    className="admin-btn admin-btn-secondary"
                    onClick={() => setPreviewData(controller.previewQuestion(q))}
                  >
                    Pré-visualizar
                  </button>
                  <button
                    type="button"
                    className="admin-btn admin-btn-secondary"
                    onClick={() => onRequestGuardedAction(() => openEditQuestion(q))}
                  >
                    Editar
                  </button>
                  <button
                    type="button"
                    className="admin-btn admin-btn-secondary"
                    onClick={() => {
                      void controller
                        .setQuestionsDisabled([q.id], !q.isDisabled)
                        .then(async () => {
                          await refreshList();
                          await onQuestionsChanged();
                        });
                    }}
                  >
                    {q.isDisabled ? 'Habilitar' : 'Desabilitar'}
                  </button>
                  <button
                    type="button"
                    className="admin-btn admin-btn-danger"
                    aria-label={`Excluir questão #${q.id}`}
                    onClick={() => void handleDeleteSingle(q.id)}
                  >
                    Excluir
                  </button>
                </div>
              </div>
            ))
          )}
        </div>

        <div className="admin-pagination">
          <button
            type="button"
            className="admin-btn admin-btn-secondary"
            disabled={queryResult.currentPage <= 1}
            onClick={() => setPage((prev) => Math.max(1, prev - 1))}
          >
            Anterior
          </button>
          <span>
            Página {queryResult.currentPage} de {queryResult.totalPages} ({queryResult.totalItems}{' '}
            resultado(s))
          </span>
          <button
            type="button"
            className="admin-btn admin-btn-secondary"
            disabled={queryResult.currentPage >= queryResult.totalPages}
            onClick={() => setPage((prev) => Math.min(queryResult.totalPages, prev + 1))}
          >
            Próxima
          </button>
        </div>
      </div>

      {isEditorOpen && (
        <div
          id="question-editor-panel"
          className="admin-panel-card"
          role="region"
          aria-label="Editor de Questão"
        >
          <div className="admin-section-header">
            <h3>
              {editorState.editingId !== null
                ? `Editar Questão #${editorState.editingId}`
                : 'Nova Questão'}
            </h3>
            <button
              type="button"
              className="admin-btn admin-btn-secondary"
              onClick={() => onRequestGuardedAction(() => setIsEditorOpen(false))}
            >
              Fechar Editor
            </button>
          </div>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              void handleSaveEditor().catch(() => undefined);
            }}
          >
            <div className="admin-field">
              <label htmlFor="question-text-input">Enunciado da Questão</label>
              <textarea
                id="question-text-input"
                rows={3}
                value={editorState.text}
                onChange={(e) => {
                  controller.markDirty('question');
                  setEditorState((prev) => ({ ...prev, text: e.target.value }));
                }}
                required
              />
            </div>

            <div className="admin-form-grid">
              {[0, 1, 2, 3].map((optIdx) => (
                <div key={optIdx} className="admin-field">
                  <label htmlFor={`question-option-${optIdx}`}>
                    Alternativa {String.fromCharCode(65 + optIdx)}
                  </label>
                  <input
                    id={`question-option-${optIdx}`}
                    type="text"
                    value={editorState.options[optIdx]}
                    onChange={(e) => {
                      controller.markDirty('question');
                      const nextOpts: [string, string, string, string] = [...editorState.options];
                      nextOpts[optIdx] = e.target.value;
                      setEditorState((prev) => ({ ...prev, options: nextOpts }));
                    }}
                    required
                  />
                </div>
              ))}
            </div>

            <div className="admin-form-grid">
              <div className="admin-field">
                <label htmlFor="question-correct-select">Alternativa Correta</label>
                <select
                  id="question-correct-select"
                  value={editorState.correctIndex}
                  onChange={(e) => {
                    controller.markDirty('question');
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
                </select>
              </div>

              <div className="admin-field">
                <label htmlFor="question-difficulty-select">Dificuldade</label>
                <select
                  id="question-difficulty-select"
                  value={editorState.difficulty}
                  onChange={(e) => {
                    controller.markDirty('question');
                    setEditorState((prev) => ({
                      ...prev,
                      difficulty: e.target.value as DifficultyLevel,
                    }));
                  }}
                >
                  <option value="facil">Fácil</option>
                  <option value="moderado">Moderado</option>
                  <option value="dificil">Difícil</option>
                </select>
              </div>

              <div className="admin-field">
                <label htmlFor="question-tags-input">Tags (separadas por vírgula)</label>
                <input
                  id="question-tags-input"
                  type="text"
                  value={editorState.tagsInput}
                  onChange={(e) => {
                    controller.markDirty('question');
                    setEditorState((prev) => ({ ...prev, tagsInput: e.target.value }));
                  }}
                />
              </div>
            </div>

            <div className="admin-checkbox-row">
              <label>
                <input
                  type="checkbox"
                  checked={editorState.isDisabled}
                  onChange={(e) => {
                    controller.markDirty('question');
                    setEditorState((prev) => ({ ...prev, isDisabled: e.target.checked }));
                  }}
                />
                Desabilitada (não sorteada no Quiz)
              </label>
            </div>

            <div className="admin-form-footer">
              <button
                id="save-question-btn"
                type="submit"
                className="admin-btn admin-btn-primary"
              >
                Salvar Questão
              </button>
            </div>
          </form>
        </div>
      )}

      {previewData && (
        <div
          id="question-preview-modal"
          className="modal-overlay"
          role="dialog"
          aria-modal="true"
          aria-label="Pré-visualização da Questão no Quiz"
        >
          <div className="modal-content admin-modal">
            <div className="admin-section-header">
              <h3 className="modal-title">Pré-visualização no Quiz</h3>
              <span className="admin-badge">{DIFFICULTY_LABELS[previewData.difficulty]}</span>
            </div>
            <p className="admin-preview-question-text">{previewData.text}</p>
            <div className="admin-preview-options">
              {previewData.shuffledOptions.map((opt, idx) => (
                <div
                  key={`${previewData.id}-${idx}`}
                  className={`admin-preview-option ${opt.isCorrect ? 'is-correct' : ''}`}
                >
                  <span>{opt.text}</span>
                  {opt.isCorrect && <strong>Correta</strong>}
                </div>
              ))}
            </div>
            <div className="modal-actions">
              <button
                type="button"
                className="admin-btn admin-btn-primary"
                onClick={() => setPreviewData(null)}
              >
                Fechar Pré-visualização
              </button>
            </div>
          </div>
        </div>
      )}

      {isImportOpen && (
        <div
          id="import-questions-modal"
          className="modal-overlay"
          role="dialog"
          aria-modal="true"
          aria-label="Importar Questões"
        >
          <div className="modal-content admin-modal">
            <h3 className="modal-title">Importar Banco de Questões</h3>
            <div className="admin-form-grid">
              <div className="admin-field">
                <label htmlFor="import-format-select">Formato do Arquivo</label>
                <select
                  id="import-format-select"
                  value={importFormat}
                  onChange={(e) => setImportFormat(e.target.value as 'json' | 'csv')}
                >
                  <option value="json">JSON</option>
                  <option value="csv">CSV</option>
                </select>
              </div>
              <div className="admin-field">
                <label htmlFor="import-mode-select">Modo de Importação</label>
                <select
                  id="import-mode-select"
                  value={importMode}
                  onChange={(e) => setImportMode(e.target.value as QuestionsImportMode)}
                >
                  <option value="merge">Adicionar / Mesclar ao acervo atual</option>
                  <option value="replace">Substituir todo o Banco de Questões</option>
                </select>
              </div>
            </div>
            <div className="admin-field">
              <label htmlFor="import-file-input">Carregar arquivo (.json ou .csv)</label>
              <input
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
            <div className="admin-field">
              <label htmlFor="import-content-textarea">Conteúdo JSON ou CSV</label>
              <textarea
                id="import-content-textarea"
                rows={6}
                value={importContent}
                onChange={(e) => setImportContent(e.target.value)}
                placeholder="Cole aqui o conteúdo JSON ou CSV..."
              />
            </div>
            <div className="modal-actions">
              <button
                id="confirm-import-questions-btn"
                type="button"
                className="admin-btn admin-btn-primary"
                onClick={() => void handleImportSubmit()}
              >
                Executar Importação
              </button>
              <button
                type="button"
                className="admin-btn admin-btn-secondary"
                onClick={() => setIsImportOpen(false)}
              >
                Cancelar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
