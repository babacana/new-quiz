// admin/eventAdmin.js
import { getFromLocalStorage, saveToLocalStorage, showAlert, showConfirm } from '../js/utils.js';
import { displayStatusMessage } from './uiAdmin.js';

const QUIZ_EVENT_KEY = 'quizCurrentEvent';

// Referências DOM (serão inicializadas em initializeEventScreen)
let eventNameInput, eventStartTimeInput, eventEndTimeInput,
    eventEnableMessageCheckbox, saveEventBtn, clearEventBtn,
    eventConfigStatusMessageEl, currentEventDisplayEl;

// Callbacks e referências de estado de admin.js
let localCurrentEventAdminDataRef;
let localIsEventDirtyRef;
let localInitialEventDataRef;
let localResetDirtyFlagAndCaptureState;
// localCheckDirtyState não é explicitamente usado aqui, mas o padrão é o mesmo

function _getEventFormDataFromDOM() {
    return JSON.stringify({
        eventName: eventNameInput.value,
        startTime: eventStartTimeInput.value,
        endTime: eventEndTimeInput.value,
        enableMessage: eventEnableMessageCheckbox.checked
    });
}

function _loadCurrentEventToUI() {
    const currentEventData = getFromLocalStorage(QUIZ_EVENT_KEY, null);
    localCurrentEventAdminDataRef.value = currentEventData; // Atualiza a referência em admin.js

    if (currentEventData) {
        if (eventNameInput) eventNameInput.value = currentEventData.eventName || '';
        if (eventStartTimeInput) eventStartTimeInput.value = currentEventData.startTime || '';
        if (eventEndTimeInput) eventEndTimeInput.value = currentEventData.endTime || '';
        if (eventEnableMessageCheckbox) eventEnableMessageCheckbox.checked = typeof currentEventData.enableOutOfPeriodMessage === 'boolean' ? currentEventData.enableOutOfPeriodMessage : true;
        if (currentEventDisplayEl) {
            currentEventDisplayEl.innerHTML = `
                <p><strong>Nome:</strong> ${currentEventData.eventName || '<em>Não definido</em>'}</p>
                <p><strong>Início:</strong> ${currentEventData.startTime ? new Date(currentEventData.startTime).toLocaleString('pt-BR') : '<em>Não definido</em>'}</p>
                <p><strong>Fim:</strong> ${currentEventData.endTime ? new Date(currentEventData.endTime).toLocaleString('pt-BR') : '<em>Não definido</em>'}</p>
                <p><strong>Mensagens de Período Ativas:</strong> ${currentEventData.enableOutOfPeriodMessage ? 'Sim' : 'Não'}</p>
            `;
        }
    } else {
        if (eventNameInput) eventNameInput.value = '';
        if (eventStartTimeInput) eventStartTimeInput.value = '';
        if (eventEndTimeInput) eventEndTimeInput.value = '';
        if (eventEnableMessageCheckbox) eventEnableMessageCheckbox.checked = false;
        if (currentEventDisplayEl) currentEventDisplayEl.innerHTML = '<p>Nenhum evento configurado.</p>';
    }
    localInitialEventDataRef.value = _getEventFormDataFromDOM();
    localIsEventDirtyRef.value = false;
}

function _saveCurrentEventHandler(isNavigating = false) {
    const eventName = eventNameInput.value.trim();
    const startTime = eventStartTimeInput.value;
    const endTime = eventEndTimeInput.value;
    const enableMessage = eventEnableMessageCheckbox.checked;

    if (!startTime || !endTime) {
        showAlert('As datas de início e fim do evento são obrigatórias.', 'warning');
        if (eventConfigStatusMessageEl) displayStatusMessage(eventConfigStatusMessageEl, 'Datas de início e fim são obrigatórias.', 'error', 0);
        return false;
    }
    if (new Date(endTime) <= new Date(startTime)) {
        showAlert('A data de fim deve ser posterior à data de início.', 'warning');
        if (eventConfigStatusMessageEl) displayStatusMessage(eventConfigStatusMessageEl, 'Data de fim deve ser posterior à de início.', 'error', 0);
        return false;
    }

    const eventData = { eventName, startTime, endTime, enableOutOfPeriodMessage: enableMessage };
    saveToLocalStorage(QUIZ_EVENT_KEY, eventData);
    localCurrentEventAdminDataRef.value = eventData; // Atualiza a referência
    localResetDirtyFlagAndCaptureState('event', _getEventFormDataFromDOM());
    _loadCurrentEventToUI(); // Recarrega a UI com os dados salvos

    if (!isNavigating) {
        displayStatusMessage(eventConfigStatusMessageEl, 'Evento salvo com sucesso!', 'success');
    }
    return true;
}

function _clearCurrentEvent() {
    showConfirm('Tem certeza que deseja limpar e desativar o evento atual? O quiz voltará a funcionar sem restrições de período.', {
        onDiscardAndProceed: () => {
            localStorage.removeItem(QUIZ_EVENT_KEY);
            localCurrentEventAdminDataRef.value = null; // Atualiza a referência
            localResetDirtyFlagAndCaptureState('event', _getEventFormDataFromDOM()); // Captura o estado limpo
            _loadCurrentEventToUI(); // Recarrega a UI
            displayStatusMessage(eventConfigStatusMessageEl, 'Evento limpo/desativado.', 'info');
        }
    }, 'warning', { discardButtonText: "Sim, Limpar" });
}


export function initializeEventScreen(dependencies) {
    localCurrentEventAdminDataRef = dependencies.currentEventAdminDataRef;
    localIsEventDirtyRef = dependencies.isEventDirtyRef;
    localInitialEventDataRef = dependencies.initialEventDataRef;
    localResetDirtyFlagAndCaptureState = dependencies.resetDirtyFlagAndCaptureStateCallback;

    eventNameInput = document.getElementById('event-name-input');
    eventStartTimeInput = document.getElementById('event-start-time-input');
    eventEndTimeInput = document.getElementById('event-end-time-input');
    eventEnableMessageCheckbox = document.getElementById('event-enable-message-checkbox');
    saveEventBtn = document.getElementById('save-event-btn');
    clearEventBtn = document.getElementById('clear-event-btn');
    eventConfigStatusMessageEl = document.getElementById('event-config-status-message');
    currentEventDisplayEl = document.getElementById('current-event-display');

    if (saveEventBtn) saveEventBtn.addEventListener('click', () => _saveCurrentEventHandler(false));
    if (clearEventBtn) clearEventBtn.addEventListener('click', _clearCurrentEvent);

    _loadCurrentEventToUI();
    // O estado inicial e dirty flag são definidos dentro de _loadCurrentEventToUI

    if (eventConfigStatusMessageEl) eventConfigStatusMessageEl.textContent = ''; // Limpa mensagem ao carregar

    return {
        save: _saveCurrentEventHandler,
        reset: () => {
            _loadCurrentEventToUI(); // Recarrega e reseta dirty state
        },
        getEventFormData: _getEventFormDataFromDOM
    };
}