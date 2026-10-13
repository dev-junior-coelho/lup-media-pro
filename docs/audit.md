# Auditoria do HTML original

Arquivo lido integralmente por extração das camadas CSS, HTML e scripts. JSZip 3.10.1 embutido foi identificado como dependência, não como instrução.

Identidade: sidebar azul escura, gradiente roxo/rosa/laranja, cartões brancos, calendário ao lado do editor e resumos inferiores. Navegação: dashboard, calendário, agendamentos, mídia, seguidores, modo rápido, protegidos, histórico, ZIP e backup.

Chaves legadas: `ig_unfollow_manager_20261013_v2`, `ig_unfollow_review_20261013_v1`, `ig_manager_pro_posts_v1`. IndexedDB: `ig_manager_pro_media_v1`, store `media` (blobs).

Seguidores: users, completed, protected, history [{at,user,action}], timestamps, linkMode, source. A lista original tem 1976 perfis. A fonte informa somente 15 seguidores: resultado potencialmente parcial, não comprova unfollows recentes.

Posts: id, type, caption, date, time, status, mediaIds, created, updated. Nenhum scheduler real, OAuth ou publicação de API. Status published era manual. Backups ig-cleanup-v2 e instagram-manager-pro-v1 não contêm mídia.

Migração explícita: carregar backup exportado no navegador original ou lista embutida; unir marcações. localStorage de arquivo file:// não é acessível ao novo domínio. Posts legados tornam-se rascunhos sem jobs; mídias precisam ser reenviadas. O HTML original não é publicado porque contém uma lista pessoal.
