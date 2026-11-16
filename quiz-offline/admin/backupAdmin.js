// admin/backupAdmin.js
import { getFromLocalStorage, saveToLocalStorage, showAlert, showConfirm } from '../js/utils.js';
import { displayStatusMessage } from './uiAdmin.js';
import { DEFAULT_SETTINGS, DEFAULT_CUSTOMIZATIONS } from '../js/constants.js'; // Importa padrões
import { normalizeAndMapQuizDataIds } from './admin.js'; // Importa a função de normalização

// Constantes Chave (serão passadas como dependências ou definidas se forem usadas apenas aqui)
// QUIZ_EVENT_KEY, CUSTOM_LOGO_FILENAME_KEY, GIVE_UP_LOCKOUT_LIST_KEY, PRIZE_WINNERS_LIST_KEY, QUIZ_CUSTOMIZATIONS_KEY, DEV_MODE_LS_KEY

// Referências DOM
let exportBackupBtn, importBackupFileEl, importBackupBtn, backupStatusMessageEl;

// Callbacks e referências
let localLoadAdminDataAndUpdateUI;
let localExportDataFn;
let localLoadDevModeState; // Para recarregar o estado do modo dev após importação
let localApplyDevModeVisuals; // Para aplicar visuais do modo dev após importação
let localDevModeActiveRef; // Referência para devModeActive em admin.js


// Constantes chave que serão passadas via 'dependencies'
let QUIZ_EVENT_KEY_DEP, CUSTOM_LOGO_FILENAME_KEY_DEP, GIVE_UP_LOCKOUT_LIST_KEY_DEP,
    PRIZE_WINNERS_LIST_KEY_DEP, QUIZ_CUSTOMIZATIONS_KEY_DEP, DEV_MODE_LS_KEY_DEP;


function _exportCompleteBackup() {
    const backupData = {
        quizQuestions: getFromLocalStorage('quizQuestions', []),
        quizParticipants: getFromLocalStorage('quizParticipants', []),
        quizSettings: getFromLocalStorage('quizSettings', DEFAULT_SETTINGS),
        [QUIZ_EVENT_KEY_DEP]: getFromLocalStorage(QUIZ_EVENT_KEY_DEP, null),
        quizQuestionsInitialized: localStorage.getItem('quizQuestions_initialized') || 'false',
        [CUSTOM_LOGO_FILENAME_KEY_DEP]: localStorage.getItem(CUSTOM_LOGO_FILENAME_KEY_DEP) || null,
        [GIVE_UP_LOCKOUT_LIST_KEY_DEP]: getFromLocalStorage(GIVE_UP_LOCKOUT_LIST_KEY_DEP, []),
        [PRIZE_WINNERS_LIST_KEY_DEP]: getFromLocalStorage(PRIZE_WINNERS_LIST_KEY_DEP, []),
        [QUIZ_CUSTOMIZATIONS_KEY_DEP]: getFromLocalStorage(QUIZ_CUSTOMIZATIONS_KEY_DEP, DEFAULT_CUSTOMIZATIONS),
        [DEV_MODE_LS_KEY_DEP]: localStorage.getItem(DEV_MODE_LS_KEY_DEP) || 'false'
    };
    const date = new Date();
    const formattedDate = `${String(date.getDate()).padStart(2, '0')}-${String(date.getMonth() + 1).padStart(2, '0')}-${date.getFullYear()}`;
    if (localExportDataFn) {
        localExportDataFn(backupData, `backup_quiz_caesb_${formattedDate}.json`, 'backup');
        // A mensagem de sucesso é tratada dentro de exportDataFn se o tipo for 'backup'
        // ou podemos adicionar uma aqui se quisermos ser explícitos para este módulo
        // displayStatusMessage(backupStatusMessageEl, 'Backup exportado com sucesso!', 'success');
    } else {
        showAlert('Função de exportação de dados não encontrada.', 'error');
    }
}

function _handleImportBackup() {
    if (!importBackupFileEl?.files?.length) {
        showAlert('Por favor, selecione um arquivo de backup.');
        return;
    }
    const file = importBackupFileEl.files[0];
    const reader = new FileReader();

    reader.onload = (event) => {
        try {
            const importedData = JSON.parse(event.target.result);
            if (importedData && typeof importedData.quizSettings !== 'undefined') { // Validação básica
                showConfirm("Importar este backup? TODOS os dados atuais serão sobrescritos.", {
                    onDiscardAndProceed: () => {
                        // Normaliza os IDs ANTES de salvar
                        const {
                            migratedQuestions,
                            migratedParticipants,
                            questionsProcessedCount, // Pode ser usado para log se desejado
                            attemptsUpdatedCount   // Pode ser usado para log se desejado
                        } = normalizeAndMapQuizDataIds(importedData.quizQuestions || [], importedData.quizParticipants || []);

                        // Aplica os defaults de isDisabled e difficulty APÓS a normalização dos IDs
                        const finalQuestionsToSave = migratedQuestions.map(q => ({
                            ...q,
                            isDisabled: typeof q.isDisabled === 'boolean' ? q.isDisabled : false,
                            difficulty: q.difficulty || 'facil'
                        }));

                        saveToLocalStorage('quizQuestions', finalQuestionsToSave);
                        saveToLocalStorage('quizParticipants', migratedParticipants);

                        if (questionsProcessedCount > 0 || attemptsUpdatedCount > 0) {
                            console.log(`IDs normalizados durante a importação do backup: ${questionsProcessedCount} questões, ${attemptsUpdatedCount} tentativas.`);
                            // Opcional: Mostrar um alerta discreto ou apenas logar no console
                            // showAlert('Os IDs das questões e tentativas no backup foram normalizados.', 'info', 4000);
                        }

                        const importedSettings = importedData.quizSettings || {};
                        const mergedSettings = {
                            ...DEFAULT_SETTINGS,
                            ...importedSettings,
                            difficultyPercentages: {
                                ...DEFAULT_SETTINGS.difficultyPercentages,
                                ...(importedSettings.difficultyPercentages || {})
                            }
                        };
                        saveToLocalStorage('quizSettings', mergedSettings);

                        if (importedData[QUIZ_EVENT_KEY_DEP]) { saveToLocalStorage(QUIZ_EVENT_KEY_DEP, importedData[QUIZ_EVENT_KEY_DEP]); } else { localStorage.removeItem(QUIZ_EVENT_KEY_DEP); }
                        localStorage.setItem('quizQuestions_initialized', importedData.quizQuestionsInitialized || 'false');
                        if (importedData[CUSTOM_LOGO_FILENAME_KEY_DEP]) { localStorage.setItem(CUSTOM_LOGO_FILENAME_KEY_DEP, importedData[CUSTOM_LOGO_FILENAME_KEY_DEP]); } else { localStorage.removeItem(CUSTOM_LOGO_FILENAME_KEY_DEP); }
                        saveToLocalStorage(GIVE_UP_LOCKOUT_LIST_KEY_DEP, importedData[GIVE_UP_LOCKOUT_LIST_KEY_DEP] || []);
                        saveToLocalStorage(PRIZE_WINNERS_LIST_KEY_DEP, importedData[PRIZE_WINNERS_LIST_KEY_DEP] || []);

                        const importedCustomizations = importedData[QUIZ_CUSTOMIZATIONS_KEY_DEP] || {};
                        const mergedCustomizations = {
                            texts: { ...DEFAULT_CUSTOMIZATIONS.texts, ...(importedCustomizations.texts || {}) },
                            colors: { ...DEFAULT_CUSTOMIZATIONS.colors, ...(importedCustomizations.colors || {}) },
                            fontSizes: { ...DEFAULT_CUSTOMIZATIONS.fontSizes, ...(importedCustomizations.fontSizes || {}) }
                        };
                        saveToLocalStorage(QUIZ_CUSTOMIZATIONS_KEY_DEP, mergedCustomizations);

                        localStorage.setItem(DEV_MODE_LS_KEY_DEP, importedData[DEV_MODE_LS_KEY_DEP] || 'false');
                        
                        // Atualiza o estado de devModeActive em admin.js através do callback/referência
                        if(localLoadDevModeState) localLoadDevModeState();
                        // Aplica os visuais do modo dev usando o estado atualizado
                        if(localApplyDevModeVisuals && localDevModeActiveRef) localApplyDevModeVisuals(localDevModeActiveRef.value);


                        if (localLoadAdminDataAndUpdateUI) localLoadAdminDataAndUpdateUI();
                        displayStatusMessage(backupStatusMessageEl, 'Backup importado com sucesso! Dados atualizados.', 'success');
                    }
                }, 'danger', { discardButtonText: "Sim, Importar" });
            } else {
                throw new Error("Arquivo de backup inválido ou corrompido.");
            }
        } catch (e) {
            displayStatusMessage(backupStatusMessageEl, `Erro ao importar: ${e.message}`, 'error');
        } finally {
            if (importBackupFileEl) importBackupFileEl.value = '';
        }
    };
    reader.onerror = () => {
        displayStatusMessage(backupStatusMessageEl, 'Erro ao ler o arquivo.', 'error');
    };
    reader.readAsText(file);
}


export function initializeBackupScreen(dependencies) {
    localLoadAdminDataAndUpdateUI = dependencies.loadAdminDataAndUpdateUICallback;
    localExportDataFn = dependencies.exportDataFn;
    localLoadDevModeState = dependencies.loadDevModeStateCallback;
    localApplyDevModeVisuals = dependencies.applyDevModeVisualsCallback;
    localDevModeActiveRef = dependencies.devModeActiveRef;


    // Atribui constantes chave
    QUIZ_EVENT_KEY_DEP = dependencies.QUIZ_EVENT_KEY;
    CUSTOM_LOGO_FILENAME_KEY_DEP = dependencies.CUSTOM_LOGO_FILENAME_KEY;
    GIVE_UP_LOCKOUT_LIST_KEY_DEP = dependencies.GIVE_UP_LOCKOUT_LIST_KEY;
    PRIZE_WINNERS_LIST_KEY_DEP = dependencies.PRIZE_WINNERS_LIST_KEY;
    QUIZ_CUSTOMIZATIONS_KEY_DEP = dependencies.QUIZ_CUSTOMIZATIONS_KEY;
    DEV_MODE_LS_KEY_DEP = dependencies.DEV_MODE_LS_KEY;


    exportBackupBtn = document.getElementById('export-backup-btn');
    importBackupFileEl = document.getElementById('import-backup-file');
    importBackupBtn = document.getElementById('import-backup-btn');
    backupStatusMessageEl = document.getElementById('backup-status-message');

    if (exportBackupBtn) exportBackupBtn.addEventListener('click', _exportCompleteBackup);
    if (importBackupBtn) importBackupBtn.addEventListener('click', _handleImportBackup);

    if (backupStatusMessageEl) backupStatusMessageEl.textContent = ''; // Limpa mensagem ao carregar
}