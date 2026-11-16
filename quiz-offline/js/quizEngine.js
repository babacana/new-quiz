// js/quizEngine.js
import {
    DEFAULT_SETTINGS, DEFAULT_CUSTOMIZATIONS,
    QUIZ_CUSTOMIZATIONS_KEY
} from './constants.js';
import {
    addPrizeWinner, getPrizeWinners,
    addGiveUpLockout, getGiveUpLockoutList, saveGiveUpLockoutList, removeGiveUpLockoutByPhone
} from './utils.js';

// Variáveis de estado do Quiz (serão gerenciadas internamente)
let allQuestionsInternal = [];
let participantsInternal = [];
let settingsInternal = {};
let quizCustomizationsInternal = {}; // Adicionado para textos de botões, etc.
let playerAttempts = [];
let currentQuestionIndex = 0;
let currentQuizQuestions = [];
let score = 0;
let questionTimerInterval = null;
let flashInterval = null;
let currentQuestionTimeLeft = 0;
let totalQuizStartTime;
let questionStartTimeForBar;
let playerName = '';
let playerPhone = '';
let currentPlayerTimestamp;
let timeBarAnimationId = null;

// Callbacks e referências de dependências (serão injetadas)
let deps = {};

export function initQuizEngine(dependencies) {
    deps = dependencies;
    // Carregar settings e customizations iniciais aqui se necessário,
    // ou garantir que sejam passadas/atualizadas quando mudam.
    settingsInternal = deps.getFromLocalStorage('quizSettings', DEFAULT_SETTINGS);
    // Aplicar validações de settings aqui também, como feito em main.js e ui.js
    if (settingsInternal.difficultyPercentages) {
        settingsInternal.difficultyPercentages = { ...DEFAULT_SETTINGS.difficultyPercentages, ...settingsInternal.difficultyPercentages };
    }
    settingsInternal.idleTimeoutSeconds = parseInt(settingsInternal.idleTimeoutSeconds, 10);
    settingsInternal.fadeOutLeadTimeSeconds = parseInt(settingsInternal.fadeOutLeadTimeSeconds, 10);
    if (isNaN(settingsInternal.idleTimeoutSeconds) || settingsInternal.idleTimeoutSeconds < 15) {
        settingsInternal.idleTimeoutSeconds = DEFAULT_SETTINGS.idleTimeoutSeconds;
    }
    if (isNaN(settingsInternal.fadeOutLeadTimeSeconds) || settingsInternal.fadeOutLeadTimeSeconds < 3 || settingsInternal.fadeOutLeadTimeSeconds >= settingsInternal.idleTimeoutSeconds) {
        settingsInternal.fadeOutLeadTimeSeconds = DEFAULT_SETTINGS.fadeOutLeadTimeSeconds;
    }


    const storedCustomizations = deps.getFromLocalStorage(QUIZ_CUSTOMIZATIONS_KEY);
    if (storedCustomizations && typeof storedCustomizations === 'object') {
        const mergedTexts = { ...DEFAULT_CUSTOMIZATIONS.texts, ...(storedCustomizations.texts || {}) };
        const mergedColors = { ...DEFAULT_CUSTOMIZATIONS.colors, ...(storedCustomizations.colors || {}) };
        const mergedFontSizes = { ...DEFAULT_CUSTOMIZATIONS.fontSizes, ...(storedCustomizations.fontSizes || {}) };
        quizCustomizationsInternal = { texts: mergedTexts, colors: mergedColors, fontSizes: mergedFontSizes };
    } else {
        quizCustomizationsInternal = { ...DEFAULT_CUSTOMIZATIONS };
    }

    allQuestionsInternal = deps.getFromLocalStorage('quizQuestions', []).map(q => ({
        ...q,
        isDisabled: typeof q.isDisabled === 'boolean' ? q.isDisabled : false,
        difficulty: q.difficulty || 'facil'
    }));
    participantsInternal = deps.getFromLocalStorage('quizParticipants', []);

    console.log("QuizEngine inicializado.");
}

export function handleStartQuizAttempt() {
    // As dependências como getCurrentEventData e checkEventStatus são acessadas via deps
    const currentEventData = deps.getCurrentEventData();
    const eventStatus = deps.checkEventStatus();

    if (currentEventData && currentEventData.enableOutOfPeriodMessage && (eventStatus === 'before' || eventStatus === 'after')) {
        if (eventStatus === 'before') deps.showAlert(`O quiz ainda não começou. Aguarde até ${new Date(currentEventData.startTime).toLocaleString('pt-BR')}.`);
        else if (eventStatus === 'after') deps.showAlert(`O quiz já foi encerrado. Obrigado pela participação!`);
        return;
    }

    playerName = deps.nomeInput.value.trim();
    playerPhone = deps.telefoneInput.value.trim();

    if (!playerName) { deps.showAlert('Preencha o nome.'); if (deps.nomeInput && settingsInternal.enableVirtualKeyboard) deps.showVK(deps.nomeInput); return; }
    if (!/^\(\d{2}\)\s\d{4,5}-\d{4}$/.test(playerPhone)) { deps.showAlert('Telefone inválido. Formato esperado: (XX) XXXXX-XXXX ou (XX) XXXX-XXXX.'); if (deps.telefoneInput && settingsInternal.enableVirtualKeyboard) deps.showVK(deps.telefoneInput); return; }

    if (settingsInternal.enablePrizeLock) {
        const prizeWinners = getPrizeWinners();
        const existingWinner = prizeWinners.find(winner => winner.phone === playerPhone);
        if (existingWinner) { deps.uiShowWinnerAlreadyModal(existingWinner.timestamp); return; }
    }

    if (settingsInternal.giveUpLockoutMinutes > 0) {
        const giveUpLockouts = getGiveUpLockoutList();
        const now = Date.now();
        const activeLockouts = giveUpLockouts.filter(lockout => (new Date(lockout.timestamp).getTime() + (settingsInternal.giveUpLockoutMinutes * 60 * 1000)) > now);
        saveGiveUpLockoutList(activeLockouts); // Mantém a lógica de limpar expirados
        const existingLockout = activeLockouts.find(lockout => lockout.phone === playerPhone);
        if (existingLockout) {
            const remainingTimeMs = (new Date(existingLockout.timestamp).getTime() + (settingsInternal.giveUpLockoutMinutes * 60 * 1000)) - now;
            const remainingMinutes = Math.ceil(remainingTimeMs / (1000 * 60));
            deps.showAlert(`Você desistiu recentemente do quiz e está bloqueado por ${remainingMinutes} minuto(s). Por favor, aguarde para jogar novamente.`, 'warning');
            return;
        }
    }
    if (settingsInternal.enableVirtualKeyboard) deps.hideVK();
    startQuiz(); // Chama a função startQuiz interna do engine
}

// Renomeada para evitar conflito de nome se exportada e importada em main.js com o mesmo nome.
// No entanto, como é interna ao módulo agora, o nome original 'startQuiz' pode ser mantido.
function startQuiz() {
    playerAttempts = [];
    // Recarrega settings e questions para garantir que estão atualizadas no início de cada quiz
    const storedSettings = deps.getFromLocalStorage('quizSettings');
    settingsInternal = storedSettings ? { ...DEFAULT_SETTINGS, ...storedSettings } : { ...DEFAULT_SETTINGS };
     if (settingsInternal.difficultyPercentages) {
        settingsInternal.difficultyPercentages = { ...DEFAULT_SETTINGS.difficultyPercentages, ...settingsInternal.difficultyPercentages };
    }
    settingsInternal.idleTimeoutSeconds = parseInt(settingsInternal.idleTimeoutSeconds, 10);
    settingsInternal.fadeOutLeadTimeSeconds = parseInt(settingsInternal.fadeOutLeadTimeSeconds, 10);
    if (isNaN(settingsInternal.idleTimeoutSeconds) || settingsInternal.idleTimeoutSeconds < 15) {
        settingsInternal.idleTimeoutSeconds = DEFAULT_SETTINGS.idleTimeoutSeconds;
    }
    if (isNaN(settingsInternal.fadeOutLeadTimeSeconds) || settingsInternal.fadeOutLeadTimeSeconds < 3 || settingsInternal.fadeOutLeadTimeSeconds >= settingsInternal.idleTimeoutSeconds) {
        settingsInternal.fadeOutLeadTimeSeconds = DEFAULT_SETTINGS.fadeOutLeadTimeSeconds;
    }


    const storedQuestions = deps.getFromLocalStorage('quizQuestions');
    allQuestionsInternal = Array.isArray(storedQuestions) ? storedQuestions.map(q => ({
        ...q,
        isDisabled: typeof q.isDisabled === 'boolean' ? q.isDisabled : false,
        difficulty: q.difficulty || 'facil'
    })) : [];


    const enabledQuestions = allQuestionsInternal.filter(q => !q.isDisabled);
    const numQuestionsToPlay = settingsInternal.numberOfQuestions || DEFAULT_SETTINGS.numberOfQuestions;
    const difficultyPercentages = settingsInternal.difficultyPercentages || DEFAULT_SETTINGS.difficultyPercentages;

    if (enabledQuestions.length === 0) {
        deps.showAlert("Sem questões habilitadas para jogar. Por favor, verifique as configurações na área administrativa.");
        deps.uiShowScreen('initial-screen'); return;
    }

    currentQuizQuestions = [];
    const questionsByDifficulty = {
        facil: deps.shuffleArray(enabledQuestions.filter(q => q.difficulty === 'facil')),
        moderado: deps.shuffleArray(enabledQuestions.filter(q => q.difficulty === 'moderado')),
        dificil: deps.shuffleArray(enabledQuestions.filter(q => q.difficulty === 'dificil'))
    };

    let countFacil = Math.round(numQuestionsToPlay * (difficultyPercentages.facil / 100));
    let countModerado = Math.round(numQuestionsToPlay * (difficultyPercentages.moderado / 100));
    let countDificil = Math.round(numQuestionsToPlay * (difficultyPercentages.dificil / 100));

    let currentTotal = countFacil + countModerado + countDificil;
    while (currentTotal !== numQuestionsToPlay) {
        if (currentTotal < numQuestionsToPlay) {
            if (difficultyPercentages.facil >= difficultyPercentages.moderado && difficultyPercentages.facil >= difficultyPercentages.dificil && questionsByDifficulty.facil.length > countFacil) countFacil++;
            else if (difficultyPercentages.moderado >= difficultyPercentages.facil && difficultyPercentages.moderado >= difficultyPercentages.dificil && questionsByDifficulty.moderado.length > countModerado) countModerado++;
            else if (questionsByDifficulty.dificil.length > countDificil) countDificil++;
            else if (questionsByDifficulty.facil.length > countFacil) countFacil++;
            else if (questionsByDifficulty.moderado.length > countModerado) countModerado++;
            else break;
        } else {
            if (difficultyPercentages.dificil <= difficultyPercentages.moderado && difficultyPercentages.dificil <= difficultyPercentages.facil && countDificil > 0) countDificil--;
            else if (difficultyPercentages.moderado <= difficultyPercentages.facil && difficultyPercentages.moderado <= difficultyPercentages.dificil && countModerado > 0) countModerado--;
            else if (countFacil > 0) countFacil--;
            else break;
        }
        currentTotal = countFacil + countModerado + countDificil;
    }

    currentQuizQuestions.push(...questionsByDifficulty.facil.slice(0, countFacil));
    currentQuizQuestions.push(...questionsByDifficulty.moderado.slice(0, countModerado));
    currentQuizQuestions.push(...questionsByDifficulty.dificil.slice(0, countDificil));

    let remainingNeeded = numQuestionsToPlay - currentQuizQuestions.length;
    if (remainingNeeded > 0) {
        const allAvailableShuffled = deps.shuffleArray(enabledQuestions.filter(q => !currentQuizQuestions.find(cq => cq.id === q.id)));
        currentQuizQuestions.push(...allAvailableShuffled.slice(0, remainingNeeded));
    }

    currentQuizQuestions = deps.shuffleArray(currentQuizQuestions.slice(0, numQuestionsToPlay));

    if (currentQuizQuestions.length === 0) {
        deps.showAlert("Não foi possível selecionar questões com base nas configurações. Verifique o banco de questões e as configurações de dificuldade.");
        deps.uiShowScreen('initial-screen'); return;
    }
    if (numQuestionsToPlay > currentQuizQuestions.length && currentQuizQuestions.length > 0) {
         console.warn(`Configurado para ${numQuestionsToPlay} perguntas, mas apenas ${currentQuizQuestions.length} foram selecionadas devido à disponibilidade/distribuição. Jogando com ${currentQuizQuestions.length}.`);
    }

    currentQuestionIndex = 0;
    score = 0;
    totalQuizStartTime = Date.now();
    if (deps.giveUpBtn) deps.giveUpBtn.classList.remove('hidden');
    if (deps.postQuestionControlsEl) deps.postQuestionControlsEl.classList.add('hidden');
    if (deps.showIncorrectAnswersBtnRef) deps.showIncorrectAnswersBtnRef.classList.add('hidden');
    if (deps.questionDifficultyTagEl) deps.questionDifficultyTagEl.textContent = '';
    
    loadQuestion(); // Chama a função loadQuestion interna do engine
    deps.uiShowScreen('quiz-screen');
}

function loadQuestion() {
    // console.log('[QuizEngine] loadQuestion: currentQuestionIndex =', currentQuestionIndex, 'totalQuestions =', currentQuizQuestions.length);
    clearInterval(questionTimerInterval);
    clearInterval(flashInterval);
    flashInterval = null;
    if (timeBarAnimationId) {
        cancelAnimationFrame(timeBarAnimationId);
        timeBarAnimationId = null;
    }

    if (deps.questionTimeBarContainerEl) deps.questionTimeBarContainerEl.classList.remove('hidden');
    if (deps.questionTimeBarFillEl) {
        deps.questionTimeBarFillEl.style.width = '100%';
        deps.questionTimeBarFillEl.style.backgroundColor = 'hsl(120, 80%, 50%)';
    }
    if (deps.timeOutMessageEl) deps.timeOutMessageEl.classList.add('hidden');
    if (deps.postQuestionControlsEl) deps.postQuestionControlsEl.classList.add('hidden');
    if (deps.optionsContainer) deps.optionsContainer.classList.remove('options-really-dimmed');


    if (deps.quizContainer) {
        deps.quizContainer.classList.remove('time-alert-border-pulse-warning');
        deps.quizContainer.classList.remove('time-alert-border-pulse-critical');
        deps.quizContainer.classList.remove('time-alert-flash-effect');
    }
    if (currentQuestionIndex >= currentQuizQuestions.length) {
        // console.log('[QuizEngine] loadQuestion: Condição de finalização atingida. Chamando endQuiz().');
        endQuiz();
        return;
    }
    const q = currentQuizQuestions[currentQuestionIndex];

    if (!q || typeof q.text !== 'string' || q.text.trim() === "") {
        console.error("QuizEngine: Questão inválida ou texto da questão ausente/vazio:", q);
        deps.showAlert("Erro: Não foi possível carregar o texto da pergunta. Verifique os dados das questões no painel de administração.");
        currentQuizQuestions.splice(currentQuestionIndex, 1);
        if (currentQuizQuestions.length === 0 || currentQuestionIndex >= currentQuizQuestions.length) {
             if (playerAttempts.length > 0 || score > 0) { endQuiz(); }
             else { deps.uiShowScreen('initial-screen'); }
        } else { loadQuestion(); }
        return;
    }

    if (!deps.questionTextEl || !deps.questionCounterEl || !deps.optionsContainer || !deps.nextQuestionBtn || !deps.progressBarFillEl || !deps.questionDifficultyTagEl || !deps.timerEl) {
        console.error("QuizEngine: Elementos da UI do quiz não encontrados!");
        deps.showAlert("Erro crítico na interface do quiz. Por favor, recarregue.");
        deps.uiShowScreen('initial-screen');
        return;
    }

    deps.questionTextEl.textContent = q.text;
    deps.questionCounterEl.textContent = `${currentQuestionIndex + 1}/${currentQuizQuestions.length}`;
    const progress = ((currentQuestionIndex + 1) / currentQuizQuestions.length) * 100;
    deps.progressBarFillEl.style.width = `${progress}%`;

    const difficultyMap = { facil: 'Fácil', moderado: 'Moderado', dificil: 'Difícil' };
    const difficultyText = q.difficulty ? (difficultyMap[q.difficulty] || q.difficulty.charAt(0).toUpperCase() + q.difficulty.slice(1)) : 'N/D';
    deps.questionDifficultyTagEl.textContent = difficultyText;
    deps.questionDifficultyTagEl.className = `question-difficulty-tag difficulty-${q.difficulty || 'na'}`;

    deps.optionsContainer.innerHTML = '';
    let optionsToDisplay = q.options.map((optionText, index) => ({ text: optionText, isCorrectOriginal: index === q.correct }));
    const shuffledOptionsToDisplay = deps.shuffleArray([...optionsToDisplay]);
    shuffledOptionsToDisplay.forEach(optionData => {
        const optionDiv = document.createElement('div');
        optionDiv.classList.add('option');
        optionDiv.textContent = optionData.text;
        optionDiv.dataset.isCorrect = optionData.isCorrectOriginal;
        // A chamada a resetIdleTimerFromHandler é feita pelo event listener em main.js que chama handleOptionSelect
        optionDiv.addEventListener('click', () => { handleOptionSelect(optionDiv, q.id); });
        deps.optionsContainer.appendChild(optionDiv);
    });

    if (deps.giveUpBtn) deps.giveUpBtn.classList.remove('hidden');
    startQuestionCountdown();
}

function updateQuestionTimeBar() {
    if (!deps.questionTimeBarFillEl || currentQuestionTimeLeft <=0 ) {
        if (timeBarAnimationId) cancelAnimationFrame(timeBarAnimationId);
        timeBarAnimationId = null;
        if (deps.questionTimeBarFillEl && currentQuestionTimeLeft <=0) {
             deps.questionTimeBarFillEl.style.width = '0%';
             deps.questionTimeBarFillEl.style.backgroundColor = `hsl(0, 80%, 50%)`;
        }
        return;
    }

    const totalTimeForQuestionMs = (settingsInternal.timePerQuestion || DEFAULT_SETTINGS.timePerQuestion) * 1000;
    const elapsedTime = Date.now() - questionStartTimeForBar;
    const timeRemainingMs = Math.max(0, totalTimeForQuestionMs - elapsedTime);
    const percentageRemaining = (timeRemainingMs / totalTimeForQuestionMs) * 100;

    deps.questionTimeBarFillEl.style.width = percentageRemaining + '%';

    let hue;
    const timeLeftSecondsForColor = timeRemainingMs / 1000;
    const warningTimeThreshold = 10;
    const criticalTimeThreshold = 5;

    const greenHue = 120;
    const yellowHue = 60;
    const redHue = 0;

    if (timeLeftSecondsForColor > warningTimeThreshold) {
        hue = greenHue;
    } else if (timeLeftSecondsForColor > criticalTimeThreshold) {
        const progressToYellow = (timeLeftSecondsForColor - criticalTimeThreshold) / (warningTimeThreshold - criticalTimeThreshold);
        hue = redHue + progressToYellow * (yellowHue - redHue);
    } else {
        hue = redHue;
    }

    hue = Math.max(0, Math.min(120, hue));
    deps.questionTimeBarFillEl.style.backgroundColor = `hsl(${hue}, 80%, 50%)`;

    if (timeRemainingMs > 0 && questionTimerInterval) {
        timeBarAnimationId = requestAnimationFrame(updateQuestionTimeBar);
    } else {
        if (deps.questionTimeBarFillEl) {
            deps.questionTimeBarFillEl.style.width = '0%';
            deps.questionTimeBarFillEl.style.backgroundColor = `hsl(0, 80%, 50%)`;
        }
        timeBarAnimationId = null;
    }
}


function startQuestionCountdown() {
    clearInterval(questionTimerInterval);
    clearInterval(flashInterval);
    flashInterval = null;
    if (timeBarAnimationId) {
        cancelAnimationFrame(timeBarAnimationId);
        timeBarAnimationId = null;
    }

    currentQuestionTimeLeft = settingsInternal.timePerQuestion || DEFAULT_SETTINGS.timePerQuestion;

    if (deps.timerEl) {
        const elapsedTimeTotalQuiz = Math.floor((Date.now() - totalQuizStartTime) / 1000);
        deps.timerEl.textContent = deps.formatTime(elapsedTimeTotalQuiz);
        deps.timerEl.className = 'quiz-timer timer-normal';
    }

    if (deps.questionTimeBarContainerEl) deps.questionTimeBarContainerEl.classList.remove('hidden');
    if (deps.questionTimeBarFillEl) {
        deps.questionTimeBarFillEl.style.width = '100%';
        deps.questionTimeBarFillEl.style.backgroundColor = 'hsl(120, 80%, 50%)';
        questionStartTimeForBar = Date.now();
        timeBarAnimationId = requestAnimationFrame(updateQuestionTimeBar);
    }


    if (deps.quizContainer) {
        deps.quizContainer.classList.remove('time-alert-border-pulse-warning');
        deps.quizContainer.classList.remove('time-alert-border-pulse-critical');
        deps.quizContainer.classList.remove('time-alert-flash-effect');
    }

    questionTimerInterval = setInterval(() => {
        currentQuestionTimeLeft--;

        if (deps.timerEl) {
            const elapsedTimeTotalQuiz = Math.floor((Date.now() - totalQuizStartTime) / 1000);
            deps.timerEl.textContent = deps.formatTime(elapsedTimeTotalQuiz);
        }

        if (settingsInternal.enableTimeAlertBorderPulse && deps.quizContainer) {
            if (currentQuestionTimeLeft <= 5) {
                deps.quizContainer.classList.remove('time-alert-border-pulse-warning');
                deps.quizContainer.classList.add('time-alert-border-pulse-critical');
            } else if (currentQuestionTimeLeft <= 10) {
                deps.quizContainer.classList.add('time-alert-border-pulse-warning');
                deps.quizContainer.classList.remove('time-alert-border-pulse-critical');
            } else {
                deps.quizContainer.classList.remove('time-alert-border-pulse-warning');
                deps.quizContainer.classList.remove('time-alert-border-pulse-critical');
            }
        } else if (deps.quizContainer) {
            deps.quizContainer.classList.remove('time-alert-border-pulse-warning');
            deps.quizContainer.classList.remove('time-alert-border-pulse-critical');
        }

        if (settingsInternal.enableTimeAlertFlash && deps.quizContainer) {
            if (currentQuestionTimeLeft <= 5 && currentQuestionTimeLeft >= 0) {
                if (!flashInterval) {
                    if (currentQuestionTimeLeft > 0) {
                       deps.quizContainer.classList.add('time-alert-flash-effect');
                        setTimeout(() => {
                            if (deps.quizContainer) deps.quizContainer.classList.remove('time-alert-flash-effect');
                        }, 300);
                    }
                    flashInterval = setInterval(() => {
                        if (currentQuestionTimeLeft <= 0 || currentQuestionTimeLeft > 5) {
                            clearInterval(flashInterval);
                            flashInterval = null;
                            if (deps.quizContainer) deps.quizContainer.classList.remove('time-alert-flash-effect');
                            return;
                        }
                        deps.quizContainer.classList.add('time-alert-flash-effect');
                        setTimeout(() => {
                            if (deps.quizContainer) deps.quizContainer.classList.remove('time-alert-flash-effect');
                        }, 300);
                    }, 700);
                }
            } else {
                if (flashInterval) {
                    clearInterval(flashInterval);
                    flashInterval = null;
                    if (deps.quizContainer) deps.quizContainer.classList.remove('time-alert-flash-effect');
                }
            }
        } else if (deps.quizContainer && flashInterval) {
            clearInterval(flashInterval);
            flashInterval = null;
            deps.quizContainer.classList.remove('time-alert-flash-effect');
        }


        if (currentQuestionTimeLeft <= 0) {
            handleQuestionTimeout();
        }
    }, 1000);
}

function handleQuestionTimeout() {
    clearInterval(questionTimerInterval);
    questionTimerInterval = null;
    clearInterval(flashInterval);
    flashInterval = null;
    if (timeBarAnimationId) {
        cancelAnimationFrame(timeBarAnimationId);
        timeBarAnimationId = null;
    }
    if (deps.quizContainer) {
        deps.quizContainer.classList.remove('time-alert-border-pulse-warning');
        deps.quizContainer.classList.remove('time-alert-border-pulse-critical');
        deps.quizContainer.classList.remove('time-alert-flash-effect');
    }

    if (deps.questionTimeBarContainerEl) deps.questionTimeBarContainerEl.classList.add('hidden');
    if (deps.optionsContainer) deps.optionsContainer.classList.add('options-really-dimmed');
    if (deps.timeOutMessageEl) {
        deps.timeOutMessageEl.textContent = "Tempo Esgotado!";
        deps.timeOutMessageEl.classList.remove('hidden');
    }
    if (deps.postQuestionControlsEl) deps.postQuestionControlsEl.classList.remove('hidden');


    const q = currentQuizQuestions[currentQuestionIndex];
    if (q) {
        playerAttempts.push({
            questionId: q.id,
            questionText: q.text,
            options: [...q.options],
            selectedOptionText: "Tempo esgotado",
            correctOptionIndex: q.correct,
            correctOptionText: q.options[q.correct],
            isCorrect: false
        });
    } else {
        console.warn("QuizEngine - handleQuestionTimeout: q é undefined.");
    }


    Array.from(deps.optionsContainer.children).forEach(child => {
        child.classList.add('disabled');
        if (child.dataset.isCorrect === 'true' && settingsInternal.showCorrectAnswerOnWrong) {
            child.classList.add('correct');
        }
    });

    if (deps.nextQuestionBtn) {
        const texts = quizCustomizationsInternal.texts || DEFAULT_CUSTOMIZATIONS.texts;
        if (currentQuestionIndex >= currentQuizQuestions.length - 1) {
            deps.nextQuestionBtn.textContent = texts.quizScreenFinalizeButton || DEFAULT_CUSTOMIZATIONS.texts.quizScreenFinalizeButton;
        } else {
            deps.nextQuestionBtn.textContent = texts.quizScreenNextButton || DEFAULT_CUSTOMIZATIONS.texts.quizScreenNextButton;
        }
    }
    if (deps.giveUpBtn) deps.giveUpBtn.classList.add('hidden');
}


function handleOptionSelect(selectedOptionDiv, questionId) {
    clearInterval(questionTimerInterval);
    questionTimerInterval = null;
    clearInterval(flashInterval);
    flashInterval = null;
    if (timeBarAnimationId) {
        cancelAnimationFrame(timeBarAnimationId);
        timeBarAnimationId = null;
    }
    if (deps.questionTimeBarContainerEl) deps.questionTimeBarContainerEl.classList.add('hidden');
    if (deps.timeOutMessageEl) deps.timeOutMessageEl.classList.add('hidden');

    if (deps.quizContainer) {
        deps.quizContainer.classList.remove('time-alert-border-pulse-warning');
        deps.quizContainer.classList.remove('time-alert-border-pulse-critical');
        deps.quizContainer.classList.remove('time-alert-flash-effect');
    }
    if (!deps.optionsContainer || !deps.nextQuestionBtn) return;
    const isCorrect = selectedOptionDiv.dataset.isCorrect === 'true';
    const q = currentQuizQuestions[currentQuestionIndex];

    if (q && (q.id === 30 || q.id === '30')) { // Log específico para a questão 30
        console.log(`[Q30-ENGINE] handleOptionSelect: questionId: ${questionId}, selectedOptionText: "${selectedOptionDiv.textContent}", selectedOptionDiv.dataset.isCorrect: "${selectedOptionDiv.dataset.isCorrect}", q.correct (index): ${q.correct}, q.options[q.correct]: "${q.options[q.correct]}". Calculated isCorrect: ${isCorrect}`);
    }

    playerAttempts.push({
        questionId: questionId,
        questionText: q.text,
        options: [...q.options],
        selectedOptionText: selectedOptionDiv.textContent,
        correctOptionIndex: q.correct,
        correctOptionText: q.options[q.correct],
        isCorrect: isCorrect
    });

    Array.from(deps.optionsContainer.children).forEach(child => {
        child.classList.add('disabled');
        if (child.dataset.isCorrect === 'true') {
            if (!isCorrect && settingsInternal.showCorrectAnswerOnWrong) {
                child.classList.add('correct');
            }
        }
    });
    if (isCorrect) { selectedOptionDiv.classList.add('correct'); score++; }
    else { selectedOptionDiv.classList.add('incorrect'); }

    if (deps.nextQuestionBtn) {
        const texts = quizCustomizationsInternal.texts || DEFAULT_CUSTOMIZATIONS.texts;
        if (currentQuestionIndex >= currentQuizQuestions.length - 1) {
            deps.nextQuestionBtn.textContent = texts.quizScreenFinalizeButton || DEFAULT_CUSTOMIZATIONS.texts.quizScreenFinalizeButton;
        } else {
            deps.nextQuestionBtn.textContent = texts.quizScreenNextButton || DEFAULT_CUSTOMIZATIONS.texts.quizScreenNextButton;
        }
    }
    if (deps.postQuestionControlsEl) deps.postQuestionControlsEl.classList.remove('hidden');

    if (deps.giveUpBtn) deps.giveUpBtn.classList.add('hidden');
}

// Tornando endQuiz exportável para que possa ser chamada, por exemplo, em testes ou cenários específicos de main.js se necessário.
// No fluxo normal, é chamada internamente por loadQuestion.
export function endQuiz() {
    // console.log('[QuizEngine] endQuiz: Iniciando finalização do quiz.');
    clearInterval(questionTimerInterval);
    questionTimerInterval = null;
    clearInterval(flashInterval);
    flashInterval = null;
    if (timeBarAnimationId) {
        cancelAnimationFrame(timeBarAnimationId);
        timeBarAnimationId = null;
    }
    if (deps.quizContainer) {
        deps.quizContainer.classList.remove('time-alert-border-pulse-warning');
        deps.quizContainer.classList.remove('time-alert-border-pulse-critical');
        deps.quizContainer.classList.remove('time-alert-flash-effect');
    }
    if (deps.questionTimeBarContainerEl) deps.questionTimeBarContainerEl.classList.add('hidden');
    if (deps.timeOutMessageEl) deps.timeOutMessageEl.classList.add('hidden');
    if (deps.postQuestionControlsEl) deps.postQuestionControlsEl.classList.add('hidden');
    if (deps.optionsContainer) deps.optionsContainer.classList.remove('options-really-dimmed');

    const totalSeconds = Math.floor((Date.now() - totalQuizStartTime) / 1000);
    currentPlayerTimestamp = new Date().toISOString();

    participantsInternal = deps.getFromLocalStorage('quizParticipants', []);
    participantsInternal.push({ name: playerName, phone: playerPhone, score, time: totalSeconds, timestamp: currentPlayerTimestamp, playerAttempts: [...playerAttempts] });
    deps.saveToLocalStorage('quizParticipants', participantsInternal);
    
    if (settingsInternal.enablePrizeLock && score >= settingsInternal.minScoreForPrize) {
        // A função addPrizeWinner agora lida com obter a lista, adicionar e salvar.
        // A verificação de duplicidade (!prizeWinners.some) foi removida daqui,
        // pois addPrizeWinner em utils.js atualmente não verifica duplicidade.
        // Se a verificação de duplicidade for necessária, ela deve ser adicionada em utils.js/addPrizeWinner.
        addPrizeWinner({ phone: playerPhone, timestamp: currentPlayerTimestamp });
    }

    const sortedParticipants = [...participantsInternal].sort((a, b) => b.score - a.score || a.time - b.time);
    const currentPlayerRank = sortedParticipants.findIndex(p => p.timestamp === currentPlayerTimestamp) + 1;

    if (deps.resultPlayerNameTitleEl) { deps.resultPlayerNameTitleEl.textContent = playerName + ","; deps.resultPlayerNameTitleEl.classList.remove('hidden'); }
    if (deps.resultTop3CongratsMessageEl) { deps.resultTop3CongratsMessageEl.classList.add('hidden'); deps.resultTop3CongratsMessageEl.textContent = ''; }
    if (deps.resultAllCorrectMessageEl) { deps.resultAllCorrectMessageEl.classList.add('hidden'); deps.resultAllCorrectMessageEl.textContent = '';}

    if (currentPlayerRank > 0 && currentPlayerRank <= 3) {
        if (deps.top3ModalMessageContentEl) {
            deps.top3ModalMessageContentEl.innerHTML =
                `<span class="msg-line-1">Parabéns, <span class="msg-player-name">${playerName}</span>!</span><br>` +
                `<span class="msg-line-2">Você saneou todas as dúvidas e mostrou um conhecimento cristalino! 💎</span><br>` +
                `<span class="msg-line-3"><span class="msg-rank-highlight">TOP ${currentPlayerRank}</span> com selo <span class="msg-caesb-highlight">CAESB</span> de aprovação!</span>`;
        }
        deps.uiShowTop3CongratsModal();
    }

    if (deps.resultSummaryDetailsEl) deps.resultSummaryDetailsEl.innerHTML = `<p>Seu Desempenho: <strong>${score}/${currentQuizQuestions.length > 0 ? currentQuizQuestions.length : settingsInternal.numberOfQuestions}</strong> acertos</p><p>Tempo: <strong>${deps.formatTime(totalSeconds)}</strong></p><p>Ranking: <strong>${currentPlayerRank > 0 ? currentPlayerRank + 'º lugar' : 'N/A'}</strong></p>`;
    
    const texts = quizCustomizationsInternal.texts || DEFAULT_CUSTOMIZATIONS.texts;
    if (deps.resultPrizeMessageEl) {
        if (score >= settingsInternal.minScoreForPrize) {
            deps.resultPrizeMessageEl.textContent = texts.resultScreenPrizeWon || DEFAULT_CUSTOMIZATIONS.texts.resultScreenPrizeWon;
            deps.resultPrizeMessageEl.className = 'result-message prize-won';
        } else {
            deps.resultPrizeMessageEl.textContent = texts.resultScreenPrizeNotWon || DEFAULT_CUSTOMIZATIONS.texts.resultScreenPrizeNotWon;
            deps.resultPrizeMessageEl.className = 'result-message prize-not-won';
        }
        deps.resultPrizeMessageEl.classList.remove('hidden');
    }

    if (deps.showIncorrectAnswersBtnRef) {
        const incorrectAttempts = playerAttempts.filter(attempt => !attempt.isCorrect);
        deps.showIncorrectAnswersBtnRef.classList.toggle('hidden', incorrectAttempts.length === 0);

        if (incorrectAttempts.length === 0 && deps.resultAllCorrectMessageEl) {
            deps.resultAllCorrectMessageEl.textContent = texts.resultScreenAllCorrect || DEFAULT_CUSTOMIZATIONS.texts.resultScreenAllCorrect; // Usa o texto de customizações
            deps.resultAllCorrectMessageEl.classList.remove('hidden');
        }
    }

    if (deps.giveUpBtn) deps.giveUpBtn.classList.add('hidden');
    deps.uiShowScreen('result-screen');
}

export function handleGiveUp() {
    deps.showConfirm(
        'Tem certeza que deseja desistir do quiz? Seu progresso atual não será salvo.',
        {
            onDiscardAndProceed: () => {
                clearInterval(questionTimerInterval);
                questionTimerInterval = null;
                clearInterval(flashInterval);
                flashInterval = null;
                if (timeBarAnimationId) {
                    cancelAnimationFrame(timeBarAnimationId);
                    timeBarAnimationId = null;
                }
                if (deps.questionTimeBarContainerEl) deps.questionTimeBarContainerEl.classList.add('hidden');
                if (deps.timeOutMessageEl) deps.timeOutMessageEl.classList.add('hidden');
                if (deps.postQuestionControlsEl) deps.postQuestionControlsEl.classList.add('hidden');
                if (deps.optionsContainer) deps.optionsContainer.classList.remove('options-really-dimmed');

                if (deps.quizContainer) {
                    deps.quizContainer.classList.remove('time-alert-border-pulse-warning');
                    deps.quizContainer.classList.remove('time-alert-border-pulse-critical');
                    deps.quizContainer.classList.remove('time-alert-flash-effect');
                }
                if (settingsInternal.giveUpLockoutMinutes > 0 && playerPhone) {
                    removeGiveUpLockoutByPhone(playerPhone); // Remove qualquer bloqueio anterior para este telefone
                    addGiveUpLockout({ phone: playerPhone, timestamp: new Date().toISOString() }); // Adiciona o novo bloqueio
                }
                if (deps.nomeInput) deps.nomeInput.value = '';
                if (deps.telefoneInput) deps.telefoneInput.value = '';
                deps.uiShowScreen('initial-screen');
            }
        },
        'danger', // Alterado de 'warning' para 'danger'
        { discardButtonText: "Sair" } // Adicionado para customizar o texto do botão
    );
}

export function loadRanking() {
    if (!deps.rankingListEl) return;
    deps.rankingListEl.innerHTML = '';
    
    const currentSettings = deps.getFromLocalStorage('quizSettings', DEFAULT_SETTINGS); // Pega settings atualizadas
    const displayCount = currentSettings.rankingDisplayCount || DEFAULT_SETTINGS.rankingDisplayCount;
    
    participantsInternal = deps.getFromLocalStorage('quizParticipants', []);
    const sorted = participantsInternal.sort((a, b) => b.score - a.score || a.time - b.time).slice(0, displayCount);

    if (sorted.length === 0) { deps.rankingListEl.innerHTML = '<li>Nenhum participante no ranking ainda.</li>'; return; }
    sorted.forEach((p, i) => {
        const li = document.createElement('li');
        li.innerHTML = `<span>${i + 1}. <span class="rank-name">${p.name}</span></span>
                        <span class="rank-score">${p.score} Acertos</span>
                        <span class="rank-time">${deps.formatTime(p.time)}</span>`;
        deps.rankingListEl.appendChild(li);
    });
}

export function displayIncorrectAnswers() {
    if (!deps.incorrectAnswersListEl) return;
    deps.incorrectAnswersListEl.innerHTML = '';
    const incorrectAttempts = playerAttempts.filter(attempt => !attempt.isCorrect);
    if (incorrectAttempts.length > 0) {
        incorrectAttempts.forEach(attempt => {
            const itemDiv = document.createElement('div');
            itemDiv.classList.add('question-review-item');
            const questionTitle = document.createElement('h4');
            questionTitle.textContent = attempt.questionText;
            itemDiv.appendChild(questionTitle);
            const userAnswerP = document.createElement('p');
            userAnswerP.classList.add('user-answer');
            userAnswerP.innerHTML = `<span class="review-label">Sua resposta: </span><span class="review-value-user">${attempt.selectedOptionText}</span>`;
            itemDiv.appendChild(userAnswerP);
            const correctAnswerP = document.createElement('p');
            correctAnswerP.classList.add('correct-answer-review');
            correctAnswerP.innerHTML = `<span class="review-label">Resposta correta: </span><span class="review-value-correct">${attempt.correctOptionText}</span>`;
            itemDiv.appendChild(correctAnswerP);
            deps.incorrectAnswersListEl.appendChild(itemDiv);
        });
        deps.uiShowIncorrectAnswersModal();
    } else {
        const itemDiv = document.createElement('div');
        itemDiv.classList.add('question-review-item', 'all-correct-feedback');
        const allCorrectP = document.createElement('p');
        const texts = quizCustomizationsInternal.texts || DEFAULT_CUSTOMIZATIONS.texts;
        allCorrectP.textContent = texts.modalAllCorrectMessage || DEFAULT_CUSTOMIZATIONS.texts.modalAllCorrectMessage; // Usa o texto de customizações
        itemDiv.appendChild(allCorrectP);
        deps.incorrectAnswersListEl.appendChild(itemDiv);
        deps.uiShowIncorrectAnswersModal();
    }
}

export function handleNextQuestionButtonClick() {
    // console.log('[QuizEngine] handleNextQuestionButtonClick: currentQuestionIndex =', currentQuestionIndex, 'totalQuestions =', currentQuizQuestions.length);
    // Esta função é chamada quando o botão #nextQuestionBtn é clicado em main.js.
    // Determina se avança para a próxima questão ou finaliza o quiz.
    // A lógica de texto do botão (Próxima/Finalizar) já foi tratada em handleOptionSelect/handleQuestionTimeout.

    if (currentQuestionIndex < currentQuizQuestions.length - 1) {
        // console.log('[QuizEngine] Avançando para a próxima pergunta. Novo index:', currentQuestionIndex + 1);
        currentQuestionIndex++;
        loadQuestion();
    } else {
        // console.log('[QuizEngine] Última pergunta. Chamando endQuiz() diretamente.');
        endQuiz(); // É a última pergunta, então finaliza o quiz
    }
    // resetIdleTimerFromHandler() será chamado no listener em main.js após esta função.
}