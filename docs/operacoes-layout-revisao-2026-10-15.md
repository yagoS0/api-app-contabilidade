# Operações — revisão de layout e contrato de implementação

Data: 15/10/2026. Este documento reconcilia a especificação anexada pelo usuário, o mapa de lacunas e a correção mais recente de produto. É um contrato de implementação e aceite; não certifica publicação nem conclusão de toda a jornada guia–pagamento.

## Decisão vigente

Operações continua ao lado do Calendário. A instrução atual substitui a restrição anterior de não reutilizar sua apresentação: **Tarefas do dia deve apresentar o Calendário em modo dia**, usando seus dados e componentes existentes. Isso não transforma obrigações do Calendário em autorização para consultar, apurar ou transmitir. A execução fiscal continua independente, governada pela empresa, competência, aprovação e guardas existentes.

A página não apresenta uma lista extensa de conferências, horários e formulários de todas as empresas. A configuração continua dentro da empresa. Informações secundárias e resolução de problemas ficam em modais ou nas telas existentes.

## Hierarquia visual

1. Cabeçalho compacto: Operações, competência e atualização local.
2. Quadros clicáveis: situação operacional, pendências/erros e **Notas para revisão**. Cada quadro abre seu conjunto de empresas; o número representa o mesmo conjunto mostrado no modal. Categorias sobrepostas não devem ser somadas como empresas únicas.
3. Caixa **Empresas nas rotinas**, com contagens/grupos de habilitadas e não habilitadas. Clique abre a lista e permite entrar na empresa; a configuração efetiva permanece em Automação da empresa. Habilitada significa seleção persistida, não disponibilidade garantida para executar.
4. **Tarefas do dia**: apresentação diária existente do Calendário, com data visível e ordem temporal. Não substituir por pendências fiscais sem horário, não criar agenda paralela nem horários fictícios.
5. Conferência/liberação acessível por ação clara e modal, reaproveitando o serviço atual; evitar tabela/formulário aberto permanentemente. A central de apuração continua sendo o destino para revisar faturamento, anexos, imposto e divergências.

Usar tokens e Modal compartilhado. Estados de carregamento, erro, vazio e acesso insuficiente são visíveis; falha não vira contagem zero. Modal tem foco inicial, Escape/retorno ao acionador e rolagem própria. Em telas pequenas, cartões e ações quebram linhas sem criar rolagem horizontal da página. Não empilhar modais ativos nem esconder consequência de transmissão na confirmação final.

## Rotas e fontes de verdade

| Interação | Fonte/rota existente | Contrato |
| --- | --- | --- |
| Indicadores fiscais e erros de envio | Projeção da carteira `fluxoDaEmpresa`, consumida pela tabela Empresas | Ler os mesmos estados; não regravar status da tabela. Erro de envio continua visível em ambos os lugares. |
| Habilitação | `CompanyRotina`, `CompanyAutomationService`, `/firm/companies/:companyId/automacao` | Mostrar somente registros explícitos. Ausência não habilita. Leitura agregada, se adicionada, respeita `empresasVisiveis` e não consulta SERPRO. |
| Entrar na empresa/configurar | `companyTabPath(id, 'automacao')` → `/companies/:id/automacao` | Empresa é a única superfície de alteração; preservar revisão otimista e auditoria. |
| Revisar apuração | `companyTabPath(id, 'cadastroFiscal')` → `/companies/:id/cadastro-fiscal?competencia=AAAA-MM` | **Não usar `notasFiscais` como destino rotulado Apuração.** |
| Revisar notas/pendência | `companyTabPath(id, 'auditoria')` → `/companies/:id/auditoria?competencia=AAAA-MM` | Preservar a competência da ocorrência, mesmo diferente do filtro global. Abrir não resolve. |
| Ver notas fiscais | `companyTabPath(id, 'notasFiscais')` → `/companies/:id/notas-fiscais` | Rótulo deve ser Notas fiscais, nunca Central de apuração. |
| Avisos retroativos | GET `/firm/operacoes/avisos`, `PendenciaPosFechamento` | Somente empresas autorizadas, todas as competências, indicação de truncamento quando total excede os 200 itens. |
| Conferir/liberar | GET/PUT `/firm/companies/:companyId/operacoes/:competencia` | Persistência em `AppSetting`, revisão, auditoria e trava por empresa/competência. Confirmar não transmite. |
| Executar liberação | POST na mesma rota com `/executar`, `ManualTask`, `OperationsExecution` | Ação explícita com confirmação, trava/tentativa persistida, revisão fiscal atual e bloqueios rechecados. Leitura e abertura de modal nunca chamam esse endpoint. |
| Tarefas do dia | Componentes `CalendarioAgenda`/visão diária e carregamento existente do Calendário | Reuso visual e de leitura; não duplicar entidades, regras, editores ou scheduler. O dia é civil de Brasília. |

## Notas retroativas e caso CDA

`situacaoDoPeriodo` distingue TRANSMITIDA, APURADA e FECHADA. A linguagem do modal deve preservar essa distinção. **DAS importado isolado não prova transmissão e tampouco prova que a nota integrou a receita declarada.**

Para CDA, a revisão anterior registrou nota 14, emissão 03/10/2026 e competência fiscal 09/2026, com DAS salvo e sem extrato/recibo confirmado. Isso é evidência a conferir, não licença para afirmar transmissão nem alterar fechamento. O quadro pode indicar “Notas para revisão”; o detalhe explica a limitação conhecida e leva à auditoria/apuração de setembro. Não deslocar a nota para outubro, não resolver a pendência ao abrir e não retificar automaticamente.

Detecção em captura/importação reaproveita `registrarPendenciaDoPeriodo`, identidade deduplicada e persistência. Consultar o painel não faz varredura fiscal externa. Reanálise histórica local, quando necessária, deve ser explícita, auditável e não inventar prova oficial.

## Persistência, erros e proteção de efeitos

- Rotinas: `CompanyRotina`; configurações gerais existentes em `SerproRuntimeSettings`. Salvar não executa consulta. Conflito de revisão pede recarga; não sobrescreve em silêncio.
- Confirmação/liberação: `operations:v1:*` e tentativas `operations_execution:*`. Estado fiscal e fechamento internos continuam separados. Dados fiscais alterados invalidam aprovação; tentativa RUNNING/ATTENTION exige conferência, sem replay automático.
- Procuração: validar serviço, vigência, CNPJ/procurador e frescor da evidência no executor atual. Bloqueio aparece no contexto da empresa; abrir a tela não revalida externamente.
- Documentos: `OperationsDocuments`/`pgdasDocumentos` verificam evidências locais antes de capturar. DAS manual válido é reaproveitado; documentos completos dispensam HTTP. Dispensa de DAS zerado segue a regra existente.
- Falha de leitura: mostrar indisponibilidade e botão de atualizar somente dados locais. Falha de execução/timeout: preservar resultado incerto, orientar Tarefas/empresa e impedir repetição automática. Falha de envio: manter o estado existente e destino para Guias; não buscar novo DAS para corrigir transporte de mensagem.
- Acesso: endpoints filtram carteira e validam papel no servidor. Interface não oferece mutações a usuário somente leitura; execução revalida acesso após liberação.

## Aceite específico desta correção

| ID | Teste observável |
| --- | --- |
| O01 | Página inicial não contém lista extensa de todas as conferências nem formulários de programação por empresa. |
| O02 | Caixa de rotinas distingue habilitadas/desabilitadas com fonte persistida; modal permite acessar a empresa/configuração correta. |
| O03 | Tarefas do dia usa visão diária e dados reais locais do Calendário; seleção de dia preserva ordenação e não altera elegibilidade fiscal. |
| O04 | Quadro de notas abre lista autorizada por empresa/competência; CDA não é rotulada como transmissão comprovada só pelo DAS. |
| O05 | Links Apuração e Auditoria usam destinos corretos e mantêm competência; abrir/recarregar não resolve pendências. |
| O06 | Confirmar é local; liberar exige confirmação explícita. Regressões de procuração/contexto/duplicidade continuam aprovadas. |
| O07 | Carregamento/erro/vazio, usuário somente leitura, 390/768/1440 px e teclado são verificados. |
| O08 | Rede de teste comprova zero emissão, transmissão, SERPRO, DAS/extrato e mensagem externa ao navegar/abrir modais. |
| O09 | Calendário independente continua funcionando; nenhuma migração ou edição de seus dados ocorre para montar Operações. |

Resultados, comandos e capturas devem constar no relatório da implementação. Teste local não comprova implantação em produção. Não executar transmissão ou envio real para demonstrar o layout.

## Continuidade do plano original — limites reais

O mapa anterior continua válido para as frentes amplas. Esta revisão de layout não converte seletores `CompanyRotina` em política universal de workflow.

| Requisito do anexo | Base já identificada | Trabalho ainda necessário para afirmar conclusão integral |
| --- | --- | --- |
| A01–A06: políticas e pausas | Seleção empresa/rotina, guardas SERPRO e scheduler | Exceções por competência/etapa, modos manual/externo, pausa paga compartilhada até despacho e disputa legado/workflow. |
| A07–A10: evidência externa | Documentos locais, conciliação PGDAS-D e importação | Contrato integrado de política e validação contextual de revisão sem efeito duplicado. |
| A11–A18: revisão, recálculo e pagamento | Guide, capacidades restritas e evidências recebidas | Revisões universais, substituição/complementar, ISS manual único, distinção pagamento informado/conferido e concorrência com recálculo. |
| A19–A24: comunicação e custos | Avisos, callbacks, atendimento e reservas existentes | Intenções por revisão, retomada sem acúmulo, suspensão em todos os emissores e orçamento por contrato/tarifa. |
| A25–A28: acesso e efeitos | Guardas e execução de Operações persistida | Prova integrada em todos os caminhos, troca de executor/template, revogação e zero efeitos em leitura. |
| A29–A32: datas/identidades/UI | Regras e componentes atuais | Matriz completa de vencimentos, guias complementares/recalculadas e acessibilidade da jornada. |
| Pró-labore/INSS manual | Ingestão de guias e classificação de composição DARF existentes | Aplicabilidade mensal, tarefa humana com responsável/prazo, evidência externa e pendência de documento sem presumir folha transmitida. |
| Workflow durável | ManualTask e tentativas restritas de Operações | Coordenação geral, outbox, posse comum e transição controlada de todas as rotinas. |

Nenhuma dessas lacunas deve ser preenchida apenas com indicadores decorativos ou rótulos de sucesso. Implementar e homologar por fatias com PostgreSQL isolado, empresas sintéticas e transportes simulados, incluindo 50 empresas e falhas/concorrência antes de afirmar conclusão de A01–A32. O anexo não autoriza por si só mensagens ou efeitos fiscais reais; autorizações explícitas posteriores do usuário prevalecem no respectivo escopo.
