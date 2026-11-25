import type {
  EventTextKey,
  EventTextTranslations,
  EventTranslations,
  Question,
  QuestionTranslation,
  QuestionTranslations,
} from '../types';
import {
  EVENT_TEXT_KEYS,
  sanitizeEventTranslations,
  sanitizeQuestionTranslations,
} from '../translations';

export const QUESTIONS_SHEET = 'Perguntas';
export const TEXTS_SHEET = 'Textos do Evento';

const QUESTION_HEADERS = [
  'ID',
  'Enunciado (PT)',
  'Alternativa A (PT)',
  'Alternativa B (PT)',
  'Alternativa C (PT)',
  'Alternativa D (PT)',
  'Enunciado (EN)',
  'Alternativa A (EN)',
  'Alternativa B (EN)',
  'Alternativa C (EN)',
  'Alternativa D (EN)',
  'Enunciado (ES)',
  'Alternativa A (ES)',
  'Alternativa B (ES)',
  'Alternativa C (ES)',
  'Alternativa D (ES)',
];
const TEXT_HEADERS = ['Chave', 'Onde aparece', 'Português (PT)', 'English (EN)', 'Español (ES)'];

export const EVENT_TEXT_DESCRIPTIONS: Record<EventTextKey, string> = {
  initialScreenTitle: 'Tela inicial: título',
  initialScreenSlogan: 'Telas inicial, descanso e quiz fechado: slogan',
  initialScreenStartButton: 'Tela inicial: botão iniciar',
  initialScreenRankingButton: 'Telas inicial e quiz fechado: botão ver ranking',
  quizScreenNextButton: 'Quiz: botão próxima pergunta',
  quizScreenFinalizeButton: 'Quiz: botão finalizar',
  resultScreenPrizeWon: 'Resultado: mensagem de brinde ganho',
  resultScreenPrizeNotWon: 'Resultado: mensagem sem brinde',
  resultScreenAllCorrect: 'Resultado: gabarito perfeito',
  resultScreenRankingButton: 'Resultado: botão ver ranking',
  resultScreenPlayAgainButton: 'Resultado: botão jogar novamente',
  rankingScreenTitle: 'Ranking: título',
  rankingScreenBackButton: 'Ranking: botão voltar',
  idleScreenCallToAction: 'Descanso: chamada para tocar',
  idleScreenBeforeTitle: 'Descanso antes do Evento: título',
  idleScreenBeforeSubtitle: 'Descanso antes do Evento: subtítulo',
  idleScreenAfterTitle: 'Descanso após o Evento: título',
  idleScreenAfterSubtitle: 'Descanso após o Evento: subtítulo',
  modalAlreadyWonTitle: 'Aviso de brinde já ganho: título',
  modalAlreadyWonMessage: 'Aviso de brinde já ganho: mensagem',
  modalIncorrectAnswersTitle: 'Gabarito das questões erradas: título',
  modalAllCorrectMessage: 'Mensagem de gabarito perfeito (modal)',
  inputNamePlaceholder: 'Tela inicial: texto do campo nome',
  inputPhonePlaceholder: 'Tela inicial: texto do campo telefone',
  lgpdNoticeText: 'Tela inicial: aviso LGPD',
};

export interface TranslationWorkbookData {
  questions: Question[];
  /** Textos do Evento em português por chave. */
  eventTexts: Partial<Record<EventTextKey, string>>;
  eventTranslations: EventTranslations | undefined;
}

export async function writeTranslationWorkbook(data: TranslationWorkbookData): Promise<ArrayBuffer> {
  const { default: ExcelJS } = await import('exceljs');
  const workbook = new ExcelJS.Workbook();

  const questions = workbook.addWorksheet(QUESTIONS_SHEET, {
    views: [{ state: 'frozen', ySplit: 1, xSplit: 2 }],
  });
  questions.columns = QUESTION_HEADERS.map((header, index) => ({
    header,
    width: index === 0 ? 8 : index === 1 || index === 6 || index === 11 ? 50 : 28,
    style: { numFmt: '@' },
  }));
  questions.getRow(1).font = { bold: true };
  for (const question of data.questions) {
    const en = question.translations?.en;
    const es = question.translations?.es;
    const row = questions.addRow([
      question.id,
      question.text,
      ...question.options,
      en?.text ?? '',
      ...[0, 1, 2, 3].map((i) => en?.options[i] ?? ''),
      es?.text ?? '',
      ...[0, 1, 2, 3].map((i) => es?.options[i] ?? ''),
    ]);
    row.alignment = { vertical: 'top', wrapText: true };
    for (let column = 1; column <= 6; column += 1) {
      row.getCell(column).font = { color: { argb: 'FF666666' } };
    }
  }

  const texts = workbook.addWorksheet(TEXTS_SHEET, { views: [{ state: 'frozen', ySplit: 1 }] });
  texts.columns = TEXT_HEADERS.map((header, index) => ({
    header,
    width: index === 0 ? 30 : index === 1 ? 44 : 50,
    style: { numFmt: '@' },
  }));
  texts.getRow(1).font = { bold: true };
  for (const key of EVENT_TEXT_KEYS) {
    const portuguese = data.eventTexts[key] ?? '';
    if (!portuguese.trim()) {
      continue;
    }
    const row = texts.addRow([
      key,
      EVENT_TEXT_DESCRIPTIONS[key],
      portuguese,
      data.eventTranslations?.en?.[key] ?? '',
      data.eventTranslations?.es?.[key] ?? '',
    ]);
    row.alignment = { vertical: 'top', wrapText: true };
    for (let column = 1; column <= 3; column += 1) {
      row.getCell(column).font = { color: { argb: 'FF666666' } };
    }
  }

  return workbook.xlsx.writeBuffer();
}

export interface ParsedTranslationWorkbook {
  questions: Array<{ id: number; translations: QuestionTranslations | undefined }>;
  eventTranslations: EventTranslations | undefined;
  /** Chaves de texto presentes na planilha (as ausentes não são tocadas). */
  textKeysInFile: EventTextKey[];
}

function checkHeaders(sheet: import('exceljs').Worksheet, headers: string[], name: string): void {
  if (headers.some((header, index) => sheet.getRow(1).getCell(index + 1).text.trim() !== header)) {
    throw new Error(`Cabeçalho inválido na aba "${name}". Use a planilha exportada pelo sistema, sem alterar as colunas.`);
  }
}

function cellText(row: import('exceljs').Row, column: number): string {
  const cell = row.getCell(column);
  if (cell.formula) {
    throw new Error('Substitua as fórmulas por valores.');
  }
  return cell.text.trim();
}

export async function readTranslationWorkbook(file: ArrayBuffer): Promise<ParsedTranslationWorkbook> {
  const { default: ExcelJS } = await import('exceljs');
  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(file);
  } catch {
    throw new Error('Arquivo inválido. Use a planilha .xlsx de traduções exportada pelo sistema.');
  }

  const errors: string[] = [];
  const questions: ParsedTranslationWorkbook['questions'] = [];
  const sheet = workbook.getWorksheet(QUESTIONS_SHEET);
  if (sheet) {
    checkHeaders(sheet, QUESTION_HEADERS, QUESTIONS_SHEET);
    const seen = new Set<number>();
    sheet.eachRow((row, number) => {
      if (number === 1) return;
      try {
        const rawId = cellText(row, 1);
        if (!rawId) return;
        if (!/^\d+$/.test(rawId)) throw new Error('O ID deve ser um número.');
        const id = Number(rawId);
        if (seen.has(id)) throw new Error(`ID ${id} repetido.`);
        seen.add(id);
        const read = (offset: number): QuestionTranslation => ({
          text: cellText(row, offset),
          options: [1, 2, 3, 4].map((i) => cellText(row, offset + i)) as QuestionTranslation['options'],
        });
        questions.push({
          id,
          translations: sanitizeQuestionTranslations({ en: read(7), es: read(12) }),
        });
      } catch (error) {
        errors.push(`Linha ${number} (${QUESTIONS_SHEET}): ${error instanceof Error ? error.message : 'Valores inválidos.'}`);
      }
    });
  }

  let eventTranslations: EventTranslations | undefined;
  const textKeysInFile: EventTextKey[] = [];
  const textsSheet = workbook.getWorksheet(TEXTS_SHEET);
  if (textsSheet) {
    checkHeaders(textsSheet, TEXT_HEADERS, TEXTS_SHEET);
    const en: EventTextTranslations = {};
    const es: EventTextTranslations = {};
    textsSheet.eachRow((row, number) => {
      if (number === 1) return;
      try {
        const key = cellText(row, 1) as EventTextKey;
        if (!key) return;
        if (!EVENT_TEXT_KEYS.includes(key)) throw new Error(`Chave desconhecida "${key}".`);
        textKeysInFile.push(key);
        en[key] = cellText(row, 4);
        es[key] = cellText(row, 5);
      } catch (error) {
        errors.push(`Linha ${number} (${TEXTS_SHEET}): ${error instanceof Error ? error.message : 'Valores inválidos.'}`);
      }
    });
    eventTranslations = sanitizeEventTranslations({ en, es });
  }

  if (!sheet && !textsSheet) {
    throw new Error(`A planilha precisa ter a aba "${QUESTIONS_SHEET}" ou "${TEXTS_SHEET}".`);
  }
  if (errors.length) {
    const remaining = errors.length > 10 ? `\nMais ${errors.length - 10} linha(s) com erros.` : '';
    throw new Error(errors.slice(0, 10).join('\n') + remaining);
  }
  return { questions, eventTranslations, textKeysInFile };
}

