import type { Question } from '../types';

const SHEET = 'Questões';
const ANSWERS = ['A', 'B', 'C', 'D'];
const DIFFICULTIES = { facil: 'Fácil', moderado: 'Moderado', dificil: 'Difícil' };
const HEADERS = [
  'ID', 'Enunciado', 'Alternativa A', 'Alternativa B', 'Alternativa C', 'Alternativa D',
  'Resposta correta', 'Dificuldade', 'Tags', 'Desativada',
];

export async function writeQuestionWorkbook(questions: Question[]): Promise<ArrayBuffer> {
  const { default: ExcelJS } = await import('exceljs');
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet(SHEET, { views: [{ state: 'frozen', ySplit: 1 }] });
  const widths = [10, 58, 30, 30, 30, 30, 20, 16, 26, 15];
  sheet.columns = HEADERS.map((header, index) => ({
    header,
    width: widths[index],
    style: index === 0 ? undefined : { numFmt: '@' },
  }));
  sheet.getRow(1).font = { bold: true };
  sheet.autoFilter = 'A1:J1';

  for (const question of questions) {
    const row = sheet.addRow([
      question.id, question.text, ...question.options, ANSWERS[question.correctIndex],
      DIFFICULTIES[question.difficulty], question.tags.join('; '), question.isDisabled ? 'Sim' : 'Não',
    ]);
    row.alignment = { vertical: 'top', wrapText: true };
    row.getCell(7).dataValidation = { type: 'list', formulae: ['"A,B,C,D"'], showErrorMessage: true };
    row.getCell(8).dataValidation = {
      type: 'list', formulae: ['"Fácil,Moderado,Difícil"'], showErrorMessage: true,
    };
    row.getCell(10).dataValidation = { type: 'list', formulae: ['"Sim,Não"'], showErrorMessage: true };
  }

  return workbook.xlsx.writeBuffer();
}

export async function readQuestionWorkbook(
  file: ArrayBuffer,
  parseRow: (cells: string[]) => void,
): Promise<void> {
  const { default: ExcelJS } = await import('exceljs');
  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(file);
  } catch {
    throw new Error('Arquivo inválido. Use uma planilha .xlsx exportada pelo Banco de Questões.');
  }
  const sheet = workbook.getWorksheet(SHEET);
  if (!sheet || HEADERS.some((header, index) => sheet.getRow(1).getCell(index + 1).text.trim() !== header)) {
    throw new Error('Cabeçalho inválido. Mantenha a aba Questões e as colunas da planilha exportada.');
  }

  const errors: string[] = [];
  sheet.eachRow((row, number) => {
    if (number === 1) return;
    try {
      const cells = HEADERS.map((_, index) => {
        const cell = row.getCell(index + 1);
        if (cell.formula) throw new Error('Substitua as fórmulas por valores.');
        return cell.text.trim();
      });
      if (cells.some(Boolean)) parseRow(cells);
    } catch (error) {
      errors.push(`Linha ${number}: ${error instanceof Error ? error.message : 'Valores inválidos.'}`);
    }
  });
  if (errors.length) {
    const remaining = errors.length > 10 ? `\nMais ${errors.length - 10} linha(s) com erros.` : '';
    throw new Error(errors.slice(0, 10).join('\n') + remaining);
  }
}
