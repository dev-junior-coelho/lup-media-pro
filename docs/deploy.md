# Configuração e deploy

## Estado confirmado em 13/10/2026

Projeto criado: **lup-media-pro**, número **143982331497**. Web app: **1:143982331497:web:a9c205fa8cbac3c7fa84f8**. Firestore provisionado na região multirregional **nam5** (padrão usado pela CLI); regras e índices publicados. Firebase Authentication e-mail/senha habilitado via deploy confirmado. A latência entre Brasil e nam5 deve ser medida antes da comercialização. Nenhum outro projeto foi modificado.

App Hosting retornou explicitamente: projeto deve estar no plano Blaze para habilitar firebaseapphosting.googleapis.com. Ativar em https://console.firebase.google.com/project/lup-media-pro/usage/details. A criação de projeto NÃO confirma que um serviço HTTP esteja online.

**Ainda não existe URL pública de backend verificada. Não cadastrar domínio presumido como callback.** A rota implementada é `/api/auth/instagram/callback`; a URL completa será a origem HTTPS retornada pelo deploy mais essa rota.

## Desenvolvimento

Use Node 22 ou superior (Admin SDK exige Node 22). `npm ci` e `npm ci --prefix functions`. Sem configuração, a interface informa que Firebase precisa ser conectado. Copie `.env.example` para `.env.local` e substitua apenas com dados do projeto independente. Use Application Default Credentials em desenvolvimento real; não versione arquivos de serviço.

Emuladores: `npm run emulators` (projeto demo-lup-media-pro, Java 21). Para o frontend/backend, definir NEXT_PUBLIC_USE_EMULATORS=true; IDs/configuração do projeto demo; FIRESTORE_EMULATOR_HOST=127.0.0.1:8080, FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099, FIREBASE_STORAGE_EMULATOR_HOST=127.0.0.1:9199. `npm run test:e2e:emulators` configura tudo automaticamente e exercita a aplicação. Não use tokens reais nos emuladores.

## Produção após Blaze

1. Habilitar Firebase Storage e criar bucket na região escolhida (recomendação southamerica-east1); verificar nome real, não presumir.
2. Authentication: habilitar e-mail/senha; configurar domínio autorizado e políticas. `firebase deploy --only auth --project lup-media-pro` usa o app Web existente.
3. Criar META_APP_SECRET no Secret Manager e inserir o segredo do aplicativo já existente. Criar TOKEN_ENCRYPTION_KEY com 32 bytes aleatórios codificados em base64, mantendo o valor somente no gerenciador de segredos.
4. Configurar `.env` não versionado de Functions com META_API_VERSION e FIREBASE_STORAGE_BUCKET reais. `firebase deploy --only firestore,storage,functions --project lup-media-pro`.
5. Conceder às contas de execução acesso restrito aos segredos/bucket e signBlob. Não distribuir tokens a editores.
6. Criar backend App Hosting para Next.js, conectar repositório privado e branch validada. Node 22 e build `npm run build`. Preencher valores públicos do Firebase com disponibilidade BUILD/RUNTIME; segredo somente RUNTIME. META_APP_ID, META_API_VERSION, FIREBASE_STORAGE_BUCKET e GOOGLE_CLOUD_PROJECT são valores do servidor. Registrar APP_ORIGIN a partir da URL HTTPS verificada do backend. Conceder acesso aos secrets ao backend.
7. Cadastrar essa origem no Firebase Auth e a URL completa `/api/auth/instagram/callback` no aplicativo Meta.
8. Validar login, upload privado, OAuth e reconexão. Preparar uma imagem JPEG e rascunho de teste; solicitar confirmação explícita antes de enviar à conta real.

## Permissões Meta

Somente `instagram_business_basic` e `instagram_business_content_publish`. A conta profissional deve continuar autorizada como testadora para o modo desenvolvimento. Comercialização requer validação das condições de App Review/Advanced Access e políticas da Meta, além de páginas de privacidade e exclusão de dados reais. Insights, mensagens e Marketing API não são habilitados implicitamente.

## CI/CD

A workflow valida TypeScript, lint, unitários, Functions, regras e E2E. Deploy deve usar Workload Identity Federation, sem JSON de conta de serviço no GitHub. App Hosting deve apontar a uma branch que só recebe alterações depois dessa workflow. Não há deploy automático configurado sem infraestrutura/faturamento/identidade do backend.

## Fontes consultadas

- Next.js: https://nextjs.org/blog/next-16 e https://nextjs.org/docs/app/guides/upgrading/version-16
- Firebase Scheduler Gen 2: https://firebase.google.com/docs/functions/schedule-functions
- Firebase Auth CLI: https://firebase.google.com/docs/auth/configure-providers-cli
- Meta coleção oficial: https://www.postman.com/meta/workspace/instagram/documentation/23987686-9386f468-7714-490f-9bfc-9442db5c8f00
- Meta publishing: https://developers.facebook.com/docs/instagram-platform/instagram-api-with-instagram-login/content-publishing (leitura bloqueada por erro/429 nesta execução; detalhes avançados de mídia e Stories precisam ser reconfirmados antes do teste real).

META_API_VERSION é configurável, com default conservador v24.0. Não alegamos validação real dos endpoints só pela implementação ou pelos mocks.
