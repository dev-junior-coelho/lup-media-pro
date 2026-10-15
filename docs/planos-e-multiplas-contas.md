# Planos e múltiplas contas

O perfil do LUP corresponde ao workspace autenticado. Ele possui uma assinatura e pode guardar várias contas do Instagram, mas somente as vagas autorizadas pelo plano ficam ativas.

| Plano | Contas ativas | Visão conjunta | Cópia para outra conta |
| --- | ---: | --- | --- |
| Essencial | 1 | Não | Não |
| Pro | Até 3 | Sim | Sim |

## Uso

Em **Plano e contas**, o proprietário acompanha o plano e as vagas, migra imediatamente para o Pro ou escolhe qual conta permanece ativa ao voltar ao Essencial. Proprietários e administradores podem conectar e reconectar contas. Reconectar o mesmo ID não ocupa outra vaga; uma conta que precisa reconectar continua reservando sua vaga até ser desconectada.

O seletor **Conta selecionada** troca o contexto de calendário, publicações, relatórios, seguidores, marcações e importação. O Pro também oferece **Todas as contas**. Publicações e eventos identificam o @; a visão conjunta exige escolher explicitamente um destino no editor. **Copiar para outra conta** abre um novo rascunho sem escolher automaticamente o destino, sem agendamento e sem alterar o original.

A biblioteca de fotos e vídeos é compartilhada pelo workspace. Seguidores e marcações ficam em `workspaces/{ws}/followers/{instagramAccountId}`. A lista antiga permanece preservada; quando há uma única conta, ela é atribuída a essa conta. Se não for possível identificar a conta anterior com segurança, a tela de importação permite vinculá-la explicitamente, sem sobrescrever uma lista existente.

Backups são feitos por conta. O formato v2 informa o ID e o @ da origem, mantendo compatibilidade com seguidores de backups anteriores. A restauração usa a conta de destino selecionada e cria somente rascunhos, sem mídia nem agendamento ativo. Restaurar em outra conta gera IDs distintos, para não sobrescrever o conteúdo de origem.

## Limites no servidor

- A assinatura é gravada por credenciais administrativas; o navegador não pode conceder o Pro a si próprio.
- A conexão OAuth verifica vagas dentro de uma transação que também altera o documento do workspace. Conexões simultâneas não ultrapassam o limite.
- Salvar publicações e seguidores verifica se a conta pertence ao workspace e ocupa uma vaga ativa. A validação é refeita na transação de gravação.
- O worker verifica a assinatura na aquisição do job. Uma conta pausada mantém os registros e os agendamentos, mas não inicia publicações.
- O scheduler percorre os jobs vencidos para que contas pausadas ou aguardando retentativa não bloqueiem os jobs elegíveis.
- Reduzir o plano exige escolher uma conta e é bloqueado enquanto houver envios em andamento ou resultados incertos nas contas que seriam pausadas.
- Dados de contas pausadas continuam disponíveis para consulta e backup. Reativação retoma os agendamentos, incluindo horários vencidos; a interface pede confirmação.
- As regras do Firestore permitem ler as listas somente a membros do workspace e bloqueiam gravações diretas de assinatura e listas pelo navegador.

## Ativação e cobrança

**Migração automática sem cobrança nesta etapa.** O proprietário ativa o Pro imediatamente em **Plano e contas**, sem aprovação. A alteração é validada no servidor, mantém as contas ativas e registra plano anterior, novo plano, data e autor. O gestor mostra as informações atualizadas e permite filtrar os clientes pelas migrações mais recentes. Assinaturas suspensas exigem intervenção administrativa.

Para concluir solicitações pendentes do fluxo anterior, execute `npx tsx scripts/migrate-pending-plans.ts` com as credenciais administrativas. Pedidos recusados e assinaturas suspensas não são migrados.

Depois dessa confirmação, um administrador pode ativar o plano pela área **Gestor de planos**, descrita em [Gestor administrativo](gestor-de-planos.md). A ferramenta de manutenção também continua disponível para operadores com credenciais administrativas:

```sh
npm run plan:set -- --workspace ID_DO_WORKSPACE --plan pro
```

Para definir explicitamente as contas ativas:

```sh
npm run plan:set -- --workspace ID_DO_WORKSPACE --plan pro --active ID_1,ID_2,ID_3
npm run plan:set -- --workspace ID_DO_WORKSPACE --plan essential --active ID_QUE_CONTINUA_ATIVO
```

O comando não cria cobranças, registra auditoria e respeita o limite e os envios em andamento. Caso um workspace tenha mais contas guardadas que as vagas disponíveis, `--active` deve escolher as que ficam ativas. A ativação de uma conta retoma seus agendamentos pendentes; revise horários vencidos antes de executar.

A futura integração de cobrança deverá conceder o plano somente após um evento de pagamento validado no servidor, com idempotência, reconciliação e regras de vigência. Ao integrar a InfinityPay, substituir a ativação gratuita atual por confirmação de pagamento no servidor.

## Validação

Os testes usam exclusivamente o projeto demo e as APIs da Meta simuladas. Eles cobrem limites Essencial/Pro, reconexão, quatro conexões simultâneas, separação das listas, cópia de rascunhos, redução do plano, dados preservados, bloqueio do worker e impossibilidade de autoconceder o Pro. Também há cobertura de navegador em computador e celular e testes das regras do Firestore.

Validação desta entrega: 71 testes de código, 10 testes de navegador (computador e celular), 4 testes de regras, TypeScript, ESLint e builds de Next.js e Functions. O comando administrativo também foi executado no emulador, sem alterar assinaturas de produção.
