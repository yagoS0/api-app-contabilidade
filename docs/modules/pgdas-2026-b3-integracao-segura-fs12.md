# PGDAS-2026-B3 — caracterização e proposta de integração segura da FS12

> Revisão de escopo do proprietário em 16/11/2026: a [proposta B3.1 — FS12 exclusivamente na Apuração](pgdas-2026-b31-fs12-na-apuracao.md) substitui o desenho de persistência e de origem deste documento. Não implementar cadastro geral de folha ou integrações com DP, Drive, eSocial e Contabilidade. Os achados e testes abaixo permanecem históricos; schema e migração continuam sujeitos a aprovação prévia.

Base remota confirmada em 16/11/2026: `3f48a6385d3cfa63ad0b22c2c419be53b2a108e9` (B2, PR #292). Branch `codex/pgdas-2026-b3-20261116`, worktree `worktrees/pgdas-2026-b3-20261116`. Esta entrega contém testes, documentação e inclusão dos novos testes na CI; **não habilita FS12 no motor ou no SERPRO**.

## Decisão de escopo e impacto

O pedido exige aprovação antes de nova persistência, migração ou contrato sensível e antes de alterar payload sem critérios fiscais/evidências aprovados. A investigação não encontrou fonte mensal com todos os requisitos. Consequentemente, aplica-se a alternativa autorizada de limitar o PR à caracterização e à proposta revisável. Não há novo endpoint de escrita, tabela, migração, validação fiscal produtiva ou alteração de contrato público.

Referências: [A](pgdas-2026-a-fs12-regime.md), [B1](pgdas-2026-b1-politica-evidencias-fs12.md), [B2](pgdas-2026-b2-interface-validacao-fs12.md), [revisão de coordenação #292](https://github.com/yagoS0/api-app-contabilidade/pull/292#issuecomment-6924533506), [arquitetura](../governance/ARQUITETURA.md). Fonte operacional canônica e snapshot iguais: SHA-256 `e50fa30d9c205d4f09fb7638429509bb49bfb49016107e9e27d759faa649639f`. Aplicam-se R01/R02/R06/R19/R20, seções 32–35 e preservação R25/R26: identidade, ausência diferente de zero, revisão, autorização, não repetição incerta e separação fiscal/contábil. Nenhuma regra operacional é alterada.

Fiscal é dono da evidência declaratória e da interpretação. Cadastro fornece identidade/vigência; Identidade verifica acesso; Operações coordena sem fabricar evidências; Guias e Contabilidade preservam suas escritas. DP/Drive não são integrados. UI, portal, documentos, pagamentos, fechamento e canais conservam seu comportamento. A guarda do PR #275 permanece intacta. Sem telas novas, não há mudança visual a homologar neste B3.

## Fonte confiável: o que existe e o que falta

Todos os caminhos abaixo são relativos à raiz. As linhas referem-se à base acima; nomes de funções são a referência estável.

| Fonte atual | Evidência inspecionada | Limite para B3 |
| --- | --- | --- |
| `modules/fiscal/application/consultarFs12.js:15` | B2 avalia `evidencias:[]` | Lê contexto, não confere folha; sempre `autorizaEfeitoFiscal:false` |
| `ApuracaoConfigMemoryService.js:98–117` em `application/notas/apuracao/v2` | Upsert da última configuração por PortalClient | Editor não é conferente mensal; substitui a memória anterior |
| `schema.prisma:3094`, `FatorRService.js:28–46` | Circular.fs12Manual e sugestão anterior | Agregado não permite reconstruir série nem prova zero |
| `FolhaDerivadaService.js:79` | Soma de despesa contábil para comparação | Não é base fiscal autenticada, não importar automaticamente |
| `schema.prisma:4188–4195` | Snapshot.folhaMensal12 e conferidaEm | JSON de cálculo; conferência é ADN, não FS12; snapshot único por empresa/PA |
| `RbtExtratoService.js:159–185` | PAs aceitos na última simulação | Palpite de seleção que pode envelhecer; não prova valor transmitido |
| `PeriodosRecusadosService.js:46` | Recusa por insumos/empresa/PA, ligação ao ledger quando disponível | Recusa não prova valor correto ou declaração anterior |
| `application/fiscal/serpro/PgdasHistoricoService.js:8` | Número/versão, receita, DAS e PDFs | Não fornece série mensal de folha vinculada à revisão declarada |
| `CalculoConfirmado.js:15–35` | SHA-256 de formulário, listas e contexto | Integridade não autentica fonte, conferente ou revisão mensal |
| `RecuperacaoCalculo.js:56–90` | Fingerprint de cadastro atual, notas, RBT e lançamentos | Não inclui RegimeHistorico/dataAbertura/revisões FS12; teste PG comprova que mudar esses dois primeiros fatos não altera o fingerprint |

Os arquivos sem prefixo estão em `apps/api/src/application/notas/apuracao/v2/`; schema em `apps/api/prisma/`. Nenhuma das fontes satisfaz conjuntamente valor mensal, referência verificável, conferente autenticado, versão imutável, substituições e vínculo ao cálculo. Usar AppSetting ou JSON de memória para contornar uma migração também criaria contrato sensível e não dispensa aprovação.

## Matriz dos caminhos reais

Rotas de empresa abaixo têm prefixo **`/firm/companies/:companyId`**, montado em `routes/firm/index.js:5548–5554`; o comentário histórico `/apuracao-v2` não é o caminho efetivo. `companyId` nessas URLs representa PortalClient, distinto de Company. Autenticação FIRM global em `index.js:605`. A guarda canônica permite admin global e exige vínculo ativo/papel aos demais; não generalizar política de NFS-e ou carteira.

| Entrada | Responsável/efeito atual | Controle e implicação futura |
| --- | --- | --- |
| GET `/fechamento/:pa/fs12` | `apuracaoV2.js:81`, composição → B1/read adapter | ACCOUNTANT, no-store, RepeatableRead; leitura não permite novo cálculo |
| GET `/fechamento/:pa` | `apuracaoV2.js:668`, getDadosFechamento | ACCOUNTANT; recupera resultado, não transmite |
| POST `/fechamento/:pa/conferencia` | `apuracaoV2.js:686`, ConferenciaAdnService | ACCOUNTANT; **consulta externa ADN** e grava conferência; não confunde com FS12 |
| POST `/fechamento/:pa/calcular` | `apuracaoV2.js:704`, FechamentoService.calcularFechamento:713 | ACCOUNTANT, lease; prepara/simula/grava snapshot e memória. Recebe série do corpo sem prova mensal B3 |
| POST `/fechamento/:pa/salvar` | `apuracaoV2.js:726`, salvarFechamento:953 | Token/contexto/CAS fechada; não é confirmação autenticada de cada mês de folha |
| POST `/fechamento/:pa/transmitir` | `apuracaoV2.js:747`, transmitirFechamento:1077 | Confirma competência/token, reserva/consulta índice/despacho; falta política temporal FS12 |
| POST `/fechamento/:pa/retificar` | `apuracaoV2.js:841`, mesma transmissão com retificar=true | Dupla confirmação; alteração de folha nunca autoriza chamar automaticamente |
| POST `/fechamento/:pa/reabrir` | `apuracaoV2.js:824`, reabrirFechamento:1220 | Transação/auditoria; não transmite por si |
| POST `/fechamento/:pa/conferir-transmissao` | `apuracaoV2.js:814`, conferirTransmissaoFechamento:1254 | Consulta índice; não libera repetição de resultado incerto nem prova retificadora por inferência |
| POST `/apurar-v2/:pa` | `apuracaoV2.js:872`, motor local | Não equivale à simulação oficial/prova mensal; fórmula intacta |
| POST `/apuracao/:pa/calcular` e `/revisar` | `notas.js:954/1006`, Apuracao legado | ACCOUNTANT; cálculo local/estado; não homologar pelo nome da ação |
| POST `/apuracao/:pa/transmitir` | `notas.js:974` | **410 desabilitada**, não é bypass HTTP ativo |
| GET `/operacoes/:pa/calculo/previa` e `/resultado`; POST `/calculo` | `operacoes.js:42–44`, OperationsCalculationService:87 | Ator/vínculo relidos, requestId/revisão; coleta NFS-e/RBT/simula. Formulário sem Fator R contém série vazia |
| PUT `/operacoes/:pa` | OperationsService:45, confirm/release/review/schedule | Serializable/lock/revisão/auditoria; confirmar/liberar **não transmite** |
| POST `/operacoes/:pa/executar` | OperationsExecution:57/115 | Reserva por releaseId; revalida acesso/contexto/procuração; declarado comprovado completa documentos sem retransmitir |
| POST `/firm/operacoes/lotes/previa` e `/aceitar` | OperationsBatchService:133/229/250 | Ator/dispatchGuard relidos; tarefa chama executarOperacao; política do lote moderno permanece distinta da legada |
| POST `/firm/apuracao/batch` | `index.js:5783/5800` | Admin/contador + idsDaCarteira; `Prefer: respond-async` pode iniciar execução |
| POST `/firm/apuracao/batch/:jobId/run-now` | `index.js:5857`, apuracaoBatchWorker:24/71 | Carteira/job/CAS por item; não relê ACL por item no worker: lacuna de legado, não corrigida aqui |
| `simplesColetaCalculoWorker` | CicloSimplesService:119/183 → prepararSimplesConsistente → Fechamento | Agenda/pausa/reserva/prova; preparo contém `folhasSalario:[]`; queda preserva INCERTO |
| `scripts/rodar-simulacao-pgdasd.js:43` | PgdasSimulacaoService direto | Fora da ACL HTTP e do caso de uso; futura proteção só em Fechamento é insuficiente |
| ApuracaoTransmissaoService:203 | Cliente SERPRO direto legado | Serviço vivo; nenhum caller ativo de transmissão encontrado além de import da rota410; não tratá-lo como liberado |
| gerar-payload-pgdasd / gerar-curls-trial | Constroem artefato | Não despacham por si. PeriodosRecusadosService:22 usa cliente LOCAL para assinatura, também não é envio |

Arquivos Operações: `apps/api/src/application/operacoes/`; roteadores: `apps/api/src/routes/firm/`; workers: `apps/api/src/workers/`. Scripts referidos estão em `apps/api/scripts/`.

Gargalo técnico: `PgdasSimulacaoService:260` → `SerproPgdasdService:89/118` → `SerproHttpClient /Declarar`. Não existe nele política temporal FS12. A matriz não autoriza executar esses caminhos com dados reais.

### Revisão, repetição e efeitos preservados

- Fechamento filtra folha por Fator R em `folhasSalarioSeAplicavel:579/800`, sem corte temporal. Recuperação pode ocorrer antes desse preparo (`:792`). Cálculo antigo recuperável não é prova da nova obrigação.
- CAS `transmitindo` e estado `erro_transmissao` impedem novo ato; declaração já encontrada sem retificação não retransmite (`:1135`). Ausência temporária no índice não comprova não aceite.
- Reserva SERPRO `reservada/incerta` prevalece sobre cache. Falha de persistência após efeito não autoriza repetir. Recusa conhecida de mês pertence à lista específica e à assinatura exata; não muda política de retentativa.
- Automático usa uma tentativa por revisão e preserva incerteza após queda; lote/manual mantêm requestId, releaseId, leases e reservas. O B3 não os redefine.
- A guarda do GET é no início. Revogação concorrente depois dessa guarda pode deixar a leitura em andamento concluir; o teste registra esse limite. **Não é guarda de despacho fiscal.** Próxima requisição é recusada.

## Contrato SERPRO e regras temporais

Fontes públicas reconferidas pelo revisor Fiscal em 16/11/2026, sem autenticação fiscal ou chamadas de serviço:

- [Entrada TRANSDECLARACAO11](https://apicenter.estaleiro.serpro.gov.br/documentacao/api-integra-contador/pt/solucoes/integra-sn/pgdasd/servicos/entregar_declaracao_mensal_entrada/): v1.0, folha obrigatória para PA >=202611; pa/valor numéricos; indicadorTransmissao separa intenções.
- [Mensagens](https://apicenter.estaleiro.serpro.gov.br/documentacao/api-integra-contador/pt/solucoes/integra-sn/pgdasd/mensagens/): MSG029 aproveita folha já transmitida e considera valor reenviado; MSG030 alerta efeitos em PAs posteriores; MSG045/047/071 coexistem.
- [Schema ligado pela documentação](https://apicenter.estaleiro.serpro.gov.br/documentacao/api-integra-contador/pt/solucoes/integra-sn/pgdasd/exemplos/schema.json): PascalCase, FolhasSalario array/null, sem minItems/condição temporal. Não resolve aceitação semântica de `[]`/omissão pós11/2026.
- [Changelog](https://apicenter.estaleiro.serpro.gov.br/documentacao/api-integra-contador/pt/solucoes/integra-sn/pgdasd/changelog/) e [Manual 2018–2026, 13/11/2026](https://www8.receita.fazenda.gov.br/SimplesNacional/Arquivos/manual/MANUAL_PGDAS-D_2018_V4.pdf), §§8.2–8.2.2: recorte11/12 e janela/início; manual2027 continua próprio.

| PA | Caracterização / decisão preservada | Antes de habilitar |
| --- | --- | --- |
| 10/2026 | Contrato histórico condicionado à atividade | Paridade sem migração retroativa |
| 11/2026 | B1 exige todas atividades; estabelecida11/2025–10/2026 | Série autenticada + seleção remota comprovável |
| 12/2026 | B1 exige todas atividades; estabelecida12/2025–11/2026 | Mesmas guardas; alteração de fonte não substitui declaração passada |
| 01/2027 | Homologação técnica pendente | Sem janela/payload ou CAIXA/COMPETENCIA inventados |

Até outubro o GET B2 não recebe classificação histórica e retorna pendência correspondente; isso não muda o contrato legado de cálculo. No primeiro PA de atividade B1 usa o mês corrente; meses seguintes desde abertura até anterior, limitados a12. Vigência parcial no mês (incluindo abertura no meio do mês) continua pendente no adaptador B2; não ampliar retroativamente o regime para obter janela.

| Série / histórico | Comportamento local atual | Prova ainda necessária |
| --- | --- | --- |
| Ausente ou vazia | Builder omite folhasSalario | Aceite de lista vazia/omissão quando histórico remoto completo |
| Zero explícito | Builder mantém0; B1 exige evidência/conferência | Origem mensal e seleção correta, não teste local apenas |
| Parcial/duplicada | Builder não garante completude; B1 recusa qualidade insuficiente | Vínculo da fonte, não podar silenciosamente |
| Série completa | B1 pode avaliar qualidade com fatos confiáveis; builder transforma números | Não reenviar integralmente por padrão, pois pode alterar informação histórica |
| PAs aceitos/recusados locais | Poda por memória/assinatura | Não equivalem a histórico declarado com valores/revisões |
| Fonte retificada | B1 identifica revisão divergente se receber fatos corretos | Nova conferência, impacto nos consumidores e revisão de seleção remota |

Nenhuma aceitação/recusa real pela Receita é alegada a partir dos doubles. Payload produtivo e algoritmos III/V, RBT12, precisão e opção2026 permanecem intactos.

## Proposta técnica para aprovação — ainda não implementada

### Persistência e autoria

Recomenda-se modelo dedicado em Fiscal, aditivo, sem backfill presumido:

1. **Evidência mensal imutável:** Company+mês+revisão; valorCentavos inteiro seguro não negativo; tipo/origem/referência verificável; hash/revisão da fonte; obtidoEm; conferidoPor da sessão e conferidoEm do servidor; motivo e revisão substituída. Zero é valor explícito; ausência não cria registro.
2. **Revisão vigente:** unicidade por empresa/mês e comparação da versão esperada. Criação da revisão, mudança de ponteiro e auditoria na mesma transação. Concorrência retorna conflito, sem sobrescrever silenciosamente. Leituras nunca conferem dados.
3. **Vínculo imutável de consumo:** calculoId+PA+versão da política, contexto de abertura/regime, IDs/revisões exatos da evidência, hash da série completa e seleção SERPRO com fundamento. Preserve todas as revisões já consumidas. O envelope de cálculo novo precisa versão própria; não reescrever token v1 nem snapshot transmitido.

O navegador solicita valor/referência e revisão esperada para concorrência; não fornece autor, instante, empresa alternativa ou estado CONFERIDA como prova. O servidor resolve PortalClient→Company após autorização atual, valida referência no mesmo escopo e produz a conferência. Declaração manual autenticada comprova **o que o contador declarou**, não validação automática de eSocial/Receita. Aprovar o alcance e os requisitos dessa origem antes da implementação. Documentos/DP permanecem integrações futuras.

Não armazenar conteúdo sensível em logs. Auditoria deve ter identidade/revisão/hash e motivo, com acesso restrito; fonte original segue custódia autorizada. Uma edição posterior cria revisão e pendência, não altera cálculo aprovado, não retifica e não transmite.

### Portas e composição propostas

Fiscal aplicação coordena operações específicas `registrarConferenciaMensal`, `lerSerieMensalVigente`, `prepararFs12Declaratoria` e `verificarVinculoFs12`. Nomes propostos, não APIs aprovadas. Domínio B1 permanece puro; Prisma e seleção do envelope ficam em adaptadores específicos. Não criar repositório genérico, barramento ou dependência da aplicação para Prisma/SDK.

Preparação compartilhada manual/automática valida janela e série completa. Seleção SERPRO é passo separado com histórico confiável: lista local completa não determina lista enviada. Confirmação/liberação e cada despacho/repetição permitida revalidam escopo, contexto, revisão e intenção. Não manter transação PostgreSQL aberta durante chamada externa. Associar reserva à prova exata e definir o ponto de invalidação antes do despacho; reserva incerta nunca expira só porque a folha mudou.

Aplicar proteção aos consumidores diretos e scripts, não apenas Fechamento. Leitura documental/conciliação de ato já confirmado permanece possível sem nova transmissão. Proposta conservadora para cálculo antigo11/12 sem prova B3: preservar consulta/histórico, exigir preparação/conferência explícita antes de **novo ato**; resultados incertos seguem conciliação. Essa política sensível precisa aprovação própria, não está ativa neste PR.

### Aprovações e incrementos seguintes

| Decisão requerida | Proposta / risco | Critério objetivo |
| --- | --- | --- |
| Fonte manual e comprovação | Declaração mensal autenticada com referência verificável; não promover memória/contabilidade | Definir referência mínima, permissões e alcance da conferência |
| Persistência/migração aditiva | Revisões, ponteiro vigente, auditoria e vínculo com cálculo | Aprovar desenho/schema futuro; PG16 rollback/CAS/isolamento antes da conexão |
| Cálculos antigos11/12 e revogação de fonte | Preservar histórico; novo ato exige prova atual, sem repetição incerta | Matriz explícita de calcular/salvar/confirmar/liberar/transmitir/retificar/conciliar |
| Seleção SERPRO | Separar cobertura e envio; histórico com revisão/valores confiáveis | Resolver caso lista vazia/todos meses já declarados e fonte do histórico; homologação só sob autorização específica |
| Início no meio do mês | Manter pendência atual até regra comprovada | Revisão Fiscal da vigência/abertura sem inventar cobertura |

Ordem proposta: B3.1 persistência/conferência após aprovação; B3.2 leitura de prova e vínculo versionado/guardas locais em todos caminhos; B3.3 seleção e adaptador após critérios fiscais aprovados; B3.4 ensaios ponta a ponta/homologação separadamente autorizada. Nenhum incremento começa automaticamente. 2027 continua fora da liberação.

## Caracterização executável e limites

`apps/api/src/routes/firm/__tests__/fs12B3.postgres.test.js` executa roteador, guarda canônica, composição, aplicação e adaptador reais. Apenas a sessão é sintética e o módulo Prisma encaminha ao PostgreSQL descartável; não simula autorização nem a resposta da consulta. Fixtures têm Company/PortalClient distintos e usuários/vínculos persistidos. Transporte SERPRO é bloqueado por double que lança erro.

Cobertura: quatro PAs; ausência de folha; namespace/empresa divergente; vínculo inativo/revogado/papel insuficiente;401/admin; Company ausente404; competência inválida400; vigência ausente/parcial/sobreposta; abertura; alteração cadastral concorrente entre os SELECTs por **segunda conexão real**; snapshot RepeatableRead antigo e próxima consulta nova; falha/ROLLBACK/503 saneado; ausência de DML pela consulta; fingerprint legado que não inclui histórico/abertura; revogação após ACL de entrada distinguida de autorização no despacho.

Os testes de domínio B1 cobrem zero comprovado, série completa/parcial/retificada e duplicidade com fatos sintéticos. Não comprovam a fonte mensal ainda inexistente. Os testes de caracterização de serviços observam o legado sem homologá-lo. Não há novo banco mensal a testar, pois não foi autorizado/implementado.

Ensaio local: cluster **novo** PostgreSQL16 em `.altan-governance/pgdata-b3`, bind127.0.0.1:55483, banco `altan_piloto_governance_test`, somente fixtures. Schema atual aplicado por `prisma db push --skip-generate` nesse banco vazio; isso não é teste do histórico de migrations. CI reaproveita PostgreSQL16 do piloto com migrations atuais, acrescentando somente execução dos novos testes após os gates existentes. Sem .env de produção. Psql local foi bloqueado pelo controle de aplicativos; a versão/consultas são verificadas pelo cliente Prisma já usado no projeto, sem alterar a política do Windows.

Reprodução em banco descartável já preparado: NODE_ENV=test, ALTAN_TESTE_POSTGRES=1, DATABASE_URL=ALTAN_GOVERNANCE_TEST_DATABASE_URL apontando exclusivamente ao banco loopback acima; `npm test -w @contabilidade/api -- --runInBand fs12B3`. Para regressão de ciclo, TEST_CICLO_PG_URL recebe o mesmo destino. Nunca executar com URL de cliente/produção.

Resultados locais: 41 novos testes B3 (29 de serviços com doubles +12 HTTP/PostgreSQL16) executados; regressão PostgreSQL focal40/5suítes; regressão API ampliada950/59suítes; web Apuração/Operações620/51suítes; governança88; analisador4; diagnose5023→5023, zero novas violações. Os grupos se sobrepõem, não somar como testes exclusivos. Sete skips na regressão ampliada: dois cenários da base vulnerável anterior ao #275 e cinco ensaios OperationsGuideResend vinculados a outro destino fixo; não se alterou o guard nem se iniciou cluster antigo. Novo B3 sem skips. Baseline B2 comparado ao squash da main sem diferenças produtivas; este PR também não altera fontes produtivas, portanto não há candidata fiscal distinta a homologar.

Uma primeira execução do teste PG usou o envelope de resposta errado na própria asserção; corrigido para `body.fs12` sem mudar HTTP. Invocação npm com regex no Windows foi substituída pela chamada direta do Jest, preservando a seleção. Resultados, pareceres e SHA/CI estão no registro da mudança e no PR. Teste não executado não é aprovação. Testes de protocolo novo, persistência de conferência e despacho atômico permanecem critérios futuros.

## Governança e rollback

Não houve alteração funcional: o controlador de executor funcional não foi iniciado, conforme o alcance “antes de alterações funcionais” dos AGENTS. O Principal executa governança/diagnose e revisões reais de Fiscal, segurança/backend, arquitetura e sistêmica. Não há `ready_for_human` emitido pelo controlador, e não se herda o estado de B2. A alteração de workflow é exclusiva do Principal, com revisão independente; não altera gates para aprovar a própria entrega.

Rollback deste PR: reverter apenas testes/documento/registro e o passo adicional da CI. Nenhum dado produtivo a desfazer. Futuro rollback de implementação deve suspender novos comandos e conservar leitura/revisões; não apagar evidências nem considerar revert de código como reversão de ato fiscal. Migração futura precisa plano aditivo e recuperação própria.

Merge, deploy, consultas/simulações/transmissões reais, retificação, limpeza, Railway e incrementos seguintes continuam sem autorização. Este PR é candidato à revisão da caracterização/proposta, **não liberação fiscal operacional**.
