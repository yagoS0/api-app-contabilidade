# Operações — primeira correção ordinária, 30/10/2026

Este registro substitui as afirmações de correspondência do extrato e disponibilidade da conferência no relato anterior, preservado abaixo. Reaplicados os 26 arquivos de `candidate-round1/after`, verificando SHA256 de cada fonte e de cada arquivo existente contra `beforeSHA`. Aplicados os três arquivos de `test-candidate/after` após conferir `candidateSha256` e `beforeSha256`; `operacoes.test.jsx` é o 27º caminho do conjunto autorizado. A pasta de testes usa nomes de arquivo simples, não a hierarquia do manifesto: primeira tentativa interrompida por caminho inexistente, corrigida sem copiar arquivo não verificado. Nenhum arquivo fora dos caminhos atribuídos foi editado.

Histórico informado pelo Principal: 936b5669 (ENOENT), c63e0921 (interrompido por falta de banco descartável), 27ade73b (focal 151 passaram/3 falharam). Essas execuções e a validação anterior dos três candidatos de teste não são aprovações desta revisão. Esta é a primeira correção ordinária; não reinicia o histórico nem amplia limites.

## Correções implementadas

- Removida a associação `matchingExtract`: `PgdasHistoricoService` não retorna `calculoId`, `idempotencyKey`, revisão de Operações ou vínculo equivalente. Número da declaração, versão atual da circular e data não comprovam revisão do cálculo. Reabertura preserva número/data/retorno anterior; recálculo também pode conservar identificadores. Nenhuma versão é escolhida arbitrariamente. Simulação, retorno salvo da transmissão e tabela de impostos dos extratos salvos têm origens separadas, datas/identidades disponíveis e correspondência explicitamente **A verificar**. Histórico e divergências permanecem visíveis, inclusive versões antigas, ambíguas e legadas. Não há comparação liberada por igualdade de valores ou presença da guia. Garantir conciliação por revisão exige segundo incremento de contrato backend; não foi simulado neste frontend.
- `OperationsApproval` exige snapshot e auditoria lidos e válidos para confirmar ou liberar, inclusive seleção de elegíveis, lote, retomada de liberação e guarda do handler. Snapshot deve pertencer à empresa/competência e seu `idempotencyKey` corresponder ao `calculation.calculoId` da operação. Estado incompatível, contexto divergente, ausência, formato inválido e erro de leitura deixam causa e recuperação visíveis. Atualizar evidências limpa seleção/prévia e relê fontes; revisão, navegação e programação continuam disponíveis conforme guardas existentes. A auditoria não recebe regra fiscal nova: achados e itens não conferíveis legíveis não são bloqueio genérico. Extrato não é requisito pré-transmissão. O servidor continua responsável por revalidar revisão, autorização, fingerprint, pendências e idempotência.
- Preservado o restante do candidato: três quadros, rotinas numéricas, cores semânticas, tabelas contextuais, guias individuais, ZIP fiscal autenticado e separação entre erro global e erro próprio da carteira. Lacunas já registradas no candidato continuam, especialmente resultado ZIP sem detalhamento por item no DTO, download sem versão imutável e conciliação fiscal por revisão.

## Regressões e validação desta correção

Fixtures das duas suítes de aprovação agora fornecem snapshot/auditoria e chave do cálculo compatíveis com as evidências obrigatórias; verificações anteriores de efeitos, permissões, seleção, foco, timeout e contexto foram preservadas. Novos cenários cobrem falha/ausência/formato inválido de cada fonte obrigatória, outra empresa/competência/revisão, recuperação por atualização, limpeza de seleção, liberação já salva sem auditoria, achados disponíveis sem proibição fiscal nova e ausência de extrato futuro. Testes de apresentação cobrem reabertura, recálculo, transmissão incerta, flags divergentes, duas versões atuais, versão única histórica, legado e DTO transmitido sem vínculo de revisão, mantendo acesso aos valores históricos e zero mutações.

Tentativas reais nesta sessão:

- `node scripts/governance/check.mjs plan --base f6a8ca418301b2ed7a1202aafb4c1772bb392ae9`: bloqueado antes do script por `EPERM: operation not permitted, lstat 'C:\Users\yagoa'`.
- `npm --workspace apps/web test -- --runInBand --runTestsByPath src/features/operacoes/__tests__/OperationsApproval.test.jsx src/features/operacoes/__tests__/OperationsApprovalIntegration.test.jsx src/features/operacoes/__tests__/OperationsCalculationDetails.test.jsx src/features/operacoes/__tests__/operationsDetails.test.js`: mesmo bloqueio antes de executar Jest. Nenhum teste dessa correção é declarado aprovado.
- `git diff --check`: concluído sem erros de whitespace (avisos LF/CRLF).

Principal/controlador deve executar o focal curto antes dos gates originais e revisões independentes. Validação visual desktop/celular, captura real, build e gates permanecem pendentes; não houve tentativa de contornar sandbox, mudar permissões ou reiniciar controlador. Referências canônica e versionada têm o SHA256 fornecido no pedido. Impacto: R01/R02/R19–R22, preservando R08–R12/R18/R25/R26 e seção30; nenhuma nova regra fiscal, decisão de negócio ou ação externa. Risco alto e domínios documentation/operations/web, portal como consumidor conservador. Rollback restrito ao diff autorizado, sem migração ou dados alterados. Registro protegido de governança continua responsabilidade do Principal/controlador.

---

# Histórico — continuação do candidato local, 30/10/2026

Executor delegado, rodada 0 continuada. Os 22 arquivos do candidato preservado foram reaplicados sobre a árvore inicialmente limpa; quatro novos arquivos autorizados completam os detalhes documentais e de cálculo e seus testes. O relato anterior está preservado abaixo como histórico, substituído por este registro quanto ao estado atual. Sem alterações em backend, shared, governança, dependências ou permissões. Sem ações externas, banco, commit ou publicação.

## Complementos implementados nesta continuação

- Confirmado lê `getApuracaoSnapshot`, `getAuditoriaNotas` e `getPgdasHistorico`, além da operação versionada. Tabela mostra faturamento interno/externo e anexo do formulário salvo; detalhe apresenta atividades/receitas, situação e achados/não avaliadas da auditoria, notas fora da conferência e pendências da operação. Não consulta catálogo atual para completar o anexo histórico. Leitura ausente/falha fica explícita, sem aprovação automática. Seleção por revisão, prévia fiscal, permissões e comandos existentes permanecem.
- Calculado/Transmitido usam o mesmo detalhe somente de leitura. O imposto do extrato é conciliado por competência e `numeroDeclaracao` do snapshot com as versões de `PgdasHistoricoService`. Versão atual correspondente tem precedência; sem ela, só uma versão inequívoca é aceita. Simulação é rotulada como simulação e nunca substitui imposto recebido. Declaração diferente/ausente deixa comparação indisponível. Evidência de transmissão continua vindo da projeção existente, nunca da guia.
- Guias lê `getCompanyGuides`, cuja implementação pagina integralmente. Filtra empresa/competência e reconcilia cobertura por `guideId`; duplicata do mesmo ID é erro, sem aproximação por valor/rótulo. Tabela separa documento/parcela, competência/vencimento, valor documental/recalculado, estado, canais/destinos/resultados e pagamento/origem/data. Pago lista documentos com PAID, distinguindo CLIENTE/SERPRO/MANUAL. Cobertura de obrigações permanece em detalhe próprio, inclusive débito automático e ausência de documento exigível; não se confunde com contagem documental. INSS manual mantém seu detalhe e navegação. Reenvio continua nos fluxos existentes com prévia/guardas e escolha de canais em Guias.
- Fiscal em lote usa `createSitfisDownload` → `getSitfisDownload` → `fetchSitfisDownloadBlob`. Um ZIP por pedido explícito; até 40 leituras espaçadas em 1,5 s, canceláveis. Retoma job conhecido em vez de repetir criação. Criação incerta fica retida na sessão da API, inclusive após fechar/reabrir modal. Cancelamento/troca de contexto descartam download tardio; não cancelam o job no servidor. Individual usa `fetchSitfisPdfBlob`. Blob e tipo são validados, URLs locais revogadas. Nenhuma consulta/renovação fiscal é chamada.
- Resultado ZIP informa `comPdf` versus solicitadas e explicita ausência de resultado individual no contrato. Resultado individual só é anunciado quando o usuário baixa um PDF individualmente. Não promete identificar quais itens faltaram no ZIP.
- Modais de notas para revisão, pendências e rotinas desconhecidas ganharam colunas próprias. Contabilização mantém os cinco controles em colunas, fechamento/revisão/importação e acesso a Lançamentos. Datas civis são preservadas; instantes exibem Brasília, inclusive declarações de ausência e downloads salvos. Formulários/confirmações continuam no Modal compartilhado.
- Preservada correção causal `companiesLoadError`: falha global não apaga carteira válida; loading/restoring e falha da própria carteira continuam indisponíveis.

## Limites concretos dos contratos

1. `GuideService.toGuideResponse` expõe `versaoPagamento`, não uma revisão/hash documental comum à cobertura. Não afirmar conciliação imutável de revisão documental entre essas duas APIs. UI não cria comando novo de envio sobre essa conciliação; prévia/guardas existentes permanecem nos consumidores originais. Revisão documental comum exige incremento backend separado.
2. Valor mostrado é do documento/cobrança, não valor bancário efetivamente liquidado. A listagem de guias fornece `paymentConfirmedAt` (instante de registro), não uma data civil universal de liquidação nem valor pago universal. Rótulos declaram esse limite; origem CLIENTE não vira confirmação oficial. Detalhe completo da confirmação continua em Guias.
3. `SitfisDownloadService.sitfisJobToResponse` retorna totais e erro do job, sem lista por empresa. Relatórios individuais são o arquivo atual salvo, sem parâmetro de versão imutável. A API não permite recuperar job de criação incerta sem ID por chave do cliente: UI encaminha a Tarefas e bloqueia repetição naquela seleção/sessão; cache não é garantia persistente após recarregar toda a aplicação. Não foi inventada idempotência de servidor.
4. Sem número de declaração correspondente no snapshot, ou com múltiplas versões históricas ambíguas, não há comparação segura do extrato. Não é preciso novo backend para o caso comprovado já exposto; lacuna limita-se aos registros sem vínculo inequívoco.

## Validação desta continuação

- Hash canônico/cópia versionada: ambos `68caf8f5d9b1710064132bb12d012491773825432542895daa65b7331d6e21ef`.
- Plano de impacto tentou executar e foi bloqueado antes do script por `EPERM lstat C:\Users\yagoa`.
- Tentativa focal real: `npm --workspace apps/web test -- --runInBand --runTestsByPath src/features/operacoes/__tests__/operationsDetails.test.js`; mesmo EPERM na inicialização, nenhum teste executado. Não houve mudança de permissões ou nova bateria após essa falha.
- Testes preparados: vínculo do extrato e ausência de auditoria; faturamento/anexo salvos; descarte de contexto; identidade/período/duplicata documental; pagamento cliente sem envio; data civil versus Brasília; ZIP explícito, contagem parcial, erro individual, cancelamento/retomada, criação incerta após remontagem. Corrigida expressão regular de data inválida no teste reaplicado, mantendo a verificação.
- Gates originais, teste focal complementar do Principal, build e revisões independentes continuam pendentes. Captura real desktop/celular e zoom/foco serão feitas pelo Principal. Nenhuma aprovação técnica ou visual é declarada pelo executor.

Impacto e rollback continuam os do relato histórico: apenas interface, conexões de props e helpers/testes atribuídos; preservar R01/R02/R08–R12/R18–R22/R25/R26 e seção30. Sem nova política fiscal ou decisão de negócio. e-CAC e relatório histórico externo pertencem ao Principal.

---

## Histórico do candidato interrompido (preservado; limitações frontend abaixo foram tratadas na continuação acima)

# Operações — incremento local parcial de 30/10/2026

Base solicitada: `f6a8ca418301b2ed7a1202aafb4c1772bb392ae9`. Executor delegado, rodada 0. Não houve commit, push, publicação, acesso a credenciais, dados reais ou provedores externos. Alterações limitadas aos caminhos atribuídos. Árvore inicialmente sem alterações reportadas por `git status --short`.

## Objetivo, impacto e diagnóstico

Simplificar o painel e preparar tabelas e seleção contextual usando os contratos existentes. Domínios diretos: web, operations, documentation; portal é consumidor conservador do mapa, sem arquivos alterados. Risco alto pelo acesso ao fluxo de confirmação/liberação fiscal, embora os efeitos continuem nos serviços existentes. Preservar R01/R02/R08–R12/R18–R22/R25/R26 e seção 30; nenhuma nova regra fiscal ou financeira. Nenhuma proposta de negócio pendente foi implementada.

Referência canônica e cópia versionada têm SHA256 idêntico `68caf8f5d9b1710064132bb12d012491773825432542895daa65b7331d6e21ef`, conferido por SHA256 local. O pedido atual substitui apenas a apresentação de quatro etapas. Cálculo interno de conclusão e URLs anteriores permanecem.

Indisponibilidade: `useManageCompaniesWorkspace` já expõe `companiesLoadError`, separado do feedback global. `CompaniesHomePage` passava o feedback global a Operações; uma falha de outro serviço desabilitava indicadores válidos. Agora App passa o erro dedicado, consumido somente por Operações. Carregamento e restauração de competência continuam bloqueantes; erro próprio da carteira permanece indisponível mesmo com dados anteriores. Os outros consumidores do feedback global não foram alterados.

## Implementado, ainda sem homologação executável

- Removida faixa de progresso global e seus quatro resumos. Três quadros compartilham a mesma linha e largura, com altura determinada pelo conteúdo mais alto; celular mantém altura natural. Pizzas ficam abaixo dos três quadros. Cinco barras contábeis são informativas, com acesso por Contabilização.
- Rotinas apresenta contagens reais, mantendo desconhecidos, erros, configuração e filtros. Tabelas de empresas e erros usam região de rolagem com foco.
- Cores cadastrais: base neutra, parcelamento/pendência fiscal em vermelho, certificado/procuração válidos em verde; conjuntos e rótulos preservados. Texto explicita que parcelamento não comprova irregularidade.
- Tabela de etapas com busca e filtros de conclusão, pendência, erro/bloqueio e desconhecido. Barra mantém unidade empresas. Modal aberto pela barra apresenta universo completo com filtros; URLs legadas `missing`/`stage` continuam respeitadas.
- Confirmado abre OperationsApproval. Seleção por empresa fica vinculada à revisão lida; selecionar elegíveis não grava. Prévia final usa só selecionadas. Atualizar/alterar contexto limpa seleção; respostas vazias não seguem para execução; troca de contexto ou desmontagem impede continuação tardia. Mantidas permissões, bloqueios, revisão esperada, requestId, confirmação de competência, lock e tratamento de resultado incerto.
- Tabelas de conferência mostram valor do cálculo salvo e bloqueios reais. Ausência de auditoria não é apresentada como aprovação.
- Cobertura de guias mostra identificação disponível, eixos documento/envio/pagamento, canal, destino, data e falha existentes. Ações de reenvio continuam no detalhe com a prévia e guardas existentes. Não se presume envio por pagamento nem transmissão por guia.
- Situação fiscal lê `getStoredSitfis` (GET local, resposta `{status}`), seleciona somente registros com `relatorioPdfFileId` e baixa pelo `fetchSitfisPdfBlob` autenticado existente. Download explícito sequencial dos PDFs selecionados, resultado por empresa, indisponíveis desabilitados, erro parcial preservado, Blob validado e URL temporária revogada. Não chama `getSitfis`, não aceita URL externa, não renova consulta e não declara arquivo gravado no disco: entrega ao navegador. Não produz ZIP novo.
- Navegação dos componentes tocados usa InternalLink com classes Button, preservando navegação interna e contexto. Datas novas usam validação civil antes da apresentação brasileira.

## Lacunas e próximo incremento

Esta entrega **não conclui integralmente o pedido**. Não considerar placeholders ou textos de indisponibilidade como funcionalidade concluída.

1. `OperationsService.lerOperacao` retorna `calculation` de `RecuperacaoCalculo`: DAS, RBT12 e formulário salvo, apenas nos estados recuperáveis. Não retorna resumo pronto de faturamento/anexos/auditoria nem comparação com imposto recebido do extrato. O formulário existente ainda precisa de um adaptador fiscal revisado; não somar campos arbitrários. A auditoria completa deve ser rastreada em suas fontes. `pending: []` só significa ausência das pendências consultadas, não auditoria aprovada. A interface encaminha para apuração/notas.
2. Transmitido mantém a evidência da projeção de apuração e os avisos de execução, sem inferência documental. O cálculo pode estar indisponível após transmissão, pois a recuperação aceita `calculada`/`fechada`. Valor tributário comprovado do extrato exige contrato identificado por competência/revisão; não há igualdade fabricada. Preparar o segundo incremento backend somente após esse rastreio.
3. Cobertura de guias não fornece valores, vencimentos, data/origem detalhada de pagamento e histórico completo por canal para todos os itens. Existe `getCompanyGuides`, que percorre páginas; seu contrato detalhado ainda precisa ser reconciliado por identidade/revisão com obrigações e parcelas. Portanto esta parte é **adaptação frontend pendente**, não prova de inexistência de API. Não foi conectada por aproximação de rótulo ou valor. A tabela atual é de cobertura por empresa, não lista documental completa nem fila exclusivamente de guias pagas.
4. Modais de avisos e alguns detalhes legados ainda conservam listas. A migração de todos os modais para tabelas não está completa. Formulários e confirmações permanecem no Modal compartilhado.
5. PDFs: endpoint retorna o relatório atualmente salvo por empresa, sem parâmetro de versão imutável. A lista não promete download da revisão histórica; exportação de snapshot exato requer contrato adicional. Downloads múltiplos podem depender da política do navegador; o resultado diz que o arquivo foi entregue ao navegador.
6. e-CAC, relatório histórico e pesquisa pertencem ao Principal; nenhuma área fictícia, scheduler ou consulta foi adicionada.

## Evidências e validação pendente

`git diff --check`: executado sem erros de whitespace, com avisos de normalização LF/CRLF.

`node scripts/governance/check.mjs plan --base f6a8ca418301b2ed7a1202aafb4c1772bb392ae9`: falhou antes de rodar o script, `EPERM: operation not permitted, lstat 'C:\Users\yagoa'`.

Tentativa `npm --workspace apps/web test -- --runInBand --runTestsByPath ...OperationsLayout.test.jsx ...OperationsPage.test.jsx ...OperationsApproval.test.jsx ...OperationsFiscalReports.test.jsx ...operationsDetails.test.js`: bloqueada na inicialização do Node pelo mesmo EPERM, sem executar Jest. `npm --version` também falhou. Não houve ampliação de permissões nem contorno do sandbox. Nenhum teste/build foi declarado aprovado.

Testes escritos/atualizados preservam cenários semânticos de conclusão, INSS manual, débito automático, pagamento sem envio e indisponibilidade; expectativas de apresentação removida foram substituídas. Novos casos: erro global versus carteira/restauração; filtros de cálculo sem mutação; seleção/subconjunto; resposta vazia; troca de competência durante gravação; data inválida versus zero; leitura/download fiscal explícitos e resultado parcial; retorno tardio de outro contexto.

Principal/controlador deve executar a suíte Operações e `operacoesDisponibilidade.test.jsx`, gates originais e build. Depois: revisão fiscal/contábil/GUI/UX e sistêmica independente; captura real desktop/celular, zoom, foco, listas extensas, erros e downloads. Nenhuma captura foi feita pelo executor; revisão visual e aprovações permanecem pendentes. Registro de governança cabe ao controlador: executor não editou caminhos protegidos.

## Reversão

Reverter apenas este diff de interface e testes, preservando edições concorrentes posteriores. Sem migração ou dados persistidos alterados; contratos e projeções compartilhadas continuam existentes. Não reverter indiscriminadamente a árvore.

Validação estática da continuação: git diff --check concluído com exit code 0 (somente avisos LF/CRLF). Nenhum teste executável foi aprovado nesta sessão.

## Correção dos pareceres da execução 8822272c — 30/10/2026

Esta seção atualiza o estado do candidato e prevalece sobre as descrições históricas de implementação pendente acima. Os arquivos já estavam reaplicados ao iniciar este subprocesso; foram preservados. Nenhum backend, shared, configuração, permissão ou arquivo de governança foi modificado.

- ZIP fiscal usa createSitfisDownload/getSitfisDownload/fetchSitfisDownloadBlob autenticados. Cache conserva criação incerta e acompanhamento pendente, inclusive após remontagem; resultado definitivo concluído/erro/expirado encerra o pedido. Novo clique explícito solicita os PDFs atualmente salvos. Atualizar a lista/selecionar nunca cria lote. Resultados individuais do ZIP continuam indisponíveis no contrato; não são fabricados.
- EXECUTED com snapshot transmitida é apresentado como histórico de execução concluída, mesmo sem cálculo recuperável. Essa exceção é apenas de apresentação; confirmar/liberar novamente continuam bloqueados. Erros de leitura, ausência e contexto incompatível permanecem visíveis. Evidências obrigatórias continuam exigidas para novas confirmações e liberações; extrato futuro não é requisito.
- Calculado/Transmitido mantêm resumo e ações na linha. Relatório completo abre em Modal contextual irmão, suspendendo o diálogo da lista. Filtros, página e tabela permanecem montados; fechar/Voltar restaura foco ao botão da empresa. Não há tabelas de cálculo dentro das células da lista. Não há comandos fiscais ao abrir evidências.
- reconcileOperationGuides foi movido para operationsDetails.js; OperationsGuides.jsx exporta somente o componente. Testes continuam exercitando a mesma função por seu módulo de helpers.
- O candidato existente já conecta snapshots, auditoria e histórico, além de guias individuais por identidade/competência. Extrato continua sem vínculo comprovado com a revisão do cálculo, apresentado separadamente do DAS simulado e retorno salvo da transmissão. Conciliação por revisão e valor/data efetivos da liquidação permanecem lacunas; não inferir igualdade, pagamento oficial ou envio.

Regressões acrescentadas: PDF atualizado produz novo job, erro/expiração permitem novo pedido explícito sem repetição automática; EXECUTED/transmitida sem falso erro de revisão e com falha real de auditoria preservada; detalhe fora da célula com filtro/foco preservados e ausência de mutação. Cenários anteriores de criação incerta, cancelamento e retomada permanecem.

Validação deste subprocesso: tentativa do plano de impacto e Jest focal (OperationsFiscalReports, OperationsApproval, OperationsStageModal, OperationsGuides) bloqueada antes da execução por EPERM/lstat C:\Users\yagoa. Não houve contorno de permissões. git diff --check passou (avisos LF/CRLF). Os seis gates da execução anterior, informados no pedido, não validam estas novas alterações. Controlador/Principal devem executar testes, lint e gates originais sobre o novo fingerprint. Revisões independentes renovadas e inspeção visual real desktop/celular, teclado e zoom continuam pendentes; nenhuma captura ou aprovação visual foi declarada.

Impacto preservado: R01/R02/R08–R12/R18–R22/R25/R26 e seção30. Sem nova decisão fiscal, consulta externa, envio, produção ou publicação. Reversão: retirar apenas estas alterações dos arquivos atribuídos, conservando o candidato anterior e trabalho concorrente. Registro protegido e coordenação das pendências pertencem ao Principal/controlador.
