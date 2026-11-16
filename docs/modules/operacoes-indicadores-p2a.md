# P2a — Universo, indicadores e elegibilidade de Apuração

## Escopo, base e decisão

Base remota confirmada em 16/11/2026: `e7429ee8c44b3924cd7f130b3df3dc316a87abc7`, integração do P1 (#288).
Branch `codex/operacoes-indicadores-p2a-20261116`; worktree `ALTAN/worktrees/operacoes-indicadores-p2a-20261116`.
Esta entrega contém somente documentação e testes do comportamento existente. As definições propostas abaixo **não estão implementadas nem autorizam P2b**.
Referências: [Plano Diretor](plano-diretor-operacoes-apuracao.md), [alternativa B](../design/plano-operacoes-apuracao.md), [estabilidade](estabilidade-apuracao-operacoes.md), [caracterização P1](../design/operacoes-p1-navegacao-apuracao.md), [arquitetura](../governance/ARQUITETURA.md) e [governança](../governance/POLICY.md).

Conclusão: há fontes suficientes para uma projeção **parcial e explícita**; não há contrato demonstrado de responsabilidade contratada por capacidade/período nem de recusa de apuração pelo cliente. Não preencher essas lacunas com `ATIVA`, procuração ou rotina habilitada. A implementação dos quatro indicadores depende da aprovação dos predicados e do tratamento dos desconhecidos.

## 1. Mapa atual: entrada, escritores e consumidores

`WEB` = `apps/web/src`; `API` = `apps/api/src`.

| Caminho / proprietário | Arquivos e funções | Fatos e consumidores |
|---|---|---|
| Carteira autorizada / Identidade-Cadastro | `API/routes/firm/index.js`, GET `/firm/companies`; `routes/firm/empresasVisiveis.js` | Admin/contador têm leitura global no contrato legado; outros dependem de vínculo ACTIVE. Não é autorização universal de comando. A lista não pagina no servidor. |
| Fonte mensal / Cadastro-Fiscal-Operações | `index.js#attachNotasApuracaoToCompaniesList`; `application/company/FluxoCarteiraService.js#contextosCarteira/anexarFluxoCarteira` | Lê snapshot, circular, tarefas, obrigações e hashes. Sem grupo de notas, agregação pode devolver zero; isso não prova coleta completa. |
| Projeção compartilhada | `packages/shared/src/accounting/fluxoCarteira.js#regimeCarteira/apuracaoCarteira/projetarFluxoCarteira/fluxoDaEmpresa` | Regime cadastral atual; `fluxoCarteira` pronto tem prioridade. Consumido por carteira e Operações, não só indicadores. |
| Entrada da página | `WEB/features/companies/list/pages/renderCompaniesHomePage.jsx`; `useManageCompaniesWorkspace` | Operações recebe `companies` completo, não somente empresas filtradas na aba da carteira. Geração/API/login/competência protegem contra resposta tardia. |
| Resumo e listas | `WEB/features/operacoes/operacoes.js#projetarOperacoesEmpresas/resumirEtapasOperacoes`; `OperationsPage`, `OperationsApproval`, `OperationsCalculationDetails` | Produz eixos, contadores e listas diferentes, conforme descrito abaixo. Interfaces/contratos não mudaram neste PR. |
| Evidências agrupadas | GET `/firm/operacoes/evidencias?competencia=…` → `API/application/operacoes/OperationsConsultas.js#listarEvidenciasOperacoes`; `WEB/.../useOperationsEvidence.js` | RepeatableRead no GET; inputs de `lerOperacao`, estado/revisão, rotina, cálculo manual, confirmação e Presumido. Não constitui snapshot global com a leitura separada da carteira/documentos. |
| Regime do período | `OperationsEligibility.js#regimeDoPeriodo/regimeComprovado`; histórico escrito no cadastro em `routes/firm/index.js` | Um registro cobre todo o mês; sobreposição/cobertura parcial/datas inválidas recusadas. Fallback legado Simples sem histórico exige cadastro e opção anterior ao mês. |
| Cálculo / Fiscal | `OperationsCalculationService.js#prepararCalculoOperacoes/executarCalculoOperacoes`; `FechamentoService`, `MotorApuracaoService` | Prévia é leitura; execução do atalho coleta ADN/prepara RBT12/simula SERPRO. Não chamar esse atalho de cálculo puramente local. Snapshot local, simulado e transmitido são fatos distintos. |
| Conferência / Operações-Fiscal | `OperationsService.js#lerOperacao/salvarOperacao` | Escreve `operations:v1` e `operations_request`; revisão/fingerprint SHA-256 e CAS/Serializable. Mudança de contexto pode invalidar confirmação. |
| Transmissão / Fiscal | `OperationsExecution.js`; `FechamentoService#transmitirFechamento`; SERPRO | Tentativa `operations_execution`, autorização e procuração no despacho, reserva e resultado incerto. DONE não prova documentação completa. |
| Origem externa | `FechamentoService#registrarEntregaExternaPgdas/lerEntregaExternaPgdas`; `OperationsExternalService#salvarOperacaoExterna`; `FluxoCarteiraService#salvarFluxoTarefa` | Primeiro registra afirmação humana em `EntregaObrigacaoArquivo`; segundo atende Presumido e grava conclusão de tarefa com versão/hash. Nenhum autoriza inferir recibo PGDAS. Circular recebe número RFB por integração fiscal. |
| Agenda e pausa / Operações | `CompanyRoutineApplicability`, `CompanyAutomationService`, `CompanyAutomationPolicy`, `AutomacaoCicloFiscalService`, `OperationsBatchService` | Rotina usa aplicabilidade cadastral atual; pausa, habilitação e autorização são dimensões distintas. Leitura não ativa agenda. |

## 2. Universo e predicados atuais, exatamente observados

`projetarOperacoesEmpresas` mantém empresa com `companyId`, status diferente de `INATIVA` e fluxo cuja competência coincide com a seleção mensal válida. `SUSPENSA` permanece. Duplicatas: última ocorrência do mesmo ID vence. `guideCompliance` de outro mês é descartado. A projeção recebida pronta tem prioridade sobre o fallback.

Para cada eixo `x`, `done = rows[x === true]`; `missing = rows[x !== true && x !== 'na']`; `unknown = rows[x == null]`; `notApplicable = rows[x === 'na']`; denominador `total = rows[x !== 'na'].length`. Portanto unknown também está em missing. As projeções usuais de Apuração não fornecem `'na'` como prova legal de não aplicabilidade.

| Indicador existente | Eixo / numerador | Denominador e lista ao clicar |
|---|---|---|
| Calculado | `fluxo.apuracao.apurada === true` | Todas as rows não `'na'`. Caminho moderno abre `OperationsApproval stage=calculado` com todas as rows, inclusive não calculadas. Não corresponde a “A calcular”. |
| Confirmado | Operação da mesma competência em CONFIRMED/RELEASED/EXECUTED; para PRESUMIDO, `externalSummary.apurar.concluida === true` | Todas as rows não `'na'`. Lista inclui também INVALIDATED/ATTENTION; conclusão de tarefa Presumido não é confirmação de cálculo Simples. |
| Transmitido | `fluxo.apuracao.transmitida === true` | Todas as rows não `'na'`. Clique abre modo `all`, também com não transmitidas. Paginação local de 30. |

Snapshot `calculada/fechada/revisada` conta calculado; `transmitida/confirmada` conta calculado e transmitido. `confirmada` do snapshot não é `CONFIRMED` da operação. Número RFB externo, sem número portal/estado já transmitido, produz ambos e origem Receita Federal. Guia isolada não comprova transmissão.

**Divergência de evidência:** conclusão manual `transmitir` com `dados.conclusao.em` e hash igual ao contexto promove `transmitida=true`, sem exigir recibo. Conclusão `apurar` também promove apurada. Hash obsoleto não promove. Esta é a regra legada testada, não o critério proposto para prova fiscal.

Fixture de quatro empresas: Alfa calculada/CONFIRMED; Beta aberta/PENDING; Gama calculada/INVALIDATED; Delta transmitida/ATTENTION. Resultado atual: Calculado **3/4** abre **4**; Confirmado **1/4** abre **3**; Transmitido **1/4** abre **4**. Isso já existe na base P1; não foi corrigido aqui.

## 3. Oito dimensões por empresa e competência

Cada dimensão futura deve carregar `situação`, `fonte`, `competência`, `identidade`, `revisão quando existente`, `data da evidência` e `limitações`. Vocabulário de projeção, sem novos estados persistidos.

| Dimensão / dono | Fonte atual e regra | Ausência ou impedimento |
|---|---|---|
| Regime / Cadastro-Fiscal | RegimeHistorico por Company, relacionado ao PortalClient; cobertura mensal completa; fallback legado identificado | Desconhecido/divergente não vira Simples pelo nome atual. |
| Obrigação legal / Fiscal-Obrigações | Ocorrências/atribuições e regime; hoje tarefas/rotinas também usam regime atual | Nenhum contrato único de aplicabilidade legal foi demonstrado. Rotina/tarefa/habilitação não são fundamento suficiente. |
| Responsabilidade / contratação-Cadastro | Contratos, carteira e fontes por capacidade/período ainda sem leitura canônica | `desconhecida`, não `contratada` nem `recusada`. Pausa não prova recusa do cliente. |
| Autorização / Identidade + dono da ação | Sessão/vínculo/papel; procuração para ato oficial e guardas no despacho | Leitura permitida não concede comando. Sem procuração não elimina leitura local ou registro humano permitido. |
| Cadastro/operação / Cadastro-Operações | Status, pausa global/empresa, configuração e agenda | Inativa/suspensa/pausada não é dispensa tributária. A vigência da carteira no mês precisa ser distinguida do status atual. |
| Evidência / Fiscal e respectivos donos | Snapshot, revisão, aprovação, circular, documentos, tentativas | Não consultada/ausente comprovada/parcial/desatualizada/indisponível/zero comprovado distintos. |
| Origem / Fiscal-Operações | Motor local, simulação, transmissão Altan, número oficial externo, afirmação humana, tarefa Presumido | Origem desconhecida não vira externa porque falta procuração. |
| Etapa realizada / dono do fato | Cálculo, aprovação, declaração, documentos, contabilidade | Podem se sobrepor; envio aceito, transmissão comprovada, documento disponível e contabilização não se substituem. |

### Matriz das situações obrigatórias

| Situação | Comportamento atual | Tratamento proposto / ação segura |
|---|---|---|
| Ativa e regular | Entra no universo se identidade/mês válidos; guardas adicionais no comando | Não basta para provar obrigação, contratação ou aptidão. Ler as oito dimensões. |
| Sem faturamento | Cadastro `empresaZerada` não exclui; ausência de linhas pode gerar agregado 0; atalho recusa sem movimento na preparação | Zero comprovado exige fonte completa; falta de dados é desconhecida. Sem dispensa automática. |
| Parada pelo escritório | SUSPENSA permanece na UI; cálculo exige ATIVA. Pausa aparece na prévia, podendo coexistir com canCalculate=true; lote verifica pausa | Mostrar obrigação e impedimento por capacidade. Não retirar do denominador só para aumentar progresso. |
| Cadastro incompleto | Pode permanecer no painel; prévia fiscal bloqueia cadastro/competência/fontes inadequados | Grupo a verificar e motivo concreto; não fabricar enquadramento. |
| Sem procuração | Indicador/leitura não a exige; execução oficial verifica poderes, identidade, validade e recência | Não impedir indiscriminadamente leitura/cálculo realmente local/registro externo. Atalho atual pode chamar SERPRO e mantém guardas próprias. |
| Apuração recusada pelo cliente | Não há campo canônico observado nos consumidores para esse fato | Dimensão desconhecida; decisão sobre fonte contratual/auditoria antes de classificar. Nenhuma inferência por pausa/status. |
| Inativa na carteira | Excluída da UI; endpoint agregado pode retornar, cálculo bloqueia | Separar histórico e vigência da carteira; não apagar obrigação passada. Recorte histórico exige fonte e aprovação, sem ampliar ACL. |
| Apuração externa | Afirmação humana, tarefa Presumido e prova oficial RFB são caminhos diferentes | Origem/evidência explícitas; somente prova suficiente pode contar em Transmitidas. |
| Lucro Presumido | Pode entrar nos três denominadores; confirmação externa de apurar conta Confirmado | Fora do recorte Simples/PGDAS; manter fluxo próprio e visível, sem falsear não aplicabilidade de suas outras obrigações. |
| Regime desconhecido/divergente | Carteira usa atual; cálculo usa história mensal/fallback; podem discordar | A verificar, sem assumir regime nem executar para “resolver” informação. |
| Declaração transmitida externamente | Número oficial RFB pode contar; tarefa manual também pode promover eixo legado | Preservar registro, separar prova oficial de afirmação. Ausência de recibo manual nunca é transmissão comprovada. |
| Transmissão incerta | ATTENTION/UNCERTAIN e reservas; eixo de carteira pode coexistir com evidência anterior | Não converter tentativa incerta em ausência/rejeição/sucesso nem repetir. Evidência de declaração anterior e incerteza atual permanecem separadas. |

## 4. Origem e qualidade das evidências

| Fonte | O que comprova atualmente | O que não comprova / leitor futuro |
|---|---|---|
| `RegimeHistorico` íntegro | Regime de todo PA, segundo política existente | Contratação/obrigação/permite transmitir; leitor Cadastro/Fiscal. |
| Cadastro Simples/data opção sem história | Fallback explícito de regimeComprovado | Completude histórica universal; fonte marcada legado. |
| Snapshot local com procedência e revisão | Resultado salvo do motor local | Simulação oficial ou declaração; preservar colunas separadas. |
| `dasSimuladoSerpro` + cálculo vinculado | Simulação salva | Transmissão ou vigência automática após mudança da base. |
| `operations_request` confirm | Autoria/data/fingerprint quando corresponde ao atual | Estado fiscal atual por simples presença de um registro. Limite 1.001 → INCOMPLETE; não interpretar truncamento como NOT_FOUND. |
| `operations:v1` / `operations_execution` | Coordenação, liberação, tentativa e resultado operacional | Recibo/documentos completos; tentativa incerta não prova rejeição. |
| Circular/número RFB e histórico documental | Fato persistido de consulta/retorno oficial e arquivos relacionados | Número isolado não comprova integridade de todo documento, pagamento ou contabilização. |
| `EntregaObrigacaoArquivo` humano | Declaração do operador de entrega externa | Confirmação oficial. Manter origem, data e autor sem promovê-la. |
| `CarteiraTarefa` + hash atual | Conclusão operacional da tarefa na revisão | Recibo oficial; o legado promove alguns eixos, divergência explícita. |
| Guias/PDF/hash | Identidade/disponibilidade documental de Guias | Aprovação, transmissão, entrega ao cliente, pagamento ou provisão correta. |
| Rotina/pausa/serproStatus | Configuração operacional e evidência específica de procuração | Dispensa legal, contratação ou seleção automática universal. |

## 5. Predicados e denominadores propostos para P2b

**Proposta para aprovação, não regra vigente.** Usar lógica de três valores: SIM, NÃO comprovado e DESCONHECIDO. Falha de leitura não produz NÃO. Nomes abaixo descrevem fatos, não APIs implementadas.

Definições por chave `(portalClientId, competência, obrigação)`:

- `U`: identidades distintas visíveis pela autorização atual, no PA solicitado. Visibilidade é revalidada no servidor; nenhum bypass novo.
- `S`: subconjunto de U com regime Simples comprovado no PA, aplicabilidade PGDAS comprovada por Fiscal e pertencimento à carteira no PA comprovado. Carteira histórica não é inferida do status atual.
- `I`: S com responsabilidade interna comprovada para calcular/conferir e origem pretendida ALTAN. Origem externa comprovada não entra por ausência de cálculo local.
- `H`: S com responsabilidade de conferência comprovada (interna ou conferência externa expressamente contratada). Não inferir essa responsabilidade da ACL.
- `C`: cálculo interno AUSENTE_COMPROVADO, VIGENTE, DESATUALIZADO ou DESCONHECIDO; zero só é valor válido com fonte completa/procedência/revisão.
- `R`: conferência PENDENTE_COMPROVADA, INVALIDADA, VIGENTE ou DESCONHECIDA. VIGENTE exige registro humano identificado vinculado à revisão atual de uma evidência confirmável, com origem interna ou externa explícita; presença de status isolado não basta. Evidência confirmável externa depende do contrato futuro P5: sem essa fonte/validação, R permanece DESCONHECIDA, não se fabrica aprovação a partir da declaração humana. C continua exclusivo do cálculo interno.
- `T`: transmissão COMPROVADA, AUSENTE_COMPROVADA, NÃO_CONSULTADA, INCERTA ou PARCIAL, com origem e identidade. Uma tentativa posterior incerta não apaga uma declaração anterior comprovada; cada evidência mantém revisão/versão e conflito explícito.

| Indicador | Denominador D proposto | Numerador N e lista inicial exata | Impedimentos |
|---|---|---|---|
| A calcular | I | `{e ∈ I : C ∈ [AUSENTE_COMPROVADO, DESATUALIZADO]}` | Pausa/cadastro/autorização/resultado incerto aparecem na linha; não autorizam cálculo. Ausência de prova de C fica a verificar, não entra automaticamente. |
| A conferir | H | `{e ∈ H : existe cálculo/revisão identificável AND R ∈ [PENDENTE_COMPROVADA, INVALIDADA]}`; divergência comprovada entra quando Fiscal exige revisão identificada | “Não confirmada” isolado não é predicado. Falha ao ler confirmação permanece desconhecida. |
| Confirmadas | H | `{e ∈ H : R=VIGENTE}` | R já exige evidência confirmável da revisão atual, sem exigir cálculo interno quando a origem confirmável for externa. Transmissão incerta não invalida aprovação por si; se revisão mudou, confirmação sai. Comando continua sujeito às guardas atuais. |
| Transmitidas | S, independentemente da responsabilidade interna/externa | `{e ∈ S : existe declaração da obrigação/PA com T=COMPROVADA}` | Não deduzir de tarefa, guia, operação DONE ou afirmação humana. Versão antiga e tentativa nova incerta devem ser mostradas separadamente, sem habilitar repetição. |

Prova mínima **proposta** para T=COMPROVADA: recibo oficial validado **ou** resposta oficial persistida de confirmação da declaração; ambos com empresa, PA, obrigação, número/identidade, origem verificável e instante da evidência. Não exigir que a Altan tenha transmitido. Número legado isolado, PDF não validado, marca humana sem recibo e tarefa concluída ficam PARCIAL, com eventual afirmação humana identificada na dimensão de origem/evidência; nunca comprovados por conveniência. A aceitação dos tipos concretos de prova e dos vínculos existentes exige aprovação Fiscal antes de P2b.

Os conjuntos não são uma partição. Uma empresa pode estar Confirmada e Transmitida; declaração anterior comprovada pode coexistir com A conferir após revisão. A calcular não é sinônimo de autorização para calcular, nem A conferir de autorização para confirmar. Bloqueios permanecem visíveis no conjunto qualificado, com seleção/ação recusada quando necessário.

**Incompletude:** origem, aplicabilidade, responsabilidade ou vigência da carteira desconhecidas não devem desaparecer. Mostrar grupo “A verificar”, quantidade e dimensão faltante; separar “fora do recorte Simples” e “fora da carteira no PA comprovado”. Se D não puder ser fechado, rotular “N comprovadas · universo incompleto”, sem percentual ou `0/0` que pareça conclusão. `count` completo só existe quando todas as dimensões necessárias àquele indicador estão conhecidas.

**Igualdade contador/lista:** a projeção deve devolver para cada etapa os mesmos IDs que o contador conta (`N`), além de `D` e desconhecidos separados. Clique inicial abre N, não D. Busca/filtro local informa `exibidas de |N|` e não altera silenciosamente o número do card; paginação informa total filtrado, não apenas a página. Botão explícito pode abrir o universo D, com título distinto. Seleções por ID+revisão+PA+capacidade, sem assumir que o count autoriza lote.

## 6. Atual versus proposto e riscos

| Divergência | Evidência / risco | Entrega futura delimitada |
|---|---|---|
| Badge e lista diferentes | Teste 3/4→4, 1/4→3 e 1/4→4; usuário pode preparar conjunto diferente do imaginado | P2b unifica predicado de leitura/IDs, sem novo contrato de lote. |
| Regime atual versus regime mensal | Carteira/rotinas versus Eligibility; risco de universo indevido | Leitor Fiscal por PA, expor divergência sem alterar cadastro nem guardas. |
| Tarefa manual pode contar transmissão | Caracterização com hash vigente e sem recibo; risco alto de interpretação | Classificar qualidade de evidência; preservar tarefa/histórico e comando legado, sem reescrever dados. |
| Presumido no denominador genérico | Tarefa externa conta confirmação | Recorte Simples explicitado, Presumido encaminhado a fluxo próprio existente. |
| Falta de fonte contratual/recusa | Não demonstrada nos consumidores | Decisão de fonte/contrato própria; até lá desconhecido e universo parcial. Não criar schema neste P2a/P2b sem aprovação. |
| Fontes lidas separadamente | Carteira/evidências/documentos não são snapshot único | P2b recebe leitura coerente local, chave do contexto e rejeição de resposta antiga. Não mover guardas de comando para UI. |
| Pausa e prévia apta coexistem | Teste PAUSED+canCalculate=true, sem efeitos | Apresentar capacidade/limite; não mudar rotina, worker ou política de execução. |

São limites legados constatados, não novas regressões P1. A caracterização não autoriza usar esses atalhos como regra fiscal definitiva.

## 7. Plano detalhado P2b, condicionado à aprovação

1. **Congelar os contratos de leitura.** Aprovar S/I/H, tipos de prova T e tratamento de desconhecidos; mapear fonte de carteira histórica/responsabilidade. Se fonte faltar, manter parcial. Registrar exemplos aceitos/recusados sem inventar obrigação legal.
2. **Operação específica de projeção.** Aplicação de Operações recebe leituras de Cadastro/Fiscal/Guias necessárias, por contratos públicos e composição. Fiscal determina aplicabilidade/situação; Cadastro fornece regime/identidade/competência. Adaptadores Prisma apenas leem campos delimitados. Não chamar `syncPgdasByCompetencia`, prévia de lote (que persiste), motor, provider ou worker.
3. **Leitura HTTP isolada.** Rota GET proposta, nome definitivo revisado na implementação: `/firm/operacoes/apuracao/indicadores?competencia=…`. Sem substituir contratos antigos. Reutilizar política de visibilidade vigente, filtrar por empresa também na persistência. Retornar contexto/PA, itens, qualidade/completude por dimensão e `ids/denominatorIds/unknownIds` por indicador. Nenhum booleano universal de elegibilidade.
4. **Coerência simples.** Preferir uma projeção agrupada local com os itens e conjuntos completos da carteira autorizada, seguindo a escala do contrato atual; paginação inicial local de 30. Usar leitura consistente PostgreSQL quando envolver fatos relacionados. Se volume exigir paginação servidor, caracterizar antes contrato de total/ordenação/contexto consistente; não somar páginas como universo completo. Nenhuma leitura de PDF/rede sob transação longa.
5. **Consumidor React delimitado.** Aplicar quatro indicadores e tabela contextual B, preservando containers, tokens, vínculos, comandos/fachadas e navegação. Mostrar dados ausentes/parciais. Seleção fora do filtro é informada; troca de PA/API/sessão limpa contexto incompatível e rejeita retorno antigo. Não implementar seleção nova de lote, motor local ou fluxo externo novo.
6. **Ensaios e comparação.** Unitários dos predicados com 12 situações, conjuntos sobrepostos e matrizes de evidência; HTTP real/ACL (ativo, revogado, outro ID, papel, admin); PostgreSQL descartável para leituras/isolamento e mudança concorrente de revisão; doubles que falham em escrita/rede; UI count=IDs da lista, filtros/páginas/seleção/atraso, desktop/celular e acessibilidade. Reexecutar caminho P1 e regressões de Guias/Contabilidade/Operações conforme impacto.
7. **Gates e revisão.** Diagnose zero acréscimos, CI no SHA definitivo, revisores Fiscal/Cadastro/Operações, segurança/backend e UI/UX. Publicar somente draft para autorização humana. Não ativar novo gate bloqueante ou mudar controlador.

Incrementos reversíveis: contrato/projeção de leitura → HTTP com guarda real → consumidor de etapa → regressões e evidências. Cada commit deve conservar código produtivo antigo disponível até a substituição aprovada. Rollback P2b repõe o consumidor/projeção anterior; não apaga evidências, reservas, tarefas ou confirmações. Não retransmite nem faz migração reversa.

### Decisões ainda necessárias

- Aprovar denominadores distintos e exibição explícita de universos incompletos, inclusive ausência de fonte contratual.
- Aprovar prova mínima de transmissão e classificação dos números/documentos legados sem vínculo suficiente.
- Definir fonte de vigência da carteira e responsabilidade por capacidade/PA; recusa do cliente permanece desconhecida até esse contrato.
- Aprovar que o clique abra N, com ação separada para D, e manter impedidas qualificadas visíveis sem habilitar comandos.
- Autorizar P2b separadamente após revisão deste PR. Não há autorização de merge/publicação implícita.

## 8. Aceite, evidências e rollback P2a

Aceite desta entrega: nenhum arquivo produtivo alterado; testes do comportamento atual aprovados; divergências nomeadas; predicados propostos distinguíveis do legado; links/fontes verificáveis; diagnose sem novos achados; revisão independente e CI no SHA do PR. Não exige implementar fontes que ainda faltam.

Testes novos: `OperationsIndicators.characterization.test.jsx` (30 cenários) e quatro cenários adicionais em `OperationsCalculationService.test.js`: pausa/aptidão preliminar, INATIVA/SUSPENSA, regime histórico versus atual e ausência de consulta de procuração na prévia. Componentes e funções reais; calendários/rotinas não pertinentes são doubles. Não se declara teste de login ou homologação fiscal.

Reutilizados: caracterização P1, Eligibility, Service/Execution/Batch/Consultas, entrega externa, fluxo da carteira, aplicabilidade de rotinas, respostas tardias, seleção/filtros e paginação. Resultados finais e revisões ficam no [registro de impacto](../governance/changes/2026-11-16-operacoes-indicadores-p2a.json) e no PR. Testes sem banco não substituem os ensaios PostgreSQL P1 já registrados; P2a não muda persistência nem transações. Qualquer caso PG ignorado será explicitado, nunca contado como aprovado.

Resultados locais: referência web 466/37 suítes; final web 506/39 (466 existentes +30 novos +10 de concorrência da carteira acrescentados ao recorte). API 176 aprovados/11 suítes e dois casos PostgreSQL de OperationsConsultas ignorados, sem URL descartável nesta rodada. Governança 40; analisador 5; diagnose 5.023→5.023, zero novos achados. Sete links locais validados. Não houve falha de teste nos comandos focais/finais; leituras iniciais antes do término do checkout foram repetidas após sua conclusão, sem perda ou alteração de trabalho.

Referência operacional canônica e cópia versionada: SHA-256 `e50fa30d9c205d4f09fb7638429509bb49bfb49016107e9e27d759faa649639f`. Dependências reaproveitadas localmente por junção, lockfile idêntico ao P1; nenhuma instalação altera a árvore anterior. Verificador permanece diagnose.

Governança: principal autor único; investigações e revisões independentes somente leitura. Não há alteração funcional que acione a exigência de executor antes de editar produto; não se declara execução ou `ready_for_human` do controlador nesta rodada. Não se herda aprovação do controlador de outra entrega.

Pareceres finais em 16/11/2026: Fiscal/Operações (`/root/p2a_fiscal`), Operações/UI (`/root/p2a_operacoes`) e sistêmico/backend (`/root/p2a_sistemico`) favoráveis, sem bloqueadores para esta caracterização. A primeira rodada corrigiu a definição proposta de Confirmadas para não confundir revisão confirmável externa com cálculo interno; a segunda aprovou a separação R/C e a explicitação de P5. Revisores não reexecutaram suítes; o sistêmico conferiu os relatórios locais. CI hospedada será vinculada no PR ao SHA definitivo, sem presumir aprovação.

Rollback P2a: reverter exclusivamente testes e documento/registro deste PR. Sem transformação de dados. Worktrees, bancos, branches e materiais anteriores preservados. Nenhum merge, deploy, chamada fiscal, envio ou reativação Railway. Parar para revisão humana, sem iniciar P2b.
