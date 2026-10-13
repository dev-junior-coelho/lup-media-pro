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
- CI e workflow manual de deploy com Workload Identity Federation, dependentes da configuração externa.

## Infraestrutura real

Projeto Firebase independente lup-media-pro e app Web criados. Firestore nam5 criado, regras/índices publicados e Authentication e-mail/senha habilitado. App Hosting, Storage e Functions ainda não estão implantados/ativos. App Hosting rejeitou habilitação por falta de plano Blaze.

**Não existe endereço público da aplicação ou callback OAuth verificado.** A rota de callback está implementada; a URL completa depende do deploy do backend.

## Validação

Resultados finais serão registrados após a última execução dos testes. Testes de Meta são simulados; sucesso dos testes não significa conexão real com @junior_coelho36.

## Pendências externas

Habilitar Blaze no projeto independente; fornecer App ID e inserir App Secret no Secret Manager; criar chave AES e permissões IAM; provisionar bucket e App Hosting; obter origem HTTPS real. Teste real de publicação somente com autorização explícita do proprietário.

## Limitações

Validação/transcodificação completa de vídeos no servidor, quotas e coleta de uploads órfãos, paginação além de 1.000 registros, UI de convites/equipes, insights autorizados, políticas públicas de comercialização e App Review ainda exigem trabalho. O scheduler usa resolução de um minuto e lote de até 50 posts. A lista inicial é baseada em exportação parcial e não identifica automaticamente unfollows recentes.
