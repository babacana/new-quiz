import { describe, expect, it } from 'vitest';
import { InMemoryCloudGateway } from '../../adapters/inMemoryCloudGateway';
import { translateEngineMessage } from '../../i18n/engineMessages';
import { DEFAULT_CUSTOMIZATIONS, DEFAULT_EVENT_ID } from '../defaults';
import { EventAdminController } from '../eventAdminController';
import type { RandomSource } from '../ports';
import {
  getEventTextStatuses,
  getLanguageCompleteness,
  getQuestionMissingFields,
  getQuestionTranslationState,
  pickQuestionTranslation,
  sanitizeEventTranslations,
  sanitizeQuestionTranslations,
  summarizeQuestionTranslations,
} from '../translations';

const COMPLETE = { text: 'Q', options: ['a', 'b', 'c', 'd'] as [string, string, string, string] };

describe('estado das traduções', () => {
  it('classifica pergunta como completa, parcial ou sem tradução e lista o que falta', () => {
    expect(getQuestionTranslationState({ translations: { en: COMPLETE } }, 'en')).toBe('complete');
    expect(getQuestionTranslationState({ translations: { en: COMPLETE } }, 'es')).toBe('missing');
    const partial = { translations: { es: { text: 'Q', options: ['a', '', 'c', 'd'] as [string, string, string, string] } } };
    expect(getQuestionTranslationState(partial, 'es')).toBe('partial');
    expect(getQuestionMissingFields(partial, 'es')).toEqual(['Alternativa B']);
    expect(getQuestionMissingFields({}, 'en')).toHaveLength(5);
  });

  it('só usa a tradução da pergunta quando completa', () => {
    expect(pickQuestionTranslation({ en: COMPLETE }, 'en')).toEqual(COMPLETE);
    expect(pickQuestionTranslation({ en: { ...COMPLETE, text: '' } }, 'en')).toBeNull();
    expect(pickQuestionTranslation({ en: COMPLETE }, 'pt')).toBeNull();
  });

  it('conta o resumo ("12 de 15") e a completude do idioma com textos padrão como traduzidos', () => {
    const questions = [
      { translations: { es: COMPLETE }, isDisabled: false },
      { translations: undefined, isDisabled: false },
      { translations: undefined, isDisabled: true },
    ];
    expect(summarizeQuestionTranslations(questions, 'es')).toEqual({
      total: 3, complete: 1, partial: 0, missing: 2,
    });
    const result = getLanguageCompleteness(
      questions,
      { texts: DEFAULT_CUSTOMIZATIONS.texts, translations: undefined },
      { lgpdNoticeText: '' },
      'es',
    );
    expect(result.questions).toMatchObject({ total: 2, complete: 1 });
    expect(result.texts.missing).toBe(0);
    expect(result.isComplete).toBe(false);
  });

  it('marca como faltando o texto personalizado sem tradução e o LGPD preenchido', () => {
    const statuses = getEventTextStatuses(
      { texts: { ...DEFAULT_CUSTOMIZATIONS.texts, initialScreenTitle: 'Feira Tal' }, translations: { en: { initialScreenTitle: 'Fair' } } },
      { lgpdNoticeText: 'Aviso' },
      'en',
    );
    expect(statuses.find((s) => s.key === 'initialScreenTitle')?.state).toBe('translated');
    expect(statuses.find((s) => s.key === 'lgpdNoticeText')?.state).toBe('missing');
    expect(statuses.find((s) => s.key === 'initialScreenSlogan')?.state).toBe('default');
    const other = getEventTextStatuses(
      { texts: { ...DEFAULT_CUSTOMIZATIONS.texts, initialScreenTitle: 'Feira Tal' } },
      { lgpdNoticeText: '' },
      'es',
    );
    expect(other.find((s) => s.key === 'initialScreenTitle')?.state).toBe('missing');
  });

  it('sanitiza dados desconhecidos', () => {
    expect(sanitizeQuestionTranslations({ fr: COMPLETE, en: { text: ' x ', options: ['1'] } })).toEqual({
      en: { text: 'x', options: ['1', '', '', ''] },
    });
    expect(sanitizeQuestionTranslations('lixo')).toBeUndefined();
    expect(sanitizeEventTranslations({ es: { initialScreenTitle: ' Hola ', foo: 'x' } })).toEqual({
      es: { initialScreenTitle: 'Hola' },
    });
  });
});

describe('mensagens do engine no idioma do Participante', () => {
  it('traduz mensagens conhecidas, com parâmetros, e mantém as desconhecidas', () => {
    expect(translateEngineMessage('Preencha o nome.', 'en')).toBe('Please fill in your name.');
    expect(translateEngineMessage('Preencha o nome.', 'pt')).toBe('Preencha o nome.');
    expect(
      translateEngineMessage(
        'Você desistiu recentemente do quiz e está bloqueado por 3 minuto(s). Por favor, aguarde para jogar novamente.',
        'es',
      ),
    ).toContain('3 minuto(s)');
    expect(
      translateEngineMessage('O quiz "Feira X" ainda não começou! Prepare-se, a diversão começa em 25/11/2026 10:00.', 'en'),
    ).toBe('The quiz "Feira X" has not started yet! Get ready, the fun begins on 25/11/2026 10:00.');
    expect(translateEngineMessage('Mensagem personalizada', 'es')).toBe('Mensagem personalizada');
  });
});

class SeqRandom implements RandomSource {
  private n = 0;
  next() { return 0.5; }
  shuffle<T>(items: readonly T[]): T[] { return [...items]; }
  uuid() { this.n += 1; return `22222222-0000-4000-8000-${String(this.n).padStart(12, '0')}`; }
}

describe('planilha de traduções (exportar / importar)', () => {
  it('exporta, importa EN/ES de perguntas e textos, e reflete no estado do Evento', async () => {
    const controller = new EventAdminController({
      cloudGateway: new InMemoryCloudGateway({ online: true, seedDefaultEvent: true }),
      random: new SeqRandom(),
    });
    await controller.login('admin@caesb.df.gov.br', 'CAESB2025!');
    const { default: ExcelJS } = await import('exceljs');

    const exported = await controller.exportTranslationsXlsx(DEFAULT_EVENT_ID);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(exported);
    const questionsSheet = workbook.getWorksheet('Perguntas')!;
    const firstId = Number(questionsSheet.getCell('A2').value);
    // Preenche EN e ES da primeira pergunta e deixa ES da segunda incompleto.
    ['Q en', 'a1', 'b1', 'c1', 'd1', 'Q es', 'a2', 'b2', 'c2', 'd2'].forEach((value, index) => {
      questionsSheet.getRow(2).getCell(7 + index).value = value;
    });
    questionsSheet.getRow(3).getCell(12).value = 'Solo enunciado';
    [1, 2, 3, 4].forEach((i) => {
      questionsSheet.getRow(3).getCell(12 + i).value = '';
    });
    const textsSheet = workbook.getWorksheet('Textos do Evento')!;
    textsSheet.getRow(2).getCell(4).value = 'Custom EN';
    const file = await workbook.xlsx.writeBuffer();

    const plan = await controller.previewTranslationsXlsx(file, DEFAULT_EVENT_ID);
    expect(plan.questionsToUpdate).toBe(2);
    expect(plan.after.en.questions.complete).toBe(plan.after.en.questions.total);
    expect(plan.after.es.questions.partial).toBe(1);
    expect(plan.after.es.isComplete).toBe(false);

    const result = await controller.importTranslationsXlsx(file, DEFAULT_EVENT_ID);
    expect(result.updatedQuestionIds).toContain(firstId);

    const questions = await controller.listAllQuestions();
    const first = questions.find((question) => question.id === firstId)!;
    expect(first.translations?.es?.options).toEqual(['a2', 'b2', 'c2', 'd2']);
    expect(getQuestionTranslationState(first, 'en')).toBe('complete');
    const second = questions.find((question) => question.id === firstId + 1)!;
    expect(getQuestionTranslationState(second, 'es')).toBe('partial');
    const event = (await controller.listEvents()).find((candidate) => candidate.id === DEFAULT_EVENT_ID)!;
    expect(event.customizations.translations?.en?.initialScreenTitle).toBe('Custom EN');

    // Reimportar o mesmo arquivo não altera nada.
    const again = await controller.previewTranslationsXlsx(file, DEFAULT_EVENT_ID);
    expect(again.questionsToUpdate).toBe(0);
    expect(again.textsChanged).toBe(0);

    // Cabeçalho adulterado é recusado.
    questionsSheet.getCell('B1').value = 'Outro';
    await expect(
      controller.importTranslationsXlsx(await workbook.xlsx.writeBuffer(), DEFAULT_EVENT_ID),
    ).rejects.toThrow(/Cabeçalho inválido/);
  }, 30_000);
});
