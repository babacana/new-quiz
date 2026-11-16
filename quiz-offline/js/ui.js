// js/ui.js
import { FONT_SIZES_PX, DEFAULT_FONT_STEP_INDEX, DEFAULT_LOGO_SRC, CUSTOM_LOGO_FILENAME_KEY, QUIZ_CUSTOMIZATIONS_KEY, DEFAULT_CUSTOMIZATIONS, DEFAULT_SETTINGS, DEFAULT_KEYBOARD_HEIGHT_VH } from './constants.js'; // MIN_KEYBOARD_HEIGHT_VH, MAX_KEYBOARD_HEIGHT_VH não são mais usados diretamente aqui
import { getFromLocalStorage } from './utils.js';
// Funções do teclado virtual agora são importadas do módulo dedicado
import {
    // initVirtualKeyboard, // Não é chamado por ui.js, mas por main.js
    applyVirtualKeyboardHeight as applyVKHeightFromModule,
    // createKeyboardResizeHandle as createVKResizeHandleFromModule, // Não é chamado por ui.js, mas por main.js
    showVirtualKeyboard as showVKFromModule,
    hideVirtualKeyboard as hideVKFromModule
    // getIsResizingKeyboard não é usado diretamente por ui.js, mas por main.js
} from './virtualKeyboard.js';
// resetIdleTimer será chamado por main.js ou outros manipuladores de eventos, não diretamente por ui.js após esta refatoração.
// As funções de eventLogic serão passadas como callbacks ou chamadas por main.js.
// import { resetIdleTimer } from './idleHandler.js'; // Removido
// import { updateIdleScreenMessage, updateInitialScreenForEventState } from './eventLogic.js'; // Removido

// Referências aos elementos do DOM (serão inicializadas em initializeUiElements)
export let screens, quizContainer, accessibilityControls, htmlEl, decreaseFontButton, increaseFontButton; // virtualKeyboard removido
export let resultPlayerNameTitleEl, resultSummaryDetailsEl, resultPrizeMessageEl, resultTop3CongratsMessageEl, resultAllCorrectMessageEl;
export let top3CongratsModal, top3ModalMessageContentEl, closeTop3CongratsModalBtn;
export let incorrectAnswersModal, closeIncorrectAnswersModalBtn, incorrectAnswersListEl, showIncorrectAnswersBtnRef;
export let progressBarFillEl;
export let nomeInput, telefoneInput, startQuizBtn, viewRankingInitialBtn, questionCounterEl, timerEl, questionTextEl, optionsContainer, nextQuestionBtn, giveUpBtn;
export let showRankingBtn, restartQuizBtn, rankingListEl, backToInitialBtn, idleScreenEl, idleCallToActionEl;
export let eventStatusMessageEl;
export let questionDifficultyTagEl;
export let questionTimeBarContainerEl, questionTimeBarFillEl, timeOutMessageEl, postQuestionControlsEl;
// keyboardResizeHandle removido, será gerenciado por virtualKeyboard.js

export let currentFontStepIndex = DEFAULT_FONT_STEP_INDEX;
export let quizCustomizations = {}; // Para armazenar as customizações carregadas
export let settings = {}; // Para armazenar as configurações carregadas

// Callbacks para funções de eventLogic
let updateIdleScreenMessageCallback = () => {};
let updateInitialScreenForEventStateCallback = () => {};

export function initializeUiElements(dependencies = {}) {
    if(dependencies.updateIdleScreenMessage) updateIdleScreenMessageCallback = dependencies.updateIdleScreenMessage;
    if(dependencies.updateInitialScreenForEventState) updateInitialScreenForEventStateCallback = dependencies.updateInitialScreenForEventState;

    screens = document.querySelectorAll('.screen');
    // virtualKeyboardEl é obtido e gerenciado por virtualKeyboard.js
    quizContainer = document.querySelector('.quiz-container');
    accessibilityControls = document.getElementById('accessibility-controls');
    htmlEl = document.documentElement;

    nomeInput = document.getElementById('nome');
    telefoneInput = document.getElementById('telefone');
    startQuizBtn = document.getElementById('start-quiz-btn');
    viewRankingInitialBtn = document.getElementById('view-ranking-initial-btn');
    questionCounterEl = document.getElementById('question-counter');
    timerEl = document.getElementById('timer');
    questionTextEl = document.getElementById('question-text');
    optionsContainer = document.getElementById('options-container');
    nextQuestionBtn = document.getElementById('next-question-btn');
    giveUpBtn = document.getElementById('give-up-btn');
    showRankingBtn = document.getElementById('show-ranking-btn');
    restartQuizBtn = document.getElementById('restart-quiz-btn');
    rankingListEl = document.getElementById('ranking-list');
    backToInitialBtn = document.getElementById('back-to-initial-btn');
    idleScreenEl = document.getElementById('idle-screen');
    idleCallToActionEl = document.getElementById('idle-call-to-action');
    resultPlayerNameTitleEl = document.getElementById('result-player-name-title');
    resultSummaryDetailsEl = document.getElementById('result-summary-details');
    resultPrizeMessageEl = document.getElementById('result-prize-message');
    resultTop3CongratsMessageEl = document.getElementById('result-top3-congrats-message');
    resultAllCorrectMessageEl = document.getElementById('result-all-correct-message');
    top3CongratsModal = document.getElementById('top3-congrats-modal');
    top3ModalMessageContentEl = document.getElementById('top3-modal-message-content');
    closeTop3CongratsModalBtn = document.getElementById('close-top3-congrats-modal-btn');
    incorrectAnswersModal = document.getElementById('incorrect-answers-modal');
    closeIncorrectAnswersModalBtn = document.getElementById('close-incorrect-answers-modal-btn');
    incorrectAnswersListEl = document.getElementById('incorrect-answers-list');
    showIncorrectAnswersBtnRef = document.getElementById('show-incorrect-answers-btn');
    progressBarFillEl = document.getElementById('progress-bar-fill');
    eventStatusMessageEl = document.getElementById('event-status-message');
    questionDifficultyTagEl = document.getElementById('question-difficulty-tag');
    questionTimeBarContainerEl = document.getElementById('question-time-bar-container');
    questionTimeBarFillEl = document.getElementById('question-time-bar-fill');
    timeOutMessageEl = document.getElementById('timeout-message-text');
    postQuestionControlsEl = document.getElementById('post-question-controls');
    decreaseFontButton = document.getElementById('decrease-font');
    increaseFontButton = document.getElementById('increase-font');
    // keyboardResizeHandle é gerenciado por virtualKeyboard.js
}


export const applyFontSize = () => {
    if (currentFontStepIndex < 0) currentFontStepIndex = 0;
    if (currentFontStepIndex >= FONT_SIZES_PX.length) currentFontStepIndex = FONT_SIZES_PX.length - 1;
    if (htmlEl) htmlEl.style.fontSize = `${FONT_SIZES_PX[currentFontStepIndex]}px`;
    // const decreaseBtn = document.getElementById('decrease-font'); // Removido - usar decreaseFontButton do escopo do módulo
    // const increaseBtn = document.getElementById('increase-font'); // Removido - usar increaseFontButton do escopo do módulo
    if (decreaseFontButton) decreaseFontButton.disabled = currentFontStepIndex === 0;
    if (increaseFontButton) increaseFontButton.disabled = currentFontStepIndex === FONT_SIZES_PX.length - 1;
};

export const decreaseFontSizeStep = () => {
    if (currentFontStepIndex > 0) {
        currentFontStepIndex--;
        applyFontSize();
    }
};

export const increaseFontSizeStep = () => {
    if (currentFontStepIndex < FONT_SIZES_PX.length - 1) {
        currentFontStepIndex++;
        applyFontSize();
    }
};

export const loadFontPreference = () => {
    currentFontStepIndex = DEFAULT_FONT_STEP_INDEX;
    applyFontSize();
};

export const applyCustomLogo = (logoFileName) => {
    const logoSrc = logoFileName ? `assets/${logoFileName}` : DEFAULT_LOGO_SRC;
    console.log('[UI] applyCustomLogo - Aplicando logoSrc:', logoSrc, '(filename:', logoFileName, ') às', new Date().toLocaleTimeString()); // LOG ADICIONADO
    const logoElements = document.querySelectorAll('.caesb-logo');
    logoElements.forEach(logoEl => {
        logoEl.src = logoSrc;
        logoEl.onerror = () => {
            console.warn('[UI] Erro ao carregar logo:', logoSrc, '- Revertendo para padrão.', new Date().toLocaleTimeString()); // LOG ADICIONADO
            logoEl.src = DEFAULT_LOGO_SRC;
        };
    });
};

export const loadCustomLogo = () => {
    const customLogoFileName = localStorage.getItem(CUSTOM_LOGO_FILENAME_KEY);
    console.log('[UI] loadCustomLogo - localStorage CUSTOM_LOGO_FILENAME_KEY:', customLogoFileName, 'às', new Date().toLocaleTimeString()); // LOG ADICIONADO
    applyCustomLogo(customLogoFileName);
};

export const applyCustomBackground = () => {
    // settings e quizCustomizations são agora variáveis de módulo em ui.js,
    // carregadas e mescladas em applyThemeCustomizations ou em uma função de inicialização de UI.
    // Não é necessário buscar do localStorage aqui novamente se applyThemeCustomizations já o fez.
    // Vamos assumir que 'settings' e 'quizCustomizations' (variáveis de módulo) estão atualizadas.

    if (!quizContainer) {
        console.error("applyCustomBackground: quizContainer is not defined yet.");
        return;
    }
    if (settings.enableCustomBackground && settings.customBackgroundFileName) { // Usa a variável 'settings' do módulo
        const imgPath = `assets/${settings.customBackgroundFileName}`;
        quizContainer.style.backgroundImage = `url('${imgPath}')`;
        quizContainer.style.backgroundSize = 'cover';
        quizContainer.style.backgroundPosition = 'center bottom';
        quizContainer.style.backgroundRepeat = 'no-repeat';
        if (document.documentElement) document.documentElement.style.removeProperty('--quiz-main-background');
        quizContainer.style.backgroundColor = '';
    } else {
        quizContainer.style.backgroundImage = '';
        // Usa a variável 'quizCustomizations' do módulo
        const bgColor = (quizCustomizations.colors && quizCustomizations.colors.quizMainBackground) || DEFAULT_CUSTOMIZATIONS.colors.quizMainBackground;
        if (document.documentElement) document.documentElement.style.setProperty('--quiz-main-background', bgColor);
        quizContainer.style.backgroundColor = bgColor;
    }
};

// A função applyVirtualKeyboardHeight foi movida para o módulo virtualKeyboard.js
// As chamadas usarão applyVKHeightFromModule importado.

export const applyThemeCustomizations = () => {
    // Carrega as settings e customizations mais recentes do localStorage e mescla com os padrões
    const storedSettings = getFromLocalStorage('quizSettings');
    settings = storedSettings ? { ...DEFAULT_SETTINGS, ...storedSettings } : { ...DEFAULT_SETTINGS };
    // Aplicar validações específicas de 'quizSettings' que estavam em utils.js
    if (settings.difficultyPercentages) {
        settings.difficultyPercentages = { ...DEFAULT_SETTINGS.difficultyPercentages, ...settings.difficultyPercentages };
    }
    settings.idleTimeoutSeconds = parseInt(settings.idleTimeoutSeconds, 10);
    settings.fadeOutLeadTimeSeconds = parseInt(settings.fadeOutLeadTimeSeconds, 10);
    if (isNaN(settings.idleTimeoutSeconds) || settings.idleTimeoutSeconds < 15) {
        settings.idleTimeoutSeconds = DEFAULT_SETTINGS.idleTimeoutSeconds;
    }
    if (isNaN(settings.fadeOutLeadTimeSeconds) || settings.fadeOutLeadTimeSeconds < 3 || settings.fadeOutLeadTimeSeconds >= settings.idleTimeoutSeconds) {
        settings.fadeOutLeadTimeSeconds = DEFAULT_SETTINGS.fadeOutLeadTimeSeconds;
    }


    const storedCustomizations = getFromLocalStorage(QUIZ_CUSTOMIZATIONS_KEY);
    if (storedCustomizations && typeof storedCustomizations === 'object') {
        const mergedTexts = { ...DEFAULT_CUSTOMIZATIONS.texts, ...(storedCustomizations.texts || {}) };
        const mergedColors = { ...DEFAULT_CUSTOMIZATIONS.colors, ...(storedCustomizations.colors || {}) };
        const mergedFontSizes = { ...DEFAULT_CUSTOMIZATIONS.fontSizes, ...(storedCustomizations.fontSizes || {}) };
        quizCustomizations = { texts: mergedTexts, colors: mergedColors, fontSizes: mergedFontSizes };
    } else {
        quizCustomizations = { ...DEFAULT_CUSTOMIZATIONS }; // Garante que seja um clone
    }


    for (const key in quizCustomizations.colors) {
        if (document.documentElement) document.documentElement.style.setProperty(`--${key.replace(/([A-Z])/g, '-$1').toLowerCase()}`, quizCustomizations.colors[key]);
    }
    applyCustomBackground(); // Usa as settings e customizations carregadas

    for (const key in quizCustomizations.fontSizes) {
        if (document.documentElement) document.documentElement.style.setProperty(`--${key.replace(/([A-Z])/g, '-$1').toLowerCase()}`, quizCustomizations.fontSizes[key]);
    }

    const textTargets = {
        initialScreenTitle: { selector: '#initial-screen h2', default: DEFAULT_CUSTOMIZATIONS.texts.initialScreenTitle },
        initialScreenSlogan: { selector: '#initial-screen .slogan', default: DEFAULT_CUSTOMIZATIONS.texts.initialScreenSlogan },
        initialScreenStartButton: { element: startQuizBtn, default: DEFAULT_CUSTOMIZATIONS.texts.initialScreenStartButton },
        initialScreenRankingButton: { element: viewRankingInitialBtn, default: DEFAULT_CUSTOMIZATIONS.texts.initialScreenRankingButton },
        resultScreenRankingButton: { element: showRankingBtn, default: DEFAULT_CUSTOMIZATIONS.texts.resultScreenRankingButton },
        resultScreenPlayAgainButton: { element: restartQuizBtn, default: DEFAULT_CUSTOMIZATIONS.texts.resultScreenPlayAgainButton },
        rankingScreenTitle: { selector: '#ranking-screen h2', default: DEFAULT_CUSTOMIZATIONS.texts.rankingScreenTitle },
        rankingScreenBackButton: { element: backToInitialBtn, default: DEFAULT_CUSTOMIZATIONS.texts.rankingScreenBackButton },
        idleScreenCallToAction: { element: idleCallToActionEl, default: DEFAULT_CUSTOMIZATIONS.texts.idleScreenCallToAction },
        modalAlreadyWonTitle: { element: document.getElementById('winner-already-modal-title'), default: DEFAULT_CUSTOMIZATIONS.texts.modalAlreadyWonTitle },
        modalAlreadyWonMessage: { element: document.getElementById('winner-already-main-message'), default: DEFAULT_CUSTOMIZATIONS.texts.modalAlreadyWonMessage },
        modalIncorrectAnswersTitle: { element: document.getElementById('incorrect-answers-modal-title'), default: DEFAULT_CUSTOMIZATIONS.texts.modalIncorrectAnswersTitle }
    };

    for (const key in quizCustomizations.texts) {
        const targetInfo = textTargets[key];
        if (targetInfo) {
            const element = targetInfo.element || (targetInfo.selector ? document.querySelector(targetInfo.selector) : null);
            if (element) {
                element.textContent = quizCustomizations.texts[key] || targetInfo.default;
            }
        }
    }
    if(nomeInput) nomeInput.placeholder = quizCustomizations.texts.inputNamePlaceholder || DEFAULT_CUSTOMIZATIONS.texts.inputNamePlaceholder;
    if(telefoneInput) telefoneInput.placeholder = quizCustomizations.texts.inputPhonePlaceholder || DEFAULT_CUSTOMIZATIONS.texts.inputPhonePlaceholder;

    applyVKHeightFromModule(settings.virtualKeyboardHeight || DEFAULT_KEYBOARD_HEIGHT_VH); // Usa as settings carregadas
};


export const showScreen = (screenId) => {
    console.log(`[UI] showScreen: Tentando mostrar tela '${screenId}' às:`, new Date().toLocaleTimeString()); // LOG ADICIONADO
    if (!screens || screens.length === 0) {
        console.error("showScreen: Lista de 'screens' está vazia ou não definida.");
        return;
    }
    let foundScreen = false;
    screens.forEach(screen => {
        if (screen && screen.id) {
            const isActive = screen.id === screenId;
            screen.style.display = isActive ? 'flex' : 'none';
            screen.classList.toggle('active', isActive);
            if (isActive) foundScreen = true;
        } else {
            console.warn("showScreen: Encontrado um elemento 'screen' inválido ou sem ID.");
        }
    });
    if (!foundScreen) {
        console.error(`showScreen: Tela com ID '${screenId}' não encontrada.`);
    }

    // const currentSettings = getFromLocalStorage('quizSettings', DEFAULT_SETTINGS); // Removido, 'settings' já está carregado e mesclado no módulo

    // virtualKeyboardEl é gerenciado por virtualKeyboard.js
    if (screenId !== 'initial-screen') {
        if (settings.enableVirtualKeyboard) { // Usa a variável 'settings' do módulo
            hideVKFromModule();
        }
    }
    if (accessibilityControls) {
        accessibilityControls.classList.toggle('hidden-on-idle', screenId === 'idle-screen');
    }

    if (screenId === 'idle-screen') {
        if (typeof updateIdleScreenMessageCallback === 'function') {
            updateIdleScreenMessageCallback();
        }
        // As chamadas a clearTimeout para fadeOutTimer e actualIdleTimer são gerenciadas por idleHandler.js
        if (quizContainer) {
            quizContainer.classList.remove('fading-to-idle');
            quizContainer.classList.remove('time-alert-border-pulse-warning');
            quizContainer.classList.remove('time-alert-border-pulse-critical');
            quizContainer.classList.remove('time-alert-flash-effect');
        }
        // isFadingToIdle será gerenciado em idleHandler.js
    } else {
        // resetIdleTimer é chamado por idleHandler.js ou pelos manipuladores de evento em main.js
    }

    if (screenId === 'initial-screen') {
        if (typeof updateInitialScreenForEventStateCallback === 'function') {
            updateInitialScreenForEventStateCallback();
        }
        if (nomeInput) nomeInput.value = '';
        if (telefoneInput) telefoneInput.value = '';
        applyVKHeightFromModule(settings.virtualKeyboardHeight || DEFAULT_KEYBOARD_HEIGHT_VH); // Usa a variável 'settings' do módulo
    }
    applyThemeCustomizations(); // Garante que o tema seja aplicado
    console.log(`[UI] showScreen: Tema reaplicado para '${screenId}' às:`, new Date().toLocaleTimeString()); // LOG ADICIONADO
};


export const showWinnerAlreadyModal = (timestamp) => {
    const modal = document.getElementById('winner-already-modal');
    const timestampEl = document.getElementById('winner-already-timestamp');
    if (modal && timestampEl) {
        const dateObj = new Date(timestamp);
        const datePart = dateObj.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });
        const timePart = dateObj.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', hour12: false });
        timestampEl.textContent = `Participação em: ${datePart} às ${timePart}`;
        modal.classList.remove('hidden');
    }
    // resetIdleTimer será chamado pelo manipulador de evento que invoca esta função em main.js
};
export const hideWinnerAlreadyModal = () => {
    const modal = document.getElementById('winner-already-modal');
    if (modal) modal.classList.add('hidden');
    if (nomeInput) nomeInput.value = '';
    if (telefoneInput) telefoneInput.value = '';
    // resetIdleTimer será chamado pelo manipulador de evento que invoca esta função em main.js
};
export const showIncorrectAnswersModalFunc = () => { if (incorrectAnswersModal) incorrectAnswersModal.classList.remove('hidden'); /* resetIdleTimer será chamado pelo manipulador de evento */ };
export const hideIncorrectAnswersModalFunc = () => { if (incorrectAnswersModal) incorrectAnswersModal.classList.add('hidden'); /* resetIdleTimer será chamado pelo manipulador de evento */ };
export const showTop3CongratsModal = () => { if (top3CongratsModal) top3CongratsModal.classList.remove('hidden'); /* resetIdleTimer será chamado pelo manipulador de evento */ };
export const hideTop3CongratsModal = () => { if (top3CongratsModal) top3CongratsModal.classList.add('hidden'); /* resetIdleTimer será chamado pelo manipulador de evento */ };

// displayIncorrectAnswers será movida para quizCore.js pois depende de playerAttempts