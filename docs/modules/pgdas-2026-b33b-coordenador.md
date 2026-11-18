# PGDAS-2026-B3.3b — preparação do coordenador e caracterização

Base inspecionada: `0aa2d2a0fa682f056ba3ced1457be4fd5825dfa4`, em 17/11/2026. [Coordenação informada pelo Principal](https://github.com/yagoS0/api-app-contabilidade/pull/298#issuecomment-6964807882). O executor recebeu o escopo delimitado; não consultou nem publicou comentários. Referência operacional integral fornecida no pedido, SHA256 conferido na fonte canônica: `4edbbc7134008570aa1152d34019c467afabd3aa6768dc89c80830ac166f6113`.

**Entrega documental e de caracterização; coordenador produtivo não implementado.** PA11/12 permanecem bloqueados por B3.2 e 2027 exige homologação própria. Nenhum código produtivo, payload, schema, migration, guarda, Fator R, III/V, CAIXA/COMPETENCIA ou runtime é alterado. Não há backfill, ativação, consulta real ou escrita contábil. Risco fiscal **high**. Aprovação deste desenho não libera despacho.

Leituras de referência: [B33 integral](pgdas-2026-b33-protocolo-fs12.md), [fontes B33](pgdas-2026-b33-fontes.md), [B33a integral](pgdas-2026-b33a-planejamento-remessa-fs12.md), [minuta não enviada](pgdas-2026-b33a-minuta-consulta.md), [B32](pgdas-2026-b32-vinculo-calculo.md), política de governança e arquitetura. As fontes externas são referências da caracterização anterior, não nova verificação fiscal nesta entrega. Regras R01/R02/R04–R06/R19/R20/R22 e seções36/37 preservadas; nenhuma decisão pendente de negócio é implementada.

## Observado na base: caminhos e donos

Caminhos abaixo são relativos a `apps/api/src`, exceto scripts e schema explicitamente indicados. O mapa distingue os produtores e efeitos existentes; não afirma que já exista uma transação abrangendo todos eles.

| Entrada/componente | Encadeamento e estado observado | Contrato a preservar / lacuna |
| --- | --- | --- |
| Manual, `routes/firm/apuracaoV2.js` | Calcular chama `calcularFechamento`; salvar recebe `calculoId`; transmitir e retificar chamam `transmitirFechamento` (retificar=true no último). Contextos SERPRO e autorização da rota são anteriores ao serviço. | Identidade e ator do servidor, confirmação explícita, anti-zero e revisão; dado de corpo não autoriza empresa. O cálculo manual mostrado na rota não repassa `userId` diretamente ao método calcular: não presumir autoria disponível no futuro comando FS12 sem composição explícita. |
| Operações, `application/operacoes/OperationsCalculationService.js` | Coleta/preparo e cálculo por dependências; guarda B32 antes do cálculo afetado; default chama Fechamento. | Manter seleção, NFS-e, completude, regime do período e revisão. Operações não seleciona folhas para o provedor. |
| `OperationsService.js` e `OperationsExecution.js` | Guarda B32 de comandos; executor usa `transmitirFechamento`, com provas e callback de revalidação. | Confirmar cálculo não equivale a liberar rotina; liberação/manual permanecem distintos, sem ampliar acesso. |
| Lote legado, `workers/apuracaoBatchWorker.js` | `runApuracaoBatchOnce(jobId)` escopa job; CAS pendente→processando; passa cálculo aprovado do resumo e `triggeredBy` a Fechamento. Rotas em `routes/firm/index.js` usam `idsDaCarteira`/`jobDaCarteira`; o worker não relê ator/vínculo por si. Falha vira erro, sem retry pelo item. | Não reiniciar loop autônomo nem transformar status ok/jaDeclarado em prova causal B32. A política de autorização não equivale à do lote moderno; preservar a diferença até investigação/autorização próprias. |
| Lote moderno, `application/operacoes/OperationsBatchService.js` | `accept` prepara itens e provas; `process` usa reserva e `dispatchGuard`, que revalida ator/escopo e condições antes do efeito. `conferirAtorOperacoes` participa da política deste caminho. | Não transportar a permissão do lote legado para este serviço. O futuro coordenador deve receber a identidade autorizada de cada entrada, sem ampliar ou restringir permissões incidentalmente. |
| Rotina, `application/notas/apuracao/v2/CicloSimplesService.js` | Dependência calcular chama Fechamento; guarda B32 e preparação automática coexistem com reservas e contexto de automação. | Pausas, agenda, seleção, tentativa única e liberação vigentes não podem ser substituídas por um journal FS12. |
| Scripts `apps/api/scripts/rodar-simulacao-pgdasd.js`, `gerar-payload-pgdasd.js`, `gerar-curls-trial.js` | Primeiro usa PgdasSimulacaoService; outros constroem payload local. | Script direto também encontra a guarda da fachada/HTTP. Construir assinatura/envelope não é autorização nem despacho; nenhum script foi executado aqui. |
| `application/notas/apuracao/v2/FechamentoService.js` | Calcular adquire lease, verifica contexto, simula, valida DAS, reconfere contexto/lease e cria `calculoId` via `criarVinculoCalculo` **depois** do retorno. Snapshot é create ou CAS por id/chave/estado. | Não há coordenador que grave resposta, snapshot e vínculo B32 atomicamente neste caminho. Memórias de períodos/configuração best-effort não são prova mensal oficial. |
| Fechamento: salvar/transmitir | Salvar exige cálculo/formulário/contexto e uso B32, mas guarda ainda bloqueia PA11/12; transmitir reserva snapshot por CAS, consulta índice antes de novo despacho e guarda antes de `sim.transmitir`. | Não mover guarda para impedir recuperação documental indiscriminadamente. Consulta pode reconhecer declaração externa e sincronizar documentos sem provar vínculo causal com cálculo local. |
| Fechamento: reabrir/conferir | Reabertura de transmitida usa transação, CAS, nova chave `reaberta:UUID` e auditoria com snapshot anterior. Resposta expõe chave null; banco recebe nova chave. Conferência de resultado incerto não confirma retificação por índice quando há número prévio/flag retificar. | Reabertura local não retifica na Receita, nem reatribui vínculo. O comentário interno que permite transmitida em retificar não supera a validação de entrada que exige calculada/fechada. Preservar histórico e fluxo de novo cálculo. |
| `application/fiscal/serpro/PgdasSimulacaoService.js` | `simular` e `transmitir` guardam PA antes do builder/adaptador. Builder/parse permanecem locais. | Parser e número declaratório não autenticam origem nem correlacionam tentativa. Simulação não é declaração. |
| `SerproPgdasdService.js` | Forma envelope TRANSDECLARACAO11, usa client.post; índice usa CONSDECLARACAO13. | Um client falso pode construir envelope sem rede. Cliente concreto mantém a barreira final. |
| `SerproHttpClient.js` | Guarda FS12 → contexto/contribuinte → cache → reserva → auth → autorização despacho → HTTP → cache → conclusão ledger. | Reserva/conclusão técnicas não substituem autorização de negócio ou prova causal FS12. HTTP acontece depois do fechamento da transação do guard. |
| `SerproCallGuard.js` | Reserva em ReadCommitted com advisory lock global; política empresarial e marcador `serpro_dispatch:<reservaId>` no despacho. `reservada`/`incerta` bloqueiam assinatura inclusive forçar. | Não conhece revisão FS12 ou cálculo. `identificarChamada` lê periodoApuracao/competencia/anoMesParcela, **não pa**; envelope TRANSDECLARACAO11 com apenas pa fica com competência null no ledger. `acaoId` é correlação, não unicidade de negócio. |
| `modules/fiscal/application/vincularFs12AoCalculo.js` | Preparo lê autorização/contexto/última revisão; vínculo compara revisão esperada, contexto e cálculo confirmado; histórico não exige snapshot atual; uso exige ambos atuais. | Preparo não reserva tentativa e não retorna autorização fiscal. Leitura antiga entre duas chamadas não é transação durável. |
| `registrarFatoCalculoFs12.js` e `composition/fs12DoCalculo.js` | Fato exige vínculo e prova correlacionada lida por porta confiável; produtor padrão retorna null. Fato confirmado exige procedência oficial/número; não usa número anterior do snapshot. | Não é possível registrar primeira tentativa pré-cálculo nesse modelo sem vínculo. Não fabricar cálculo/fato para preencher FK. |
| `modules/fiscal/infrastructure/prisma/fs12DoCalculo.js` | Escrita própria Serializable; tx injetado deve comprovar Serializable. Lock de snapshot, leitura/validação e vínculo no mesmo cliente; conflito sem retry. Leituras próprias RepeatableRead. | Pode participar do coordenador futuro, mas sua existência não comprova transação conjunta no Fechamento. |

`SerproRespostaCache` aceita simulação explicitamente false e serviços documentais permitidos; transmissão não é cacheável. Leitura de simulação recusa reserva pendente; resultado conhecido cujo cache expirou exige conferência. No HttpClient, falha de guardar resposta deixa reserva aberta; falha ao concluir não finaliza novamente. Isso não garante armazenamento durável da resposta de transmissão: `guardarResposta` é no-op para ela. No ramo raw de erro com response, finaliza ledger e retorna resposta sem passar pela gravação de cache. Ambos são lacunas relevantes para custódia causal futura.

## Proposta para aprovação: identidade anterior ao cálculo

Não há API/classe/coordenador fake neste incremento. Os nomes de campos abaixo são **contrato candidato**, não novas colunas ou endpoints existentes.

| Identidade candidata | Conteúdo e invariantes |
| --- | --- |
| Comando durável | ID gerado no servidor, chave de idempotência escopada por PortalClient/Company/PA/operação e hash de intenção normalizada. Replay igual retorna o registro; mesma chave com intenção diferente recusa. Não usar valor FS12, CNPJ isolado ou id de sessão como identidade. |
| Revisão/contexto | Referência imutável à confirmação MANUAL_APURACAO, revisão/serieHash/contextoHash/política B1, Company resolvida a partir de PortalClient e regime/abertura comprovados no PA. Referência vigente lida independentemente sob transação; nunca cópia do corpo. |
| Tentativa pré-cálculo | ID distinto do comando e de `calculoId`, ligado à reserva operacional existente e à reserva SERPRO quando houver despacho. Propagar `acaoId` para rastreio não cria prova por si. Incluir intenção SIMULAR versus TRANSMITIR/RETIFICAR, assinatura canônica e referência do envelope exato. |
| Seleção B33a | Plano identificado/hash/versionado, mantendo série local e seleção separadas. Na versão atual, sempre `mesesPropostos:null` e `autorizaEfeitoFiscal:false`, inclusive com história completa. Null interrompe antes de reservar efeito externo; não converter em []/omissão ou enviar série inteira. |
| Cálculo resultante | Só nasce após resposta válida de simulação correlacionada. Conservar envelope e retorno exatos, contexto/receitas/FS12 e origem do resultado. Cálculo não é tentativa nem declaração; não inventar `calculoId` confirmado antecipado. |
| Vínculo B32 | Liga cálculo exato à revisão; imutável. Atualização do snapshot não reatribui vínculo histórico. Não backfill por número, total ou PDF. |
| Conferência/liberação | Autor, instante e versão exata do cálculo/base. Conferência e liberação de rotina são comandos distintos; nenhum é deduzido de simulação, leitura ou configuração ligada. |
| Transmissão/resposta | Nova tentativa vinculada ao cálculo/vínculo/conferência vigentes e intenção explícita, com reserva, assinatura, provedor/operação e evidência recebida pelo adaptador confiável. Retificação preserva declaração anterior e não usa seu número como resultado. |

A revisão confirmada de FS12 é necessária, mas não suficiente. `planejarRemessaFs12` não autentica fatos recebidos. Continuidade após protocolo aprovado exigirá validar proveniência mensal real e vigência declaratória; não há leitor oficial produtivo suficiente nesta base. As lacunas de vazio/omissão, reenvio, primeiro PA, abertura parcial e 2027 da minuta B33a continuam pendentes.

## Proposta: transações curtas, sem rede

1. **Preparo local (T1):** autenticar/autorizar ator e empresa; reler mapeamento Company, contexto, revisão vigente, estado/reserva existente e intenção. Validar idempotência e plano B33a. Persistir identidade local somente quando o contrato correspondente estiver aprovado. Hoje seleção null encerra com impedimento e zero despacho; nenhuma tentativa fiscal deve ser fabricada. No futuro, reservar execução por CAS sob locks em ordem definida, sem chamar provedor/cache remoto dentro da transação.
2. **Autorização de despacho (T2):** transação curta repete autorização atual, versão/base/FS12/Company, pausas, elegibilidade, reserva e intenção. Adota a reserva/marcador SERPRO existentes, sem duplicar orçamento ou criar nova máquina de estados. Exigir predicado de versão e unicidade para manual/Operações/lote/rotina disputarem o mesmo item. A ligação T1→reserva SERPRO ainda precisa ser implementada e provada; chamadas sequenciais atuais não são atomicidade conjunta.
3. **Rede fora de T1/T2:** transmitir exatamente o envelope autorizado uma vez, sem alterá-lo depois de assinado. Marcação de despacho é o ponto local de linearização: mudança anterior recusa; mudança posterior não desfaz chamada em voo. Crash após marca e antes da rede é conservadoramente indeterminado, não expira para retry. Não prometer transação distribuída ou ausência absoluta de corrida entre commit e socket.
4. **Custódia e promoção separadas (T3a/T3b, proposta):** T3a persiste idempotentemente a resposta com tentativa, reserva, assinatura, empresa, PA, operação, modo simulação/transmissão, instante e referência/hash do conteúdo. Seu commit deve anteceder T3b. T3b relê autorização/contexto/revisão e CAS; somente simulação ainda válida pode gravar snapshot exato + vínculo B32 no **mesmo tx Serializable**. Falha em T3b desfaz a promoção conjunta, mas não apaga a evidência já custodiada em T3a. Resposta tardia/obsoleta permanece histórica, sem promover outra revisão a calculada/conferida/transmitida. Falha em T3a mantém resultado incerto, sem fingir custódia recuperável ou repetir rede. A identidade interna restrita para custodiar ato ocorrido mesmo após revogação do usuário exige contrato de segurança aprovado; não concede novo ato fiscal ao usuário. Nenhuma dessas transações novas foi implementada.
5. **Falha após rede:** timeout, crash ou falha de persistência não autorizam segunda rede. Reserva/estado incerto existentes continuam fonte operacional. Se resposta não foi custodiada, tratá-la como desconhecida; não reconstruir por total ou declaração anterior. Conciliação explícita pode anexar prova causal verdadeira; se não houver, permanece desconhecida. Retry de transação local deve ser separado de rede; recomendação inicial é devolver conflito sem retry automático, como B32.

Troca de FS12 durante auth deve impedir despacho se anterior a T2; durante rede deve impedir promoção do resultado se anterior a T3. Dois processos não podem vencer o mesmo CAS. Deadlock/P2034/P2002 não autorizam repetir serviço externo. Definir ordem de locks com os donos antes da integração, incluindo locks do ciclo, empresa, snapshot e confirmação FS12: isolamento Serializable sozinho não prova ausência de deadlock nem coordenação com escritores legados.

O escritor `confirmarFs12DaApuracao` deve participar expressamente da mesma linearização de T2, por mecanismo compartilhado e escopado aprovado no próximo incremento. Ler a última revisão sob Serializable ou manter FOR SHARE na empresa não exclui uma nova confirmação append-only após o commit. A ordem definida decide se a revisão mudou antes do despacho; mudança posterior não cancela retroativamente a rede, mas impede promoção incompatível em T3b. Essa participação do escritor é requisito futuro, não garantia já oferecida por B31/B32.

## Prova causal e leituras independentes

Prova candidata exige cadeia persistida servidor→comando→tentativa→reserva/marcador→assinatura/envelope→resposta observada→cálculo/vínculo→conferência→tentativa de transmissão→resposta declaratória. O adaptador confiável lê a cadeia, não aceita `proveniencia` alegada pelo navegador. SHA identifica conteúdo, não autentica o provedor. Serviço de simulação com indicador false jamais produz fato RESULTADO_CONFIRMADO declaratório apenas por trazer número. HTTP200 pode conter recusa/forma incompleta e não basta.

Consultas históricas autorizadas, consulta documental e recuperação local permanecem independentes da permissão para novo ato. `consultarVinculoFs12DoCalculo` reconfere acesso e Company atual, mas lê vínculo histórico sem requerer revisão vigente. Remapeamento de Company não deve tornar histórico de outra entidade acessível por ID fornecido. Consulta remota continua sujeita a custo, procuração, pausas e guardas próprias; independência de FS12 não é acesso irrestrito. `syncPgdasByCompetencia`/sincronização pós-transmissão podem escrever documentos, circular e provisões: não reutilizar como leitor puro. Leitura de tela/histórico não deve iniciar simulação, transmissão ou conciliação gravadora.

## Necessidade de schema: análise, sem implementação

`ApuracaoFs12Calculo` tem calculoId único e FK composta para revisão. `ApuracaoFs12CalculoFato` exige vinculoId, unicidades vínculo/chave e vínculo/tentativa/tipo. Portanto a tentativa anterior ao cálculo não cabe nesse journal sem distorcer seu contrato. `SerproChamada` registra acaoId, assinatura, PortalClient, resultado técnico; não registra vínculo FS12, Company/revisão e competência pa de forma suficiente. Snapshot é mutável; JSON de memória e marcador AppSetting não oferecem isoladamente FK/uniqueness tipadas para toda a cadeia.

Alternativas candidatas:

- Reaproveitar identidade/reserva operacional existente e acrescentar referência imutável ao contexto/intenção/resultado. Menor duplicação; exige provar cobertura uniforme dos caminhos manual, rotina, lote e scripts, unicidade e custódia antes/depois da rede. Não assumir que ManualTask, lease ou acaoId sejam equivalentes.
- Adição mínima de registro de correlação pré-cálculo com comando/idempotência/escopo/revisão/assinatura e referências à reserva operacional e evidências. Resultado pode referenciar cálculo posteriormente por associação imutável. A tabela seria evidência, **sem enum concorrente de estado operacional**. FKs/índices/constraints exatos, retenção e política de vínculo após falha precisam de desenho e aprovação.

Recomendação: decidir a identidade operacional reutilizável antes de redigir migration; se não comportar a correlação durável, submeter a segunda alternativa em incremento próprio. Não tornar `vinculoId` opcional em B32 só para alojar tentativa nem alterar fatos antigos. Migração futura apenas aditiva, em PostgreSQL16 descartável, sem backfill. Nenhum SQL/schema foi criado nesta entrega.

## Caracterização e limites de validação

Arquivo focal: `apps/api/src/application/fiscal/serpro/__tests__/fs12B33bCoordenador.test.js`. Executa implementações reais de HttpClient/CallGuard, portas B32 e planejador B33a. Axios, autenticação, Prisma, cache e políticas adjacentes são doubles. O ledger é apenas modelo das chamadas/CAS, sem rollback ou concorrência SQL; testes não aprovam autorização real, isolamento PostgreSQL, protocolo fiscal ou coordenador integrado. Não há ensaios executáveis de contrato proposto apresentados como produção.

| Cobertura focal | Evidência pretendida |
| --- | --- |
| PA11/12 e2027, ambos indicadores | Guarda real antes de cache/reserva/auth/rede |
| PA10 e acaoId | Reserva/despacho/HTTP fora da transação do double; lacuna pa/FS12/calculoId observável |
| Falha de reserva/auth/cache/ledger/timeout | Bloqueio, abortada_auth, reserva/incerta preservadas, zero repetição HTTP inclusive forçar |
| Reuso da reserva | Marcador impede segundo despacho |
| Índice PA11 | Guarda FS12 não impede leitura; reserva/HTTP técnicos ainda exigidos |
| Revisão entre preparo/vínculo | Preparo sem calculoId só lê; revisão substituída recusa nova escrita |
| Snapshot substituído/Company/PA/revogação | Uso recusado, histórico autorizado preservado e isolado. **Não executa a reabertura real**, coberta pela regressão existente |
| B33a atualidade | Null não vira lista; referência vigente alterada impede análise |

Reutilizar regressões existentes, sem duplicar fixtures de banco:

- B1/B31: `modules/fiscal/domain/__tests__/{politicaDeclaratoriaFs12,serieManualFs12,guardaPgdasFs12}.test.js`, aplicações de confirmação/consulta e HTTP/PostgreSQL B31.
- B32: `modules/fiscal/application/__tests__/{vincularFs12AoCalculo,registrarFatoCalculoFs12}.test.js`, `modules/fiscal/infrastructure/prisma/__tests__/fs12DoCalculo.postgres.test.js`, `routes/firm/__tests__/fs12B32.{http,postgres}.test.js`. Duas conexões, rollback, tx injetado e autorização pertencem aos testes de PostgreSQL existentes; não declarar o double substituto deles.
- Fechamento/ciclo: `application/notas/apuracao/v2/__tests__/fs12B3Contratos.test.js` e `application/notas/apuracao/v2/__tests__/procedenciaDas.test.js` (reabertura, auditoria, conflito e retificadora incerta); lote e Operações mantêm testes específicos.
- Transporte: `fs12B32Transporte.test.js`, `fs12B33Contrato.test.js`, `serproReserva.test.js`, `serproHttpReserva.test.js`; seleção: `modules/fiscal/domain/__tests__/planejarRemessaFs12.test.js`.

Comando focal: `npm test --workspace=@contabilidade/api -- --runInBand --runTestsByPath src/application/fiscal/serpro/__tests__/fs12B33bCoordenador.test.js`. Executar regressões pelo catálogo do Principal. PostgreSQL somente com destino descartável validado pelas suítes (`ALTAN_TESTE_POSTGRES`, NODE_ENV=test e URLs loopback próprias); não apontar variáveis para ambiente real, nem executar scripts de limpeza neste escopo.

O executor do controlador encontrou EPERM/lstat em `C:\Users\yagoa` antes de executar o plano e Jest. Esse resultado não foi convertido em aprovação. O Principal executou as validações com suas permissões existentes, sem alterar gates ou permissões dos agentes. A primeira invocação das regressões pelo Principal partiu da raiz incorreta e não encontrou testes; a execução corrigida usou `apps/api`, sem relaxar a descoberta de testes.

### Resultados executados pelo Principal

| Evidência privada na worktree | Resultado |
| --- | --- |
| `.altan-governance/b33b-regression.json` | 32 suítes, 524 aprovados; inclui B1–B33a, HTTP e 43 PostgreSQL16 |
| `.altan-governance/b33b-operations.json` | 8 suítes, 119 aprovados; inclui 19 PostgreSQL16 de Operações/lotes |
| `.altan-governance/b33b-cache-tasks.json` | 2 suítes, 37 aprovados de cache real e tarefas de apuração |
| `.altan-governance/b33b-procedencia.json` | 1 suíte, 39 aprovados de procedência, reabertura e retificadora incerta |
| `.altan-governance/b33b-focal-final.json` | 1 suíte, 15 novos aprovados, após ajustes do executor |
| Governança e arquitetura | 88 testes da governança e 5 do verificador aprovados; diagnose sem novas violações |

Total: **734 testes em 44 suítes**, zero falhas/ignorados nas execuções finais, incluindo **62 PostgreSQL16**. Banco exclusivo `altan_piloto_governance_test`, loopback porta55488, somente fixtures sintéticas e migrations existentes. Nenhuma migration nova. O código produtivo candidato é idêntico à base Git: a caracterização executa exatamente as mesmas implementações, sem extração a comparar. Logs brutos permanecem privados; CI hospedada deve ser conferida no SHA do PR, não inferida dos testes locais.

O controlador `2026-11-18T00-24-27-884Z-92a22f0a` concluiu planejamento, executor e gate de governança. O Principal interrompeu a rodada durante regressão API para incorporar os achados independentes sobre lotes, custódia e linearização. Estado bruto `testing`, logs/journal preservados; **sem ready_for_human**. As revisões e evidências finais são complementares e não reclassificam essa execução. UI/UX não se aplica a este diff exclusivamente documental/testes, apesar do alcance conservador do mapa transitivo.

### Matriz de falhas: prova atual versus requisito futuro

| Cenário | Prova atual nesta entrega | Requisito ainda não implementado |
| --- | --- | --- |
| FS12 alterada após preparo | Focal/B32 recusam vínculo/revisão obsoleta; PG preserva histórico | Ordenar todos os escritores e T2 por coordenação compartilhada |
| Mudança durante reserva/auth ou imediatamente antes da rede | Guarda de transporte, reserva e callbacks caracterizados; não há guarda integrada de revisão FS12 nesse intervalo | Testar os dois lados da linearização com duas conexões e transporte suspenso |
| FS12 muda durante rede/antes da promoção | B32 recusa uso obsoleto; não há coordenador integrado | Custodiar T3a e recusar T3b sem apagar resposta |
| Recálculo/reabertura/retificação | Regressões de recuperação, procedência, vínculo histórico e retificadora incerta | Não associar resposta tardia à revisão ou cálculo novo |
| Falha após reserva, antes do despacho | Reserva/marcador impedem segundo despacho; auth abortada distinguida | Crash após marcador continua incerto, sem expiração/retry automático |
| Timeout/resposta perdida | HttpClient/guard mantêm incerta e bloqueiam repetição | Conciliação causal explícita; ausência de prova não libera tentativa |
| Resposta recebida, cache/ledger falham | Focal comprova reserva aberta, sem segunda chamada | Custódia durável de transmissão não existe; T3a depende de aprovação |
| Commit/rollback do cálculo e vínculo | PG B32 prova mesmo tx, rollback, duas conexões e imutabilidade | Integrar produtor Fechamento e T3b; testes atuais não o fazem |
| Empresa/PA divergentes, acesso revogado | HTTP/PG e B32 validam escopo e autorização; histórico não atravessa Company | Correlacionar também o corpo oficial à tentativa; não confiar em envelope alegado |
| Scripts, lote legado/moderno e automático | Guardas B32, tarefas, lotes e tentativa única exercitados com doubles | Adaptação uniforme sem conceder identidade de serviço implícita |
| Cache de simulação recuperado | Cache real e guardas testados, simulação distinta de transmissão | Preservar referência da tentativa original; não atribuir cache a tentativa nova |

Os cenários futuros acima são critérios de aceite bloqueantes para implementação/liberação posterior, não testes aprovados de um coordenador inexistente.

## Menor plano incremental e decisão humana

1. Revisar este mapa/lacunas e escolher identidade durável/reserva reutilizada, ordem de locks e custódia após revogação. Principal conduz revisão Fiscal, backend/dados/segurança e sistêmica; executor não se aprova.
2. Aprovar separadamente eventual adição mínima de persistência pré-cálculo. Implementar apenas registro local/replay/CAS/custódia com doubles e duas conexões PostgreSQL16 descartável, **com todas as guardas fiscais ainda ligadas**. Provar rollback snapshot+vínculo, revogação/remapeamento, crash antes/depois da marca, retorno tardio, conflito e restart sem retry externo.
3. Resolver/homologar seleção B33a e fonte oficial mensal, incluindo vazio/omissão/reenvio/abertura parcial; obter contrato de correlação do provedor. Sem isso não integrar despacho. Escolha de schema não supre homologação fiscal.
4. Só após aprovação específica, integrar um caminho e adaptar demais entradas ao mesmo contrato, com paridade PA10 e matriz manual/Operações/lote/rotina/script/transporte. Nenhuma liberação parcial de guarda em um caminho. 2027 continua incremento independente. Produção, ativação e atos fiscais requerem autorização própria.

Critérios ainda sem prova integrada: retorno oficial correlacionado à tentativa pré-cálculo, persistência conjunta Fechamento/B32, nova revisão durante rede, colisão entre entradas, perda de resposta e conciliação sem causalidade inventada. Documento não resolve essas lacunas por enum, mock ou aprovação genérica.

## Compatibilidade e rollback

Fiscal é dono do comando, revisão/cálculo e interpretação; API/infraestrutura são donas das reservas técnicas e transporte. Operações consome estados e solicita comandos, Documentação registra limites. Domínios requeridos: fiscal/api/documentation diretamente; operations consumidor mapeado; accounting/guides preservados (nenhuma provisão, guia, envio ou baixa alterada); commercial/communication/portal/web sem mudança de contrato, rota, dado, mensagem ou UI. FS12 permanece somente na Apuração, sem DP/Drive/eSocial. Não há layout para validação desktop/celular nesta entrega.

Rollback: remover/reverter somente este documento e o teste focal em revisão futura, sem tocar em dados, histórico, migrations ou bloqueios. Registro de governança, revisão independente e entrega são responsabilidade do Principal, fora dos dois caminhos atribuídos ao executor. Na execução do executor não houve commit, push ou PR. A publicação do PR em rascunho cabe ao Principal; merge e deploy permanecem não autorizados.
