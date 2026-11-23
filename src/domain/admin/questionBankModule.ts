import { paginateItems } from '../operationalRules';
import type {
  DifficultyLevel,
  PaginatedQuestionsResult,
  PreparedOption,
  PreparedQuestion,
  Question,
  QuestionFilterOptions,
  QuestionUpsertInput,
  QuestionsImportMode,
  QuestionsImportResult,
} from '../types';
import { type AdminDomainContext, escapeCsvField } from './adminContext';
import type { EventCatalogModule } from './eventCatalogModule';
import { readQuestionWorkbook, writeQuestionWorkbook } from './questionWorkbook';

const VALID_DIFFICULTIES: readonly DifficultyLevel[] = ['facil', 'moderado', 'dificil'];

export function validateQuestionInput(input: QuestionUpsertInput): void {
  if (!input.text.trim()) {
    throw new Error('O enunciado da questão é obrigatório.');
  }

  if (!Array.isArray(input.options) || input.options.length !== 4) {
    throw new Error('A questão deve possuir exatamente 4 alternativas.');
  }

  if (input.options.some((option) => !String(option ?? '').trim())) {
    throw new Error('Todas as 4 alternativas da questão devem estar preenchidas.');
  }

  if (!Number.isInteger(input.correctIndex) || input.correctIndex < 0 || input.correctIndex > 3) {
    throw new Error('O índice da alternativa correta deve estar entre 0 e 3.');
  }

  if (!VALID_DIFFICULTIES.includes(input.difficulty)) {
    throw new Error('Dificuldade inválida. Use facil, moderado ou dificil.');
  }
}

export function normalizeTags(tags?: string[]): string[] {
  if (!Array.isArray(tags)) {
    return [];
  }
  const seen = new Set<string>();
  const normalized: string[] = [];
  for (const tag of tags) {
    const clean = tag.trim().toLowerCase();
    if (clean && !seen.has(clean)) {
      seen.add(clean);
      normalized.push(clean);
    }
  }
  return normalized;
}

function normalizeQuestionOptions(
  options: [string, string, string, string],
): [string, string, string, string] {
  return [
    options[0].trim(),
    options[1].trim(),
    options[2].trim(),
    options[3].trim(),
  ];
}

function buildQuestionEntity(id: number, input: QuestionUpsertInput): Question {
  return {
    id,
    text: input.text,
    options: input.options,
    correctIndex: input.correctIndex,
    difficulty: input.difficulty,
    tags: input.tags ?? [],
    isDisabled: input.isDisabled ?? false,
  };
}

function parseCsvRows(csvContent: string): string[][] {
  const rows: string[][] = [];
  let currentRow: string[] = [];
  let currentField = '';
  let insideQuotes = false;

  const content = csvContent.replace(/^\uFEFF/, '');
  for (let i = 0; i < content.length; i += 1) {
    const char = content[i];
    const nextChar = content[i + 1];

    if (insideQuotes) {
      if (char === '"' && nextChar === '"') {
        currentField += '"';
        i += 1;
      } else if (char === '"') {
        insideQuotes = false;
      } else {
        currentField += char;
      }
      continue;
    }

    if (char === '"') {
      insideQuotes = true;
    } else if (char === ',') {
      currentRow.push(currentField);
      currentField = '';
    } else if (char === '\r' && nextChar === '\n') {
      currentRow.push(currentField);
      rows.push(currentRow);
      currentRow = [];
      currentField = '';
      i += 1;
    } else if (char === '\n' || char === '\r') {
      currentRow.push(currentField);
      rows.push(currentRow);
      currentRow = [];
      currentField = '';
    } else {
      currentField += char;
    }
  }

  if (insideQuotes) {
    throw new Error('Arquivo CSV malformado: aspas não fechadas.');
  }

  if (currentField.length > 0 || currentRow.length > 0) {
    currentRow.push(currentField);
    rows.push(currentRow);
  }

  return rows.filter((row) => row.some((cell) => cell.trim() !== ''));
}

function normalizeImportedQuestion(raw: Record<string, unknown>): QuestionUpsertInput {
  const text = typeof raw.text === 'string' ? raw.text.trim() : '';
  const rawOptions = Array.isArray(raw.options) ? raw.options : [];
  if (rawOptions.length !== 4) {
    throw new Error(`Questão "${text || 'sem texto'}" não possui exatamente 4 alternativas.`);
  }
  const options: [string, string, string, string] = [
    String(rawOptions[0] ?? '').trim(),
    String(rawOptions[1] ?? '').trim(),
    String(rawOptions[2] ?? '').trim(),
    String(rawOptions[3] ?? '').trim(),
  ];

  // Suporta tanto o campo atual `correctIndex` quanto o legado `correct`, rejeitando valor vazio.
  const rawCorrect = raw.correctIndex !== undefined ? raw.correctIndex : raw.correct;
  const correctIndex =
    rawCorrect === undefined || rawCorrect === null || String(rawCorrect).trim() === ''
      ? Number.NaN
      : Number(rawCorrect);

  // Normaliza acentos ("Fácil" -> "facil", "Difícil" -> "dificil") mantendo valores inválidos para validação.
  const rawDifficulty =
    raw.difficulty === undefined || raw.difficulty === null || String(raw.difficulty).trim() === ''
      ? 'moderado'
      : String(raw.difficulty)
          .normalize('NFD')
          .replace(/[\u0300-\u036f]/g, '')
          .trim()
          .toLowerCase();

  let tags: string[] = [];
  if (Array.isArray(raw.tags)) {
    tags = normalizeTags(raw.tags.map((item) => String(item)));
  } else if (typeof raw.tags === 'string') {
    tags = normalizeTags(raw.tags.split(/[;|]/));
  }

  const isDisabled =
    raw.isDisabled === true || String(raw.isDisabled ?? '').trim().toLowerCase() === 'true';

  const parsed: QuestionUpsertInput = {
    text,
    options,
    correctIndex,
    difficulty: rawDifficulty as DifficultyLevel,
    tags,
    isDisabled,
  };

  validateQuestionInput(parsed);
  return parsed;
}

// Módulo de domínio responsável pelo Banco de Questões Central, consulta paginada e importação/exportação.
export class QuestionBankModule {
  private readonly ctx: AdminDomainContext;
  private readonly catalog: EventCatalogModule;

  constructor(ctx: AdminDomainContext, catalog: EventCatalogModule) {
    this.ctx = ctx;
    this.catalog = catalog;
  }

  async createQuestion(input: QuestionUpsertInput): Promise<Question> {
    this.ctx.auth.requireAdmin();

    const normalized: QuestionUpsertInput = {
      ...input,
      text: input.text.trim(),
      options: normalizeQuestionOptions(input.options),
      tags: normalizeTags(input.tags),
      isDisabled: input.isDisabled ?? false,
    };
    validateQuestionInput(normalized);

    const existing = await this.ctx.cloudGateway.listAllQuestions();
    const maxId = existing.reduce((acc, q) => Math.max(acc, q.id), 0);
    const nextId = input.id ?? maxId + 1;

    const saved = await this.ctx.cloudGateway.saveQuestion(buildQuestionEntity(nextId, normalized));
    await this.catalog.notifyActiveEventsQuestionsChanged([saved.id]);
    return saved;
  }

  async updateQuestion(id: number, input: QuestionUpsertInput): Promise<Question> {
    this.ctx.auth.requireAdmin();

    const existingList = await this.ctx.cloudGateway.listAllQuestions();
    const current = existingList.find((q) => q.id === id);
    if (!current) {
      throw new Error(`Questão #${id} não encontrada no Banco de Questões.`);
    }

    const normalized: QuestionUpsertInput = {
      ...input,
      id,
      text: input.text.trim(),
      options: normalizeQuestionOptions(input.options),
      tags: input.tags !== undefined ? normalizeTags(input.tags) : current.tags,
      isDisabled: input.isDisabled ?? current.isDisabled,
    };
    validateQuestionInput(normalized);

    const saved = await this.ctx.cloudGateway.saveQuestion(buildQuestionEntity(id, normalized));
    await this.catalog.notifyActiveEventsQuestionsChanged([saved.id]);
    return saved;
  }

  async deleteQuestions(ids: number[]): Promise<number> {
    this.ctx.auth.requireAdmin();
    const count = await this.ctx.cloudGateway.deleteQuestions(ids);
    if (count > 0) {
      await this.catalog.notifyActiveEventsQuestionsChanged(ids);
    }
    return count;
  }

  async setQuestionsDisabled(ids: number[], isDisabled: boolean): Promise<number> {
    this.ctx.auth.requireAdmin();
    const count = await this.ctx.cloudGateway.setQuestionsDisabled(ids, isDisabled);
    if (count > 0) {
      await this.catalog.notifyActiveEventsQuestionsChanged(ids);
    }
    return count;
  }

  async listAllQuestions(eventId?: string): Promise<Question[]> {
    this.ctx.auth.requireAdmin();
    const questions = await this.ctx.cloudGateway.listAllQuestions();
    if (!eventId) {
      return questions;
    }
    const linkedIds = await this.ctx.cloudGateway.getEventQuestionIds(eventId);
    if (linkedIds.length === 0) {
      return questions;
    }
    const linkedSet = new Set(linkedIds);
    return questions.filter((q) => linkedSet.has(q.id));
  }

  async queryQuestions(filter: QuestionFilterOptions = {}): Promise<PaginatedQuestionsResult> {
    this.ctx.auth.requireAdmin();

    const questions = await this.listAllQuestions(filter.eventId);

    const counts = {
      total: questions.length,
      active: questions.filter((q) => !q.isDisabled).length,
      disabled: questions.filter((q) => q.isDisabled).length,
      byDifficulty: {
        facil: questions.filter((q) => q.difficulty === 'facil').length,
        moderado: questions.filter((q) => q.difficulty === 'moderado').length,
        dificil: questions.filter((q) => q.difficulty === 'dificil').length,
      },
    };

    const searchTerm = filter.search?.trim().toLowerCase() ?? '';
    const difficultiesSet =
      filter.difficulties && filter.difficulties.length > 0 ? new Set(filter.difficulties) : null;
    const requiredTags = normalizeTags(filter.tags);
    const status = filter.status ?? 'all';

    const filtered = questions.filter((question) => {
      if (status === 'active' && question.isDisabled) {
        return false;
      }
      if (status === 'disabled' && !question.isDisabled) {
        return false;
      }
      if (difficultiesSet && !difficultiesSet.has(question.difficulty)) {
        return false;
      }
      if (
        requiredTags.length > 0 &&
        !requiredTags.every((tag) => question.tags.map((t) => t.toLowerCase()).includes(tag))
      ) {
        return false;
      }
      if (searchTerm) {
        const matchesId = String(question.id) === searchTerm;
        const matchesText = question.text.toLowerCase().includes(searchTerm);
        const matchesOption = question.options.some((opt) =>
          opt.toLowerCase().includes(searchTerm),
        );
        const matchesTag = question.tags.some((t) => t.toLowerCase().includes(searchTerm));
        if (!matchesId && !matchesText && !matchesOption && !matchesTag) {
          return false;
        }
      }
      return true;
    });

    const sortBy = filter.sortBy ?? 'id';
    const sortDir = filter.sortDirection === 'desc' ? -1 : 1;
    const difficultyRank: Record<DifficultyLevel, number> = {
      facil: 1,
      moderado: 2,
      dificil: 3,
    };

    const sorted = [...filtered].sort((a, b) => {
      let comparison = 0;
      if (sortBy === 'id') {
        comparison = a.id - b.id;
      } else if (sortBy === 'text') {
        comparison = a.text.localeCompare(b.text, 'pt-BR');
      } else if (sortBy === 'difficulty') {
        comparison = difficultyRank[a.difficulty] - difficultyRank[b.difficulty];
      } else {
        comparison = Number(a.isDisabled) - Number(b.isDisabled);
      }
      return comparison !== 0 ? comparison * sortDir : a.id - b.id;
    });

    const page = paginateItems(sorted, filter.page ?? 1, filter.pageSize ?? 20);
    return {
      items: page.items,
      totalItems: page.totalItems,
      totalPages: page.totalPages,
      currentPage: page.currentPage,
      pageSize: page.pageSize,
      counts,
    };
  }

  previewQuestion(question: Question | QuestionUpsertInput): PreparedQuestion {
    validateQuestionInput(question);
    const trimmedOptions = normalizeQuestionOptions(question.options);
    const preparedOptions: PreparedOption[] = trimmedOptions.map((text, idx) => ({
      text,
      isCorrect: idx === question.correctIndex,
      originalIndex: idx,
    }));

    return {
      id: 'id' in question && typeof question.id === 'number' ? question.id : 0,
      text: question.text.trim(),
      difficulty: question.difficulty,
      originalOptions: trimmedOptions,
      originalCorrectIndex: question.correctIndex,
      shuffledOptions: this.ctx.random.shuffle(preparedOptions),
    };
  }

  async exportQuestionsJson(eventId?: string): Promise<string> {
    const items = await this.listAllQuestions(eventId);
    return JSON.stringify(items, null, 2);
  }

  async exportQuestionsCsv(eventId?: string): Promise<string> {
    const items = await this.listAllQuestions(eventId);

    const header =
      'id,text,optionA,optionB,optionC,optionD,correctIndex,difficulty,tags,isDisabled';
    const lines = items.map((q) =>
      [
        escapeCsvField(q.id),
        escapeCsvField(q.text),
        escapeCsvField(q.options[0]),
        escapeCsvField(q.options[1]),
        escapeCsvField(q.options[2]),
        escapeCsvField(q.options[3]),
        escapeCsvField(q.correctIndex),
        escapeCsvField(q.difficulty),
        escapeCsvField(q.tags.join(';')),
        escapeCsvField(q.isDisabled),
      ].join(','),
    );

    // The UTF-8 BOM lets Excel recognize the encoding when opening the file directly.
    return '\uFEFF' + [header, ...lines].join('\n');
  }

  async exportQuestionsXlsx(): Promise<ArrayBuffer> {
    return writeQuestionWorkbook(await this.listAllQuestions());
  }

  async previewQuestionsXlsx(
    file: ArrayBuffer,
  ): Promise<Array<{ id: number; text: string; isNew: boolean }>> {
    const changes = await this.getWorkbookChanges(file);
    return changes.map(({ question, isNew }) => ({ id: question.id, text: question.text, isNew }));
  }

  async importQuestionsXlsx(
    file: ArrayBuffer,
    reviewed?: Array<{ id: number; text: string; isNew?: boolean }>,
  ): Promise<number> {
    const changes = await this.getWorkbookChanges(file);
    const summary = (items: Array<{ id: number; text: string; isNew?: boolean }>) =>
      JSON.stringify(items.map(({ id, text, isNew }) => ({ id, text, isNew: Boolean(isNew) })));
    if (reviewed && summary(reviewed) !== summary(changes.map(({ question, isNew }) => ({ ...question, isNew })))) {
      throw new Error('O banco mudou desde a revisão. Revise a planilha novamente.');
    }

    for (const { question, isNew } of changes) {
      if (isNew) await this.createQuestion(question);
      else await this.updateQuestion(question.id, question);
    }
    return changes.length;
  }

  /**
   * Lê a planilha. Linhas com ID existente atualizam a questão; linhas com ID vazio ou ainda
   * inexistente criam uma questão nova (ID vazio recebe o próximo número livre).
   */
  private async getWorkbookChanges(
    file: ArrayBuffer,
  ): Promise<Array<{ question: Question; isNew: boolean }>> {
    const existing = new Map((await this.listAllQuestions()).map((question) => [question.id, question]));
    const ids = new Set<number>();
    const changes: Array<{ question: Question; isNew: boolean }> = [];
    const blankIdRows: Question[] = [];
    await readQuestionWorkbook(file, ([rawId, text, a, b, c, d, answer, level, tags, disabled]) => {
      const isBlank = rawId === '';
      if (!isBlank && !/^\d+$/.test(rawId)) throw new Error('O ID deve ser um número ou ficar vazio para criar uma questão.');
      const id = isBlank ? 0 : Number(rawId);
      const current = isBlank ? undefined : existing.get(id);
      if (!isBlank && ids.has(id)) throw new Error(`ID ${id} repetido.`);
      if (!isBlank) ids.add(id);

      const correctIndex = ['A', 'B', 'C', 'D'].indexOf(answer.toUpperCase());
      if (correctIndex < 0) throw new Error('Escolha A, B, C ou D em Resposta correta.');
      const difficulty = VALID_DIFFICULTIES.find((value) =>
        value === level.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase(),
      );
      if (!difficulty) throw new Error('Escolha Fácil, Moderado ou Difícil em Dificuldade.');
      const status = disabled.toLowerCase();
      if (status !== 'sim' && status !== 'não') throw new Error('Escolha Sim ou Não em Desativada.');
      const question: Question = {
        id, text, options: [a, b, c, d], correctIndex, difficulty,
        tags: current && tags === current.tags.join('; ') ? current.tags : normalizeTags(tags.split(';')),
        isDisabled: status === 'sim',
      };
      validateQuestionInput(question);
      if (!current) {
        if (isBlank) blankIdRows.push(question);
        else changes.push({ question, isNew: true });
        return;
      }
      if (text !== current.text || question.options.some((option, index) => option !== current.options[index])
        || correctIndex !== current.correctIndex || difficulty !== current.difficulty
        || question.isDisabled !== current.isDisabled
        || JSON.stringify(question.tags) !== JSON.stringify(current.tags)) {
        changes.push({ question, isNew: false });
      }
    });

    // IDs vazios recebem os próximos números livres, depois de todos os IDs existentes ou citados.
    let nextId = Math.max(0, ...existing.keys(), ...ids) + 1;
    for (const question of blankIdRows) {
      changes.push({ question: { ...question, id: nextId++ }, isNew: true });
    }
    return changes;
  }

  async importQuestionsJson(
    jsonContent: string,
    mode: QuestionsImportMode,
  ): Promise<QuestionsImportResult> {
    this.ctx.auth.requireAdmin();

    let decoded: unknown;
    try {
      decoded = JSON.parse(jsonContent);
    } catch {
      throw new Error('Conteúdo JSON inválido para importação do Banco de Questões.');
    }

    const rawList = Array.isArray(decoded)
      ? decoded
      : typeof decoded === 'object' &&
          decoded !== null &&
          Array.isArray((decoded as { questions?: unknown[] }).questions)
        ? (decoded as { questions: unknown[] }).questions
        : null;

    if (!rawList) {
      throw new Error(
        'O arquivo JSON deve conter um array de questões ou um objeto com a chave "questions".',
      );
    }

    const parsedQuestions = rawList.map((entry) => {
      if (typeof entry !== 'object' || entry === null) {
        throw new Error('Cada item do JSON de questões deve ser um objeto.');
      }
      return normalizeImportedQuestion(entry as Record<string, unknown>);
    });

    return this.applyImportedQuestions(parsedQuestions, mode);
  }

  async importQuestionsCsv(
    csvContent: string,
    mode: QuestionsImportMode,
  ): Promise<QuestionsImportResult> {
    this.ctx.auth.requireAdmin();

    const rows = parseCsvRows(csvContent);
    if (rows.length < 2) {
      throw new Error('O arquivo CSV deve conter cabeçalho e ao menos uma linha de questão.');
    }

    const headers = rows[0].map((col) => col.trim().toLowerCase());
    const findHeaderIndex = (names: string[]) =>
      headers.findIndex((header) => names.includes(header));

    const textCol = findHeaderIndex(['text', 'enunciado', 'question']);
    const optACol = findHeaderIndex(['optiona', 'a', 'opt0']);
    const optBCol = findHeaderIndex(['optionb', 'b', 'opt1']);
    const optCCol = findHeaderIndex(['optionc', 'c', 'opt2']);
    const optDCol = findHeaderIndex(['optiond', 'd', 'opt3']);
    const correctCol = findHeaderIndex(['correctindex', 'correct', 'correta']);
    const diffCol = findHeaderIndex(['difficulty', 'dificuldade']);
    const tagsCol = findHeaderIndex(['tags']);
    const disabledCol = findHeaderIndex(['isdisabled', 'disabled', 'desabilitada']);

    if (
      textCol < 0 ||
      optACol < 0 ||
      optBCol < 0 ||
      optCCol < 0 ||
      optDCol < 0 ||
      correctCol < 0
    ) {
      throw new Error(
        'Cabeçalho CSV inválido. Colunas obrigatórias: text, optionA, optionB, optionC, optionD, correctIndex.',
      );
    }

    const parsedQuestions = rows.slice(1).map((row) =>
      normalizeImportedQuestion({
        text: row[textCol] ?? '',
        options: [row[optACol] ?? '', row[optBCol] ?? '', row[optCCol] ?? '', row[optDCol] ?? ''],
        correctIndex: row[correctCol] ?? '',
        difficulty: diffCol >= 0 ? row[diffCol] : 'moderado',
        tags: tagsCol >= 0 ? row[tagsCol] : '',
        isDisabled: disabledCol >= 0 ? row[disabledCol] : false,
      }),
    );

    return this.applyImportedQuestions(parsedQuestions, mode);
  }

  private async applyImportedQuestions(
    parsedQuestions: QuestionUpsertInput[],
    mode: QuestionsImportMode,
  ): Promise<QuestionsImportResult> {
    if (mode === 'replace') {
      const normalized = parsedQuestions.map((item, idx) => buildQuestionEntity(idx + 1, item));
      const saved = await this.ctx.cloudGateway.replaceAllQuestions(normalized);
      await this.catalog.notifyActiveEventsQuestionsChanged();
      return {
        importedCount: saved.length,
        totalAfterImport: saved.length,
        mode,
      };
    }

    const existing = await this.ctx.cloudGateway.listAllQuestions();
    let nextId = existing.reduce((acc, q) => Math.max(acc, q.id), 0);
    const existingByText = new Map(existing.map((q) => [q.text.trim().toLowerCase(), q]));
    const changedIds: number[] = [];

    for (const item of parsedQuestions) {
      const existingMatch = existingByText.get(item.text.trim().toLowerCase());
      if (existingMatch) {
        const saved = await this.ctx.cloudGateway.saveQuestion(
          buildQuestionEntity(existingMatch.id, item),
        );
        changedIds.push(saved.id);
      } else {
        nextId += 1;
        const saved = await this.ctx.cloudGateway.saveQuestion(buildQuestionEntity(nextId, item));
        changedIds.push(saved.id);
      }
    }

    if (changedIds.length > 0) {
      await this.catalog.notifyActiveEventsQuestionsChanged(changedIds);
    }

    const finalList = await this.ctx.cloudGateway.listAllQuestions();
    return {
      importedCount: changedIds.length,
      totalAfterImport: finalList.length,
      mode,
    };
  }
}
