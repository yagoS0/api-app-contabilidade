# Notas — revisão de uso (08/09/2026)

## Importação acima do limite — 17/09/2026

O 500 em produção era `MulterError: Too many files`. `importarNotasEmLotes` divide a seleção em grupos sequenciais de 20 arquivos NF-e ou 50 NFS-e, soma os resultados e preserva motivos por arquivo. Falha interrompe os próximos lotes, mantém totais confirmados e orienta conferir o lote de resultado desconhecido; nunca repetir automaticamente. Os limites do servidor continuam em vigor e retornam JSON legível. Conferência local: 38 testes de upload/ingestão, contrato e resultado aprovados; sem importar documentos reais.

## Vendas e retorno da importação — 17/09/2026

NF-e se chama “Notas de venda e compra” quando a empresa tem IE ou perfil incerto; apenas serviços confirmados sem IE mantêm somente compras/recebidas. Importação XML/ZIP está disponível na janela NF-e e usa `/clients/:id/invoices/import/nfe`, que já valida titularidade e deriva EMIT/DEST. NFS-e conserva `/import/xml`. Não enviar XML de mercadoria ao importador de serviço. O resultado fica na tela com totais e motivos por arquivo, inclusive sucesso parcial e detalhes truncados; erro de formato, outro estabelecimento e documento incompatível não podem virar silêncio. Mock não grava importações e informa esse limite.

No servidor, `/import/xml` valida a integridade do XML e rejeita NF-e com `nfe_na_area_nfse` antes de qualquer gravação; XML sem identificador reconhecido retorna `formato_nao_suportado`. Não alterar titularidade, deduplicação ou ingestão compartilhada.

Conferência: testes de contrato das duas rotas, seleção/importação NF-e com IE, serviços sem IE, lote parcial e mensagens por arquivo. Build Vite e parser JSX/no-undef aprovados. Navegador local conferido com XML fictício de venda e XML quebrado na área NFS-e: os dois motivos ficam visíveis, sem gravar notas. Publicação na main e em produção autorizada pelo usuário em 17/09/2026; integrar com a main atual e acompanhar CI e Railway. Sem migração nova neste lote.

## Revisão fiscal — 14/09/2026

Auditoria é uma ação em Notas, com total de achados, notas fora de conferência e pendências pós-fechamento. A rota `/auditoria` permanece, com retorno às notas; o cabeçalho mantém Notas selecionada. Falha de leitura não pode anunciar ausência de pendências. Status da captura ADN fica em linha própria, separado da barra de ações, para não deslocar Buscar NFS-e.

NotasList seleciona a página atual (até 100 notas), tanto recebidas como emitidas. Troca de filtro/página/competência limpa a seleção. XML e DANFE/DANFSe são baixados em ZIP pelo endpoint autenticado `notas/download-selecionadas`. Lote parcial identifica indisponíveis em RELATORIO.txt; falta de XML não gera documento fictício. O mock também entrega ZIP válido. NF-e usa gerador DANFE modelo 55; NFS-e reutiliza o DANFSe existente. Selecionar checkbox não abre a nota.

NF-e emitidas ficam ocultas somente quando IE está explicitamente vazia/isenta e todas as atividades conhecidas são de serviços. Perfil desconhecido, ambíguo ou misto não autoriza esconder emitidas. Recebidas continuam acessíveis. O primeiro cadastro do mock exercita serviços sem IE.

NotaDetailModal usa Modal compartilhado e uma região de ações separada da identificação/valores/itens/XML/ciclo. Reutilização e geração de DANFSe preservam as validações anteriores. O DANFE de NF-e está no download por seleção; a ajuda do detalhe aponta para essa ação.

## Revisão aprovada de navegação

Emissão no contador tem três etapas: Tomador → Serviço e valores → Conferência. O primeiro avanço valida tomador/endereço e impedimentos cadastrais; o segundo exige a nota completa. Voltar preserva os dados. Erros direcionam à etapa correspondente. Emitir permanece exclusivo da conferência, com validação integral, confirmação e trava de desfecho desconhecido.

Lista apresenta busca identificada, direção e inclusão de canceladas. Filtros externos são a fonte de verdade para direção, situação e competência; o rascunho local é apenas de busca. A coluna de status local se chama “Ajustes na base”, distinguindo-a de cancelamento fiscal.

NF-e e NFS-e continuam separadas. Lista mantém linha acessível por teclado; nomes podem quebrar e ações de linha precisam de área legível. Auditoria abre a íntegra em `NotaDetailModal`, sem trocar empresa/competência nem gravar um veredito; fechar retorna ao mesmo conjunto de achados. Resposta de detalhe antiga é descartada.

Emissor usa `Modal` compartilhado com `ocupado={enviando}`. Durante emissão, fundo, X, Esc e Cancelar não devem ocultar o resultado; beforeunload alerta ao sair/recarregar. Não remover bloqueio após resposta de desfecho desconhecido. Formulário e prévia permanecem ligados à mesma declaração; permissões e certificado não foram flexibilizados. Dados excepcionais de obra/destinatário e retenções não devem desaparecer durante mudanças de layout.

## EMI-01 — etapa 2 (08/09/2026)

Referência de experiência: emissor do cliente. No contador, apresentar Para quem → O que → Quanto antes das seções excepcionais de retenções/obra/destinatário. Perfil e bloqueios da empresa seguem antes do preenchimento. Conferência obrigatória e confirmação da declaração completa permanecem; não permitir emissão a partir de handler com formulário inválido, envio em andamento ou rejeição de desfecho desconhecido.

`packages/shared/src/nfse/dadosDaOperacao.js` é a fonte única das validações de retenções, obra e destinatário nos dois portais. Os módulos locais são reexports para preservar os imports. O contador adapta suas chaves de formulário e mantém retenções numéricas no payload; a normalização compartilhada valida CPF, remove pontuação legítima do documento, recusa caracteres de controle e retém dados de operação completos. Não inferir campos excepcionais do cadastro. Erros direcionam foco à região de operação e abrem seus details, preservando preenchimento.

CSS do emissor é escopado por `.emissor-contador`: grades internas de duas colunas viram uma abaixo de 600px, labels/campos encolhem, ações quebram linha. Nenhuma alteração no App.css. Testes DOM não substituem inspeção visual real com zoom/mobile. Não foi implementado rascunho persistente de emissão; erro mantém dados enquanto assistente permanece aberto.

QA mobile identificou excesso de texto quando a empresa não está configurada: manter título, nomes dos requisitos faltantes e destino de correção visíveis; explicações extensas ficam em ajuda expansível. A lista junto ao botão tem um único retorno focável ao aviso cadastral, sem repetir todos os motivos. O bloqueio fiscal continua igual.
