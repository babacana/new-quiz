# Reescrita em React, TypeScript, Supabase e Dexie com Perfis Admin e Operador

A versão online será construída em React + TypeScript + Vite com Supabase (Postgres, Auth, Realtime para telemetria/comandos dos Totens e Storage para upload de logos/fundos com cache local) e Dexie (`IndexedDB`) em PWA, mantendo o projeto original em `quiz-offline/` como referência. O acesso autenticado terá dois perfis: Administrador (gestão completa) e Operador (visão móvel enxuta para atendimento de estande, entrega de brindes e destravamento de participantes).
