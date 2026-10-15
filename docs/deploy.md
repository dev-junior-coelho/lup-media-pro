# Configuração e deploy

## Estado confirmado em 13/10/2026

Projeto criado: **lup-media-pro**, número **143982331497**. Web app: **1:143982331497:web:a9c205fa8cbac3c7fa84f8**. Firestore provisionado na região multirregional **nam5** (padrão usado pela CLI); regras e índices publicados. Firebase Authentication e-mail/senha habilitado via deploy confirmado. A latência entre Brasil e nam5 deve ser medida antes da comercialização. Nenhum outro projeto foi modificado.

Plano Blaze confirmado. Storage independente `lup-media-pro.firebasestorage.app` (US-CENTRAL1), com acesso uniforme e prevenção de acesso público. Backend App Hosting `lup-media-pro` criado e publicado em us-central1. Functions Gen 2 publishScheduled e refreshInstagramTokens ativas em southamerica-east1, com jobs habilitados a cada minuto e diariamente às 03:00 UTC. Logs do scheduler confirmam resposta 200 e scanned=0, errors=0.

Aplicação: **https://lup-media-pro.web.app**. O Firebase Hosting encaminha as requisições ao serviço Cloud Run gerenciado pelo App Hosting. O endereço anterior do App Hosting continua disponível.

Callback exato: **https://lup-media-pro--lup-media-pro.us-central1.hosted.app/api/auth/instagram/callback** (endereço preservado na Meta; encaminha ao domínio principal antes da validação).

Aplicativo Meta principal: **1053568541018948**. Instagram App ID informado pelo proprietário: **1115866234134688**, usado no OAuth e na troca do código. META_APP_SECRET versão 2 contém o Instagram App Secret correspondente, conforme confirmação do proprietário, e está vinculado no App Hosting. TOKEN_ENCRYPTION_KEY permanece na versão 1. O segredo foi inserido diretamente pelo proprietário no Secret Manager, sem passar pelo chat ou Git. OAuth real de @junior_coelho36 e uma publicação de teste explicitamente autorizada foram confirmados; ver docs/instagram-test/publication.md.

## Desenvolvimento

Use Node 22 ou superior (Admin SDK exige Node 22). `npm ci` e `npm ci --prefix functions`. Sem configuração, a interface informa que Firebase precisa ser conectado. Copie `.env.example` para `.env.local` e substitua apenas com dados do projeto independente. Use Application Default Credentials em desenvolvimento real; não versione arquivos de serviço.

Com credenciais locais de usuário Google, configure também `GOOGLE_CLOUD_QUOTA_PROJECT=lup-media-pro`. Sem esse projeto de quota, o Firestore pode funcionar enquanto o Firebase Authentication rejeita a consulta de usuário usada na verificação de revogação da sessão. Após configurar, reinicie o servidor local se as variáveis não forem recarregadas.

Ao usar `localhost` com `APP_ORIGIN` apontando para a aplicação online, o botão de conectar Instagram oferece **Abrir versão online** e **Já conectei, atualizar contas**. O usuário entra com o mesmo e-mail na versão online, conecta a conta nas configurações e volta para atualizar a lista local. Esse fluxo não copia segredos de produção para o computador nem inicia uma autorização cujo cookie ficaria em outro domínio. A aplicação online mantém a versão publicada; as alterações locais de planos dependem de publicação para aparecerem lá.

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

## Endereço curto do Firebase

O endereço principal é `https://lup-media-pro.web.app`, sem necessidade de registrar domínio. `firebase.json` encaminha o Hosting ao serviço `lup-media-pro` em `us-central1`. APIs autenticadas respondem com `Cache-Control: private, no-store`.

`APP_ORIGIN` usa o endereço curto. `META_REDIRECT_URI` preserva o callback HTTPS já cadastrado na Meta. O callback recebido no endereço anterior redireciona para o domínio principal antes de consumir o estado ou trocar o código, preservando a proteção pelo navegador. O cookie OAuth se chama `__session`, pois o Firebase Hosting remove outros cookies antes de encaminhar ao Cloud Run (https://firebase.google.com/docs/hosting/manage-cache#using_cookies). Não alterar o callback na Meta por causa dessa troca.

A ordem de publicação é: `firebase deploy --only firestore,storage,functions --project lup-media-pro`, depois `firebase deploy --only apphosting --project lup-media-pro`, e por último `firebase deploy --only hosting --project lup-media-pro`. As Functions e a aplicação devem usar a mesma versão para aplicar as regras dos planos.

O serviço Cloud Run `lup-media-pro` permite invocação pública (`roles/run.invoker` para `allUsers`), requisito da integração Firebase Hosting → Cloud Run. As APIs continuam exigindo sessão Firebase e autorização de workspace/administração. Essa permissão vale somente para o serviço web, não para Firestore, Storage ou Functions.

## Publicação de 14/10/2026

Aplicativo, Functions, regras, índices e Hosting publicados. App Hosting: `build-2026-10-15-002`, ativado com sucesso (data UTC de 15/10; 14/10 no horário da Bahia). Endereço principal: https://lup-media-pro.web.app.

Validação: 79 testes de código, 14 testes de navegador, 5 testes de regras, TypeScript, ESLint e compilações de Next.js/Functions. O teste online confirmou cadastro, login persistente, rascunhos, upload privado, início do OAuth, encaminhamento do callback com estado/cookie preservados, migração automática para Pro e atualização do cliente no gestor. As contas e os dados temporários foram removidos. Não houve autorização de uma nova conta real nem publicação no Instagram durante essa verificação.

## Ajuste de imagens — 14/10/2026

App Hosting `build-2026-10-15-003`, Functions e Hosting publicados. Preparação automática de JPEG/PNG/WebP e editor com prévia, bordas e recorte disponíveis em https://lup-media-pro.web.app. Validação: 83 testes de código, 16 testes de navegador e 5 testes de regras, compilações e verificações estáticas. A revisão final da janela repetiu os dois testes de imagem, sem somá-los novamente à contagem. O teste online confirmou conversão PNG → JPEG, prévia, cópia ajustada em rascunho e preservação da mídia anterior na biblioteca. Dados e conta temporários removidos; nenhuma publicação real no Instagram foi realizada. Consulte [Ajuste de imagens](ajuste-de-imagens.md).

## Prévia e seguidores — 14/10/2026

App Hosting `build-2026-10-15-004` ativado, com Hosting, regras e índices publicados; Functions verificadas e sem alterações. Disponível em https://lup-media-pro.web.app.

Inclui revisão antes de publicar/agendar, adoção imediata de imagens confirmadas pelo servidor, importação de ZIP ou arquivos JSON/HTML extraídos, seis filtros de relações com contagens e etiquetas arredondadas por perfil. A lista legada continua disponível em Todos; comparar relações exige as listas de seguidores e seguindo.

Validação: 91 testes de código, 18 testes de navegador (desktop/celular), 5 testes de regras, TypeScript, ESLint e compilações de aplicação/Functions. O teste online confirmou upload privado, validação de imagem no Storage real, prévia, ajuste e persistência de rascunho, sessão, OAuth inicial e atualização de planos. Nenhuma publicação no Instagram foi realizada.

No desenvolvimento com ADC de usuário, a identidade do servidor precisa de `roles/storage.objectUser` no bucket específico para validar uploads, gerar a cópia privada e ler mídias. Permissão de listar o bucket não permite ler seus objetos. O acesso de objetos da credencial local foi corrigido; o bucket permanece privado. O App Hosting já utiliza sua conta de serviço com esse papel.

## Histórico de seguidores — build-2026-10-15-005

App Hosting `build-2026-10-15-005` ativado e Firebase Hosting publicado no endereço principal. As regras e Functions não foram alteradas nesta atualização. A publicação do Hosting também atualizou a interface entregue pelo endereço curto.

Comparações entre importações agora ficam arquivadas no servidor, por conta, com paginação e indicação do intervalo e de listas possivelmente parciais. A aba Seguidores inclui Quem deixou de seguir · Histórico. A primeira lista válida estabelece a base; uma lista de seguidores já existente pode servir de base à próxima importação. Snapshots anteriores continuam preservados, mas o arquivo de eventos começa com importações desta funcionalidade.

Validação: 96 testes de código, TypeScript, ESLint, compilação de produção e os dois testes de navegador de seguidores, no desktop/celular. O teste online confirmou importações sintéticas, saída detectada, histórico persistente após recarga e paginação no domínio principal, além de upload privado, ajuste de imagem, rascunhos e planos. Conta e registros temporários foram removidos; nenhuma publicação no Instagram foi realizada. Detalhes em [Histórico de seguidores](historico-de-seguidores.md).


## Cache de desenvolvimento local

`npm run dev` usa explicitamente a porta 3000 e o diretório `.next-local`; builds de produção continuam em `.next`. O override `LUP_NEXT_DIST_DIR` continua disponível para testes. Isso evita que um build de produção remova o cache usado pelo servidor local e que uma segunda execução passe silenciosamente para 3001. Se a porta 3000 já estiver ocupada, use a instância existente ou encerre-a antes de reiniciar. `.next-local` é ignorado pelo Git e pelo empacotamento do App Hosting.
