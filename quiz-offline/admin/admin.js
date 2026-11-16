import { DEFAULT_SETTINGS, DEFAULT_CUSTOMIZATIONS } from '../js/constants.js';
import { getFromLocalStorage, saveToLocalStorage, showAlert, showConfirm, formatTime } from '../js/utils.js';
import { initializeAuthEventListeners } from './authAdmin.js';
import {
    displayStatusMessage,
    // applyFontSize, // Não é mais chamada diretamente daqui para os botões
    loadFontPreference,
    applyCustomLogo,
    loadCustomLogo,
    applyAdminThemeCustomizations,
    applyCustomBackground,
    applyDevModeVisuals,
    decreaseFontSize,
    increaseFontSize
} from './uiAdmin.js';
import { initializeSettingsScreen } from './settingsAdmin.js';
import { initializeQuestionsScreen, setGlobalQuestionsRef } from './questionsAdmin.js'; // Adicionado setGlobalQuestionsRef
import { initializeEventScreen } from './eventAdmin.js';
import { initializeReportsScreen } from './reportsAdmin.js';
import { initializeStatsScreen } from './statsAdmin.js';
import { initializeBackupScreen } from './backupAdmin.js';
import { initializeCustomizationScreen } from './customizationAdmin.js';
import { initializeAnalyticsScreen } from './analyticsAdmin.js';

// Chaves principais do localStorage para dados do Quiz
const QUIZ_QUESTIONS_KEY = 'quizQuestions';
const QUIZ_PARTICIPANTS_KEY = 'quizParticipants';
// const QUIZ_SETTINGS_KEY = 'quizSettings'; // Definida para referência, usada implicitamente abaixo
// const QUIZ_EVENT_KEY_CONST = 'quizCurrentEvent'; // Definida para referência
// const QUIZ_CUSTOMIZATIONS_KEY_CONST = 'quizThemeCustomizations'; // Definida para referência


// Função Utilitária de Normalização e Mapeamento de IDs
export function normalizeAndMapQuizDataIds(questionsArray, participantsArray) {
    let questions = Array.isArray(questionsArray) ? [...questionsArray] : [];
    let participants = Array.isArray(participantsArray) ? [...participantsArray] : [];

    const idMap = {};
    let newNumericIdCounter = 1;
    let questionsProcessedCount = 0;
    let attemptsUpdatedCount = 0;

    // 1. Migrar IDs em quizQuestions e construir o mapa
    const migratedQuestions = questions.map(question => {
        const oldId = question.id; // Pode ser número ou string
        const newId = newNumericIdCounter; // Sempre número
        
        idMap[String(oldId)] = newId;
        
        const updatedQuestion = { ...question, id: newId };
        newNumericIdCounter++;
        questionsProcessedCount++;
        return updatedQuestion;
    });

    // 2. Atualizar questionId em playerAttempts
    const migratedParticipants = participants.map(participant => {
        if (participant.playerAttempts && Array.isArray(participant.playerAttempts)) {
            const updatedAttempts = participant.playerAttempts.map(attempt => {
                const oldAttemptQuestionId = String(attempt.questionId);
                
                if (idMap.hasOwnProperty(oldAttemptQuestionId)) {
                    attemptsUpdatedCount++;
                    return { ...attempt, questionId: idMap[oldAttemptQuestionId] };
                }
                return attempt;
            });
            return { ...participant, playerAttempts: updatedAttempts };
        }
        return participant;
    });

    return {
        migratedQuestions,
        migratedParticipants,
        questionsProcessedCount,
        attemptsUpdatedCount,
        idMap // Pode ser útil para logs ou verificações futuras
    };
}
// Fim da Função Utilitária

// Função de Migração Abrangente de IDs (agora usa a função utilitária)
function migrateAllDataToNumericIds() {
    const COMPREHENSIVE_IDS_MIGRATED_KEY = 'quizComprehensiveIdsMigrated_v1';
    const alreadyMigrated = getFromLocalStorage(COMPREHENSIVE_IDS_MIGRATED_KEY, false);

    if (alreadyMigrated) {
        return;
    }

    console.log("Iniciando verificação para migração abrangente de IDs (v1)...");

    let currentQuestions = getFromLocalStorage(QUIZ_QUESTIONS_KEY, []);
    let currentParticipants = getFromLocalStorage(QUIZ_PARTICIPANTS_KEY, []);

    // Verifica se há alguma questão com ID não numérico para justificar a migração
    const needsMigration = currentQuestions.some(q => typeof q.id !== 'number' || isNaN(parseInt(q.id, 10)));

    if (!needsMigration && currentQuestions.length > 0) {
         // Se não precisa de migração e já tem questões, apenas marca como migrado para evitar re-checar.
         // Isso cobre o caso de uma instalação nova onde os IDs já são numéricos desde o início.
        console.log("Nenhuma migração de ID necessária (IDs já parecem numéricos ou não há questões). Marcando como concluído.");
        saveToLocalStorage(COMPREHENSIVE_IDS_MIGRATED_KEY, true);
        return;
    }
    if (!needsMigration && currentQuestions.length === 0) {
        // Se não há questões, não há o que migrar. Não marca como migrado ainda,
        // pois uma importação futura pode trazer dados que precisem de migração.
        console.log("Nenhuma questão para migrar IDs.");
        return;
    }


    console.log("IDs não numéricos detectados. Prosseguindo com a migração abrangente de IDs (v1)...");

    const {
        migratedQuestions,
        migratedParticipants,
        questionsProcessedCount,
        attemptsUpdatedCount
    } = normalizeAndMapQuizDataIds(currentQuestions, currentParticipants);

    saveToLocalStorage(QUIZ_QUESTIONS_KEY, migratedQuestions);
    saveToLocalStorage(QUIZ_PARTICIPANTS_KEY, migratedParticipants);
    saveToLocalStorage(COMPREHENSIVE_IDS_MIGRATED_KEY, true);

    console.log(`Migração abrangente de IDs (v1) concluída. ${questionsProcessedCount} questões processadas. ${attemptsUpdatedCount} tentativas atualizadas.`);
    if (questionsProcessedCount > 0 || attemptsUpdatedCount > 0) {
        showAlert('Os dados internos (IDs de questões e tentativas) foram atualizados para um formato numérico consistente. Esta é uma operação única e automática.', 'info', 8000);
    }
}
// Fim da Função de Migração

document.addEventListener('DOMContentLoaded', () => {
    // Executa a migração de IDs ANTES de carregar os dados principais da aplicação
    migrateAllDataToNumericIds();

    // Chave para o localStorage do Modo Desenvolvedor
    const DEV_MODE_LS_KEY = 'quizAdminDevMode';
    let devModeActive = false; // Estado do Modo Desenvolvedor

    const QUIZ_EVENT_KEY = 'quizCurrentEvent';
    const QUIZ_CUSTOMIZATIONS_KEY = 'quizThemeCustomizations';

    const screens = document.querySelectorAll('.screen');
    // adminPageContainer é agora selecionado dentro de applyDevModeVisuals em uiAdmin.js

    // Elementos da tela de login
    const adminLoginBtn = document.getElementById('admin-login-btn');
    const adminPasswordInput = document.getElementById('admin-password');
    const adminLoginErrorEl = document.getElementById('admin-login-error');
    const adminLogoutIconBtn = document.getElementById('admin-logout-icon-btn');


    let allQuestions = [];
    let participants = [];
    let settings = {};
    let currentEventAdminData = null;
    let quizCustomizations = {};

    // ITEMS_PER_PAGE, currentParticipantsPage, participantsSortKey, participantsSortDir foram movidos para admin/reportsAdmin.js
    // currentStatsPage, statsSortKey, statsSortDir foram movidos para admin/statsAdmin.js

    let isSettingsDirty = false;
    let isCustomizationsDirty = false;
    let isQuestionFormDirty = false;
    let isEventDirty = false;

    let initialSettingsData = '';
    let initialCustomizationsData = '';
    let initialQuestionFormData = '';
    let initialEventData = '';

    let navigationTargetScreen = null; // Para gerenciamento de navegação com dirty check
    let navigationAction = null; // Para gerenciamento de navegação com dirty check

    let settingsScreenHandlers = null;
    let questionsScreenHandlers = null;
    let eventScreenHandlers = null;
    let customizationScreenHandlers = null; // Para armazenar os handlers da tela de personalização

    // Constantes relacionadas a UI como CUSTOM_LOGO_FILENAME_KEY, DEFAULT_LOGO_SRC, htmlEl, fontSizesInPx, currentFontStepIndex
    // foram movidas e são gerenciadas internamente por uiAdmin.js
    const PRIZE_WINNERS_LIST_KEY = 'quizPrizeWinnersData'; // Usado em reportsAdmin, settingsAdmin
    const GIVE_UP_LOCKOUT_LIST_KEY = 'quizGiveUpLockoutData'; // Usado em reportsAdmin, settingsAdmin

    // Funções de UI movidas para uiAdmin.js:
    // applyFontSize, loadFontPreference, applyCustomLogo, loadCustomLogo,
    // applyAdminThemeCustomizations, applyCustomBackground, applyDevModeVisuals

    const loadDevModeState = () => { // Permanece aqui pois modifica devModeActive
        devModeActive = localStorage.getItem(DEV_MODE_LS_KEY) === 'true';
        console.log("Modo DEV carregado:", devModeActive);
    };
    loadDevModeState();

    settings = { ...DEFAULT_SETTINGS, ...getFromLocalStorage('quizSettings', DEFAULT_SETTINGS) };
    allQuestions = getFromLocalStorage('quizQuestions', []);
    if (setGlobalQuestionsRef) { // Adiciona verificação para segurança
        setGlobalQuestionsRef({ value: allQuestions }); // Passa a referência global de questões
    }
    participants = getFromLocalStorage('quizParticipants', []);
    currentEventAdminData = getFromLocalStorage(QUIZ_EVENT_KEY, null);
    quizCustomizations = getFromLocalStorage(QUIZ_CUSTOMIZATIONS_KEY, DEFAULT_CUSTOMIZATIONS);

    loadCustomLogo(); // Chamada da função importada de uiAdmin.js
    applyAdminThemeCustomizations(quizCustomizations); // Passa o estado necessário
    applyCustomBackground(settings, quizCustomizations); // Passa o estado necessário
    applyDevModeVisuals(devModeActive); // Passa o estado necessário

    const adminDashboardCards = document.querySelectorAll('.admin-dashboard-card');
    const adminBackButtons = document.querySelectorAll('.admin-back-btn');
    // Seletores de DOM para a tela de Evento foram movidos para admin/eventAdmin.js
    const eventConfigStatusMessageEl = document.getElementById('event-config-status-message'); // Usado em screenActions
    // Seletores de DOM para a tela de Questões foram movidos para admin/questionsAdmin.js
    // Mantemos aqui apenas os que são usados por outras seções ou que são muito genéricos.
    const questionsImportExportStatusMessageEl = document.getElementById('questions-import-export-status-message'); // Usado por questionsAdmin

    // Seletores de DOM para a tela de Configurações foram movidos para admin/settingsAdmin.js
    // Mantemos aqui apenas os que são usados por outras seções ou que são muito genéricos.
    const devModeToggleCheckbox = document.getElementById('dev-mode-toggle');
    const settingsStatusMessageEl = document.getElementById('settings-status-message');
    const logoStatusMessageEl = document.getElementById('logo-status-message');

    // Seletores de DOM para a tela de Relatórios foram movidos para admin/reportsAdmin.js
    // Seletores de DOM para a tela de Estatísticas foram movidos para admin/statsAdmin.js
    // Seletores de DOM para a tela de Backup (exportBackupBtn, etc.) foram movidos para admin/backupAdmin.js
    const backupStatusMessageEl = document.getElementById('backup-status-message'); // Usado em screenActions

    // Seletores de DOM para o modal de detalhes do participante foram movidos para admin/reportsAdmin.js
    const decreaseFontButton = document.getElementById('decrease-font');
    const increaseFontButton = document.getElementById('increase-font');
    const goToQuizBtn = document.getElementById('go-to-quiz-btn');

    // Seletores de DOM para a tela de Personalização foram movidos para admin/customizationAdmin.js
    const customizationStatusMessageEl = document.getElementById('customization-status-message'); // Usado em screenActions

    // Seletores de DOM para a tela de Dashboard Analítico foram movidos para admin/analyticsAdmin.js


    // displayStatusMessage foi movida para uiAdmin.js

    // getSettingsFormData foi movida para admin/settingsAdmin.js e é acessada via settingsScreenHandlers
    // getCustomizationsFormData foi movida para admin/customizationAdmin.js e é acessada via customizationScreenHandlers
    // getQuestionFormData foi movido para admin/questionsAdmin.js
    // getEventFormData foi movido para admin/eventAdmin.js e será acessado via eventScreenHandlers.getEventFormData

    const checkDirtyState = (section) => {
        switch(section) {
            case 'settings': isSettingsDirty = (settingsScreenHandlers?.getSettingsFormData ? settingsScreenHandlers.getSettingsFormData() : "{}") !== initialSettingsData; break;
            case 'customizations': isCustomizationsDirty = (customizationScreenHandlers?.getCustomizationsFormData ? customizationScreenHandlers.getCustomizationsFormData() : "{}") !== initialCustomizationsData; break; // Usa o handler
            case 'question': isQuestionFormDirty = (questionsScreenHandlers?.getQuestionFormData ? questionsScreenHandlers.getQuestionFormData() : "{}") !== initialQuestionFormData; break;
            case 'event': isEventDirty = (eventScreenHandlers?.getEventFormData ? eventScreenHandlers.getEventFormData() : "{}") !== initialEventData; break; // Usa o handler
        }
    };

    const resetDirtyFlagAndCaptureState = (section) => {
        switch(section) {
            case 'settings': isSettingsDirty = false; initialSettingsData = (settingsScreenHandlers?.getSettingsFormData ? settingsScreenHandlers.getSettingsFormData() : "{}"); break;
            case 'customizations': isCustomizationsDirty = false; initialCustomizationsData = (customizationScreenHandlers?.getCustomizationsFormData ? customizationScreenHandlers.getCustomizationsFormData() : "{}"); break; // Usa o handler
            case 'question': isQuestionFormDirty = false; initialQuestionFormData = (questionsScreenHandlers?.getQuestionFormData ? questionsScreenHandlers.getQuestionFormData() : "{}"); break;
            case 'event': isEventDirty = false; initialEventData = (eventScreenHandlers?.getEventFormData ? eventScreenHandlers.getEventFormData() : "{}"); break; // Usa o handler
        }
    };

    const screenActions = {
        'admin-settings-screen': () => {
            settingsScreenHandlers = initializeSettingsScreen({ // Armazena os handlers retornados
                settingsRef: settings,
                devModeActiveState: devModeActive,
                quizCustomizationsRef: quizCustomizations,
                getIsSettingsDirty: () => isSettingsDirty,
                setIsSettingsDirty: (value) => { isSettingsDirty = value; },
                getInitialSettingsData: () => initialSettingsData,
                setInitialSettingsData: (data) => { initialSettingsData = data; },
                resetDirtyFlagAndCaptureStateCallback: resetDirtyFlagAndCaptureState,
                checkDirtyStateCallback: checkDirtyState,
                // applyFiltersAndRenderParticipantsCallback foi removido pois é específico de reportsAdmin
                settingsStatusMessageEl: settingsStatusMessageEl,
                logoStatusMessageEl: logoStatusMessageEl,
                displayStatusMessage: displayStatusMessage,
                applyCustomLogo: applyCustomLogo,
                applyCustomBackground: applyCustomBackground,
                uiLoadCustomLogo: loadCustomLogo,
                showAlert: showAlert,
                showConfirm: showConfirm,
                getFromLocalStorage: getFromLocalStorage,
                saveToLocalStorage: saveToLocalStorage,
                DEFAULT_SETTINGS: DEFAULT_SETTINGS,
                CUSTOM_LOGO_FILENAME_KEY: 'quizCustomLogoFileName',
                // PRIZE_WINNERS_LIST_KEY e GIVE_UP_LOCKOUT_LIST_KEY removidas daqui
                // pois settingsAdmin não limpará mais as listas diretamente.
                showScreenFn: showScreen // Passa a função de navegação
            });
        },
        'admin-customization-screen': () => {
            customizationScreenHandlers = initializeCustomizationScreen({
                quizCustomizationsRef: { value: quizCustomizations },
                isCustomizationsDirtyRef: { value: isCustomizationsDirty },
                initialCustomizationsDataRef: { value: initialCustomizationsData },
                resetDirtyFlagAndCaptureStateCallback: resetDirtyFlagAndCaptureState,
                checkDirtyStateCallback: checkDirtyState,
                settingsRef: { value: settings }, // Passa a referência para settings
                displayStatusMessage: displayStatusMessage,
                applyAdminThemeCustomizations: applyAdminThemeCustomizations, // de uiAdmin
                applyCustomBackground: applyCustomBackground, // de uiAdmin
                showConfirm: showConfirm,
                getFromLocalStorage: getFromLocalStorage,
                saveToLocalStorage: saveToLocalStorage,
                DEFAULT_CUSTOMIZATIONS: DEFAULT_CUSTOMIZATIONS,
                customizationStatusMessageEl: customizationStatusMessageEl,
                QUIZ_CUSTOMIZATIONS_KEY: QUIZ_CUSTOMIZATIONS_KEY
            });
            // A lógica de reset e limpeza de mensagem é feita dentro de initializeCustomizationScreen
        },
        'admin-questions-screen': () => {
            questionsScreenHandlers = initializeQuestionsScreen({
                allQuestionsRef: { value: allQuestions },
                isQuestionFormDirtyRef: { value: isQuestionFormDirty },
                initialQuestionFormDataRef: { value: initialQuestionFormData },
                resetDirtyFlagAndCaptureStateCallback: resetDirtyFlagAndCaptureState,
                checkDirtyStateCallback: checkDirtyState,
                // loadAdminStatsCallback foi removido pois questionsAdmin não deve carregar stats.
                displayStatusMessage: displayStatusMessage,
                showAlert: showAlert,
                showConfirm: showConfirm,
                getFromLocalStorage: getFromLocalStorage,
                saveToLocalStorage: saveToLocalStorage,
                exportDataFn: exportData,
                questionsImportExportStatusMessageEl: questionsImportExportStatusMessageEl
            });
        },
        'admin-event-screen': () => {
            eventScreenHandlers = initializeEventScreen({
                currentEventAdminDataRef: { value: currentEventAdminData },
                isEventDirtyRef: { value: isEventDirty },
                initialEventDataRef: { value: initialEventData },
                resetDirtyFlagAndCaptureStateCallback: resetDirtyFlagAndCaptureState,
                checkDirtyStateCallback: checkDirtyState,
                displayStatusMessage: displayStatusMessage,
                showAlert: showAlert,
                showConfirm: showConfirm,
                getFromLocalStorage: getFromLocalStorage,
                saveToLocalStorage: saveToLocalStorage,
                eventConfigStatusMessageEl: eventConfigStatusMessageEl,
                QUIZ_EVENT_KEY: QUIZ_EVENT_KEY
            });
        },
        'admin-reports-screen': () => {
            initializeReportsScreen({
                settingsRef: { value: settings }, // Passa a referência ao objeto settings
                participantsRef: { value: participants }, // Passa a referência ao array de participantes
                exportDataFn: exportData,
                displayStatusMessage: displayStatusMessage,
                showAlert: showAlert,
                showConfirm: showConfirm,
                formatTime: formatTime,
                getFromLocalStorage: getFromLocalStorage,
                saveToLocalStorage: saveToLocalStorage,
                PRIZE_WINNERS_LIST_KEY: PRIZE_WINNERS_LIST_KEY,
                GIVE_UP_LOCKOUT_LIST_KEY: GIVE_UP_LOCKOUT_LIST_KEY
                // ITEMS_PER_PAGE é gerenciado internamente por reportsAdmin.js
            });
            // A lógica de inicialização da UI e filtros é feita dentro de initializeReportsScreen
        },
        'admin-backup-screen': () => {
            initializeBackupScreen({
                loadAdminDataAndUpdateUICallback: loadAdminDataAndUpdateUI,
                exportDataFn: exportData,
                loadDevModeStateCallback: loadDevModeState,
                applyDevModeVisualsCallback: applyDevModeVisuals,
                devModeActiveRef: { value: devModeActive }, // Passa como objeto para que possa ser atualizado
                displayStatusMessage: displayStatusMessage,
                showAlert: showAlert,
                showConfirm: showConfirm,
                getFromLocalStorage: getFromLocalStorage,
                saveToLocalStorage: saveToLocalStorage,
                DEFAULT_SETTINGS: DEFAULT_SETTINGS,
                DEFAULT_CUSTOMIZATIONS: DEFAULT_CUSTOMIZATIONS,
                QUIZ_EVENT_KEY: QUIZ_EVENT_KEY,
                CUSTOM_LOGO_FILENAME_KEY: 'quizCustomLogoFileName', // Esta constante é usada em settings e backup
                GIVE_UP_LOCKOUT_LIST_KEY: GIVE_UP_LOCKOUT_LIST_KEY,
                PRIZE_WINNERS_LIST_KEY: PRIZE_WINNERS_LIST_KEY,
                QUIZ_CUSTOMIZATIONS_KEY: QUIZ_CUSTOMIZATIONS_KEY,
                DEV_MODE_LS_KEY: DEV_MODE_LS_KEY,
                backupStatusMessageEl: backupStatusMessageEl
            });
            // A limpeza da mensagem de status é feita dentro de initializeBackupScreen
        },
        'admin-stats-screen': () => {
            initializeStatsScreen({
                // toggleQuestionDisabledStateCallback foi removido.
                // Se statsAdmin precisar interagir com o estado das questões,
                // isso deve ser feito por um mecanismo mais robusto ou orquestrado por admin.js.
                sortDataFn: sortData,
                updateSortIconsFn: updateSortIcons,
                // ITEMS_PER_PAGE_STATS é definido dentro de statsAdmin.js
            });
            // A lógica de currentStatsPage = 1; e loadAdminStats(); é feita dentro de initializeStatsScreen
        },
        'admin-analytics-screen': () => {
            initializeAnalyticsScreen({
                // Passar dependências se houver, como formatTime ou DEFAULT_SETTINGS,
                // mas analyticsAdmin.js já os importa.
                // Se analyticsAdmin precisar de algo de admin.js (estado ou função), passe aqui.
            });
            // A lógica de renderAnalyticsDashboard é chamada dentro de initializeAnalyticsScreen
        },
        'admin-login-screen': () => {
            const currentAdminLoginErrorEl = document.getElementById('admin-login-error');
            if (currentAdminLoginErrorEl) currentAdminLoginErrorEl.classList.add('hidden');
        }
    };

    const getDirtyScreenInfo = (activeScreenEl) => {
        if (!activeScreenEl) return { isDirty: false, saveFn: null, resetFn: null, screenName: '' };

        if (activeScreenEl.id === 'admin-settings-screen' && isSettingsDirty && settingsScreenHandlers) {
            return { isDirty: true, saveFn: settingsScreenHandlers.save, resetFn: settingsScreenHandlers.reset, screenName: 'Configurações Gerais' };
        }
        if (activeScreenEl.id === 'admin-customization-screen' && isCustomizationsDirty && customizationScreenHandlers) {
            return { isDirty: true, saveFn: customizationScreenHandlers.save, resetFn: customizationScreenHandlers.reset, screenName: 'Personalização do Quiz' };
        }
        if (activeScreenEl.id === 'admin-questions-screen' && isQuestionFormDirty && questionsScreenHandlers) {
            // Verifica se o formulário de questão está visível (lógica que estava em getDirtyScreenInfo antes)
            const addEditQForm = document.getElementById('add-edit-question-form'); // Precisa selecionar aqui ou passar o estado
            if (addEditQForm && !addEditQForm.classList.contains('hidden')) {
                 return { isDirty: true, saveFn: questionsScreenHandlers.save, resetFn: questionsScreenHandlers.reset, screenName: 'Formulário de Questão' };
            }
        }
        if (activeScreenEl.id === 'admin-event-screen' && isEventDirty && eventScreenHandlers) {
            return { isDirty: true, saveFn: eventScreenHandlers.save, resetFn: eventScreenHandlers.reset, screenName: 'Gerenciar Evento' };
        }
        return { isDirty: false, saveFn: null, resetFn: null, screenName: '' };
    };

    const handleNavigationWithDirtyCheck = (target, actionType = 'showScreen', forceNavigation = false) => {
        const activeScreenEl = document.querySelector('.screen.active');
        const dirtyInfo = getDirtyScreenInfo(activeScreenEl);

        if (!forceNavigation && dirtyInfo.isDirty) {
            navigationTargetScreen = target; // Mantém para referência, se necessário
            navigationAction = actionType; // Mantém para referência, se necessário

            showConfirm(
                `Você tem alterações não salvas em "${dirtyInfo.screenName}". Deseja continuar?`,
                {
                    onSaveAndProceed: () => {
                        if (dirtyInfo.saveFn) {
                            const saveSuccessful = dirtyInfo.saveFn(true); // Passa true para indicar navegação
                            if (saveSuccessful) {
                                if (dirtyInfo.resetFn) dirtyInfo.resetFn();
                                performNavigation(target, actionType);
                            }
                        }
                    },
                    onDiscardAndProceed: () => {
                        if (dirtyInfo.resetFn) dirtyInfo.resetFn();
                        performNavigation(target, actionType);
                    },
                    onCancel: () => {
                        navigationTargetScreen = null;
                        navigationAction = null;
                    }
                },
                'warning',
                {
                    title: "Alterações Não Salvas",
                    showSaveButton: true,
                    saveButtonText: "Salvar e Sair",
                    discardButtonText: "Sair sem Salvar",
                    cancelButtonText: "Cancelar"
                }
            );
            return;
        }
        performNavigation(target, actionType);
    };

    const performNavigation = (target, actionType) => {
        if (actionType === 'showScreen') {
            proceedWithShowScreen(target);
        } else if (actionType === 'redirect') {
            window.location.href = target;
        }
        navigationTargetScreen = null; // Limpa após a navegação
        navigationAction = null; // Limpa após a navegação
    };

    const showScreen = (screenId, forceNavigation = false) => {
        handleNavigationWithDirtyCheck(screenId, 'showScreen', forceNavigation);
    };

    const proceedWithShowScreen = (screenId) => {
        screens.forEach(screen => {
            screen.style.display = screen.id === screenId ? 'flex' : 'none';
            screen.classList.toggle('active', screen.id === screenId);
        });

        const currentAdminLogoutIconBtn = document.getElementById('admin-logout-icon-btn');
        if (screenId === 'admin-login-screen') {
            if(currentAdminLogoutIconBtn) currentAdminLogoutIconBtn.classList.add('hidden');
        } else {
            if(currentAdminLogoutIconBtn) currentAdminLogoutIconBtn.classList.remove('hidden');
        }

        if (screenActions[screenId]) {
            screenActions[screenId]();
        }

        // navigationTargetScreen e navigationAction são declarados em escopo superior
    };

    // Funções loadCurrentEventToUI, saveCurrentEventHandler, clearCurrentEvent
    // foram movidas para admin/eventAdmin.js

    // Funções setQuestionFormVisibility, loadAdminQuestions, toggleQuestionDisabledState,
    // handleEditQuestion, saveQuestionHandler, handleDeleteQuestion, exportQuestionsHandler, handleImportQuestions
    // foram movidas para admin/questionsAdmin.js

    function sortData(dataArray, key, direction) {
        return [...dataArray].sort((a, b) => {
            let valA = a[key];
            let valB = b[key];

            if (key === 'score' || key === 'time' || key === 'total' || key === 'correct' || key === 'incorrect') {
                valA = Number(valA) || 0;
                valB = Number(valB) || 0;
            } else if (key === 'timestamp') {
                valA = new Date(valA).getTime() || 0;
                valB = new Date(valB).getTime() || 0;
            } else if (key === 'accuracy') {
                valA = parseFloat(a.total > 0 ? (a.correct / a.total) * 100 : -1) ;
                valB = parseFloat(b.total > 0 ? (b.correct / b.total) * 100 : -1) ;
                 if (isNaN(valA)) valA = -1;
                 if (isNaN(valB)) valB = -1;
            } else {
                valA = String(valA ?? '').toLowerCase();
                valB = String(valB ?? '').toLowerCase();
            }

            if (valA < valB) return direction === 'asc' ? -1 : 1;
            if (valA > valB) return direction === 'asc' ? 1 : -1;
            return 0;
        });
    }

    function updateSortIcons(tableId, currentKey, currentDir) {
        const tableHeaders = document.querySelectorAll(`#${tableId} th[data-sort-key]`);
        tableHeaders.forEach(th => {
            const iconSpan = th.querySelector('.sort-icon');
            if (iconSpan) {
                if (th.dataset.sortKey === currentKey) {
                    iconSpan.textContent = currentDir === 'asc' ? '▲' : '▼';
                } else {
                    iconSpan.textContent = '';
                }
            }
        });
    }

    // Funções applyFiltersAndRenderParticipants, renderParticipantsTable, updatePaginationControls,
    // showParticipantDetails, closeParticipantDetailsModal, removePrizeWinner, removeGiveUpLock,
    // handleDeleteParticipant, handleDeleteAllParticipants, exportParticipantsHandler
    // foram movidas para admin/reportsAdmin.js

    function exportData(data, filename, type) {
        const isEmptyData = (!data || (Array.isArray(data) && data.length === 0) && (typeof data !== 'object' || Object.keys(data).length === 0) );
        if (type !== 'backup' && isEmptyData) {
            showAlert(`Não há dados para exportar.`);
            return;
        }
        if (type === 'backup' && isEmptyData) {
            displayStatusMessage(backupStatusMessageEl, 'Não há dados para exportar no backup.', 'error');
            return;
        }
        if (type === 'backup' && (!data.quizQuestions?.length && !data.quizParticipants?.length && !data.quizSettings && !data[QUIZ_EVENT_KEY] && !data[CUSTOM_LOGO_FILENAME_KEY] && !data[GIVE_UP_LOCKOUT_LIST_KEY]?.length && !data[PRIZE_WINNERS_LIST_KEY]?.length && !data[QUIZ_CUSTOMIZATIONS_KEY])) {
            displayStatusMessage(backupStatusMessageEl, 'Não há dados significativos para exportar no backup.', 'error');
            return;
        }
        let dataString = ''; let mimeType = '';
        if (type === 'backup' || type.startsWith('json_')) { dataString = JSON.stringify(data, null, 2); mimeType = 'application/json;charset=utf-8;'; }
        else if (type.startsWith('csv_')) { if (!Array.isArray(data) || data.length === 0) { showAlert(`Não há dados para exportar em CSV.`); return; } const headers = Object.keys(data[0]); const csvRows = [ headers.join(','), ...data.map(row => headers.map(fieldName => JSON.stringify(row[fieldName], (key, value) => value === undefined ? '' : value)).join(',')) ]; dataString = "\uFEFF" + csvRows.join('\r\n'); mimeType = 'text/csv;charset=utf-8;'; }
        else { console.error("Tipo de exportação desconhecido:", type); return; }
        const blob = new Blob([dataString], { type: mimeType }); const link = document.createElement('a');
        if (link.download !== undefined) {
            const url = URL.createObjectURL(blob);
            link.setAttribute('href', url);
            link.setAttribute('download', filename);
            link.style.visibility = 'hidden';
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            URL.revokeObjectURL(url);

            if (type === 'backup') {
                displayStatusMessage(backupStatusMessageEl, 'Backup exportado com sucesso!', 'success');
            } else if (type.includes('questions')) {
                displayStatusMessage(questionsImportExportStatusMessageEl, `Questões exportadas para ${type.split('_')[0].toUpperCase()} com sucesso!`, 'success');
            } else if (type.includes('participants')) {
                showAlert('Relatório de participantes exportado com sucesso!');
            }
        } else {
            showAlert("Download de arquivo não suportado pelo seu navegador.");
        }
    }
    function exportParticipantsHandler(format) {
        const allLocalParticipants = getFromLocalStorage('quizParticipants', []); const prizeWinnersList = getFromLocalStorage(PRIZE_WINNERS_LIST_KEY, []);
        const searchTerm = searchParticipantsInput ? searchParticipantsInput.value.toLowerCase() : ""; let filterPeriod = 'all'; if(filterPeriodRadios) filterPeriodRadios.forEach(radio => { if (radio.checked) filterPeriod = radio.value; }); const filterDays = filterDaysRangeInput ? parseInt(filterDaysRangeInput.value) || 0 : 0; const onlyPrizeWinners = filterPrizeWinnersCheckbox ? filterPrizeWinnersCheckbox.checked : false;
        let participantsToExport = allLocalParticipants;
        if (filterPeriod === 'today') { const today = new Date().toISOString().split('T')[0]; participantsToExport = participantsToExport.filter(p => p.timestamp?.startsWith(today)); }
        else if (filterPeriod === 'range' && filterDays > 0) { const cutoff = new Date(); cutoff.setDate(cutoff.getDate() - filterDays); cutoff.setHours(0,0,0,0); participantsToExport = participantsToExport.filter(p => new Date(p.timestamp) >= cutoff); }
        if (onlyPrizeWinners) { participantsToExport = participantsToExport.filter(p => prizeWinnersList.some(winner => winner.phone === p.phone) && p.score >= settings.minScoreForPrize ); }
        if (searchTerm) { participantsToExport = participantsToExport.filter(p => (p.name && p.name.toLowerCase().includes(searchTerm)) || (p.phone && p.phone.toLowerCase().includes(searchTerm))); }

        participantsToExport = sortData(participantsToExport, participantsSortKey, participantsSortDir);

        if (participantsToExport.length === 0) { showAlert("Não há participantes (com os filtros atuais) para exportar."); return; }
        const filename = `relatorio_participantes_${new Date().toISOString().split('T')[0]}.${format}`; const dataType = `${format}_participants`;
        if (format === 'csv') { const flattenedParticipants = participantsToExport.map(({ playerAttempts, ...rest }) => { const wonPrizeStatus = prizeWinnersList.some(winner => winner.phone === rest.phone) && rest.score >= settings.minScoreForPrize; return {...rest, wonPrize: wonPrizeStatus ? 'Sim' : 'Não'}; }); exportData(flattenedParticipants, filename, dataType); }
        else { exportData(participantsToExport, filename, dataType); }
    }
    // exportQuestionsHandler foi movida para admin/questionsAdmin.js
    // exportParticipantsHandler foi movida para admin/reportsAdmin.js
    // exportCompleteBackup e handleImportBackup foram movidas para admin/backupAdmin.js

    // handleImportQuestions foi movida para admin/questionsAdmin.js

    function loadAdminDataAndUpdateUI() {
        // Recarrega os dados principais do localStorage
        settings = { ...DEFAULT_SETTINGS, ...getFromLocalStorage('quizSettings', DEFAULT_SETTINGS) };
        allQuestions = getFromLocalStorage('quizQuestions', []);
        participants = getFromLocalStorage('quizParticipants', []); // Atualiza a variável global participants
        currentEventAdminData = getFromLocalStorage(QUIZ_EVENT_KEY, null);
        quizCustomizations = getFromLocalStorage(QUIZ_CUSTOMIZATIONS_KEY, DEFAULT_CUSTOMIZATIONS);

        // Aplica estilos globais que dependem desses dados
        if (settings && quizCustomizations) { // Garante que os objetos não são null/undefined
            applyCustomBackground(settings, quizCustomizations);
            applyAdminThemeCustomizations(quizCustomizations);
            loadCustomLogo(); // Recarrega o logo caso tenha sido alterado no backup
        }
         applyDevModeVisuals(devModeActive); // Garante que os visuais do modo dev sejam aplicados

        // Se uma tela estiver ativa, reinicializa-a para refletir os novos dados
        const activeScreenEl = document.querySelector('.screen.active');
        if (activeScreenEl && screenActions[activeScreenEl.id]) {
            // Força a reinicialização da tela ativa.
            // Isso fará com que a função initialize<ScreenName>Screen seja chamada novamente,
            // recarregando a UI da tela com os dados atualizados.
            // As funções de inicialização de tela (ex: initializeSettingsScreen)
            // são responsáveis por carregar os dados específicos da sua UI.
            console.log(`Reinicializando tela ativa: ${activeScreenEl.id} após carga de dados.`);
            screenActions[activeScreenEl.id]();
        }
    }
    // loadAdminStats foi movida para admin/statsAdmin.js
    // Funções loadAdminCustomizationsToUI, saveQuizCustomizationsHandler, restoreDefaultQuizCustomizations
    // foram movidas para admin/customizationAdmin.js

    function setupEventTestButtons() {
        const createSimulatedEvent = (status, enableMessages) => {
            const now = new Date();
            let startTime, endTime;
            const oneDay = 24 * 60 * 60 * 1000;

            if (status === 'before') {
                startTime = new Date(now.getTime() + oneDay);
                endTime = new Date(now.getTime() + 2 * oneDay);
            } else if (status === 'after') {
                startTime = new Date(now.getTime() - 2 * oneDay);
                endTime = new Date(now.getTime() - oneDay);
            } else {
                startTime = new Date(now.getTime() - oneDay);
                endTime = new Date(now.getTime() + oneDay);
            }

            return {
                eventName: `Evento Teste (${status} - Msgs ${enableMessages ? 'ON' : 'OFF'})`,
                startTime: startTime.toISOString().slice(0, 16),
                endTime: endTime.toISOString().slice(0, 16),
                enableOutOfPeriodMessage: enableMessages
            };
        };

        const testEventScenario = (status, enableMessages) => {
            const simulatedEvent = createSimulatedEvent(status, enableMessages);
            localStorage.setItem(QUIZ_EVENT_KEY, JSON.stringify(simulatedEvent));
            localStorage.setItem('quiz_test_action', 'goto_screen');
            localStorage.setItem('quiz_test_target', 'initial-screen');
            window.open('index.html', '_blank');
            setTimeout(() => {
                localStorage.removeItem(QUIZ_EVENT_KEY);
                currentEventAdminData = getFromLocalStorage(QUIZ_EVENT_KEY, null);
            }, 2000);
        };

        document.getElementById('test-event-before-start')?.addEventListener('click', () => testEventScenario('before', true));
        document.getElementById('test-event-after-end')?.addEventListener('click', () => testEventScenario('after', true));
        document.getElementById('test-event-during')?.addEventListener('click', () => testEventScenario('during', true));
        document.getElementById('test-event-messages-disabled-outside-period')?.addEventListener('click', () => {
            testEventScenario('before', false);
        });
    }
    setupEventTestButtons();

    (function setupOtherTestButtons() {
        const tests = {
            'test-goto-initial': ['goto_screen', 'initial-screen'],
            'test-goto-quiz': ['goto_screen', 'quiz-screen'],
            'test-goto-result': ['goto_screen', 'result-screen'],
            'test-goto-ranking': ['goto_screen', 'ranking-screen'],
            'test-goto-idle': ['goto_screen', 'idle-screen'],
            'test-modal-already-won': ['simulate_scenario', 'modal_already_won'],
            'test-modal-top3': ['simulate_scenario', 'modal_top3', { name: 'Admin Teste Top', rank: '2' }],
            'test-modal-incorrect-answers': ['simulate_scenario', 'modal_incorrect_answers'],
            'test-result-top1-winner': ['simulate_scenario', 'result_top1_winner', { name: 'Ganhador #1', score: 10, total_questions: 10, time_seconds: 30, rank: 1, won_prize: 'true' }],
            'test-result-non-top3-winner': ['simulate_scenario', 'result_non_top3_winner', { name: 'Bom Desempenho', score: 7, total_questions: 10, time_seconds: 60, rank: 4, won_prize: 'true' }],
            'test-result-loser': ['simulate_scenario', 'result_loser', { name: 'Não Premiado', score: 4, total_questions: 10, time_seconds: 90, rank: 12, won_prize: 'false' }]
        };
        for (const [id, params] of Object.entries(tests)) {
            const btn = document.getElementById(id);
            if (btn) btn.addEventListener('click', () => {
                localStorage.setItem('quiz_test_action', params[0]);
                localStorage.setItem('quiz_test_target', params[1]);
                if (params[2]) Object.entries(params[2]).forEach(([k, v]) => localStorage.setItem(`quiz_test_data_${k}`, v));
                window.open('index.html', '_blank');
            });
        }
    })();

    loadFontPreference(); // Inicializa e aplica o tamanho da fonte padrão através do uiAdmin.js

    if (decreaseFontButton) {
        decreaseFontButton.addEventListener('click', decreaseFontSize);
    }
    if (increaseFontButton) {
        increaseFontButton.addEventListener('click', increaseFontSize);
    }

    // A função attemptNavigation foi renomeada e integrada em handleNavigationWithDirtyCheck
    // As chamadas diretas a proceedWithShowScreen ou window.location.href são agora feitas através de handleNavigationWithDirtyCheck

    if (goToQuizBtn) goToQuizBtn.addEventListener('click', () => handleNavigationWithDirtyCheck('index.html', 'redirect'));
    // A lógica de login foi movida para admin/authAdmin.js
    if (adminLogoutIconBtn) { adminLogoutIconBtn.addEventListener('click', () => { if (adminLoginErrorEl) adminLoginErrorEl.classList.add('hidden'); handleNavigationWithDirtyCheck('admin-login-screen', 'showScreen'); }); }
    if(adminDashboardCards) adminDashboardCards.forEach(card => card.addEventListener('click', () => handleNavigationWithDirtyCheck(card.dataset.targetScreen, 'showScreen')));
    if(adminBackButtons) adminBackButtons.forEach(button => button.addEventListener('click', () => handleNavigationWithDirtyCheck(button.dataset.targetScreen, 'showScreen')));

    // Event listeners para a tela de questões (addQuestionFormBtn, cancelEditQuestionBtn, saveQuestionBtn, searchQuestionsInput,
    // exportQuestionsJsonBtn, exportQuestionsCsvBtn, importQuestionsBtn) foram movidos para admin/questionsAdmin.js

    // Event listeners para a tela de settings foram movidos para admin/settingsAdmin.js
    // Event listeners para exportBackupBtn e importBackupBtn foram movidos para admin/backupAdmin.js

    // Event listeners para exportCsvBtn, exportJsonBtn, deleteAllParticipantsBtn, filtros de participantes,
    // ordenação da tabela de participantes, modal de detalhes do participante e seção de filtro recolhível
    // foram movidos para admin/reportsAdmin.js

    // Event listener de ordenação da tabela de estatísticas foi movido para admin/statsAdmin.js
    // Event listeners para saveEventBtn e clearEventBtn foram movidos para admin/eventAdmin.js

    // Event listeners para saveCustomizationsBtn e restoreDefaultCustomizationsBtn
    // foram movidos para admin/customizationAdmin.js

    const formSectionsForDirtyCheck = [
        { section: 'settings', formId: 'admin-settings-screen', inputsSelector: '#admin-settings-screen input, #admin-settings-screen select' },
        { section: 'customizations', formId: 'admin-customization-screen', inputsSelector: '#admin-customization-screen input, #admin-customization-screen textarea, #admin-customization-screen select' },
        { section: 'question', formId: 'add-edit-question-form', inputsSelector: '#add-edit-question-form input, #add-edit-question-form textarea, #add-edit-question-form select' },
        { section: 'event', formId: 'admin-event-screen', inputsSelector: '#admin-event-screen input, #admin-event-screen select' }
    ];

    formSectionsForDirtyCheck.forEach(config => {
        const formElement = document.getElementById(config.formId);
        if (formElement) {
            formElement.addEventListener('input', (event) => {
                if (['INPUT', 'TEXTAREA', 'SELECT'].includes(event.target.tagName)) {
                    checkDirtyState(config.section);
                }
            });
             formElement.addEventListener('change', (event) => {
                if (['INPUT', 'SELECT'].includes(event.target.tagName)) {
                     checkDirtyState(config.section);
                }
            });
        }
    });

    window.addEventListener('beforeunload', (event) => {
        if (isSettingsDirty || isCustomizationsDirty || isQuestionFormDirty || isEventDirty) {
            event.preventDefault();
            event.returnValue = '';
        }
    });

    if (devModeToggleCheckbox) {
        devModeToggleCheckbox.checked = devModeActive;
        devModeToggleCheckbox.addEventListener('change', () => {
            devModeActive = devModeToggleCheckbox.checked;
            localStorage.setItem(DEV_MODE_LS_KEY, devModeActive);
            applyDevModeVisuals(devModeActive); // Passa o estado necessário
            showAlert(`Modo Desenvolvedor ${devModeActive ? 'ATIVADO' : 'DESATIVADO'}. A alteração no login terá efeito no próximo carregamento da página.`);
        });
    }

    // Funções relacionadas ao Dashboard Analítico (getFilteredAnalyticsParticipants, displayAnalyticsKPIs,
    // generateAndRenderAnalyticsCharts, calculateAndRenderTopQuestions, renderAnalyticsDashboard,
    // renderBarChart, renderQuestionList) foram movidas para admin/analyticsAdmin.js

    // Event listener para analyticsPeriodFilter foi movido para admin/analyticsAdmin.js


    if (devModeActive) {
        console.warn("MODO DE DESENVOLVIMENTO ATIVADO: Login pulado.");
        loadAdminDataAndUpdateUI(); // Carrega dados
        proceedWithShowScreen('admin-dashboard-screen'); // Mostra dashboard
    } else {
        // A lógica de mostrar a tela de login inicial é agora parte do fluxo normal de proceedWithShowScreen
        // se nenhuma outra tela for especificada ou se o usuário não estiver logado.
        // initAuth cuidará da interação de login.
        // A tela de login será mostrada por padrão se não houver um "usuário logado" (conceito a ser gerenciado por auth.js ou admin.js)
        // ou se o modo dev não estiver ativo.
        // A chamada proceedWithShowScreen('admin-login-screen') é feita implicitamente
        // ou explicitamente por initAuth ou pela lógica de navegação inicial.
        // Para garantir que a tela de login seja a primeira se não estiver em modo dev:
        const initialAdminLoginErrorEl = document.getElementById('admin-login-error'); // Ainda pode ser útil limpar isso
        if (initialAdminLoginErrorEl) initialAdminLoginErrorEl.classList.add('hidden');
        proceedWithShowScreen('admin-login-screen'); // Garante que a tela de login seja mostrada
    }

    // Inicializa os event listeners de autenticação
    initializeAuthEventListeners(
        adminLoginBtn,
        adminPasswordInput,
        adminLoginErrorEl,
        loadAdminDataAndUpdateUI,
        handleNavigationWithDirtyCheck
    );
});
