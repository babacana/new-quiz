// admin/settingsAdmin.js
import { DEFAULT_SETTINGS } from '../js/constants.js';
import { getFromLocalStorage, saveToLocalStorage, showAlert, showConfirm, clearAllPrizeWinners, clearAllGiveUpLockouts } from '../js/utils.js';
import { displayStatusMessage, applyCustomLogo, applyCustomBackground, loadCustomLogo as uiLoadCustomLogo } from './uiAdmin.js'; // Renomeando loadCustomLogo para evitar conflito

const CUSTOM_LOGO_FILENAME_KEY = 'quizCustomLogoFileName'; // Usado localmente

// Referências aos elementos do DOM da tela de configurações
// Essas variáveis serão inicializadas dentro de initializeSettingsScreen
let numberOfQuestionsInput, timePerQuestionInput, idleTimeoutSecondsInput, fadeOutLeadTimeSecondsInput,
    devModeToggleCheckbox, difficultyPercentageFacilInput, difficultyPercentageModeradoInput,
    difficultyPercentageDificilInput, difficultyPercentageSumErrorEl, virtualKeyboardHeightInput,
    enableVirtualKeyboardToggleCheckbox, enableTimeAlertBorderPulseToggle, enableTimeAlertFlashToggle,
    minScorePrizeInput, showCorrectAnswerCheckbox, rankingDisplayCountInput, enablePrizeLockCheckbox,
    clearPrizeWinnersBtn, giveUpLockoutMinutesInput, clearGiveUpLockoutBtn, logoFilenameInput,
    logoPreviewImg, restoreDefaultLogoBtn, logoStatusMessageEl, backgroundFilenameInput,
    enableCustomBackgroundCheckbox, saveSettingsBtn, settingsStatusMessageEl, resetSettingButtons;

// Variáveis de estado que serão passadas e gerenciadas pelo módulo principal (admin.js)
// let settings = {}; // Será passado via dependências
// let devModeActive = false; // Será passado via dependências
// let isSettingsDirty = false; // Será passado e modificado via callbacks
// let initialSettingsData = ''; // Será passado e modificado via callbacks

// Funções de callback que serão passadas de admin.js
let localResetDirtyFlagAndCaptureState;
let localCheckDirtyState;
let localApplyFiltersAndRenderParticipants; // Para atualizar a lista de participantes após limpar premiados

function _loadAdminSettingsToUI(currentSettings, currentDevModeActive) {
    if (numberOfQuestionsInput) numberOfQuestionsInput.value = currentSettings.numberOfQuestions;
    if (timePerQuestionInput) timePerQuestionInput.value = currentSettings.timePerQuestion;
    if (idleTimeoutSecondsInput) idleTimeoutSecondsInput.value = currentSettings.idleTimeoutSeconds;
    if (fadeOutLeadTimeSecondsInput) fadeOutLeadTimeSecondsInput.value = currentSettings.fadeOutLeadTimeSeconds;
    if (devModeToggleCheckbox) devModeToggleCheckbox.checked = currentDevModeActive;
    if (difficultyPercentageFacilInput) difficultyPercentageFacilInput.value = currentSettings.difficultyPercentages.facil;
    if (difficultyPercentageModeradoInput) difficultyPercentageModeradoInput.value = currentSettings.difficultyPercentages.moderado;
    if (difficultyPercentageDificilInput) difficultyPercentageDificilInput.value = currentSettings.difficultyPercentages.dificil;
    if (minScorePrizeInput) minScorePrizeInput.value = currentSettings.minScoreForPrize;
    if (showCorrectAnswerCheckbox) showCorrectAnswerCheckbox.checked = currentSettings.showCorrectAnswerOnWrong;
    if (rankingDisplayCountInput) rankingDisplayCountInput.value = currentSettings.rankingDisplayCount;
    if (enablePrizeLockCheckbox) enablePrizeLockCheckbox.checked = currentSettings.enablePrizeLock;
    if (backgroundFilenameInput) backgroundFilenameInput.value = currentSettings.customBackgroundFileName;
    if (enableCustomBackgroundCheckbox) enableCustomBackgroundCheckbox.checked = currentSettings.enableCustomBackground;
    if (giveUpLockoutMinutesInput) giveUpLockoutMinutesInput.value = currentSettings.giveUpLockoutMinutes;
    
    const customLogoFileName = localStorage.getItem(CUSTOM_LOGO_FILENAME_KEY);
    if (logoFilenameInput) logoFilenameInput.value = customLogoFileName || '';
    applyCustomLogo(customLogoFileName); // Função de uiAdmin

    if (virtualKeyboardHeightInput) virtualKeyboardHeightInput.value = currentSettings.virtualKeyboardHeight;
    if (enableVirtualKeyboardToggleCheckbox) enableVirtualKeyboardToggleCheckbox.checked = currentSettings.enableVirtualKeyboard;
    if (enableTimeAlertBorderPulseToggle) enableTimeAlertBorderPulseToggle.checked = currentSettings.enableTimeAlertBorderPulse;
    if (enableTimeAlertFlashToggle) enableTimeAlertFlashToggle.checked = currentSettings.enableTimeAlertFlash;
}

function _getSettingsFormDataFromDOM() { // Renomeado para evitar conflito e indicar que lê do DOM
    return JSON.stringify({
        numberOfQuestions: numberOfQuestionsInput.value,
        timePerQuestion: timePerQuestionInput.value,
        idleTimeoutSeconds: idleTimeoutSecondsInput.value,
        fadeOutLeadTimeSeconds: fadeOutLeadTimeSecondsInput.value,
        difficultyPercentages: {
            facil: difficultyPercentageFacilInput.value,
            moderado: difficultyPercentageModeradoInput.value,
            dificil: difficultyPercentageDificilInput.value
        },
        minScoreForPrize: minScorePrizeInput.value,
        showCorrectAnswerOnWrong: showCorrectAnswerCheckbox.checked,
        rankingDisplayCount: rankingDisplayCountInput.value,
        enablePrizeLock: enablePrizeLockCheckbox.checked,
        giveUpLockoutMinutes: giveUpLockoutMinutesInput.value,
        logoFilename: logoFilenameInput.value, // Já está no DOM
        customBackgroundFileName: backgroundFilenameInput.value,
        enableCustomBackground: enableCustomBackgroundCheckbox.checked,
        virtualKeyboardHeight: virtualKeyboardHeightInput.value,
        enableVirtualKeyboard: enableVirtualKeyboardToggleCheckbox.checked,
        enableTimeAlertBorderPulse: enableTimeAlertBorderPulseToggle.checked,
        enableTimeAlertFlash: enableTimeAlertFlashToggle.checked
    });
}


function _saveSettingsHandler(isNavigating = false, dependencies) {
    const { settingsRef, quizCustomizationsRef, checkDirtyState, resetDirtyFlagAndCaptureState } = dependencies;

    const numQuestionsVal = parseInt(numberOfQuestionsInput.value);
    const timePerQuestionVal = parseInt(timePerQuestionInput.value);
    const idleTimeoutVal = parseInt(idleTimeoutSecondsInput.value);
    const fadeOutLeadTimeVal = parseInt(fadeOutLeadTimeSecondsInput.value);
    const minScoreNum = parseInt(minScorePrizeInput.value);
    const rankCountNum = rankingDisplayCountInput.value.trim() !== '' ? parseInt(rankingDisplayCountInput.value) : DEFAULT_SETTINGS.rankingDisplayCount;
    const giveUpLockoutNum = parseInt(giveUpLockoutMinutesInput.value);
    const keyboardHeightVal = parseInt(virtualKeyboardHeightInput.value);
    const enableKeyboardVal = enableVirtualKeyboardToggleCheckbox.checked;
    const enableBorderPulseVal = enableTimeAlertBorderPulseToggle.checked;
    const enableFlashVal = enableTimeAlertFlashToggle.checked;

    const percFacil = parseInt(difficultyPercentageFacilInput.value);
    const percModerado = parseInt(difficultyPercentageModeradoInput.value);
    const percDificil = parseInt(difficultyPercentageDificilInput.value);

    if (isNaN(numQuestionsVal) || numQuestionsVal < 1 ||
        isNaN(timePerQuestionVal) || timePerQuestionVal < 5 || timePerQuestionVal > 120 ||
        isNaN(idleTimeoutVal) || idleTimeoutVal < 15 || idleTimeoutVal > 600 ||
        isNaN(fadeOutLeadTimeVal) || fadeOutLeadTimeVal < 3 || fadeOutLeadTimeVal > 30 ||
        isNaN(minScoreNum) || minScoreNum < 1 ||
        isNaN(rankCountNum) || rankCountNum < 1 ||
        isNaN(giveUpLockoutNum) || giveUpLockoutNum < 0 ||
        isNaN(keyboardHeightVal) || keyboardHeightVal < 20 || keyboardHeightVal > 60 ||
        isNaN(percFacil) || percFacil < 0 || percFacil > 100 ||
        isNaN(percModerado) || percModerado < 0 || percModerado > 100 ||
        isNaN(percDificil) || percDificil < 0 || percDificil > 100
    ) {
        showAlert('Verifique os valores numéricos nas configurações. São inválidos ou estão fora dos limites permitidos.', 'warning');
        return false;
    }
    if (fadeOutLeadTimeVal >= idleTimeoutVal) {
        showAlert('O tempo do aviso de esmaecimento deve ser menor que o tempo total para o modo descanso.', 'warning');
        return false;
    }
    if (minScoreNum > numQuestionsVal) {
        showAlert('A pontuação mínima para brinde não pode ser maior que o número de perguntas.', 'warning');
        return false;
    }
    if ((percFacil + percModerado + percDificil) !== 100) {
        if(difficultyPercentageSumErrorEl) difficultyPercentageSumErrorEl.classList.remove('hidden');
        showAlert('A soma dos percentuais de dificuldade deve ser 100%.', 'warning');
        return false;
    } else {
         if(difficultyPercentageSumErrorEl) difficultyPercentageSumErrorEl.classList.add('hidden');
    }

    const newSettings = {
        numberOfQuestions: numQuestionsVal,
        timePerQuestion: timePerQuestionVal,
        idleTimeoutSeconds: idleTimeoutVal,
        fadeOutLeadTimeSeconds: fadeOutLeadTimeVal,
        minScoreForPrize: minScoreNum,
        showCorrectAnswerOnWrong: showCorrectAnswerCheckbox.checked,
        rankingDisplayCount: rankCountNum,
        enablePrizeLock: enablePrizeLockCheckbox.checked,
        customBackgroundFileName: backgroundFilenameInput.value.trim(),
        enableCustomBackground: enableCustomBackgroundCheckbox.checked,
        giveUpLockoutMinutes: giveUpLockoutNum,
        difficultyPercentages: {
            facil: percFacil,
            moderado: percModerado,
            dificil: percDificil
        },
        virtualKeyboardHeight: keyboardHeightVal,
        enableVirtualKeyboard: enableKeyboardVal,
        enableTimeAlertBorderPulse: enableBorderPulseVal,
        enableTimeAlertFlash: enableFlashVal
    };
    
    // Atualiza a referência do objeto settings em admin.js
    Object.assign(settingsRef, newSettings);
    saveToLocalStorage('quizSettings', settingsRef);
    resetDirtyFlagAndCaptureState('settings', _getSettingsFormDataFromDOM());


    const filename = logoFilenameInput.value.trim();
    if (filename) {
        const tempImg = new Image();
        tempImg.src = `assets/${filename}`;
        tempImg.onload = () => {
            localStorage.setItem(CUSTOM_LOGO_FILENAME_KEY, filename);
            applyCustomLogo(filename);
            displayStatusMessage(logoStatusMessageEl, 'Logotipo salvo.', 'success');
        };
        tempImg.onerror = () => {
            displayStatusMessage(logoStatusMessageEl, `Erro: Logo '${filename}' não encontrado em 'assets/'.`, 'error');
        };
    } else {
        localStorage.removeItem(CUSTOM_LOGO_FILENAME_KEY);
        applyCustomLogo(null);
        displayStatusMessage(logoStatusMessageEl, 'Logotipo padrão restaurado.', 'info');
    }
    
    applyCustomBackground(settingsRef, quizCustomizationsRef); // Passa as referências atualizadas

    if(!isNavigating) {
        displayStatusMessage(settingsStatusMessageEl, 'Configurações salvas com sucesso!', 'success');
    }
    return true;
}

// _clearGiveUpLockoutData não é mais necessária, a lógica será inline no event listener
// ou em uma nova função de navegação se precisar ser reutilizada.


export function initializeSettingsScreen(dependencies) {
    // Desestrutura as dependências
    const {
        settingsRef, // Referência ao objeto settings de admin.js
        devModeActiveState, // Valor booleano
        quizCustomizationsRef, // Referência ao objeto quizCustomizations de admin.js
        getIsSettingsDirty, // Função para obter isSettingsDirty
        setIsSettingsDirty, // Função para definir isSettingsDirty
        getInitialSettingsData, // Função para obter initialSettingsData
        setInitialSettingsData, // Função para definir initialSettingsData
        resetDirtyFlagAndCaptureStateCallback, // Callback para resetar dirty flag em admin.js
        checkDirtyStateCallback, // Callback para checar dirty state em admin.js
        applyFiltersAndRenderParticipantsCallback, // Callback para atualizar relatórios
        showScreenFn // Função de navegação de admin.js
    } = dependencies;

    // Inicializa os seletores de DOM
    numberOfQuestionsInput = document.getElementById('number-of-questions');
    timePerQuestionInput = document.getElementById('time-per-question');
    idleTimeoutSecondsInput = document.getElementById('idle-timeout-seconds');
    fadeOutLeadTimeSecondsInput = document.getElementById('fade-out-lead-time-seconds');
    devModeToggleCheckbox = document.getElementById('dev-mode-toggle');
    difficultyPercentageFacilInput = document.getElementById('difficulty-percentage-facil');
    difficultyPercentageModeradoInput = document.getElementById('difficulty-percentage-moderado');
    difficultyPercentageDificilInput = document.getElementById('difficulty-percentage-dificil');
    difficultyPercentageSumErrorEl = document.getElementById('difficulty-percentage-sum-error');
    virtualKeyboardHeightInput = document.getElementById('virtual-keyboard-height');
    enableVirtualKeyboardToggleCheckbox = document.getElementById('enable-virtual-keyboard-toggle');
    enableTimeAlertBorderPulseToggle = document.getElementById('enable-time-alert-border-pulse-toggle');
    enableTimeAlertFlashToggle = document.getElementById('enable-time-alert-flash-toggle');
    minScorePrizeInput = document.getElementById('min-score-prize');
    showCorrectAnswerCheckbox = document.getElementById('show-correct-answer-on-wrong');
    rankingDisplayCountInput = document.getElementById('ranking-display-count');
    enablePrizeLockCheckbox = document.getElementById('enable-prize-lock');
    clearPrizeWinnersBtn = document.getElementById('clear-prize-winners-btn');
    giveUpLockoutMinutesInput = document.getElementById('give-up-lockout-minutes');
    clearGiveUpLockoutBtn = document.getElementById('clear-give-up-lockout-btn');
    logoFilenameInput = document.getElementById('logo-filename-input');
    logoPreviewImg = document.getElementById('logo-preview-img');
    restoreDefaultLogoBtn = document.getElementById('restore-default-logo-btn');
    logoStatusMessageEl = document.getElementById('logo-status-message');
    backgroundFilenameInput = document.getElementById('background-filename-input');
    enableCustomBackgroundCheckbox = document.getElementById('enable-custom-background');
    saveSettingsBtn = document.getElementById('save-settings-btn');
    settingsStatusMessageEl = document.getElementById('settings-status-message');
    resetSettingButtons = document.querySelectorAll('.btn-reset-setting');

    // Atribui callbacks locais
    localResetDirtyFlagAndCaptureState = (section) => resetDirtyFlagAndCaptureStateCallback(section, _getSettingsFormDataFromDOM());
    localCheckDirtyState = checkDirtyStateCallback;
    localApplyFiltersAndRenderParticipants = applyFiltersAndRenderParticipantsCallback;


    // Carrega os dados da UI
    _loadAdminSettingsToUI(settingsRef, devModeActiveState);
    // Captura o estado inicial após carregar
    setInitialSettingsData(_getSettingsFormDataFromDOM());
    setIsSettingsDirty(false);


    // Configura Event Listeners
    if (saveSettingsBtn) {
        saveSettingsBtn.addEventListener('click', () => _saveSettingsHandler(false, { settingsRef, quizCustomizationsRef, checkDirtyState: localCheckDirtyState, resetDirtyFlagAndCaptureState: localResetDirtyFlagAndCaptureState }));
    }

    if (resetSettingButtons) {
        resetSettingButtons.forEach(button => {
            button.addEventListener('click', () => {
                const key = button.dataset.settingKey;
                if (DEFAULT_SETTINGS.hasOwnProperty(key)) {
                    const defaultValue = DEFAULT_SETTINGS[key];
                    let inputElement = document.getElementById(key.replace(/[A-Z]/g, letter => `-${letter.toLowerCase()}`)) ||
                                     document.querySelector(`[name="${key}"]`) ||
                                     document.getElementById(key) ||
                                     document.getElementById(`${key.replace(/[A-Z]/g, letter => `-${letter.toLowerCase()}`)}-toggle`);

                    if (key === 'enableTimeAlertBorderPulse' && enableTimeAlertBorderPulseToggle) inputElement = enableTimeAlertBorderPulseToggle;
                    else if (key === 'enableTimeAlertFlash' && enableTimeAlertFlashToggle) inputElement = enableTimeAlertFlashToggle;
                    else if (key === 'enableVirtualKeyboard' && enableVirtualKeyboardToggleCheckbox) inputElement = enableVirtualKeyboardToggleCheckbox;

                    if (inputElement) {
                        if (inputElement.type === 'checkbox') { inputElement.checked = defaultValue; }
                        else { inputElement.value = defaultValue; }
                        localCheckDirtyState('settings'); // Usa o callback para atualizar isSettingsDirty em admin.js
                        displayStatusMessage(settingsStatusMessageEl, `Campo '${key}' resetado para o padrão. Salve para aplicar.`, 'info');
                    } else {
                        console.warn("Não foi possível encontrar o elemento de input para a configuração:", key);
                    }
                }
            });
        });
    }

    if (clearPrizeWinnersBtn) {
        clearPrizeWinnersBtn.addEventListener('click', () => {
            if (showScreenFn) {
                // TODO: Adicionar parâmetro para filtrar por 'prizeWinners' na tela de relatórios
                showScreenFn('admin-reports-screen');
            } else {
                console.error("showScreenFn não fornecida para settingsAdmin para o botão clearPrizeWinnersBtn.");
                showAlert("Erro de navegação. Por favor, contate o suporte.", "error");
            }
        });
    }

    if (clearGiveUpLockoutBtn) {
        clearGiveUpLockoutBtn.addEventListener('click', () => {
            if (showScreenFn) {
                // TODO: Adicionar parâmetro para filtrar por 'giveUpLockouts' na tela de relatórios
                showScreenFn('admin-reports-screen');
            } else {
                console.error("showScreenFn não fornecida para settingsAdmin para o botão clearGiveUpLockoutBtn.");
                showAlert("Erro de navegação. Por favor, contate o suporte.", "error");
            }
        });
    }

    if (logoFilenameInput) {
        logoFilenameInput.addEventListener('input', () => {
            const filename = logoFilenameInput.value.trim();
            if (logoPreviewImg) {
                if (filename) {
                    logoPreviewImg.src = `assets/${filename}`;
                    logoPreviewImg.onerror = () => { logoPreviewImg.src = DEFAULT_LOGO_SRC; };
                } else {
                    logoPreviewImg.src = DEFAULT_LOGO_SRC;
                }
            }
            localCheckDirtyState('settings');
        });
    }

    if (restoreDefaultLogoBtn) {
        restoreDefaultLogoBtn.addEventListener('click', () => {
            if(logoFilenameInput) logoFilenameInput.value = '';
            if(logoPreviewImg) logoPreviewImg.src = DEFAULT_LOGO_SRC;
            displayStatusMessage(logoStatusMessageEl, 'Logotipo padrão restaurado (clique em Salvar Configurações para aplicar).', 'info');
            localCheckDirtyState('settings');
        });
    }

    // Retorna os handlers para serem usados em admin.js (especificamente em getDirtyScreenInfo)
    return {
        save: (isNavigating) => _saveSettingsHandler(isNavigating, { settingsRef, quizCustomizationsRef, checkDirtyState: localCheckDirtyState, resetDirtyFlagAndCaptureState: localResetDirtyFlagAndCaptureState }),
        reset: () => {
            // Recarrega a UI para os valores atuais de 'settingsRef' e reseta o estado 'dirty'
            _loadAdminSettingsToUI(settingsRef, devModeActiveState);
            setInitialSettingsData(_getSettingsFormDataFromDOM());
            setIsSettingsDirty(false);
            // Se houver uma função de callback mais genérica para resetar o dirty state em admin.js, use-a.
            // Por exemplo, se localResetDirtyFlagAndCaptureState puder ser chamado apenas com 'settings'.
            // localResetDirtyFlagAndCaptureState('settings'); // Isso dependeria da implementação exata do callback
        }
    };
}