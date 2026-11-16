// admin/analyticsAdmin.js
import { getFromLocalStorage, formatTime, formatDateToISO } from '../js/utils.js';
import { DEFAULT_SETTINGS } from '../js/constants.js';
import { _openQuestionActionsModal as openQuestionDetailsModalFromAnalytics } from './questionsAdmin.js';

// Variáveis para instâncias dos gráficos Chart.js
let participationsOverTimeChartInstance = null;
let scoreDistributionChartInstance = null;
let hourlyEngagementChartInstance = null;

// Referências DOM (serão atribuídas em initializeAnalyticsScreen)
let analyticsPeriodFilter, analyticsStartDateInput, analyticsEndDateInput,
    customDateRangePicker, refreshAnalyticsDataBtn,
    kpiTotalParticipations, kpiAvgScore, kpiAvgTime, kpiSuccessRate,
    kpiTotalParticipationsTrend, kpiAvgScoreTrend, kpiAvgTimeTrend, kpiSuccessRateTrend,
    participationsOverTimeChartEl, scoreDistributionChartEl, hourlyEngagementChartEl,
    questionAnalysisMetricFilter, questionAnalysisTableEl,
    // questionAnalysisItemsPerPageSelect Removido
    questionAnalysisPaginationControls,
    questionAnalysisPrevPageBtn,
    questionAnalysisNextPageBtn,
    questionAnalysisPageInfo;

// Estado para paginação da Análise de Questões
let questionAnalysisCurrentPage = 1;
const questionAnalysisItemsPerPage = 10; // Fixo em 10 itens por página

// Função auxiliar para limpar/resetar um canvas de gráfico
function clearChartCanvas(canvasId, placeholderText = "Sem dados para exibir.") { // placeholderText não é mais usado aqui
    const canvas = document.getElementById(canvasId);
    if (canvas && canvas.getContext) {
        const ctx = canvas.getContext('2d');
        ctx.clearRect(0, 0, canvas.width, canvas.height);
    }

     // Destruir instância antiga do Chart.js se existir
    if (canvasId === 'analytics-participations-over-time-chart' && participationsOverTimeChartInstance) {
        participationsOverTimeChartInstance.destroy();
        participationsOverTimeChartInstance = null;
    } else if (canvasId === 'analytics-score-distribution-chart' && scoreDistributionChartInstance) {
        scoreDistributionChartInstance.destroy();
        scoreDistributionChartInstance = null;
    } else if (canvasId === 'analytics-hourly-engagement-chart' && hourlyEngagementChartInstance) {
        hourlyEngagementChartInstance.destroy();
        hourlyEngagementChartInstance = null;
    }
    // Não recriar innerHTML aqui, apenas limpar e destruir a instância.
    // O placeholder será gerenciado por show/removeChartPlaceholder
}

function showChartPlaceholder(canvasId, message = "Sem dados para exibir.") {
    const canvas = document.getElementById(canvasId);
    const chartContentEl = canvas ? canvas.parentNode : null;

    if (canvas) {
        canvas.style.display = 'none'; // Esconde o canvas
    }

    if (chartContentEl) {
        let placeholder = chartContentEl.querySelector('.chart-placeholder-text');
        if (!placeholder) {
            placeholder = document.createElement('p');
            placeholder.className = 'chart-placeholder-text';
            chartContentEl.appendChild(placeholder);
        }
        placeholder.textContent = message;
        placeholder.style.display = ''; // Garante que o placeholder esteja visível
    } else {
        console.warn(`Elemento canvas ${canvasId} ou seu pai (chart-content) não encontrado para mostrar placeholder.`);
    }
}

function removeChartPlaceholder(canvasId) {
    const canvas = document.getElementById(canvasId);
    const chartContentEl = canvas ? canvas.parentNode : null;

    if (canvas) {
        canvas.style.display = ''; // Mostra o canvas
    }

    if (chartContentEl) {
        const placeholder = chartContentEl.querySelector('.chart-placeholder-text');
        if (placeholder) {
            placeholder.style.display = 'none'; // Apenas esconde o placeholder
        }
    }
}


function _getFilteredAnalyticsParticipants(period, allLocalParticipants, startDateStr, endDateStr) {
    let filteredParticipants = [];
    const today = new Date();
    today.setHours(0, 0, 0, 0); // Normalizar para o início do dia

    switch (period) {
        case 'today':
            filteredParticipants = allLocalParticipants.filter(p => {
                if (!p.timestamp) return false;
                const participantDate = new Date(p.timestamp);
                participantDate.setHours(0,0,0,0);
                return participantDate.getTime() === today.getTime();
            });
            break;
        case 'last3days':
            const threeDaysAgo = new Date(today);
            threeDaysAgo.setDate(today.getDate() - 2);
            filteredParticipants = allLocalParticipants.filter(p => {
                if (!p.timestamp) return false;
                const participantDate = new Date(p.timestamp);
                return participantDate >= threeDaysAgo;
            });
            break;
        case 'last7days':
            const sevenDaysAgo = new Date(today);
            sevenDaysAgo.setDate(today.getDate() - 6);
            filteredParticipants = allLocalParticipants.filter(p => {
                if (!p.timestamp) return false;
                const participantDate = new Date(p.timestamp);
                return participantDate >= sevenDaysAgo;
            });
            break;
        case 'last30days':
            const thirtyDaysAgo = new Date(today);
            thirtyDaysAgo.setDate(today.getDate() - 29);
            filteredParticipants = allLocalParticipants.filter(p => {
                if (!p.timestamp) return false;
                const participantDate = new Date(p.timestamp);
                return participantDate >= thirtyDaysAgo;
            });
            break;
        case 'custom':
            if (startDateStr && endDateStr) {
                const startDate = new Date(startDateStr + "T00:00:00"); // Adiciona hora para evitar problemas de fuso
                const endDate = new Date(endDateStr + "T23:59:59"); // Adiciona hora para incluir todo o dia final
                filteredParticipants = allLocalParticipants.filter(p => {
                    if (!p.timestamp) return false;
                    const participantDate = new Date(p.timestamp);
                    return participantDate >= startDate && participantDate <= endDate;
                });
            } else {
                filteredParticipants = [...allLocalParticipants]; // Fallback se datas não estiverem ok
            }
            break;
        case 'all':
        default:
            filteredParticipants = [...allLocalParticipants];
            break;
    }
    return filteredParticipants;
}

function _displayAnalyticsKPIs(filteredParticipants, currentSettings) {
    const totalParticipations = filteredParticipants.length;
    if (kpiTotalParticipations) kpiTotalParticipations.textContent = totalParticipations;
    // Placeholder para tendências - lógica de cálculo de tendência pode ser adicionada depois
    if (kpiTotalParticipationsTrend) kpiTotalParticipationsTrend.textContent = "";

    if (totalParticipations === 0) {
        if (kpiAvgScore) kpiAvgScore.textContent = "-";
        if (kpiAvgTime) kpiAvgTime.textContent = "-";
        if (kpiSuccessRate) kpiSuccessRate.textContent = "-";
        if (kpiAvgScoreTrend) kpiAvgScoreTrend.textContent = "";
        if (kpiAvgTimeTrend) kpiAvgTimeTrend.textContent = "";
        if (kpiSuccessRateTrend) kpiSuccessRateTrend.textContent = "";
        return false; // Indica que não há dados para os gráficos principais
    }

    let totalScoreSum = 0;
    filteredParticipants.forEach(p => { totalScoreSum += (p.score || 0); });
    const averageScore = totalParticipations > 0 ? (totalScoreSum / totalParticipations).toFixed(2) : 0;
    if (kpiAvgScore) kpiAvgScore.textContent = averageScore;
    if (kpiAvgScoreTrend) kpiAvgScoreTrend.textContent = "";

    let totalTimeSum = 0;
    filteredParticipants.forEach(p => { totalTimeSum += (p.time || 0); });
    const averageTimeSeconds = totalParticipations > 0 ? Math.round(totalTimeSum / totalParticipations) : 0;
    if (kpiAvgTime) kpiAvgTime.textContent = formatTime(averageTimeSeconds);
    if (kpiAvgTimeTrend) kpiAvgTimeTrend.textContent = "";

    const minScoreForPrize = currentSettings.minScoreForPrize || DEFAULT_SETTINGS.minScoreForPrize;
    const successfulParticipants = filteredParticipants.filter(p => (p.score || 0) >= minScoreForPrize).length;
    const successRate = totalParticipations > 0 ? ((successfulParticipants / totalParticipations) * 100).toFixed(1) : 0;
    if (kpiSuccessRate) kpiSuccessRate.textContent = `${successRate}%`;
    if (kpiSuccessRateTrend) kpiSuccessRateTrend.textContent = "";

    return true; // Indica que há dados para processar
}


function _renderChart(canvasId, chartInstanceVariable, chartConfig) {
    const canvas = document.getElementById(canvasId);
    if (!canvas || !canvas.getContext) {
        console.warn(`Canvas com ID ${canvasId} não encontrado ou não suportado.`);
        showChartPlaceholder(canvasId, "Erro ao carregar gráfico.");
        return null;
    }
    
    removeChartPlaceholder(canvasId); // Remove placeholder antes de desenhar

    // Destruir instância antiga do Chart.js se existir
    if (chartInstanceVariable && chartInstanceVariable.destroy) {
        chartInstanceVariable.destroy();
    }
    
    try {
        const newChartInstance = new Chart(canvas.getContext('2d'), chartConfig);
        return newChartInstance;
    } catch (error) {
        console.error(`Erro ao renderizar gráfico ${canvasId}:`, error);
        showChartPlaceholder(canvasId, "Erro ao renderizar dados.");
        return null;
    }
}


function _generateAndRenderMainCharts(filteredParticipants, currentSettings) {
    if (typeof Chart === 'undefined') {
        console.error("Chart.js não está carregado. Não é possível renderizar gráficos.");
        showChartPlaceholder('analytics-participations-over-time-chart', "Biblioteca de gráficos não carregada.");
        showChartPlaceholder('analytics-score-distribution-chart', "Biblioteca de gráficos não carregada.");
        showChartPlaceholder('analytics-hourly-engagement-chart', "Biblioteca de gráficos não carregada.");
        return;
    }

    // 1. Participações ao Longo do Tempo (Exemplo: Diário para o período filtrado)
    const participationsByDate = {};
    filteredParticipants.forEach(p => {
        if (p.timestamp) {
            const date = p.timestamp.split('T')[0];
            participationsByDate[date] = (participationsByDate[date] || 0) + 1;
        }
    });
    const sortedDates = Object.keys(participationsByDate).sort();
    const participationCounts = sortedDates.map(date => participationsByDate[date]);
    // console.log('[Analítico CHK] Particip. ao Longo do Tempo - Datas:', sortedDates, 'Contagens:', participationCounts);

    if (sortedDates.length > 0 && participationCounts.some(c => c > 0)) { // Adicionada verificação de contagens > 0
        // console.log('[Analítico CHK] Renderizando gráfico de Particip. ao Longo do Tempo.');
        participationsOverTimeChartInstance = _renderChart('analytics-participations-over-time-chart', participationsOverTimeChartInstance, {
            type: 'line',
            data: {
                labels: sortedDates.map(date => new Date(date + "T00:00:00").toLocaleDateString('pt-BR')), // Adiciona T00:00:00 para consistência
                datasets: [{
                    label: 'Participações',
                    data: participationCounts,
                    borderColor: 'rgba(75, 192, 192, 1)',
                    backgroundColor: 'rgba(75, 192, 192, 0.2)',
                    tension: 0.1,
                    fill: true
                }]
            },
            options: { responsive: true, maintainAspectRatio: false, scales: { y: { beginAtZero: true } } }
        });
    } else {
        // console.log('[Analítico CHK] Sem dados para gráfico de Particip. ao Longo do Tempo.');
        showChartPlaceholder('analytics-participations-over-time-chart');
    }


    // 2. Distribuição de Pontuações
    const maxPossibleScore = currentSettings.numberOfQuestions || DEFAULT_SETTINGS.numberOfQuestions;
    const scoreDistribution = Array(maxPossibleScore + 1).fill(0);
    filteredParticipants.forEach(p => {
        if (typeof p.score === 'number' && p.score >= 0 && p.score <= maxPossibleScore) {
            scoreDistribution[p.score]++;
        }
    });
    // console.log('[Analítico CHK] Distribuição de Pontuações - Dados:', scoreDistribution);
     if (scoreDistribution.some(count => count > 0)) {
        // console.log('[Analítico CHK] Renderizando gráfico de Distribuição de Pontuações.');
        scoreDistributionChartInstance = _renderChart('analytics-score-distribution-chart', scoreDistributionChartInstance, {
            type: 'bar',
            data: {
                labels: scoreDistribution.map((_, i) => `${i} Acerto(s)`),
                datasets: [{
                    label: 'Número de Participantes',
                    data: scoreDistribution,
                    backgroundColor: 'rgba(153, 102, 255, 0.6)',
                    borderColor: 'rgba(153, 102, 255, 1)',
                    borderWidth: 1
                }]
            },
            options: { responsive: true, maintainAspectRatio: false, scales: { y: { beginAtZero: true, stepSize: 1 } } }
        });
    } else {
        // console.log('[Analítico CHK] Sem dados para gráfico de Distribuição de Pontuações.');
        showChartPlaceholder('analytics-score-distribution-chart');
    }

    // 3. Engajamento por Hora do Dia
    const participationsByHour = Array(24).fill(0);
    filteredParticipants.forEach(p => {
        if (p.timestamp) {
            const hour = new Date(p.timestamp).getHours();
            participationsByHour[hour]++;
        }
    });
    // console.log('[Analítico CHK] Engajamento por Hora - Dados:', participationsByHour);
    if (participationsByHour.some(count => count > 0)) {
        // console.log('[Analítico CHK] Renderizando gráfico de Engajamento por Hora.');
        hourlyEngagementChartInstance = _renderChart('analytics-hourly-engagement-chart', hourlyEngagementChartInstance, {
            type: 'bar',
            data: {
                labels: participationsByHour.map((_, i) => `${String(i).padStart(2, '0')}:00`),
                datasets: [{
                    label: 'Participações',
                    data: participationsByHour,
                    backgroundColor: 'rgba(255, 159, 64, 0.6)',
                    borderColor: 'rgba(255, 159, 64, 1)',
                    borderWidth: 1
                }]
            },
            options: { responsive: true, maintainAspectRatio: false, scales: { y: { beginAtZero: true } } }
        });
    } else {
        // console.log('[Analítico CHK] Sem dados para gráfico de Engajamento por Hora.');
        showChartPlaceholder('analytics-hourly-engagement-chart');
    }
}

function _renderQuestionAnalysis(filteredParticipants, allLocalQuestions) {
    console.log('[KILO DEBUG] Iniciando _renderQuestionAnalysis...');
    
    // Mapa de normalização de IDs para garantir consistência
    const idNormalizationMap = new Map();
    allLocalQuestions.forEach(q => {
        const numericId = typeof q.id === 'number' ? q.id : parseInt(String(q.id).replace(/\D/g, ''), 10);
        if (!isNaN(numericId)) {
            idNormalizationMap.set(q.id, numericId); // original -> numeric
            idNormalizationMap.set('q' + numericId, numericId); // q prefix -> numeric
            idNormalizationMap.set(String(numericId), numericId); // string -> numeric
        }
    });
    
    // Inicializa questionPerformance com TODAS as questões do banco
    const questionPerformance = {};
    allLocalQuestions.forEach(q => {
        const normalizedId = idNormalizationMap.get(q.id) || q.id;
        questionPerformance[normalizedId] = {
            id: normalizedId,
            text: q.text,
            isDisabled: q.isDisabled || false,
            correct: 0,
            total: 0,
            accuracy: 0,
            uniqueParticipants: new Set()
        };
    });

    // Processa as tentativas dos participantes
    let totalProcessedAttempts = 0;
    let skippedAttempts = 0;
    
    filteredParticipants.forEach((participant, pIndex) => {
        if (participant.playerAttempts && Array.isArray(participant.playerAttempts)) {
            participant.playerAttempts.forEach((attempt, aIndex) => {
                if (!attempt || typeof attempt.questionId === 'undefined') {
                    skippedAttempts++;
                    return;
                }

                // Normaliza o ID da questão usando o mapa de normalização
                const originalId = attempt.questionId;
                const normalizedQuestionId = idNormalizationMap.get(originalId);

                if (normalizedQuestionId !== undefined && questionPerformance.hasOwnProperty(normalizedQuestionId)) {
                    totalProcessedAttempts++;
                    questionPerformance[normalizedQuestionId].total++;
                    if (attempt.isCorrect) {
                        questionPerformance[normalizedQuestionId].correct++;
                    }
                    if (participant.id) {
                        questionPerformance[normalizedQuestionId].uniqueParticipants.add(participant.id);
                    }
                } else {
                    skippedAttempts++;
                    console.warn(`[Analytics] Tentativa ignorada - ID não mapeado: ${originalId} -> ${normalizedQuestionId}`);
                }
            });
        }
    });

    console.log(`[Analytics] Total de tentativas processadas: ${totalProcessedAttempts}, Ignoradas: ${skippedAttempts}`);

    // Calcula a acurácia para todas as questões
    Object.values(questionPerformance).forEach(q => {
        q.accuracy = q.total > 0 ? (q.correct / q.total) * 100 : 0;
        q.uniqueAnswers = q.uniqueParticipants.size;
    });

    // Prepara array para ordenação
    const performanceArray = Object.values(questionPerformance);
    let sortedQuestions = [];
    const metric = questionAnalysisMetricFilter.value;

    switch (metric) {
        case 'difficulty':
            // Mais difíceis: menor % de acerto E pelo menos uma resposta
            sortedQuestions = performanceArray
                .filter(q => q.total > 0)
                .sort((a, b) => {
                    if (a.accuracy === b.accuracy) {
                        return b.total - a.total; // Desempate por mais respostas
                    }
                    return a.accuracy - b.accuracy;
                });
            // Adiciona questões sem respostas ao final
            sortedQuestions = [...sortedQuestions, ...performanceArray.filter(q => q.total === 0)];
            break;
        case 'easiness':
            // Mais fáceis: maior % de acerto E pelo menos uma resposta
            sortedQuestions = performanceArray
                .filter(q => q.total > 0)
                .sort((a, b) => {
                    if (a.accuracy === b.accuracy) {
                        return b.total - a.total; // Desempate por mais respostas
                    }
                    return b.accuracy - a.accuracy;
                });
            // Adiciona questões sem respostas ao final
            sortedQuestions = [...sortedQuestions, ...performanceArray.filter(q => q.total === 0)];
            break;
        case 'most_answered':
            sortedQuestions = [...performanceArray].sort((a, b) => b.total - a.total);
            break;
        case 'least_answered':
            sortedQuestions = [...performanceArray].sort((a, b) => a.total - b.total);
            break;
        default:
            sortedQuestions = performanceArray;
    }

    // Paginação e renderização
    const totalItems = sortedQuestions.length;
    const itemsPerPageNum = questionAnalysisItemsPerPage;
    const totalPages = Math.ceil(totalItems / itemsPerPageNum);
    questionAnalysisCurrentPage = Math.max(1, Math.min(questionAnalysisCurrentPage, totalPages || 1));

    const startIndex = (questionAnalysisCurrentPage - 1) * itemsPerPageNum;
    const endIndex = startIndex + itemsPerPageNum;
    const paginatedQuestions = sortedQuestions.slice(startIndex, endIndex);

    // Renderização da tabela
    questionAnalysisTableEl.innerHTML = '';
    _renderQuestionAnalysisPaginationControls(totalItems, itemsPerPageNum);

    if (paginatedQuestions.length === 0) {
        questionAnalysisTableEl.innerHTML = '<p class="chart-placeholder-text">Sem dados de questões para o filtro selecionado.</p>';
        return;
    }

    const table = document.createElement('table');
    const thead = document.createElement('thead');
    const tbody = document.createElement('tbody');

    thead.innerHTML = `
        <tr>
            <th>Questão (ID)</th>
            <th>Total Respostas</th>
            <th>Acertos</th>
            <th>% Acerto</th>
            <th>Status</th>
        </tr>
    `;

    paginatedQuestions.forEach(q => {
        const tr = document.createElement('tr');
        tr.dataset.questionId = q.id;
        tr.style.cursor = 'pointer';
        const questionTextShort = q.text.length > 70 ? q.text.substring(0, 67) + "..." : q.text;
        tr.innerHTML = `
            <td title="${q.text}">${questionTextShort} (#${q.id})</td>
            <td>${q.total}</td>
            <td>${q.correct}</td>
            <td>${q.accuracy.toFixed(1)}%</td>
            <td>${q.total === 0 ? 'Sem respostas' : (q.isDisabled ? 'Desabilitada' : 'Ativa')}</td>
        `;
        tr.addEventListener('click', () => {
            if (typeof openQuestionDetailsModalFromAnalytics === 'function') {
                openQuestionDetailsModalFromAnalytics(q.id);
            }
        });
        tbody.appendChild(tr);
    });

    table.appendChild(thead);
    table.appendChild(tbody);
    questionAnalysisTableEl.appendChild(table);
}


function _renderQuestionAnalysisPaginationControls(totalItems, itemsPerPageNum) {
    if (!questionAnalysisPaginationControls) return;

    questionAnalysisPaginationControls.innerHTML = ''; // Limpar controles antigos

    if (totalItems === 0) {
        const pageInfo = document.createElement('span');
        pageInfo.className = 'page-info';
        pageInfo.textContent = "Nenhuma questão para exibir.";
        questionAnalysisPaginationControls.appendChild(pageInfo);
        questionAnalysisPaginationControls.classList.remove('hidden');
        return;
    }
    
    const totalPages = Math.ceil(totalItems / itemsPerPageNum);

    questionAnalysisPrevPageBtn = document.createElement('button'); // Atribui à variável global
    questionAnalysisPrevPageBtn.id = 'question-analysis-prev-page-btn';
    questionAnalysisPrevPageBtn.className = 'btn-pagination';
    questionAnalysisPrevPageBtn.innerHTML = '&laquo; Anterior';
    questionAnalysisPrevPageBtn.disabled = questionAnalysisCurrentPage === 1;
    questionAnalysisPaginationControls.appendChild(questionAnalysisPrevPageBtn);

    questionAnalysisPageInfo = document.createElement('span'); // Atribui à variável global
    questionAnalysisPageInfo.id = 'question-analysis-page-info';
    questionAnalysisPageInfo.className = 'page-info';
    questionAnalysisPageInfo.textContent = `Página ${questionAnalysisCurrentPage} de ${totalPages || 1}`;
    questionAnalysisPaginationControls.appendChild(questionAnalysisPageInfo);

    questionAnalysisNextPageBtn = document.createElement('button'); // Atribui à variável global
    questionAnalysisNextPageBtn.id = 'question-analysis-next-page-btn';
    questionAnalysisNextPageBtn.className = 'btn-pagination';
    questionAnalysisNextPageBtn.innerHTML = 'Próxima &raquo;';
    questionAnalysisNextPageBtn.disabled = questionAnalysisCurrentPage === totalPages || totalPages === 0;
    questionAnalysisPaginationControls.appendChild(questionAnalysisNextPageBtn);
    
    // Adicionar listeners aqui, pois os botões são recriados
    questionAnalysisPrevPageBtn.addEventListener('click', () => {
        if (questionAnalysisCurrentPage > 1) {
            questionAnalysisCurrentPage--;
            _renderAnalyticsDashboard();
        }
    });
    questionAnalysisNextPageBtn.addEventListener('click', () => {
        const currentTotalPages = Math.ceil(totalItems / itemsPerPageNum);
        if (questionAnalysisCurrentPage < currentTotalPages) {
            questionAnalysisCurrentPage++;
            _renderAnalyticsDashboard();
        }
    });

    if (totalPages <= 1) {
         questionAnalysisPaginationControls.classList.add('hidden');
    } else {
         questionAnalysisPaginationControls.classList.remove('hidden');
    }
}
 
 function _renderAnalyticsDashboard() {
    if (!analyticsPeriodFilter) {
        console.warn("Elementos do dashboard analítico não encontrados. A inicialização pode ter falhado.");
        return;
    }

    const allLocalParticipants = getFromLocalStorage('quizParticipants', []);
    const allLocalQuestions = getFromLocalStorage('quizQuestions', []); // Assumindo que as questões estão disponíveis
    const currentSettings = getFromLocalStorage('quizSettings', DEFAULT_SETTINGS);
    // console.log('[Analítico] _renderAnalyticsDashboard - Participantes Carregados:', JSON.parse(JSON.stringify(allLocalParticipants)));
    // console.log('[Analítico] _renderAnalyticsDashboard - Questões Carregadas:', JSON.parse(JSON.stringify(allLocalQuestions)));

    const period = analyticsPeriodFilter.value;
    const startDate = analyticsStartDateInput.value;
    const endDate = analyticsEndDateInput.value;

    const filteredParticipants = _getFilteredAnalyticsParticipants(period, allLocalParticipants, startDate, endDate);

    const hasDataForKPIs = _displayAnalyticsKPIs(filteredParticipants, currentSettings);

    if (hasDataForKPIs) {
        _generateAndRenderMainCharts(filteredParticipants, currentSettings);
        _renderQuestionAnalysis(filteredParticipants, allLocalQuestions);
    } else {
        // Limpar ou mostrar placeholders para todos os gráficos se não houver dados de KPI
        showChartPlaceholder('analytics-participations-over-time-chart');
        showChartPlaceholder('analytics-score-distribution-chart');
        showChartPlaceholder('analytics-hourly-engagement-chart');
        if (questionAnalysisTableEl) questionAnalysisTableEl.innerHTML = '<p class="chart-placeholder-text">Sem dados de participação para analisar questões.</p>';
    }
}

function _handlePeriodFilterChange() {
    const period = analyticsPeriodFilter.value;
    if (period === 'custom') {
        customDateRangePicker.classList.remove('hidden');
        // Opcional: definir datas padrão se estiverem vazias
        if (!analyticsStartDateInput.value) {
            analyticsStartDateInput.value = formatDateToISO(new Date(new Date().setDate(new Date().getDate() - 6))); // Padrão: últimos 7 dias
        }
        if (!analyticsEndDateInput.value) {
            analyticsEndDateInput.value = formatDateToISO(new Date());
        }
    } else {
        customDateRangePicker.classList.add('hidden');
    }
    _renderAnalyticsDashboard(); // Atualiza o dashboard quando o filtro principal muda
}


export function initializeAnalyticsScreen(dependencies) {
    // Atribui referências DOM
    analyticsPeriodFilter = document.getElementById('analytics-period-filter');
    analyticsStartDateInput = document.getElementById('analytics-start-date');
    analyticsEndDateInput = document.getElementById('analytics-end-date');
    customDateRangePicker = document.getElementById('analytics-custom-date-range-picker');
    refreshAnalyticsDataBtn = document.getElementById('refresh-analytics-data-btn');

    kpiTotalParticipations = document.getElementById('kpi-total-participations');
    kpiAvgScore = document.getElementById('kpi-avg-score');
    kpiAvgTime = document.getElementById('kpi-avg-time');
    kpiSuccessRate = document.getElementById('kpi-success-rate');

    kpiTotalParticipationsTrend = document.getElementById('kpi-total-participations-trend');
    kpiAvgScoreTrend = document.getElementById('kpi-avg-score-trend');
    kpiAvgTimeTrend = document.getElementById('kpi-avg-time-trend');
    kpiSuccessRateTrend = document.getElementById('kpi-success-rate-trend');

    participationsOverTimeChartEl = document.getElementById('analytics-participations-over-time-chart');
    scoreDistributionChartEl = document.getElementById('analytics-score-distribution-chart');
    hourlyEngagementChartEl = document.getElementById('analytics-hourly-engagement-chart');

    questionAnalysisMetricFilter = document.getElementById('question-analysis-metric-filter');
    questionAnalysisTableEl = document.getElementById('analytics-question-analysis-table');
    // questionAnalysisItemsPerPageSelect removido
    questionAnalysisPaginationControls = document.getElementById('question-analysis-pagination-controls');
   // questionAnalysisPageInfo, questionAnalysisPrevPageBtn, questionAnalysisNextPageBtn são criados/gerenciados em _renderQuestionAnalysisPaginationControls

    // Adiciona Event Listeners
    if (analyticsPeriodFilter) {
        analyticsPeriodFilter.addEventListener('change', _handlePeriodFilterChange);
    }
    if (analyticsStartDateInput) {
        analyticsStartDateInput.addEventListener('change', _renderAnalyticsDashboard);
    }
    if (analyticsEndDateInput) {
        analyticsEndDateInput.addEventListener('change', _renderAnalyticsDashboard);
    }
    if (refreshAnalyticsDataBtn) {
        refreshAnalyticsDataBtn.addEventListener('click', _renderAnalyticsDashboard);
    }
    if (questionAnalysisMetricFilter) {
        questionAnalysisMetricFilter.addEventListener('change', () => {
            questionAnalysisCurrentPage = 1; // Resetar página ao mudar métrica
            _renderAnalyticsDashboard();
        });
    }
    // Listener para questionAnalysisItemsPerPageSelect removido
    // Listeners para botões de paginação são adicionados dinamicamente em _renderQuestionAnalysisPaginationControls
    
    // Carga inicial
    if (analyticsPeriodFilter) { // Garante que o filtro existe antes de tentar ler seu valor
      _handlePeriodFilterChange(); // Chama para configurar o picker de data e renderizar
    } else {
      console.warn("Filtro de período principal não encontrado. Dashboard analítico pode não funcionar corretamente.");
    }
}