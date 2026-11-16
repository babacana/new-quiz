// js/eventLogic.js
import { QUIZ_EVENT_KEY, DEFAULT_CUSTOMIZATIONS } from './constants.js';
// getFromLocalStorage será injetado ou importado se utils.js for refatorado para não ter dependências de UI.
// Por enquanto, vamos assumir que será injetado.

let getFromLocalStorageCallback;
let idleCallToActionElRef, eventStatusMessageElRef, startQuizBtnRef, viewRankingInitialBtnRef;
let getCurrentEventDataCallback; // Para obter currentEventData de main.js
let getQuizCustomizationsCallback; // Para obter quizCustomizations de ui.js ou main.js

/**
 * Inicializa o módulo de lógica de eventos com as dependências necessárias.
 */
export function initEventLogic(dependencies) {
    getFromLocalStorageCallback = dependencies.getFromLocalStorage;
    idleCallToActionElRef = dependencies.idleCallToActionEl;
    eventStatusMessageElRef = dependencies.eventStatusMessageEl;
    startQuizBtnRef = dependencies.startQuizBtn;
    viewRankingInitialBtnRef = dependencies.viewRankingInitialBtn;
    getCurrentEventDataCallback = dependencies.getCurrentEventData;
    getQuizCustomizationsCallback = dependencies.getQuizCustomizations; // Adicionado
}

export function checkEventStatus() {
    const currentEventData = getCurrentEventDataCallback ? getCurrentEventDataCallback() : getFromLocalStorageCallback(QUIZ_EVENT_KEY, null);
    if (!currentEventData || !currentEventData.startTime || !currentEventData.endTime) {
        return 'no_event';
    }
    const now = new Date();
    const startTime = new Date(currentEventData.startTime);
    const endTime = new Date(currentEventData.endTime);

    if (isNaN(startTime.getTime()) || isNaN(endTime.getTime())) {
        console.warn("EventLogic: Datas do evento inválidas:", currentEventData);
        return 'no_event';
    }

    if (now < startTime) return 'before';
    else if (now > endTime) return 'after';
    else return 'during';
}

export function updateIdleScreenMessage() {
    if (!idleCallToActionElRef) return;

    const currentEventData = getCurrentEventDataCallback ? getCurrentEventDataCallback() : getFromLocalStorageCallback(QUIZ_EVENT_KEY, null);
    const quizCustomizations = getQuizCustomizationsCallback ? getQuizCustomizationsCallback() : DEFAULT_CUSTOMIZATIONS;


    const eventStatus = checkEventStatus(); // Usa a currentEventData obtida acima
    const eventMessageActive = currentEventData && typeof currentEventData.enableOutOfPeriodMessage === 'boolean' ? currentEventData.enableOutOfPeriodMessage : true; // Default true se não definido
    const callToActionText = (quizCustomizations.texts && quizCustomizations.texts.idleScreenCallToAction) || DEFAULT_CUSTOMIZATIONS.texts.idleScreenCallToAction;

    if (eventMessageActive) {
        if (eventStatus === 'before' && currentEventData) {
            idleCallToActionElRef.innerHTML = `QUIZ EM BREVE!<br><small>Toque para mais informações</small>`;
        } else if (eventStatus === 'after' && currentEventData) {
            idleCallToActionElRef.innerHTML = `QUIZ ENCERRADO<br><small>Obrigado por participar!</small>`;
        } else {
            idleCallToActionElRef.textContent = callToActionText;
        }
    } else {
        idleCallToActionElRef.textContent = callToActionText;
    }
}

export function updateInitialScreenForEventState() {
    if (!eventStatusMessageElRef || !startQuizBtnRef || !viewRankingInitialBtnRef) return;

    const currentEventData = getCurrentEventDataCallback ? getCurrentEventDataCallback() : getFromLocalStorageCallback(QUIZ_EVENT_KEY, null);
    const eventStatus = checkEventStatus(); // Usa a currentEventData obtida acima
    const eventMessageActive = currentEventData && typeof currentEventData.enableOutOfPeriodMessage === 'boolean' ? currentEventData.enableOutOfPeriodMessage : true;

    eventStatusMessageElRef.classList.add('hidden');
    eventStatusMessageElRef.textContent = '';
    startQuizBtnRef.disabled = false;
    viewRankingInitialBtnRef.disabled = false;
    startQuizBtnRef.classList.remove('hidden'); // Garante que o botão esteja visível por padrão

    if (eventMessageActive && currentEventData) {
        if (eventStatus === 'before') {
            startQuizBtnRef.disabled = true;
            eventStatusMessageElRef.textContent = `O quiz "${currentEventData.eventName || 'especial'}" ainda não começou! Prepare-se, a diversão começa em ${new Date(currentEventData.startTime).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })}.`;
            eventStatusMessageElRef.classList.remove('hidden');
        } else if (eventStatus === 'after') {
            startQuizBtnRef.disabled = true;
            // Oculta o botão de iniciar em vez de apenas desabilitar, para consistência com o estado "before"
            startQuizBtnRef.classList.add('hidden');
            eventStatusMessageElRef.textContent = `O quiz "${currentEventData.eventName || 'especial'}" foi encerrado em ${new Date(currentEventData.endTime).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })}. Obrigado pela participação!`;
            eventStatusMessageElRef.classList.remove('hidden');
        }
    }
}