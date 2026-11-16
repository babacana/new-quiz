// admin/statsAdmin.js
import { getFromLocalStorage, showAlert } from '../js/utils.js'; // showAlert pode não ser necessário aqui diretamente

// Constantes
const ITEMS_PER_PAGE_STATS = 10; // Pode ser diferente de ITEMS_PER_PAGE de reports

// Referências DOM
let avgScoreStatEl, totalParticipationsStatEl, questionStatsTableBodyEl, noStatsMessageEl,
    statsPrevPageBtn, statsNextPageBtn, statsPageInfo;

// Estado local do módulo
let currentStatsPage = 1;
let statsSortKey = 'text'; // Default sort key for question text
let statsSortDir = 'asc';  // Default sort direction

// Callbacks e referências
let localToggleQuestionDisabledStateCallback;
let localSortDataFn; // Função sortData (de utils.js ou admin.js)
let localUpdateSortIconsFn; // Função updateSortIcons (de utils.js ou admin.js)


function _loadAdminStats() {
    if (!avgScoreStatEl || !totalParticipationsStatEl || !questionStatsTableBodyEl || !noStatsMessageEl) {
        console.warn("Elementos da tela de estatísticas não encontrados.");
        return;
    }

    const localParticipants = getFromLocalStorage('quizParticipants', []);
    const localAllQuestions = getFromLocalStorage('quizQuestions', []);

    if (localParticipants.length === 0 && localAllQuestions.length === 0) {
        avgScoreStatEl.textContent = "-";
        totalParticipationsStatEl.textContent = "0";
        questionStatsTableBodyEl.innerHTML = `<tr><td colspan="6">Nenhuma questão cadastrada para exibir estatísticas.</td></tr>`;
        noStatsMessageEl.classList.add('hidden');
        if (localUpdateSortIconsFn) localUpdateSortIconsFn('question-stats-table', statsSortKey, statsSortDir);
        // _updateStatsPaginationControls(1, 1); // Atualiza controles de paginação
        return;
    }

    if (localParticipants.length === 0) {
        avgScoreStatEl.textContent = "-";
        totalParticipationsStatEl.textContent = "0";
    } else {
        let totalScoreSum = 0;
        localParticipants.forEach(p => { totalScoreSum += (p.score || 0); });
        const averageScore = localParticipants.length > 0 ? (totalScoreSum / localParticipants.length).toFixed(2) : "0.00";
        avgScoreStatEl.textContent = averageScore;
        totalParticipationsStatEl.textContent = localParticipants.length;
    }

    const questionPerformance = {};
    localAllQuestions.forEach(q => {
        questionPerformance[q.id] = {
            id: q.id,
            text: q.text,
            displayText: q.text.substring(0,50) + (q.text.length > 50 ? "..." : ""),
            correct: 0,
            incorrect: 0,
            total: 0,
            isDisabled: q.isDisabled
        };
    });

    localParticipants.forEach(participant => {
        if (participant.playerAttempts && Array.isArray(participant.playerAttempts)) {
            participant.playerAttempts.forEach(attempt => {
                const questionId = attempt.questionId;
                if (!questionId || !questionPerformance[questionId]) return; // Pula se a questão não existe mais
                questionPerformance[questionId].total++;
                if (attempt.isCorrect) {
                    questionPerformance[questionId].correct++;
                } else {
                    questionPerformance[questionId].incorrect++;
                }
            });
        }
    });

    let performanceArray = Object.values(questionPerformance);
    if (localSortDataFn) {
        performanceArray = localSortDataFn(performanceArray, statsSortKey, statsSortDir);
    }


    const totalItems = performanceArray.length;
    const totalPages = Math.ceil(totalItems / ITEMS_PER_PAGE_STATS) || 1;
    currentStatsPage = Math.max(1, Math.min(currentStatsPage, totalPages));

    const startIndex = (currentStatsPage - 1) * ITEMS_PER_PAGE_STATS;
    const endIndex = startIndex + ITEMS_PER_PAGE_STATS;
    const paginatedData = performanceArray.slice(startIndex, endIndex);

    questionStatsTableBodyEl.innerHTML = '';
    if (paginatedData.length === 0) {
        noStatsMessageEl.classList.remove('hidden');
        noStatsMessageEl.textContent = "Nenhuma estatística de questão para exibir.";
        if(localAllQuestions.length === 0) noStatsMessageEl.textContent = "Nenhuma questão cadastrada.";
    } else {
        noStatsMessageEl.classList.add('hidden');
        paginatedData.forEach(stat => {
            const row = questionStatsTableBodyEl.insertRow();
            row.classList.toggle('disabled-question-row', stat.isDisabled === true);

            row.insertCell().textContent = stat.displayText;
            row.insertCell().textContent = stat.total;
            row.insertCell().textContent = stat.correct;
            row.insertCell().textContent = stat.incorrect;
            const accuracy = stat.total > 0 ? ((stat.correct / stat.total) * 100).toFixed(1) + '%' : 'N/A';
            row.insertCell().textContent = accuracy;

            const actionsCell = row.insertCell();
            const toggleBtn = document.createElement('button');
            toggleBtn.dataset.id = stat.id;
            toggleBtn.classList.add('btn-toggle-q-status');
            if (stat.isDisabled) {
                toggleBtn.textContent = 'Habilitar';
                toggleBtn.classList.add('enabled-q');
            } else {
                toggleBtn.textContent = 'Desabilitar';
                toggleBtn.classList.add('disabled-q');
            }
            if (localToggleQuestionDisabledStateCallback) {
                toggleBtn.addEventListener('click', (e) => localToggleQuestionDisabledStateCallback(e.target.dataset.id, 'admin-stats-screen'));
            }
            actionsCell.appendChild(toggleBtn);
        });
    }
    _updateStatsPaginationControls(currentStatsPage, totalPages);
    if (localUpdateSortIconsFn) localUpdateSortIconsFn('question-stats-table', statsSortKey, statsSortDir);
}

function _updateStatsPaginationControls(currentPage, totalPages) {
    if (statsPageInfo) statsPageInfo.textContent = `Página ${currentPage} de ${totalPages}`;
    if (statsPrevPageBtn) statsPrevPageBtn.disabled = currentPage === 1;
    if (statsNextPageBtn) statsNextPageBtn.disabled = currentPage === totalPages || totalPages === 0;
}

export function getQuestionStatsById(targetQuestionId) {
    const localParticipants = getFromLocalStorage('quizParticipants', []);
    const localAllQuestions = getFromLocalStorage('quizQuestions', []);

    const question = localAllQuestions.find(q => String(q.id) === String(targetQuestionId));

    if (!question) {
        return {
            text: 'Questão não encontrada',
            total: 0,
            correct: 0,
            incorrect: 0,
            accuracy: 'N/A',
            isDisabled: true // Assume desabilitada se não encontrada
        };
    }

    let stats = {
        id: question.id,
        text: question.text,
        correct: 0,
        incorrect: 0,
        total: 0,
        isDisabled: question.isDisabled
    };

    localParticipants.forEach(participant => {
        if (participant.playerAttempts && Array.isArray(participant.playerAttempts)) {
            participant.playerAttempts.forEach(attempt => {
                if (String(attempt.questionId) === String(targetQuestionId)) {
                    stats.total++;
                    if (attempt.isCorrect) {
                        stats.correct++;
                    } else {
                        stats.incorrect++;
                    }
                }
            });
        }
    });

    stats.accuracy = stats.total > 0 ? ((stats.correct / stats.total) * 100).toFixed(1) + '%' : 'N/A';
    return stats;
}


export function initializeStatsScreen(dependencies) {
    localToggleQuestionDisabledStateCallback = dependencies.toggleQuestionDisabledStateCallback;
    localSortDataFn = dependencies.sortDataFn;
    localUpdateSortIconsFn = dependencies.updateSortIconsFn;

    avgScoreStatEl = document.getElementById('avg-score-stat');
    totalParticipationsStatEl = document.getElementById('total-participations-stat');
    questionStatsTableBodyEl = document.getElementById('question-stats-table-body');
    noStatsMessageEl = document.getElementById('no-stats-message');
    statsPrevPageBtn = document.getElementById('stats-prev-page-btn');
    statsNextPageBtn = document.getElementById('stats-next-page-btn');
    statsPageInfo = document.getElementById('stats-page-info');

    if (statsPrevPageBtn) {
        statsPrevPageBtn.addEventListener('click', () => {
            if (currentStatsPage > 1) {
                currentStatsPage--;
                _loadAdminStats();
            }
        });
    }
    if (statsNextPageBtn) {
        statsNextPageBtn.addEventListener('click', () => {
            // Precisamos recalcular totalPages antes de incrementar
            const localAllQuestions = getFromLocalStorage('quizQuestions', []);
            const totalItems = localAllQuestions.length; // Simplificado, pode precisar de lógica de filtro se houver
            const totalPages = Math.ceil(totalItems / ITEMS_PER_PAGE_STATS) || 1;
            if (currentStatsPage < totalPages) {
                currentStatsPage++;
                _loadAdminStats();
            }
        });
    }

    document.querySelectorAll('#question-stats-table th[data-sort-key]').forEach(th => {
        th.addEventListener('click', () => {
            const key = th.dataset.sortKey;
            if (statsSortKey === key) {
                statsSortDir = statsSortDir === 'asc' ? 'desc' : 'asc';
            } else {
                statsSortKey = key;
                statsSortDir = (key === 'total' || key === 'correct' || key === 'incorrect' || key === 'accuracy') ? 'desc' : 'asc';
            }
            currentStatsPage = 1; // Reset page on sort
            _loadAdminStats();
        });
    });

    currentStatsPage = 1; // Reset page on screen load
    _loadAdminStats();
}