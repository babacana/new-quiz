# Operação Offline-First no Totem com Sincronização em Nuvem

O Totem operará em modo híbrido (Offline-First): armazenará localmente no navegador (via `IndexedDB`) o banco de questões, as configurações, as customizações visuais e a fila de Partidas realizadas, sincronizando em tempo real com o banco de dados em nuvem sempre que houver conectividade. Em feiras e congressos a internet do pavilhão é instável; depender de conexão contínua travaria a fila do estande, enquanto operar 100% offline impediria o acompanhamento e a configuração remota pelo administrador.
