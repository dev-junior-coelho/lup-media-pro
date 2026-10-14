# LUP Media Pro

Aplicação Next.js + Firebase para organizar conteúdo e seguidores, com integração Instagram Login e scheduler Gen 2. Projeto Firebase exclusivo: `lup-media-pro`.

Aplicação publicada: https://lup-media-pro--lup-media-pro.us-central1.hosted.app

OAuth configurado; a conexão real da conta e a publicação de teste dependem da autorização do proprietário.

```sh
npm ci
npm ci --prefix functions
npm run dev
```

Requer Node 22. Configure `.env.local` usando `.env.example`. Sem configuração, o login informa a indisponibilidade. Para testes sem serviços de produção:

```sh
npm run check
npm run build --prefix functions
npm run test:rules
npm run test:e2e:emulators
npm run dev:emulators # aplicação local completa sem credenciais de produção
```

O scheduler automático só funciona depois de implantar Functions e ativar os serviços. Nenhuma publicação real foi enviada durante a implementação.

- [Auditoria e migração](docs/audit.md)
- [Arquitetura e limitações](docs/architecture.md)
- [Configuração, callback e deploy](docs/deploy.md)
- [Relatório de entrega](docs/delivery.md)

Diretórios: `app/` rotas, `components/` interface, `lib/shared/` validação/importação, `lib/server/` autorização/Meta/jobs, `functions/` scheduler, `tests/` unitários/regras, `e2e/` fluxos reais com emuladores, `migration/` lista legada acessível somente via API autenticada. Backups antigos não incluem blobs de mídia; posts importados ficam como rascunhos.
