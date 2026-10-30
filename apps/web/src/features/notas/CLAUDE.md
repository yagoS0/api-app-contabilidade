# Notas — revisão de uso (08/09/2026)

## Documentos individuais e ações — N2A, 25/10/2026

Escopo deste registro: contratos e limites de documentos individuais e ações de N2A, complementando a interface N1. A conclusão técnica de cada versão é comprovada pelo respectivo registro de governança; esta documentação não declara aprovação, integração ou publicação. N2B (cancelamento fiscal) e N3 (recuperação persistente de datas) não são declarados concluídos por este incremento.

No código N2A, a coluna da lista passa de Ajustes na base para Ações e usa `AcoesNota`, compartilhado pelo detalhe de Notas e pelo detalhe aberto na Auditoria. A Auditoria transmite `companyId` e `api` ao detalhe. PDF, XML e Cancelar são ícones de 44px com nome acessível, title, foco e mensagem de indisponibilidade; não abrir o detalhe por propagação do clique/tecla de uma ação. Seleção e download em lote continuam separados e não dependem de disparar uma ação individual.

PDF abre o documento auxiliar para visualização/impressão pelo navegador; XML baixa um arquivo individual. NF-e modelo55 pode gerar DANFE a partir de XML completo com protocolo de autorização; NFS-e reutiliza o gerador DANFSe existente. Resumo de captura e DPS não substituem nota autorizada, e a disponibilidade de XML não garante PDF. O serviço confere identidade, espécie e dados locais do documento; a geração pode falhar mesmo após a capacidade local indicar disponível. Exibir a recusa real, sem arquivo vazio, sucesso fictício ou consulta fiscal automática. Preservar bytes do XML original, sem reserializar o XML fiscal; recuperação de XML de ServiceInvoice não autoriza alterar registros fiscais.

Contratos internos: `getAcoesNota(companyId, notaId, {signal})` retorna revisão e capacidades XML/PDF; `fetchDocumentoNota(companyId, notaId, formato, {signal})` retorna blob/nome. Rotas GET `/firm/companies/:companyId/notas/:notaId/acoes` e `/documento?formato=PDF|XML` exigem o acesso autenticado à empresa (`requireFirmCompanyAccess()`), sem elevar essa leitura a autorização de escrita fiscal. IDs inexistentes e fora da empresa não revelam dados. Esses leitores não exigem um novo perfil de emissão nem ativam configuração fiscal. Não confundir perfil de acesso, XML disponível e elegibilidade de cancelamento.

O frontend valida MIME e conteúdo antes de criar URL de blob. PDF reserva visualizador no gesto do usuário e apresenta download se o popup não estiver disponível; não imprime silenciosamente. Guardar e liberar os recursos: impedir concorrência por instância, abortar/desconsiderar resposta antiga, fechar visualizador e revogar blobs ao trocar identidade/revisão/contexto ou desmontar; XML libera URL depois do uso. Falha de leitura de capacidade deve permitir nova tentativa, e erro de documento não pode virar bloqueio permanente sem recuperação. Ausência do adaptador de documentos deixa botões nativamente desabilitados com motivo; capacidade indisponível mantém explicação acessível. Não usar o caminho de documentos para realizar captura fiscal.

As capacidades são renovadas a cada nova intenção de foco ou acionamento, sem consulta automática por linha ao montar ou renderizar a lista. Somente a promessa em voo é compartilhada; seu término, inclusive em erro, libera uma leitura posterior. Não manter disponibilidade negativa como cache definitivo nem exigir trocar de empresa, remontar a linha ou alterar metadados para descobrir XML importado depois. Os botões PDF/XML com capacidade indisponível continuam alcançáveis para explicar e reconferir; apenas ausência do adaptador os desabilita nativamente. Recuperação na mesma linha preserva bloqueio de ação concorrente e revalida a capacidade antes de buscar o documento. Isso evita uma chamada inicial por item da tabela (N+1), sem prometer ausência de novas consultas em intenções distintas. Uma leitura de capacidade concluída não certifica sucesso da geração seguinte.

O ícone Cancelar permanece indisponível em N2A. Nota recebida informa que somente o emissor pode cancelar; nas demais, informa indisponibilidade nesta etapa. Não há chamada de cancelamento fiscal nem PATCH de status por esses ícones. O endpoint legado de ajuste local não se transforma em cancelamento oficial e suas permissões/guardas permanecem. N2B deverá fornecer elegibilidade, confirmação/motivo, revisão e tratamento de resultado fiscal incerto antes de habilitar essa ação.

Este complemento substitui apenas as orientações históricas de coluna Ajustes na base na lista e de DANFE individual indisponível no detalhe. O download por seleção continua ZIP com relatório parcial, e as guardas de auditoria, período fechado, reutilização e emissão permanecem. O parágrafo de escopo de N1 abaixo registra o estado anterior a N2A; sua afirmação de documentos individuais ainda separados não descreve o código N2A aqui inspecionado. A interface do portal do cliente não é alterada implicitamente. Guru em conferência, eNotas ativo e benefício pendente. Nenhuma publicação, mensagem ou ato fiscal real é autorizado por esta documentação.

## Interface vigente de Notas — N1, 25/10/2026

Decisão vigente: seção 30 de `REGRAS_OPERACIONAIS.md`, aprovada em 24/10/2026. N1 foi validado localmente na revisão `e3fa7e8ac7036946c18c5ed97ac75d5bd0486c38`; isso não significa publicação nem conclusão dos demais incrementos de Notas. As notas históricas abaixo continuam registradas, mas suas instruções de posição da captura e de Conformidade nesta aba foram substituídas por esta seção.

A barra distingue ações e configuração. `Buscar` e `Importar` são os nomes visíveis; orientações do assistente dizem usar Buscar com NFS-e selecionada. Seletor NFS-e/NF-e, Integrações e Notas recorrentes ficam junto da engrenagem. A espécie da ação é independente do filtro da lista; filtro de espécie explícito vincula a ação correspondente. Recebidas conserva Ambas/NFS/NF e não oferece Emitir. Inputs mantêm XML de NFS-e e XML/ZIP de NF-e, seus limites, resultados e bloqueios. Integrações conserva a aba própria da empresa, href verdadeiro e modificadores do navegador.

`FerramentasNfse` apresenta somente recorrências nesta aba. A entrada, o painel e a leitura automática `getVerificacaoNfse` de Conformidade foram retirados deste contexto. Não remover `VerificadorNfse`, suas APIs, testes ou validações fiscais de outros contextos. Recorrências conserva Modal compartilhado, contador, erro, foco/retorno, isolamento por empresa/competência e impedimento de fechamento enquanto ocupado. A UI do portal do cliente não é alterada implicitamente por esta decisão.

Última busca aparece discretamente no cartão Emitidas, sem controle interativo aninhado. NFS-e usa `adnLastAttemptAt`; `adnLastSyncAt` é recebimento e não comprova busca bem-sucedida. NF-e usa sua própria evidência de tentativa. Falha, ausência, data inválida/futura e indisponibilidade continuam explícitas. Erros e backoff permanecem em região de avisos, sem faixa externa de idade nem frase última nota nova. Nunca inferir sucesso pela ausência de erro ou consultar ao abrir a aba.

O cartão Auditoria é compacto, com quantidade de achados da competência e estado essencial; erro/parcial não vira zero. Não somar achados, fora da conferência e pendências pós-fechamento como conjuntos exclusivos. A página Auditoria conserva o detalhamento. Datas indeterminadas saem do parágrafo global e permanecem identificáveis no disclosure do filtro de data/detalhe. Limpar intervalo conserva os demais filtros e a competência, zera a paginação e não fabrica data de emissão.

Escopo desta reconciliação: apresentação/navegação N1 e os textos do assistente associados, com guardas existentes preservadas. A coluna Ajustes na base ainda significa ajuste local; não foi convertida em cancelamento fiscal por N1. Documentos individuais, novos ícones/cancelamento e recuperação persistente de datas pertencem a incrementos separados e não são declarados implementados aqui. Guru permanece em conferência, eNotas ativo e benefício pendente. Sem publicação, envio, emissão, cancelamento ou consulta fiscal real autorizados por esta documentação.

## Organização do emissor — 14/10/2026

O assistente do contador usa `components/emissor-contador.css`, escopado à sua própria classe/modal: campos de altura uniforme, rótulos 500, títulos 600, ações de consulta alinhadas, seções com espaçamento e prévia lateral com valores legíveis. Competência e precisão do período aparecem antes dos dados de serviço na segunda etapa, mantendo os mesmos handlers, payload e regras fiscais. Abaixo de 900px a prévia segue abaixo do formulário; abaixo de 600px os campos empilham. Preservar as três etapas, foco, erros, consulta de CEP/CNPJ, E0014 e bloqueios durante envio. Não aplicar essas regras a todos os modais nem esconder overflow para encobrir campos fora da tela.

Avisos de períodos implementados em 14/10/2026: `PendenciasPeriodoBanner` em Notas e Apuração; `AvisoPeriodo` compartilhado com o cliente, visível fora dos detalhes fiscais. `PendenciaPosFechamento` conserva nota, origem, valor e situação na detecção. Distinguir FECHADA/APURADA de TRANSMITIDA com número de declaração/recibo; retificação é condicional à receita já considerada e regime de caixa/competência. Concluir revisão exige justificativa e grava ator/data; recaptura não reabre pendência resolvida. Emissão e captura se unem pela identidade fiscal, sem fabricar PortalInvoice na emissão. Não reabrir, recalcular, transmitir nem consultar SERPRO automaticamente. Falha da leitura não significa período aberto. Manter 2027 bloqueado; demonstrações locais não emitem.

Aplicar migration `20261014160000_avisos_periodos_apurados` antes do backend. O marcador durável em ServiceInvoice garante recuperação local no worker, sem repetir DPS. Dados anteriores não recebem avisos em massa: primeira descoberta significa revisão, não prova de receita omitida. Ver testes `pendenciasDoPeriodo`, `avisosPeriodo`, ligação do cliente e ensaio PostgreSQL `scripts/run-avisos-periodos-postgres.mjs`.

## CEP e consulta de resultado — 13/10/2026, PR #163

`EmitirNfseWizard` rastreia os campos trazidos pela consulta de CEP. Ao trocar o CEP, limpar somente os valores ainda iguais aos preenchidos automaticamente pela consulta anterior. Preservar número, complemento e alterações manuais, inclusive feitas durante a consulta. Respostas antigas não podem preencher outro CEP/empresa. CEP permanece texto: preservar zero inicial (`01551020`), sem conversão numérica.

Endereço nacional é completo ou vazio. Os obrigatórios são `cMun`, `CEP`, `xLgr`, `nro` e `xBairro`; `xCpl` é opcional. A validação normaliza texto e não confunde número `0` com ausência. Indicar exatamente os campos faltantes e focar o primeiro deles; não reintroduzir o aviso genérico de endereço incompleto com todos os campos preenchidos. A memoização depende dos valores do endereço e do estado da consulta, não só do booleano `enderecoParcial`.

Durante a consulta, mostrar progresso e manter o avanço bloqueado enquanto o endereço estiver incompleto. O retorno completo remove a pendência de endereço; outros erros do formulário permanecem. CEP não informa número: não inventá-lo nem confundi-lo com o número fiscal da nota.

Preservar regressão de `20040002` para `01551020`: o endereço automático do Rio é limpo, o de São Paulo é carregado e o número digitado permanece. Em produção, o segundo CEP retornou Rua Doutor Inácio Arruda, Vila Monumento, São Paulo/3550308. Esse dado é exemplo de QA, não deve ser hardcoded. Testes: `components/__tests__/consultasContador.test.jsx` cobre antes/durante/depois, troca de CEP, edições manuais e número zero.

`ConsultaResultadoNfse` é compartilhado com o cliente: consultar tentativa persistida não é reenviar. Não passar função/payload de emissão ao componente nem liberar retry em resultado incerto. Resultado recuperado deve ser identificado como recuperação de nota existente. Ler `packages/shared/src/nfse/CLAUDE.md` e `apps/api/src/application/nfse/CLAUDE.md` (caminhos da raiz). Conferir testes de rejeição/consulta dos dois portais e builds quando alterar a integração. Manter bloqueio de 2027; testes não emitem nota real.

## Revisão de concorrência e tratamento — 18/09/2026

Lista, detalhe, captura e auditoria descartam respostas de outra empresa/competência ou de uma nota já fechada. Recarga após captura/importação usa os filtros atuais. Erros de listagem e captura têm retentativas distintas; resposta sem lista não equivale a nenhuma nota. Busca por nome não inclui documento vazio; busca numérica cobre emitente e tomador, também nos resumos.

> Registro histórico: N2A remove o ajuste local da coluna de ações desta lista. A distinção entre ajuste e cancelamento oficial, as guardas de backend e as demais instruções do parágrafo permanecem; Cancelar ainda está indisponível nos ícones.

“Ajustes na base” é ajuste local, nunca cancelamento oficial; só notas `EMIT` aceitam cancelamento/reativação, inclusive no backend. A auditoria abre notas sem competência e pendências pós-fechamento. Ausência de competência orienta conferir/corrigir a origem e reimportar, sem inventar competência pela emissão. Usuários `ACCOUNTANT`/`FIRM_ADMIN` podem reabrir competência fiscal com motivo e confirmação, ou concluir a conferência da pendência. São ações independentes: reabrir não resolve o aviso, não reabre contabilidade e não retifica declaração. API usa `resolverPendenciaPosFechamento`, separado da resolução de classificação; payload inválido de pendências lança erro. Dados técnicos do detalhe ficam expansíveis. Testes não acionam captura/emissão reais.

## Fonte escolhida para NF-e emitidas — 17/09/2026

O usuário escolheu o Fisco Fácil SEFAZ-RJ. Pesquisa e plano detalhado em `docs/plano-consultas-fisco-facil-rj.md`; pendente prova autenticada, sem endpoints ou captura automática implementados. Identificar o emissor da Vagalo não é mais pré-requisito. Prever pedidos assíncronos por estabelecimento/período, acompanhamento persistente e ingestão/eventos compartilhados. O modal de importação não deve bloquear a tela durante a espera externa. A regra antiga de nunca integrar o Fisco Fácil foi superada por este pedido explícito; mantém-se a exigência de comprovar acesso e comportamento real. Nada publicado em produção nesta etapa.

## Próxima entrega planejada — 17/09/2026

O usuário autorizou implementar o plano em desenvolvimento. Modal implementado em `ImportacaoNotasModal`, renderizado pelo `AppInterno` para sobreviver à navegação, com progresso real por lote confirmado, resumo preservado, erro parcial explícito e ZIP sem contagem interna inventada. `useNotasFiscais` congela empresa/tipo, impede envio duplo, conserva resultado por empresa e protege recarga; a sessão desmontada interrompe próximos lotes. Mock demonstra sem gravação, incluindo botão próprio de demonstração. Captura emitida ainda NÃO comprovada: pendente fluxo autenticado do extrator RJ escolhido pelo usuário. Plano e evidências em `docs/plano-captura-nfe-emitidas.md` e `docs/plano-consultas-fisco-facil-rj.md` na raiz. Não criar conector/agendamento fictício nem remover a captura de recebidas. Nenhuma publicação em produção nesta etapa.

## Importação acima do limite — 17/09/2026

O 500 em produção era `MulterError: Too many files`. `importarNotasEmLotes` divide a seleção em grupos sequenciais de 20 arquivos NF-e ou 50 NFS-e, soma os resultados e preserva motivos por arquivo. Falha interrompe os próximos lotes, mantém totais confirmados e orienta conferir o lote de resultado desconhecido; nunca repetir automaticamente. Os limites do servidor continuam em vigor e retornam JSON legível. Conferência local: 38 testes de upload/ingestão, contrato e resultado aprovados; sem importar documentos reais.

## Vendas e retorno da importação — 17/09/2026

NF-e se chama “Notas de venda e compra” quando a empresa tem IE ou perfil incerto; apenas serviços confirmados sem IE mantêm somente compras/recebidas. Importação XML/ZIP está disponível na janela NF-e e usa `/clients/:id/invoices/import/nfe`, que já valida titularidade e deriva EMIT/DEST. NFS-e conserva `/import/xml`. Não enviar XML de mercadoria ao importador de serviço. O resultado fica na tela com totais e motivos por arquivo, inclusive sucesso parcial e detalhes truncados; erro de formato, outro estabelecimento e documento incompatível não podem virar silêncio. Mock não grava importações e informa esse limite.

No servidor, `/import/xml` valida a integridade do XML e rejeita NF-e com `nfe_na_area_nfse` antes de qualquer gravação; XML sem identificador reconhecido retorna `formato_nao_suportado`. Não alterar titularidade, deduplicação ou ingestão compartilhada.

Conferência: testes de contrato das duas rotas, seleção/importação NF-e com IE, serviços sem IE, lote parcial e mensagens por arquivo. Build Vite e parser JSX/no-undef aprovados. Navegador local conferido com XML fictício de venda e XML quebrado na área NFS-e: os dois motivos ficam visíveis, sem gravar notas. Publicação na main e em produção autorizada pelo usuário em 17/09/2026; integrar com a main atual e acompanhar CI e Railway. Sem migração nova neste lote.

## Revisão fiscal — 14/09/2026

> Registro histórico: somente a orientação abaixo de manter o status da captura em linha própria foi substituída pela seção Interface vigente de Notas — N1. Os demais contratos de auditoria, seleção e documentos continuam válidos.

Auditoria é uma ação em Notas, com total de achados, notas fora de conferência e pendências pós-fechamento. A rota `/auditoria` permanece, com retorno às notas; o cabeçalho mantém Notas selecionada. Falha de leitura não pode anunciar ausência de pendências. Status da captura ADN fica em linha própria, separado da barra de ações, para não deslocar Buscar NFS-e.

NotasList seleciona a página atual (até 100 notas), tanto recebidas como emitidas. Troca de filtro/página/competência limpa a seleção. XML e DANFE/DANFSe são baixados em ZIP pelo endpoint autenticado `notas/download-selecionadas`. Lote parcial identifica indisponíveis em RELATORIO.txt; falta de XML não gera documento fictício. O mock também entrega ZIP válido. NF-e usa gerador DANFE modelo 55; NFS-e reutiliza o DANFSe existente. Selecionar checkbox não abre a nota.

NF-e emitidas ficam ocultas somente quando IE está explicitamente vazia/isenta e todas as atividades conhecidas são de serviços. Perfil desconhecido, ambíguo ou misto não autoriza esconder emitidas. Recebidas continuam acessíveis. O primeiro cadastro do mock exercita serviços sem IE.

> Registro histórico: a orientação abaixo de usar apenas o lote para DANFE de NF-e no detalhe foi substituída pelo documento individual de N2A, condicionado à disponibilidade comprovada. O restante do contrato de detalhe e reutilização é preservado.

NotaDetailModal usa Modal compartilhado e uma região de ações separada da identificação/valores/itens/XML/ciclo. Reutilização e geração de DANFSe preservam as validações anteriores. O DANFE de NF-e está no download por seleção; a ajuda do detalhe aponta para essa ação.

## Revisão aprovada de navegação

Emissão no contador tem três etapas: Tomador → Serviço e valores → Conferência. O primeiro avanço valida tomador/endereço e impedimentos cadastrais; o segundo exige a nota completa. Voltar preserva os dados. Erros direcionam à etapa correspondente. Emitir permanece exclusivo da conferência, com validação integral, confirmação e trava de desfecho desconhecido.

> Registro histórico: a instrução abaixo sobre o nome da coluna Ajustes na base foi substituída por Ações em N2A; filtros continuam com a mesma fonte de verdade.

Lista apresenta busca identificada, direção e inclusão de canceladas. Filtros externos são a fonte de verdade para direção, situação e competência; o rascunho local é apenas de busca. A coluna de status local se chama “Ajustes na base”, distinguindo-a de cancelamento fiscal.

NF-e e NFS-e continuam separadas. Lista mantém linha acessível por teclado; nomes podem quebrar e ações de linha precisam de área legível. Auditoria abre a íntegra em `NotaDetailModal`, sem trocar empresa/competência nem gravar um veredito; fechar retorna ao mesmo conjunto de achados. Resposta de detalhe antiga é descartada.

Emissor usa `Modal` compartilhado com `ocupado={enviando}`. Durante emissão, fundo, X, Esc e Cancelar não devem ocultar o resultado; beforeunload alerta ao sair/recarregar. Não remover bloqueio após resposta de desfecho desconhecido. Formulário e prévia permanecem ligados à mesma declaração; permissões e certificado não foram flexibilizados. Dados excepcionais de obra/destinatário e retenções não devem desaparecer durante mudanças de layout.

## EMI-01 — etapa 2 (08/09/2026)

Referência de experiência: emissor do cliente. No contador, apresentar Para quem → O que → Quanto antes das seções excepcionais de retenções/obra/destinatário. Perfil e bloqueios da empresa seguem antes do preenchimento. Conferência obrigatória e confirmação da declaração completa permanecem; não permitir emissão a partir de handler com formulário inválido, envio em andamento ou rejeição de desfecho desconhecido.

`packages/shared/src/nfse/dadosDaOperacao.js` é a fonte única das validações de retenções, obra e destinatário nos dois portais. Os módulos locais são reexports para preservar os imports. O contador adapta suas chaves de formulário e mantém retenções numéricas no payload; a normalização compartilhada valida CPF, remove pontuação legítima do documento, recusa caracteres de controle e retém dados de operação completos. Não inferir campos excepcionais do cadastro. Erros direcionam foco à região de operação e abrem seus details, preservando preenchimento.

CSS do emissor é escopado por `.emissor-contador`: grades internas de duas colunas viram uma abaixo de 600px, labels/campos encolhem, ações quebram linha. Nenhuma alteração no App.css. Testes DOM não substituem inspeção visual real com zoom/mobile. Não foi implementado rascunho persistente de emissão; erro mantém dados enquanto assistente permanece aberto.

QA mobile identificou excesso de texto quando a empresa não está configurada: manter título, nomes dos requisitos faltantes e destino de correção visíveis; explicações extensas ficam em ajuda expansível. A lista junto ao botão tem um único retorno focável ao aviso cadastral, sem repetir todos os motivos. O bloqueio fiscal continua igual.

## Ferramentas da janela NFS-e — 14/10/2026

> Registro histórico: a composição com Conformidade e sua leitura nesta aba foi substituída pela seção Interface vigente de Notas — N1. Preservam-se as guardas de recorrências e os componentes/validações usados em outros contextos; não reintroduzir a entrada antiga nesta tela.

Notas recorrentes e Verificar conformidade ficam agrupadas por FerramentasNfse na mesma barra de Emitir, Buscar e Importar XML. Os indicadores leem recorrências cadastradas e notas com ERRO/REVISAO/ALERTA na última conferência salva da competência; falha, conferência parcial ou desatualizada têm marcador próprio, nunca equivalem a ausência de pendências. Atualizar ao fechar o modal e trocar o contexto, ignorando respostas antigas. São botões que abrem o Modal compartilhado do app, sem setas de expansão na página. Recorrências usa tamanho md; conformidade usa lg. Preservar cabeçalho, rodapé, foco por teclado, retorno ao botão e trava de fechamento durante operações. Ao trocar empresa ou competência, descartar o contexto anterior. O componente compartilhado de recorrências aceita apresentação embutida e ActionButton opcionais; o portal do cliente conserva seus padrões. Abrir conformidade apenas lê a conferência salva; não executar análise, agendar ou emitir para testar design.
