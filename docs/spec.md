# Especificação (PRD): Plataforma Online/Offline-First de Quiz Interativo para Eventos

## Problem Statement

O sistema original de quiz foi desenvolvido para operar de forma 100% isolada a partir de um pendrive no navegador de um único notebook/totem em feiras e congressos, salvando todos os dados (`localStorage`) e imagens (`assets/`) localmente na própria máquina. Embora a dinâmica de jogo, o sorteio por dificuldade, o teclado virtual e as travas de premiação tenham funcionado muito bem em pista, essa arquitetura impõe limitações críticas à operação em eventos:

1. **Impossibilidade de gestão e monitoramento remotos:** O Administrador precisa ir fisicamente até o Totem, interromper a fila de visitantes e acessar o painel administrativo na própria tela do Totem para ajustar configurações, cadastrar questões, liberar telefones bloqueados ou consultar relatórios.
2. **Isolamento entre múltiplos Totens:** Se o estande tiver dois ou mais Totens operando simultaneamente, o Ranking, o histórico de Partidas e a Trava de Brinde por telefone não são compartilhados entre eles, permitindo que um mesmo Participante conquiste mais de um Brinde no mesmo Evento.
3. **Ausência de histórico Multi-Evento:** Como existe apenas um evento ativo e uma lista global de Participantes, iniciar uma nova feira exige exportar um backup manual e apagar todos os dados anteriores, impedindo análises comparativas entre edições.
4. **Falta de visão operacional móvel para a equipe do estande:** Atendentes (Operadores) não conseguem consultar pelo celular quem acabou de ganhar um Brinde, dar baixa na retirada (quando aplicável), acompanhar o estoque de Brindes ou destravar um Participante sem acesso total de Administrador.
5. **Dependência de arquivos locais para identidade visual:** Alterar logotipo ou imagem de fundo exige copiar arquivos manualmente para a pasta local do Totem e digitar o nome do arquivo nas configurações.
6. **Risco de conectividade em pavilhões de feiras:** Uma migração ingênua para um sistema 100% dependente de internet paralisaria o Totem sempre que o Wi-Fi ou 4G do pavilhão oscilasse.

## Solution

Construir uma nova versão web da plataforma de Quiz Interativo em arquitetura **Offline-First com Sincronização em Tempo Real**, mantendo integralmente a experiência de jogo consagrada nos totens de feira e adicionando retaguarda em nuvem, gestão Multi-Evento, suporte a múltiplos Totens pareados e operação remota em tempo real.

- **Totem Resiliente (Offline-First PWA):** Cada Totem é pareado a um Evento ativo por código ou link autorizado pelo Administrador. Ele mantém localmente em `IndexedDB` o subconjunto do Banco de Questões, as configurações do Evento, o tema visual (incluindo imagens de logotipo e fundo em cache), a lista de Travas de Brinde, os Bloqueios por Desistência e a fila de Partidas realizadas. Quando há internet, sincroniza instantaneamente com a nuvem e reporta telemetria ao vivo (status online/offline, último ping, estado ocioso ou em Partida); quando a internet cai, continua operando normalmente sem interromper a fila do estande e sincroniza automaticamente assim que a conexão retorna.
- **Gestão Multi-Evento e Banco de Questões Central:** O Administrador gerencia múltiplos Eventos independentes (cada um com período de início e fim, regras de pontuação e tempo, identidade visual, estoque de Brindes e Ranking próprios), podendo clonar configurações de um Evento anterior. As perguntas ficam em um Banco de Questões central e reutilizável (com dificuldade Fácil, Moderado ou Difícil e tags/categorias), permitindo selecionar quais questões compõem cada Evento.
- **Controle de Brindes Adaptável à Dinâmica do Estande:** Cada Evento pode operar em modo de **Entrega Imediata** (ao atingir a pontuação mínima, o Brinde já é registrado automaticamente como `Entregue`, ideal para estandes onde o Participante retira o prêmio na hora) ou em modo de **Confirmação Manual** (o Brinde nasce como `Aguardando Retirada` até que um Operador ou Administrador dê baixa pelo celular/painel), além de contar com controle opcional de estoque de Brindes e resolução automática de Conflitos de Premiação Offline entre múltiplos Totens.
- **Dois Perfis Autenticados (Administrador e Operador):** O Administrador possui acesso completo a todas as áreas e ao monitoramento/controle remoto dos Totens, enquanto o Operador conta com uma interface móvel enxuta para acompanhar o Ranking e os Participantes ao vivo, confirmar entregas de Brinde, despremiar ou destravar telefones na pista.

## User Stories

### Participante no Totem

1. Como um Participante, quero visualizar uma tela de descanso convidativa com chamada pulsante para toque quando o Totem estiver ocioso, para que eu perceba imediatamente que o terminal está disponível para interação.
2. Como um Participante, quero ver mensagens claras na tela de descanso e na tela inicial caso o Evento ainda não tenha começado ou já tenha sido encerrado (quando esse aviso estiver ativo no Evento), para que eu saiba o horário oficial de funcionamento do quiz.
3. Como um Participante, quero aumentar ou diminuir o tamanho da fonte (`A-` e `A+`) em qualquer tela ativa do Totem, para que eu possa ler os textos com conforto visual.
4. Como um Participante, quero preencher meu nome (convertido automaticamente para letras maiúsculas sem caracteres inválidos) e meu telefone com máscara `(XX) XXXXX-XXXX` ou `(XX) XXXX-XXXX`, para que eu seja identificado de forma única no Evento.
5. Como um Participante em um Totem touch sem teclado físico, quero utilizar um teclado virtual integrado na tela (layout QWERTY com `Ç` para nome e teclado numérico para telefone), para que eu possa digitar meus dados rapidamente.
6. Como um Participante, quero poder redimensionar a altura do teclado virtual arrastando sua alça superior (entre 20vh e 60vh, com ajuste proporcional da fonte das teclas), para que o teclado se adapte à minha estatura e ergonomia no Totem.
7. Como um Participante que já conquistou um Brinde anteriormente no mesmo Evento (em qualquer Totem), quero ver um modal amigável informando a data e a hora da minha conquista anterior quando a Trava de Brinde estiver ativa, para que eu entenda por que a vez agora é de outros visitantes.
8. Como um Participante que desistiu recentemente de uma Partida em andamento, quero ser informado de quantos minutos restam no meu Bloqueio por Desistência ao tentar iniciar novamente com o mesmo telefone, para que eu saiba quando poderei jogar outra vez.
9. Como um Participante em uma Partida, quero responder a um conjunto de questões sorteadas aleatoriamente conforme a distribuição percentual de dificuldade configurada no Evento (`Fácil`, `Moderado` e `Difícil`), com a ordem das perguntas e das quatro alternativas embaralhadas a cada Partida, para que cada experiência seja justa e única.
10. Como um Participante em uma Partida, quero visualizar o nível de dificuldade da questão atual, o contador de progresso (ex.: `3/10`), a barra de progresso da Partida e o tempo total decorrido, para que eu acompanhe meu avanço no quiz.
11. Como um Participante em uma Partida, quero ver uma barra regressiva suave do tempo da questão atual (mudando de verde para amarelo aos 10s restantes e vermelho aos 5s restantes) acompanhada de alertas visuais opcionais (pulsação da borda e flash nos últimos 5s), para que eu gerencie meu tempo de resposta sob pressão.
12. Como um Participante em uma Partida, quero receber feedback visual imediato ao selecionar uma alternativa (ou ao esgotar o tempo da questão), destacando opcionalmente qual era a alternativa correta quando eu errar ou o tempo acabar, para que eu aprenda o conteúdo durante a Partida.
13. Como um Participante em uma Partida, quero poder abandonar a Partida clicando no botão de desistência mediante confirmação, para que eu possa liberar o Totem caso precise sair antes do fim.
14. Como um Participante ao concluir a Partida, quero ver minha pontuação final de acertos, meu tempo total, minha colocação atual no Ranking do Evento e se conquistei um Brinde, para que eu saiba imediatamente meu resultado.
15. Como um Participante que alcançou uma das 3 primeiras colocações gerais do Ranking do Evento ao finalizar a Partida, quero receber um modal especial de celebração (`TOP 1`, `TOP 2` ou `TOP 3`), para que meu desempenho de destaque seja reconhecido no estande.
16. Como um Participante que acertou todas as questões da Partida, quero visualizar uma mensagem especial de gabarito perfeito na tela de resultado, para que minha pontuação máxima seja celebrada.
17. Como um Participante que errou uma ou mais questões na Partida, quero abrir o modal *"Onde Eu Errei?"* na tela de resultado listando cada pergunta errada, a alternativa que escolhi e a alternativa correta, para que eu possa revisar meus erros.
18. Como um Participante, quero consultar o Ranking Geral do Evento (tanto a partir da tela inicial quanto da tela de resultado) ordenado por maior número de acertos e menor tempo total, para que eu veja os melhores desempenhos do Evento.
19. Como um Participante, quero que o Totem retorne automaticamente à tela de descanso após o tempo configurado de inatividade (com efeito de esmaecimento/fade-out nos segundos finais antes do timeout), para que uma tela abandonada volte ao estado inicial para o próximo visitante da fila.
20. Como um Participante jogando no Totem quando o Wi-Fi da feira cair, quero iniciar, jogar e concluir minha Partida sem qualquer mensagem de erro técnico ou lentidão, para que a instabilidade de rede do pavilhão não prejudique minha experiência.

### Operador de Estande (Acesso Móvel / Pista)

21. Como um Operador, quero fazer login com meu e-mail e senha em uma interface otimizada para celular, para que eu possa apoiar a operação do estande sem precisar tocar na tela do Totem.
22. Como um Operador, quero visualizar em tempo real a lista de Participantes e Ganhadores de Brinde do Evento ativo, buscando rapidamente por nome ou telefone, para que eu valide quem acabou de jogar no Totem.
23. Como um Operador em um Evento configurado com confirmação manual de entrega de Brinde, quero filtrar os Participantes com status `Aguardando Retirada` e marcar o Brinde como `Entregue` com um toque, para que o controle de entrega no balcão seja rápido e sem fila.
24. Como um Operador, quero visualizar o saldo atual do estoque de Brindes do Evento (quando o controle de estoque estiver habilitado), para que eu saiba quantos prêmios físicos ainda restam no estande.
25. Como um Operador, quero ser alertado visualmente caso ocorra um Conflito de Premiação Offline (mesmo telefone premiado em dois Totens desconectados antes da sincronização), para que eu saiba que aquele telefone tem direito a apenas um Brinde válido no Evento.
26. Como um Operador, quero poder *Despremiar* um telefone ou *Destravar* um telefone com Bloqueio por Desistência diretamente pelo celular, para que eu resolva rapidamente casos de visitantes que desistiram por engano ou testes feitos na pista.
27. Como um Operador, quero visualizar o Ranking ao vivo do Evento no meu celular, para que eu possa informar os líderes da competição aos visitantes no estande.

### Administrador (Gestão Remota e Retaguarda)

28. Como um Administrador, quero autenticar-me com e-mail e senha no painel administrativo online de qualquer computador ou celular, para que eu gerencie toda a plataforma remotamente.
29. Como um Administrador, quero criar, editar, ativar e encerrar múltiplos Eventos (definindo nome, data/hora de início e fim, ativação de mensagens fora do período e opção de clonar configurações e tema de um Evento anterior), para que cada feira ou congresso tenha seus dados e histórico isolados.
30. Como um Administrador, quero autorizar o Pareamento de novos Totens por meio de um código curto ou link de ativação e associar cada Totem a um Evento específico, para que nenhum login administrativo precise ser digitado na tela pública do Totem.
31. Como um Administrador, quero monitorar ao vivo todos os Totens pareados (visualizando se estão online ou offline, horário do último ping/heartbeat, se estão na tela de descanso, tela inicial ou com Partida em andamento, e quantos registros aguardam na fila local de sincronização), para que eu acompanhe a saúde da operação à distância.
32. Como um Administrador, quero enviar comandos remotos em tempo real para um Totem específico ou todos os Totens de um Evento (trocar o Evento vinculado, forçar sincronização imediata ou reiniciar para a tela inicial/descanso), para que eu opere os terminais sem ir até eles.
33. Como um Administrador ou técnico no local da feira, quero acessar um modal discreto de diagnóstico local no próprio Totem (protegido por PIN rápido) exibindo o status de rede, código de Pareamento, quantidade de itens pendentes na fila local e botão para forçar sincronização, para que eu possa diagnosticar o aparelho presencialmente se necessário.
34. Como um Administrador, quero configurar para cada Evento os parâmetros de jogo: número de questões por Partida, tempo por questão (5s a 120s), tempo de inatividade para descanso (15s a 600s), tempo de aviso prévio de fade-out, percentuais de dificuldade (`Fácil` + `Moderado` + `Difícil` = 100%), pontuação mínima para Brinde, exibição da resposta correta ao errar, quantidade de posições exibidas no Ranking, ativação da Trava de Brinde por telefone, minutos de Bloqueio por Desistência, ativação/altura padrão do teclado virtual e alertas visuais de tempo (pulsação de borda e flash).
35. Como um Administrador, quero configurar em cada Evento se a concessão de Brinde exige confirmação manual da equipe (`Aguardando Retirada` -> `Entregue`) ou se opera em modo dinâmico de baixa automática imediata (`Entregue` assim que o Participante atinge a pontuação mínima), além de definir opcionalmente a quantidade inicial do estoque de Brindes do Evento.
36. Como um Administrador, quero personalizar a identidade visual de cada Evento escolhendo temas pré-definidos (ex.: *Padrão CAESB*, *Claro Moderno*, *Escuro Elegante*) ou customizando todos os textos da interface, paleta de cores, tamanhos e família de fonte, com pré-visualização ao vivo das telas inicial, de quiz e de resultado.
37. Como um Administrador, quero fazer upload direto de imagens de logotipo e de plano de fundo (com controle de opacidade) pelo painel administrativo para armazenamento em nuvem, garantindo que os Totens baixem e mantenham essas imagens em cache local para exibição mesmo offline.
38. Como um Administrador, quero gerenciar o Banco de Questões central (criar, editar, habilitar/desabilitar, excluir individualmente ou em lote, buscar por texto/ID, filtrar por dificuldade e status, ordenar, pré-visualizar como aparece no quiz e vincular questões ou tags aos Eventos), para que eu reutilize e evolua o acervo de perguntas ao longo de várias feiras.
39. Como um Administrador, quero importar e exportar questões em formatos JSON e CSV (com opção de mesclar/adicionar às existentes ou substituir), para que eu possa preparar ou revisar grandes lotes de perguntas em planilhas ou arquivos externos.
40. Como um Administrador, quero consultar o relatório completo de Participantes e Partidas filtrado por Evento, busca textual (nome/telefone), período específico, status de Brinde (ganhadores, não ganhadores, status de retirada), status de Bloqueio por Desistência e pontuação exata, podendo inspecionar todas as Respostas dadas pelo Participante em cada Partida e quantas vezes aquele telefone jogou.
41. Como um Administrador, quero executar ações individuais e em lote sobre Participantes selecionados no relatório (*Confirmar Entrega de Brinde*, *Despremiar*, *Destravar* Bloqueio por Desistência e *Excluir* registro), além de exportar os relatórios filtrados em CSV e JSON.
42. Como um Administrador, quero visualizar a tela de Estatísticas de Questões por Evento ou globalmente (exibindo total de respostas, acertos, erros, percentual de acurácia por questão e botão rápido para habilitar/desabilitar uma questão excessivamente fácil ou difícil durante a feira).
43. Como um Administrador, quero acompanhar o Dashboard Analítico com filtros de período (hoje, últimos 3 dias, 7 dias, 30 dias, intervalo personalizado ou todo o Evento), 4 KPIs principais (Total de Participações, Média de Pontuação, Tempo Médio e Taxa de Sucesso/Premiação), 3 gráficos interativos (Participações ao Longo do Tempo, Distribuição de Pontuações e Engajamento por Hora do Dia) e ranking analítico das questões mais difíceis, mais fáceis, mais respondidas e menos respondidas.
44. Como um Administrador, quero exportar um Backup completo em JSON (de um Evento específico ou de todo o sistema) e importar backups — incluindo a importação direta dos arquivos JSON legados da versão `quiz-offline` com normalização automática de IDs de questões e tentativas —, para que eu possa migrar os dados históricos das feiras anteriores (como a FITABES 2025) e manter cópias de segurança externas.
45. Como um Administrador, quero gerenciar as contas de usuários da equipe (criando acessos de Administrador ou Operador) e contar com um Modo Desenvolvedor/Simulação para testar rapidamente telas, modais e estados de Evento sem poluir as métricas reais da feira.

## Implementation Decisions

### 1. Arquitetura de Módulos Profundos e Costuras (Seams)

O sistema será estruturado em torno de dois módulos profundos de domínio que concentram toda a lógica de negócio por trás de interfaces pequenas, desacopladas da camada visual (React) e da infraestrutura de rede/banco:

- **`TotemSessionEngine` (Motor de Sessão e Sincronização do Totem):**
  - Encapsula todo o estado e as regras de execução do Totem: verificação de Pareamento, cálculo do estado temporal do Evento (`before`, `during`, `after`, `no_event`), validação de nome e telefone do Participante, verificação de Trava de Brinde e Bloqueio por Desistência (consultando o cache local sincronizado), sorteio proporcional de questões por dificuldade (`facil`, `moderado`, `dificil` com fallback caso uma faixa não tenha questões suficientes), embaralhamento de questões e alternativas, controle de cronômetro regressivo por questão e tempo total da Partida, registro de cada Resposta, cálculo de pontuação, elegibilidade ao Brinde (definindo status `Entregue` ou `Aguardando Retirada` conforme configuração do Evento), cálculo de Ranking e Top 3, gravação imediata em `IndexedDB` e execução do loop de sincronização e telemetria com a nuvem.
  - **Interface na Costura:** Recebe por injeção de dependência as abstrações `LocalStore` (persistência local no Totem), `CloudGateway` (comunicação remota e assinatura de canais em tempo real), `Clock` (fonte de tempo) e `RandomSource` (embaralhamento determinístico em testes).
- **`EventAdminController` (Controlador Administrativo e Operacional):**
  - Encapsula todas as operações de Administrador e Operador: CRUD e clonagem de Eventos, gestão do Banco de Questões central e vínculo com Eventos, geração/validação de códigos de Pareamento, despacho de comandos remotos aos Totens, confirmação de entrega de Brinde e controle de estoque, ações individuais e em lote (*Despremiar*, *Destravar*, *Excluir*), agregação de KPIs e séries para os gráficos analíticos e estatísticas de questões, e importação/exportação de CSV/JSON (incluindo o migrador de backups legados da versão `quiz-offline` com normalização de IDs).
  - **Interface na Costura:** Opera sobre a mesma abstração `CloudGateway`, permitindo que testes automatizados conectem múltiplos `TotemSessionEngine` e um `EventAdminController` a um único `InMemoryCloudGateway` compartilhado.

### 2. Modelo de Dados Relacional em Nuvem (Supabase Postgres)

O esquema do banco de dados em nuvem seguirá as decisões dos ADRs 0001 a 0005:

- **`profiles`**: Vinculada ao `auth.users`, armazena `id`, `name`, `email`, `role` (`admin` | `operator`) e `created_at`. Políticas de Row Level Security (RLS) garantem que `admin` tem acesso total e `operator` tem permissão restrita às leituras operacionais e mutações de status de Brinde e Bloqueio por Desistência.
- **`questions` (Banco de Questões Central)**: Armazena `id` (numérico sequencial/identidade preservando compatibilidade com backups), `text`, `options` (array JSON de 4 strings), `correct_index` (`0` a `3`), `difficulty` (`facil` | `moderado` | `dificil`), `tags` (array de strings para categorização), `is_disabled` (boolean), `created_at`, `updated_at`.
- **`events` (Eventos)**: Armazena `id` (UUID), `name`, `slug`, `start_time`, `end_time`, `enable_out_of_period_message` (boolean), `is_active` (boolean), `settings` (JSONB contendo todas as configurações de jogo: `numberOfQuestions`, `timePerQuestion`, `idleTimeoutSeconds`, `fadeOutLeadTimeSeconds`, `difficultyPercentages`, `minScoreForPrize`, `showCorrectAnswerOnWrong`, `rankingDisplayCount`, `enablePrizeLock`, `giveUpLockoutMinutes`, `virtualKeyboardHeight`, `enableVirtualKeyboard`, `enableTimeAlertBorderPulse`, `enableTimeAlertFlash`, `requireManualPrizeConfirmation`, `prizeStockLimit`), `prize_stock_remaining` (integer nullable), `customizations` (JSONB contendo `texts`, `colors`, `fontSizes`, `visualIdentity` com URLs/paths das imagens no Supabase Storage), `config_version` (integer incrementado a cada alteração para invalidação rápida de cache nos Totens).
- **`event_questions`**: Relação N:N opcional entre `events` e `questions` (com flag no Evento indicando se utiliza todas as questões ativas do Banco de Questões ou uma seleção/filtro por tags específico).
- **`totems` (Totens e Pareamento)**: Armazena `id` (UUID), `name`, `pairing_code` (código curto único para ativação), `device_token` (token gerado após o Pareamento para autenticar chamadas do Totem via RPC/cabeçalho), `event_id` (FK para `events`), `pin_code` (PIN numérico rápido para o modal de diagnóstico local), `last_seen_at`, `online_status`, `current_screen` (`idle`, `initial`, `quiz`, `result`, `ranking`), `pending_sync_count` (integer).
- **`matches` (Partidas)**: Armazena `id` (UUID gerado no Totem para idempotência na sincronização offline), `event_id` (FK), `totem_id` (FK nullable para backups importados), `participant_name`, `participant_phone` (normalizado), `score` (integer), `total_questions` (integer), `time_seconds` (integer), `answers` (JSONB com a lista de Respostas detalhadas: `questionId`, `questionText`, `options`, `selectedOptionText`, `correctOptionIndex`, `correctOptionText`, `isCorrect`), `played_at` (timestamp original da Partida no Totem), `synced_at` (timestamp de recebimento na nuvem).
- **`prize_claims` (Brindes e Trava de Brinde por Evento)**: Armazena `id` (UUID), `event_id` (FK), `match_id` (FK para a Partida vencedora), `totem_id` (FK), `participant_name`, `participant_phone`, `status` (`awaiting_pickup` | `delivered` | `revoked` | `offline_duplicate_conflict`), `delivered_at`, `delivered_by` (FK nullable para `profiles`). Uma constraint/índice parcial garante apenas 1 Brinde ativo (`awaiting_pickup` ou `delivered`) por `(event_id, participant_phone)`. Se uma sincronização tardia de outro Totem trouxer uma segunda Partida vencedora para o mesmo `(event_id, participant_phone)`, a Partida é salva normalmente em `matches`, mas o registro excedente em `prize_claims` recebe o status `offline_duplicate_conflict`, preservando o histórico e disparando o alerta de **Conflito de Premiação Offline** no painel.
- **`give_up_lockouts` (Bloqueios por Desistência)**: Armazena `id` (UUID), `event_id` (FK), `totem_id` (FK), `participant_phone`, `locked_at`, `expires_at`, `unlocked_by` (FK nullable).

### 3. Persistência Local (`IndexedDB` / Dexie) e Protocolo de Sincronização do Totem

- **Tabelas locais no Dexie (`TotemLocalDB`):**
  - `totemConfig`: dados do Pareamento (`totemId`, `deviceToken`, `eventId`, `pinCode`), snapshot completo do Evento atual (`settings`, `customizations`, `configVersion`, `startTime`, `endTime`) e blobs/DataURLs das imagens de logotipo e plano de fundo cacheadas.
  - `localQuestions`: espelho local das questões habilitadas para o Evento atual.
  - `localMatches`: todas as Partidas do Evento (tanto as criadas localmente quanto o resumo recebido da nuvem para compor o Ranking unificado entre múltiplos Totens).
  - `localPrizeWinners`: telefones premiados no Evento (para checagem instantânea e offline da Trava de Brinde).
  - `localLockouts`: telefones com Bloqueio por Desistência ativo no Evento.
  - `syncQueue`: fila persistente de mutações criadas no Totem (`match_completed`, `give_up_lockout_added`) aguardando confirmação da nuvem, com `retryCount` e `idempotencyKey` (UUID).
- **Canais em Tempo Real (Supabase Realtime) e Comandos Remotos:**
  - Canal de **Presença e Telemetria (`totem:presence`)**: cada Totem publica seu estado (`currentScreen`, `pendingSyncCount`, `configVersion`, `lastPing`) e escuta comandos direcionados ao seu `totemId` ou ao seu `eventId`:
    - `SWITCH_EVENT`: atualiza o `eventId` vinculado, baixa o novo pacote de configurações/questões/imagens e reinicia na tela inicial/descanso.
    - `FORCE_SYNC`: dispara imediatamente o envio da `syncQueue` e a atualização de `totemConfig` / `localQuestions` / `localPrizeWinners` / `localLockouts`.
    - `RELOAD_SCREEN`: retorna o Totem imediatamente para a tela inicial ou de descanso.
    - `HARD_REFRESH`: recarrega a página inteira do Totem (equivale a Ctrl+Shift+R), removendo Service Worker e caches do app shell para baixar a versão publicada mais recente; a fila local (IndexedDB) é preservada e enviada antes do reload.
    - `CONFIG_UPDATED`: notifica os Totens do Evento de que configurações, questões, tema ou listas de bloqueio/premiação mudaram (aplicando a atualização imediatamente se o Totem estiver em `idle-screen` ou `initial-screen`, ou aguardando o término da Partida em andamento para não interromper um Participante que está jogando).

### 4. Preservação Integral dos Comportamentos de UX do Totem e Admin

- **Teclado Virtual e Inputs:** Mantém o teclado QWERTY (`Q-P`, `A-Ç`, `Z-M` + `APAGAR`, `ESPAÇO`, `OK`) para o campo Nome (forçando maiúsculas e apenas letras/acentos/espaços) e teclado numérico 3x4 para Telefone (com máscara automática para fixo/celular com DDD), incluindo a alça superior de redimensionamento (`20vh` a `60vh`) com cálculo automático de fonte das teclas (`14px` a `32px`).
- **Acessibilidade e Kiosk Mode:** Botões `A-` e `A+` percorrendo a escala de fontes (`10px` a `30px`, padrão `18px`), bloqueio de menu de contexto (`contextmenu`) e botão discreto `⚙️` que no Totem abre apenas o modal de diagnóstico local mediante PIN.
- **Retrocompatibilidade de Backups:** O módulo de Backup será capaz de importar diretamente os arquivos `.json` gerados pela versão `quiz-offline` (como os backups existentes da FITABES 2025), convertendo-os para um Evento escolhido pelo Administrador no banco de dados online e normalizando os IDs de questões e Respostas.

## Testing Decisions

### Filosofia de Testes

Os testes devem verificar exclusivamente o **comportamento externo observável** através das interfaces públicas das costuras (seams), nunca detalhes internos de implementação. Um bom teste configura o estado inicial através da interface do módulo, executa uma ação de domínio e verifica o resultado retornado ou o estado observável nos Adapters injetados.

### Costuras e Módulos Testados

1. **Costura 1 — `TotemSessionEngine`:**
   - **Comportamentos testados:**
     - Pareamento inicial do Totem e download do pacote do Evento (questões, configurações, tema).
     - Bloqueio de início de Partida quando o Evento está fora da janela de horário (`before` ou `after`) com `enableOutOfPeriodMessage` ativo, e permissão normal quando desativado.
     - Validação de nome e formato de telefone `(XX) XXXXX-XXXX` / `(XX) XXXX-XXXX`.
     - Aplicação da Trava de Brinde por telefone no Evento (incluindo retorno do timestamp da conquista anterior) e aplicação/expiração do Bloqueio por Desistência em minutos.
     - Sorteio de questões respeitando exatamente a proporção configurada (`facil`, `moderado`, `dificil`) e completando com questões remanescentes caso falte estoque em uma dificuldade específica.
     - Contagem de tempo por questão, tratamento de resposta correta, resposta incorreta e tempo esgotado (`Tempo esgotado`), revelação condicional de gabarito (`showCorrectAnswerOnWrong`) e lista de revisão *"Onde Eu Errei?"*.
     - Concessão de Brinde com status `Entregue` (quando a confirmação manual está desabilitada no Evento) vs. `Aguardando Retirada` (quando habilitada), decremento de estoque de Brindes e identificação de Top 3 no Ranking.
     - Operação 100% offline: realização de múltiplas Partidas com o `CloudGateway` simulando desconexão, persistência na `syncQueue` local e sincronização idempotente quando a conexão é restaurada.
     - Recebimento de comandos remotos (`SWITCH_EVENT`, `FORCE_SYNC`, `RELOAD_SCREEN`, `HARD_REFRESH`, `CONFIG_UPDATED`) sem interromper uma Partida em andamento até que ela termine.
2. **Costura 2 — `EventAdminController` (e integração Multi-Totem via `InMemoryCloudGateway`):**
   - **Comportamentos testados:**
     - Criação, edição e clonagem de Eventos e isolamento de Ranking, Participantes e Trava de Brinde entre Eventos distintos.
     - Cenário de **Conflito de Premiação Offline**: dois `TotemSessionEngine` desconectados registram vitória para o mesmo telefone no mesmo Evento; ao reconectarem ambos ao `InMemoryCloudGateway`, o `EventAdminController` preserva ambas as Partidas nas métricas, mantém apenas 1 Brinde válido para o telefone e sinaliza o conflito para a equipe.
     - Operações de Operador e Administrador: confirmação de entrega de Brinde (`Aguardando Retirada` -> `Entregue`), *Despremiar* (liberando o telefone para ganhar novamente no Evento), *Destravar* Bloqueio por Desistência e exclusão individual/em lote.
     - Cálculo exato dos 4 KPIs do Dashboard Analítico, distribuição de pontuações, engajamento por hora do dia e estatísticas de acurácia por questão.
     - Importação de arquivos de backup JSON legados do `quiz-offline` com normalização e remapeamento consistente de IDs entre questões e Respostas dos Participantes.

### Prior Art

O projeto original `quiz-offline` possuía cenários manuais de simulação em `handleSimulatedScenario` e `setupEventTestButtons` (`modal_already_won`, `modal_top3`, `modal_incorrect_answers`, `result_top1_winner`, `result_non_top3_winner`, `result_loser`, e simulações de evento `before`, `during`, `after`) além da função pura `normalizeAndMapQuizDataIds`. Todos esses cenários passam a ser cobertos por testes automatizados rápidos (Vitest) rodando contra as duas costuras (`TotemSessionEngine` e `EventAdminController`).

## Out of Scope

- Aplicativo nativo compilado para iOS/Android nas lojas (App Store / Google Play) — a solução rodará na web e como PWA instalável no navegador do Totem e do celular do Operador/Administrador.
- Autenticação ou login para o Participante final (visitante da feira) — a identificação no Totem continua rápida apenas por Nome e Telefone.
- Integração com impressoras térmicas físicas de cupom/ticket ou hardware externo via porta serial/USB nesta fase inicial.
- Sistema de pagamento, cobrança de ingressos ou e-commerce.
- Suporte a arquitetura multi-tenant comercial (SaaS aberto para empresas terceiras se cadastrarem sozinhas com faturamento).

## Further Notes

- O código legado funcional permanece preservado na pasta `quiz-offline/` do repositório como referência visual e comportamental para a migração de estilos, animações de alerta de tempo, teclado virtual e estrutura de backups.
- A importação dos backups JSON existentes em `quiz-offline/backup/` permitirá popular imediatamente o banco online no Supabase com o acervo real de 50 questões da CAESB e o histórico real de participações para validação do Dashboard Analítico e dos Relatórios.
