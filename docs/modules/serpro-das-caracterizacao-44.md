# DAS via SERPRO — caracterização 4.4

Base: `ab28dad68a7bfe6b9991f2b7040458e5a020a352` (PR #276 integrado). Esta entrega caracteriza o legado com testes e documentação; não extrai escritas nem muda reservas, workers, contratos, regras fiscais ou repetição. Evidência de código não equivale à homologação do provedor. Nenhuma consulta fiscal ou mensagem real é necessária aos ensaios.

## Propriedade e significado das operações

Fiscal interpreta o serviço, o pedido e a resposta; Guias mantém identidade e evidência documental; Contabilidade controla provisões e vínculos; Operações coordena agenda e processamento; infraestrutura encapsula SERPRO, Prisma e armazenamento. A matriz abaixo descreve a localização atual, não transfere propriedade para o serviço que hoje concentra a coordenação.

Capturar pode significar **reutilizar um documento local**, **reprocessar uma resposta salva** ou chamar `/Emitir` para obter o DAS. `GERARDAS12` e `GERARDASCOBRANCA17` não são `TRANSDECLARACAO11`: emitir documento e transmitir declaração possuem efeitos distintos. Recálculo explícito invalida reutilização da resposta anterior e pode ter efeitos posteriores de auditoria, reabertura e comunicação; não deve ser tratado como simples consulta.

## Entradas e consumidores

| Arquivo / função ou rota | Entrada, autorização e efeitos atuais |
| --- | --- |
| `apps/api/src/routes/firm/index.js`, POST `/companies/:companyId/serpro/pgdasd/capture` | Guarda canônica `requireFirmCompanyAccess({minRole:'ACCOUNTANT'})`; `backgroundRoute('consulta-das')`; empresa dos parâmetros, competência, contratante e serviço do pedido. Contexto `firm_captura_das` com usuário. Retorna `{ok:true,result,emailDispatch:null}`; não envia automaticamente. Erros conhecidos de entrada/fiscais/configuração: 400; empresa inexistente: 404; demais: 502 com `retryable`. |
| Mesmo roteador, POST `/guides/:guideId/recalculate` | `authorizeGuideTask`, `getGuideWithFirmAccess`, PROCESSED e `canGuideRecalculate`. Seleciona cobrança se vencida, normal caso contrário; passa `existingGuideId`. Depois captura, `registrarRecalculoGuia`, `markGuideOpenBySerpro` e `runGuideEmailWorkerSelected`. Falha posterior não desfaz automaticamente documento anterior. Testes devem simular o envio. |
| `routes/client/index.js`, recálculo da guia | Escopo da empresa autenticada no portal e elegibilidade própria; contexto `cliente:recalcular`, `forcar:false`. Não importar a política global do escritório para essa entrada. |
| `application/guides/RecalcularGuiaWhatsappService.js` / `application/assistente/AcoesPendentesService.js` | Confirmação e autorização próprias, guia existente e serviço cobrança no caminho DAS. Comunicação posterior pertence ao consumidor, não à captura documental. |
| `application/fiscal/FiscalManualRunService.js`, `executeAction` / `handleSearchGuides` | Empresa, competência, ação `search_guides` e opções de contratante/serviço/usuário. Registra `FiscalExecutionLog` running → completed/failed e contadores; sem autoenvio. Não confundir completed com sucesso contábil integral. |
| `workers/serproPgdasdWorker.js`, `runSerproPgdasdWorkerOnce` | Lease, agenda salva, `CompanyRotina`, pausas, documento local, procuração/poder PGDAS. Captura faltante com `somenteDocumentos:true`; resultado e `SerproExecutionLog`. Retorno fiscal negativo conservado exige ação explícita; não é falha técnica. |
| `application/operacoes/OperationsDocuments.js`, `completarDocumentosOperacao` | Relê circular/DAS, recupera apenas faltantes, usa modo documental. Recusa de guarda encerra a tentativa composta; mensagens não afirmam resultado ausente quando há erro. |
| `application/fiscal/serpro/SerproPgdasDeclaracaoService.js` / `application/notas/apuracao/v2/FechamentoService.js` | Sincronização/fechamento podem chamar captura como etapa documental. A transmissão precedente tem contrato próprio; este incremento não altera esse fluxo nem seus estados. |

A correção de segurança #275 permanece intacta. O lote moderno `/guides/liberacao/lote` usa `empresasVisiveis`, com política global de admin/contador distinta das rotas antigas de liberação/revogação, que usam a guarda por empresa. Essa diferença é preexistente, não é autorização para expandir ou restringir permissões em 4.4.

## Matriz de efeitos e persistência

| Etapa / arquivo e função | Dados e efeito | Limite de consistência |
| --- | --- | --- |
| `CaptureSerproGuidesService.capturePgdasGuideForCompany` | Normaliza empresa/competência, lê `PortalClient`; parâmetros `existingGuideId`, `serviceId`, `dataConsolidacao`, `emailStatusOverride`, `atualizar`, `somenteDocumentos`. | A função não substitui a autorização do ponto de entrada. Não existe transação única que englobe todo o fluxo. |
| `reutilizarGuia` + `pgdasDocumentos.whereDasSalvo` | Mesmo tenant/competência, SIMPLES, PROCESSED, PDF não vazio, sem parcela e sem prefixo `PARC-`; **uploads também podem ser reutilizados**. Retorna `reutilizado:true`, `chamadaSerpro:false`. | Reutilização não verifica nova revisão externa nem executa nova provisão. A origem SERPRO não é obrigatória para DAS salvo. |
| `CaptureSerproGuidesService.resolvePgdasdServiceId` / `SerproPgdasdService.emitirDas` | Serviço explícito ou decisão legada pelo dia 20 do mês seguinte UTC; POST `/Emitir`, PGDASD, serviço normal/cobrança, CNPJ contratante/contribuinte e competência `YYYYMM`; consolidação opcional. | Preservar a decisão observada, sem tratá-la como nova validação tributária. `atualizar`, ID existente ou consolidação ativam atualização explícita no contexto. |
| `SerproHttpClient.request` / `SerproCallGuard` | Contexto/empresa → cache → reserva → autenticação → despacho → HTTP → cache → finalização. `SerproChamada`, `AppSetting serpro_dispatch:*`, custo/tentativa e origem/usuário. | Advisory lock global `73517001` coordena reserva/despacho, sem transação aberta durante HTTP. Ledger não comprova faturamento nem sucesso fiscal. |
| `SerproRespostaCache.lerResposta/guardarResposta` | Resposta documental HTTP 200 guardada por uma hora, assinatura canônica de rota/payload. Atualização explícita apaga a resposta anterior antes de nova tentativa. | Cache salvo precede finalização e interpretação do PDF. Falha ao guardar deixa reserva aberta. Não generalizar ao DAS as proteções específicas da simulação `TRANSDECLARACAO11`. |
| `CaptureSerproGuidesService.buildPgdasGuidePayload` | Extrai PDF, número, valor e vencimento; diferencia ausência de dívida, valor não devido, declaração ausente e PDF ausente. Valor pode ser lido do PDF como fallback. | Resposta HTTP válida pode falhar na interpretação. Não converte erro técnico em ausência de obrigação. |
| `GuideService.createOrUpdateGuideFromProcessing` / `atualizarGuiaComEvidencia` | `Guide`: empresa, competência, tipo, sourceFileId, hash SHA-256, bytes DATABASE, metadados, linha digitável e revisão. Identidade fonte inclui serviço/CNPJ/competência/número. | Verifica fechamento; gravação pode falhar depois do ato externo. Update faz até quatro CAS por updatedAt e preserva pagamento/comprovante; criação pode disputar unicidade. Não é upsert transacional da captura inteira. |
| Captura legada, `!somenteDocumentos` | Upsert separado de `CompanyMonthlyCircular`; composição principal/juros/multa best-effort; `generateEntriesFromCircular({fonteValor:FONTE_VALOR_GUIA})`. | Falha de provisão vira `accounting.ok:false`, preservando guia/circular já salvas. Hook genérico `GuideToProvisionService` pula SIMPLES; não é a fonte da provisão DAS. |
| `AccountingEntryGeneratorService` | Fonte GUIA recalculada sinaliza diferença mantendo principal/linhas existentes conforme regra legada; fonte EXTRATO possui semântica distinta. | Não alterar provisão ou presumir equivalência entre recálculo documental e retificação da declaração. |
| Final da captura legada | `guide.deleteMany` dos outros DAS SERPRO/PROCESSED da mesma empresa/competência, excluindo parcelas. | Operação separada, **sem filtro PAID**. Falha pode deixar duplicatas. Modo documental pula essa exclusão, o upsert da circular e a geração contábil explícita. Não inventar histórico documental completo onde ele não existe. |
| Consumidores de recálculo | Auditoria `registrarRecalculoGuia`, reabertura e eventual envio, conforme entrada. | Efeito posterior não participa da gravação da guia; resposta fiscal/local/comunicação podem divergir. |

## Dez cenários prioritários

| Cenário | Classificação e comportamento implementado |
| --- | --- |
| 1. Falha antes da chamada externa | **Bloquear.** Entrada inválida, empresa inexistente ou cache/medição indisponível impedem HTTP. Falha de autenticação após reserva produz `abortada_auth`; recusa de política no despacho pode produzir `abortada_politica`. Não equivale a aceite fiscal. |
| 2. Timeout sem confirmação de aceite | **Resultado não confirmado / bloquear repetição.** Finalização sem resposta marca `incerta`; assinatura reservada/incerta bloqueia inclusive forçar. Conciliação é necessária, mas não foi identificado endpoint de resolução manual dessas reservas. |
| 3. Resposta bem-sucedida e falha ao salvar PDF | **Reutilizar ou bloquear, conforme a fronteira.** Cache não salvo → `SERPRO_REGISTRO_INDETERMINADO` e reserva aberta. Cache salvo mas guia falha → captura não explícita pode reprocessar resposta durante sua validade. Atualização explícita invalida cache; não garante recuperação sem nova operação. |
| 4. Guia persistida e provisão falha | **Exigir revisão.** Guia/circular permanecem; `accounting.ok:false` informa falha. Não há rollback conjunto ou recuperação automática confirmada. A reutilização posterior retorna `accounting:{ok:true,generatedEntries:[]}` sem repetir a geração: esse envelope não prova provisão reconciliada. |
| 5. Repetição após reinício do worker | **Reutilizar ou bloquear.** Relê documentos e não captura DAS já disponível. Se faltar, cache e reserva controlam o próximo processamento. Não promete exatamente uma emissão externa. Negativa válida de declaração exige ação explícita, não retry automático. |
| 6. Solicitações simultâneas para empresa/competência | **Bloquear a assinatura em voo; conflitos locais continuam possíveis.** Lock/reserva impedem duas chamadas idênticas pendentes. Cache pode permitir processamento local concorrente; create pode disputar unicidade e update usa CAS limitado. Payload/serviço distinto não é a mesma assinatura. |
| 7. Documento existente com revisão diferente | **Reutilizar na captura normal; substituir no recálculo explícito.** Reutilização não procura versão externa. Atualização por ID/sourceFileId preserva pagamento/comprovante. Não importa para captura o token de revisão da correção de valor. |
| 8. Procuração revogada entre seleção e chamada | **Pode chegar à recusa externa; não há garantia de bloqueio local imediato.** Worker usa `checkCompanyProcuration({reutilizar:true})`; evidência ATIVA vigente do mesmo vínculo pode valer por 24h. Não foi identificada releitura da procuração no despacho. Captura direta não consulta procuração explicitamente; despacho revalida pausas/contexto/custo. |
| 9. Guia paga, reemitida ou substituída | **Depende da entrada.** Recálculo verifica elegibilidade; captura não contém toda essa política. Update preserva pagamento, mas consumidores podem reabrir após recálculo. Exclusão de duplicatas legada não filtra pagamento. Não extrapolar garantias de uma rota para todas. |
| 10. Resultado fiscal externo versus local | **Resultado não confirmado ou revisão, sem conciliador único.** Ledger ok significa HTTP conhecido, não guia/provisão concluídas. Cache salvo sem guia, guia sem provisão e timeout são estados distintos. Nenhum mecanismo novo de recuperação é criado por esta caracterização. |

## Testes e alcance da evidência

As suítes existentes `capturaDocumental`, `capturaReutilizacao`, `capturaDasNaoApagaParcela`, `pgdasDocumentos`, `pgdasSomenteDocumentos`, `respostasReutilizadas`, `serproReserva`, `serproCallGuard`, `serproHttpReserva`, `procurationPorCnpj`, `recalcularGuiaWhatsapp` e `recalculoDaGuia` compõem a regressão relevante. Os cenários novos em `dasCaracterizacao44`, `dasPersistencia44.postgres` e no worker fixam fronteiras antes de extrair qualquer escrita. Testes HTTP devem executar autorização e handlers reais, simulando as dependências externas e os efeitos posteriores.

SERPRO e comunicação usam doubles; PostgreSQL é descartável com dados sintéticos. Teste de reserva isolada não prova toda a captura; mock de procuração não prova revogação efetiva no provedor; leitura de código não é teste executado. Os resultados finais, comandos, falhas de preparação, pareceres e SHA da CI são registrados no PR e no registro de governança, sem antecipar aprovação.

O controlador `2026-11-14T14-27-29-588Z-2adc6a7a` terminou `escalated`; não se declara `ready_for_human`. Revisões independentes e execuções comprovadas são evidências alternativas e não autorização de merge ou produção.

## Incrementos posteriores propostos — não iniciados

1. Isolar a interpretação da resposta e a construção do pedido DAS por contratos fiscais específicos, mantendo normal/cobrança e ausência/erro distintos; paridade de payload, erros e metadados como critério.
2. Isolar a escrita documental de Guias, conservando sourceFileId/hash, bytes, CAS, pagamento e comportamento de duplicatas. Antes de alterar a sequência, testar criação concorrente e falha em cada persistência. Uma correção funcional de concorrência exige entrega própria.
3. Isolar a solicitação contábil e seu resultado parcial, preservando FONTE_VALOR_GUIA e modo documental. Só propor atomicidade ou reconciliação após decisão explícita; não esconder contabilização pendente.
4. Tratar recuperação após aceite externo e expiração de cache em entrega independente, com evidência de conciliação, autorização e política de repetição aprovada. Não presumir que retry é seguro ou que rollback local desfaz ato fiscal.

A caracterização pode ser revertida removendo seus testes/documentos, sem migração de dados ou alteração operacional. Cada extração posterior exige seu próprio PR, testes de paridade e autorização humana de integração. Nenhum merge, deploy, limpeza, transmissão fiscal, envio real ou reativação do Auto Deploy integra esta entrega.
