// js/constants.js

export const MIN_KEYBOARD_HEIGHT_VH = 20;
export const MAX_KEYBOARD_HEIGHT_VH = 60;
export const DEFAULT_KEYBOARD_HEIGHT_VH = 30;

export const DEFAULT_SETTINGS = {
    minScoreForPrize: 7,
    showCorrectAnswerOnWrong: true,
    rankingDisplayCount: 10,
    enablePrizeLock: true,
    customBackgroundFileName: '',
    enableCustomBackground: false,
    giveUpLockoutMinutes: 0,
    numberOfQuestions: 10,
    timePerQuestion: 30,
    idleTimeoutSeconds: 60,
    fadeOutLeadTimeSeconds: 5,
    difficultyPercentages: { facil: 40, moderado: 40, dificil: 20 },
    virtualKeyboardHeight: DEFAULT_KEYBOARD_HEIGHT_VH,
    enableVirtualKeyboard: true,
    enableTimeAlertBorderPulse: true,
    enableTimeAlertFlash: true
};

export const DEFAULT_CUSTOMIZATIONS = {
    texts: {
        initialScreenTitle: "Bem-vindo ao Quiz!",
        initialScreenSlogan: "Água da CAESB, Patrimônio de Brasília.",
        initialScreenStartButton: "Iniciar Quiz",
        initialScreenRankingButton: "Ver Ranking",
        quizScreenNextButton: "Próxima Pergunta",
        quizScreenFinalizeButton: "Finalizar Quiz",
        resultScreenPrizeWon: "Parabéns, você ganhou um brinde!",
        resultScreenPrizeNotWon: "Que pena, não foi dessa vez. Tente novamente!",
        resultScreenRankingButton: "Ver Ranking",
        resultScreenPlayAgainButton: "Jogar Novamente",
        rankingScreenTitle: "Ranking Geral",
        rankingScreenBackButton: "Voltar ao Início",
        idleScreenCallToAction: "TOQUE PARA COMEÇAR",
        modalAlreadyWonTitle: "Segura a emoção, campeão(ã)! 🏆",
        modalAlreadyWonMessage: "Detectamos que você já faturou no nosso Quiz. Para a festa continuar e mais gente ganhar, a vez agora é de outro craque! Espalha a notícia!",
        modalIncorrectAnswersTitle: "Gabarito das Questões Erradas",
        inputNamePlaceholder: "Nome",
        inputPhonePlaceholder: "Telefone (DDD + Número)"
    },
    colors: {
        quizMainBackground: "#002244",
        quizPrimaryButtonBg: "#51cf66",
        quizPrimaryButtonText: "#ffffff",
        quizSecondaryButtonBg: "#003366",
        quizSecondaryButtonBorder: "#0056a0",
        quizSecondaryButtonText: "#ffffff",
        quizMainTextColor: "#ffffff",
        quizHighlightColor: "#61dafb",
        quizOptionBg: "#ffffff",
        quizOptionText: "#333333",
        quizOptionCorrectBg: "#51cf66",
        quizOptionIncorrectBg: "#ff6b6b",
        quizInputBorder: "#0056a0", // Nova cor para borda de inputs
        quizInputPlaceholder: "rgba(255, 255, 255, 0.6)" // Nova cor para placeholder
    },
    fontSizes: {
        initialSloganFontSize: "clamp(1.1em, 4vw, 1.25em)",
        idleCallToActionFontSize: "clamp(2.8em, 7vw, 5.5em)",
        mainButtonsFontSize: "1.1em",
        questionTextFontSize: "clamp(1.1em, 3vw, 1.3em)",
        mainFontFamily: "'Segoe UI', Tahoma, Geneva, Verdana, sans-serif" // Nova família de fontes
    },
    visualIdentity: {
        logoFileName: "logo.png",
        customBackgroundFileName: "",
        enableCustomBackground: false,
        customBackgroundOpacity: 1 // 100% opacidade por padrão
    }
};

export const DEFAULT_LOGO_SRC = "assets/logo.png";
export const CUSTOM_LOGO_FILENAME_KEY = 'quizCustomLogoFileName';
export const PRIZE_WINNERS_LIST_KEY = 'quizPrizeWinnersData';
export const GIVE_UP_LOCKOUT_LIST_KEY = 'quizGiveUpLockoutData';
export const QUIZ_EVENT_KEY = 'quizCurrentEvent';
export const QUIZ_CUSTOMIZATIONS_KEY = 'quizThemeCustomizations';

export const FONT_SIZES_PX = [10, 12, 14, 16, 18, 20, 22, 24, 26, 28, 30];
export const DEFAULT_FONT_STEP_INDEX = FONT_SIZES_PX.indexOf(18) !== -1 ? FONT_SIZES_PX.indexOf(18) : Math.floor(FONT_SIZES_PX.length / 2);

export const PREDEFINED_THEMES = [
    {
        id: "caesbDefault",
        name: "Padrão CAESB",
        customizations: JSON.parse(JSON.stringify(DEFAULT_CUSTOMIZATIONS)) // Baseado nos defaults atuais
    },
    {
        id: "lightModern",
        name: "Claro Moderno",
        customizations: {
            texts: { ...DEFAULT_CUSTOMIZATIONS.texts }, // Mantém textos padrão ou pode personalizar
            colors: {
                quizMainBackground: "#f0f4f8",
                quizPrimaryButtonBg: "#007bff",
                quizPrimaryButtonText: "#ffffff",
                quizSecondaryButtonBg: "#e9ecef",
                quizSecondaryButtonBorder: "#ced4da",
                quizSecondaryButtonText: "#212529",
                quizMainTextColor: "#212529",
                quizHighlightColor: "#0056b3",
                quizOptionBg: "#ffffff",
                quizOptionText: "#343a40",
                quizOptionCorrectBg: "#28a745",
                quizOptionIncorrectBg: "#dc3545",
                quizInputBorder: "#ced4da",
                quizInputPlaceholder: "#6c757d"
            },
            fontSizes: {
                ...DEFAULT_CUSTOMIZATIONS.fontSizes,
                mainFontFamily: "Arial, Helvetica, sans-serif"
            },
            visualIdentity: {
                logoFileName: "logo.png", // Sugestão, pode ser diferente
                customBackgroundFileName: "",
                enableCustomBackground: false,
                customBackgroundOpacity: 1
            }
        }
    },
    {
        id: "darkElegant",
        name: "Escuro Elegante",
        customizations: {
            texts: { ...DEFAULT_CUSTOMIZATIONS.texts },
            colors: {
                quizMainBackground: "#1a1a2e",
                quizPrimaryButtonBg: "#e94560",
                quizPrimaryButtonText: "#ffffff",
                quizSecondaryButtonBg: "#16213e",
                quizSecondaryButtonBorder: "#0f3460",
                quizSecondaryButtonText: "#ffffff",
                quizMainTextColor: "#e0e0e0",
                quizHighlightColor: "#e94560",
                quizOptionBg: "#0f3460",
                quizOptionText: "#e0e0e0",
                quizOptionCorrectBg: "#51cf66",
                quizOptionIncorrectBg: "#ff6b6b",
                quizInputBorder: "#0f3460",
                quizInputPlaceholder: "rgba(224, 224, 224, 0.5)"
            },
            fontSizes: {
                ...DEFAULT_CUSTOMIZATIONS.fontSizes,
                mainFontFamily: "Verdana, Geneva, sans-serif"
            },
            visualIdentity: {
                logoFileName: "logo.png",
                customBackgroundFileName: "bg_dark_elegant.png", // Exemplo de nome de arquivo
                enableCustomBackground: true,
                customBackgroundOpacity: 0.3
            }
        }
    }
];


export const DEFAULT_QUIZ_QUESTIONS = [
    { id: 'q1', text: 'Qual é a capital do Brasil?', options: ['São Paulo', 'Rio de Janeiro', 'Brasília', 'Salvador'], correct: 2, isDisabled: false, difficulty: 'facil' },
    { id: 'q2', text: 'Qual monumento é um ícone de Brasília, projetado por Oscar Niemeyer, e sede do Congresso Nacional?', options: ['Palácio da Alvorada', 'Catedral Metropolitana', 'Congresso Nacional', 'Ponte JK'], correct: 2, isDisabled: false, difficulty: 'moderado' },
    { id: 'q3', text: 'A CAESB é responsável por qual serviço essencial no Distrito Federal?', options: ['Transporte Público', 'Energia Elétrica', 'Saneamento Básico (Água e Esgoto)', 'Comunicações'], correct: 2, isDisabled: false, difficulty: 'facil' },
    { id: 'q4', text: 'Qual o principal reservatório de água que abastece o Distrito Federal?', options: ['Lago Paranoá', 'Represa do Descoberto', 'Represa de Santa Maria', 'Ambos Descoberto e Santa Maria'], correct: 3, isDisabled: false, difficulty: 'dificil' },
    { id: 'q5', text: 'O slogan da campanha da CAESB mencionada é:', options: ['Água é Vida', 'CAESB, Água para Todos', 'Água da CAESB, Patrimônio de Brasília', 'Beba Água, Viva Melhor'], correct: 2, isDisabled: false, difficulty: 'facil' }
];