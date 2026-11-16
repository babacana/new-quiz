// admin/reportsAdmin.js
import { getFromLocalStorage, saveToLocalStorage, showAlert, showConfirm, formatTime, getPrizeWinners, removePrizeWinnerByPhone, getGiveUpLockoutList, removeGiveUpLockoutByPhone, clearAllPrizeWinners, clearAllGiveUpLockouts } from '../js/utils.js';
import { displayStatusMessage } from './uiAdmin.js'; // Assumindo que displayStatusMessage está em uiAdmin

// Constantes (podem ser passadas como dependência se necessário, ou definidas aqui se específicas do módulo)
const DEFAULT_ITEMS_PER_PAGE = 10; // Valor padrão, pode ser sobrescrito pela seleção do usuário ou dinâmico

// Referências DOM (serão inicializadas em initializeReportsScreen)
let searchParticipantsInput, filterPeriodRadios, filterDaysRangeInput,
    filterStartDateInput, filterEndDateInput, // Novos para período específico
    filterPrizeWinnersCheckbox, filterNotPrizeWinnersCheckbox, // Novo "não ganhadores"
    filterLockedOutCheckbox, filterExactScoreInput, filterEventSelect, // Novos para pontuação e evento
    applyReportFiltersBtn, clearReportFiltersBtn, // Novos botões de filtro
    participantsTableBody, participantsTotalCountEl, exportCsvBtn, exportJsonBtn, deleteAllParticipantsBtn,
    participantsPrevPageBtn, participantsNextPageBtn, participantsPageInfo, reportItemsPerPageSelect, // Novo select de itens por página
    participantDetailsModal, participantDetailsTitle, participantInfoSection,
    participantAnswersList, participantModalActions, closeParticipantModalBtn,
    filterSectionHeader, filterSectionContent, filterCollapseIcon,
    selectAllParticipantsCheckbox, reportsBatchActionsToolbar;


// Estado local do módulo
let currentParticipantsPage = 1;
// currentItemsPerPageSetting foi removido, pois agora é sempre dinâmico
let actualItemsPerPage = DEFAULT_ITEMS_PER_PAGE; // Valor calculado/definido
let participantsSortKey = 'timestamp';
let participantsSortDir = 'desc';
let selectedParticipantTimestamps = new Set(); // Mantém os timestamps dos participantes selecionados

// Referências e Callbacks de admin.js
let localSettingsRef; // Referência ao objeto settings de admin.js
let localParticipantsRef; // Referência ao array participants de admin.js (para handleDeleteParticipant)
let localExportDataFn; // Função exportData de admin.js

function _sortData(dataArray, key, direction) {
    // (Implementação da função sortData, idêntica à de admin.js)
    // Esta função pode ser movida para utils.js se for usada por múltiplos módulos.
    // Por enquanto, duplicada aqui para manter o módulo independente.
    return [...dataArray].sort((a, b) => {
        let valA = a[key];
        let valB = b[key];
        if (key === 'score' || key === 'time' || key === 'total' || key === 'correct' || key === 'incorrect') {
            valA = Number(valA) || 0;
            valB = Number(valB) || 0;
        } else if (key === 'timestamp') {
            valA = new Date(valA).getTime() || 0;
            valB = new Date(valB).getTime() || 0;
        } else if (key === 'accuracy') { // Assumindo que accuracy é calculada e presente no objeto
            valA = parseFloat(a.accuracy);
            valB = parseFloat(b.accuracy);
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

function _updateSortIcons(tableId, currentKey, currentDir) {
    // (Implementação de updateSortIcons, idêntica à de admin.js)
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


function _renderParticipantsTable(participantsToRender, globalStartIndex = 0) {
    // A prizeWinnersListFromFilter não é mais necessária como parâmetro,
    // pois a coluna 'Data Específica' foi removida.
    // A lógica de 'Brinde' usará getPrizeWinners() diretamente.

    if (participantsTotalCountEl) {
        const allLocalParticipants = getFromLocalStorage('quizParticipants', []);
        // O total de participantes exibido no cabeçalho da seção deve ser o total geral, não o filtrado.
        participantsTotalCountEl.textContent = allLocalParticipants.length;
    }
    if (!participantsTableBody) return;
    participantsTableBody.innerHTML = '';

    if (participantsToRender.length === 0) {
        // Colunas: Checkbox, #, Nome, Telefone, Acertos, Tempo, Brinde, Data Participação = 8 colunas
        const colCount = 8;
        participantsTableBody.innerHTML = `<tr><td colspan="${colCount}">Nenhum participante encontrado com os filtros atuais.</td></tr>`;
        if (selectAllParticipantsCheckbox) {
            selectAllParticipantsCheckbox.checked = false;
            selectAllParticipantsCheckbox.indeterminate = false;
        }
        return;
    }

    const fragment = document.createDocumentFragment();
    const allPrizeWinnersForCheck = getPrizeWinners(); // Pega a lista atual de todos os ganhadores para a coluna "Brinde"

    participantsToRender.forEach((p, index) => {
        const row = document.createElement('tr');
        row.dataset.participantTimestamp = p.timestamp; // Timestamp da participação
        row.classList.add('participant-row');

        // Checkbox para seleção individual
        const selectCell = row.insertCell();
        selectCell.classList.add('cell-checkbox');
        const individualCheckbox = document.createElement('input');
        individualCheckbox.type = 'checkbox';
        individualCheckbox.classList.add('participant-select-checkbox');
        individualCheckbox.dataset.timestamp = p.timestamp;
        individualCheckbox.checked = selectedParticipantTimestamps.has(p.timestamp);
        individualCheckbox.addEventListener('change', (event) => {
            event.stopPropagation(); // Impede que o clique no checkbox acione o modal
            _handleIndividualCheckboxChange(individualCheckbox);
        });
        selectCell.appendChild(individualCheckbox); selectCell.setAttribute('data-label', 'Sel.'); // Label para o checkbox, pode ser ocultado via CSS se não desejado no modo card

        const numCell = row.insertCell(); numCell.textContent = globalStartIndex + index + 1; numCell.setAttribute('data-label', '#');
        const nameCell = row.insertCell(); nameCell.textContent = p.name || 'N/A'; nameCell.classList.add('participant-name-cell'); nameCell.setAttribute('data-label', 'Nome');
        const phoneCell = row.insertCell(); phoneCell.textContent = p.phone || 'N/A'; phoneCell.setAttribute('data-label', 'Telefone');
        const scoreCell = row.insertCell(); scoreCell.textContent = (typeof p.score === 'number') ? p.score : 'N/A'; scoreCell.setAttribute('data-label', 'Acertos');
        const timeCell = row.insertCell(); timeCell.textContent = (typeof p.time === 'number') ? formatTime(p.time) : 'N/A'; timeCell.setAttribute('data-label', 'Tempo');
        
        // Coluna Brinde
        const wonPrizeCheck = allPrizeWinnersForCheck.some(winner => winner.phone === p.phone && p.score >= (localSettingsRef?.value?.minScoreForPrize || 1));
        const prizeCell = row.insertCell(); prizeCell.innerHTML = wonPrizeCheck ? '<span class="prize-icon">🏆</span>' : '—'; prizeCell.classList.add('text-center'); prizeCell.setAttribute('data-label', 'Brinde');
        
        const dateCell = row.insertCell(); dateCell.textContent = p.timestamp ? new Date(p.timestamp).toLocaleString('pt-BR') : 'N/A'; dateCell.setAttribute('data-label', 'Data Participação');
        
        // Adiciona listener para abrir modal, exceto se o clique foi no checkbox
        row.addEventListener('click', (event) => {
            if (event.target.type !== 'checkbox') {
                _showParticipantDetails(p.timestamp);
            }
        });
        fragment.appendChild(row);
    });
    participantsTableBody.appendChild(fragment);
}

function _updatePaginationControls() {
    const allLocalParticipants = getFromLocalStorage('quizParticipants', []); // Recarrega para contagem total
    // Aplicar os mesmos filtros para obter o total de itens filtrados
    const searchTerm = searchParticipantsInput ? searchParticipantsInput.value.toLowerCase() : "";
    let filterPeriod = 'all';
    if (filterPeriodRadios) filterPeriodRadios.forEach(radio => { if (radio.checked) filterPeriod = radio.value; });
    const onlyPrizeWinners = filterPrizeWinnersCheckbox ? filterPrizeWinnersCheckbox.checked : false;
    const onlyLockedOut = filterLockedOutCheckbox ? filterLockedOutCheckbox.checked : false;
    const notPrizeWinners = filterNotPrizeWinnersCheckbox ? filterNotPrizeWinnersCheckbox.checked : false;
    const exactScoreValue = filterExactScoreInput ? filterExactScoreInput.value.trim() : ""; // Trim para remover espaços
    const startDateValue = filterStartDateInput ? filterStartDateInput.value : "";
    const endDateValue = filterEndDateInput ? filterEndDateInput.value : "";

    let filteredData = allLocalParticipants;

    // Aplicar filtro de busca
    if (searchTerm) {
        filteredData = filteredData.filter(p =>
            (p.name && p.name.toLowerCase().includes(searchTerm)) ||
            (p.phone && p.phone.toLowerCase().includes(searchTerm))
        );
    }

    // Aplicar filtros de período
    if (filterPeriod === 'specific' && startDateValue && endDateValue) {
        const start = new Date(startDateValue); start.setHours(0,0,0,0);
        const end = new Date(endDateValue); end.setHours(23,59,59,999);
        filteredData = filteredData.filter(p => {
            const pDate = new Date(p.timestamp);
            return pDate >= start && pDate <= end;
        });
    }
    // Se 'all', não filtra por data.

    // Aplicar filtros de status
    const prizeWinnersListForFilter = getPrizeWinners(); // Obter uma vez para os filtros de brinde
    if (onlyPrizeWinners) {
        filteredData = filteredData.filter(p => prizeWinnersListForFilter.some(winner => winner.phone === p.phone && p.score >= (localSettingsRef?.value?.minScoreForPrize || 1)));
    } else if (notPrizeWinners) {
        filteredData = filteredData.filter(p => !prizeWinnersListForFilter.some(winner => winner.phone === p.phone && p.score >= (localSettingsRef?.value?.minScoreForPrize || 1)));
    }

    if (onlyLockedOut) {
        const lockedOutList = getGiveUpLockoutList();
        filteredData = filteredData.filter(p => lockedOutList.some(lockout => lockout.phone === p.phone));
    }

    // Aplicar filtro de pontuação exata
    if (exactScoreValue !== "" && !isNaN(Number(exactScoreValue))) {
        const scoreToFilter = Number(exactScoreValue);
        filteredData = filteredData.filter(p => p.score === scoreToFilter);
    }
    // TODO: Adicionar filtro de evento se/quando implementado

    const totalItems = filteredData.length;
    const totalPages = Math.ceil(totalItems / actualItemsPerPage) || 1;
    currentParticipantsPage = Math.max(1, Math.min(currentParticipantsPage, totalPages));

    if (participantsPageInfo) participantsPageInfo.textContent = `Página ${currentParticipantsPage} de ${totalPages}`;
    if (participantsPrevPageBtn) participantsPrevPageBtn.disabled = currentParticipantsPage === 1;
    if (participantsNextPageBtn) participantsNextPageBtn.disabled = currentParticipantsPage === totalPages || totalPages === 0;
}

// Função para calcular itens por página dinamicamente
function _calculateDynamicItemsPerPage() {
    const tableContainer = document.querySelector('#admin-reports-screen .table-container');
    if (!tableContainer) {
        console.warn("Table container not found for dynamic pagination calculation.");
        return DEFAULT_ITEMS_PER_PAGE;
    }

    const tableHeaderHeight = document.querySelector('#participants-table thead')?.offsetHeight || 0;
    const availableHeightForRows = tableContainer.clientHeight - tableHeaderHeight;
    
    // Tenta pegar uma linha renderizada para calcular a altura. Se não houver, usa um valor padrão.
    const firstRow = participantsTableBody ? participantsTableBody.querySelector('tr') : null;
    let rowHeight = 30; // Altura padrão de uma linha em pixels (ajuste conforme seu CSS)
    if (firstRow && firstRow.offsetHeight > 0) {
        rowHeight = firstRow.offsetHeight;
    } else {
        // Se não houver linha, podemos criar uma temporária para medir, ou usar um valor fixo.
        // Por simplicidade, usaremos um valor fixo se não houver linha.
        // console.warn("No participant row found to measure height, using default for dynamic pagination.");
    }

    if (rowHeight === 0 || availableHeightForRows <= 0) {
        console.warn(`Invalid dimensions for dynamic pagination: rowHeight=${rowHeight}, availableHeightForRows=${availableHeightForRows}`);
        return DEFAULT_ITEMS_PER_PAGE; // Fallback
    }

    let calculatedItems = Math.floor(availableHeightForRows / rowHeight);
    calculatedItems = Math.max(calculatedItems, DEFAULT_ITEMS_PER_PAGE); // Mínimo de itens

    // console.log(`Dynamic Pagination: ContainerH=${tableContainer.clientHeight}, HeaderH=${tableHeaderHeight}, AvailableRowH=${availableHeightForRows}, RowH=${rowHeight}, CalculatedItems=${calculatedItems}`);
    return calculatedItems;
}


function _applyFiltersAndRenderParticipants() {
    if (!participantsTableBody) return;
    let localParticipantsData = getFromLocalStorage('quizParticipants', []);
    
    // Ler valores dos filtros
    const searchTerm = searchParticipantsInput ? searchParticipantsInput.value.toLowerCase() : "";
    let filterPeriod = 'all';
    if (filterPeriodRadios) filterPeriodRadios.forEach(radio => { if (radio.checked) filterPeriod = radio.value; });
    const startDate = filterStartDateInput ? filterStartDateInput.value : "";
    const endDate = filterEndDateInput ? filterEndDateInput.value : "";
    const onlyPrizeWinners = filterPrizeWinnersCheckbox ? filterPrizeWinnersCheckbox.checked : false;
    const notPrizeWinners = filterNotPrizeWinnersCheckbox ? filterNotPrizeWinnersCheckbox.checked : false;
    const onlyLockedOut = filterLockedOutCheckbox ? filterLockedOutCheckbox.checked : false;
    const exactScore = filterExactScoreInput ? filterExactScoreInput.value : "";
    // const selectedEvent = filterEventSelect ? filterEventSelect.value : ""; // Para uso futuro

    let filteredData = localParticipantsData;

    // Aplicar filtro de busca
    if (searchTerm) {
        filteredData = filteredData.filter(p =>
            (p.name && p.name.toLowerCase().includes(searchTerm)) ||
            (p.phone && p.phone.toLowerCase().includes(searchTerm))
        );
    }

    // Aplicar filtros de período
    if (filterPeriod === 'specific' && startDate && endDate) {
        const start = new Date(startDate);
        start.setHours(0,0,0,0);
        const end = new Date(endDate);
        end.setHours(23,59,59,999);
        filteredData = filteredData.filter(p => {
            const pDate = new Date(p.timestamp);
            return pDate >= start && pDate <= end;
        });
    }

    // Aplicar filtros de status (ganhador, não ganhador, bloqueado)
    const prizeWinnersList = getPrizeWinners(); // Necessário para ambos os filtros de brinde
    if (onlyPrizeWinners) {
        filteredData = filteredData.filter(p => prizeWinnersList.some(winner => winner.phone === p.phone && p.score >= (localSettingsRef?.value?.minScoreForPrize || 1)));
    } else if (notPrizeWinners) { // else if para garantir exclusividade se ambos forem marcados (embora a UI deva impedir)
        filteredData = filteredData.filter(p => !prizeWinnersList.some(winner => winner.phone === p.phone && p.score >= (localSettingsRef?.value?.minScoreForPrize || 1)));
    }

    if (onlyLockedOut) {
        const lockedOutList = getGiveUpLockoutList();
        filteredData = filteredData.filter(p => lockedOutList.some(lockout => lockout.phone === p.phone));
    }
    
    // Aplicar filtro de pontuação exata
    if (exactScore !== "" && !isNaN(Number(exactScore))) {
        const scoreToFilter = Number(exactScore);
        filteredData = filteredData.filter(p => p.score === scoreToFilter);
    }

    // TODO: Aplicar filtro de evento (quando implementado)

    const sortedData = _sortData(filteredData, participantsSortKey, participantsSortDir);
    const totalItems = sortedData.length;

    // Determinar itens por página - sempre dinâmico
    actualItemsPerPage = _calculateDynamicItemsPerPage();
    
    const totalPages = Math.ceil(totalItems / actualItemsPerPage) || 1;
    currentParticipantsPage = Math.max(1, Math.min(currentParticipantsPage, totalPages));

    const startIndex = (currentParticipantsPage - 1) * actualItemsPerPage;
    const endIndex = startIndex + actualItemsPerPage;
    const paginatedData = sortedData.slice(startIndex, endIndex);

    _renderParticipantsTable(paginatedData, startIndex);
    _updatePaginationControls();
    _updateSortIcons('participants-table', participantsSortKey, participantsSortDir);
    _updateSelectAllCheckboxState();
    _updateActionToolbarState(); // Atualiza visibilidade da barra de ações em lote
}

function _handleIndividualCheckboxChange(checkbox) {
    const timestamp = checkbox.dataset.timestamp;
    if (checkbox.checked) {
        selectedParticipantTimestamps.add(timestamp);
    } else {
        selectedParticipantTimestamps.delete(timestamp);
    }
    _updateSelectAllCheckboxState();
    _updateActionToolbarState();
}

function _updateSelectAllCheckboxState() {
    if (!selectAllParticipantsCheckbox) return;
    const visibleCheckboxes = document.querySelectorAll('#participants-table-body .participant-select-checkbox');
    if (visibleCheckboxes.length === 0) {
        selectAllParticipantsCheckbox.checked = false;
        selectAllParticipantsCheckbox.indeterminate = false;
        return;
    }
    
    let allChecked = true;
    let someChecked = false;
    for (const cb of visibleCheckboxes) {
        if (cb.checked) {
            someChecked = true;
        } else {
            allChecked = false;
        }
    }

    selectAllParticipantsCheckbox.checked = allChecked;
    if (!allChecked && someChecked) {
        selectAllParticipantsCheckbox.indeterminate = true;
    } else {
        selectAllParticipantsCheckbox.indeterminate = false;
    }
}

function _handleSelectAllCheckboxChange() {
    if (!selectAllParticipantsCheckbox) return;
    const visibleCheckboxes = document.querySelectorAll('#participants-table-body .participant-select-checkbox');
    visibleCheckboxes.forEach(checkbox => {
        checkbox.checked = selectAllParticipantsCheckbox.checked;
        const timestamp = checkbox.dataset.timestamp;
        if (selectAllParticipantsCheckbox.checked) {
            selectedParticipantTimestamps.add(timestamp);
        } else {
            selectedParticipantTimestamps.delete(timestamp);
        }
    });
    _updateActionToolbarState();
}

function _updateActionToolbarState() {
    const count = selectedParticipantTimestamps.size;
    // const countElement = reportsBatchActionsToolbar ? reportsBatchActionsToolbar.querySelector('#selected-participants-count') : null; // Removido
    const batchActionCounters = reportsBatchActionsToolbar ? reportsBatchActionsToolbar.querySelectorAll('.batch-action-counter') : [];
    const btnUnaward = reportsBatchActionsToolbar ? reportsBatchActionsToolbar.querySelector('#btn-unaward-selected') : null;
    const btnUnlock = reportsBatchActionsToolbar ? reportsBatchActionsToolbar.querySelector('#btn-unlock-selected') : null;
    const btnDeleteSelected = reportsBatchActionsToolbar ? reportsBatchActionsToolbar.querySelector('#btn-delete-selected-participants') : null;

    console.log('[Debug] Toolbar Element:', reportsBatchActionsToolbar);
    console.log('[Debug] btnUnaward Element:', btnUnaward);
    console.log('[Debug] btnUnlock Element:', btnUnlock);
    console.log('[Debug] btnDeleteSelected Element:', btnDeleteSelected);
    console.log('[Debug] Selected count:', count);

    if (!reportsBatchActionsToolbar) {
        console.warn('[Debug] Toolbar não encontrado.');
    }
    
    // Adicionando verificação para cada botão antes de tentar acessar a propriedade 'disabled'
    // e logando se o elemento do botão foi encontrado ou não.
    if (!btnUnaward) console.warn('[Debug] Botão Despremiar (btn-unaward-selected) não encontrado.');
    if (!btnUnlock) console.warn('[Debug] Botão Desbloquear (btn-unlock-selected) não encontrado.');
    if (!btnDeleteSelected) console.warn('[Debug] Botão Excluir (btn-delete-selected-participants) não encontrado.');


    // Toolbar é sempre visível (controlado pelo HTML/CSS agora)

    // Toolbar é sempre visível (controlado pelo HTML/CSS agora)
    // Apenas atualiza a contagem e o estado 'disabled' dos botões
    batchActionCounters.forEach(counter => {
        counter.textContent = count;
    });

    if (count > 0) {
        if (btnUnaward) btnUnaward.disabled = false;
        if (btnUnlock) btnUnlock.disabled = false;
        if (btnDeleteSelected) btnDeleteSelected.disabled = false;
    } else {
        if (btnUnaward) btnUnaward.disabled = true;
        if (btnUnlock) btnUnlock.disabled = true;
        if (btnDeleteSelected) btnDeleteSelected.disabled = true;
    }
}


function _showParticipantDetails(timestamp) {
    const allLocalParticipants = getFromLocalStorage('quizParticipants', []);
    const participant = allLocalParticipants.find(p => p.timestamp === timestamp);
    if (!participant || !participantDetailsModal) return;
    if(participantDetailsTitle) participantDetailsTitle.textContent = participant.name || "Detalhes do Participante";
    const allSorted = [...allLocalParticipants].sort((a,b) => b.score - a.score || a.time - b.time);
    const rank = allSorted.findIndex(p => p.timestamp === timestamp) + 1;

    if(participantInfoSection) {
        const participationsByPhone = allLocalParticipants.filter(p => p.phone === participant.phone).length;
        participantInfoSection.innerHTML = `
            <p><strong>Telefone:</strong> ${participant.phone || 'N/A'}</p>
            <p><strong>Data da Participação Atual:</strong> ${new Date(participant.timestamp).toLocaleString('pt-BR')}</p>
            <p><strong>Pontuação:</strong> ${participant.score} acertos</p>
            <p><strong>Tempo:</strong> ${formatTime(participant.time)}</p>
            <p><strong>Ranking na Ocasião (desta participação):</strong> ${rank > 0 ? `${rank}º` : 'N/A'}</p>
            <p><strong>Total de Vezes que Jogou (este telefone):</strong> ${participationsByPhone}</p>
        `;
    }
    if(participantAnswersList) {
        participantAnswersList.innerHTML = '';
        if (participant.playerAttempts && participant.playerAttempts.length > 0) {
            participant.playerAttempts.forEach(attempt => {
                const itemDiv = document.createElement('div'); itemDiv.classList.add('question-review-item'); const isCorrect = attempt.isCorrect;
                itemDiv.innerHTML = `<h4>${attempt.questionText}</h4><p class="user-answer ${isCorrect ? 'correct-text' : 'incorrect-text'}">Sua resposta: ${attempt.selectedOptionText} ${isCorrect ? '✔️' : '❌'}</p>${!isCorrect ? `<p class="correct-answer-review">Resposta correta: ${attempt.correctOptionText}</p>` : ''}`;
                participantAnswersList.appendChild(itemDiv);
            });
        } else { participantAnswersList.innerHTML = '<p>Não há detalhes de respostas disponíveis.</p>'; }
    }
    if(participantModalActions) {
        participantModalActions.innerHTML = '';
        const prizeWinners = getPrizeWinners();
        if (prizeWinners.some(winner => winner.phone === participant.phone)) {
            const unpremBtn = document.createElement('button');
            unpremBtn.textContent = 'Despremiar';
            unpremBtn.className = 'btn-secondary btn-warning';
            unpremBtn.onclick = () => {
                showConfirm(`Remover prêmio de ${participant.name}?`, {
                    onDiscardAndProceed: () => {
                        _removePrizeWinner(participant.phone);
                        selectedParticipantTimestamps.delete(participant.timestamp); // Remove da seleção se estiver lá
                        _applyFiltersAndRenderParticipants();
                        _updateActionToolbarState();
                        _closeParticipantDetailsModal();
                    }
                }, 'warning', { discardButtonText: "Sim" });
            };
            participantModalActions.appendChild(unpremBtn);
        }
        const giveUpLockouts = getGiveUpLockoutList();
        if (giveUpLockouts.some(lockout => lockout.phone === participant.phone)) {
            const unlockBtn = document.createElement('button');
            unlockBtn.textContent = 'Destravar';
            unlockBtn.className = 'btn-secondary';
            unlockBtn.onclick = () => {
                showConfirm(`Destravar ${participant.name}?`, {
                    onDiscardAndProceed: () => {
                        _removeGiveUpLock(participant.phone);
                        selectedParticipantTimestamps.delete(participant.timestamp); // Remove da seleção se estiver lá
                        _applyFiltersAndRenderParticipants();
                        _updateActionToolbarState();
                        _closeParticipantDetailsModal();
                    }
                }, 'warning', { discardButtonText: "Sim" });
            };
            participantModalActions.appendChild(unlockBtn);
        }
        const deleteBtn = document.createElement('button'); deleteBtn.textContent = 'Excluir'; deleteBtn.className = 'btn btn-danger'; deleteBtn.onclick = () => { showConfirm(`Excluir registro de ${participant.name}?`, { onDiscardAndProceed: () => { _handleDeleteParticipant(participant.timestamp); _closeParticipantDetailsModal(); } }, 'danger', { discardButtonText: "Sim" }); }; participantModalActions.appendChild(deleteBtn);
    }
    participantDetailsModal.classList.remove('hidden');
}

function _closeParticipantDetailsModal() { if(participantDetailsModal) participantDetailsModal.classList.add('hidden'); }
function _removePrizeWinner(phone) {
    removePrizeWinnerByPhone(phone);
}

function _removeGiveUpLock(phone) {
    removeGiveUpLockoutByPhone(phone);
}

function _handleDeleteParticipant(participantTimestamp) {
    if (!participantTimestamp) return;

    let currentParticipants = getFromLocalStorage('quizParticipants', []);
    const participantToDelete = currentParticipants.find(p => p.timestamp === participantTimestamp);

    if (participantToDelete && participantToDelete.phone) {
        _removePrizeWinner(participantToDelete.phone);
        _removeGiveUpLock(participantToDelete.phone);
    }

    currentParticipants = currentParticipants.filter(p => p.timestamp !== participantTimestamp);
    saveToLocalStorage('quizParticipants', currentParticipants);

    if(localParticipantsRef) localParticipantsRef.value = currentParticipants; // Atualiza ref em admin.js
    
    _applyFiltersAndRenderParticipants(); // Chamada única para renderizar
    showAlert('Participante e todos os dados associados foram excluídos com sucesso.'); // Alerta consolidado
}
function _handleDeleteAllParticipants() {
    showConfirm('Excluir TODOS os participantes? Esta ação não pode ser desfeita.', {
        onDiscardAndProceed: () => {
            saveToLocalStorage('quizParticipants', []);
            if(localParticipantsRef) localParticipantsRef.value = []; // Atualiza ref em admin.js
            currentParticipantsPage = 1;
            _applyFiltersAndRenderParticipants();
            showAlert('Todos os participantes foram excluídos.');
        }
    }, 'danger', { discardButtonText: "Sim, Excluir Todos" });
}

function _exportParticipantsHandler(format) {
    const allLocalParticipants = getFromLocalStorage('quizParticipants', []);
    const prizeWinnersList = getPrizeWinners();
    const searchTerm = searchParticipantsInput ? searchParticipantsInput.value.toLowerCase() : "";
    let filterPeriod = 'all';
    if(filterPeriodRadios) filterPeriodRadios.forEach(radio => { if (radio.checked) filterPeriod = radio.value; });
    const startDate = filterStartDateInput ? filterStartDateInput.value : "";
    const endDate = filterEndDateInput ? filterEndDateInput.value : "";
    const onlyPrizeWinners = filterPrizeWinnersCheckbox ? filterPrizeWinnersCheckbox.checked : false;
    const notPrizeWinners = filterNotPrizeWinnersCheckbox ? filterNotPrizeWinnersCheckbox.checked : false;
    const onlyLockedOut = filterLockedOutCheckbox ? filterLockedOutCheckbox.checked : false;
    const exactScore = filterExactScoreInput ? filterExactScoreInput.value.trim() : ""; // Trim para remover espaços

    let participantsToExport = allLocalParticipants;

    // Aplicar filtro de busca
    if (searchTerm) {
        participantsToExport = participantsToExport.filter(p =>
            (p.name && p.name.toLowerCase().includes(searchTerm)) ||
            (p.phone && p.phone.toLowerCase().includes(searchTerm))
        );
    }

    // Aplicar filtros de período
    if (filterPeriod === 'specific' && startDate && endDate) {
        const start = new Date(startDate);
        start.setHours(0,0,0,0);
        const end = new Date(endDate);
        end.setHours(23,59,59,999);
        participantsToExport = participantsToExport.filter(p => {
            const pDate = new Date(p.timestamp);
            return pDate >= start && pDate <= end;
        });
    }

    // Aplicar filtros de status (ganhador, não ganhador, bloqueado)
    if (onlyPrizeWinners) {
        participantsToExport = participantsToExport.filter(p => prizeWinnersList.some(winner => winner.phone === p.phone && p.score >= (localSettingsRef?.value?.minScoreForPrize || 1)));
    } else if (notPrizeWinners) {
        participantsToExport = participantsToExport.filter(p => !prizeWinnersList.some(winner => winner.phone === p.phone && p.score >= (localSettingsRef?.value?.minScoreForPrize || 1)));
    }

    if (onlyLockedOut) {
        const lockedOutList = getGiveUpLockoutList();
        participantsToExport = participantsToExport.filter(p => lockedOutList.some(lockout => lockout.phone === p.phone));
    }

    // Aplicar filtro de pontuação exata
    if (exactScore !== "" && !isNaN(Number(exactScore))) {
        const scoreToFilter = Number(exactScore);
        participantsToExport = participantsToExport.filter(p => p.score === scoreToFilter);
    }
    
    participantsToExport = _sortData(participantsToExport, participantsSortKey, participantsSortDir);

    if (participantsToExport.length === 0) { showAlert("Não há participantes (com os filtros atuais) para exportar."); return; }
    const filename = `relatorio_participantes_${new Date().toISOString().split('T')[0]}.${format}`;
    const dataType = `${format}_participants`;
    let dataToExportActual = participantsToExport;
    if (format === 'csv') {
        dataToExportActual = participantsToExport.map(({ playerAttempts, ...rest }) => {
            const wonPrizeStatus = prizeWinnersList.some(winner => winner.phone === rest.phone) && rest.score >= localSettingsRef.value.minScoreForPrize;
            return {...rest, wonPrize: wonPrizeStatus ? 'Sim' : 'Não'};
        });
    }
    if (localExportDataFn) {
        localExportDataFn(dataToExportActual, filename, dataType);
        showAlert('Relatório de participantes exportado com sucesso!');
    } else {
        showAlert('Função de exportação não configurada.', 'error');
    }
}


export function initializeReportsScreen(dependencies) {
    localSettingsRef = dependencies.settingsRef;
    localParticipantsRef = dependencies.participantsRef;
    localExportDataFn = dependencies.exportDataFn;

    // Barra de pesquisa global
    searchParticipantsInput = document.getElementById('search-participants-input');

    // Filtros do painel expansível
    filterPeriodRadios = document.querySelectorAll('input[name="report-filter-period"]');
    filterDaysRangeInput = document.getElementById('filter-days-range');
    filterStartDateInput = document.getElementById('filter-start-date');
    filterEndDateInput = document.getElementById('filter-end-date');
    filterPrizeWinnersCheckbox = document.getElementById('filter-prize-winners');
    filterNotPrizeWinnersCheckbox = document.getElementById('filter-not-prize-winners');
    filterLockedOutCheckbox = document.getElementById('filter-locked-out');
    filterExactScoreInput = document.getElementById('filter-exact-score');
    filterEventSelect = document.getElementById('filter-event');
    applyReportFiltersBtn = document.getElementById('apply-report-filters-btn');
    clearReportFiltersBtn = document.getElementById('clear-report-filters-btn');

    // Tabela e contagem
    participantsTableBody = document.getElementById('participants-table-body');
    participantsTotalCountEl = document.getElementById('participants-total-count');
    selectAllParticipantsCheckbox = document.getElementById('select-all-participants-checkbox');

    // Paginação
    participantsPrevPageBtn = document.getElementById('participants-prev-page-btn');
    participantsNextPageBtn = document.getElementById('participants-next-page-btn');
    participantsPageInfo = document.getElementById('participants-page-info');

    // Ações (Exportar, Excluir Todos)
    exportCsvBtn = document.getElementById('export-csv-btn');
    exportJsonBtn = document.getElementById('export-json-btn');
    deleteAllParticipantsBtn = document.getElementById('delete-all-participants-btn');
    
    // Toolbar de ações em lote
    reportsBatchActionsToolbar = document.getElementById('reports-batch-actions-toolbar');

    // Modal de Detalhes do Participante
    participantDetailsModal = document.getElementById('participant-details-modal');
    participantDetailsTitle = document.getElementById('participant-details-title');
    participantInfoSection = document.getElementById('participant-info-section');
    participantAnswersList = document.getElementById('participant-answers-list');
    participantModalActions = document.getElementById('participant-modal-actions');
    closeParticipantModalBtn = participantDetailsModal?.querySelector('.modal-close-icon-btn');

    // Controles do painel de filtros expansível
    filterSectionHeader = document.querySelector('#report-filters-panel .collapsible-header');
    filterSectionContent = document.querySelector('#report-filters-panel .collapsible-content');
    filterCollapseIcon = document.querySelector('#report-filters-panel .collapse-icon');

    // --- Event Listeners ---

    const immediateFilterChangeHandler = () => {
        currentParticipantsPage = 1;
        _applyFiltersAndRenderParticipants();
    };
    
    const applyFiltersButtonHandler = () => {
        currentParticipantsPage = 1;
        selectedParticipantTimestamps.clear();
        if(selectAllParticipantsCheckbox) selectAllParticipantsCheckbox.checked = false;
        _applyFiltersAndRenderParticipants();
    };

    const clearFiltersButtonHandler = () => {
        if(searchParticipantsInput) searchParticipantsInput.value = '';
        if(filterPeriodRadios) {
            filterPeriodRadios.forEach(radio => { radio.checked = radio.value === 'all'; });
            updatePeriodInputsState();
        }
        if(filterStartDateInput) filterStartDateInput.value = '';
        if(filterEndDateInput) filterEndDateInput.value = '';
        if(filterPrizeWinnersCheckbox) filterPrizeWinnersCheckbox.checked = false;
        if(filterNotPrizeWinnersCheckbox) filterNotPrizeWinnersCheckbox.checked = false;
        if(filterLockedOutCheckbox) filterLockedOutCheckbox.checked = false;
        if(filterExactScoreInput) filterExactScoreInput.value = '';
        
        currentParticipantsPage = 1;
        selectedParticipantTimestamps.clear();
        if(selectAllParticipantsCheckbox) selectAllParticipantsCheckbox.checked = false;
        _applyFiltersAndRenderParticipants();
    };

    if(searchParticipantsInput) searchParticipantsInput.addEventListener('input', immediateFilterChangeHandler);
    
    if(applyReportFiltersBtn) applyReportFiltersBtn.addEventListener('click', applyFiltersButtonHandler);
    if(clearReportFiltersBtn) clearReportFiltersBtn.addEventListener('click', clearFiltersButtonHandler);

    const updatePeriodInputsState = () => {
        const selectedPeriodValue = document.querySelector('input[name="report-filter-period"]:checked')?.value;
        if (filterStartDateInput) filterStartDateInput.disabled = selectedPeriodValue !== 'specific';
        if (filterEndDateInput) filterEndDateInput.disabled = selectedPeriodValue !== 'specific';
    };

    if(filterPeriodRadios) {
        [...filterPeriodRadios].forEach(el => el.addEventListener('change', updatePeriodInputsState));
        updatePeriodInputsState();
    }
    
    if (filterPrizeWinnersCheckbox && filterNotPrizeWinnersCheckbox) {
        filterPrizeWinnersCheckbox.addEventListener('change', () => {
            if (filterPrizeWinnersCheckbox.checked) {
                filterNotPrizeWinnersCheckbox.checked = false;
            }
        });
        filterNotPrizeWinnersCheckbox.addEventListener('change', () => {
            if (filterNotPrizeWinnersCheckbox.checked) {
                filterPrizeWinnersCheckbox.checked = false;
            }
        });
    }

    if (participantsPrevPageBtn) participantsPrevPageBtn.addEventListener('click', () => { if (currentParticipantsPage > 1) { currentParticipantsPage--; _applyFiltersAndRenderParticipants(); } });
    if (participantsNextPageBtn) participantsNextPageBtn.addEventListener('click', () => { currentParticipantsPage++; _applyFiltersAndRenderParticipants(); });

    let resizeTimeout;
    window.addEventListener('resize', () => {
        clearTimeout(resizeTimeout);
        resizeTimeout = setTimeout(() => {
            _applyFiltersAndRenderParticipants();
        }, 250);
    });

    document.querySelectorAll('#participants-table th[data-sort-key]').forEach(th => {
        th.addEventListener('click', () => {
            const key = th.dataset.sortKey;
            if (participantsSortKey === key) {
                participantsSortDir = participantsSortDir === 'asc' ? 'desc' : 'asc';
            } else {
                participantsSortKey = key;
                participantsSortDir = (key === 'score' || key === 'time' || key === 'timestamp' || key === 'index') ? 'desc' : 'asc';
            }
            currentParticipantsPage = 1;
            _applyFiltersAndRenderParticipants();
        });
    });

    if (selectAllParticipantsCheckbox) {
        selectAllParticipantsCheckbox.addEventListener('change', _handleSelectAllCheckboxChange);
    }

    if(closeParticipantModalBtn) closeParticipantModalBtn.addEventListener('click', _closeParticipantDetailsModal);
    if(participantDetailsModal) participantDetailsModal.addEventListener('click', (e) => { if(e.target === participantDetailsModal) _closeParticipantDetailsModal(); });
    
    if (exportCsvBtn) exportCsvBtn.addEventListener('click', () => _exportParticipantsHandler('csv'));
    if (exportJsonBtn) exportJsonBtn.addEventListener('click', () => _exportParticipantsHandler('json'));
    if (deleteAllParticipantsBtn) deleteAllParticipantsBtn.addEventListener('click', _handleDeleteAllParticipants);

    // Botões de Ação em Lote (dentro do reportsBatchActionsToolbar)
    const btnUnawardSelected = reportsBatchActionsToolbar ? reportsBatchActionsToolbar.querySelector('#btn-unaward-selected') : null;
    if (btnUnawardSelected) {
        btnUnawardSelected.addEventListener('click', _handleUnawardSelected);
    }
    const btnUnlockSelected = reportsBatchActionsToolbar ? reportsBatchActionsToolbar.querySelector('#btn-unlock-selected') : null;
    if (btnUnlockSelected) {
        btnUnlockSelected.addEventListener('click', _handleUnlockSelected);
    }
    const btnDeleteSelected = reportsBatchActionsToolbar ? reportsBatchActionsToolbar.querySelector('#btn-delete-selected-participants') : null;
    if (btnDeleteSelected) {
        btnDeleteSelected.addEventListener('click', () => {
            const count = selectedParticipantTimestamps.size;
            if (count === 0) {
                showAlert("Nenhum participante selecionado para exclusão.", "warning");
                return;
            }
            showConfirm(`Tem certeza que deseja excluir ${count} participante(s) selecionado(s)? Esta ação não pode ser desfeita.`, {
                onDiscardAndProceed: () => {
                    let currentParticipants = getFromLocalStorage('quizParticipants', []);
                    let participantsWereDeleted = false;
                    selectedParticipantTimestamps.forEach(timestamp => {
                        const participantToDelete = currentParticipants.find(p => p.timestamp === timestamp);
                        if (participantToDelete) {
                             if (participantToDelete.phone) { 
                                removePrizeWinnerByPhone(participantToDelete.phone);
                                removeGiveUpLockoutByPhone(participantToDelete.phone);
                            }
                            currentParticipants = currentParticipants.filter(p => p.timestamp !== timestamp);
                            participantsWereDeleted = true;
                        }
                    });

                    if (participantsWereDeleted) {
                        saveToLocalStorage('quizParticipants', currentParticipants);
                        if(localParticipantsRef) localParticipantsRef.value = currentParticipants;
                        showAlert(`${selectedParticipantTimestamps.size} participante(s) foram excluídos com sucesso.`);
                    }
                    selectedParticipantTimestamps.clear();
                    if(selectAllParticipantsCheckbox) {
                        selectAllParticipantsCheckbox.checked = false;
                        selectAllParticipantsCheckbox.indeterminate = false;
                    }
                    _applyFiltersAndRenderParticipants(); 
                }
            }, 'danger', { discardButtonText: "Sim, Excluir Selecionados" });
        });
    }

    if (filterSectionHeader && filterSectionContent && filterCollapseIcon) {
        const isInitiallyExpanded = filterSectionContent.classList.contains('expanded');
        filterSectionContent.style.maxHeight = isInitiallyExpanded ? filterSectionContent.scrollHeight + "px" : "0px";
        filterSectionHeader.classList.toggle('collapsed', !isInitiallyExpanded);
        filterCollapseIcon.textContent = isInitiallyExpanded ? '▼' : '►';

        filterSectionHeader.addEventListener('click', () => {
            const isExpanded = filterSectionContent.classList.toggle('expanded');
            filterSectionHeader.classList.toggle('collapsed', !isExpanded);
            filterSectionContent.style.maxHeight = isExpanded ? filterSectionContent.scrollHeight + "px" : "0px";
            filterCollapseIcon.textContent = isExpanded ? '▼' : '►';
        });
    }

    currentParticipantsPage = 1;
    _applyFiltersAndRenderParticipants();
}

function _handleUnawardSelected() {
    const count = selectedParticipantTimestamps.size;
    if (count === 0) {
        showAlert("Nenhum participante selecionado.", "warning");
        return;
    }

    showConfirm(`Tem certeza que deseja remover o status de "premiado" de ${count} participante(s) selecionado(s)? Eles poderão ganhar novamente se as regras permitirem.`, {
        onDiscardAndProceed: () => {
            const allParticipants = getFromLocalStorage('quizParticipants', []);
            let actionUndertaken = false;
            selectedParticipantTimestamps.forEach(timestamp => {
                const participant = allParticipants.find(p => p.timestamp === timestamp);
                if (participant && participant.phone) {
                    removePrizeWinnerByPhone(participant.phone);
                    actionUndertaken = true;
                }
            });

            if (actionUndertaken) {
                showAlert(`${count} participante(s) tiveram o status de "premiado" removido.`);
            }
            selectedParticipantTimestamps.clear();
            if(selectAllParticipantsCheckbox) {
                selectAllParticipantsCheckbox.checked = false;
                selectAllParticipantsCheckbox.indeterminate = false;
            }
            _applyFiltersAndRenderParticipants();
        }
    }, 'warning', { discardButtonText: "Sim, Despremiar" });
}

function _handleUnlockSelected() {
    const count = selectedParticipantTimestamps.size;
    if (count === 0) {
        showAlert("Nenhum participante selecionado.", "warning");
        return;
    }

    showConfirm(`Tem certeza que deseja desbloquear ${count} participante(s) selecionado(s)? Eles poderão jogar novamente.`, {
        onDiscardAndProceed: () => {
            const allParticipants = getFromLocalStorage('quizParticipants', []);
            let actionUndertaken = false;
            selectedParticipantTimestamps.forEach(timestamp => {
                const participant = allParticipants.find(p => p.timestamp === timestamp);
                if (participant && participant.phone) {
                    removeGiveUpLockoutByPhone(participant.phone);
                    actionUndertaken = true;
                }
            });

            if (actionUndertaken) {
                showAlert(`${count} participante(s) foram desbloqueados.`);
            }
            selectedParticipantTimestamps.clear();
            if(selectAllParticipantsCheckbox) {
                selectAllParticipantsCheckbox.checked = false;
                selectAllParticipantsCheckbox.indeterminate = false;
            }
            _applyFiltersAndRenderParticipants();
        }
    }, 'warning', { discardButtonText: "Sim, Desbloquear" });
}

// As funções _handleClearAllPrizeWinnersList e _handleClearAllLockedOutList permanecem,
// mas os botões que as chamavam diretamente do toolbar de relatórios foram removidos no HTML.
// Se forem necessários na tela de relatórios, devem ser adicionados à seção de "Ações Gerais".
function _handleClearAllPrizeWinnersList() {
    showConfirm("Tem certeza que deseja limpar TODA a lista de ganhadores de brindes? Esta ação não pode ser desfeita e removerá o status de 'premiado' de todos os participantes que já ganharam.", {
        onDiscardAndProceed: () => {
            clearAllPrizeWinners(); // Função de utils.js
            showAlert("Lista de ganhadores de brindes foi completamente limpa.");
            selectedParticipantTimestamps.clear();
            if(selectAllParticipantsCheckbox) selectAllParticipantsCheckbox.checked = false;
            _applyFiltersAndRenderParticipants();
            _updateActionToolbarState();
        }
    }, 'danger', { discardButtonText: "Sim, Limpar Tudo" });
}

function _handleClearAllLockedOutList() {
    showConfirm("Tem certeza que deseja limpar TODA a lista de participantes bloqueados por desistência? Esta ação não pode ser desfeita e permitirá que todos joguem novamente.", {
        onDiscardAndProceed: () => {
            clearAllGiveUpLockouts(); // Função de utils.js
            showAlert("Lista de bloqueio por desistência foi completamente limpa.");
            selectedParticipantTimestamps.clear();
            if(selectAllParticipantsCheckbox) selectAllParticipantsCheckbox.checked = false;
            _applyFiltersAndRenderParticipants();
            _updateActionToolbarState();
        }
    }, 'danger', { discardButtonText: "Sim, Limpar Tudo" });
}