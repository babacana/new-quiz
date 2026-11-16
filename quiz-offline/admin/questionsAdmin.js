// admin/questionsAdmin.js
import { showAlert, showConfirm, getFromLocalStorage, saveToLocalStorage } from '../js/utils.js';
import { displayStatusMessage } from './uiAdmin.js';
import { getQuestionStatsById } from './statsAdmin.js';

// Referências DOM (serão inicializadas em initializeQuestionsScreen)
let addQuestionFormBtn, /* addEditQuestionForm, */ editQuestionIdInput, questionInput, // addEditQuestionForm foi substituído por questionEditFormSectionEl
    optionInputs = [], correctOptionRadios, questionDifficultyInput, saveQuestionBtn,
    cancelEditQuestionBtn, questionsListUl, totalQuestionsCountEl, searchQuestionsInput,
    exportQuestionsJsonBtn, exportQuestionsCsvBtn, importQuestionsFileEl, importQuestionsBtn,
    addQuestionsModeCheckbox, questionsImportExportStatusMessageEl,
    // Elementos para pré-visualização da questão
    previewQuestionBtn, questionPreviewModal, previewQuestionTextEl,
    previewOptionsListEl, previewQuestionImageContainerEl, closePreviewModalBtns = [],
    // Elementos para Ações em Lote
    selectAllQuestionsCheckbox, deleteSelectedQuestionsBtn, disableSelectedQuestionsBtn,
    selectedQuestionsCountSpan, explicitSelectedCountTextEl,
    // Elementos da Nova Barra de Ferramentas e Filtros
    sortQuestionsBySelect, advancedFiltersBtn, advancedFiltersContainer,
    filterDifficultySelect, filterStatusSelect, // Adicionado filterStatusSelect
    applyAdvancedFiltersBtn, clearAdvancedFiltersBtn, activeFiltersCountSpan,
    itemsPerPageSelect, questionsPaginationControls, questionsPrevPageBtn, questionsNextPageBtn, questionsPageInfo,
    // Elementos do Modal de Detalhes/Ações da Questão
    questionDetailsModal, questionDetailsViewSectionEl, questionEditFormSectionEl, // Novos elementos para controlar seções do modal
    detailQId, detailQText, detailQOptionsCount,
    detailQOptionsList, detailQDifficulty,
    // Spans para estatísticas da questão no modal
    detailQStatTotal, detailQStatCorrect, detailQStatIncorrect, detailQStatAccuracy, detailQStatsContainer,
    questionActionsModalContainer,
    closeQuestionDetailsModalBtns = [];


// Estado para Ações em Lote e Paginação/Filtros
let selectedQuestionIds = [];
let currentPage = 1;
let itemsPerPage = 25; 
let currentSort = { key: 'id', direction: 'asc' }; 
let currentAdvancedFilters = {};

// Callbacks e referências de estado de admin.js
let localAllQuestionsRef; // Declarada no escopo do módulo
let localIsQuestionFormDirtyRef;
let localInitialQuestionFormDataRef;

// Flags para rastrear se os listeners dos modais foram configurados
let detailsModalListenersAttached = false;
let previewModalListenersAttached = false;
let formModalListenersAttached = false;
let localResetDirtyFlagAndCaptureState;
let localCheckDirtyState;
let localLoadAdminStats; 
let localExportDataFn; 

const ID_MIGRATION_KEY = 'quizQuestionNumericIdsMigrated';
const ARCHIVED_QUESTIONS_MIGRATION_KEY = 'quizQuestionsArchivedMigrated_to_disabled';

// Função para garantir que os listeners dos modais estejam configurados
function _ensureModalEventListeners(modalType) {
    if (modalType === 'details' && !detailsModalListenersAttached) {
        if (typeof questionDetailsModal === 'undefined' || !questionDetailsModal) questionDetailsModal = document.getElementById('question-details-modal');
        if (typeof closeQuestionDetailsModalBtns === 'undefined' || closeQuestionDetailsModalBtns.length === 0) {
            closeQuestionDetailsModalBtns = document.querySelectorAll('[data-close-modal="question-details-modal"], #question-details-modal .modal-close-icon-btn');
        }

        if (closeQuestionDetailsModalBtns && closeQuestionDetailsModalBtns.length > 0) {
            closeQuestionDetailsModalBtns.forEach(btn => {
                btn.removeEventListener('click', closeQuestionActionsModal); // Evitar duplicidade
                btn.addEventListener('click', closeQuestionActionsModal);
            });
        }
        if (questionDetailsModal) {
            // Remover listener antigo para evitar duplicidade, se houver uma forma de nomear a função anônima ou refatorar
            // Por ora, a adição pode ocorrer múltiplas vezes se não gerenciado externamente, mas o efeito é o mesmo.
            // Idealmente, a lógica de click no overlay seria única.
            questionDetailsModal.addEventListener('click', (event) => {
                if (event.target === questionDetailsModal) {
                    closeQuestionActionsModal();
                }
            });
        }
        detailsModalListenersAttached = true;
    }

    if (modalType === 'preview' && !previewModalListenersAttached) {
        if (typeof questionPreviewModal === 'undefined' || !questionPreviewModal) questionPreviewModal = document.getElementById('questionPreviewModal');
        if (typeof closePreviewModalBtns === 'undefined' || closePreviewModalBtns.length === 0) {
            closePreviewModalBtns = document.querySelectorAll('#questionPreviewModal .close-preview-btn');
        }

        if (closePreviewModalBtns && closePreviewModalBtns.length > 0) {
            closePreviewModalBtns.forEach(btn => {
                btn.removeEventListener('click', closeQuestionPreviewModal); // Evitar duplicidade
                btn.addEventListener('click', closeQuestionPreviewModal);
            });
        }
        if (questionPreviewModal) {
            questionPreviewModal.addEventListener('click', (event) => {
                if (event.target === questionPreviewModal) {
                    closeQuestionPreviewModal();
                }
            });
        }
        previewModalListenersAttached = true;
    }

    if (modalType === 'form' && !formModalListenersAttached) {
        // Botões dentro da seção de edição do question-details-modal
        if (typeof previewQuestionBtn === 'undefined' || !previewQuestionBtn) previewQuestionBtn = document.getElementById('previewQuestionBtn'); // Preview do formulário
        if (typeof saveQuestionBtn === 'undefined' || !saveQuestionBtn) saveQuestionBtn = document.getElementById('save-question-btn');
        if (typeof cancelEditQuestionBtn === 'undefined' || !cancelEditQuestionBtn) cancelEditQuestionBtn = document.getElementById('cancel-edit-question-btn');
        // editQuestionIdInput é usado na lógica do cancel, garantir que está definido
        if (typeof editQuestionIdInput === 'undefined' || !editQuestionIdInput) editQuestionIdInput = document.getElementById('edit-question-id');


        if (previewQuestionBtn) {
            previewQuestionBtn.removeEventListener('click', renderQuestionPreview); // Evitar duplicidade
            previewQuestionBtn.addEventListener('click', renderQuestionPreview);
        }
        if (saveQuestionBtn) {
            saveQuestionBtn.removeEventListener('click', _saveQuestionHandler); // Assumindo que _saveQuestionHandler pode ser referenciada diretamente
            saveQuestionBtn.addEventListener('click', () => _saveQuestionHandler(false)); // Ou usar wrapper se _saveQuestionHandler precisar de contexto específico
        }
        if (cancelEditQuestionBtn) {
            const cancelHandler = () => {
                const isAddingNew = editQuestionIdInput ? !editQuestionIdInput.value : true; // Checar se editQuestionIdInput existe
                
                // Verificar se as refs para dirty checking existem antes de usá-las
                const isDirty = localIsQuestionFormDirtyRef && typeof localIsQuestionFormDirtyRef.value === 'boolean' ? localIsQuestionFormDirtyRef.value : false;

                if (isDirty) {
                    showConfirm('Você tem alterações não salvas. Deseja descartá-las?', {
                        onDiscardAndProceed: () => {
                            if (localResetDirtyFlagAndCaptureState) localResetDirtyFlagAndCaptureState('question', _getQuestionFormDataFromDOM());
                            if (isAddingNew) {
                                closeQuestionActionsModal();
                            } else {
                                _switchToViewModeInModal();
                            }
                        }
                    }, 'warning', { discardButtonText: "Descartar", confirmButtonText: "Continuar Editando" });
                } else {
                    if (isAddingNew) {
                        closeQuestionActionsModal();
                    } else {
                        _switchToViewModeInModal();
                    }
                }
            };
            cancelEditQuestionBtn.removeEventListener('click', cancelHandler); // Evitar duplicidade
            cancelEditQuestionBtn.addEventListener('click', cancelHandler);
        }
        formModalListenersAttached = true;
    }
}


function _getNextNumericId() {
    const questions = localAllQuestionsRef.value || [];
    if (questions.length === 0) {
        return 1;
    }
    const maxId = questions.reduce((max, q) => {
        const idNum = parseInt(q.id, 10);
        return (!isNaN(idNum) && idNum > max) ? idNum : max;
    }, 0);
    return maxId + 1;
}

function _migrateToNumericIds() {
    const alreadyMigrated = getFromLocalStorage(ID_MIGRATION_KEY, false);
    if (alreadyMigrated) {
        return;
    }

    let questions = getFromLocalStorage('quizQuestions', []);
    if (questions.length === 0) {
        saveToLocalStorage(ID_MIGRATION_KEY, true);
        return;
    }

    if (questions.length > 0 && typeof questions[0].id === 'number') {
        saveToLocalStorage(ID_MIGRATION_KEY, true);
        console.log("Migração de IDs para numérico já parece ter sido feita ou não é necessária. Flag setada.");
        return;
    }
    
    console.log("Iniciando migração de IDs de questões para formato numérico sequencial...");
    questions.sort((a, b) => {
        const dateA = new Date(a.createdAt || 0);
        const dateB = new Date(b.createdAt || 0);
        return dateA - dateB;
    });

    let numericIdCounter = 1;
    const migratedQuestions = questions.map(q => {
        const newQ = { ...q, id: numericIdCounter };
        numericIdCounter++;
        return newQ;
    });

    localAllQuestionsRef.value = migratedQuestions; 
    saveToLocalStorage('quizQuestions', migratedQuestions);
    saveToLocalStorage(ID_MIGRATION_KEY, true);
    console.log(`Migração de ${migratedQuestions.length} IDs de questões concluída.`);
    showAlert('Os IDs das questões foram atualizados para um formato numérico sequencial.', 'info', 5000);
}

function _migrateArchivedToDisabled() {
    const alreadyMigrated = getFromLocalStorage(ARCHIVED_QUESTIONS_MIGRATION_KEY, false);
    if (alreadyMigrated) {
        return;
    }

    let questions = getFromLocalStorage('quizQuestions', []);
    if (questions.length === 0 || !questions.some(q => q.hasOwnProperty('isArchived'))) {
        saveToLocalStorage(ARCHIVED_QUESTIONS_MIGRATION_KEY, true);
        console.log("Migração de questões arquivadas não necessária ou já concluída (sem propriedade isArchived).");
        return;
    }

    console.log("Iniciando migração de questões arquivadas para o estado 'desabilitado'...");
    let migrationCount = 0;
    const migratedQuestions = questions.map(q => {
        const newQ = {...q}; 
        if (newQ.isArchived === true) {
            newQ.isDisabled = true;
            delete newQ.isArchived;
            newQ.modifiedAt = new Date().toISOString();
            migrationCount++;
        } else if (newQ.hasOwnProperty('isArchived')) { 
            delete newQ.isArchived;
        }
        return newQ;
    });

    localAllQuestionsRef.value = migratedQuestions;
    saveToLocalStorage('quizQuestions', migratedQuestions);
    saveToLocalStorage(ARCHIVED_QUESTIONS_MIGRATION_KEY, true);
    if (migrationCount > 0) {
        showAlert(`${migrationCount} questão(ões) arquivada(s) foram migradas para o estado 'desabilitado'. A funcionalidade de arquivamento foi removida.`, 'info', 7000);
    } else {
        console.log("Nenhuma questão arquivada encontrada para migrar. Propriedade 'isArchived' removida onde aplicável.");
    }
}


function _getQuestionFormDataFromDOM() {
    return JSON.stringify({
        text: questionInput.value,
        options: optionInputs.map(opt => opt.value),
        correct: Array.from(correctOptionRadios).findIndex(r => r.checked),
        difficulty: questionDifficultyInput.value
    });
}

// A função _setQuestionFormVisibility foi removida/substituída pela lógica de controle de seções no modal.
// A lógica de limpar o formulário para nova questão será tratada em _openModalForAddingQuestion.
// A lógica de esconder o formulário e mostrar o botão "Adicionar" não é mais necessária da mesma forma.

function _clearAndResetQuestionForm() {
    // Garantir que os elementos do formulário de edição estejam carregados
    if (typeof editQuestionIdInput === 'undefined' || !editQuestionIdInput) editQuestionIdInput = document.getElementById('edit-question-id');
    if (typeof questionInput === 'undefined' || !questionInput) questionInput = document.getElementById('question-input');
    if (typeof optionInputs === 'undefined' || optionInputs.length === 0 || !optionInputs.every(i => i && typeof i === 'object')) {
        optionInputs = [
            document.getElementById('option1-input'),
            document.getElementById('option2-input'),
            document.getElementById('option3-input'),
            document.getElementById('option4-input')
        ];
    }
    if (typeof correctOptionRadios === 'undefined' || !correctOptionRadios || correctOptionRadios.length === 0) {
        correctOptionRadios = document.getElementsByName('correct-option');
    }
    if (typeof questionDifficultyInput === 'undefined' || !questionDifficultyInput) {
        questionDifficultyInput = document.getElementById('question-difficulty-input');
    }

    if (questionInput) questionInput.value = '';
    if (optionInputs) optionInputs.forEach(input => { if (input) input.value = ''; });
    if (correctOptionRadios && correctOptionRadios.length > 0 && correctOptionRadios[0]) correctOptionRadios[0].checked = true;
    if (questionDifficultyInput) questionDifficultyInput.value = 'facil';
    if (editQuestionIdInput) editQuestionIdInput.value = '';
    
    // As referências localInitialQuestionFormDataRef e localIsQuestionFormDirtyRef são esperadas
    // de serem definidas pela função initializeQuestionsScreen. Se não estiverem,
    // um aviso pode ser útil, mas o erro principal é a falta dos elementos do DOM para _getQuestionFormDataFromDOM.
    // Se localInitialQuestionFormDataRef e localIsQuestionFormDirtyRef não foram inicializados
    // (por exemplo, ao abrir o modal de um contexto que não chamou initializeQuestionsScreen),
    // o dirty checking não será funcional para este caso, o que é aceitável.
    // Apenas tentamos atualizar se as referências estiverem prontas.
    if (localInitialQuestionFormDataRef && typeof localInitialQuestionFormDataRef.value !== 'undefined') {
        localInitialQuestionFormDataRef.value = _getQuestionFormDataFromDOM();
    }

    if (localIsQuestionFormDirtyRef && typeof localIsQuestionFormDirtyRef.value !== 'undefined') {
        localIsQuestionFormDirtyRef.value = false;
    }
}

function _switchToViewModeInModal() {
    if (questionDetailsViewSectionEl) questionDetailsViewSectionEl.classList.remove('hidden');
    if (questionEditFormSectionEl) questionEditFormSectionEl.classList.add('hidden');
    _clearAndResetQuestionForm(); // Garante que o formulário esteja limpo ao voltar para visualização
}

function _switchToEditModeInModal(questionId = null) {
    // Garantir que os elementos do formulário de edição estejam carregados
    if (typeof editQuestionIdInput === 'undefined' || !editQuestionIdInput) editQuestionIdInput = document.getElementById('edit-question-id');
    if (typeof questionInput === 'undefined' || !questionInput) questionInput = document.getElementById('question-input');
    if (typeof optionInputs === 'undefined' || optionInputs.length === 0 || !optionInputs.every(i => i && typeof i === 'object')) {
        optionInputs = [
            document.getElementById('option1-input'),
            document.getElementById('option2-input'),
            document.getElementById('option3-input'),
            document.getElementById('option4-input')
        ];
    }
    if (typeof correctOptionRadios === 'undefined' || !correctOptionRadios || correctOptionRadios.length === 0) {
        correctOptionRadios = document.getElementsByName('correct-option');
    }
    if (typeof questionDifficultyInput === 'undefined' || !questionDifficultyInput) {
        questionDifficultyInput = document.getElementById('question-difficulty-input');
    }
    // Garantir que os elementos de visualização/edição do modal estejam carregados (reforço da lógica em _openQuestionActionsModal)
    if (typeof questionDetailsViewSectionEl === 'undefined' || !questionDetailsViewSectionEl) questionDetailsViewSectionEl = document.getElementById('question-details-view-section');
    if (typeof questionEditFormSectionEl === 'undefined' || !questionEditFormSectionEl) questionEditFormSectionEl = document.getElementById('question-edit-form-section');


    const questionToEdit = questionId ? localAllQuestionsRef.value.find(q => q.id === questionId) : null;

    if (questionDetailsViewSectionEl) questionDetailsViewSectionEl.classList.add('hidden');
    if (questionEditFormSectionEl) questionEditFormSectionEl.classList.remove('hidden');

    if (questionToEdit) { // Populando para edição
        if (editQuestionIdInput) editQuestionIdInput.value = questionToEdit.id;
        if (questionInput) questionInput.value = questionToEdit.text;
        if (questionDifficultyInput) questionDifficultyInput.value = questionToEdit.difficulty || 'facil';
        
        const options = questionToEdit.options || [];
        if (optionInputs) {
            optionInputs.forEach((input, index) => { if (input) input.value = options[index] || ''; });
        }
        if (correctOptionRadios && correctOptionRadios.length > 0) {
            Array.from(correctOptionRadios).forEach(radio => radio.checked = false);
            if (typeof questionToEdit.correct === 'number' && questionToEdit.correct >= 0 && questionToEdit.correct < options.length && questionToEdit.correct < correctOptionRadios.length) {
                correctOptionRadios[questionToEdit.correct].checked = true;
            } else if (options.length > 0 && correctOptionRadios.length > 0) {
                correctOptionRadios[0].checked = true; // Default to first if something is off
            }
        }
    } else { // Preparando para nova questão
        _clearAndResetQuestionForm();
    }

    // Apenas atualiza as refs de dirty state se estiverem operacionais
    if (localInitialQuestionFormDataRef && typeof localInitialQuestionFormDataRef.value !== 'undefined') {
        localInitialQuestionFormDataRef.value = _getQuestionFormDataFromDOM();
    }
    if (localIsQuestionFormDirtyRef && typeof localIsQuestionFormDirtyRef.value !== 'undefined') {
        localIsQuestionFormDirtyRef.value = false;
    }

    if (questionEditFormSectionEl?.scrollIntoView) {
         setTimeout(() => { questionEditFormSectionEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); }, 50);
    }
}

function _updateBatchActionButtonsState() {
    const count = selectedQuestionIds.length;
    if (deleteSelectedQuestionsBtn && selectedQuestionsCountSpan) {
        deleteSelectedQuestionsBtn.disabled = count === 0;
        selectedQuestionsCountSpan.textContent = count;
    }
    if (disableSelectedQuestionsBtn) {
        disableSelectedQuestionsBtn.disabled = count === 0;
    }
    if (explicitSelectedCountTextEl) {
        explicitSelectedCountTextEl.textContent = `${count} questão(ões) selecionada(s)`;
        explicitSelectedCountTextEl.style.display = count > 0 ? 'inline' : 'none';
    }
    if (selectAllQuestionsCheckbox && questionsListUl) {
        const visibleCheckboxes = questionsListUl.querySelectorAll('.question-select-checkbox');
        const checkedVisibleCheckboxes = questionsListUl.querySelectorAll('.question-select-checkbox:checked');
        if (visibleCheckboxes.length > 0) {
            selectAllQuestionsCheckbox.checked = checkedVisibleCheckboxes.length === visibleCheckboxes.length;
            selectAllQuestionsCheckbox.indeterminate = checkedVisibleCheckboxes.length > 0 && checkedVisibleCheckboxes.length < visibleCheckboxes.length;
        } else {
            selectAllQuestionsCheckbox.checked = false;
            selectAllQuestionsCheckbox.indeterminate = false;
        }
    }
}

function _handleQuestionSelectionChange(event) {
    const questionId = parseInt(event.target.dataset.questionId, 10); 
    if (event.target.checked) {
        if (!selectedQuestionIds.includes(questionId)) {
            selectedQuestionIds.push(questionId);
        }
    } else {
        selectedQuestionIds = selectedQuestionIds.filter(id => id !== questionId);
    }
    _updateBatchActionButtonsState();
}

function _handleSelectAllQuestionsChange(event) {
    const isChecked = event.target.checked;
    const visibleCheckboxes = questionsListUl.querySelectorAll('.question-select-checkbox');
    visibleCheckboxes.forEach(checkbox => {
        checkbox.checked = isChecked;
        const questionId = parseInt(checkbox.dataset.questionId, 10); 
        if (isChecked) {
            if (!selectedQuestionIds.includes(questionId)) {
                selectedQuestionIds.push(questionId);
            }
        } else {
            selectedQuestionIds = selectedQuestionIds.filter(id => id !== questionId);
        }
    });
    if (!isChecked) {
         const visibleQuestionIds = Array.from(visibleCheckboxes).map(cb => parseInt(cb.dataset.questionId, 10));
         selectedQuestionIds = selectedQuestionIds.filter(id => !visibleQuestionIds.includes(id));
    }
    _updateBatchActionButtonsState();
}

function _applyAllFiltersAndSort(questions) {
    let result = [...questions];
    const searchTerm = searchQuestionsInput ? searchQuestionsInput.value.toLowerCase() : "";

    if (searchTerm) {
        result = result.filter(q =>
            q.text.toLowerCase().includes(searchTerm) ||
            (q.options && q.options.some(opt => typeof opt === 'string' && opt.toLowerCase().includes(searchTerm))) ||
            (q.id && String(q.id).toLowerCase().includes(searchTerm)) 
        );
    }

    if (currentAdvancedFilters.difficulty && currentAdvancedFilters.difficulty.length > 0) {
        result = result.filter(q => currentAdvancedFilters.difficulty.includes(q.difficulty));
    }
    
    // Adicionar filtro por status
    const statusFilterValue = currentAdvancedFilters.status;
    if (statusFilterValue === 'enabled') {
        result = result.filter(q => !q.isDisabled);
    } else if (statusFilterValue === 'disabled') {
        result = result.filter(q => q.isDisabled);
    }
    // Se 'all' ou indefinido, não faz nada

    result.sort((a, b) => {
        let valA, valB;
        switch (currentSort.key) {
            case 'text':
                valA = a.text.toLowerCase();
                valB = b.text.toLowerCase();
                break;
            case 'difficulty':
                const diffOrder = { 'facil': 1, 'moderado': 2, 'dificil': 3 };
                valA = diffOrder[a.difficulty] || 0;
                valB = diffOrder[b.difficulty] || 0;
                break;
            default: // Padrão para texto se a chave de ordenação for desconhecida ou 'id' (removido)
                valA = a.text.toLowerCase();
                valB = b.text.toLowerCase();
        }

        if (valA < valB) return currentSort.direction === 'asc' ? -1 : 1;
        if (valA > valB) return currentSort.direction === 'asc' ? 1 : -1;
        return 0;
    });

    return result;
}


function _renderQuestionsList(questionsToRender) {
    if (!questionsListUl || !totalQuestionsCountEl) return;
    questionsListUl.innerHTML = ''; 

    if (questionsToRender.length === 0) {
        questionsListUl.innerHTML = `<li class="empty-list-message" style="padding: 20px; text-align: center; color: #aaa;">Nenhuma questão encontrada com os filtros atuais.</li>`;
        return;
    }

    const fragment = document.createDocumentFragment();
    questionsToRender.forEach((q) => { 
        const li = document.createElement('li');
        li.className = 'question-list-item-as-row';
        li.dataset.questionId = q.id; 
        if (q.isDisabled) { 
            li.classList.add('disabled-question');
        }

        const difficultyText = q.difficulty ? q.difficulty.charAt(0).toUpperCase() + q.difficulty.slice(1) : 'N/A';

        li.innerHTML = `
            <div class="question-table-cell cell-select">
                <input type="checkbox" class="question-select-checkbox" data-question-id="${q.id}" ${selectedQuestionIds.includes(q.id) ? 'checked' : ''}>
            </div>
            <div class="question-table-cell cell-text" title="${q.text}">${q.text.substring(0, 100)}${q.text.length > 100 ? '...' : ''}</div>
            <div class="question-table-cell cell-difficulty">
                <span class="question-item-difficulty difficulty-${q.difficulty || 'na'}">${difficultyText}</span>
            </div>
        `;
        fragment.appendChild(li);
    });
    questionsListUl.appendChild(fragment);
    
    questionsListUl.querySelectorAll('.question-list-item-as-row').forEach(row => {
        row.addEventListener('click', (event) => {
            const target = event.target;
            const isCheckbox = target.matches('.question-select-checkbox');
            
            if (!isCheckbox) { 
                const questionId = row.dataset.questionId; // Usar a string diretamente
                if (questionId) {
                    _openQuestionActionsModal(questionId); 
                }
            }
        });
    });
    questionsListUl.querySelectorAll('.question-select-checkbox').forEach(cb => cb.addEventListener('change', _handleQuestionSelectionChange));

    _updateBatchActionButtonsState();
}


function _updateSortHeaders() {
    const headerCells = document.querySelectorAll('#questions-table-view .question-table-header-row .header-cell[data-sort-key]');
    headerCells.forEach(cell => {
        cell.classList.remove('sort-asc', 'sort-desc');
        if (cell.dataset.sortKey === currentSort.key) {
            cell.classList.add(currentSort.direction === 'asc' ? 'sort-asc' : 'sort-desc');
        }
    });
}

function _handleSortHeaderClick(event) {
    const newKey = event.currentTarget.dataset.sortKey;
    if (!newKey) return;

    if (currentSort.key === newKey) {
        currentSort.direction = currentSort.direction === 'asc' ? 'desc' : 'asc';
    } else {
        currentSort.key = newKey;
        currentSort.direction = 'asc'; 
    }
    if (sortQuestionsBySelect) {
        const selectValue = `${currentSort.key}_${currentSort.direction}`;
        if (Array.from(sortQuestionsBySelect.options).some(opt => opt.value === selectValue)) {
            sortQuestionsBySelect.value = selectValue;
        }
    }

    currentPage = 1;
    _loadAdminQuestions();
}


function _loadAdminQuestions() {
    if (!localAllQuestionsRef || !localAllQuestionsRef.value) return;

    const allFilteredAndSortedQuestions = _applyAllFiltersAndSort(localAllQuestionsRef.value);
    
    if(totalQuestionsCountEl) totalQuestionsCountEl.textContent = allFilteredAndSortedQuestions.length;

    const startIndex = (currentPage - 1) * itemsPerPage;
    const endIndex = startIndex + itemsPerPage;
    const paginatedQuestions = allFilteredAndSortedQuestions.slice(startIndex, endIndex);

    _renderQuestionsList(paginatedQuestions);
    _updatePaginationControls(allFilteredAndSortedQuestions.length);
    _updateSortHeaders(); 
}


function _updatePaginationControls(totalItems) {
    if (!questionsPaginationControls || !questionsPrevPageBtn || !questionsNextPageBtn || !questionsPageInfo) return;

    const totalPages = Math.ceil(totalItems / itemsPerPage);
    currentPage = Math.max(1, Math.min(currentPage, totalPages || 1)); 

    questionsPageInfo.textContent = `Página ${currentPage} de ${totalPages || 1}`;
    questionsPrevPageBtn.disabled = currentPage === 1;
    questionsNextPageBtn.disabled = currentPage === totalPages || totalPages === 0;

    if (totalPages <= 1) {
        questionsPaginationControls.classList.add('hidden');
    } else {
        questionsPaginationControls.classList.remove('hidden');
    }
}

// A função _handleViewQuestionStats foi removida pois as estatísticas são carregadas automaticamente no _openQuestionActionsModal.

// A função _toggleQuestionArchivedState foi removida.

function _handlePreviewQuestionFromList(questionId) {
    _ensureModalEventListeners('preview'); // Garante listeners do modal de preview

    // Garantir que os elementos do modal de preview estejam carregados
    if (typeof previewQuestionTextEl === 'undefined' || !previewQuestionTextEl) previewQuestionTextEl = document.getElementById('previewQuestionText');
    if (typeof previewOptionsListEl === 'undefined' || !previewOptionsListEl) previewOptionsListEl = document.getElementById('previewOptionsList');
    if (typeof previewQuestionImageContainerEl === 'undefined' || !previewQuestionImageContainerEl) previewQuestionImageContainerEl = document.getElementById('previewQuestionImageContainer');
    if (typeof questionPreviewModal === 'undefined' || !questionPreviewModal) questionPreviewModal = document.getElementById('questionPreviewModal');


    const question = localAllQuestionsRef.value.find(q => q.id === questionId);
    if (!question || !previewQuestionTextEl || !previewOptionsListEl || !previewQuestionImageContainerEl) return;

    previewQuestionTextEl.textContent = question.text;
    previewQuestionImageContainerEl.innerHTML = ''; 

    previewOptionsListEl.innerHTML = '';
    question.options.forEach((optText, index) => {
        const li = document.createElement('li');
        li.textContent = optText;
        if (index === question.correct) {
            li.classList.add('correct-preview');
        }
        previewOptionsListEl.appendChild(li);
    });

    if (questionPreviewModal) {
        questionPreviewModal.classList.remove('hidden');
    }
    // closeQuestionActionsModal(); // Removido para não fechar o modal de detalhes
}

function _openQuestionActionsModal(questionId) {
    _ensureModalEventListeners('details');
    _ensureModalEventListeners('form');

    // Garantir que as referências DOM do modal estejam carregadas, caso initializeQuestionsScreen não tenha sido chamada
    if (typeof questionDetailsModal === 'undefined' || !questionDetailsModal) questionDetailsModal = document.getElementById('question-details-modal');
    if (typeof detailQId === 'undefined' || !detailQId) detailQId = document.getElementById('detail-q-id');
    if (typeof detailQText === 'undefined' || !detailQText) detailQText = document.getElementById('detail-q-text');
    if (typeof detailQOptionsCount === 'undefined' || !detailQOptionsCount) detailQOptionsCount = document.getElementById('detail-q-options-count');
    if (typeof detailQOptionsList === 'undefined' || !detailQOptionsList) detailQOptionsList = document.getElementById('detail-q-options-list');
    if (typeof detailQDifficulty === 'undefined' || !detailQDifficulty) detailQDifficulty = document.getElementById('detail-q-difficulty');
    if (typeof detailQStatsContainer === 'undefined' || !detailQStatsContainer) detailQStatsContainer = document.getElementById('detail-q-stats-container');
    if (typeof detailQStatTotal === 'undefined' || !detailQStatTotal) detailQStatTotal = document.getElementById('detail-q-stat-total');
    if (typeof detailQStatCorrect === 'undefined' || !detailQStatCorrect) detailQStatCorrect = document.getElementById('detail-q-stat-correct');
    if (typeof detailQStatIncorrect === 'undefined' || !detailQStatIncorrect) detailQStatIncorrect = document.getElementById('detail-q-stat-incorrect');
    if (typeof detailQStatAccuracy === 'undefined' || !detailQStatAccuracy) detailQStatAccuracy = document.getElementById('detail-q-stat-accuracy');
    if (typeof questionActionsModalContainer === 'undefined' || !questionActionsModalContainer) questionActionsModalContainer = document.getElementById('question-actions-modal-container');

    const question = localAllQuestionsRef.value.find(q => String(q.id) === String(questionId)); // Comparar como string ou converter
    if (!question || !questionDetailsModal) { // questionDetailsModal deve estar definido agora se existir no DOM
        console.error("Questão não encontrada ou modal base não existe no DOM. ID:", questionId);
        if (!questionDetailsModal) { // Adiciona log específico se o modal principal ainda não foi encontrado
            console.error("Falha crítica: O elemento principal do modal (question-details-modal) não foi encontrado no DOM.");
        }
        return;
    }

    // Resetar e ocultar seção de estatísticas
    // const statsContainer = document.getElementById('detail-q-stats-container'); // Removido: detailQStatsContainer é usado diretamente
    if (detailQStatsContainer) { // Usar a variável de módulo que foi inicializada acima
        detailQStatsContainer.style.display = 'none';
        // As linhas abaixo que buscavam por ID foram removidas pois as variáveis de módulo são usadas:
        // const totalEl = document.getElementById('detail-q-stat-total');
        // const correctEl = document.getElementById('detail-q-stat-correct');
        // const incorrectEl = document.getElementById('detail-q-stat-incorrect');
        // const accuracyEl = document.getElementById('detail-q-stat-accuracy');
        if (detailQStatTotal) detailQStatTotal.textContent = 'N/A';
        if (detailQStatCorrect) detailQStatCorrect.textContent = 'N/A';
        if (detailQStatIncorrect) detailQStatIncorrect.textContent = 'N/A';
        if (detailQStatAccuracy) detailQStatAccuracy.textContent = 'N/A';
    }

    // Popular a seção de visualização
    if (detailQId) detailQId.textContent = question.id;
    if (detailQText) detailQText.textContent = question.text;
    if (detailQOptionsCount) detailQOptionsCount.textContent = question.options?.length || 0;

    if (detailQOptionsList) {
        detailQOptionsList.innerHTML = '';
        if (question.options && question.options.length > 0) {
            question.options.forEach((opt, index) => {
                const li = document.createElement('li');
                li.textContent = opt;
                if (index === question.correct) {
                    li.classList.add('correct-answer-detail');
                }
                detailQOptionsList.appendChild(li);
            });
        } else {
            detailQOptionsList.innerHTML = '<li>Nenhuma alternativa cadastrada.</li>';
        }
    }

    if (detailQDifficulty) {
        const difficultyValue = question.difficulty || 'na';
        const difficultyText = difficultyValue !== 'na' ? difficultyValue.charAt(0).toUpperCase() + difficultyValue.slice(1) : 'N/A';
        detailQDifficulty.textContent = difficultyText;
        detailQDifficulty.className = 'question-item-difficulty';
        detailQDifficulty.classList.add(`difficulty-${difficultyValue}`);
    }

    // Carregar e exibir estatísticas da questão
    if (detailQStatsContainer) {
        detailQStatsContainer.style.display = 'block'; // Garante que o container de stats seja visível
        const stats = getQuestionStatsById(question.id); // Chama a função importada
        if (detailQStatTotal) detailQStatTotal.textContent = stats.total ?? 'N/A';
        if (detailQStatCorrect) detailQStatCorrect.textContent = stats.correct ?? 'N/A';
        if (detailQStatIncorrect) detailQStatIncorrect.textContent = stats.incorrect ?? 'N/A';
        if (detailQStatAccuracy) detailQStatAccuracy.textContent = stats.accuracy ?? 'N/A';
    } else {
        console.warn("Elemento detailQStatsContainer não encontrado para exibir estatísticas.");
    }


    // Configurar botões de ação na seção de visualização
    // questionActionsModalContainer já foi inicializado no topo da função.
    // Apenas verificamos se ele foi encontrado com sucesso.
    if (!questionActionsModalContainer) {
        console.error("Container para ações do modal (question-actions-modal-container) não encontrado no DOM.");
        return; // Retorna se o container essencial não for encontrado
    }
    questionActionsModalContainer.innerHTML = '';

    const actions = [
        { label: 'Editar Questão', class: 'btn', handler: () => _switchToEditModeInModal(question.id) },
        { label: 'Pré-visualizar (Quiz)', class: 'btn-secondary', handler: () => _handlePreviewQuestionFromList(question.id) },
        { label: question.isDisabled ? 'Habilitar' : 'Desabilitar', class: `btn-secondary ${question.isDisabled ? 'action-btn-enable' : 'action-btn-disable'}`, handler: () => _toggleQuestionDisabledState(question.id) },
        // O botão "Ver Estatísticas" foi removido. As estatísticas são carregadas automaticamente.
        // O botão "Excluir Questão" agora ocupa essa posição na ordem visual, conforme solicitado.
        { label: 'Excluir Questão', class: 'btn-danger', handler: () => _handleDeleteQuestion(question.id) }
    ];

    actions.forEach(action => {
        const button = document.createElement('button');
        button.textContent = action.label;
        button.className = action.class;
        if (action.class.includes('action-btn-enable')) button.classList.add('btn-success');
        if (action.class.includes('action-btn-disable')) button.classList.add('btn-warning');
        // button.style.marginBottom = '10px'; // REMOVIDO - O espaçamento agora é controlado pelo 'gap' da grade CSS
        button.addEventListener('click', action.handler);
        questionActionsModalContainer.appendChild(button);
    });
    
    _switchToViewModeInModal(); // Garante que a visualização de detalhes seja mostrada e o formulário oculto
    if (questionDetailsModal) questionDetailsModal.classList.remove('hidden');
}


function _openModalForAddingQuestion() {
    _ensureModalEventListeners('details');
    _ensureModalEventListeners('form');

    if (typeof questionDetailsModal === 'undefined' || !questionDetailsModal) questionDetailsModal = document.getElementById('question-details-modal');
    if (typeof questionActionsModalContainer === 'undefined' || !questionActionsModalContainer) questionActionsModalContainer = document.getElementById('question-actions-modal-container');


    if (!questionDetailsModal) {
        console.error("Modal de detalhes da questão não encontrado para adicionar nova questão.");
        return;
    }
    const modalTitleEl = questionDetailsModal.querySelector('.modal-title');
    if (modalTitleEl) modalTitleEl.textContent = "Adicionar Nova Questão";

    _switchToEditModeInModal(null); // Passa null para indicar que é uma nova questão

    // Limpar container de ações da visualização, pois não são relevantes para nova questão
    if (questionActionsModalContainer) questionActionsModalContainer.innerHTML = '';
    
    if (questionDetailsModal) questionDetailsModal.classList.remove('hidden');
}


function closeQuestionActionsModal() {
    if (questionDetailsModal) {
        questionDetailsModal.classList.add('hidden');
        const modalTitleEl = questionDetailsModal.querySelector('.modal-title');
        if (modalTitleEl) modalTitleEl.textContent = "Detalhes da Questão"; // Restaura título padrão
    }
    _switchToViewModeInModal(); // Garante que o formulário seja oculto e a visualização mostrada
    // Apenas chama o reset do dirty state se a função de callback estiver disponível
    if (typeof localResetDirtyFlagAndCaptureState === 'function') {
        localResetDirtyFlagAndCaptureState('question', _getQuestionFormDataFromDOM());
    }
}


function _toggleQuestionDisabledState(questionId) {
    const questionIndex = localAllQuestionsRef.value.findIndex(q => q.id === questionId);
    if (questionIndex > -1) {
        localAllQuestionsRef.value[questionIndex].isDisabled = !localAllQuestionsRef.value[questionIndex].isDisabled;
        localAllQuestionsRef.value[questionIndex].modifiedAt = new Date().toISOString();
        saveToLocalStorage('quizQuestions', localAllQuestionsRef.value);
        _loadAdminQuestions();
        if (localLoadAdminStats) localLoadAdminStats();
        showAlert(`Questão ${localAllQuestionsRef.value[questionIndex].isDisabled ? 'desabilitada' : 'habilitada'} com sucesso.`);
    }
    closeQuestionActionsModal();
}


// _handleEditQuestion foi essencialmente integrado em _switchToEditModeInModal.
// A chamada a _setQuestionFormVisibility(true) e closeQuestionActionsModal() não são mais necessárias aqui.

function _saveQuestionHandler(isNavigating = false) {
    if (!questionInput || !editQuestionIdInput || !optionInputs.every(i => i) || !correctOptionRadios || !questionDifficultyInput) return false;
    const questionText = questionInput.value.trim();
    const options = optionInputs.map(input => input.value.trim()).filter(opt => opt !== "");
    const difficulty = questionDifficultyInput.value;

    if (!questionText) { showAlert('O texto da pergunta não pode estar vazio.'); return false; }
    if (options.length < 2) { showAlert('A questão deve ter pelo menos duas opções preenchidas.'); return false; }

    let originallyCheckedRadioIndex = Array.from(correctOptionRadios).findIndex(r => r.checked);
    let correctOptionText = (originallyCheckedRadioIndex !== -1 && optionInputs[originallyCheckedRadioIndex]) ? optionInputs[originallyCheckedRadioIndex].value.trim() : '';
    let correctOptionIndex = options.indexOf(correctOptionText);

    if (correctOptionIndex === -1 && options.length > 0) {
        showAlert('A opção correta selecionada é inválida ou foi removida por estar vazia. A primeira opção válida será marcada como correta.');
        correctOptionIndex = 0;
    }

    const currentEditIdStr = editQuestionIdInput.value;
    const currentEditId = currentEditIdStr ? parseInt(currentEditIdStr, 10) : null;
    let questionWasJustAdded = false;

    if (currentEditId) { // Editando questão existente
        const questionIndex = localAllQuestionsRef.value.findIndex(q => q.id === currentEditId);
        if (questionIndex > -1) {
            localAllQuestionsRef.value[questionIndex].text = questionText;
            localAllQuestionsRef.value[questionIndex].options = options;
            localAllQuestionsRef.value[questionIndex].correct = correctOptionIndex;
            localAllQuestionsRef.value[questionIndex].difficulty = difficulty;
            localAllQuestionsRef.value[questionIndex].modifiedAt = new Date().toISOString();
        } else {
            console.error("Error: Question to edit not found with ID:", currentEditId); return false;
        }
    } else { // Adicionando nova questão
        const newQuestionId = _getNextNumericId();
        const newQuestion = {
            id: newQuestionId,
            text: questionText,
            options: options,
            correct: correctOptionIndex,
            isDisabled: false,
            difficulty: difficulty,
            createdAt: new Date().toISOString(),
            modifiedAt: new Date().toISOString()
        };
        localAllQuestionsRef.value.push(newQuestion);
        if (editQuestionIdInput) editQuestionIdInput.value = newQuestionId; // Atualiza o ID no form caso precise reabrir
        questionWasJustAdded = true;
    }
    saveToLocalStorage('quizQuestions', localAllQuestionsRef.value);
    localResetDirtyFlagAndCaptureState('question', _getQuestionFormDataFromDOM());
    _loadAdminQuestions(); // Atualiza a lista principal de questões

    if (localLoadAdminStats) localLoadAdminStats();
    if (!isNavigating) showAlert(currentEditId && !questionWasJustAdded ? 'Questão atualizada com sucesso!' : 'Nova questão salva com sucesso!');

    if (questionWasJustAdded) {
        closeQuestionActionsModal(); // Fecha o modal se foi uma adição
    } else if (currentEditId) {
        // Se foi uma edição, volta para o modo de visualização e atualiza os detalhes
        _openQuestionActionsModal(currentEditId); // Reabre o modal com os dados atualizados na visualização
        _switchToViewModeInModal(); // Garante que a visualização seja mostrada
    }
    return true;
}

function _handleDeleteQuestion(id) { 
    showConfirm('Tem certeza que deseja excluir permanentemente esta questão? Esta ação não pode ser desfeita.', {
        onDiscardAndProceed: () => {
            localAllQuestionsRef.value = localAllQuestionsRef.value.filter(q => q.id !== id);
            saveToLocalStorage('quizQuestions', localAllQuestionsRef.value);
            _loadAdminQuestions();
            if (localLoadAdminStats) localLoadAdminStats();
            showAlert('Questão excluída permanentemente.');
            closeQuestionActionsModal();
        }
    }, 'danger', { discardButtonText: "Sim, Excluir Permanentemente" });
}

function _handleDeleteSelectedQuestions() {
    if (selectedQuestionIds.length === 0) {
        showAlert("Nenhuma questão selecionada para excluir.", "warning");
        return;
    }

    showConfirm(`Tem certeza que deseja excluir permanentemente as ${selectedQuestionIds.length} questões selecionadas? Esta ação não pode ser desfeita.`, {
        onDiscardAndProceed: () => {
            localAllQuestionsRef.value = localAllQuestionsRef.value.filter(q => !selectedQuestionIds.includes(q.id));
            saveToLocalStorage('quizQuestions', localAllQuestionsRef.value);
            
            const numDeleted = selectedQuestionIds.length;
            selectedQuestionIds = []; 

            _loadAdminQuestions(); 
            if (localLoadAdminStats) localLoadAdminStats();
            showAlert(`${numDeleted} questão(ões) excluída(s) permanentemente.`);
            _updateBatchActionButtonsState(); 
        }
    }, 'danger', { discardButtonText: "Sim, Excluir Selecionadas Permanentemente" });
}

function _handleDisableSelectedQuestions() {
    if (selectedQuestionIds.length === 0) {
        showAlert("Nenhuma questão selecionada para desativar.", "warning");
        return;
    }

    showConfirm(`Tem certeza que deseja desativar as ${selectedQuestionIds.length} questões selecionadas? Elas não aparecerão na seleção normal do quiz, mas podem ser reativadas.`, {
        onDiscardAndProceed: () => {
            let disabledCount = 0;
            localAllQuestionsRef.value.forEach(q => {
                if (selectedQuestionIds.includes(q.id)) {
                    if (!q.isDisabled) { 
                        q.isDisabled = true;
                        q.modifiedAt = new Date().toISOString();
                        disabledCount++;
                    }
                }
            });
            saveToLocalStorage('quizQuestions', localAllQuestionsRef.value);
            
            const originalSelectedCount = selectedQuestionIds.length;
            selectedQuestionIds = [];

            _loadAdminQuestions();
            if (localLoadAdminStats) localLoadAdminStats();
            showAlert(`${disabledCount} de ${originalSelectedCount} questão(ões) selecionada(s) foram desativada(s) com sucesso.`);
            _updateBatchActionButtonsState(); 
        }
    }, 'warning', { discardButtonText: "Sim, Desativar", confirmButtonText: "Cancelar" });
}


function _exportQuestionsHandler(format) {
    const questionsToExport = getFromLocalStorage('quizQuestions', []);
    if (questionsToExport.length === 0) {
        displayStatusMessage(questionsImportExportStatusMessageEl, "Não há questões para exportar.", 'error');
        return;
    }
    const filename = `questoes_quiz_${new Date().toISOString().split('T')[0]}.${format}`;
    const dataType = `${format}_questions`;
    let dataToExport = questionsToExport.map(q => { 
        const { isArchived, ...rest } = q; 
        return rest;
    });

    if (format === 'csv') {
        dataToExport = dataToExport.map(q => ({
            id: q.id, 
            text: q.text,
            option1: q.options[0] || '',
            option2: q.options[1] || '',
            option3: q.options[2] || '',
            option4: q.options[3] || '',
            correctOptionIndex: q.correct,
            correctOptionText: q.options[q.correct] || '',
            isDisabled: q.isDisabled || false,
            difficulty: q.difficulty || 'facil'
        }));
    }

    if (localExportDataFn) {
        localExportDataFn(dataToExport, filename, dataType); 
         displayStatusMessage(questionsImportExportStatusMessageEl, `Questões exportadas para ${format.toUpperCase()} com sucesso!`, 'success');
    } else {
        showAlert('Função de exportação não encontrada (localExportDataFn).', 'error');
    }
}

function _handleImportQuestions() {
    if (!importQuestionsFileEl?.files?.length) {
        showAlert('Por favor, selecione um arquivo JSON de questões.');
        return;
    }
    const file = importQuestionsFileEl.files[0];
    const reader = new FileReader();
    const addMode = addQuestionsModeCheckbox ? addQuestionsModeCheckbox.checked : false;
    let questionsAddedCount = 0;
    let questionsUpdatedCount = 0;

    reader.onload = (event) => {
        try {
            const importedRawData = JSON.parse(event.target.result);
            if (!Array.isArray(importedRawData)) {
                throw new Error("O arquivo JSON deve conter um array de objetos de questão.");
            }

            importedRawData.forEach((q, index) => {
                if (!q.text || !Array.isArray(q.options) || typeof q.correct !== 'number' || q.options.length === 0 || q.correct < 0 || q.correct >= q.options.length) {
                    throw new Error(`Questão ${index + 1} no arquivo JSON tem estrutura inválida.`);
                }
            });
            
            let currentQuestions = getFromLocalStorage('quizQuestions', []);
            if (!getFromLocalStorage(ID_MIGRATION_KEY, false)) {
                 _migrateToNumericIds(); 
                 currentQuestions = localAllQuestionsRef.value; 
            }
            if (!getFromLocalStorage(ARCHIVED_QUESTIONS_MIGRATION_KEY, false)) { 
                _migrateArchivedToDisabled();
                currentQuestions = localAllQuestionsRef.value;
            }


            const processedImportedQuestions = importedRawData.map((q_json) => {
                const importedId = q_json.id !== undefined && !isNaN(parseInt(q_json.id,10)) ? parseInt(q_json.id, 10) : null;
                let finalId = importedId;

                if (addMode) {
                    if (importedId !== null) {
                        const existingQ = currentQuestions.find(cq => cq.id === importedId);
                        if (existingQ) {
                            finalId = importedId; 
                        } else {
                            if (currentQuestions.some(cq => cq.id === importedId)) {
                                finalId = _getNextNumericId();
                            } else {
                                finalId = importedId;
                            }
                        }
                    } else { 
                        finalId = _getNextNumericId();
                    }
                } else { 
                    finalId = importedId !== null ? importedId : _getNextNumericId(); 
                }
                
                if (addMode && currentQuestions.some(cq => cq.id === finalId) && (!q_json.id || parseInt(q_json.id,10) !== finalId) ) {
                    let tempId = _getNextNumericId();
                    // eslint-disable-next-line no-loop-func
                    while(currentQuestions.some(cq => cq.id === tempId) || processedImportedQuestions.slice(0, -1).some(pq => pq.id === tempId) ) {
                        tempId = _getNextNumericId();
                    }
                    finalId = tempId;
                }


                return {
                    id: finalId,
                    text: q_json.text,
                    options: q_json.options,
                    correct: q_json.correct,
                    difficulty: q_json.difficulty || 'facil',
                    isDisabled: q_json.isArchived === true ? true : (typeof q_json.isDisabled === 'boolean' ? q_json.isDisabled : false),
                    createdAt: q_json.createdAt || new Date().toISOString(),
                    modifiedAt: q_json.modifiedAt || new Date().toISOString()
                };
            });

            if (addMode) {
                processedImportedQuestions.forEach(importedQ => {
                    const existingQuestionIndex = currentQuestions.findIndex(q => q.id === importedQ.id);
                    if (existingQuestionIndex > -1) {
                        currentQuestions[existingQuestionIndex] = { ...currentQuestions[existingQuestionIndex], ...importedQ, modifiedAt: new Date().toISOString() };
                        questionsUpdatedCount++;
                    } else {
                        currentQuestions.push(importedQ);
                        questionsAddedCount++;
                    }
                });
            } else { 
                currentQuestions = processedImportedQuestions.map((q, idx) => ({...q, id: idx + 1}));
                questionsAddedCount = currentQuestions.length;
                questionsUpdatedCount = 0;
            }

            localAllQuestionsRef.value = currentQuestions; 
            saveToLocalStorage('quizQuestions', currentQuestions);
            _loadAdminQuestions();
            if (localLoadAdminStats) localLoadAdminStats();

            let successMessage = "Importação concluída. ";
            if (addMode) {
                successMessage += `${questionsAddedCount} questão(ões) nova(s) adicionada(s), ${questionsUpdatedCount} questão(ões) existente(s) atualizada(s).`;
            } else {
                successMessage += `${questionsAddedCount} questão(ões) importada(s) (anteriores substituídas e IDs re-numerados).`;
            }
            displayStatusMessage(questionsImportExportStatusMessageEl, successMessage, 'success', 7000);
        } catch (e) {
            console.error("Erro ao importar questões:", e);
            displayStatusMessage(questionsImportExportStatusMessageEl, `Erro ao importar: ${e.message}`, 'error');
        } finally {
            if (importQuestionsFileEl) importQuestionsFileEl.value = '';
        }
    };
    reader.readAsText(file);
}

function renderQuestionPreview() {
    _ensureModalEventListeners('preview'); // Garante listeners do modal de preview

    // Garantir que os elementos do formulário e do modal de preview estejam carregados
    if (typeof questionInput === 'undefined' || !questionInput) questionInput = document.getElementById('question-input');
    if (typeof optionInputs === 'undefined' || optionInputs.length === 0 || !optionInputs.every(i => i && typeof i === 'object')) {
        optionInputs = [
            document.getElementById('option1-input'),
            document.getElementById('option2-input'),
            document.getElementById('option3-input'),
            document.getElementById('option4-input')
        ];
    }
    if (typeof correctOptionRadios === 'undefined' || !correctOptionRadios || correctOptionRadios.length === 0) {
        correctOptionRadios = document.getElementsByName('correct-option');
    }
    // questionDifficultyInput não é usado diretamente aqui, mas é parte do check original
    if (typeof previewQuestionTextEl === 'undefined' || !previewQuestionTextEl) previewQuestionTextEl = document.getElementById('previewQuestionText');
    if (typeof previewOptionsListEl === 'undefined' || !previewOptionsListEl) previewOptionsListEl = document.getElementById('previewOptionsList');
    if (typeof previewQuestionImageContainerEl === 'undefined' || !previewQuestionImageContainerEl) previewQuestionImageContainerEl = document.getElementById('previewQuestionImageContainer');
    if (typeof questionPreviewModal === 'undefined' || !questionPreviewModal) questionPreviewModal = document.getElementById('questionPreviewModal');


    if (!questionInput || !optionInputs.every(i => i) || !correctOptionRadios || // !questionDifficultyInput || // Removido do check pois não é usado
        !previewQuestionTextEl || !previewOptionsListEl || !previewQuestionImageContainerEl) {
        console.warn("Elementos do DOM para pré-visualização não encontrados ou não inicializados corretamente.");
        return;
    }

    const questionText = questionInput.value.trim();
    const optionsData = optionInputs.map((input, index) => {
        return {
            text: input.value.trim(),
            isCorrect: correctOptionRadios[index] ? correctOptionRadios[index].checked : false
        };
    });
    
    previewQuestionTextEl.textContent = questionText || "Texto da pergunta aparecerá aqui...";
    previewQuestionImageContainerEl.innerHTML = ''; 
    
    previewOptionsListEl.innerHTML = '';
    if (optionsData.some(opt => opt.text !== "")) {
        optionsData.forEach(opt => {
            if (opt.text !== "") { 
                const li = document.createElement('li');
                li.textContent = opt.text;
                if (opt.isCorrect) {
                    li.classList.add('correct-preview');
                }
                previewOptionsListEl.appendChild(li);
            }
        });
    } else {
        previewOptionsListEl.innerHTML = '<li>Nenhuma alternativa preenchida.</li>';
    }

    if (questionPreviewModal) {
        questionPreviewModal.classList.remove('hidden');
    }
}

function closeQuestionPreviewModal() {
    if (questionPreviewModal) {
        questionPreviewModal.classList.add('hidden');
    }
}

// Nova função para definir a referência global de questões
export function setGlobalQuestionsRef(questionsRef) {
    localAllQuestionsRef = questionsRef;
    console.log('[questionsAdmin] localAllQuestionsRef atualizada via setGlobalQuestionsRef.');
    // Se a lista de questões já estiver renderizada e a referência for atualizada,
    // pode ser necessário recarregar a lista se a tela de questões estiver ativa.
    // No entanto, o principal objetivo aqui é garantir que _openQuestionActionsModal tenha acesso.
    // Se a tela de questões estiver ativa, _loadAdminQuestions() já deve ter sido chamada
    // ou será chamada ao exibir a tela.
}
 
// Exportando as funções para serem usadas externamente, por exemplo, pelo analyticsAdmin.js
export { _openQuestionActionsModal, closeQuestionActionsModal };
 
export function initializeQuestionsScreen(dependencies) {
    // Se localAllQuestionsRef ainda não foi definida por setGlobalQuestionsRef,
    // ou se queremos garantir que a dependência mais recente seja usada ao inicializar a tela:
    if (!localAllQuestionsRef || (dependencies.allQuestionsRef && localAllQuestionsRef !== dependencies.allQuestionsRef)) {
        localAllQuestionsRef = dependencies.allQuestionsRef;
        console.log('[questionsAdmin] localAllQuestionsRef atualizada via initializeQuestionsScreen dependencies.');
    }
    localIsQuestionFormDirtyRef = dependencies.isQuestionFormDirtyRef;
    localInitialQuestionFormDataRef = dependencies.initialQuestionFormDataRef;
    localResetDirtyFlagAndCaptureState = dependencies.resetDirtyFlagAndCaptureStateCallback;
    localCheckDirtyState = dependencies.checkDirtyStateCallback;
    localLoadAdminStats = dependencies.loadAdminStatsCallback;
    localExportDataFn = dependencies.exportDataFn;

    _migrateToNumericIds();
    _migrateArchivedToDisabled(); 
    localAllQuestionsRef.value = getFromLocalStorage('quizQuestions', []);


    addQuestionFormBtn = document.getElementById('add-question-form-btn');
    // addEditQuestionForm agora é questionEditFormSectionEl, dentro do modal
    questionEditFormSectionEl = document.getElementById('question-edit-form-section');
    questionDetailsViewSectionEl = document.getElementById('question-details-view-section');

    // Elementos do formulário (são os mesmos, mas agora dentro de questionEditFormSectionEl)
    editQuestionIdInput = document.getElementById('edit-question-id');
    questionInput = document.getElementById('question-input');
    optionInputs = [document.getElementById('option1-input'), document.getElementById('option2-input'), document.getElementById('option3-input'), document.getElementById('option4-input')];
    correctOptionRadios = document.getElementsByName('correct-option'); // Estes são os radios dentro do formulário de edição
    questionDifficultyInput = document.getElementById('question-difficulty-input');
    saveQuestionBtn = document.getElementById('save-question-btn'); // Botão Salvar dentro do formulário de edição
    cancelEditQuestionBtn = document.getElementById('cancel-edit-question-btn'); // Botão Cancelar dentro do formulário de edição
    questionsListUl = document.getElementById('questions-list');
    totalQuestionsCountEl = document.getElementById('total-questions-count');
    searchQuestionsInput = document.getElementById('search-questions-input');
    exportQuestionsJsonBtn = document.getElementById('export-questions-json-btn');
    exportQuestionsCsvBtn = document.getElementById('export-questions-csv-btn');
    importQuestionsFileEl = document.getElementById('import-questions-file');
    importQuestionsBtn = document.getElementById('import-questions-btn');
    addQuestionsModeCheckbox = document.getElementById('add-questions-mode-checkbox');
    questionsImportExportStatusMessageEl = document.getElementById('questions-import-export-status-message');

    sortQuestionsBySelect = document.getElementById('sort-questions-by');
    advancedFiltersBtn = document.getElementById('advanced-filters-btn');
    advancedFiltersContainer = document.getElementById('advanced-filters-container');
    filterDifficultySelect = document.getElementById('filter-difficulty');
    filterStatusSelect = document.getElementById('filter-status'); // Inicializar filterStatusSelect
    applyAdvancedFiltersBtn = document.getElementById('apply-advanced-filters-btn');
    clearAdvancedFiltersBtn = document.getElementById('clear-advanced-filters-btn');
    activeFiltersCountSpan = document.getElementById('active-filters-count');
    itemsPerPageSelect = document.getElementById('items-per-page-select');
    questionsPaginationControls = document.getElementById('questions-pagination-controls');
    questionsPrevPageBtn = document.getElementById('questions-prev-page-btn');
    questionsNextPageBtn = document.getElementById('questions-next-page-btn');
    questionsPageInfo = document.getElementById('questions-page-info');

    questionDetailsModal = document.getElementById('question-details-modal'); 
    questionActionsModalContainer = document.getElementById('question-actions-modal-container'); 
    detailQId = document.getElementById('detail-q-id');
    detailQText = document.getElementById('detail-q-text');
    detailQOptionsCount = document.getElementById('detail-q-options-count');
    detailQOptionsList = document.getElementById('detail-q-options-list');
    detailQDifficulty = document.getElementById('detail-q-difficulty');
    // Referências para os spans de estatísticas
    detailQStatTotal = document.getElementById('detail-q-stat-total');
    detailQStatCorrect = document.getElementById('detail-q-stat-correct');
    detailQStatIncorrect = document.getElementById('detail-q-stat-incorrect');
    detailQStatAccuracy = document.getElementById('detail-q-stat-accuracy');
    detailQStatsContainer = document.getElementById('detail-q-stats-container');
    
    selectAllQuestionsCheckbox = document.getElementById('selectAllQuestionsCheckbox');
    deleteSelectedQuestionsBtn = document.getElementById('deleteSelectedQuestionsBtn');
    disableSelectedQuestionsBtn = document.getElementById('disableSelectedQuestionsBtn'); 
    selectedQuestionsCountSpan = document.getElementById('selected-questions-count');
    explicitSelectedCountTextEl = document.getElementById('explicit-selected-count-text');

    previewQuestionBtn = document.getElementById('previewQuestionBtn');
    questionPreviewModal = document.getElementById('questionPreviewModal');
    previewQuestionTextEl = document.getElementById('previewQuestionText');
    previewOptionsListEl = document.getElementById('previewOptionsList');
    previewQuestionImageContainerEl = document.getElementById('previewQuestionImageContainer');
    closePreviewModalBtns = document.querySelectorAll('#questionPreviewModal .close-preview-btn');
    
    closeQuestionDetailsModalBtns = document.querySelectorAll('[data-close-modal="question-details-modal"], #question-details-modal .modal-close-icon-btn');


    if (addQuestionFormBtn) {
        addQuestionFormBtn.addEventListener('click', () => {
            _openModalForAddingQuestion();
        });
    }
    
    if (cancelEditQuestionBtn) { // Botão Cancelar DENTRO do formulário de edição no modal
        cancelEditQuestionBtn.addEventListener('click', () => {
            const isAddingNew = !editQuestionIdInput.value; // Se não há ID, estava adicionando
            
            if (localIsQuestionFormDirtyRef.value) {
                showConfirm('Você tem alterações não salvas. Deseja descartá-las?', {
                    onDiscardAndProceed: () => {
                        localResetDirtyFlagAndCaptureState('question', _getQuestionFormDataFromDOM());
                        if (isAddingNew) {
                            closeQuestionActionsModal(); // Fecha o modal se estava adicionando
                        } else {
                            _switchToViewModeInModal(); // Volta para visualização se estava editando
                        }
                    }
                }, 'warning', { discardButtonText: "Descartar", confirmButtonText: "Continuar Editando" });
            } else {
                if (isAddingNew) {
                    closeQuestionActionsModal();
                } else {
                    _switchToViewModeInModal();
                }
            }
        });
    }

    if (saveQuestionBtn) { // Botão Salvar DENTRO do formulário de edição no modal
        saveQuestionBtn.addEventListener('click', () => _saveQuestionHandler(false));
    }
    
    if (searchQuestionsInput) {
        let debounceTimer;
        searchQuestionsInput.addEventListener('input', () => {
            clearTimeout(debounceTimer);
            debounceTimer = setTimeout(() => {
                currentPage = 1;
                _loadAdminQuestions();
            }, 300); 
        });
    }

    if (exportQuestionsJsonBtn) exportQuestionsJsonBtn.addEventListener('click', () => _exportQuestionsHandler('json'));
    if (exportQuestionsCsvBtn) exportQuestionsCsvBtn.addEventListener('click', () => _exportQuestionsHandler('csv'));
    if (importQuestionsBtn) importQuestionsBtn.addEventListener('click', _handleImportQuestions);

    if (previewQuestionBtn) {
        previewQuestionBtn.addEventListener('click', renderQuestionPreview);
    }
    if (closePreviewModalBtns) {
        closePreviewModalBtns.forEach(btn => btn.addEventListener('click', closeQuestionPreviewModal));
    }
    if (questionPreviewModal) {
        questionPreviewModal.addEventListener('click', (event) => {
            if (event.target === questionPreviewModal) { 
                closeQuestionPreviewModal();
            }
        });
    }

    if (selectAllQuestionsCheckbox) {
        selectAllQuestionsCheckbox.addEventListener('change', _handleSelectAllQuestionsChange);
    }
    if (deleteSelectedQuestionsBtn) {
        deleteSelectedQuestionsBtn.addEventListener('click', _handleDeleteSelectedQuestions);
    }
    if (disableSelectedQuestionsBtn) { 
        disableSelectedQuestionsBtn.addEventListener('click', _handleDisableSelectedQuestions);
    }

    if (advancedFiltersBtn) {
        advancedFiltersBtn.addEventListener('click', () => {
            if(advancedFiltersContainer) advancedFiltersContainer.classList.toggle('hidden');
        });
    }
    if (applyAdvancedFiltersBtn) {
        applyAdvancedFiltersBtn.addEventListener('click', () => {
            const difficulties = filterDifficultySelect ? Array.from(filterDifficultySelect.selectedOptions).map(opt => opt.value) : [];
            const statusValue = filterStatusSelect ? filterStatusSelect.value : 'all'; // Obter valor do filtro de status
            currentAdvancedFilters = {
                difficulty: difficulties,
                status: statusValue, // Adicionar status aos filtros atuais
            };
            let activeCount = 0;
            if (difficulties.length > 0) activeCount++;
            if (statusValue !== 'all') activeCount++; // Contar filtro de status se não for 'all'
            
            if(activeFiltersCountSpan) {
                activeFiltersCountSpan.textContent = activeCount;
                activeFiltersCountSpan.classList.toggle('hidden', activeCount === 0);
            }

            currentPage = 1; 
            _loadAdminQuestions();
            if(advancedFiltersContainer) advancedFiltersContainer.classList.add('hidden'); 
        });
    }
    if (clearAdvancedFiltersBtn) {
        clearAdvancedFiltersBtn.addEventListener('click', () => {
            if(filterDifficultySelect) filterDifficultySelect.selectedIndex = -1;
            if(filterStatusSelect) filterStatusSelect.value = 'all'; // Resetar filtro de status
            currentAdvancedFilters = {};
            if (currentAdvancedFilters.status) delete currentAdvancedFilters.status; // Limpar filtro de status
            if(activeFiltersCountSpan) {
                activeFiltersCountSpan.textContent = '0';
                activeFiltersCountSpan.classList.add('hidden');
            }
            currentPage = 1;
            _loadAdminQuestions();
        });
    }
    if (sortQuestionsBySelect) {
        sortQuestionsBySelect.addEventListener('change', (e) => {
            const [key, direction] = e.target.value.split('_');
            currentSort = { key, direction: direction || 'asc' };
            currentPage = 1;
            _loadAdminQuestions(); 
        });
        const initialSortValue = 'text_asc';
        if (Array.from(sortQuestionsBySelect.options).some(opt => opt.value === initialSortValue)) {
            sortQuestionsBySelect.value = initialSortValue;
        } else if (sortQuestionsBySelect.options.length > 0) {
            sortQuestionsBySelect.value = sortQuestionsBySelect.options[0].value; // Fallback para a primeira opção
            const [key, direction] = sortQuestionsBySelect.value.split('_');
            currentSort = { key, direction: direction || 'asc' };
        } else {
            currentSort = { key: 'text', direction: 'asc' }; // Fallback rígido
        }
    }

    const headerCells = document.querySelectorAll('#questions-table-view .question-table-header-row .header-cell[data-sort-key]');
    headerCells.forEach(cell => {
        cell.addEventListener('click', _handleSortHeaderClick);
    });


    if (itemsPerPageSelect) {
        itemsPerPageSelect.addEventListener('change', (e) => {
            itemsPerPage = parseInt(e.target.value, 10);
            currentPage = 1;
            _loadAdminQuestions();
        });
        itemsPerPage = parseInt(itemsPerPageSelect.value, 10); 
    }
    if (questionsPrevPageBtn) questionsPrevPageBtn.addEventListener('click', () => { if (currentPage > 1) { currentPage--; _loadAdminQuestions(); }});
    if (questionsNextPageBtn) questionsNextPageBtn.addEventListener('click', () => { currentPage++; _loadAdminQuestions(); });

    if (closeQuestionDetailsModalBtns && closeQuestionDetailsModalBtns.length > 0) { 
        closeQuestionDetailsModalBtns.forEach(btn => btn.addEventListener('click', closeQuestionActionsModal));
    }
    
    if (questionDetailsModal) { 
         questionDetailsModal.addEventListener('click', (event) => {
            if (event.target === questionDetailsModal) { 
                closeQuestionActionsModal();
            }
        });
    }


    // _setQuestionFormVisibility(false); // Não mais necessário aqui
    _loadAdminQuestions();
    // localInitialQuestionFormDataRef.value = _getQuestionFormDataFromDOM(); // Já é feito em _clearAndResetQuestionForm
    // localIsQuestionFormDirtyRef.value = false; // Já é feito em _clearAndResetQuestionForm
    _clearAndResetQuestionForm(); // Garante que o formulário (agora no modal) esteja limpo inicialmente

    return {
        save: _saveQuestionHandler, // A função save agora lida com o modal
        reset: () => { // O reset agora deve fechar o modal se estiver aberto para adição, ou voltar para view mode
            if (questionDetailsModal && !questionDetailsModal.classList.contains('hidden')) {
                const isAddingNew = !editQuestionIdInput.value;
                 if (isAddingNew && questionEditFormSectionEl && !questionEditFormSectionEl.classList.contains('hidden')) {
                    closeQuestionActionsModal();
                } else if (!isAddingNew && questionEditFormSectionEl && !questionEditFormSectionEl.classList.contains('hidden')) {
                    _switchToViewModeInModal();
                } else {
                     closeQuestionActionsModal(); // Caso geral, apenas fecha
                }
            }
            localResetDirtyFlagAndCaptureState('question', _getQuestionFormDataFromDOM());
        },
        getQuestionFormData: _getQuestionFormDataFromDOM
    };
}