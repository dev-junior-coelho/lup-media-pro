# Gestor de planos

A área **Gestor de planos** aparece no menu apenas para administradores da plataforma. Esse papel é independente dos papéis de proprietário ou administrador de um workspace.

## Clientes e migrações

O gestor oferece listagem paginada, busca pelo e-mail completo do cliente e filtro de migrações recentes e consulta de solicitações antigas pendentes. O cliente é identificado por nome, e-mail e @ das contas, sem exibir identificadores técnicos como informação principal.

A administração pode:

- Ativar Essencial ou Pro e escolher as contas que continuam ativas.
- Acompanhar a migração automática do cliente, com plano anterior, plano atual e data. Aprovação manual não é necessária. O fluxo de resposta continua disponível apenas para solicitações antigas.
- Cancelar o Pro mantendo o Essencial, ou suspender a assinatura pausando todas as contas.
- Reativar uma assinatura e consultar o histórico das alterações.

Cada mudança administrativa exige um motivo interno e a conferência do cliente, plano e contas. Esses motivos ficam na auditoria administrativa, sem serem expostos no histórico público do workspace. Reduções e suspensões são bloqueadas enquanto houver envios em andamento ou resultados incertos nas contas que seriam pausadas. Uma suspensão não pode ser desfeita pelo próprio cliente pela troca para o Essencial ou ativação de contas.

O controle de revisão evita sobrescrever uma alteração mais recente. Pedidos têm identificação própria, são idempotentes enquanto pendentes e uma decisão antiga não pode aprovar um pedido novo. Conexões, reconexões e alterações de vagas também atualizam a revisão da assinatura.

## Preços

Na aba **Preços dos planos**, o administrador edita valores mensais e anuais em reais e a descrição de cada plano. Os limites permanecem fixos: uma conta no Essencial e até três no Pro.

Os valores são armazenados em centavos. Campos vazios representam “Sob consulta”. A opção de publicação controla se preços e descrição aparecem na área **Plano e contas** dos clientes. Valores ainda não publicados não são retornados pela API pública de estado. Edições simultâneas de preços também possuem controle de revisão.

**Salvar preços ou alterar uma assinatura não realiza nem confirma uma cobrança.** O meio de pagamento e a automatização da cobrança continuam sendo uma integração futura.

## Acesso administrativo

A permissão usa a custom claim `platformAdmin: true` do Firebase Authentication. Todas as APIs administrativas verificam o token e consultam novamente o cadastro do usuário. Assim, remover a permissão impede novas operações mesmo que um token antigo ainda contenha a claim.

Para conceder acesso a uma conta existente, com credenciais administrativas do projeto:

```sh
npm run admin:access -- --email EMAIL_DO_ADMINISTRADOR --grant
```

Para preparar uma conta que ainda não existe:

```sh
npm run admin:access -- --email EMAIL_DO_ADMINISTRADOR --grant --create-if-missing
```

A criação usa uma senha aleatória que é descartada e nunca exibida. O titular define sua própria senha pelo fluxo **Esqueci minha senha**. A ferramenta não envia e-mails. A concessão também indexa solicitações pendentes do formato anterior para que apareçam na fila do gestor.

Para revogar:

```sh
npm run admin:access -- --email EMAIL_DO_ADMINISTRADOR --revoke
```

A revogação remove somente a claim administrativa, preserva as demais claims e revoga os tokens de atualização. Não existe uma API de navegador que permita ao usuário conceder esse papel a si próprio.

## Estrutura e segurança

- `commercialSettings/plans`: catálogo e revisão dos preços.
- `planRequests/{workspaceId}`: solicitação mais recente do cliente.
- `planAudit/{eventId}`: auditoria administrativa, incluindo preços e motivos internos.
- `workspaces/{workspaceId}.subscriptionRevision`: versão da assinatura.

Essas coleções globais não podem ser lidas ou alteradas diretamente pelo SDK do navegador, inclusive por proprietários de workspace. A interface administrativa usa APIs protegidas, que retornam somente os dados necessários e não incluem tokens do Instagram.

As transações de assinatura são compartilhadas pela interface administrativa, pela mudança para o Essencial feita pelo proprietário e pelo comando `plan:set`, para manter as mesmas regras. O índice para consultar o histórico está registrado em `firestore.indexes.json` (`planAudit`: `workspaceId` crescente e `at` decrescente).

## Implantação

A aplicação e as Functions devem ser publicadas com a mesma versão antes de operar as mudanças de assinatura em produção: o bloqueio de envios depende do worker atualizado, além das APIs. A criação do acesso administrativo e a preparação do índice são configurações do projeto Firebase e não substituem o deploy da aplicação e do agendador. O endereço principal é https://lup-media-pro.web.app.

## Validação

79 testes de código, 14 testes de navegador em computador e celular e 5 testes das regras de acesso, além de TypeScript, ESLint e compilações de Next.js e Functions. Os testes integrados usam apenas emuladores, com preços e clientes fictícios. A concessão e a revogação pela ferramenta administrativa também foram verificadas no emulador.

Na etapa atual, o cliente migra imediatamente para o Pro sem cobrança. Solicitações antigas podem ser concluídas com `npx tsx scripts/migrate-pending-plans.ts`. A futura integração InfinityPay deverá condicionar a ativação à confirmação de pagamento no servidor.
