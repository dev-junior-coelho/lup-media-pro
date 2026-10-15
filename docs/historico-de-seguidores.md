# Histórico de seguidores

Em Seguidores, abra **QUEM DEIXOU DE SEGUIR · HISTÓRICO**. A importação de ZIP ou dos arquivos oficiais extraídos compara a lista de seguidores salva no servidor com a nova lista. A primeira lista válida cria a base; novas importações registram quem desapareceu e quem apareceu ou retornou.

Os registros ficam em uma subcoleção persistente de comparações, por workspace e conta, separada das marcações de revisão. Não há corte por quantidade de importações nem expiração configurada. Cada página retorna até 300 eventos; o botão de carregar registros anteriores permite continuar consultando o arquivo. A busca e o filtro de tipo de mudança atuam nas páginas carregadas.

Datas indicam as importações comparadas, não o instante do unfollow. Use exportações de Todo o período em ordem cronológica. Ausência também pode decorrer de alteração de nome de usuário, conta desativada ou dados parciais; listas sinalizadas como parciais recebem aviso nos registros.

A comparação é feita no servidor em transação junto com a nova lista. Grandes diferenças são divididas em documentos para preservar todos os eventos dentro dos limites do Firestore. Marcações e restauração de backups não criam falsas observações de seguidores. Sair, voltar e sair novamente gera ocorrências separadas. Vincular a lista legada mantém o acesso ao arquivo original; outra conta não compartilha esse histórico.

O arquivo de comparações começa com as importações registradas por esta funcionalidade. A lista de seguidores já existente pode servir de base para a próxima comparação. A lista legada somente de revisão não permite deduzir saídas, e os snapshots antigos continuam preservados.

Validação: testes de primeira lista, legado sem seguidores, comparação por seguidores, normalização, períodos, listas parciais/vazias, retorno, saída repetida e divisão de 60 mil eventos. Testes de navegador no desktop e celular verificam importação, recarga, paginação, preservação após marcação e separação/vinculação entre contas.
