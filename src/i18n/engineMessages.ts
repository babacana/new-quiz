import type { TranslatableLanguage } from './defaultTexts';

type Template = (...groups: string[]) => string;

interface EngineMessageRule {
  pattern: RegExp;
  en: Template;
  es: Template;
}

// Mensagens que o `totemSessionEngine` devolve em português. O Totem as exibe no idioma do Participante
// reconhecendo cada padrão; texto desconhecido (ex.: mensagem personalizada) fica como veio.
const RULES: EngineMessageRule[] = [
  {
    pattern: /^Preencha o nome\.$/,
    en: () => 'Please fill in your name.',
    es: () => 'Completa tu nombre.',
  },
  {
    pattern: /^Telefone inválido\. Formato esperado: \(XX\) XXXXX-XXXX ou \(XX\) XXXX-XXXX\.$/,
    en: () => 'Invalid phone number. Expected format: (XX) XXXXX-XXXX or (XX) XXXX-XXXX.',
    es: () => 'Teléfono no válido. Formato esperado: (XX) XXXXX-XXXX o (XX) XXXX-XXXX.',
  },
  {
    pattern: /^O Evento está fora do período de funcionamento configurado\.$/,
    en: () => 'The Event is outside its configured operating period.',
    es: () => 'El Evento está fuera de su período de funcionamiento.',
  },
  {
    pattern: /^Sem questões habilitadas para jogar\. Verifique o Banco de Questões do Evento\.$/,
    en: () => 'There are no enabled questions to play. Please ask the staff.',
    es: () => 'No hay preguntas habilitadas para jugar. Consulta al personal.',
  },
  {
    pattern:
      /^Você desistiu recentemente do quiz e está bloqueado por (\d+) minuto\(s\)\. Por favor, aguarde para jogar novamente\.$/,
    en: (minutes) =>
      `You recently quit the quiz and are blocked for ${minutes} minute(s). Please wait before playing again.`,
    es: (minutes) =>
      `Abandonaste el quiz recientemente y estás bloqueado por ${minutes} minuto(s). Espera para volver a jugar.`,
  },
  {
    pattern: /^O quiz "(.*)" foi encerrado\. Obrigado pela participação!$/s,
    en: (name) => `The quiz "${name}" has ended. Thank you for taking part!`,
    es: (name) => `El quiz "${name}" ha finalizado. ¡Gracias por participar!`,
  },
  {
    pattern: /^O quiz "(.*)" ainda não começou! Prepare-se, a diversão começa em (.+)\.$/s,
    en: (name, date) => `The quiz "${name}" has not started yet! Get ready, the fun begins on ${date}.`,
    es: (name, date) => `¡El quiz "${name}" aún no comienza! Prepárate, la diversión empieza el ${date}.`,
  },
  {
    pattern: /^O quiz "(.*)" foi encerrado em (.+)\. Obrigado pela participação!$/s,
    en: (name, date) => `The quiz "${name}" ended on ${date}. Thank you for taking part!`,
    es: (name, date) => `El quiz "${name}" finalizó el ${date}. ¡Gracias por participar!`,
  },
  {
    pattern: /^Trava de Brinde aplicada na nuvem: este telefone já conquistou Brinde neste Evento\.$/,
    en: () => 'Prize lock applied: this phone number has already won a prize in this Event.',
    es: () => 'Bloqueo de obsequio aplicado: este teléfono ya ganó un obsequio en este Evento.',
  },
  {
    pattern: /^Estoque de Brindes do Evento esgotado durante a sincronização\.$/,
    en: () => 'The Event prize stock ran out during synchronization.',
    es: () => 'El stock de obsequios del Evento se agotó durante la sincronización.',
  },
  {
    pattern: /^Ranking consolidado com outros Totens: posição atual (\d+)º lugar\.$/,
    en: (position) => `Ranking updated with other kiosks: current place #${position}.`,
    es: (position) => `Ranking consolidado con otros tótems: puesto actual ${position}.`,
  },
];

export function translateEngineMessage(message: string, language: 'pt' | TranslatableLanguage): string {
  if (language === 'pt') {
    return message;
  }
  for (const rule of RULES) {
    const match = rule.pattern.exec(message);
    if (match) {
      return rule[language](...match.slice(1));
    }
  }
  return message;
}
