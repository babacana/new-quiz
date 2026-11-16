// js/main.js
import {
    MIN_KEYBOARD_HEIGHT_VH, MAX_KEYBOARD_HEIGHT_VH, DEFAULT_KEYBOARD_HEIGHT_VH,
    DEFAULT_SETTINGS, DEFAULT_CUSTOMIZATIONS, DEFAULT_LOGO_SRC,
    CUSTOM_LOGO_FILENAME_KEY, PRIZE_WINNERS_LIST_KEY, GIVE_UP_LOCKOUT_LIST_KEY,
    QUIZ_EVENT_KEY, QUIZ_CUSTOMIZATIONS_KEY, FONT_SIZES_PX, DEFAULT_FONT_STEP_INDEX,
    DEFAULT_QUIZ_QUESTIONS
} from './constants.js';

import {
    getFromLocalStorage, saveToLocalStorage, showAlert, showConfirm,
    shuffleArray, formatTime
} from './utils.js';
import {
    initVirtualKeyboard,
    applyVirtualKeyboardHeight as applyVKHeight, // Renomeando para evitar conflito se existir em ui.js
    createKeyboardResizeHandle as createVKResizeHandle,
    showVirtualKeyboard as showVK,
    hideVirtualKeyboard as hideVK,
    getIsResizingKeyboard
} from './virtualKeyboard.js';
import {
    initializeUiElements,
    applyFontSize as uiApplyFontSize, // Mantido para consistência, mas a lógica de clique usará as novas funções
    loadFontPreference as uiLoadFontPreference,
    decreaseFontSizeStep, // Nova função importada
    increaseFontSizeStep, // Nova função importada
    applyCustomLogo as uiApplyCustomLogo,
    loadCustomLogo as uiLoadCustomLogo,
    applyCustomBackground as uiApplyCustomBackground,
    applyThemeCustomizations as uiApplyThemeCustomizations,
    showScreen as uiShowScreen,
    showWinnerAlreadyModal as uiShowWinnerAlreadyModal,
    hideWinnerAlreadyModal as uiHideWinnerAlreadyModal,
    showIncorrectAnswersModalFunc as uiShowIncorrectAnswersModal,
    hideIncorrectAnswersModalFunc as uiHideIncorrectAnswersModal,
    showTop3CongratsModal as uiShowTop3CongratsModal,
    hideTop3CongratsModal as uiHideTop3CongratsModal,
    // Elementos DOM exportados de ui.js (serão povoados por initializeUiElements)
    screens, quizContainer, accessibilityControls, htmlEl, decreaseFontButton, increaseFontButton,
    resultPlayerNameTitleEl, resultSummaryDetailsEl, resultPrizeMessageEl, resultTop3CongratsMessageEl, resultAllCorrectMessageEl,
    top3CongratsModal, top3ModalMessageContentEl, closeTop3CongratsModalBtn,
    incorrectAnswersModal, closeIncorrectAnswersModalBtn, incorrectAnswersListEl, showIncorrectAnswersBtnRef,
    progressBarFillEl,
    nomeInput, telefoneInput, startQuizBtn, viewRankingInitialBtn, questionCounterEl, timerEl, questionTextEl, optionsContainer, nextQuestionBtn, giveUpBtn,
    showRankingBtn, restartQuizBtn, rankingListEl, backToInitialBtn, idleScreenEl, idleCallToActionEl,
    eventStatusMessageEl,
    questionDifficultyTagEl,
    questionTimeBarContainerEl, questionTimeBarFillEl, timeOutMessageEl, postQuestionControlsEl,
} from './ui.js';
import { initIdleHandler, resetIdleTimer as resetIdleTimerFromHandler, globalResetIdleTimer } from './idleHandler.js';
import { initEventLogic, checkEventStatus, updateIdleScreenMessage, updateInitialScreenForEventState } from './eventLogic.js';
import {
    initQuizEngine,
    handleStartQuizAttempt, // Importado de quizEngine
    handleGiveUp,           // Importado de quizEngine
    loadRanking,            // Importado de quizEngine
    displayIncorrectAnswers, // Importado de quizEngine
    handleNextQuestionButtonClick
} from './quizEngine.js';


document.addEventListener('DOMContentLoaded', () => {

    let currentEventData = null;
    let settings = {}; 

    function initializeQuizApp() {
        console.log("initializeQuizApp: Iniciando...");
        
        initializeUiElements({
            updateIdleScreenMessage: updateIdleScreenMessage,
            updateInitialScreenForEventState: updateInitialScreenForEventState
        });

        const storedSettings = getFromLocalStorage('quizSettings');
        settings = storedSettings ? { ...DEFAULT_SETTINGS, ...storedSettings } : { ...DEFAULT_SETTINGS };
        
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

        if (!quizContainer) { 
            console.error("initializeQuizApp: Elemento .quiz-container não encontrado! O Quiz não pode ser renderizado.");
            return;
        }
        
        currentEventData = getFromLocalStorage(QUIZ_EVENT_KEY, null);
        
        uiLoadCustomLogo(); // Chamada existente
        console.log('[MAIN] uiLoadCustomLogo chamada em initializeQuizApp às', new Date().toLocaleTimeString()); // LOG ADICIONADO

        uiApplyThemeCustomizations();
        console.log('[MAIN] uiApplyThemeCustomizations chamada em initializeQuizApp às', new Date().toLocaleTimeString()); // LOG ADICIONADO

        initIdleHandler({
            quizContainer: quizContainer, 
            showScreen: uiShowScreen,     
            getSettings: () => settings   
        });

        initEventLogic({
            getFromLocalStorage: getFromLocalStorage, 
            idleCallToActionEl: idleCallToActionEl, 
            eventStatusMessageEl: eventStatusMessageEl, 
            startQuizBtn: startQuizBtn, 
            viewRankingInitialBtn: viewRankingInitialBtn, 
            getCurrentEventData: () => currentEventData, 
            getQuizCustomizations: () => getFromLocalStorage(QUIZ_CUSTOMIZATIONS_KEY, DEFAULT_CUSTOMIZATIONS)
        });

        initQuizEngine({
            getFromLocalStorage, saveToLocalStorage, showAlert, showConfirm, shuffleArray, formatTime,
            uiShowScreen, uiShowWinnerAlreadyModal, uiHideWinnerAlreadyModal, uiShowIncorrectAnswersModal,
            uiHideIncorrectAnswersModal, uiShowTop3CongratsModal, uiHideTop3CongratsModal,
            nomeInput, telefoneInput, quizContainer, questionCounterEl, timerEl, questionTextEl, optionsContainer,
            nextQuestionBtn, giveUpBtn, progressBarFillEl, questionDifficultyTagEl, resultPlayerNameTitleEl,
            resultSummaryDetailsEl, resultPrizeMessageEl, resultTop3CongratsMessageEl, resultAllCorrectMessageEl,
            top3ModalMessageContentEl, incorrectAnswersListEl, showIncorrectAnswersBtnRef, rankingListEl,
            questionTimeBarContainerEl, questionTimeBarFillEl, timeOutMessageEl, postQuestionControlsEl,
            showVK, hideVK,
            resetIdleTimerFromHandler,
            checkEventStatus,
            getCurrentEventData: () => currentEventData,
            getCoreSettings: () => settings
        });

        initVirtualKeyboard(settings, resetIdleTimerFromHandler);

        if (settings.enableVirtualKeyboard) {
            createVKResizeHandle();
        }
                
        setupEventListeners();

        const initialTestAction = localStorage.getItem('quiz_test_action');
        const initialTestTarget = localStorage.getItem('quiz_test_target');
        if (initialTestAction && initialTestTarget) {
            console.log(`initializeQuizApp: Executando ação de teste - Ação: ${initialTestAction}, Alvo: ${initialTestTarget}`);
            setTimeout(() => {
                if (initialTestAction === 'goto_screen') uiShowScreen(initialTestTarget);
                else if (initialTestAction === 'simulate_scenario') handleSimulatedScenario(initialTestTarget);
                localStorage.removeItem('quiz_test_action');
                localStorage.removeItem('quiz_test_target');
            }, 100);
        } else {
            uiShowScreen('initial-screen');
        }

        document.addEventListener('contextmenu', event => event.preventDefault());
        console.log("initializeQuizApp: Finalizado.");
    }

    function setupEventListeners() {
        [nomeInput, telefoneInput].forEach(inputEl => {
            if (inputEl) inputEl.addEventListener('focus', (e) => { setTimeout(() => showVK(e.target), 0); resetIdleTimerFromHandler(); });
        });
        if (nomeInput) nomeInput.addEventListener('input', () => { nomeInput.value = nomeInput.value.replace(/[^a-zA-Z\sÀ-ú]/g, '').toUpperCase(); resetIdleTimerFromHandler(); });
        if (telefoneInput) telefoneInput.addEventListener('input', () => {
            let v = telefoneInput.value.replace(/\D/g, '').substring(0, 11), f = '';
            if (v.length > 0) f = `(${v.substring(0, 2)}`;
            if (v.length > 2) f += `) ${v.substring(2, v.length > 6 ? 7 : v.length)}`;
            if (v.length > 7) f += `-${v.substring(7, 11)}`;
            telefoneInput.value = f;
            resetIdleTimerFromHandler();
        });

        if (startQuizBtn) startQuizBtn.addEventListener('click', () => { handleStartQuizAttempt(); resetIdleTimerFromHandler(); });
        if (viewRankingInitialBtn) viewRankingInitialBtn.addEventListener('click', () => { loadRanking(); uiShowScreen('ranking-screen'); resetIdleTimerFromHandler(); });
        
        if (nextQuestionBtn) nextQuestionBtn.addEventListener('click', () => {
            handleNextQuestionButtonClick(); 
            resetIdleTimerFromHandler();
        });

        if (giveUpBtn) giveUpBtn.addEventListener('click', () => { handleGiveUp(); resetIdleTimerFromHandler(); }); 
        if (showRankingBtn) showRankingBtn.addEventListener('click', () => { loadRanking(); uiShowScreen('ranking-screen'); resetIdleTimerFromHandler(); }); 
        if (restartQuizBtn) restartQuizBtn.addEventListener('click', () => {
            if (nomeInput) nomeInput.value = '';
            if (telefoneInput) telefoneInput.value = '';
            uiShowScreen('initial-screen');
            resetIdleTimerFromHandler();
        });
        if (backToInitialBtn) backToInitialBtn.addEventListener('click', () => {
            if (nomeInput) nomeInput.value = '';
            if (telefoneInput) telefoneInput.value = '';
            uiShowScreen('initial-screen');
            resetIdleTimerFromHandler();
        });

        if (idleScreenEl) {
            const handleIdleScreenInteraction = () => {
                uiShowScreen('initial-screen');
            };
            idleScreenEl.addEventListener('click', handleIdleScreenInteraction);
            idleScreenEl.addEventListener('touchstart', handleIdleScreenInteraction, {passive: true});
        }

        const winnerAlreadyModal = document.getElementById('winner-already-modal');
        const closeWinnerAlreadyModalBtn = document.getElementById('close-winner-already-modal-btn');
        if (closeWinnerAlreadyModalBtn) closeWinnerAlreadyModalBtn.addEventListener('click', () => { uiHideWinnerAlreadyModal(); resetIdleTimerFromHandler(); });
        if (winnerAlreadyModal) winnerAlreadyModal.addEventListener('click', (event) => { if (event.target === winnerAlreadyModal) { uiHideWinnerAlreadyModal(); resetIdleTimerFromHandler(); } });

        if (closeIncorrectAnswersModalBtn) closeIncorrectAnswersModalBtn.addEventListener('click', () => { uiHideIncorrectAnswersModal(); resetIdleTimerFromHandler(); });
        if (incorrectAnswersModal) incorrectAnswersModal.addEventListener('click', (event) => { if (event.target === incorrectAnswersModal) { uiHideIncorrectAnswersModal(); resetIdleTimerFromHandler(); } });
        if (closeTop3CongratsModalBtn) closeTop3CongratsModalBtn.addEventListener('click', () => { uiHideTop3CongratsModal(); resetIdleTimerFromHandler(); });
        if (top3CongratsModal) top3CongratsModal.addEventListener('click', (event) => { if (event.target === top3CongratsModal) { uiHideTop3CongratsModal(); resetIdleTimerFromHandler(); } });
        if (showIncorrectAnswersBtnRef) showIncorrectAnswersBtnRef.addEventListener('click', () => { displayIncorrectAnswers(); resetIdleTimerFromHandler(); }); 

        if (decreaseFontButton) { 
            decreaseFontButton.addEventListener('click', () => {
                decreaseFontSizeStep(); 
                resetIdleTimerFromHandler();
            });
        }

        if (increaseFontButton) { 
            increaseFontButton.addEventListener('click', () => {
                increaseFontSizeStep(); 
                resetIdleTimerFromHandler();
            });
        }
        const adminAccessBtn = document.getElementById('admin-access-btn');
        if (adminAccessBtn) adminAccessBtn.addEventListener('click', () => { window.location.href = 'admin.html'; resetIdleTimerFromHandler(); });

        ['click', 'keydown', 'touchstart', 'mousemove', 'input', 'scroll'].forEach(event => {
            document.addEventListener(event, (e) => {
                if (e.isTrusted && !getIsResizingKeyboard()) { 
                    resetIdleTimerFromHandler();
                }
            }, {passive: true});
        });
    }

    // Funções que foram movidas para quizEngine.js ou idleHandler.js foram removidas daqui.
    // A função displayIncorrectAnswers, handleStartQuizAttempt, handleGiveUp, loadRanking são importadas de quizEngine.js

    const handleSimulatedScenario = (scenarioName) => {
        let testName, testRank, testScore, testTotalQuestions, testTime, testWonPrize;
        const getTestData = (keySuffix, defaultValue) => localStorage.getItem(`quiz_test_data_${keySuffix}`) ?? defaultValue;
        const clearAllTestData = () => { Object.keys(localStorage).filter(k => k.startsWith('quiz_test_data_')).forEach(k => localStorage.removeItem(k)); };

        const populateResultScreenBasics = (name, scoreVal, totalQVal, timeSecVal, rankVal) => {
            if (resultPlayerNameTitleEl) { resultPlayerNameTitleEl.textContent = name + ","; resultPlayerNameTitleEl.classList.remove('hidden'); }
            if (resultSummaryDetailsEl) resultSummaryDetailsEl.innerHTML = `<p>Seu Desempenho: <strong>${scoreVal}/${totalQVal}</strong> acertos</p><p>Tempo: <strong>${formatTime(timeSecVal)}</strong></p><p>Ranking: <strong>${rankVal > 0 ? rankVal + 'º' : 'N/A'}</strong> lugar</p>`;
        };
        const setPrizeMessage = (won) => {
            if (resultPrizeMessageEl) {
                const currentCustomizations = getFromLocalStorage(QUIZ_CUSTOMIZATIONS_KEY) || DEFAULT_CUSTOMIZATIONS;
                const texts = currentCustomizations.texts || DEFAULT_CUSTOMIZATIONS.texts;
                resultPrizeMessageEl.textContent = won ? (texts.resultScreenPrizeWon || DEFAULT_CUSTOMIZATIONS.texts.resultScreenPrizeWon)
                                                     : (texts.resultScreenPrizeNotWon || DEFAULT_CUSTOMIZATIONS.texts.resultScreenPrizeNotWon);
                resultPrizeMessageEl.className = `result-message ${won ? 'prize-won' : 'prize-not-won'}`;
                resultPrizeMessageEl.classList.remove('hidden');
            }
        };

        // A variável playerAttempts foi movida para quizEngine.js. 
        // A simulação de 'modal_incorrect_answers' chamará displayIncorrectAnswers de quizEngine,
        // que usará sua própria cópia de playerAttempts.
        // Para testar este cenário específico, playerAttempts precisaria ser populado no quizEngine
        // ou o quizEngine precisaria de uma função para injetar dados de teste.

        switch (scenarioName) {
            case 'modal_already_won': uiShowWinnerAlreadyModal(new Date().toISOString()); uiShowScreen('initial-screen'); break;
            case 'modal_top3':
                testName = getTestData('name', "Jogador(a) VIP Teste"); testRank = parseInt(getTestData('rank', "1"));
                testTotalQuestions = settings.numberOfQuestions || DEFAULT_SETTINGS.numberOfQuestions;
                populateResultScreenBasics(testName, Math.floor(testTotalQuestions * 0.9), testTotalQuestions, 45, testRank); setPrizeMessage(true);
                if (top3ModalMessageContentEl) top3ModalMessageContentEl.innerHTML = `<span class="msg-line-1">Parabéns, <span class="msg-player-name">${testName}</span>!</span><br>...`;
                uiShowScreen('result-screen'); uiShowTop3CongratsModal(); break;
            case 'modal_incorrect_answers':
                // Para testar este cenário, o quizEngine precisaria ter playerAttempts populado.
                // Atualmente, esta simulação pode não mostrar as respostas incorretas se o quizEngine
                // não tiver dados de tentativas de um quiz anterior simulado.
                testTotalQuestions = settings.numberOfQuestions || DEFAULT_SETTINGS.numberOfQuestions;
                populateResultScreenBasics("Teste Gabarito", Math.floor(testTotalQuestions * 0.5), testTotalQuestions, 120, 8); setPrizeMessage(false);
                uiShowScreen('result-screen'); 
                displayIncorrectAnswers(); 
                if (showIncorrectAnswersBtnRef) showIncorrectAnswersBtnRef.classList.remove('hidden'); 
                break;
            case 'result_top1_winner':
                testName = getTestData('name', "Super Campeão Teste"); testScore = parseInt(getTestData('score', (settings.numberOfQuestions || DEFAULT_SETTINGS.numberOfQuestions).toString() )); testTotalQuestions = parseInt(getTestData('total_questions', (settings.numberOfQuestions || DEFAULT_SETTINGS.numberOfQuestions).toString() )); testTime = parseInt(getTestData('time_seconds', "25")); testRank = parseInt(getTestData('rank', "1")); testWonPrize = getTestData('won_prize', 'true') === 'true';
                populateResultScreenBasics(testName, testScore, testTotalQuestions, testTime, testRank); setPrizeMessage(testWonPrize);
                if (top3ModalMessageContentEl) top3ModalMessageContentEl.innerHTML = `<span class="msg-line-1">Parabéns, <span class="msg-player-name">${testName}</span>!</span><br>...`;
                uiShowScreen('result-screen'); uiShowTop3CongratsModal(); if (showIncorrectAnswersBtnRef) showIncorrectAnswersBtnRef.classList.add('hidden'); break;
            case 'result_non_top3_winner':
                testName = getTestData('name', "Bom Jogador Teste"); testScore = parseInt(getTestData('score', (Math.floor((settings.numberOfQuestions || DEFAULT_SETTINGS.numberOfQuestions) * 0.8)).toString() )); testTotalQuestions = parseInt(getTestData('total_questions', (settings.numberOfQuestions || DEFAULT_SETTINGS.numberOfQuestions).toString() )); testTime = parseInt(getTestData('time_seconds', "70")); testRank = parseInt(getTestData('rank', "4")); testWonPrize = getTestData('won_prize', 'true') === 'true';
                populateResultScreenBasics(testName, testScore, testTotalQuestions, testTime, testRank); setPrizeMessage(testWonPrize);
                uiShowScreen('result-screen'); if (showIncorrectAnswersBtnRef) { /* Para teste, playerAttempts precisaria ser populado no quizEngine */ showIncorrectAnswersBtnRef.classList.remove('hidden');} break;
            case 'result_loser':
                testName = getTestData('name', "Participante Teste"); testScore = parseInt(getTestData('score', (Math.floor((settings.numberOfQuestions || DEFAULT_SETTINGS.numberOfQuestions) * 0.3)).toString() )); testTotalQuestions = parseInt(getTestData('total_questions', (settings.numberOfQuestions || DEFAULT_SETTINGS.numberOfQuestions).toString() )); testTime = parseInt(getTestData('time_seconds', "90")); testRank = parseInt(getTestData('rank', "15")); testWonPrize = getTestData('won_prize', 'false') === 'true';
                populateResultScreenBasics(testName, testScore, testTotalQuestions, testTime, testRank); setPrizeMessage(testWonPrize);
                uiShowScreen('result-screen'); if (showIncorrectAnswersBtnRef) { /* Para teste, playerAttempts precisaria ser populado no quizEngine */ showIncorrectAnswersBtnRef.classList.remove('hidden');} break;
        }
        clearAllTestData();
    };

    initializeQuizApp();
});