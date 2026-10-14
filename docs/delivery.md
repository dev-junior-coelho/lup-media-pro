# Estado da entrega

Implementação executável em Next.js e Firebase; não é declarada como SaaS finalizado em produção.

## Implementado

- Identidade visual e navegação do HTML em componentes React responsivos.
- Firebase Auth: cadastro, login, recuperação, logout e sessão persistente.
- Workspaces com papéis e autorização no backend; regras bloqueiam acesso entre tenants e leitura de tokens.
- Dashboard com contagem de posts persistidos, calendário mensal/semanal/lista, filtros, editor, duplicação, exclusão, agendamento, reagendamento e cancelamento.
- Upload privado ao Storage, JPEG validado no servidor, prévias e reutilização de mídia.
- Seguidores: importação ZIP JSON/HTML, comparação de relações, snapshots, marcas, protegidos, desfazer, modo rápido com Android intent e fallback, histórico, backup e restauração.
- Migração explícita da lista original de 1.976 perfis e formatos de backup anteriores. Agendamentos legados restaurados como rascunhos.
- Instagram Login: início OAuth, state/cookie/uso único, callback, troca de token, consulta de permissões, criptografia, reconexão e desconexão.
- Fluxos de contêiner para imagem, carrossel, Reel e Story Business, sujeitos a validação real da Meta.
- Functions Gen 2: scheduler a cada minuto, renovação diária de tokens, leases, revisões, retentativas e reconciliação conservadora. Nenhum envio real executado.
- CSV com dados internos reais; métricas sem autorização mostram Dado indisponível. IA e anúncios explicitamente não habilitados.
- CI e workflow manual de deploy com Workload Identity Federation configurados e executados com sucesso, sem chave de serviço no GitHub.

Repositório privado: https://github.com/dev-junior-coelho/lup-media-pro

## Infraestrutura real

Projeto Firebase independente lup-media-pro: Authentication e Firestore nam5 habilitados; Storage privado criado; App Hosting publicado; duas Functions Gen 2 e jobs habilitados. A execução vazia do scheduler na nuvem foi confirmada por logs 200/scanned=0/errors=0.

Aplicação: https://lup-media-pro--lup-media-pro.us-central1.hosted.app

Callback: https://lup-media-pro--lup-media-pro.us-central1.hosted.app/api/auth/instagram/callback

Instagram App ID 1115866234134688 configurado após o Instagram recusar o ID do aplicativo Meta principal 1053568541018948. Instagram App Secret versão 2 vinculado após confirmação do proprietário de que a nova versão veio da seção Instagram do painel. O proprietário completou o OAuth no aplicativo publicado: @junior_coelho36 conectado como BUSINESS, com instagram_business_basic e instagram_business_content_publish confirmados no registro persistido. Token válido até 12/12/2026; renovação diária habilitada. Nenhum conteúdo real foi enviado.

## Validação

Resultados: **25 testes unitários**, **3 testes de regras Firestore/Storage** e **4 testes Playwright (desktop/mobile)** aprovados. TypeScript e ESLint aprovados, build de Functions aprovado. Build de produção Next.js aprovado. Total: **32 testes aprovados**. Os testes E2E usam Auth, Firestore e Storage reais em emuladores, incluindo cadastro/login/recuperação, autorização entre usuários na API, criação/edição de rascunho, JPEG, agenda/reagenda/cancelamento, ZIP, migração, marcações preservadas e backup/restauração. Testes de Meta são simulados; sucesso dos testes não significa conexão real com @junior_coelho36.

Deploy completo pelo GitHub aprovado: https://github.com/dev-junior-coelho/lup-media-pro/actions/runs/38490545109. Verificação HTTPS em produção aprovada com conta temporária: cadastro, sessão persistente, bootstrap, rascunho persistido, upload e prévia privados, bloqueio da migração pessoal e início OAuth com App ID/callback corretos. A conta e seus registros foram removidos; nenhum login ou envio ao Instagram foi realizado. Script reproduzível: scripts/smoke-production.mjs. Captura: docs/images/production-dashboard.png.

Auditoria npm das dependências de produção: zero vulnerabilidades tanto na aplicação quanto em Functions. A cadeia de ferramentas de desenvolvimento ainda contém advisories transitivos (Firebase CLI/ESLint); não é correto afirmar que a auditoria de todas as dependências está limpa.

## Pendências externas

OAuth real concluído. A publicação real de teste ainda aguarda confirmação explícita do proprietário. LEGACY_MIGRATION_OWNER_UID ainda precisa do UID do proprietário para liberar a lista pessoal original, evitando sua exposição a outros usuários. A imagem de teste e a legenda estão preparadas em docs/instagram-test/; a publicação exige confirmação explícita.

## Limitações

Validação/transcodificação completa de vídeos no servidor, quotas e coleta de uploads órfãos, paginação além de 1.000 registros, UI de convites/equipes, insights autorizados, políticas públicas de comercialização e App Review ainda exigem trabalho. O scheduler usa resolução de um minuto e lote de até 50 posts. A lista inicial é baseada em exportação parcial e não identifica automaticamente unfollows recentes.

## Correções e validação do OAuth real

Normalização das respostas de troca direta/data, preservação das permissões devolvidas pela Meta, consultas de permissões e revogação pela identidade autenticada, consulta separada do tipo de conta e validação de token/validade. 36 testes unitários, TypeScript, ESLint, build Next.js e build de Functions aprovados após as correções. Conta conectada confirmada por leitura dos campos públicos de accounts no Firestore; nenhum segredo foi lido nessa verificação.
