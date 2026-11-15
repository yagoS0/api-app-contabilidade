# Estabilidade e prontidão: Apuração Fiscal e Operações

Avaliação de desenvolvimento em 15/11/2026 sobre `96ad7e99a0ee4333e5933431024159920b2d6a9f` (PR #285 integrado). Branch `docs/estabilidade-apuracao-operacoes`; worktree `worktrees/estabilidade-apuracao-operacoes-20261115`. Esta entrega altera somente documentação. Não continua a recuperação DAS/SERPRO, não homologa regras tributárias e não altera produção.

## Decisão e alcance

É possível iniciar, após autorização humana do incremento, melhorias delimitadas de apresentação, acessibilidade e consulta de evidências existentes. **Não há liberação global de Apuração ou Operações.** Cálculo, classificação persistida, transmissão, agenda efetiva, reserva, pagamento e reparação exigem contratos e provas específicos. A migração de Guias não tornou todos os serviços legados independentes de infraestrutura.

As classes abaixo avaliam a possibilidade de desenvolver e revisar uma mudança em branch isolada:

- **LIBERADO:** condições arquiteturais verificadas para o recorte descrito; cada PR ainda precisa cumprir seus testes e revisões.
- **LIBERADO COM RESTRIÇÕES:** somente o recorte explícito pode evoluir, preservando as condições da matriz.
- **BLOQUEADO:** faltam provas ou decisões essenciais para mudar a semântica. É possível preparar caracterização em entrega própria, sem implementar o comportamento.

Nenhuma classe autoriza integração, publicação, ativação de rotinas ou ato fiscal. CI geral aprovada não substitui as evidências específicas. Este documento não amplia autorizações anteriores nem inicia automaticamente novos incrementos.

Referências normativas: [arquitetura](../governance/ARQUITETURA.md), [política de revisão](../governance/POLICY.md), [ambiente](../development/AMBIENTE.md), [regras operacionais](../../REGRAS_OPERACIONAIS.md). A fonte canônica foi resolvida fisicamente pela junção preservada; SHA-256 `e50fa30d9c205d4f09fb7638429509bb49bfb49016107e9e27d759faa649639f`, idêntico ao snapshot versionado. Decisões das seções 34/35 não são prova de que todos os comportamentos propostos estejam implementados ou ativos.

## Mapa atual e fronteiras

Os caminhos nesta seção são relativos ao repositório. Funções indicam o ponto a inspecionar em uma alteração; não constituem inventário de todas as rotas da API.

### Apuração Fiscal

| Camada / etapa | Componentes e contratos observados | Dependências, dados e efeitos |
| --- | --- | --- |
| Apresentação | `apps/web/src/features/apuracao-v2/`, `apuracao/`, `apuracao-lp/`; `useApuracaoV2`, `renderApuracaoV2Tab`, `FechamentoModal`, `ApuracaoLpTab` | Empresa e competência são contexto. O hook também salva cadastro/perfil/produtos/classificação/apuração; o modal pode transmitir. A tela inteira não é uma leitura pura. |
| Entrada HTTP | `apps/api/src/routes/firm/apuracaoV2.js`; rotas LP/consumo e histórico PGDAS | Usa `requireFirmCompanyAccess({minRole:'ACCOUNTANT'})` nos endpoints examinados e serviços legados; também importa Prisma diretamente. Preservar DTOs, erros, revisão e ator da sessão. |
| Notas → base | `application/notas/apuracao/v2/MotorApuracaoService.js#calcularApuracaoLocal`, `ClassificadorService`, `ClassificacaoManualService#aplicarClassificacaoManual` | Seleção de notas EMIT/autorizadas por empresa/mês; rateios e arredondamentos por item/tipo. Classificação manual usa Serializable, bloqueios de estado e troca da chave de revisão. Persistência e decisão ainda estão próximas. |
| Cálculo e conferência | `FatorRService`, `AliquotaResolver`, `RelatorioFaturamentoService`, `PerfilFiscalService`, `ConferenciaAdnService` | Cadastro, notas, folha, RBT12, vigências, snapshots e logs. Ausência não equivale a zero. `persistir=false` e leitores de relatório são contratos específicos, não uma garantia para qualquer prévia. |
| Fechamento fiscal | `FechamentoService`: `getDadosFechamento`, `calcularFechamento`, `salvarFechamento`, `transmitirFechamento`, `reabrirFechamento`, `conferirTransmissaoFechamento` | `calculoId`, `idempotencyKey`, snapshot, CAS e estados `transmitindo`/`erro_transmissao`. Reabertura fiscal preserva prova anterior e não é reabertura contábil. |
| Presumido / consumo | `application/fiscal/lp/LucroPresumidoCalculoService.js`, `lp/lib/apuracaoPresumido.js`, `application/fiscal/consumo/` | Projeção e reconciliação têm premissas próprias; não tratar tributo não calculado como zero. Não unificar com o Simples para simplificar a tela. |
| SERPRO | `application/fiscal/serpro/SerproPgdasdService.js`, `CaptureSerproGuidesService.js`, `SerproCallGuard.js`, cliente HTTP/cache/procuração | Transporte e autorização fiscal concretos. GERARDAS12/GERARDASCOBRANCA17 não têm a semântica de TRANSDECLARACAO11. Timeout não comprova rejeição; não repetir automaticamente. |
| Guias | `modules/fiscal/application/persistirDocumentoDas.js`, `composition/persistenciaDocumentoDas.js`, contratos públicos de Guias | Fiscal interpreta; Guias mantém bytes/hash, identidade, empresa/competência, revisão e atualização condicional. Existência documental não comprova contabilização ou entrega. |
| Contabilidade | `modules/accounting/application/contabilizarDasCapturado.js`, `composition/contabilidadeDasCapturado.js`, `AccountingEntryGeneratorService`, `GuideToProvisionService` | Provisões/linhas e fechamento pertencem a Contabilidade. Falha pode retornar `accounting.ok:false` após guia/circular salvas; acréscimos permanecem best-effort. Não há transação global com SERPRO. |
| Acompanhamento | Operações consome snapshots; Guias fornece documento; Comunicação fornece tentativa/recibo | Confirmado, transmitido, disponível, enviado, entregue e pago são fatos distintos. Preservar os consumidores no escritório e portal. |

O cálculo legado de `FatorRService.decidirFatorR` usa `Number`, `toFixed(4)`, comparação com `0.28` e fator zero quando RBT12 é zero. A função é pura, mas o arquivo também importa Prisma. Isso documenta compatibilidade existente, **não valida a fórmula, o arredondamento ou a tolerância como regra tributária definitiva**. Alteração exige fixtures de fronteira e aprovação fiscal própria. A resolução de alíquota mantém vigência/faixa e recusas de dados ausentes.

### Operações

| Recorte | Arquivos / funções | Leituras, comandos e limites |
| --- | --- | --- |
| Painel | `apps/web/src/features/operacoes/OperationsPage.jsx`, `operacoes.js#projetarOperacoesEmpresas`, `operationsDetails.js` | Projeções e filtros convivem com callbacks de captura/envio, aprovação e cálculo em lote. Não liberar a página inteira como mudança visual. |
| Evidências | `useOperationsEvidence.js`; `routes/firm/operacoes.js` → `/operacoes/evidencias` | GET agrupada local, valida contexto/IDs/revisão/status e descarta resposta tardia. Endpoint usa RepeatableRead; isso não transforma todos os leitores de Operações em snapshot único. |
| Conferência | `OperationsService#lerOperacao/salvarOperacao`, `OperationsApproval` | PENDING/IN_REVIEW/CONFIRMED/RELEASED e projeções INVALIDATED/EXECUTED/ATTENTION. Escrita com Serializable, lock empresa/competência, ACL transacional, revisão e recibo idempotente. |
| Lote | `OperationsBatchService`, `OperationsCalculationService`, `OperationsCalculationBatch` | `preview` do lote persiste `operations_batch_preview:<id>` em AppSetting. Aceite valida dono, prazo, hash, contexto e seleção; reserva/auditoria são transacionais, tarefa é agendada depois. |
| Execução | `OperationsExecution#executarOperacao`, `FiscalManualRunService`, `ManualTaskService` | Reserva e despacho são etapas distintas. RUNNING → DONE/ATTENTION não prova integridade documental/contábil completa. Polling não autoriza novo despacho. |
| Agenda | `OperationsRoutines#listarRotinasOperacoes`, `OperationsRoutineCompanies`, `OperationsDailyCalendar`, `AgendaEventosEditor`, `CompanyAutomation` | Leitura de escolhas e aplicabilidade; salvar editor pode mudar execução futura. Ausência não habilita rotina, edição não equivale a ativação autorizada. |
| Ciclo migrado | `modules/operations/application/carregarCicloEnvioGuias.js`, `domain/projecaoEnvioGuias.js`, `composition/leituraCicloEnvioGuias.js`; fachada `CicloEnvioGuiasService` | Aplicação recebe operações específicas de Guias/Comunicação/contexto. Conserva ordem, pausas e revisões; reservas e transporte continuam legados. Leitura não é uma transação global nem permissão de envio. |
| Guias e parcelas | `OperationsGuides`, `OperationsGuideActions`, `OperationsGuideEvidence`, `CompanyGuideDelivery`, `CompanyGuideTracking` | Identidade de parcela/contrato, competência documental e vencimento separados; consultas de pagamento podem ter custo. Disponibilidade, entrega e pagamento não se fundem. |
| Assíncrono | `workers/apuracaoBatchWorker.js`, `serproPgdasdWorker.js`, `simplesEnvioGuiasWorker.js`, `guideWhatsappReminderWorker.js`; `scheduledRoutineService` | Não há mecanismo uniforme de lock/retry. `apuracaoBatchWorker` é acionado por clique/jobId, não loop autônomo; CAS pendente→processando e erro sem replay automático. Outros workers têm agendas próprias. |

`application/operacoes` permanece parcialmente legado, com Prisma e chamadas concretas de Fiscal. Novos recortes devem receber capacidades específicas na aplicação e ligá-las pela composição; não copiar fórmulas ou adicionar repositório genérico. O padrão migrado está no [ciclo de guias](ciclo-operacional-guias.md), não em todos os serviços de Operações.

## Autorização: três contratos distintos

1. **Liberação/revogação legadas de Guias, #275:** `routes/firm/index.js` chama `autorizarEmpresasLiberacaoGuias` para todos os itens válidos antes de consultas de guias, escrita ou e-mail. Reutiliza a guarda ACCOUNTANT; admin mantém exceção global, contador requer vínculo ACTIVE e ACCOUNTANT/FIRM_ADMIN. O ID autorizado é o `portalClientId` de cada item. ACL não é atômica com todos os efeitos posteriores; não prometer proteção contra revogação após o preflight.
2. **Lote moderno de Guias `/guides/liberacao/lote`:** usa `empresasVisiveis`, com carteira global para admin/contador. Essa divergência preexistente permanece documentada; não harmonizar permissões nesta avaliação.
3. **Lote de Operações:** `OperationsBatchService.conferirAtorOperacoes` exige ator ativo e admin ou FIRM; não-admin precisa vínculo ACTIVE ACCOUNTANT/FIRM_ADMIN por empresa. Prévia, aceite e despacho revalidam contexto. Não confundir este lote com o de Guias.

As rotas de Apuração examinadas usam guarda canônica, mas `apuracaoTarefas.test.js` a substitui por um middleware fake. Esse teste prova encadeamento, não vínculo real/revogação/admin. A cobertura real do #275 não se estende automaticamente a Apuração.

## Matriz de estabilidade e liberação

Os componentes referem-se ao mapa acima. A coluna de saída define o que precisa existir no PR futuro, além da CI e revisão humana. Nenhuma mudança de política protegida fica autorizada por uma classe restrita.

| Subárea / componentes | Classe | Dependências e risco | Restrição e condição objetiva de saída |
| --- | --- | --- | --- |
| Textos auxiliares, espaçamento e acessibilidade em componentes de apresentação de Apuração/Operações | LIBERADO | Tokens, DTO e estados atuais; risco de esconder aviso ou ação | Sem mudar ação, cálculo ou significado de estado. Testes do componente, teclado/foco e conferência desktop/celular no futuro PR. |
| Filtros, ordenação e navegação local (`operacoes.js`, páginas Apuração) | LIBERADO COM RESTRIÇÕES | Empresa/competência, paginação, seleção e tarefa em andamento | Preservar seleção fora do filtro, URL/contexto e troca de empresa. Testar resposta tardia, vazio, erro e seleção durante execução. Não ampliar consulta/carteira. |
| Indicadores, anexo e comparação tributária | LIBERADO COM RESTRIÇÕES | Motor fiscal/Planejamento, RBT12/folha e foto salva | Somente apresentação; simulação ≠ apuração. Fixtures de origem parcial, desconhecido/zero, foto antiga e centavos; nenhum cálculo novo no browser. |
| Relatório/extrato salvo e consulta de pendências | LIBERADO COM RESTRIÇÕES | Leitores de Apuração, histórico e fontes de Operações | Contrato local explícito, autorização real, projeção mínima; testes que proíbam escritas/rede e preservem erro/DTO. Não usar nome “prévia” como prova de pureza. |
| Conferência ADN: apresentação local de evidências | LIBERADO COM RESTRIÇÕES | Notas/snapshot/aviso e fechamento | Preservar revisão e proteção do mês; testes HTTP e PG existentes mais cenário alterado. Captura/cancelamento não estão liberados. |
| Ciclo mensal: leituras já extraídas | LIBERADO COM RESTRIÇÕES | Guias/Comunicação, calendário e contexto legado | Paridade de consulta/DTO/ordem, empresa e revisão; regressões dos consumidores. Sem alterar seleção efetiva de envio, reserva ou transporte. |
| Conferência/liberação operacional | LIBERADO COM RESTRIÇÕES para apresentação dos comandos existentes | `OperationsService`, reserva e auditoria | Não mudar confirm/review/release/schedule, hash ou idempotência. Mudança persistida exige recorte próprio, PG replay/rollback/concorrência e autorização específica. |
| Agenda/rotinas | LIBERADO COM RESTRIÇÕES para visual/leitura | Configuração global/empresa, pausas, calendário e workers | Mostrar origem efetiva sem ativar/copiar adesões. Mudar horários, seleção, herança ou execução é BLOQUEADO até caracterização por rotina e decisão própria. |
| Guias, pagamentos e parcelas | LIBERADO COM RESTRIÇÕES para mostrar evidência existente | Guias, Contabilidade e Comunicação | Preservar revisão, vínculo e origem da prova. Mudança de baixa, destinatário, vínculo, recibo ou reenvio exige outra entrega e testes dos donos. |
| Classificação manual e resolução persistida de notas | BLOQUEADO para mudar semântica | Fiscal, snapshots, transmissão e classificação global | Provar em PG duas conexões classificação × salvar/transmitir; revisão/CAS/rollback/isolamento. Não há liberação baseada apenas em mocks atuais. |
| Simples/Fator R/RBT12/alíquota e fórmulas LP/consumo | BLOQUEADO para mudanças tributárias | Fiscal/Planejamento, vigências e precisão | Caracterizar fronteiras, ordem/arredondamento/fontes e ausência versus zero; validar fonte/vigência fiscal e decisão humana. Não reinterpretar legado como regra aprovada. |
| Fechamento fiscal, transmissão, retificação e tarefas | BLOQUEADO para mudar fluxo | SERPRO, snapshot, CAS, reserva e interrupção | Matriz de falha antes/depois do aceite, reinício, concorrência e autorização entre aceite/despacho. Sem teste fiscal real, retry implícito ou retorno incerto tratado como fracasso. |
| Provisões, baixa e fechamento contábil | BLOQUEADO para mudanças de escrita | Contabilidade, Guias e mês fechado | Caso de uso próprio com prova de atomicidade onde contratada, auditoria, revisão e rollback. Não generalizar o Serializable da correção de valor. |
| Reservas, locks, leases, retries e recuperação DAS | BLOQUEADO | Provedor externo, cache, documento e estado local parcial | Fora desta entrega. Projeções 4.4.5–4.4.8 não autorizam recuperação, reparo contábil ou repetição. |
| Harmonização de permissões / alteração de schema ou workers | BLOQUEADO | Segurança, consumidores e dados existentes | Investigação e autorização próprias, contratos HTTP com guarda real, PG, migração/rollback quando aplicável. Nenhuma permissão ampliada/restringida nesta avaliação. |

## Evidências e lacunas de teste

### Catálogo mínimo para cada novo PR

| Alteração | Suítes existentes a reutilizar | Prova adicional obrigatória do recorte |
| --- | --- | --- |
| UI Apuração | `features/apuracao*/**/__tests__`: contexto, extrato salvo, reabertura, fechamento, classificação, foto antiga e troca de competência | Desktop/celular, foco/teclado, erro/vazio/carregamento; não há homologação visual de produção nesta avaliação estática. |
| UI Operações | `OperationsPage`, `OperationsLayout`, `OperationsApprovalIntegration`, `OperationsGuides`, `OperationsCalculationBatch`, `OperationsRoutineCompanies`, `useOperationsEvidence` | Troca de contexto, resposta atrasada, seleção e ação explícita. Um snapshot/CSS aprovado não prova segurança do comando. |
| Leitura/HTTP | `apuracaoTarefas`, `apuracaoLpRota`, `pgdasHistorico`, `operationsDesign/Consultas/Batch/Alerts`, `liberacaoLegadaAcesso` | Endpoint real + guarda real para contrato tocado; vínculos ativo/inativo/revogado, admin, empresa diferente e usuário sem papel. Negado não consulta documento nem escreve/envia. |
| Apuração/Fiscal | `application/notas/apuracao/v2/__tests__`, Fiscal LP/consumo/SERPRO e testes de Fator R do Planejamento | Novas fórmulas exigem fixtures próprios de limite e validação fiscal; testes indiretos de Planejamento não cobrem toda decisão fiscal. |
| Persistência/conferência | `conferenciaAdn.postgres`, `cicloSimplesPostgres`, `OperationsCalculationService.postgres`, `OperationsBatchService.postgres` | Banco PG16 descartável, conexões independentes, ordem inversa, conflito e rollback; explicitar o que não é atômico com provedor. |
| Guias/Contabilidade | Módulos de Guias/Contabilidade, `AccountingEntryGenerator`, `GuideToProvision`, `fechamentoContabil`; piloto correção e dois ensaios de fechamento | Pagamento/prova preservados, uma auditoria por operação efetiva, concorrência e mês fechado. Preservar #275. |
| Comunicação/Operações | Ciclo de envio/acompanhamento, módulos Comunicação, `OperationsGuideResend.postgres` | Transporte fictício, recibo/revisão antiga, indeterminado, reenvio explícito e não duplicação. Não executar mensagens reais. |
| Todos | Governança e verificador arquitetural em `diagnose` contra a base efetiva | Zero novos achados ou tratamento conforme norma; CI hospedada no SHA final, revisões independentes e consentimento humano de integração. |

Lacunas encontradas, que impedem ampliar a liberação:

1. Não foram localizados testes diretos de fronteira de `decidirFatorR/calcularEPersistirFatorR` na API. Há cobertura indireta; não comprova todos os limites de precisão/28%/zero.
2. Classificação manual tem concorrência simulada; falta ensaio PG cruzado com salvar/transmitir. Os testes PG do ciclo e da conferência não substituem essa disputa.
3. `apuracaoTarefas` neutraliza a guarda real. Mudanças de acesso/despacho exigem cobertura real e revogação entre aceite e despacho.
4. `OperationsGuideResend.postgres` exige endpoint descartável literal na porta 54661 e ignora cinco casos sem `TEST_OPERATIONS_PG_URL`. Sua execução deve ser identificada separadamente; não contar skip como sucesso.
5. UI testada por Jest não equivale a conferência visual de layout ou homologação remota fiscal. Não houve teste contra produção.

### Execução desta avaliação

Somente documentos mudaram: a candidata executa o mesmo código da base. Não foram criados testes que apenas espelhassem a implementação; as lacunas acima continuam explicitamente abertas.

| Execução | Resultado observado |
| --- | --- |
| API: Apuração, Operações, Fiscal, módulos Guias/Contabilidade/Comunicação, composição, workers e HTTP relacionados | 162 suítes aprovadas inicialmente, 2.344 testes aprovados e 42 snapshots; um teste recusou a URL de banco e sete ficaram ignorados. Não apresentar esse comando inicial como aprovado. |
| Acompanhamento PG, repetido no endpoint exigido | 1/1 aprovado. A falha inicial era a guarda literal da porta 54661, não falha de negócio; teste e proteção não foram alterados. |
| Reenvio PG no endpoint exigido | 5/5 aprovados, cobrindo os cinco ignorados no lote principal. |
| Consolidação das três execuções anteriores | 164 suítes com execução bem-sucedida; 2.350 testes aprovados únicos, 42 snapshots. Dois casos da base vulnerável do #275 permanecem intencionalmente ignorados na versão corrigida; não são cobertura obtida. |
| Frontend Apuração/Operações e consumidores selecionados | 76 suítes, 867 testes aprovados. |
| Piloto correção: paridade HTTP / revisão / persistência | 25/25 aprovados. |
| PostgreSQL: correção × fechamento e coordenação de fechamento | 10/10 aprovados, executados sequencialmente. |
| Governança, controlador, execução de lotes Jest e testes do verificador | 93/93 aprovados. |
| Diagnose arquitetural | Base 5.023, candidata 5.023, zero acréscimos. Continua em diagnose. |

Os bancos foram criados exclusivamente para esta entrega com PostgreSQL 16, loopback e dados sintéticos: porta 54670 / `altan_piloto_governance_test` para a suíte principal e porta 54661 / `altan_rotinas_governance_test` para os dois contratos com URL literal. Não foram usados clusters antigos ou credenciais reais. Os testes empregam doubles de provedores; nenhum worker produtivo foi iniciado.

Reprodução: instalar dependências pelo lockfile, gerar Prisma e aplicar migrations somente no banco descartável. Na API usar `node ../../node_modules/jest/bin/jest.js --runInBand --testPathPatterns='<seleção>'`, com `DATABASE_URL`, `ALTAN_GOVERNANCE_TEST_DATABASE_URL`, `TEST_CICLO_PG_URL`, `ALTAN_TESTE_POSTGRES=1` e `NODE_ENV=test` apontando para o banco sintético. A seleção executada inclui `application/notas/apuracao`, `application/operacoes`, `application/fiscal`, `modules/{fiscal,guides,accounting,operations,communication}`, `composition/__tests__`, workers/rotas citados e os consumidores contábeis. Não executar suítes PG concorrentes no mesmo banco. Para os contratos com URL literal, executar seus arquivos individualmente na porta 54661; reenvio usa `TEST_OPERATIONS_PG_URL` e acompanhamento usa `TEST_CICLO_PG_URL`.

No frontend, a seleção foi `features/operacoes|features/apuracao|apuracaoConsumoApi|operationsBatch|operacoesDisponibilidade`. No repositório, executar `node --experimental-vm-modules --test apps/api/scripts/piloto-correcao.test.mjs` e `node --test --test-concurrency=1 apps/api/scripts/guia-fechamento.postgres.test.mjs apps/api/scripts/fechamento-coordenacao.postgres.test.mjs`. Os logs e manifesto de integridade ficam na área privada de evidências da worktree; não publicar logs brutos/configuração local.

O controlador `2026-11-15T15-21-02-019Z-26620fab` terminou **escalated** no planejamento, com uma chamada e zero rodadas: `Planner returned an empty write allowlist`. O pedido limitava o executor à inspeção e reservava a autoria documental ao Principal. Não houve executor funcional nem teste formal concluído pelo controlador; não se declara `ready_for_human`. As execuções acima foram realizadas pelo Principal e as revisões independentes por agentes somente leitura, sem modificar gates ou permissões.

Pareceres independentes cobrem Fiscal/Contabilidade, Operações/UI/UX e segurança/arquitetura/backend. O registro de governança identifica os revisores, o escopo e as limitações; o PR registra o SHA revisado e os resultados hospedados. CI ainda precisa ser conferida no SHA definitivo antes de qualquer integração.

## Riscos preservados e isolamento obrigatório

- Apuração fornece cálculo/snapshot e interpretação fiscal; Operações não recalcula imposto para pintar status. Cadastro fornece regime comprovado; não inventar histórico a partir do regime atual.
- Guias decide identidade/revisão/disponibilidade; Comunicação decide tentativa/recibo. Documento disponível não significa entregue; aceite do canal não significa pagamento.
- Contabilidade controla provisões, baixas e fechamento. Confirmação explícita do cliente conserva R25/R26, origem CLIENTE e proteção do mês; não é confirmação bancária/SERPRO. Instrução local antiga não sobrepõe a decisão operacional posterior.
- Preservar falha contábil após guia/circular, reutilização sem reparação, reserva incerta, limpeza legada de duplicatas sem filtro de pagas e revogação de procuração entre seleção/despacho. Esses riscos conhecidos não são corrigidos nem aprovados como comportamento futuro por este documento.
- Uma transação PostgreSQL não engloba SERPRO, storage ou mensagens. Não transplantar o isolamento/lock do piloto para outros escritores sem demonstrar sua invariante. Não modificar idempotência, cache, leases ou recuperação como ajuste incidental.
- Contratos públicos mínimos e composição devem ligar os donos; aplicação nova não importa Prisma/Express/SDK. Frontend não concede autorização. Nenhuma nova dependência circular/import profundo fica aceita por reduzir outra violação.
- Mudança de apresentação não altera DTO, projeção, filtros de empresa, ordem de erro ou revisão. Mudança de consulta deve provar ausência de efeito; não reaproveitar comando persistente como leitor.

## Ordem recomendada e critérios de integração

1. **Primeiro incremento funcional candidato:** clareza de textos, acessibilidade e disposição de evidências já disponíveis em um componente delimitado. Preservar hierarquia da Apuração (competência/ações/indicadores, anexo/tabela, Fator R e comparação), avisos, origem e ações atuais. Escolher componente e objetivo com o usuário; não executar agora.
2. **Depois:** filtros/navegação local por empresa/competência, com testes de contexto e seleção, sem mudar autorização ou quantidade de efeitos.
3. **Depois:** consulta local específica com DTO/porta de leitura e testes HTTP reais, sem novo cálculo ou recuperação. Reutilizar adaptadores existentes quando suficientes.
4. **Em frente separada de caracterização:** Fator R monetário, disputa classificação × transmissão, ACL real de Apuração e janelas de falha de execução. Só depois propor alteração persistida/externa, com decisão de negócio própria.

Para integrar cada PR: base atualizada e diff restrito; domínio dono/consumidores declarados; contratos e riscos comparados; suítes focais/PG aplicáveis sem falha não explicada; zero novas violações; parecer independente do domínio, segurança/backend e UI/UX quando pertinente; CI hospedada concluída no SHA revisado; autorização humana específica. Testes locais não substituem CI. Falha ou execução interrompida fica explícita, sem `ready_for_human` inventado.

Rollback desta avaliação é reverter somente os documentos e seu registro/índice; não há banco ou comportamento a desfazer. Em futuros PRs, definir rollback por incremento, sem reverter #275 ou apagar provas. Auto Deploy permanece desativado; merge, deploy e ativação são decisões distintas. Worktrees antigas e bancos preservados.
