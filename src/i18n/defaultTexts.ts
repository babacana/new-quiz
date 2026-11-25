import { DEFAULT_CUSTOMIZATIONS } from '../domain/defaults';
import type { EventCustomizationTexts } from '../domain/types';

export type TranslatableLanguage = 'en' | 'es';

// Versões EN/ES dos textos padrão do Evento. Só valem enquanto o ADM não editou o texto em português
// (texto personalizado sem tradução cai para o português até a importação das traduções).
export const DEFAULT_TEXT_TRANSLATIONS: Record<
  TranslatableLanguage,
  EventCustomizationTexts
> = {
  en: {
    initialScreenTitle: 'Welcome to the Quiz!',
    initialScreenSlogan: 'CAESB Water, Brasília’s Heritage.',
    initialScreenStartButton: 'Start Quiz',
    initialScreenRankingButton: 'View Ranking',
    quizScreenNextButton: 'Next Question',
    quizScreenFinalizeButton: 'Finish Quiz',
    resultScreenPrizeWon: 'Congratulations, you won a prize!',
    resultScreenPrizeNotWon: 'Too bad, not this time. Try again!',
    resultScreenAllCorrect: 'Congratulations! You got every question right! Perfect score! 🌟',
    resultScreenRankingButton: 'View Ranking',
    resultScreenPlayAgainButton: 'Play Again',
    rankingScreenTitle: 'Overall Ranking',
    rankingScreenBackButton: 'Back to Start',
    idleScreenCallToAction: 'TOUCH TO START',
    idleScreenBeforeTitle: 'QUIZ COMING SOON!',
    idleScreenBeforeSubtitle: 'Touch for more information',
    idleScreenAfterTitle: 'QUIZ ENDED',
    idleScreenAfterSubtitle: 'Thank you for taking part!',
    modalAlreadyWonTitle: 'Hold your excitement, champ! 🏆',
    modalAlreadyWonMessage:
      'We noticed you have already won in our Quiz. So the party keeps going and more people win, it is now another player’s turn! Spread the word!',
    modalIncorrectAnswersTitle: 'Answer Key for Incorrect Questions',
    modalAllCorrectMessage: 'Congratulations! You got every question right!',
    inputNamePlaceholder: 'Name',
    inputPhonePlaceholder: 'Phone (area code + number)',
  },
  es: {
    initialScreenTitle: '¡Bienvenido al Quiz!',
    initialScreenSlogan: 'Agua de CAESB, Patrimonio de Brasilia.',
    initialScreenStartButton: 'Iniciar Quiz',
    initialScreenRankingButton: 'Ver Ranking',
    quizScreenNextButton: 'Siguiente Pregunta',
    quizScreenFinalizeButton: 'Finalizar Quiz',
    resultScreenPrizeWon: '¡Felicidades, ganaste un obsequio!',
    resultScreenPrizeNotWon: 'Qué pena, no fue esta vez. ¡Inténtalo de nuevo!',
    resultScreenAllCorrect: '¡Felicidades! ¡Acertaste todas las preguntas! ¡Puntaje perfecto! 🌟',
    resultScreenRankingButton: 'Ver Ranking',
    resultScreenPlayAgainButton: 'Jugar de Nuevo',
    rankingScreenTitle: 'Ranking General',
    rankingScreenBackButton: 'Volver al Inicio',
    idleScreenCallToAction: 'TOCA PARA COMENZAR',
    idleScreenBeforeTitle: '¡QUIZ PRÓXIMAMENTE!',
    idleScreenBeforeSubtitle: 'Toca para más información',
    idleScreenAfterTitle: 'QUIZ FINALIZADO',
    idleScreenAfterSubtitle: '¡Gracias por participar!',
    modalAlreadyWonTitle: '¡Calma la emoción, campeón(a)! 🏆',
    modalAlreadyWonMessage:
      'Detectamos que ya ganaste en nuestro Quiz. Para que la fiesta continúe y más gente gane, ¡ahora es el turno de otro crack! ¡Corre la voz!',
    modalIncorrectAnswersTitle: 'Respuestas de las Preguntas Erradas',
    modalAllCorrectMessage: '¡Felicidades! ¡Acertaste todas las preguntas!',
    inputNamePlaceholder: 'Nombre',
    inputPhonePlaceholder: 'Teléfono (código de área + número)',
  },
};

const PT_DEFAULT_TEXT_KEYS = new Map<string, keyof EventCustomizationTexts>();
for (const [key, value] of Object.entries(DEFAULT_CUSTOMIZATIONS.texts)) {
  PT_DEFAULT_TEXT_KEYS.set(value, key as keyof EventCustomizationTexts);
}

// Devolve a tradução do texto padrão que coincide com `value`; qualquer outro texto (editado pelo ADM) fica como está.
export function translateDefaultText(value: string, language: 'pt' | TranslatableLanguage): string {
  if (language === 'pt') {
    return value;
  }
  const key = PT_DEFAULT_TEXT_KEYS.get(value);
  return key ? DEFAULT_TEXT_TRANSLATIONS[language][key] : value;
}
