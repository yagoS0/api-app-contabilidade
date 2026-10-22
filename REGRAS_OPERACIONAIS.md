# Regras operacionais do Altan

Versão 0.4 — 16/10/2026. Base inspecionada inicial: `eee63f21` (`origin/main` local). Decisões posteriores nas seções 21 e 22.

## Consulta obrigatória em qualquer alteração

**Regra aprovada pelo usuário em 16/10/2026:** este documento deve ser consultado antes de qualquer alteração no Altan, incluindo código, interface, testes, configurações, scripts, documentação, dados e migrações. Registrar as regras afetadas ou declarar ausência de impacto operacional. Atualizar regras e cenários junto da implementação quando necessário. Não implementar comportamento dependente de uma decisão pendente sem validação do usuário. A consulta não exige pedir autorização para toda alteração: diagnóstico e trabalho independente continuam autorizados.

A instrução consta no `AGENTS.md` deste repositório e no `AGENTS.md` da raiz do workspace ALTAN, que aponta para esta referência. Worktrees fora desse workspace precisam receber a instrução em seu próprio repositório. Os arquivos ainda são locais; a abrangência para clones futuros depende de integrar esta documentação à branch compartilhada.

Este documento é a referência para desenvolvimento e testes da operação. Não certifica conformidade tributária nem afirma que todas as regras abaixo já estejam implementadas. As regras fiscais específicas precisam de fonte e vigência antes de virarem automação.

**Como ler:** “Existente” descreve código inspecionado; “Contrato” define o comportamento solicitado para as próximas entregas; “Validar” identifica decisão ainda não confirmada pelo negócio. Alterações futuras devem registrar data, regra afetada, motivo e cenários de teste. Não transformar uma hipótese em regra aprovada.

## 1. Identidade e fonte dos estados

**Contrato R01.** Toda situação operacional deve identificar empresa, competência, obrigação e, quando necessário, estabelecimento, acordo/parcela e revisão do documento. Competência de apuração e mês de vencimento são recortes diferentes e devem aparecer explicitamente na interface.

A fonte de verdade é a evidência persistida no domínio responsável. Uma projeção comum reúne essas evidências para Empresas, Guias, Apurações, Rotinas, Obrigações e Operações. Isso não exige substituir todos os domínios por uma tabela de status.

Cada item deve informar separadamente:

| Dimensão | Valores conceituais e significado |
| --- | --- |
| Aplicabilidade | Exigível, não aplicável, dispensada com evidência, a verificar por dados insuficientes |
| Apuração | Não iniciada, em processamento, calculada, em revisão, transmitida, erro |
| Documento | Não esperado, faltante, em processamento, disponível e válido, inválido, substituído |
| Comunicação | Não exigida, pendente, em processamento, enviada, falhou, resultado incerto |
| Pagamento | Não confirmado, informado/em conferência, confirmado, estornado |
| Execução | Manual, automática ou realizada externamente com evidência |
| Tratamento | Normal, débito automático ou exceção identificada |

Esses valores são um contrato conceitual, não novos enums já gravados no banco. A migração deve mapear os estados existentes sem perder informações.

**R02.** Informação ausente ou leitura com erro significa “a verificar/indisponível”. Não significa zero, ausência de obrigação, conclusão ou pagamento.

## 2. Competência aberta, fechada e reaberta

**Existente:** há estados diferentes que não podem ser tratados como sinônimos:

| Domínio | Fonte atual | Comportamento encontrado |
| --- | --- | --- |
| Conferência fiscal | `CompanyMonthlyCircular.estado`, `CompetenciaStateMachine.js` | Aberto → em conferência → fechado → calculado → revisado → transmitido → confirmado. Reabertura explícita retorna a `em_conferencia`. Há transições de erro e recuperação. |
| Apuração | `ApuracaoSnapshot`, `FechamentoService.js` | Reabertura aceita snapshot `transmitida`, persiste `aberta` e troca a chave de idempotência. O comentário do método ainda diz `calculada`; não corresponde ao código. |
| Fechamento contábil | Campos de fechamento da circular e `accountingEntries.js` | Possui rota própria de fechar/reabrir, independente da transmissão fiscal. |
| Liberação de operações | `AppSetting`, `OperationsService.js` | Confirmação, liberação e execução têm revisão/fingerprint próprios. Mudança de dados pode invalidar a liberação. |

**Contrato R03.** “Aberta” permite trabalhar no domínio indicado, respeitando suas travas. “Fechada” significa que aquele domínio foi encerrado sobre uma versão dos dados. Não comprova que todos os demais domínios foram concluídos.

**R04.** “Reaberta” é um evento auditável: informar domínio, empresa, competência, motivo, autor, momento e versão anterior. Preservar documentos, recibos, envios e pagamentos históricos. Reabrir localmente não retifica declaração no órgão fiscal.

**R05.** Reabertura deve validar permissão e versão no servidor, persistir antes do sucesso visual e atualizar todas as projeções dependentes. Duplo clique, recarga e repetição da requisição não podem duplicar efeitos. Uma resposta tardia da versão anterior não pode concluir a nova revisão.

**R06.** Reabrir não autoriza automaticamente novo cálculo, transmissão, cobrança ou envio. Intenções pendentes ligadas à versão anterior precisam ser conferidas; resultado externo incerto exige conciliação antes de repetir.

**Validar V01:** identificar qual ação/tela apresenta a falha relatada e reproduzir com competência, estado anterior, resposta HTTP e recarga. As reaberturas existentes não provam que o fluxo visual funciona.

## 3. Quando uma obrigação é exigível

**Contrato R07.** Exigibilidade resulta da regra aplicável à empresa e ao período: regime vigente, atividade, localização quando pertinente, folha/pró-labore, periodicidade, vigência e exceções comprovadas. O cadastro atual não deve reescrever automaticamente competências históricas.

Obrigação declaratória pode existir sem valor a recolher. Obrigação exigível não implica necessariamente guia de pagamento. Cadastro incompleto deve produzir necessidade de conferência, sem inventar guia ou dispensar obrigação.

**Existente:** `RegrasObrigacaoService` aplica regras por escopo, regime e folha; `Obrigacao` e `OcorrenciaObrigacao` representam cadastro e ocorrências. `guideCompliance.js` possui outro cálculo de exigência: Simples para DAS, pró-labore para INSS e grupos de tributos para Presumido/Real.

**Lacuna:** o cálculo de guias agrupa Lucro Real com Lucro Presumido e contém a simplificação de ISS esperado para todo presumido. Isso é comportamento técnico encontrado, não regra tributária validada. Unificar a avaliação exige revisar essas condições, a periodicidade e o histórico do regime.

**Validar V02:** matriz de obrigações e guias por regime/atividade, regras municipais, períodos mensais/trimestrais, vigência e exceções. Registrar fonte normativa e responsável pela validação quando essa matriz for elaborada.

## 4. Guia esperada e progresso quantitativo

**Contrato R08.** Guia é esperada quando existe obrigação de recolhimento aplicável que exige documento naquela competência/parcela. Dispensa comprovada e débito automático sem documento não produzem pendência de obtenção/envio. Uma guia excepcional incluída manualmente continua visível e rastreável.

**R09.** Contar itens de recolhimento identificáveis, sem contar novamente versões substituídas ou reimportações. Um DARF consolidado pode cobrir vários tributos; quantidade de obrigações cobertas e quantidade de documentos são medidas diferentes.

**Contrato de contadores, para o mesmo filtro e a mesma revisão:**

| Indicador | Conjunto contado |
| --- | --- |
| Esperadas (E) | Itens que exigem documento no recorte selecionado |
| Disponíveis (D) | Itens de E cobertos por documento vigente e válido |
| Faltantes (F) | Itens de E sem documento válido; `F = E − D` |
| Enviadas (S) | Itens de E com envio comprovado da versão válida |
| Envios pendentes (P) | Itens disponíveis que exigem comunicação e ainda não têm envio comprovado |
| Erros | Itens com falha ativa; indicar etapa e motivo |
| Dispensadas / não aplicáveis | Itens separados, com motivo; não entram em E |

Mostrar `D/E`, por exemplo **3/4 disponíveis · 1 faltante · 2 enviadas**. O detalhe identifica exatamente o item faltante. Se E = 0 com informação completa, mostrar “Nenhuma guia exigível”; com dados insuficientes, mostrar “Exigibilidade a verificar”.

Falha de envio não retira documento de D. Ela pode pertencer a P e ao grupo de erros: esses grupos não são somáveis como se fossem exclusivos. Erro de processamento do documento pode deixar o item em F e em erros.

**Validar V03:** apresentar o indicador principal por documento esperado ou por obrigação coberta quando houver DARF consolidado e guias complementares. Até essa definição, os rótulos devem declarar a unidade; não chamar tributos de PDFs.

## 5. Disponível, enviada e paga

**R10. Disponível:** documento processado e validado, vinculado à empresa, competência/obrigação e revisão corretas. Upload ou geração iniciada não bastam.

**R11. Enviada:** há evidência persistida de sucesso do canal para a versão do documento. Requisição enfileirada não equivale a envio confirmado. Entrega e leitura podem ser exibidas separadamente.

**Existente:** `EnvioGuiaService` combina registros de canais com compatibilidade legada; `guideCompliance.resolveNode` considera sucesso em um canal suficiente para a situação enviada, mesmo com falha em outro. Falha sem sucesso mantém documento disponível com erro de envio.

**R12. Paga:** depende de evidência de pagamento e da regra de confirmação. Enviar, baixar o PDF, vencer a parcela ou programar débito nunca confirma pagamento. Estorno deve atualizar os indicadores financeiros mantendo o histórico.

**Validar V04:** quais evidências confirmam pagamento, quem pode confirmá-lo e quando comprovante informado exige conferência. Preservar a semântica existente até revisar todos os consumidores de `paymentStatus`.

## 6. Empresas sem movimento

**R13.** Ausência de notas importadas e faturamento zero não dispensam todas as obrigações. Avaliar cada obrigação e período, inclusive folha/pró-labore, parcelamentos, obrigações declaratórias e tributos trimestrais.

**Existente:** `guideCompliance.js` consulta marca mensal `semFaturamento`, cadastro `empresaZerada`, faturamento usado pela apuração e informações do trimestre. Distingue `vazio`, `missing`, `conflito` e `na`; INSS e parcelamentos possuem tratamento próprio. Uma guia existente tem precedência sobre ausência confirmada dentro de um nó exigido.

**R14.** Dispensar automaticamente apenas com evidência suficiente e regra específica, registrando origem e período. Apuração zerada concluída pode ser uma evidência; não deve virar dispensa universal. Dados incompletos mantêm avaliação pendente.

**R15.** Receita ou nota posterior deve provocar reavaliação/revisão do que depende dela. Não apagar dispensa anterior nem transmitir retificadora automaticamente. Manter inclusão manual de guia com justificativa e vínculo adequado.

**Validar V05:** requisitos de completude para concluir ausência de movimento e alcance temporal do cadastro “empresa zerada”.

## 7. Guias manuais e execução externa

**R16.** Documento manual válido satisfaz a mesma necessidade documental de um documento automático. Preservar origem, autor, data, competência, tipo, versão e eventual vínculo com parcela. Não exigir que a rotina automática rode apenas para atualizar um indicador.

Guia manual não comprova transmissão de declaração, execução da rotina, envio ao cliente ou pagamento. Evidência externa de declaração deve ser conciliada com a mesma empresa e período. Reimportar o mesmo documento não pode aumentar contadores nem criar um novo envio.

## 8. Parcelamentos

**R17. Com guia:** acompanhar parcela devida, documento válido, envio quando necessário, vencimento e confirmação do pagamento. Uma parcela de acordo não satisfaz o DAS corrente só porque seu tipo de documento é Simples.

**R18. Débito automático:** sem exigência de documento de cobrança, não gerar falta de guia nem envio pendente. Continuar acompanhando programação, vencimento, processamento, confirmação e eventual falha. Programação não é pagamento. Documento eventualmente recebido permanece consultável.

**Existente:** `pendenciasParcelamento.js` reconhece `DEBITO_AUTOMATICO` e encaminha para conferência de pagamento; `GuiaParcelaEnvioGuard` bloqueia envio. Todos os relatórios ainda precisam ser comparados com essa projeção.

**Validar V06:** vigência da adesão ao débito, primeira parcela, exceções com guia, falha bancária e critérios para cobrança alternativa. Não aplicar a forma de pagamento atual retroativamente sem evidência.

## 9. Eventos e propagação

**R19.** Após persistir um evento, recalcular ou invalidar as projeções afetadas. A interface deve atualizar após ações locais e conclusão assíncrona; recarga deve produzir o mesmo resultado. Uma falha de leitura não apaga a última evidência válida nem apresenta sucesso.

| Evento confirmado | Indicadores que podem mudar | O que não comprova |
| --- | --- | --- |
| Apuração calculada | Apurações, revisão, expectativa conforme regra | Transmissão, guia, envio ou pagamento |
| Transmissão confirmada | Declaração entregue e tarefas dependentes | Guia disponível ou paga |
| Guia gerada/importada e validada | D, F, P e etapa documental | Transmissão, envio ou pagamento |
| Envio confirmado | S, P e erros ativos do envio conforme política de canais | Pagamento |
| Falha de geração/importação | Erros e falta documental | Dispensa |
| Falha de envio | Erros e P; documento continua disponível | Documento ausente ou pagamento |
| Correção/substituição de guia | Revisão válida, D/F/P/S conforme evidências da revisão | Reenvio automático autorizado |
| Pagamento confirmado/estornado | Financeiro e acompanhamento de parcelas | Envio realizado |
| Nota posterior | Notas posteriores, revisão de cálculo e liberação | Retificação automática |
| Reabertura | Domínio reaberto e dependências invalidadas | Cancelamento de recibos/pagamentos históricos |
| Pausa/retomada de rotina | Disponibilidade da execução | Dispensa fiscal ou execução concluída |

Abrir uma tela, mudar filtro, baixar arquivo, agendar tarefa e clicar em uma ação sem sucesso persistido não concluem etapas.

**R20.** Eventos e comandos precisam de identidade e revisão para evitar duplicidade entre execução manual, worker e callbacks. Preservar tentativas e conciliar resultado incerto antes de repetir efeitos externos.

## 10. Central de operações e UX

**R21.** Cada indicador abre a lista do mesmo conjunto: mesmos critérios, competência, permissões e unidade. O total representa todos os resultados filtrados, não só a página carregada. Empresas distintas, obrigações, documentos e notas não devem compartilhar um número sem rótulo de unidade.

Separar apurações pendentes, guias faltantes, envios pendentes, erros ativos, notas processadas e notas posteriores. Notas processadas precisam de critério de processamento concluído; notas posteriores precisam de marco e versão de fechamento/apuração, não apenas data de importação.

**Existente:** `operacoes.js` reaproveita `fluxoDaEmpresa`, mas reúne guias faltantes e aguardando envio em `pendencias`; falha de envio entra em `erros`. O estado de liberação de Operações é independente do estado fiscal.

**R22.** Mostrar o motivo da pendência, período e próxima ação. Reservar confirmação para consequências relevantes; conservar carregamento, vazio legítimo, informação indisponível e erro como situações distintas. Usar componentes e tokens existentes e verificar desktop/celular na etapa de UX.

**Validar V07:** marco e recorte dos indicadores de notas, política de canais obrigatórios e prazo esperado para atualização assíncrona.

## 11. Oportunidades e onboarding

**R23.** Exclusão deve ter confirmação e validar vínculos no servidor. Oportunidade comercial e ficha de onboarding são entidades distintas: a ação deve indicar o que será excluído ou arquivado.

**Existente:** `OnboardingService.descartar` aceita somente `RASCUNHO`, valida versão e bloqueia conversa/demandas vinculadas em transação. Outros estados orientam desistência para preservar histórico. Há DELETE de onboarding, o que não prova que a exclusão de oportunidade esteja coberta.

**Validar V08:** estados que permitem exclusão definitiva de oportunidade, vínculos impeditivos e comportamento de arquivamento/restauração. Não remover empresa, contrato, documentos ou conversas por consequência implícita.

## 12. Diagnóstico, dependências e plano incremental

Persistência principal: `apps/api/prisma/schema.prisma` — `Company`/`PortalClient`, `CompanyMonthlyCircular`, `ApuracaoSnapshot`, `Guide`, `EnvioGuia`, `Parcelamento`/`Parcela`, `Obrigacao`/`OcorrenciaObrigacao`, `CompanyRotina`, `PendenciaPosFechamento`, `Onboarding` e `AppSetting`.

Pontos de implementação e investigação:

| Área | Fontes relativas à raiz do repositório | Diagnóstico / próxima verificação |
| --- | --- | --- |
| Exigibilidade e documentos | `apps/api/src/application/guides/guideCompliance.js` | Cálculo próprio de guias separado do cadastro de obrigações; revisar simplificações e dispensa por competência |
| Fluxo compartilhado | `apps/api/src/application/company/FluxoCarteiraService.js`; `packages/shared/src/accounting/fluxoCarteira.js` | Reutilizar projeção existente; `ok` documental não significa envio/pagamento |
| Tabela de empresas | `apps/web/src/features/companies/list/components/renderCompaniesTable.jsx` | Resumo atual por tags precisa de contagem quantitativa com unidade explícita |
| Apuração e reabertura | `apps/api/src/application/notas/CompetenciaStateMachine.js`; `apps/api/src/application/notas/apuracao/v2/FechamentoService.js` | Estados e auditoria distintos; comentário de reabertura diverge da persistência; reproduzir falha visual antes de atribuir causa |
| Obrigações | `apps/api/src/application/obrigacoes/RegrasObrigacaoService.js` | Unificar critérios com guias preservando vigência, exceções e ocorrências |
| Operações e rotinas | `apps/api/src/application/operacoes/OperationsService.js`; `apps/web/src/features/operacoes/operacoes.js`; `apps/api/src/workers` | Revisão/idempotência já existem em Operações; conferir propagação de cada worker e fluxo manual |
| Parcelamentos | `apps/api/src/application/accounting/parcelamento/pendenciasParcelamento.js`; `apps/api/src/application/guides/GuiaParcelaEnvioGuard.js`; `apps/api/src/application/guides/loteVencimento.js` | Conferir débito automático em todos os consumidores, inclusive lotes por vencimento |
| Onboarding | `apps/api/src/application/onboarding/OnboardingService.js`; `apps/api/src/routes/firm/onboardings.js` | Descarte restrito já existe; verificar oportunidade comercial e UI separadamente |

Rotas locais relevantes, cujo prefixo final depende da montagem dos routers: `/fechamento/:competencia/reabrir` em `apuracaoV2.js`, `/fechamento-contabil/:competencia/reabrir` em `accountingEntries.js`, `/companies/:companyId/operacoes/:competencia` em `operacoes.js`, DELETE `/onboardings/:id` em `onboardings.js`.

1. **Diagnóstico e regras:** revisar este contrato, completar rastreio de produtores/consumidores e matriz de aplicabilidade. Saída: regras com evidência, decisões pendentes e regressões reproduzíveis.
2. **Correção da lógica:** tratar uma regra por entrega, começando pelas distinções documental/envio/pagamento e parcelamentos; seguir para exigibilidade e reabertura. Depende de V01–V06 onde aplicável.
3. **Integração:** aplicar a mesma projeção a rotinas, Empresas e Operações; verificar eventos manuais, automáticos e concorrentes. Sem atualização manual redundante.
4. **UX:** atualizar contadores, filtros, ações e modais após estabilizar o contrato; validar desktop/celular. Depende de unidade de contagem definida.
5. **Cenários integrados:** validar persistência, recarga e concordância entre telas. Testes de regressão acompanham cada incremento, não ficam adiados até o fim.

Não realizar migração destrutiva. Qualquer evolução de persistência exige análise de registros legados, compatibilidade dos consumidores, implantação gradual e reversão que preserve evidências e travas.

## 13. Matriz mínima de testes de aceite

| ID | Cenário | Resultado obrigatório |
| --- | --- | --- |
| T01 | Quatro guias exigíveis, três válidas, duas enviadas | 3/4, uma faltante, duas enviadas; detalhes e totais iguais |
| T02 | Nenhuma nota importada, dados incompletos | Não presumir ausência de movimento |
| T03 | Apuração zerada, com pró-labore ou parcela | Avaliar separadamente; não dispensar tudo |
| T04 | Mês zerado, receita em outro mês do trimestre | Não dispensar tributo trimestral só pelo mês |
| T05 | Débito automático programado sem confirmação | Sem falta de guia/envio; pagamento a conferir |
| T06 | Guia manual válida e reimportação do mesmo arquivo | Satisfazer documento sem duplicar contagem nem inventar transmissão |
| T07 | Envio falha; depois um canal tem sucesso | Documento permanece disponível; atualizar envio sem marcar pagamento |
| T08 | Reabertura, duplo clique, recarga e acesso sem permissão | Uma transição autorizada, persistente e sem envio/reprocessamento duplicado |
| T09 | Nota posterior e callback da revisão antiga | Revisão necessária; resposta antiga não conclui a nova revisão |
| T10 | Troca de competência ou regime histórico | Isolar períodos; resposta atrasada não contamina a tela atual |
| T11 | DARF consolidado, revisão e guia complementar | Unidade explícita e sem duplicação indevida |
| T12 | Falha de API ou lista paginada | Não mostrar zero por erro; total corresponde ao conjunto completo |
| T13 | Exclusão de rascunho sem vínculos e com vínculos concorrentes | Confirmação, integridade e bloqueio quando necessário |
| T14 | Pagamento informado, confirmado e estornado | Estados distintos; contadores financeiros consistentes |
| T15 | Rotina pausada ou execução manual externa | Pausa não dispensa obrigação; evidência externa válida se propaga |

## 14. Registro desta versão

16/10/2026 — versão inicial baseada na solicitação do usuário e inspeção estática do código. Nenhuma regra fiscal específica nova foi homologada. Nenhuma alteração funcional, migração, implantação, consulta ao banco de produção ou envio externo foi executado nesta etapa documental. A matriz acima define testes a executar; não representa testes aprovados.

Pendências para as próximas entregas: completar diagnóstico dos workers/endpoints e divergências com dados reais de homologação; reproduzir a reabertura relatada; executar a matriz de testes; validar V01–V08. A revisão estrutural completa permanece em andamento.

## 15. Decisões apresentadas para validação

Todas as propostas desta seção estão **pendentes**. Recomendações abaixo são de comportamento do produto; não validam regras tributárias específicas.

| ID | Proposta concreta para validar | Alternativa / informação necessária |
| --- | --- | --- |
| V01 | Reabrir somente o domínio escolhido, exigir motivo e permissão de contador/administrador, preservar histórico e invalidar aprovações dependentes sem retransmitir ou reenviar automaticamente. | Informar em qual tela a reabertura falha: Notas/conferência, Apuração/retificação ou Contabilidade. A identificação da falha é informação de diagnóstico, não decisão de negócio. |
| V02 | Manter uma matriz por obrigação, regime e vigência, com exceções por empresa e competência. Dados insuficientes ficam “a verificar”. Não inferir ISS para toda empresa nem igualar Real a Presumido. | Validar este modelo de gestão; a matriz fiscal detalhada ainda será elaborada e apresentada com fontes antes da implementação. Não basta aprovar genericamente todas as obrigações. |
| V03 | Contador principal por guia de recolhimento esperada; um DARF consolidado vale uma guia. Mostrar separadamente os tributos cobertos. Revisão substituída não conta; guia complementar exigida conta separadamente. | Alternativa: principal por obrigações cobertas, com rótulo “obrigações”, e quantidade de documentos em separado. Exemplo: um DARF cobre quatro tributos → uma guia disponível, quatro tributos cobertos. |
| V04 | Cliente informa pagamento → “informado pelo cliente”, suspende cobrança automática e entra em conferência. Confirmação oficial ou validação do contador → “confirmado”, mantendo origem. Baixa contábil segue procedimento próprio. | Decidir se informação do cliente suspende cobrança e se contador pode confirmar sem comprovante anexado, mediante motivo. Não converter registros legados em massa nem alterar sua contabilização sem plano específico. |
| V05 | Ausência de movimento deve ser conclusão por competência, apoiada em apuração válida e completude das fontes, ou declaração manual justificada do contador. Avaliar cada obrigação; cadastro “zerada” orienta a avaliação, sem dispensar indefinidamente. | Validar aceitação da declaração manual e se ela deve valer somente para a competência selecionada. A definição de fontes completas depende do fluxo de cada empresa. |
| V06 | Débito automático com vigência por parcela; excluir apenas obtenção/envio dispensados. Primeira parcela e exceções podem exigir guia. Falha/ausência de confirmação abre conferência; cobrança alternativa requer ação explícita. | Decidir quem pode registrar adesão/exceção e se a evidência pode ser declaração do contador. Não presumir adesão retroativa nem pagamento pelo vencimento. |
| V07a | Indicadores principais seguem a competência selecionada; avisos de outras competências ficam separados. “Processadas” conta notas únicas com processamento válido concluído. “Posteriores” conta notas únicas que alteram a base após a versão conferida/fechada, sem contar eventos duplicados. | Validar marco: versão conferida/fechada ou exclusivamente declaração transmitida. Distinguir nota emitida posteriormente de nota antiga importada tardiamente no detalhe. |
| V07b | Um canal autorizado com sucesso conclui o envio; falhas em outro ficam no histórico. Permitir exigência explícita de mais de um canal por empresa. Atualizar após ação local e consultar conclusões assíncronas em até 60 segundos enquanto a tela estiver ativa e conectada. | Alternativa: todos os canais sempre obrigatórios. O prazo é uma meta proposta para consulta da interface, não promessa sobre tempo de processamento externo. |
| V08 | Excluir definitivamente apenas oportunidade/rascunho sem vínculos, com confirmação. Havendo conversas, demandas, contrato, empresa ou histórico relevante, oferecer arquivamento reversível, preservando vínculos e excluindo da lista ativa. | Validar quem pode excluir/arquivar/restaurar e se contador e administrador podem fazê-lo. A regra do rascunho de onboarding não será automaticamente aplicada à oportunidade comercial sem mapear seus vínculos. |

## 16. Continuação do diagnóstico — evidências de 16/10/2026

Inspeção estática adicional, sem alteração funcional e sem acesso a dados reais. Os achados abaixo não significam reprodução ponta a ponta.

| Achado | Evidência no código | Impacto / próximo passo |
| --- | --- | --- |
| Empresa zerada ainda recebe interpretação global na UI | `apps/web/src/features/companies/list/lib/estadoDominante.js`: `empresaSemObrigacoes` retorna somente `Boolean(empresaZerada)`; texto associado afirma ausência de guias/impostos. A tabela usa essa função na severidade. | Pode divergir da avaliação mensal por obrigação do backend. Mapear todos os consumidores e construir cenário com receita, pró-labore e parcelamento antes de mudar a regra; depende de V05. |
| Débito automático bloqueado pode ser tratado como incompletude documental | `loteVencimento.js`: qualquer `bloqueioEnvio` de documento não pago torna a linha `incompleto`; `GuiaParcelaEnvioGuard.js` retorna `PARCELA_DEBITO_AUTOMATICO`. Documentos antigos/sem vencimento entram em listas de pendências sem distinguir esse motivo. | Incompatibilidade entre bloqueio legítimo e falta documental. Já existe patch local em outra árvore de revisão; comparar e validar antes de integrar, sem sobrescrever trabalho alheio. |
| Pagamento informado e confirmado compartilham PAID | `ConfirmarPagamentoWhatsappService.js` grava `PAID` com origem `CLIENTE`; `procedenciaDoPagamento.js` impede essa origem de alcançar a contabilidade. Consumidores como lote e guarda de envio consultam PAID diretamente. | A origem já existe e deve ser reaproveitada. A separação de apresentação/cobrança exige V04 e análise de todos os consumidores, sem regressão contábil. |
| Caminho de retificação pode sinalizar sucesso sem método disponível | `renderApuracaoV2Tab.jsx`, `abrirRetificar`: chamada opcional `api.reabrirFechamento?.`; rejeita apenas `r?.ok === false`; em seguida mostra sucesso e abre modal. | Método ausente/resposta vazia não deve comprovar persistência. No fluxo real o método existe em `realApi.js`; o achado não prova a causa do incidente relatado. Criar teste de contrato de resposta. |
| Retificação não recarrega explicitamente a apuração nesse handler | O mesmo handler abre o modal sem chamar `carregarApuracao`, enquanto a conferência de transmissão chama essa função. | Rastrear callbacks do modal e recarga da carteira antes de concluir que há estado obsoleto. |
| Alertas de notas usam período e atualização próprios | `OperationsAlerts.jsx` consulta todas as competências, a cada 60 segundos e ao recuperar foco; projeção principal recebe competência selecionada. | Não é necessariamente defeito, mas os recortes devem ficar explícitos. Leituras periódicas podem se sobrepor; verificar ordenação de respostas e total/lista. Depende de V07 para mudar o recorte. |
| Resumo de guias conta tags | `renderCompaniesTable.jsx`, `GuiasResumidas`: rótulo usa `tags.length`, cor usa estados. | Não entrega D/E e não distingue tributos de documentos; depende de V03. |

Rastreamento adicional de reabertura: `realApi.js` possui rotas separadas para conferência (`competencias/:competencia/reabrir`), retificação (`fechamento/:competencia/reabrir`) e contabilidade (`fechamento-contabil/:competencia/reabrir`). Consumidores encontrados: `useNotasFiscais.js`/`renderAuditoriaTab.jsx`, `renderApuracaoV2Tab.jsx` e `renderAccountingEntriesTab.jsx`, respectivamente.

Validação deste incremento: conferência de arquivos e `git diff --check`; nenhum teste funcional executado nesta etapa documental. Próximo incremento independente das decisões: caracterizar por testes os contratos de reabertura, projeção de lotes e ordenação de respostas. Implementações dependentes das propostas da seção 15 permanecem pendentes da resposta do usuário.

## 17. Calendário de tarefas — gestos aprovados em 16/10/2026

**Contrato R24 — pedido explícito do usuário.** Clicar em uma célula vazia da semana/dia abre a criação com a data e a hora daquela célula. Arrastar um bloco muda sua posição; as alças permitem aumentar ou diminuir o período/duração. Na grade horária, o término opcional é posterior ao início no mesmo dia (até 23:59). No mês e na faixa sem horário, alças ajustam as datas inclusivas, sem fabricar horário. Arrastar preserva a duração e a identidade da ocorrência.

O gesto edita somente a ocorrência escolhida. Preserva empresas, subtarefas, conclusões e o dia nominal do vencimento mensal; não desloca vencimento ao mudar a data de trabalho. Avisos adicionais D−1/D não são blocos independentes editáveis. O calendário antigo e suas obrigações foram excluídos por decisão expressa de 15/10/2026; não reativá-los para atender estes gestos.

**Impacto:** interação e duração da tarefa, com término opcional no JSON existente. Aplicam-se R19 (persistência antes de sucesso), R20 (identidade da ocorrência) e R22 (erro/foco/desktop/celular). Nenhuma regra fiscal, financeira, de envio ou proposta V01–V08 é alterada. Sem migração de dados.

**Histórico:** 16/10/2026 — usuário solicitou aumentar/diminuir o bloco, arrastar para outro dia e criar ao clicar no quadrado da semana. Implementação deve corrigir a desativação das alças, conservar horaFim e liberar o próximo clique após arraste. Este registro é aprovação do comportamento, não atestado de execução dos testes.

| ID | Cenário | Resultado obrigatório |
| --- | --- | --- |
| T16 | Clicar em espaço vazio semanal, inclusive após arraste anterior | Editor abre com data/hora da célula; não fica bloqueado pelo gesto anterior |
| T17 | Mover tarefa horária para outro dia e recarregar | Mesmo ciclo, duração e checklist; nova posição persistida sem abrir detalhe ao soltar |
| T18 | Aumentar/reduzir início ou término | Prévia acompanha gesto; término válido persiste e aparece na edição |
| T19 | Mover/redimensionar intervalo no mês/faixa sem horário | Datas inclusivas corretas; movimento preserva duração, sem criar horário |
| T20 | Editar gesto em recorrente com vencimento e empresa concluída | Vencimento nominal e progresso conservados; próxima ocorrência independente |
| T21 | Cancelar com Escape ou falhar gravação | Cancelamento não grava; falha visível sem sucesso inventado |

## 18. Especificação de tela e efeito operacional para validação

16/10/2026 — detalhamento solicitado pelo usuário. **Propostas, ainda não aprovadas nem implementadas.** Complementa V01–V08 sem alterar decisões já aprovadas, inclusive R24. Exemplos e números são ilustrativos. Alteração deste incremento: somente documentação.

### 18.1 Empresas e Guias — V02/V03

Na tabela Empresas, preservar a identificação e o período selecionado. Na coluna Guias, substituir a simples quantidade de tags por uma linha principal `3/4 disponíveis` e uma linha auxiliar `1 faltante · 2 enviadas`. Pagamento fica no contexto financeiro e não muda o significado dessas duas linhas.

Clicar no resumo expande o detalhe da própria empresa, com colunas `Guia esperada`, `Documento`, `Envio` e `Próxima ação`. Não abrir um modal apenas para explicar o número. Ao selecionar uma ação, usar o fluxo existente de importação, consulta ou envio. Consulta externa paga e envio mantêm suas confirmações aplicáveis.

| Guia esperada (exemplo fictício) | Documento | Envio | Próxima ação |
| --- | --- | --- | --- |
| Guia A | Disponível | Enviada | Abrir documento |
| Guia B | Disponível | Enviada | Abrir documento |
| Guia C | Disponível | Pendente | Enviar |
| Guia D | Faltante | Aguardando documento | Obter / anexar |

Efeito real: a expectativa vem de regras por empresa/competência, não dos arquivos encontrados. Anexar e validar Guia D muda para `4/4 disponíveis · 2 enviadas`; envio confirmado de C muda para `4/4 disponíveis · 3 enviadas`. Não exige atualizar um checklist manual nem executar a rotina automática. Falha no envio mantém D e acrescenta erro. Reimportação não incrementa os números.

DARF consolidado: proposta de uma guia na contagem e detalhe dos tributos que ela cobre. Antes de conhecer a consolidação, não inventar uma quantidade exata: mostrar `Expectativa a conferir` e as obrigações conhecidas. A implementação precisa de identidade de guia esperada e vínculo das obrigações cobertas; contar PDFs existentes não resolve o denominador.

### 18.2 Regras e exceções da empresa — V02

Reutilizar a área de Obrigações da empresa. Exibir por competência: obrigação, aplicabilidade (`Exigível`, `Dispensada`, `Não aplicável`, `A verificar`), expectativa de guia, motivo e origem da regra. `Ver regra` mostra vigência e evidência; `Registrar exceção` pede obrigação, período, decisão e justificativa, respeitando permissão.

Efeito real: uma exceção válida altera a expectativa apenas no período indicado e atualiza Empresas/Guias/Operações. Não apaga documentos já existentes. Divergência entre uma dispensa e uma guia real aparece para conferência. Sem matriz fiscal validada, exibir avaliação incompleta; não inferir dispensa. Aprovação desta organização de tela não aprova a matriz tributária.

### 18.3 Central de operações — V07

Manter seletor de competência visível. Os cartões filtram uma lista na própria página; o filtro ativo aparece acima da lista e pode ser removido. Abertura do detalhe de uma empresa é um segundo passo, não um modal obrigatório para ver o conjunto.

| Cartão | Unidade e linhas da lista | Ação contextual |
| --- | --- | --- |
| Apurações pendentes | Empresa + competência com apuração ainda não concluída | Abrir apuração |
| Guias faltantes | Guia esperada sem documento válido | Obter / anexar |
| Envios pendentes | Guia disponível com comunicação necessária não concluída | Enviar / conferir tentativa |
| Erros ativos | Ocorrência de falha não resolvida, identificada por etapa e item | Ver causa / corrigir |
| Notas processadas | Nota única com processamento válido concluído | Abrir nota |
| Notas posteriores | Nota única que alterou a base após o marco aprovado | Revisar impacto |

Cada cartão usa o mesmo conjunto da lista, inclusive paginação e acesso. Exibir quantidade de empresas afetadas como informação secundária quando a unidade principal for guia/nota/erro. Cartões podem se sobrepor; não apresentar sua soma como total de trabalho.

Notas posteriores: mostrar competência, emissão, entrada no Altan e motivo (`Emitida após conferência`, `Importada tardiamente` ou outra alteração identificada). Abrir apuração revisável a partir da nota. Proposta de marco: versão conferida/fechada. Eventos de outros meses aparecem em bloco separado `Outras competências`, com período de cada item.

Efeito real: separar os grupos hoje misturados, padronizar filtros e atualizar após eventos persistidos. Ação local concluída atualiza o conjunto afetado; trabalhos em segundo plano são consultados periodicamente, com meta de até 60 segundos em tela ativa/conectada. Mostrar `Atualizando` e `Não foi possível atualizar`, sem trocar erro por zero.

### 18.4 Competência sem movimento — V05

Na competência da empresa, mostrar `Sem receita confirmada em MM/AAAA`, com origem e data no detalhe. Apresentar separadamente as guias e obrigações ainda exigíveis. Só mostrar `Nenhuma guia exigível` quando todas as avaliações necessárias estiverem completas.

Oferecer `Registrar ausência de receita` ao contador quando a evidência automática não for suficiente. O formulário informa competência e pede justificativa, exibindo as obrigações que continuarão ativas. Manter `Adicionar guia` acessível.

Efeito real: o registro vale para a competência selecionada e não elimina INSS, parcelas ou declarações por consequência genérica. Receita posterior muda a situação para `Revisar ausência de receita`, conservando a afirmação anterior no histórico e recalculando dependências. Não transmite retificação automaticamente.

### 18.5 Parcelamentos — V06

Na lista de acordos, exibir `Pagamento por guia` ou `Débito automático`. Na lista de parcelas, mostrar número, vencimento, forma de pagamento e situação do pagamento. Separar filtros `Guia pendente` e `Débito a conferir`.

Exemplo: `Parcela 08 · vence 20/10 · Débito automático · Aguardando confirmação`. Próxima ação: `Conferir pagamento`. Se venceu sem evidência: `Vencida · débito não confirmado`; ausência de confirmação não prova falha bancária. Falha comprovada tem rótulo próprio.

Em configuração, `Forma de pagamento` pede parcela/data inicial de vigência e permite exceção para parcela específica. A primeira parcela pode continuar por guia. Uma cobrança alternativa exige documento válido e decisão explícita; não aparece como envio automático causado pelo vencimento.

Efeito real: essas parcelas saem das pendências de obter/enviar guia quando dispensadas, mas permanecem no acompanhamento financeiro. Exceção válida por guia volta a gerar a expectativa documental daquela parcela. Adesão e exceções ficam registradas com autor e motivo.

### 18.6 Informação e confirmação de pagamento — V04 (proposta histórica substituída pela seção 21)

No documento e acompanhamento financeiro, usar rótulos com origem:

- `Pagamento não confirmado` — sem evidência suficiente.
- `Informado pelo cliente · em conferência` — data informada e ação `Conferir pagamento`.
- `Confirmado pela consulta oficial` — evidência e data disponíveis.
- `Confirmado pelo contador` — autoria, motivo e comprovante quando existente.

A fila `Pagamentos a conferir` reúne informações do cliente ainda não validadas. O contador pode `Confirmar` ou `Registrar divergência`, com motivo; divergência reabre a pendência financeira, sem enviar nova cobrança imediatamente. Retomada de cobrança respeita revisão e política de comunicação.

Proposta de efeito: a informação do cliente suspende a cobrança automática, mas não conclui conferência nem baixa contábil. Não mudar retroativamente saldos/baixas de registros antigos. Registros legados sem origem permanecem identificados como tais. Decisões necessárias: aceitar suspensão pela informação do cliente e confirmação manual sem comprovante anexado, com justificativa.

### 18.7 Reabertura — V01

Usar nomes específicos no lugar de um comando genérico: `Reabrir conferência`, `Reabrir apuração para retificar` e `Reabrir fechamento contábil`, nas respectivas telas existentes.

O diálogo de confirmação mostra empresa, competência, motivo e efeitos daquele domínio. Exemplo contábil: `Os lançamentos desta competência poderão ser revisados. A declaração transmitida permanece registrada.` Exemplo fiscal: `Uma nova revisão será aberta. A declaração anterior permanece no histórico; a retificação exige transmissão posterior.`

Enquanto grava, desabilitar nova confirmação. Após persistir, mostrar o estado efetivamente salvo (`Em conferência`, `Aberta para retificação` ou `Contabilidade aberta`) e atualizar resumo/listas relacionados. O histórico registra a reabertura. Se houver tentativa externa incerta, orientar conciliação e impedir repetição insegura.

Efeito real: corrigir o contrato de resposta e recarga, garantir persistência e impedir efeitos duplicados; registrar motivo/autor e invalidar apenas aprovações dependentes. Preservar declarações, guias, envios e pagamentos anteriores. A origem exata do incidente relatado ainda depende de reprodução.

### 18.8 Oportunidades — V08

No menu da oportunidade, oferecer `Excluir rascunho` quando elegível e `Arquivar` quando houver histórico/vínculos que devem ser preservados. Antes da confirmação, carregar os vínculos e explicar quais impedem exclusão. Validar novamente no servidor ao executar.

Exclusão: confirmação com nome e consequência de remoção definitiva. Arquivamento: sai da lista ativa e aparece no filtro `Arquivadas`, com ação `Restaurar`. Não usar desistência comercial como sinônimo automático de arquivamento: o histórico comercial conserva seu significado.

Efeito real: exclusão remove somente a entidade elegível; arquivamento altera sua visibilidade/estado e preserva vínculos. Não apaga empresa, contrato, conversa ou documento vinculado. O esquema exato será definido após inventário completo dos vínculos de oportunidade e onboarding.

### 18.9 Limites de cada entrega

Correções técnicas de resposta, persistência, duplicidade e total/lista serão verificadas por cenários reproduzíveis. Mudanças de política (V01–V08) só entram após validação, conforme pedido do usuário. As telas serão adaptadas por incremento usando os componentes existentes; esta especificação não autoriza uma reformulação simultânea de todos os módulos.

Cada incremento apresentará regra afetada, tela/ação alterada, efeito nos dados, testes executados e limitações. Nesta versão, foram detalhadas propostas; nenhum estado real, banco ou interface foi alterado.

## 19. Simplificação da coluna Guias — decisão de 16/10/2026

Pedido explícito posterior do usuário: remover da linha principal a legenda “1 faltante · 2 enviadas · 1 falha”. Mostrar somente o controle compacto de cobertura/estado, com cores semânticas e expansão. Contagens e estados individuais permanecem no detalhe e no nome acessível; não inserir legendas auxiliares repetidas sob os status. Esta decisão substitui a proposta de segunda linha visível das seções 4 e 18.1, sem mudar os conjuntos contados, a unidade ou os eixos documento/envio/pagamento. Impacto operacional: nenhum; apresentação R22. Cenário de aceite: com quatro obrigações, três disponíveis, duas enviadas e uma falha, o controle mostra 3/4 e atenção ao envio; expandir identifica cada estado, sem legenda sob o controle. Não aprova V01–V08.

## 20. Revisão técnica em dev — 16/10/2026

Execução autorizada pelo usuário em `altan-revisao-produto-dev`, com revisão fiscal, contábil, comunicação e rotas em agentes separados. Este registro implementa contratos já aprovados; não transforma propostas V01–V08 em regras aprovadas.

- R02: extração PGDAS incompleta não marca ausência de faturamento. A marca depende de receita e DAS explicitamente iguais a zero. Leituras inválidas na interface não equivalem a listas vazias ou sucesso.
- R04–R06: reabertura de apuração usa transação com controle de revisão e evento de auditoria, contendo snapshot anterior, autor, motivo e revisões. Interface pede motivo e relê o estado persistido. Compatibilidade legada conserva motivo ausente como null; não inventa justificativa. Não há retransmissão automática.
- R19–R20: execução de operação exige confirmação explícita; retorno vazio/negativo não conclui tarefa. Respostas tardias não contaminam outra competência/empresa. Fechamento contábil e consulta fiscal não anunciam sucesso sem confirmação.
- R21–R22: filas da central compartilham o conjunto dos cartões; resumo Guias sem legenda secundária conforme seção19. Cores existentes no resumo e detalhe; revisão de todas as áreas listadas no plano preserva decisões específicas dos módulos.
- Ambiente de demonstração: documentos/anotações isolados por empresa, sem efeito nos dados de produção. Sem nova política fiscal, migração produtiva, envio externo ou alteração de regras de pagamento.

Cenários de regressão: extração ausente versus zero explícito; auditoria e reabertura com concorrência; resposta negativa/vazia de transmissão; troca de competência durante envio; erro versus fila vazia; fechar/reabrir e recarregar; documentos/notas de empresas distintas; pagamento informado pelo cliente sem baixa automática. Evidências e limites detalhados em `altan-revisao-produto-dev/docs/revisao-produto-2026-10/ENTREGA_DEV.md`. Este registro não certifica integrações externas.


## 21. Baixa pelo cliente e correção contábil — decisões aprovadas em 16/10/2026

Decisão expressa do usuário: “Baixa direta apos o cliente confirmar, salvando o log para caso necessite de prova. correção do mes fechado pode seguir como falou”. Esta seção substitui a proposta V04 das seções 5, 15 e 18.6 e a restrição histórica de baixa pelo cliente citada na seção 20 e nos documentos de design. A implementação ainda depende dos gates e revisões; este registro não declara entrega concluída.

**R25 — confirmação do cliente com baixa direta.** Uma confirmação explícita e autenticada do cliente para a guia e revisão correspondentes autoriza a baixa automática, sem segunda aprovação do contador. Mensagem genérica, entrega, leitura ou clique em documento não confirmam pagamento. Persistir origem CLIENTE, canal, identidade do autor/remetente, instante, data de pagamento informada, empresa, guia/revisão, valores e referência do evento de confirmação, com vínculo à baixa. O log é evidência da declaração do cliente, não comprovante bancário nem confirmação oficial. Manter essa origem visível. Preservar eventos anteriores; não converter confirmações legadas em massa.

A baixa deve ser idempotente, não duplicar principal ou encargos, não atingir outras guias e preservar composição de principal/juros/multa. Falta de dados contábeis necessários ou falha de persistência deve ficar como pendência visível e retomável, sem inventar conta, valores ou anunciar baixa concluída. Confirmação válida suspende lembretes daquela guia. A correção posterior preserva a confirmação original e a trilha de auditoria.

**R26 — corrigir mês fechado.** A ação explícita “Corrigir mês fechado” exige permissão contábil e motivo, registra autor, instante, fechamento anterior e alterações antes/depois, e reabre somente a contabilidade. Preservar declarações transmitidas, documentos, recibos, envios e pagamentos. Não retificar nem retransmitir por consequência da reabertura. Manter ocorrência e contador em Contabilidade/Lançamentos até nova conferência, com texto além de cor e histórico consultável após resolução. Validar empresa/competência/versão no servidor; gravação e auditoria são atômicas e repetição não duplica efeitos. A automação de baixa não deve apagar silenciosamente um fechamento: se o mês afetado estiver fechado, conservar a confirmação e indicar a correção contábil necessária pelo fluxo explícito acima.

**Impacto operacional:** altera R12/V04 e concretiza R04–R06, R19–R22 no fechamento contábil. Não aprova outras propostas V02/V03/V05–V08 nem autoriza operações em produção, publicação ou chamadas externas nesta implementação.

| ID | Cenário | Resultado obrigatório |
| --- | --- | --- |
| T22 | Cliente autorizado confirma guia vigente | Confirmação e baixa vinculadas, origem CLIENTE visível, log persistido e lembretes suspensos |
| T23 | Evento repetido, concorrente, guia de outra empresa ou revisão antiga | Não duplicar baixa; rejeitar identidade/revisão inválida sem efeito financeiro |
| T24 | Falha contábil ou dados insuficientes após confirmação | Não anunciar baixa concluída; pendência recuperável com confirmação preservada |
| T25 | Guia recalculada confirmada entre várias guias | Baixar somente a selecionada, principal/juros/multa separados e sem duplicação |
| T26 | Correção de mês fechado | Motivo/autor/antes/depois persistidos; apenas contabilidade reaberta; contador de revisão visível após recarga |
| T27 | Auditoria falha, acesso negado, versão antiga ou duplo clique | Sem transição parcial nem duplicação; mensagem coerente |
| T28 | Nova conferência após correção | Ocorrência resolvida e contador atualizado; histórico e declaração fiscal preservados |
| T29 | Confirmação antiga do cliente sem novo evento | Não gerar baixa retroativa em massa |
| T30 | Cliente confirma pagamento afetando mês fechado | Confirmação preservada e pendência contábil visível até correção explícita, sem alterar fechamento silenciosamente |

## 22. Contratação, oportunidade ganha e carteira — decisões aprovadas em 18/10/2026

Respostas expressas do usuário neste chat: **“Contratação confirmada + exceção justificada”** e **“Ganha na assinatura; implantação pode começar; carteira após pagamento”**. Substituem, para o novo fluxo comercial, a compatibilidade automática que permitia entrada na carteira sem proposta. Este registro aprova o comportamento; não declara implementação, revisão técnica ou publicação concluída.

**R27 — contratação confirmada e exceção externa.** A entrada normal na carteira exige contratação confirmada. A ausência de proposta, uma classificação manual como CONTRATADO, o preenchimento da ficha ou a conclusão de uma checklist não comprovam contratação. Manter entrada manual excepcional para cliente já contratado fora da Altan: ação explícita de usuário autorizado, com justificativa e evidência/referência da contratação externa, autoria, instante e vínculo com a solicitação. Validar permissão e escopo no servidor; não conceder poderes a usuários que não podiam realizar a operação. Não transformar a exceção em opção genérica para ignorar contrato interno incompleto ou pagamento aplicável. Preservar registros já convertidos e histórico, sem conversão ou bloqueio retroativo em massa.

**R28 — assinatura, implantação e pagamento são marcos distintos.** Assinatura conferida do contrato correspondente torna a oportunidade ganha e habilita o início da implantação; não registra automaticamente implantação iniciada ou concluída. A entrada normal na carteira continua dependendo também do pagamento previsto no contrato, segundo os controles existentes. Preservar os controles existentes de pagamento. Ausência de informação sobre pagamento não equivale a dispensa nem a pagamento confirmado. Uma oportunidade pode estar ganha, com implantação em andamento e entrada na carteira pendente de pagamento. Conversão para carteira não conclui a implantação. A exceção por contratação externa registra sua origem sem fabricar assinatura digital, aceite ou pagamento interno.

Lista, ficha e conversa devem apresentar a mesma projeção desses fatos persistidos, com requisitos faltantes e efeitos explícitos. Releituras não gravam marcos. Ações locais, assinaturas verificadas e pagamentos confirmados atualizam projeções sem perder rascunhos; respostas antigas não prevalecem sobre a revisão atual. Aplicam-se R19–R23, autenticação, idempotência e auditoria existentes. Não altera PF/avulso para obrigá-los a criar empresa, nem autoriza envios, cobrança, assinatura, pagamento ou conversão reais como teste.

**Histórico e impacto:** 18/10/2026 — decisão do usuário fecha as duas pendências comerciais do incremento P0. Altera as condições comerciais de entrada na carteira e explicita o marco de ganho/início de implantação. Não aprova V02/V03/V05–V08, não muda governança de desenvolvimento e não autoriza publicação deste incremento.

| ID | Cenário | Resultado obrigatório |
| --- | --- | --- |
| T31 | Ficha sem proposta, sem exceção autorizada | Entrada normal bloqueada no servidor e motivo visível; fase manual não substitui contratação |
| T32 | Contrato correspondente com assinatura conferida e pagamento aplicável pendente | Ganha; implantação pode começar; carteira bloqueada pelo pagamento |
| T33 | Assinatura e pagamento aplicável confirmados | Entrada normal permitida com demais requisitos vigentes, sem concluir implantação |
| T34 | Contratação externa, usuário autorizado, justificativa e evidência | Exceção explícita auditada, sem fabricar marcos internos; preservar demais requisitos aplicáveis |
| T35 | Exceção sem permissão, justificativa, evidência, escopo ou versão válidos | Rejeitar sem efeito parcial; tentativa não libera carteira nem altera permissões |
| T36 | Repetição, concorrência e falha de auditoria | Não duplicar empresa/conversão; persistência e auditoria atômicas, erro coerente |
| T37 | Atualização externa de assinatura/pagamento e recarga | Lista/ficha/conversa concordam; distinguir ganha, implantação e carteira; preservar rascunhos |
| T38 | Cliente já convertido ou serviço PF/avulso | Preservar histórico e caminhos existentes, sem migração retroativa ou criação obrigatória de empresa |

## 23. Teste isolado de WhatsApp e calendário — decisão de 18/10/2026

Pedido expresso do usuário: preparar teste da IA automática no WhatsApp com seu número já vinculado, sem alterar atendimento real nem empresa; corrigir piscadas do calendário e oferecer Duplicar/Excluir nos cartões.

**R29 — sessão de teste independente.** O número vinculado não autoriza liberar sua automação real. Teste exige sessão administrativa explícita e temporária, destinatário/canal delimitados e identificação inequívoca de cada entrada de teste. Mensagens comuns preservam o atendimento normal. Histórico, contexto, ferramentas, encaminhamento e resultados de teste ficam separados dos registros operacionais. A alternância entre mensagens automáticas, IA e atendimento humano ocorre somente na sessão; ferramentas não leem contexto operacional. Ativação de teste nasce desabilitada no servidor e exige sessão autorizada; revogação impede novas saídas. Expiração, encerramento e repetição não podem transformar evento de teste em evento real. Não criar contratação, empresa, pagamento, transmissão, consulta fiscal ou mensagem a terceiro como efeito do teste. Saídas são identificadas como teste, restritas ao destinatário autorizado; resultado externo incerto não autoriza repetição automática. Ativação e envio reais exigem autorização do escopo concreto; esta entrega prepara o mecanismo em desenvolvimento.

**R30 — calendário contínuo e ações da tarefa.** Alterar tarefa mantém grade, período, filtros, rolagem e foco; resultado persistido atualiza a projeção sem carregar novamente a página ou deslocar a grade. Respostas antigas não sobrescrevem confirmação nova; falha conserva o estado válido e mostra recuperação. Menu acessível oferece duplicação da ocorrência. Como escolha técnica conservadora deste incremento, a cópia é uma tarefa avulsa independente e pendente, sem copiar conclusão ou evidência; origem e série permanecem intactas. Excluir pelo cartão conserva confirmação e alcance da ocorrência, preservando repetições e histórico; exclusão da série permanece ação separada já existente. Mantêm-se R24 e permissões no servidor.

Impacto: R19/R20/R22/R24 e isolamento de comunicação. Não muda regras fiscais, pagamentos, contratação ou decisões pendentes. Registro de decisão não declara testes concluídos nem publicação autorizada.

| ID | Cenário | Resultado obrigatório |
| --- | --- | --- |
| T39 | Número vinculado e pausado recebe teste e mensagem comum | Teste isolado; mensagem comum conserva fluxo real; vínculo e pausa não mudam |
| T40 | Sessão inválida, expirada, encerrada ou mensagem repetida | Sem fallback operacional, envio indevido ou duplicação |
| T41 | IA solicita ação fiscal/financeira ou outro destinatário | Ferramenta bloqueada; nenhum efeito operacional |
| T42 | Handoff de teste, revogação durante inferência e callback tardio | Somente sessão afetada; saída inválida bloqueada; evidência isolada |
| T43 | Alterar/mover/concluir com rede lenta ou falha | Grade/scroll estáveis, confirmação coerente e leitura antiga descartada |
| T44 | Duplicar ocorrência concluída/recorrente com empresas e subtarefas | Nova tarefa avulsa pendente; identidade e progresso da origem preservados |
| T45 | Excluir pelo menu, cancelar, teclado e celular | Confirmação clara; apenas ocorrência escolhida; navegação e gestos preservados |
| T46 | Duas entradas simultâneas, crash/retry e timeout de transporte | Turnos preservados, recuperação delimitada e nenhuma repetição de saída incerta |

## 24. Retomada manual após desistência — decisão de 20/10/2026

O usuário determinou que a Neurogenesis não permaneça como desistência e que seu atendimento seja retomado. Este registro aprova essa recuperação concreta, preservando histórico; não aprova V08 integralmente nem autoriza exclusão com vínculos. A interface de retomada é o mecanismo de recuperação auditada, sujeito às permissões existentes de administrador/contador do escritório e ao escopo da ficha.

**R31 — retomada auditada e conservadora.** A ação exige motivo e versão atual de ficha em DESISTIU ainda não convertida. Restaura o estágio anterior comprovado pelo histórico. Em registros legados sem esse estágio, retorna a RECEBIDO quando houver envio registrado, ou a RASCUNHO quando não houver; registra a origem dessa decisão. Retomar não comprova contratação, assinatura, pagamento, implantação ou consentimento.

A transição e sua auditoria são atômicas: registrar autor, momento, motivo, versão, estado restaurado e desistência anterior. Preservar documentos, conversas e eventos; revogar links antigos e manter o caso em atendimento manual. Não alterar a pessoa nem outro atendimento que compartilhe a conversa. Trabalhos fiscais antigos pendentes exigem revisão; resultados de trabalhos em processamento permanecem indeterminados até conferência. A retomada não deve provocar novas consultas, mensagens ou repetição de atos externos incertos. Revalidar a identidade/revisão da execução antes de novas etapas externas e impedir que resultados antigos concluam a revisão retomada. Repetição da mesma ação não duplica eventos; falha de auditoria desfaz os efeitos transacionais.

**Histórico e impacto:** 20/10/2026 — pedido expresso de devolver a Neurogenesis ao atendimento. Nova transição operacional de recuperação, concretizando R19–R23 e preservando R27–R28. A manutenção em modo manual e a revogação de links são proteções técnicas conservadoras, não autorização para apagar vínculos ou reativar automações. V08 continua pendente nos demais aspectos. Registro não declara implementação, aprovação técnica, alteração produtiva ou publicação concluída.

| ID | Cenário | Resultado obrigatório |
| --- | --- | --- |
| T47 | Retomada autorizada de ficha desistente | Preservar desistência no histórico e restaurar estágio comprovado; não fabricar contratação ou pagamento |
| T48 | Legado sem estágio anterior comprovado | Retorno conservador conforme envio registrado, com origem da decisão auditada |
| T49 | Repetição ou concorrência da mesma retomada | Uma transição e um evento; versão antiga não sobrescreve estado posterior |
| T50 | Falha ao persistir auditoria | Estado, links e trabalhos permanecem como antes da tentativa |
| T51 | Permissão/escopo inválidos ou ficha convertida | Recusar sem efeitos parciais |
| T52 | Automação ou consulta em andamento durante retomada | Bloquear novas etapas/saídas do caso e conclusão antiga; preservar evidência incerta e outros atendimentos |

## 25. Jornada comercial simplificada — decisões de 21/10/2026

Pedido expresso do usuário: nove etapas em uma jornada simples, com dados reaproveitados, ações alinhadas e menos abas e legendas. Este registro aprova comportamento; não declara implementação, testes ou publicação.

**R32 — cadastro e apresentação.** Empresa com CNPJ inicia por campo CNPJ, consulta explícita, um único card cadastral editável e Prosseguir. Consulta bem-sucedida preenche a mesma ficha; destacar dados novos com marcador textual além de cor. Entrada manual coleta os dados cadastrais necessários no mesmo contexto, sem questionário adicional nesta etapa. Dados não obtidos não podem ser inventados. Informações complementares ficam no diagnóstico e na ficha final. Retirar logs da tela principal preserva auditoria interna. Anotação usa campo de texto e Salvar. Preservar atendimento PF e abertura sem CNPJ, adaptando campos aplicáveis.

**R33 — procuração e situação fiscal.** Procuração mostra orientação ao cliente, consulta SERPRO e alternativa “Validado por mim”. Usuário confirmou: validação manual identificada por usuário e data, sem justificativa livre obrigatória, permite avançar sem sucesso do SERPRO. Origem manual não comprova consulta oficial, validade ou poderes aceitos pelo provedor; não marcar ATIVA/SERPRO por declaração. Consulta externa continua sujeita à autorização e recusas reais do provedor. Situação fiscal permite consulta explícita e distingue sucesso técnico de regularidade fiscal. Em falha, oferecer registro manual ou pular a etapa, persistindo origem/autor/data e ausência de consulta válida, sem fabricar regularidade. Diagnóstico e PDFs conservam essa limitação.

**R34 — diagnóstico, documentos e envio.** Diagnóstico reúne cadastro, situação fiscal estruturada e PDF oficial quando disponível, regime e volumes declarados e demais dados necessários. Gera apresentação PDF completa na etapa seguinte, com origem/limitações; permite voltar para editar e invalida documentos derivados desatualizados. Apresentação oferece envio ao cliente e download. Proposta reaproveita ficha/diagnóstico, permite revisar dados, serviços e valores avulsos/recorrentes conforme modalidade e gera documento para envio/download. Contrato preenche modelo aprovado com dados do cliente e escritório, preserva prévia, envio e download. Não inventar valores, cláusulas, aceites ou assinatura. Envio continua explícito, por destinatário/canal válido, com evidência de resultado e proteção contra duplicação/incerteza.

**R35 — contratação por pagamento confirmado.** Decisão expressa: “Pagamento confirmado comprova contratação”. Substitui para o novo fluxo o marco de assinatura conferida de R28: confirmação do recebimento pelo contador/administrador autorizado, vinculada à proposta/contrato e revisão aplicáveis, confirma contratação, marca oportunidade ganha e habilita implantação. Assinatura permanece registrável, mas não é condição obrigatória desse novo marco. Não fabricar assinatura ou aceite digital. Mantêm-se demais requisitos de cadastro, permissão e entrada na carteira; pagamento não cria empresa automaticamente. Propostas/contratos e pagamentos legados preservam histórico; sem reclassificação em massa. Exceção de contratação externa R27 permanece identificada e justificada, sem virar atalho genérico.

**R36 — pagamento externo e ficha final.** Sem integração automática Asaas neste escopo: contador gera cobrança externamente e cadastra link/documento, com opção de envio pelo Altan ou registro de envio externo. Usuário confirmou que o contador confirma o recebimento; anexar comprovante ou receber mensagem não confirma pagamento sozinho. Persistir confirmação com autor/data, valor/referência e vínculo aplicável, respeitando versão e idempotência. Última etapa reúne ficha complementar editável por contador ou cliente e documentos recebidos por chat/upload externo, com vínculo e origem. Não misturar dados entre pessoas/fichas nem concluir implantação apenas por receber documentos.

Impacto: R19–R23, R27–R28; esta seção prevalece sobre instruções históricas de UI e assinatura em conflito. Não altera regras fiscais, guias de impostos ou R25. Testes sem mensagens, consultas pagas, assinatura, recebimento ou documentos fiscais reais; publicação não autorizada neste pedido.

| ID | Cenário | Resultado obrigatório |
| --- | --- | --- |
| T53 | Consulta CNPJ, edição manual, troca de CNPJ e retorno tardio | Mesmo card/ficha, origem indicada, sem sobrescrever edição ou outra empresa |
| T54 | Validação manual de procuração | Autor/data persistidos; avanço permitido sem afirmar verificação SERPRO |
| T55 | SITFIS falha, manual ou pulada | Estado explícito e limitação no diagnóstico/PDF, sem regularidade fabricada |
| T56 | Editar diagnóstico após gerar apresentação/proposta | Nova revisão; documento antigo não enviado como atual |
| T57 | Proposta/contrato preenchidos e canal indisponível/incerto | Documentos íntegros; envio bloqueado ou conciliável, sem duplicidade |
| T58 | Cobrança externa ou comprovante sem confirmação | Pagamento pendente; envio/download não marcam ganho |
| T59 | Contador confirma pagamento da revisão correta | Contratação ganha; implantação habilitada; assinatura não fabricada |
| T60 | Confirmação sem permissão, duplicada ou da revisão antiga | Recusa/resultado idempotente; sem conversão ou efeitos parciais |
| T61 | Documentos via chat e upload manual na ficha final | Origem e vínculo conservados; isolamento entre fichas/clientes |
| T62 | Desktop/celular, falha/recarga e navegação entre etapas | Ações legíveis, rascunhos preservados, ausência de logs na tela principal |
### Complemento R34 — conferência da apresentação, decisão de 21/10/2026

Resposta expressa do usuário: “Liberar após minha conferência do PDF”. A proposta pode ser liberada após ação explícita do contador confirmando a conferência da apresentação PDF vigente, sem exigir envio ou apresentação ao cliente. Registrar autor, data, ficha, diagnóstico e versão/hash do conteúdo conferido. Abrir a tela, visualizar ou baixar o PDF não registra conferência automaticamente. Mudança dos dados que invalide o diagnóstico/PDF invalida essa liberação; confirmação de revisão antiga deve ser recusada. Conferência interna não comprova envio, entrega, aceite ou aprovação pelo cliente. Preservar evidências históricas de apresentação/envio sem reclassificá-las como conferência nova.

| ID | Cenário | Resultado obrigatório |
| --- | --- | --- |
| T63 | Contador confirma conferência do PDF vigente sem enviar ao cliente | Proposta liberada; autoria/data e revisão persistidas, sem fabricar envio |
| T64 | Somente visualizar/baixar, confirmar revisão antiga ou mudar dados após conferência | Não liberar por leitura/download; recusar versão antiga e exigir nova conferência quando documento invalidado |
| T65 | Repetir confirmação ou falhar auditoria | Sem duplicidade ou persistência parcial; permissão e escopo verificados no servidor |

Histórico: decisão fecha a pendência da apresentação de R34. Usuário também autorizou uma rodada adicional limitada às seis compatibilidades identificadas (link sem conversa, dados legados, identidade CNPJ, honorários legados, consulta cadastral legada e endereço legado) e aos testes correspondentes. Não altera a política geral de rodadas; AutorizacaoDoLead.test.jsx continua pendente por decisão anterior. Sem autorização de publicação ou atos externos.

### Correção autorizada de AutorizacaoDoLead — 21/10/2026

O usuário autorizou corrigir AutorizacaoDoLead.test.jsx preservando as verificações, com nova execução dos testes e revisão antes de publicar. Esta decisão encerra a pendência histórica registrada acima. A correção aguarda a habilitação assíncrona do botão, sem mudar comportamento do produto, regras de negócio ou gates. Não autoriza publicação.

## 26. Entrega externa, parcelamentos e lembretes — decisões de 21/10/2026

O usuário aprovou registrar entrega externa com data e meio (pessoalmente, WhatsApp particular, e-mail externo ou outro), usuário e horário do registro. A declaração do contador encerra a pendência de envio da revisão documental indicada, com origem manual visível. Não comprova recibo de Meta/SMTP, pagamento nem liberação no portal. Datas de entrega são civis em Brasília; horário do registro não vira horário inventado da entrega. Exigir documento válido e preservar tentativa oficial de resultado incerto.

Complemento R11/R19/R20: persistir empresa, guia, competência, revisão/hash, data, meio, ator e instante com auditoria atômica e idempotência. Documento substituído ou invalidado não mantém envio concluído por declaração antiga; histórico permanece. Reserva de envio concorrente e declaração não podem duplicar saída. Entrega externa não substitui a prova específica exigida pelos lembretes WhatsApp ao destinatário atual.

Complemento R18: permitir configurar Guia mensal ou Débito automático por parcelamento, inclusive em indicação identificada antes de cadastrar o contrato completo. Informação desconhecida exige conferência, sem fabricar contrato ou pagamento. Registrar vigência, autoria, instante e histórico, preservando competências anteriores. Débito automático sem documento exigível retira a pendência de guia/envio, mantendo a conferência do pagamento; a forma efetiva acompanha também eventual guia avulsa vinculada à indicação. Não enviar cobrança incompatível por lote ou lembrete. Alteração de forma de pagamento não confirma baixa nem modifica lançamentos.

O usuário confirmou que as quatro indicações da Sintropia com finais 25-54, 25-20, 26-54 e 26-88 estão em débito automático. Complemento expresso de 21/10/2026: todos estão nessa modalidade desde o início de cada parcelamento. Autorizou configurar esses quatro casos após publicação aprovada. Usar a origem comprovada de cada acordo, sem inventar datas, fabricar contrato ou confirmar pagamento. A correção administrativa retrospectiva deve registrar autorização, autor, instante real e estado anterior; não remove a proteção geral contra edição retroativa.

Complemento R20: manter a agenda fiscal atual e separar a agenda de lembretes WhatsApp. A nova agenda é diária e configurável, com 8h como sugestão técnica; permanece desativada até salvamento explícito. Não há autorização de ativação produtiva neste incremento. Consultas fiscais não disparam mensagens; lembretes não consultam SERPRO. Preservar seleção de empresas e revalidá-la antes do transporte, além de contato autorizado, revisão, entrega comprovada, pagamento e proteção contra repetição de resultado incerto. Pendência ou falha não aparece como sucesso. O horário fiscal observado (dia 25 às 8h) não é imposto a outras instalações.

DP: o usuário definiu envio dos documentos de folha/pró-labore ao responsável da empresa. Estrutura informada: FOLHA 2026/pro-labore/empresa/arquivos; folha normal fora de pro-labore. Isso orienta a proposta de importação conferida, sem autorizar acesso a uma conta Drive, inventar vínculo por nome de pasta ou disparar documentos reais.

Benefício municipal: preparar campos de cadastro/configuração, sem presumir concessão, alíquota ou elegibilidade. Cadastro não equivale a suporte da emissão; a limitação e o bloqueio fiscal existentes permanecem explícitos até implementação e validação específica.

Impacto: R01/R02/R08/R10/R11/R12/R18/R19/R20/R21/R22. Decisões pendentes V02/V03/V05/V06 permanecem pendentes; esta seção não define matriz fiscal, efeitos de falha bancária ou cobrança alternativa. Registro não declara testes concluídos nem autoriza publicação, mensagens, consultas fiscais ou baixas reais.

| ID | Cenário | Resultado obrigatório |
| --- | --- | --- |
| T66 | Entrega externa com data/meio e documento vigente | Origem manual, ator e instante; fecha envio, preserva pagamento e recibos oficiais |
| T67 | Documento inválido, revisão antiga, escopo sem permissão ou data futura | Recusar sem persistência parcial |
| T68 | Declaração concorrente com envio, repetição ou falha de auditoria | Uma evidência coerente, reserva protegida e rollback atômico |
| T69 | Indicação sem contrato com débito automático configurado | Sem falta de guia/envio; vigência auditada, sem contrato ou pagamento fabricados |
| T70 | Guia avulsa vinculada à indicação em débito automático | Projeção e guardas de envio/lembrete concordam com a forma vigente |
| T71 | Troca de forma, competência anterior ou atualização concorrente | Histórico preservado, vigência respeitada e revisão antiga recusada |
| T72 | Lembrete diário independente da consulta fiscal | Zero consulta fiscal pelo lembrete; agenda fiscal e seleção preservadas |
| T73 | Agenda desligada, empresa retirada, recibo incompatível ou resultado incerto | Nenhuma saída indevida/repetida; motivo e pendência distintos de sucesso |
| T74 | Documento de parcela presente mas em conferência, pago ou enviado | Não contar como disponível válido antes da conferência |
| T75 | INSS VAZIO mensal já confirmado e documento real posterior | Mesma projeção em Operações/Guias, documento e conflitos têm precedência |

Complemento de integração de 21/10/2026: o usuário autorizou abrir PR, integrar na main e publicar este incremento somente após CI e revisões aprovados; em seguida configurar os quatro parcelamentos da Sintropia e conferir avisos. Não autoriza ativar a agenda de lembretes, enviar mensagens ou realizar baixas. Cenário T76: correção administrativa identificada desde a origem dos quatro acordos remove apenas avisos incompatíveis de guia/envio; histórico e pagamentos permanecem intactos, com recusa se identidade ou origem não puderem ser confirmadas.

## 27. Acompanhamento no vencimento — decisão de 21/10/2026

O usuário solicitou confirmação antes, no vencimento e após, e autorizou resolver o possível em desenvolvimento. Acrescentar NO_VENCIMENTO ao calendário útil existente: um dia útil antes, dia útil efetivo do vencimento, um dia útil depois. Preservar vencimento nominal do PDF e agenda fiscal separada. No dia, mensagem neutra de vencimento hoje e confirmação; atualização da guia continua restrita ao período posterior e aos serviços/guardas existentes.

Complemento R02/R11/R18/R20/R25: data inválida ou alterada pela conversão gera pendência explícita para o contador, nunca data inventada. Revalidar pagamento, débito automático, empresa, contato, consentimento, documento e entrega antes da saída. Reserva por guia/fase/vencimento/destinatário mantém identidade estável; revisão fica na evidência. Legado sem revisão ou revisão divergente exige conferência e não é sucesso atual, nem autorização para repetir resultado incerto. Não migrar recibos antigos com dados atuais. O modelo novo fora da janela exige aprovação/cadastro real; não reutilizar texto de atraso como D0 nem afirmar aprovação da Meta.

Impacto: calendário de comunicação e clareza das pendências. Sem mudança de prazo tributário, pagamentos, documentos ou dados reais. Incremento local, sem publicação, ativação de agenda ou mensagens. Proposta DP permanece proposta, não implementação.

| ID | Cenário | Resultado obrigatório |
| --- | --- | --- |
| T77 | Guia elegível nos três marcos e fuso Brasília | Uma fase correta por data útil; D0 confirma sem recálculo ou atraso |
| T78 | Data ausente, impossível ou ano alterado na conversão | Pendência VENCIMENTO_INVALIDO, sem reserva/envio e sem modificar guia |
| T79 | Legado sem revisão ou nova revisão sobre reserva anterior | Pendência de conferência; não declarar envio da revisão atual ou repetir saída |
| T80 | Janela fechada com template D0 ausente/não aprovado | Pendência, zero transporte livre e sem fallback de atraso |
| T81 | Pagamento/DA/contato/empresa alterados durante preparo | Revalidar antes da rede e impedir saída indevida |

## 28. Seleção de lembretes por empresa — decisão de 22/10/2026

O usuário solicitou uma área de configurações das empresas para lembretes e autorizou abrir PR, integrar na main e publicar somente após CI e revisões aprovados. Depois da publicação, resolver pendências do acompanhamento e apresentar decisões antes de ativar os lembretes. Esta autorização substitui o limite de publicação do incremento da seção27; não autoriza ativação, envio real, consulta fiscal paga ou baixa.

Em Configurações da empresa → Automação, a seleção de lembretes WhatsApp é independente das consultas fiscais e da seleção Pagamento. Ausência de configuração significa desligado; não copiar adesão fiscal para comunicação. Selecionar empresa não liga a agenda global. Horário e agenda global permanecem em Rotinas → Configuração → Agenda, com os três marcos da seção27. Registrar alteração com usuário, revisão e auditoria atômica; preservar controles de permissão, concorrência e repetição.

Revalidar seleção da empresa e agenda global antes do transporte. Empresa desmarcada, agenda desligada/incompleta, pagamento confirmado, débito automático incompatível, documento inválido, entrega sem evidência da revisão vigente ou contato não autorizado impedem saída. Não fabricar prova histórica ou repetir envio incerto para desbloquear acompanhamento. Consultas SERPRO mantêm sua agenda e seleção atuais.

| ID | Cenário | Resultado obrigatório |
| --- | --- | --- |
| T82 | Empresa sem seleção de lembretes e com Pagamento fiscal ativo | Lembretes desligados; seleção fiscal não herdada |
| T83 | Selecionar/desmarcar lembretes e confirmar alteração | Persistência auditada independente; demais consultas e agenda global preservadas |
| T84 | Usuário sem permissão, versão antiga, concorrência, replay ou falha na auditoria | Recusa ou repetição idempotente; nenhuma escrita parcial |
| T85 | Desmarcar empresa durante preparo do lembrete | Revalidação bloqueia transporte; zero consulta fiscal |
| T86 | Buscar lembretes nas configurações e usar computador/celular | Área encontrável, estados claros e controles acessíveis sem alargar a página |

Histórico: decisão expressa do usuário em22/10/2026; ativação e tratamento de evidências históricas continuam separados da publicação do código. Documento de folha cadastrado como guia exige reclassificação auditada própria, preservando PDF e envios; não corrigir com pagamento, vencimento inventado ou exclusão de histórico.
