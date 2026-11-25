import { describe, expect, it } from 'vitest';
import { DEFAULT_CUSTOMIZATIONS } from '../../domain/defaults';
import { DEFAULT_TEXT_TRANSLATIONS, translateDefaultText } from '../defaultTexts';
import { translate } from '../core';
import { en } from '../messages.en';
import { es } from '../messages.es';
import { pt } from '../messages.pt';

describe('i18n', () => {
  it('mantém as mesmas chaves em português, inglês e espanhol, sem textos vazios', () => {
    const keys = Object.keys(pt).sort();
    expect(Object.keys(en).sort()).toEqual(keys);
    expect(Object.keys(es).sort()).toEqual(keys);
    for (const catalog of [pt, en, es]) {
      for (const value of Object.values(catalog)) {
        expect(value.trim()).not.toBe('');
      }
    }
  });

  it('interpola parâmetros e preserva chaves desconhecidas', () => {
    expect(translate('en', 'ranking.hits', { n: 7 })).toBe('7 Correct');
    expect(translate('es', 'modal.top3Congrats', { name: 'ÑANDÚ' })).toBe('¡Felicidades, ÑANDÚ!');
    expect(translate('pt', 'result.place', { n: 1 })).toBe('1º lugar');
  });

  it('traduz só os textos padrão do Evento e deixa os personalizados em português', () => {
    expect(translateDefaultText('Iniciar Quiz', 'en')).toBe('Start Quiz');
    expect(translateDefaultText('Iniciar Quiz', 'es')).toBe('Iniciar Quiz');
    expect(translateDefaultText('Iniciar Quiz', 'pt')).toBe('Iniciar Quiz');
    expect(translateDefaultText('Texto personalizado do ADM', 'en')).toBe(
      'Texto personalizado do ADM',
    );
  });

  it('tem tradução para todos os textos padrão do Evento', () => {
    const keys = Object.keys(DEFAULT_CUSTOMIZATIONS.texts).sort();
    expect(Object.keys(DEFAULT_TEXT_TRANSLATIONS.en).sort()).toEqual(keys);
    expect(Object.keys(DEFAULT_TEXT_TRANSLATIONS.es).sort()).toEqual(keys);
  });
});
