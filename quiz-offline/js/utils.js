// js/utils.js
import { DEFAULT_SETTINGS, DEFAULT_CUSTOMIZATIONS, QUIZ_CUSTOMIZATIONS_KEY } from './constants.js';

export const getFromLocalStorage = (key, defaultValue = null) => { // DefaultValue alterado para null para maior clareza
    const stored = localStorage.getItem(key);
    if (stored === null) {
        return defaultValue;
    }
    try {
        const parsed = JSON.parse(stored);
        return parsed;
    } catch (e) {
        console.error(`LS Get Error (parsing ${key}):`, e, "Stored value:", stored);
        return defaultValue; // Retorna defaultValue em caso de erro de parse
    }
};

export const saveToLocalStorage = (key, data) => {
    try { localStorage.setItem(key, JSON.stringify(data)); }
    catch (e) { console.error(`LS Save Error (${key}):`, e); }
};

// As funções showAlert e showConfirm dependem de resetIdleTimer,
// que estará em idleHandler.js. Por enquanto, vamos deixar um placeholder
// ou remover a chamada a resetIdleTimer temporariamente.
// Para simplificar esta etapa, vou remover a chamada a resetIdleTimer.
// Ela será reintegrada quando idleHandler.js for criado e importado.

export function showAlert(message, type = 'default') {
    const modal = document.getElementById('alert-modal');
    const msgEl = document.getElementById('alert-message');
    const okBtn = document.getElementById('alert-ok-btn');
    if (!modal || !msgEl || !okBtn) { console.error("Alert modal elements not found."); alert(message); return; }
    modal.classList.remove('modal-type-warning');
    if (type === 'warning') modal.classList.add('modal-type-warning');
    msgEl.textContent = message;
    modal.classList.remove('hidden');
    const cleanup = () => {
        modal.classList.add('hidden');
        modal.classList.remove('modal-type-warning');
        okBtn.removeEventListener('click', handler);
        modal.removeEventListener('click', onOverlayClick);
    };
    const handler = () => { cleanup(); /* resetIdleTimer(); */ };
    const onOverlayClick = (event) => { if (event.target === modal) { cleanup(); /* resetIdleTimer(); */ } };
    okBtn.addEventListener('click', handler);
    modal.addEventListener('click', onOverlayClick);
}

export function showConfirm(message, callbacks = {}, type = 'default', options = {}) {
    const modal = document.getElementById('confirm-modal');
    const msgEl = document.getElementById('confirm-message');
    const titleEl = document.getElementById('confirm-modal-title');
    const saveProceedBtn = document.getElementById('confirm-save-proceed-btn');
    const discardProceedBtn = document.getElementById('confirm-proceed-btn');
    const cancelBtn = document.getElementById('confirm-cancel-btn');

    if (!modal || !msgEl || !saveProceedBtn || !discardProceedBtn || !cancelBtn || !titleEl) {
        console.error("Confirm modal elements not found.");
        // Fallback para o confirm nativo se os elementos do modal não forem encontrados
        if (confirm(message)) {
            if (typeof callbacks.onSaveAndProceed === 'function') callbacks.onSaveAndProceed();
            else if (typeof callbacks.onDiscardAndProceed === 'function') callbacks.onDiscardAndProceed();
        } else {
            if (typeof callbacks.onCancel === 'function') callbacks.onCancel();
        }
        return;
    }

    titleEl.textContent = options.title || "Confirmação";
    msgEl.textContent = message;

    if (options.showSaveButton) {
        saveProceedBtn.classList.remove('hidden');
        saveProceedBtn.textContent = options.saveButtonText || "Salvar e Sair";
    } else {
        saveProceedBtn.classList.add('hidden');
    }

    discardProceedBtn.textContent = options.discardButtonText || "Sair sem Salvar";
    cancelBtn.textContent = options.cancelButtonText || "Cancelar";

    modal.classList.remove('modal-type-danger', 'modal-type-warning');
    if (type === 'danger') {
        modal.classList.add('modal-type-danger');
        discardProceedBtn.classList.remove('btn-success'); // Garante que não tenha classes conflitantes
        discardProceedBtn.classList.add('btn-danger');
    } else if (type === 'warning') {
        modal.classList.add('modal-type-warning');
        discardProceedBtn.classList.remove('btn-danger'); // Garante que não tenha classes conflitantes
        discardProceedBtn.classList.add('btn-success'); // Ou outra classe apropriada para warning
    } else { // default
        discardProceedBtn.classList.remove('btn-danger');
        discardProceedBtn.classList.add('btn-success');
    }

    modal.classList.remove('hidden');

    const cleanup = () => {
        modal.classList.add('hidden');
        saveProceedBtn.removeEventListener('click', onSave);
        discardProceedBtn.removeEventListener('click', onDiscard);
        cancelBtn.removeEventListener('click', onCancelClick);
        modal.removeEventListener('click', onOverlayClick);
        /* resetIdleTimer(); */ // Manter comentado por enquanto
    };

    const onSave = () => { cleanup(); if (typeof callbacks.onSaveAndProceed === 'function') callbacks.onSaveAndProceed(); };
    const onDiscard = () => { cleanup(); if (typeof callbacks.onDiscardAndProceed === 'function') callbacks.onDiscardAndProceed(); };
    const onCancelClick = () => { cleanup(); if (typeof callbacks.onCancel === 'function') callbacks.onCancel(); };
    const onOverlayClick = (event) => { if (event.target === modal) { onCancelClick(); } };

    saveProceedBtn.addEventListener('click', onSave);
    discardProceedBtn.addEventListener('click', onDiscard);
    cancelBtn.addEventListener('click', onCancelClick);
    modal.addEventListener('click', onOverlayClick);
}

export const shuffleArray = (arr) => arr.sort(() => Math.random() - 0.5);

export const formatTime = (s) => {
    if (isNaN(s) || s < 0) return "00:00";
    return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
};
export const formatDateToISO = (date) => {
    if (!(date instanceof Date) || isNaN(date)) {
        // Retorna uma string vazia ou null, ou lança um erro se a data for inválida
        // Para este caso, vamos retornar o formato ISO do dia atual como fallback ou um log de erro
        console.warn("formatDateToISO recebeu data inválida, usando data atual:", date);
        date = new Date(); // Ou poderia retornar null/string vazia dependendo do tratamento de erro desejado
    }
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0'); // Meses são 0-indexados
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
};
// Constantes para as chaves do localStorage (idealmente viriam de constants.js)
const PRIZE_WINNERS_LIST_KEY = 'quizPrizeWinnersData';
const GIVE_UP_LOCKOUT_LIST_KEY = 'quizGiveUpLockoutData';

// Funções para gerenciar a lista de ganhadores de brindes
export const getPrizeWinners = () => {
    return getFromLocalStorage(PRIZE_WINNERS_LIST_KEY, []);
};

export const savePrizeWinners = (list) => {
    saveToLocalStorage(PRIZE_WINNERS_LIST_KEY, list);
};

export const addPrizeWinner = (winnerData) => {
    const winners = getPrizeWinners();
    // Poderia adicionar uma verificação para não duplicar por telefone, se necessário.
    // Por enquanto, apenas adiciona.
    winners.push(winnerData);
    savePrizeWinners(winners);
};

export const removePrizeWinnerByPhone = (phone) => {
    let winners = getPrizeWinners();
    winners = winners.filter(winner => winner.phone !== phone);
    savePrizeWinners(winners);
};

export const clearAllPrizeWinners = () => {
    savePrizeWinners([]);
};

// Funções para gerenciar a lista de bloqueio por desistência
export const getGiveUpLockoutList = () => {
    return getFromLocalStorage(GIVE_UP_LOCKOUT_LIST_KEY, []);
};

export const saveGiveUpLockoutList = (list) => {
    saveToLocalStorage(GIVE_UP_LOCKOUT_LIST_KEY, list);
};

export const addGiveUpLockout = (lockoutData) => {
    const lockouts = getGiveUpLockoutList();
    // Poderia adicionar uma verificação para não duplicar por telefone.
    lockouts.push(lockoutData);
    saveGiveUpLockoutList(lockouts);
};

export const removeGiveUpLockoutByPhone = (phone) => {
    let lockouts = getGiveUpLockoutList();
    lockouts = lockouts.filter(lockout => lockout.phone !== phone);
    saveGiveUpLockoutList(lockouts);
};

export const clearAllGiveUpLockouts = () => {
    saveGiveUpLockoutList([]);
};
// Função Debounce
export function debounce(func, delay) {
    let timeout;
    return function(...args) {
        const context = this;
        clearTimeout(timeout);
        timeout = setTimeout(() => func.apply(context, args), delay);
    };
}