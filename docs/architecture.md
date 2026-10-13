# Arquitetura e operação

Next.js App Router, React, TypeScript strict e Firebase independente. `components/` contém a interface convertida; `app/original.css` preserva as duas camadas CSS originais. `lib/shared/` valida posts e exportações. `lib/server/` contém autorização, OAuth, Meta e processamento. `functions/` compila e implanta dois schedulers Gen 2. Nenhum recurso do LupFood é utilizado.

## Dados

`users/{uid}` aponta ao workspace. `workspaces/{ws}` contém nome e fuso; subcoleções members (owner/admin/editor/viewer), accounts (dados públicos), secrets (tokens AES-256-GCM, leitura negada ao cliente), posts (draft/scheduled/processing/published/failed/cancelled), jobs (espelho de execução), media, history, snapshots, audit, settings. Seguidores, marcações e protegidos são persistidos em settings/followers com snapshots das importações anteriores. Firestore limita um documento a 1 MiB; importações têm limite explícito e precisam ser particionadas para listas muito maiores.

O frontend usa Firebase Auth com persistência padrão e Bearer ID tokens nas rotas. O backend verifica tokens e associação ao workspace. O bootstrap cria um workspace com o UID da pessoa; papéis estão preparados, mas convites e troca de equipe ainda não têm UI. Clientes não escrevem documentos Firestore diretamente. Storage permite criação somente a editores, com limites de tipo e tamanho. O backend confere a assinatura do arquivo e lê dimensões reais de JPEG. Vídeos ainda exigem validação real de codecs, bitrate e metadados no servidor antes de comercialização; a interface lê dimensões/duração e a Meta é a validação final.

## Jobs e idempotência

Cloud Scheduler roda a cada minuto em UTC, independentemente do navegador. Os posts são a fonte de verdade; jobs espelha a fila. Uma transação adquire lease por 120 segundos. Cada execução faz uma etapa, mantendo contêiner e filhos entre chamadas. Edição/reagendamento incrementa revision e limpa os contêineres anteriores. Conteúdo processing/published ou com resultado incerto não pode ser editado, cancelado, excluído ou reenviado automaticamente.

Antes de `media_publish`, phase=publishing e uncertain=true são gravados. Timeout/crash posterior só pode reconciliar consultando status_code. PUBLISHED confirma o envio. FINISHED em um resultado incerto bloqueia a repetição para revisão humana. Não há exatamente-uma-vez transacional entre Firestore e Meta; a estratégia é conservadora contra duplicação. Uma falha permanente fica failed; falhas transitórias antes de publicar têm até cinco tentativas com backoff. O scheduler consulta quota antes de criar/publicar. O permalink é consultado após o ID confirmado, e sua indisponibilidade não reverte uma publicação confirmada.

Storage gera URLs assinadas com validade de duas horas, por arquivo, para acesso pela Meta. Biblioteca permanece privada. IAM do serviço precisa de leitura do bucket e assinatura via iam.serviceAccounts.signBlob (Service Account Token Creator). Mídias devem estar livres de download tokens persistentes; a finalização remove esse metadado. A API não ingere URLs externas: não existe caminho de fetch arbitrário/SSRF.

## OAuth

Callback `/api/auth/instagram/callback`. State aleatório com validade de dez minutos e uso único, associado a cookie HttpOnly/Secure/SameSite=Lax. Callback revalida o papel do usuário e consulta permissões concedidas. Segredos e tokens nunca são enviados ao cliente. Secrets no Secret Manager: META_APP_SECRET e TOKEN_ENCRYPTION_KEY. Scheduler diário renova tokens que expiram em sete dias; falhas sinalizam reconexão.

## Limites atuais

Scheduler tem resolução de um minuto, lote de até 50 posts e priorização simples; aumentar throughput exige paginação/Cloud Tasks. Uploads interrompidos podem deixar objetos órfãos; implementar coleta e quota por tenant antes da comercialização. Não há editor visual/corte ou transcodificação, IA configurada, insights autorizados ou anúncios. CSV usa registros internos reais. Dado indisponível é exibido para métricas não conectadas. A UI permite consultar novamente o resultado incerto na Meta; libera o status somente quando o contêiner confirma PUBLISHED. Resultados ainda inconclusivos continuam bloqueados contra duplicação.
