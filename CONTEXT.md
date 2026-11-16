# Quiz Interativo de Eventos

Sistema de quiz gamificado operado em totens de autoatendimento durante feiras e congressos para engajamento do público e distribuição de brindes, com gestão e monitoramento remotos em tempo real.

## Language

### Operação de Feira e Dispositivos

**Evento**:
Uma edição específica de feira, congresso ou ação promocional com período de início e fim, configurações de jogo, identidade visual, estoque de brindes e ranking próprios.
_Avoid_: Feira, campanha, sessão, torneio

**Totem**:
Terminal físico de autoatendimento no estande, vinculado a um Evento ativo, onde os visitantes jogam o quiz e que reporta seu estado em tempo real.
_Avoid_: Kiosk, cliente, máquina, terminal, aparelho

**Pareamento**:
Vínculo autorizado entre um Totem físico e o painel administrativo por meio de código ou link de ativação, permitindo associá-lo a um Evento e receber comandos remotos.
_Avoid_: Login do totem, cadastro de máquina

### Jogo e Participação

**Participante**:
Visitante do Evento identificado por nome e telefone (chave única por Evento) que realiza uma ou mais Partidas no Totem.
_Avoid_: Usuário, jogador, cliente, lead

**Banco de Questões**:
Acervo central e reutilizável de perguntas com quatro alternativas e nível de dificuldade (Fácil, Moderado ou Difícil), das quais um subconjunto é selecionado para cada Evento.
_Avoid_: Lista de perguntas, prova, questionário

**Partida**:
Uma execução completa do quiz por um Participante em um Totem dentro de um Evento, gerando pontuação total, tempo gasto e posição no Ranking do Evento.
_Avoid_: Jogo, rodada, tentativa de quiz, sessão

**Resposta**:
A escolha de alternativa (ou esgotamento de tempo) registrada pelo Participante para uma única questão durante uma Partida.
_Avoid_: Tentativa, `playerAttempt`, palpite, lance

**Bloqueio por Desistência**:
Restrição temporária aplicada ao telefone de um Participante que abandona uma Partida em andamento, impedindo-o de iniciar outra no Evento pelo tempo configurado.
_Avoid_: Banimento, suspensão, castigo

### Premiação e Controle de Estande

**Brinde**:
Prêmio físico concedido ao Participante que atinge ou supera a pontuação mínima do Evento, assumindo o status `Entregue` automaticamente na hora (modo dinâmico) ou `Aguardando Retirada` até confirmação da equipe (quando a confirmação manual está habilitada no Evento).
_Avoid_: Prêmio, recompensa, gift, voucher

**Trava de Brinde**:
Regra do Evento que impede que o mesmo telefone conquiste mais de um Brinde no mesmo Evento, mesmo que o Participante jogue novamente ou em outro Totem.
_Avoid_: Limite de vitórias, bloqueio de jogador

**Conflito de Premiação Offline**:
Situação em que um mesmo telefone atinge pontuação de Brinde em dois Totens distintos enquanto ambos operavam sem internet; preserva ambas as Partidas no histórico, mantém apenas um Brinde válido para o telefone no Evento e gera alerta para a equipe.
_Avoid_: Erro de sincronização, fraude, duplicata

### Equipe do Estande

**Administrador**:
Responsável pela configuração geral do sistema, gestão de Eventos, Banco de Questões, personalização visual, pareamento/monitoramento de Totens e análise de relatórios e métricas.
_Avoid_: Superusuário, dono, master

**Operador**:
Membro da equipe no estande com acesso móvel restrito à operação ao vivo do Evento (consulta de Participantes e Ranking, confirmação de entrega de Brinde, despremiar e destravar telefones).
_Avoid_: Atendente, fiscal, monitor, usuário comum
