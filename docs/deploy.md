# Configuração e deploy

## Estado confirmado em 13/10/2026

Projeto criado: **lup-media-pro**, número **143982331497**. Web app: **1:143982331497:web:a9c205fa8cbac3c7fa84f8**. Firestore provisionado na região multirregional **nam5** (padrão usado pela CLI); regras e índices publicados. Firebase Authentication e-mail/senha habilitado via deploy confirmado. A latência entre Brasil e nam5 deve ser medida antes da comercialização. Nenhum outro projeto foi modificado.

Plano Blaze confirmado. Storage independente `lup-media-pro.firebasestorage.app` (US-CENTRAL1), com acesso uniforme e prevenção de acesso público. Backend App Hosting `lup-media-pro` criado e publicado em us-central1. Functions Gen 2 publishScheduled e refreshInstagramTokens ativas em southamerica-east1, com jobs habilitados a cada minuto e diariamente às 03:00 UTC. Logs do scheduler confirmam resposta 200 e scanned=0, errors=0.

Aplicação: **https://lup-media-pro--lup-media-pro.us-central1.hosted.app** (HTTPS 200 verificado).

Callback exato: **https://lup-media-pro--lup-media-pro.us-central1.hosted.app/api/auth/instagram/callback** (rota alcançável; rejeita state inválido com HTTP 400).

Aplicativo Meta principal: **1053568541018948**. Instagram App ID informado pelo proprietário: **1115866234134688**, usado no OAuth e na troca do código. META_APP_SECRET versão 2 contém o Instagram App Secret correspondente, conforme confirmação do proprietário, e está vinculado no App Hosting. TOKEN_ENCRYPTION_KEY permanece na versão 1. O segredo foi inserido diretamente pelo proprietário no Secret Manager, sem passar pelo chat ou Git. OAuth real de @junior_coelho36 e uma publicação de teste explicitamente autorizada foram confirmados; ver docs/instagram-test/publication.md.

## Desenvolvimento

Use Node 22 ou superior (Admin SDK exige Node 22). `npm ci` e `npm ci --prefix functions`. Sem configuração, a interface informa que Firebase precisa ser conectado. Copie `.env.example` para `.env.local` e substitua apenas com dados do projeto independente. Use Application Default Credentials em desenvolvimento real; não versione arquivos de serviço.

Emuladores: `npm run emulators` (projeto demo-lup-media-pro, Java 21). Para o frontend/backend, definir NEXT_PUBLIC_USE_EMULATORS=true; IDs/configuração do projeto demo; FIRESTORE_EMULATOR_HOST=127.0.0.1:8080, FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099, FIREBASE_STORAGE_EMULATOR_HOST=127.0.0.1:9199. `npm run test:e2e:emulators` configura tudo automaticamente e exercita a aplicação. Não use tokens reais nos emuladores.

## Próxima validação com Instagram

1. Cadastrar o callback exato acima no aplicativo Meta existente, na configuração do Instagram Login. Se o painel distinguir Meta App ID de Instagram App ID, conferir que o ID configurado corresponde ao client ID do Instagram Login e que o secret pertence a ele.
2. Entrar/criar sua conta na aplicação e abrir Configurações → Conectar / reconectar Instagram. Autorizar somente os scopes mínimos.
3. Confirmar que @junior_coelho36 aparece conectada. A validação real do token, da identificação e das permissões depende dessa autorização externa.
4. A arte/legenda de teste estão em docs/instagram-test/. Não foi criado job real; enviar somente depois de confirmação explícita do proprietário.
5. LEGACY_MIGRATION_OWNER_UID já configurado com o UID do proprietário do workspace conectado. A ação em Backup e migração importa a lista original somente para esse usuário. Backups e ZIP próprios podem ser importados pelos demais usuários sem acesso à lista pessoal original.

Functions usa LUP_STORAGE_BUCKET porque FIREBASE_ é prefixo reservado para variáveis próprias de Functions; também há fallback seguro ao FIREBASE_CONFIG nativo do runtime. Contas de execução próprias e IAM restrito ao projeto/bucket/segredos. URLs para a Meta são assinadas por serviço com signBlob e validade de duas horas. Não rotacionar a chave AES sem recriptografar credenciais existentes.

## Permissões Meta

Somente `instagram_business_basic` e `instagram_business_content_publish`. A conta profissional deve continuar autorizada como testadora para o modo desenvolvimento. Comercialização requer validação das condições de App Review/Advanced Access e políticas da Meta, além de páginas de privacidade e exclusão de dados reais. Insights, mensagens e Marketing API não são habilitados implicitamente.

## CI/CD

CI valida TypeScript, lint, unitários, Functions, regras e E2E. Workload Identity Federation está provisionado, sem JSON/chave privada no GitHub. O provider restringe identidade ao repository_id 1418106090, owner_id 106762958 e refs/heads/main. FIREBASE_WIF_PROVIDER e FIREBASE_DEPLOY_SERVICE_ACCOUNT estão configurados nas variáveis do repositório. A workflow manual deploy.yml valida o checkout, publica regras/Functions e envia o código validado por deploy de fonte local ao App Hosting. Não exige vincular o backend ao GitHub pela console.

O backend usa firebase-app-hosting-compute; jobs usam lup-publishing-worker; CI usa lup-deployer. O agente Firebase Storage possui somente a permissão adicional de leitura Firestore necessária às regras entre serviços. O repositório gcf-artifacts tem política de limpeza de imagens após sete dias.

## Fontes consultadas

- Next.js: https://nextjs.org/blog/next-16 e https://nextjs.org/docs/app/guides/upgrading/version-16
- Firebase Scheduler Gen 2: https://firebase.google.com/docs/functions/schedule-functions
- Firebase Auth CLI: https://firebase.google.com/docs/auth/configure-providers-cli
- Meta coleção oficial: https://www.postman.com/meta/workspace/instagram/documentation/23987686-9386f468-7714-490f-9bfc-9442db5c8f00
- Meta publishing: https://developers.facebook.com/docs/instagram-platform/instagram-api-with-instagram-login/content-publishing (leitura bloqueada por erro/429 nesta execução; detalhes avançados de mídia e Stories precisam ser reconfirmados antes do teste real).

META_API_VERSION é configurável, com default conservador v24.0. Não alegamos validação real dos endpoints só pela implementação ou pelos mocks.
