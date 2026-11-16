// js/idleHandler.js
import { DEFAULT_SETTINGS } from './constants.js'; // Apenas para DEFAULT_SETTINGS.idleTimeoutSeconds, etc.

let fadeOutTimer = null;
let actualIdleTimer = null;
let isFadingToIdle = false;

// Dependências que serão injetadas via initIdleHandler
let quizContainerRef;
let showScreenCallback;
let getSettingsCallback; // Função para obter as configurações atuais

/**
 * Inicializa o manipulador de ociosidade com as dependências necessárias.
 * @param {object} dependencies - Um objeto contendo referências e callbacks.
 * @param {HTMLElement} dependencies.quizContainer - Referência ao elemento .quiz-container.
 * @param {function} dependencies.showScreen - Callback para a função uiShowScreen.
 * @param {function} dependencies.getSettings - Callback para uma função que retorna o objeto de configurações atual.
 */
export function initIdleHandler(dependencies) {
    quizContainerRef = dependencies.quizContainer;
    showScreenCallback = dependencies.showScreen;
    getSettingsCallback = dependencies.getSettings;
}

function startFadeOut() {
    if (quizContainerRef && !isFadingToIdle) {
        const activeScreenId = document.querySelector('.screen.active')?.id; // Ainda precisa verificar a tela ativa
        if (activeScreenId !== 'idle-screen') {
            console.log("IdleHandler: Iniciando esmaecimento...");
            quizContainerRef.classList.add('fading-to-idle');
            isFadingToIdle = true;
        }
    }
}

export function resetIdleTimer() {
    if (!getSettingsCallback || !quizContainerRef || !showScreenCallback) {
        // console.warn("IdleHandler: Dependências não inicializadas. resetIdleTimer abortado.");
        return;
    }

    const activeScreenId = document.querySelector('.screen.active')?.id;
    if (activeScreenId === 'idle-screen') {
        return;
    }

    clearTimeout(fadeOutTimer);
    clearTimeout(actualIdleTimer);

    if (quizContainerRef && isFadingToIdle) {
        quizContainerRef.classList.remove('fading-to-idle');
    }
    isFadingToIdle = false;

    const currentSettings = getSettingsCallback() || {};
    const defaultIdle = DEFAULT_SETTINGS.idleTimeoutSeconds;
    const defaultFade = DEFAULT_SETTINGS.fadeOutLeadTimeSeconds;

    const currentIdleTimeoutSeconds = parseInt(currentSettings.idleTimeoutSeconds, 10) || defaultIdle;
    let currentFadeOutLeadSeconds = parseInt(currentSettings.fadeOutLeadTimeSeconds, 10) || defaultFade;

    if (currentFadeOutLeadSeconds >= currentIdleTimeoutSeconds && currentIdleTimeoutSeconds > defaultFade) {
        currentFadeOutLeadSeconds = defaultFade; // Usa o default se o valor configurado for problemático
    } else if (currentFadeOutLeadSeconds >= currentIdleTimeoutSeconds) {
         // Se o timeout de idle for muito baixo, ajusta o fade para ser menor ainda
        currentFadeOutLeadSeconds = Math.max(1, Math.floor(currentIdleTimeoutSeconds / 2));
    }


    const totalIdleMs = currentIdleTimeoutSeconds * 1000;
    const fadeOutLeadMs = currentFadeOutLeadSeconds * 1000;
    const fadeOutStartTimeMs = totalIdleMs - fadeOutLeadMs;

    if (fadeOutStartTimeMs > 0 && totalIdleMs > fadeOutLeadMs) { // Garante que fadeOut não comece antes ou no mesmo tempo
        fadeOutTimer = setTimeout(startFadeOut, fadeOutStartTimeMs);
    } else if (totalIdleMs > 0) { // Se o tempo de fade for maior ou igual ao idle, fade imediatamente
        startFadeOut();
    }

    if (totalIdleMs > 0) {
        actualIdleTimer = setTimeout(() => {
            if (quizContainerRef) {
                 quizContainerRef.classList.remove('fading-to-idle');
                 quizContainerRef.classList.remove('time-alert-border-pulse-warning');
                 quizContainerRef.classList.remove('time-alert-border-pulse-critical');
                 quizContainerRef.classList.remove('time-alert-flash-effect');
            }
            isFadingToIdle = false;
            showScreenCallback('idle-screen');
        }, totalIdleMs);
    } else {
        console.warn("IdleHandler: Tempo total de inatividade é zero ou negativo. Não foi possível agendar a tela de descanso.");
    }
}

// Função para ser chamada por utils.js (showAlert, showConfirm)
// Esta é uma forma de permitir que outros módulos reiniciem o timer sem criar dependências circulares diretas.
// No entanto, a melhor abordagem é que showAlert/showConfirm não chamem resetIdleTimer diretamente.
// Em vez disso, os manipuladores de eventos que chamam showAlert/showConfirm devem chamar resetIdleTimer.
// Por ora, manteremos esta função, mas ela pode ser removida se a lógica de chamada for ajustada.
export function globalResetIdleTimer() {
    resetIdleTimer();
}