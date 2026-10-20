# Revisão Comercial e Contabilidade — 19/10/2026

**Estado atual:** correção da rodada 1 após o replanejamento: teste do plano global ajustado para respeitar a limpeza dos campos obrigatórios, sem alterar a validação do formulário. QA de geometria/CSS já renovada pelo Principal nos mesmos hashes atuais e lint completo concluído sem warnings. O gate web da rodada 0 reprovou nesse teste; nova execução e revisão do diff corrigido continuam necessárias. O alvo esclarecido é o menu do calendário. A avaliação abrange o diff total contra `6c62281678101691cc494637bb21fc6249378a1d`, incluindo o WIP preservado em `0a39a8fd3`. Os registros anteriores são históricos, não aprovação do diff atual.

## Histórico das etapas anteriores

Implementação delegada, rodada 0 e correção da rodada 1. Base: `6c62281678101691cc494637bb21fc6249378a1d`.
Estado inicial da rodada 0 de `git status --short`: limpo. A rodada 1 preservou o diff preexistente da rodada 0. Alterações restritas aos caminhos atribuídos pelo Principal. Nenhum commit, integração, publicação, dado real, envio, consulta fiscal ou alteração de permissão.

Referência operacional: snapshot integral fornecido ao executor, seções 1–23. Hash SHA256 conferido na fonte canônica `../altan-regras-operacionais/REGRAS_OPERACIONAIS.md`: `c1f80393382c5cc2d6ef1cbfe6b5841e0def479d57d4721dc3c99f83ab73bc94`. Aplicam-se R02/R19/R21/R22/R23; preservados R25/R26/R27/R28. Nenhuma política fiscal ou condição de contratação/pagamento modificada. V08 continua pendente para exclusão definitiva de oportunidade.

## Diagnóstico e correções

### Comercial

Origem dos números verificada no código:

- `ComercialPage`: `listarOnboardings({ incluirRascunhos: true })` → itens → oportunidades ativas → selo de Oportunidades e cartão Em andamento. Não existe constante 4 neste caminho. Retornos de hoje derivam das mesmas ativas com agendamento até o fim do dia; Onboarding conta etapas pendentes de EM_TRILHA.
- `etapaDaOportunidade` já prioriza DESISTIU, CONVERTIDO e CONCLUIDO_AVULSO sobre a projeção comercial. Desistência persistida já era excluída do selo, mas a lista padrão de Oportunidades mostrava todos os registros, inclusive perdidos/encerrados. Corrigida a divergência: lista padrão e selo usam `oportunidadeAtiva`. Filtros Perdido, Encerrado e Todas, incluindo encerradas conservam acesso ao histórico. Clicar novamente nas abas limpa busca/etapa para abrir a fila padrão.
- `OfficeNavigation` usa `useResumoWhatsapp`, selo de **mensagens comerciais não lidas**, não quantidade de oportunidades. Não foi alterado para ocultar mensagens por desistência de ficha: isso misturaria unidades e afetaria comunicação fora do escopo atribuído.
- Releitura existente a cada 30 segundos, foco/visibilidade e navegação foi mantida. O teste novo simula retorno de status DESISTIU e retirada da fila/selo. Não foi consultado o conjunto real referido como “4”; a origem exata daquele número em ambiente real continua sem reprodução.

Entrada para desistir/descartar permanece a ficha `/onboardings/:id`. `OnboardingService.desistir` persiste status/evento; `descartar` mantém restrições de rascunho/vínculos e versão. Não foi criada exclusão adicional nem executado descarte. Ganha na assinatura, implantação e carteira permanecem marcos separados.

### Lançamentos e Circular

`useManageAccountingWorkspace.loadCircular` não descartava resposta de empresa, ano ou competência anterior nem consultas superadas. Agora identifica contexto e ordem da consulta, e expõe a matriz somente no contexto carregado. Recarga falha conserva a matriz anterior do mesmo contexto com erro. Falha da conferência deixa de ser silenciosamente convertida em conferência vazia: mantém a matriz anual, `accountingReview: null` e motivo explícito.

Leitura do plano de contas também descarta resultados superados/de outra empresa; erro ou resposta inválida conserva os dados anteriores. Na rodada 1, o erro passou a ter estado próprio por contexto, exposto em `chartOfAccountsState.error` e composto com `entriesError` para os consumidores existentes. Uma leitura válida limpa somente a falha do plano; preserva erro da conferência/lançamentos. Não muda gravações ou permissões. Defeito ainda pendente: `renderCompanyDetailPage.jsx` não encaminha erro/carregamento à página isolada `ChartOfAccountsPage`; ambos estão fora dos caminhos autorizados, portanto a apresentação nesse consumidor não foi corrigida.

Circular mantém a tabela montada durante atualização do mesmo contexto, anuncia carregamento/sucesso/erro e oferece região de rolagem focável por teclado. A rodada 0 pretendia apresentar receita zero como R$ 0,00, mas o gate revelou que `fmtValor(0)` retornava vazio. A rodada 1 acrescentou o zero formatado explicitamente nessa célula; ausência mantém traço identificado como faturamento não informado. O teste ainda precisa ser reexecutado. Totalizações, composição, baixa, estorno e confirmações existentes foram preservados. Não é revisão completa dos totais ausentes nem de todos os callbacks de gravação do workspace.

Na rodada 1, resposta anual exige `provisoes` como array e `receitas`/`extrato` como objetos, conforme produtores real e mock; `{}` não substitui mais a matriz válida. Não se trata de validação profunda de todas as provisões. Testes escritos distinguem carga inicial sem matriz de atualização com matriz válida, e exercitam troca de ano e competência com respostas antigas pendentes.

### Parcelamentos

`useParcelamentos.load` convertia resposta não-array em lista vazia e apagava a lista após erro de rede. Agora informa falha e preserva a última lista válida. `listConferencia` rejeita resposta sem `items` em vez de afirmar fila vazia. Array vazio válido continua sendo vazio legítimo. Escopo por empresa/status e proteção de concorrência existentes foram conservados. Não altera débito automático, baixa, rescisão ou atos do contrato.

### Relatórios

`AnaliseEmpresa` e `ClientesRelatorio` aceitavam objetos incompletos como sucesso; o render subsequente acessava estruturas ausentes. Acrescentada validação das estruturas consumidas antes de atualizar os dados, inclusive na revalidação da impressão de clientes e leitura de lançamentos da conta. Erro continua recuperável, sem fallback fictício. Não se trata de schema completo de cada campo numérico. Fechamentos, comparação indisponível, lacunas, origem e cálculos permanecem nos contratos existentes.

## Inventário estático de navegação e estados

Fontes: `renderCompanyDetailHeader.jsx`, `renderCompanyDetailPage.jsx`, `RelatoriosTab.jsx`, componentes e hooks citados acima. Inventário de entrada não equivale a teste funcional de todas as ações.

| Área / destino da empresa | Conteúdo e entradas secundárias | Cobertura desta rodada |
| --- | --- | --- |
| `/lancamentos` | Competência, tabela, filtros, criação/edição, baixa, fechamento/correção, importações OFX/Excel, exportação, conferência, plano de contas | Hook inspecionado; proteção de consulta do plano; regressões existentes de paginação preservadas. Atos financeiros e fechamento não executados |
| `/conferencia` | Filas, regras e lançamentos automáticos; acesso a partir de Lançamentos | Entrada inventariada; funcionamento detalhado e visual pendentes, fora dos arquivos atribuídos |
| `/plano-contas` | Plano acessível por Lançamentos; sem subaba própria no cabeçalho | Leitura protegida no hook; página e atos de edição/importação não alterados |
| `/circular` | Matriz anual, competência de revisão, subtotais, documentos, edição/baixa/estorno | Correções descritas; testes novos de atualização, erro, concorrência e zero explícito |
| `/parcelamento` | Gestão/contratos, conferência de comprovantes, parcelas pagas, prestações sem guia, configuração/composição, rescisão/desfazer, novo contrato | Hook corrigido; entradas/filas inventariadas. Modais/atos apenas preservados, não homologados nesta rodada |
| `/relatorios` — Visão geral | Período próprio por fechamento, indicadores, evolução, cobertura | Validação estrutural da resposta; vazio/erro/sem fechamento já têm tratamentos existentes |
| `/relatorios` — Clientes | Busca/filtros/ordenação, paginação, notas por cliente, impressão | Validação estrutural na carga/impressão; testes de erro incompleto |
| `/relatorios` — Resultado | DRE completa, Despesas por categoria, detalhe da conta, bases gerencial/sócios | Resposta incompleta do detalhe passa a erro. Revisão funcional de todas as gravações das bases pendente |
| `/relatorios` — Tributário | Guias por competência, carga e pagamento atual | Estruturas de leitura protegidas; sem alteração fiscal/financeira |
| Projeção financeira | Acesso operacional separado dos relatórios fechados, via `FluxoLeitura` | Entrada inventariada; nenhum cálculo/ato alterado |
| Históricos, funções, regras e importações internas | Ações secundárias de Lançamentos/Conferência | Inventário de existência; execução completa e QA pendentes |
| Notas — menu de três pontos | Pedido de simplificação visual | **Não implementado**: nenhum caminho de Notas está na lista exata autorizada deste executor; requer atribuição pelo Principal |

Estados novos cobertos por testes escritos: ativa/perdida/encerrada e releitura comercial; resposta inválida/vazia válida/erro e recuperação em parcelamentos; resposta tardia/superada e falha de conferência na Circular; matriz preservada em recarga; faturamento zero versus ausente; análise/clientes incompletos e impressão recusada. Estados de permissão, fechamento reaberto, pagamentos CLIENTE, auditoria, callbacks de todas as mutações, todos os modais e grandes volumes precisam dos testes de integração/gates do controlador. Não alegar cobertura integral por este inventário.

## Evidências do executor na rodada 0

- `git diff --check`: executado, sem erros.
- `node scripts/governance/check.mjs plan --base HEAD`: tentativa real bloqueada antes da execução, Node `EPERM: operation not permitted, lstat 'C:\Users\yagoa'`.
- `npm test --workspace apps/web -- --runInBand --runTestsByPath src/features/comercial/__tests__/ComercialPage.test.jsx src/app/hooks/__tests__/useManageAccountingWorkspace.test.js src/features/accounting/parcelamento/hooks/__tests__/useParcelamentosEscopo.test.jsx src/features/planejamento/pages/__tests__/relatorioEstados.test.jsx src/features/planejamento/pages/__tests__/clientesRelatorio.test.jsx`: tentativa real bloqueada pelo mesmo EPERM antes do Jest. **Nenhum teste foi aprovado nesta execução.**
- Testes adicionais da Circular escritos em `renderCircularTab.test.jsx`; executar também `useManageAccountingWorkspaceCallbacks.test.js`, suites de análise/fechamentos, regressões contábeis/comerciais e tokens no controlador. O teste novo de zero e os últimos ajustes ocorreram após a tentativa bloqueada; precisam igualmente da execução real.
- Sem build executado. Sem browser/capturas/QA visual. Principal fará validação desktop/mobile local, incluindo filtros comerciais, atualização/erro/zero na Circular, preservação de foco/rolagem, Parcelamentos e todas as subabas de Relatórios.
- Revisões independentes, gates e registro de governança pertencem ao controlador/Principal. Este executor não os iniciou novamente, não modificou governança e não declara aprovação própria ou de revisores.

## Gates do controlador na rodada 0

Logs inspecionados em `.altan-governance/runs/2026-10-19T22-58-22-082Z-6eadd8f8/`, relativos ao fingerprint `9b64f09b058c6c25ec2fca55e61d3774bddded6912ab7f78a7bd237d554abfe7`. Estes resultados são anteriores às correções da rodada 1, não aprovação do diff atual.

| Gate | Evidência observada |
| --- | --- |
| web-regression | Interrompido no batch-1: 24 suítes aprovadas, 1 falha; 994 testes aprovados e 2 falhos. Falhas na Circular: receita zero e expectativa antiga de esconder tabela durante atualização |
| api-regression | Interrompido após progresso de 500/619 suítes: EPERM ao renomear `manifest.tmp` para `manifest.json`. Não é regressão completa aprovada; nenhum código da API/gate alterado para contornar o erro |
| portal-regression | 99 suítes e 1.580 testes aprovados |
| governance-engine | 63 testes aprovados |
| web-build / portal-build | Ambos concluídos nos logs; não comprovam testes funcionais ou QA visual |

## Correção e evidências do executor na rodada 1

- Corrigidos zero explícito e teste de carga inicial. Acrescentada validação estrutural da matriz anual e recuperação independente do erro do plano de contas.
- Testes escritos: resposta anual nula/incompleta preserva matriz; troca de ano descarta resposta antiga e oculta dados anteriores; troca de competência descarta conferência antiga; plano inválido preserva contas e recuperação conserva erro independente; falha tardia não vence consulta nova; troca de empresa isola plano.
- Comercial: testes de limpeza de busca/etapa ao clicar novamente na aba, releitura sem rascunho descartado e resposta antiga concorrente com desistência. O teste usa o hook real do resumo e conserva quatro mensagens não lidas enquanto a oportunidade desistida sai da fila ativa. Isso distingue unidades; não reproduz o indicador real relatado e não monta `OfficeNavigation`, nem executa desistência/descarte no servidor.
- Parcelamentos: teste com `useParcelamentos` e `ConferenciaParcelasPanel` reais, API simulada; resposta incompleta deve mostrar aviso e retentativa, resposta vazia válida deve recolher a fila, sem aprovar baixas. Não foi executado neste sandbox.
- Tentativa de `node scripts/governance/check.mjs plan --base HEAD`: bloqueada por `EPERM: operation not permitted, lstat 'C:\Users\yagoa'` antes de executar o plano. Mapa de domínios consultado; não alterado.
- Tentativa de `npm test --workspace apps/web -- --runInBand --runTestsByPath` para `ComercialPage.test.jsx`, `useManageAccountingWorkspace.test.js`, `useManageAccountingWorkspaceCallbacks.test.js`, `renderCircularTab.test.jsx`, `useParcelamentosEscopo.test.jsx`, `relatorioEstados.test.jsx` e `clientesRelatorio.test.jsx`: bloqueada pelo mesmo EPERM antes do Jest. O teste integrado de conferência e ajuste do fixture de resumo foram escritos após essa tentativa; também aguardam execução no controlador. **Nenhum teste ou build foi aprovado pelo executor na rodada 1.**
- `git diff --check`: executado após as correções, sem erros. Sem modificação de governança, permissões ou arquivos fora da lista exata.
- Pendências de atribuição: consumidor de erro/carregamento do plano de contas e menu de Notas estão fora dos caminhos autorizados. A inspeção não substitui a ligação visual nem autoriza edições nesses arquivos. QA desktop/mobile, integração entre Circular/Empresas/Operações e novos caminhos dos relatórios no `PainelPage` continuam pendentes. Revisores reais e gates atualizados cabem ao controlador; nenhum parecer foi presumido como aprovação.

## Risco, rollback e pendências

Risco alto pelo domínio contábil e consumidores de relatórios (inclui portal); alterações somente de leitura/apresentação, sem persistência/migração. Rollback: reverter seletivamente o diff desta rodada nos caminhos atribuídos, preservando quaisquer alterações concorrentes posteriores. Não há reversão de dados.

O trabalho entregue é um incremento delimitado, não a conclusão de toda a solicitação original. Pendências: execução dos testes pelo controlador, revisões reais, QA visual, atribuição do menu de Notas e revisão funcional das ações/subabas fora destes arquivos. Identificação do selo real “4” permanece sem dados de reprodução; não justificar exclusão definitiva para resolver essa incerteza. Nenhuma nova decisão de negócio foi necessária para estas correções independentes; V08 continua necessária se o pedido evoluir para exclusão definitiva além do descarte existente.

## Continuação delegada — consumidores, calendário e procurações

Base desta execução: `fb2e69e86ac88c6832e77532bb2e0a373efde2f2`. `git status --short` e `git diff HEAD` inicialmente vazios: o incremento anterior já estava nesta base. Nenhum commit feito pelo executor. Todas as edições desta execução estão nos caminhos exatos atribuídos. Referência canônica conferida novamente por SHA256, igual a `c1f80393382c5cc2d6ef1cbfe6b5841e0def479d57d4721dc3c99f83ab73bc94`.

### Correções e inventário dos consumidores

| Entrada | Fonte e comportamento nesta continuação |
| --- | --- |
| Plano da empresa | `App` encaminha carga/erro do hook até `ChartOfAccountsPage`. Carga/falha inicial não afirma zero contas. Retentativa relê; falha de recarga conserva contas e formulário. Resultado de outra empresa fica oculto desde a mudança de contexto |
| Plano global | Resposta não-array é falha explícita, preservando última lista. Carga, retentativa, resposta superada e troca de API tratadas; gravação concluída não é repetida por falha da leitura seguinte |
| Lançamentos | Erro do plano continua no canal composto já existente; aviso de carga e botão de releitura adicionados. Cadastro, importações, históricos, funções, baixa e fechamento preservados |
| Circular | Mesmo encaminhamento do plano e retentativa. A região de atualização mantém altura quando o texto some; tabela já preservada durante recarga. Teste verifica identidade da tabela e permanência da região. Composição, tributos, pagamentos e confirmações inalterados |
| Guias | Erro/carga do plano e retentativa próximos ao consumidor; acesso direto agora carrega contas para ingestão de parcelamento, sem depender do clique anterior |
| Parcelamentos | Erro/carga do plano e retentativa antes da aba; acesso direto carrega contas para configuração/novo contrato. Não altera baixa, conferência, débito automático ou histórico |
| Conferência e Relatórios | Não consomem `accountingPanel.accounts` nesta ligação. Mantidas suas leituras e as correções da base; inventário anterior das subabas continua válido, sem alegar homologação de todos os atos |
| Comercial | Inspeção confirma `oportunidadeAtiva` tanto em `ativas`/contadores quanto na fila padrão; histórico continua em filtros explícitos. Nenhuma edição adicional: fora da allowlist desta continuação. Mensagens não lidas permanecem outro indicador |
| Calendário | CSS de `MenuTarefaCalendario`: gatilho sem caixa ornamental, itens neutros e tokens existentes de raio, espaçamento, sombra e hover. JSX/handlers, duplicação, exclusão, confirmação, gestos e alvos preservados. Regressão de teclado cobre setas, Escape, retorno ao gatilho e identidade do item |
| Empresas / Consultas | `marcadorProcuracao` passa a rotular ATIVA + vínculo confirmado + validade futura + consulta válida com idade ≥24h como **Ativa na última verificação**. A chave continua `revalidar`, com data e orientação para atualizar antes de operar. Consultas mantém filtro Ativas separado e não inicia consulta ao renderizar |

Procurações: validação de datas também recusa datas civis impossíveis, como 30/02, que `Date` normalizaria. A implementação histórica desta etapa dava precedência indevida a tentativa sem vínculo confirmado; esse defeito foi reprovado e corrigido no incremento abaixo. Consulta futura/inválida, vínculo da evidência não confirmado e validade ausente/inválida não recebem o novo rótulo histórico. TTL de 24h, enum dos filtros e autorização fiscal do servidor não mudam. Nenhum acesso a produção ou SERPRO foi feito pelo executor; o exemplo informado pelo Principal foi contexto, não fixture consultado.

Regras afetadas: R02, R19, R21, R22 e R30 na leitura/apresentação. Preservadas R23/R25/R26/R28 e políticas pendentes. Sem persistência, migração, novas permissões, exclusão definitiva ou mudança de matriz fiscal. Risco permanece alto pela superfície contábil/fiscal; rollback é reversão seletiva dos arquivos desta continuação, sem reversão de dados.

### Falha anterior localizada e validação real

Log da rodada anterior: `.altan-governance/test-batches/web-2SUeHE/batch-9.stderr.log`. A única falha desse batch era `baixaRecusaChegaNaTela.test.js`, cenário de baixa aceita: fixture `{ months: [] }` era recusado pela validação estrutural da Circular. Corrigido para `{ provisoes: [], receitas: {}, extrato: {} }`, correspondente ao contrato real/mock. Asserção de erro vazio preservada; novo cenário exige aviso quando a baixa foi aceita mas a releitura é inválida, sem segunda gravação. Não foi removida nem flexibilizada a validação da implementação.

Logs históricos da rodada 1 inspecionados: API 618 suítes/10.897 testes aprovados, uma suíte/teste pendente; portal 99 suítes/1.580 testes aprovados. Web interrompido no batch 9, após oito batches; naquele batch 24 suítes/226 testes aprovados e um teste falho. Esses resultados são anteriores a este diff e não o aprovam.

- `node scripts/governance/check.mjs plan --base HEAD`: tentativa bloqueada por `EPERM: operation not permitted, lstat 'C:\Users\yagoa'` antes do plano. Mapa consultado; nenhum gate ou permissão alterado.
- `npm test --workspace apps/web -- --runInBand --runTestsByPath src/features/accounting/chart-of-accounts/pages/__tests__/estadosPlanoContas.test.jsx src/app/hooks/__tests__/baixaRecusaChegaNaTela.test.js src/app/hooks/__tests__/useManageAccountingWorkspace.test.js src/features/fiscal/serpro/lib/__tests__/procuracao.test.js`: tentativa bloqueada pelo mesmo EPERM antes do Jest. Nenhum teste aprovado nesta execução.
- `git diff --check`: executado sem erros. Verificação textual não substitui build, testes nem navegador.
- Acrescentadas regressões de integração dos cinco consumidores em `avisosContabeisNasAbas.test.jsx`, de estado/data/filtro em `tabelaEmpresasLeitura.test.jsx` e `resultadosForaFiltro.test.jsx`, e de teclado em `CalendarioAcoesEstabilidade.test.jsx`. Executar também `renderCircularTab.test.jsx`, regressões comerciais e callbacks contábeis. Alterações posteriores à tentativa bloqueada continuam sem execução local.

### Pendências para o Principal

Executar gates/testes finais e revisões independentes reais sobre o novo diff. A escalada anterior por capacidade do revisor não representa consenso. Este executor não delegou nem aprovou o próprio trabalho.

Naquele momento, QA de navegador permanecia com o Principal. As evidências posteriores e os limites atuais estão registrados abaixo. Nenhuma captura ou validação visual foi realizada por este executor. Nenhuma publicação, integração, mensagem, alteração de dados reais, segredo ou permissão foi realizada.

## Inventário final após replanejamento — rodada 0

Lidos integralmente `.altan-governance/auditorias-principal.txt`, o feedback de `rounds[0].reviews` e o parecer backend do run `2026-10-20T00-02-09-089Z-f6e6bc32`; conferido o erro real de `web-FOz7hH/batch-12.stderr.log`. O run anterior foi interrompido pelo Principal para ampliar o escopo ao adaptador real e testes. Não representa aprovação. Hash da referência operacional canônica novamente conferido: `c1f80393382c5cc2d6ef1cbfe6b5841e0def479d57d4721dc3c99f83ab73bc94`.

| Área | Estado do incremento atual |
| --- | --- |
| Plano da empresa/global | `realApi.getChartOfAccounts` e `getGlobalChartOfAccounts` exigem envelope `data` array antes de normalizar. HTTP 200 inválido/JSON ilegível rejeita; `{data:[]}` permanece vazio legítimo. Hook/páginas preservam última lista e rascunho na falha; recuperação é releitura |
| Parcelamentos | Rastreio encontrou o mesmo fallback em `realApi.listParcelamentos`; corrigido no mesmo arquivo autorizado. Teste usa adaptador real + hook para verificar preservação/recuperação. Conferência repassa payload e o consumidor exige `items` array |
| Relatórios | `getAnalisePlanejamento`, `getAnaliseClientes` e `getAnaliseLancamentos` repassam payload sem fabricar arrays. Validações estruturais existentes nos consumidores continuam responsáveis pelo HTTP 200 incompleto. Testes do transporte cobrem propagação de recusa HTTP/rede e preservação do payload incompleto |
| Procuração | Restaurado `ultimaTentativa.vinculoConfirmado === true` para precedência de ERRO/CONSULTANDO. O DTO compara o vínculo da tentativa separadamente da evidência. Testes cruzam true/false/undefined com evidência recente/antiga e os dois estados. ATIVA antiga elegível continua **Ativa na última verificação**, chave `revalidar`; TTL/autorização fiscal intactos |
| Detalhe da procuração | Restaurado texto humano **Último resultado válido: Procuração ativa**, mantendo erro recente e orientação. A expectativa de `fluxoCarteiraTabela.test.jsx:59` foi preservada integralmente; incluída no comando de regressão |
| Circular | Slot de carga agora tem altura de 40px incluindo padding de 16px e linha de 24px. O aviso do plano permanece montado, com linha reservada mesmo em repouso; erro/recuperação pode expandir sem ocultar conteúdo. Tabela e proteção de empresa/ano/competência preservadas. Testes DOM não comprovam geometria de navegador |
| Escopos de leitura | Fábricas `useMemo` agora contêm suas dependências concretas, preservando identidade por visita e invalidação A–B–A sem suprimir warnings. Integração nova cobre resposta antiga após A–B–A |
| Calendário | Markup de `AtividadeAgenda` conferido: checkbox, abertura e menu são irmãos. Somente mês acima de 640px usa `flex-wrap:nowrap` e `flex-basis:0` na abertura. Mobile, semana/dia, gestos, progresso, subtarefas e handlers preservados |
| Comercial e demais abas | WIP anterior conservado, sem novas regras. QA real do Principal descrita abaixo; não há alteração adicional de contratação, oportunidade ganha, pagamento, baixa, fechamento ou comunicação |

### Evidências já executadas pelo Principal

Ambiente local `localhost:5294`, `VITE_API_MODE=mock`, dados fictícios. Lançamentos, Circular, Parcelamentos, quatro visões de Relatórios e Plano de Contas abertos/inspecionados em 1440px e 390px, com buscas e avisos. A Circular conservou a matriz; a medição anterior de `table.top` passou de 225,140625 para 239,640625 ao atualizar (14,5px), motivando a correção atual.

Calendário mês/semana/dia: duplicação, exclusão confirmada apenas da cópia, setas/Escape e retorno de foco exercitados. `OperationsDailyCalendar`: menu em 1440/390px, duplicação/exclusão da cópia e Escape ao gatilho, original preservado. Capturas em `.altan-governance/visual/`, incluindo `operacoes-menu-1440.jpg` e `operacoes-menu-390.jpg`. A mudança CSS atual restringe-se ao mês desktop; a renovação desse acabamento pelo Principal está registrada abaixo.

Comercial: `.altan-governance/qa-playwright/comercial.cjs` e `resultado.json` registram quatro oportunidades criadas pela UI, desistência com motivo via `window.prompt`, retorno a três ativas no selo/cartão/lista e quatro no histórico. Suporte preservou seis mensagens não lidas. Capturas `comercial-ativas-4/3`, `comercial-historico-4` e `comercial-historico-mobile` foram inspecionadas pelo Principal. Este executor conferiu o JSON. Percurso com navegação/ficha/transport mock real da UI; não certifica persistência produtiva. Limitação de prompt do IAB foi superada no Chrome local, sem defeito de produto inferido.

Conferência: `.altan-governance/qa-playwright/conferencia-resultado.txt` registra clique em Lançar da tarifa fictícia de R$175. `postConferenciaAcao` mock apenas ecoa o pedido e não persiste; a fila permaneceu igual. Não há comprovação de contabilização ponta a ponta nem operação real.

Gates anteriores: API 10.897 pass/1 skip, portal 1.580 pass, governança 63 pass e builds web/portal pass, conforme evidências do Principal. Web falhou no batch12 (409 pass/1 fail). Esses resultados históricos não aprovam o diff total atual.

### Validação deste executor e pendências específicas

- `git diff --check`: executado sem erros; avisos de conversão LF/CRLF não são teste funcional.
- `node scripts/governance/check.mjs plan --base 6c62281678101691cc494637bb21fc6249378a1d`: bloqueado antes da execução por `EPERM: operation not permitted, lstat 'C:\Users\yagoa'`.
- `npm test --workspace apps/web -- --runInBand --runTestsByPath` com `leiturasContabeisContrato.test.js`, `planoContasRealApiIntegracao.test.jsx`, `estadosPlanoContas.test.jsx`, `procuracao.test.js`, `fluxoCarteiraTabela.test.jsx`, `renderCircularTab.test.jsx` e `avisosContabeisNasAbas.test.jsx`: bloqueado pelo mesmo EPERM antes do Jest. Acréscimos posteriores de testes também não foram executados neste sandbox.
- Tentativa anterior do executor de `npm run lint --workspace apps/web -- --quiet`: bloqueada pelo mesmo EPERM. Posteriormente, o Principal executou `npm run lint --workspace apps/web`, exit 0, sem warnings, conforme `.altan-governance/lint-final.log` e auditorias. Os warnings não foram suprimidos.

Os novos testes exercitam adaptador real com transporte simulado, página/formulário da empresa e global, recuperação e preservação do rascunho, escopo A–B–A, listagem/conferência de parcelas e matriz de vínculo da procuração. Nenhuma aprovação de testes é declarada pelo executor. Principal/controlador devem executar os gates atuais e revisores independentes sobre o diff total, incluindo os dois testes novos ainda não rastreados pelo Git.

### Renovação visual realizada pelo Principal e conferida nesta rodada 1

Fonte: `.altan-governance/auditorias-principal.txt`, seção QA RENOVADA após replanejamento 00-52, em localhost mock. Medições via CUA/DOM após cliques na UI, sem injeção de estado. Este executor conferiu os hashes locais; não realizou essa QA nem modificou os três arquivos nesta rodada.

| Superfície | Medição registrada pelo Principal | SHA256 atual conferido |
| --- | --- | --- |
| Circular | `table.top` 232,390625 em 1440px e 407,140625 em 390px, iguais antes/durante Atualizar; status de 40px; deslocamento zero | `renderCircularTab.jsx`: `0DA8F4C7484E45C8C8C7252E43E8C8DDDC1E06163D43608B14E8E661D2974A13` |
| Aviso do plano | Slot de 40px antes/durante carga; heading da Circular estável em 137px desktop e 263,75px mobile; novo contexto mostra Carregando até sua consulta concluir | `renderCompanyDetailPage.jsx`: `B67386DB82804969A0C80F971122314ABB05BAEBEE76E2DBCAF85595FE096920` |
| Calendário mensal desktop | Título e menu na mesma linha: top 521,984375 e altura 28px em 1440px; media mobile preservada e QA anterior de handlers em 390px permanece aplicável | `agenda-workspace.css`: `31EDCEC5FD4FD18CB89A5EE64B247159863B95B038A0D25B254EC9ABD8A7E746` |

Capturas registradas pelo Principal: `.altan-governance/visual/calendario-menu-final-1440.jpg` e `circular-final-390.jpg`. Não há renovação geométrica pendente para esses mesmos hashes; mudanças futuras nesses arquivos exigem renovar a validação afetada. Essa evidência não comprova contabilização persistida na Conferência mock nem aprova globalmente o diff.

### Gates do replanejamento e correção da rodada 1

Run `2026-10-20T00-52-11-371Z-80be3596`, rodada 0, fingerprint revisado `a95dac630bda81267d76e32023b17489ce1adeb3a9ce0b59f87fb3a0548734ab`: API 10.897 aprovados/1 pendente, portal 1.580 aprovados, governança 63 aprovados e builds web/portal concluídos. O **web-regression reprovou**, conforme `round-0-gate-web-regression.stdout.log` e `web-F2VVsj/batch-1.stderr.log`: 24 suítes aprovadas/1 falha, 368 testes aprovados/1 falho. O teste `estadosPlanoContas.test.jsx:25` exigia Adicionar habilitado após o formulário limpar código e nome obrigatórios. Esses resultados não aprovam a rodada corrigida.

Nesta rodada 1, somente o teste e este documento foram editados. O teste agora aguarda código/nome vazios, exige Adicionar desabilitado, preenche novo código/nome válidos e verifica habilitação. Após Tentar novamente, verifica ambos os campos preservados, botão habilitado e exatamente um POST. Nenhuma validação de produto foi enfraquecida.

Tentativas deste executor: `node scripts/governance/check.mjs plan --base 6c62281678101691cc494637bb21fc6249378a1d` e `npm test --workspace apps/web -- --runInBand --runTestsByPath src/features/accounting/chart-of-accounts/pages/__tests__/estadosPlanoContas.test.jsx` bloquearam antes da execução por `EPERM: operation not permitted, lstat 'C:\Users\yagoa'`. Sem mudança de permissões ou tentativa de contorno. Nova execução do teste/gates e revisão independente do diff corrigido cabem ao controlador/Principal; este executor não declara aprovação. Não há nova decisão de negócio: V02/V03/V05–V08 continuam fora deste incremento.

Impacto: R02/R19/R21/R22/R30, somente integridade das leituras e apresentação; sem regra fiscal/comercial nova, migração ou mudança de permissões. Risco alto pela superfície contábil/fiscal compartilhada. Rollback: reverter seletivamente os hunks desta rodada nos caminhos atribuídos, preservando o WIP anterior e trabalhos concorrentes; não há dados a reverter. Nenhum deploy, merge, commit, envio ou acesso produtivo realizado. Este executor não delegou nem relançou o controlador e não aprova o próprio trabalho.
