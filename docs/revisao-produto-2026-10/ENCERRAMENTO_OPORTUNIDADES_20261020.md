# Encerramento de oportunidades — desenvolvimento, 20/10/2026

## Escopo e estado da entrega

Base de revisão: `96a0dd5`; implementação preservada nos checkpoints `c55da0bde` e `4cc1c0a40`. Revisão e gates devem considerar **toda a diferença desde a base**, incluindo a continuação não commitada. Este relatório não declara aprovação independente, testes novos aprovados ou publicação. As seções de rodadas anteriores registram o estado histórico; a atualização mais recente de evidências está ao final.

O diagnóstico do Principal identificou quatro oportunidades ativas com histórico. A solução disponibiliza ações para o usuário decidir; não altera esses registros. Fixtures e exemplos deste incremento são sintéticos, sem nomes ou identificadores reais.

Regras consultadas: fonte operacional canônica com SHA256 `c1f80393382c5cc2d6ef1cbfe6b5841e0def479d57d4721dc3c99f83ab73bc94`, igual ao snapshot informado. R19–R23 orientam persistência, revisão, listas, erros e exclusão. R27–R28 permanecem: desistir não modifica contratação, pagamento, ganho ou entrada na carteira. V08 não foi usada para criar arquivamento, restauração ou exclusão ampla. Nenhuma migração ou mudança de regra operacional/governança.

## Comportamento implementado

- Comercial, detalhe e lista de Onboarding compartilham menu discreto com portal, navegação por teclado e confirmação pelo Modal existente.
- Encerrar oportunidade registra `DESISTIU`, com motivo opcional e histórico preservado. A confirmação explica os filtros reais: Perdido/Todas no Comercial e Encerrados no Onboarding.
- Excluir rascunho consulta elegibilidade somente leitura, apresenta impedimentos e revalida dentro da transação. Não há exclusão automática de oportunidades.
- A rota exige versão inteira nas duas ações. A desistência mantém compatibilidade para consumidores internos antigos sem confirmação visual, usando CAS da revisão carregada. O ensaio antigo de mensagens passou a enviar a versão explicitamente.
- Desistência repetida conserva o motivo e não cria outro evento. Requisições simultâneas disputam o CAS; a perdedora recebe conflito e exige releitura.
- A exclusão usa `FOR UPDATE` na ficha e isolamento `ReadCommitted` antes de conferir vínculos. Isso serializa inserções por FK inclusive para relações Cascade. Repetir exclusão já concluída retorna ausência, sem novo efeito. Falhas `P2003`/`P2034` são traduzidas para conflito recuperável.
- Respostas vazias/negativas não anunciam sucesso. Erros ficam no modal com releitura explícita e motivo preservado. Atualização confirmada invalida respostas anteriores e ajusta lista/contador. O detalhe preserva o painel comercial montado e seu texto em edição.

## Inventário de persistência

Relações de `Onboarding` conferidas no schema:

| Relação | Política FK | Proteção |
| --- | --- | --- |
| AtendimentoLead | Restrict | Conversa vinculada impede exclusão |
| PropostaComercial, ContratoComercial | Restrict | Qualquer versão impede exclusão |
| DocumentoOnboarding, TrabalhoFiscalLead, FichaEmpresaAvulsa | Restrict | Preservar documentos, trabalho e serviço |
| OnboardingAnalise, OnboardingLink, OnboardingEtapa | Cascade | Verificação explícita antes do delete |
| OnboardingEvento | Cascade | Qualquer evento impede exclusão, inclusive demandas e reinício |
| PortalClient | SetNull na relação de origem | Vínculo ou conversão registrada impedem exclusão |

A criação simples não produz evento técnico no serviço atual; não há exceção inventada para `ONBOARDING_CRIADO`. Também bloqueiam exclusão: proposta JSON, preenchimento recebido/do cliente, origem dos dados, data de desistência e fase diferente de LEAD. Descendentes de contrato, conversa ou ficha avulsa ficam protegidos pelo bloqueio do vínculo direto.

## Cobertura preparada

Suítes da entrega completa:

- `onboardingService.test.js`: cada relação bloqueadora, eventos, campos escalares, prévia sem escrita, CAS, versão, repetição e tradução dos conflitos.
- `onboardingRotas.test.js`: contratos HTTP, confirmação versionada, permissão admin/contador existente, recusa a atendente e isolamento de escopo em consulta e mutações.
- `encerramentoOportunidades.test.js`: transporte de versão e respostas inválidas.
- `AcoesOportunidade.test.jsx`: motivo, confirmação/cancelamento, duplo clique, bloqueadores, falha, recuperação e teclado.
- `descarteRascunho.test.jsx`: lista legada, confirmação, vínculo posterior à prévia e contador.
- `encerramentoDetalhe.test.jsx`: erro fora da edição, atualização antiga após desistência, falha de releitura e conservação do rascunho comercial; polling durante atualização manual; continuação tardia após desistência/troca de ficha (sucesso e erro); revisão inferior; leitura legada sem versão e recusa de respostas inválidas.
- `ComercialPage.test.jsx`: filtros, histórico, contador após encerramento/exclusão, leitura antiga em voo e ausência de alteração das mensagens.
- `funilMock.test.js`: elegibilidade, versão, repetição e persistência do estado na releitura do mock.

O novo script `apps/api/scripts/verify-encerramento-oportunidades-postgres.mjs` exige banco PostgreSQL já migrado em loopback com nome terminado em `_governance_test`. Não lê `.env`, inicia workers ou chama provedores. HTTP/HTTPS/fetch são bloqueados; fixtures ficam no banco descartável.

O script prepara testes reais de todos os vínculos, rascunho vazio, campos escalares, empresa, versão obsoleta, repetição, desistências simultâneas e rollback após delete. As corridas de FK usam evento (Cascade) e documento (Restrict), nas duas ordens: filho confirma antes do descarte, ou descarte trava antes da inserção. A espera é comprovada por `pg_stat_activity.wait_event_type = Lock`, com timeout; não se presume concorrência por uma pausa fixa. O ensaio não equivale a autenticação HTTP ou QA visual.

## Evidências e validações pendentes

Informações herdadas da auditoria do Principal, **anteriores a esta continuação**:

- No checkpoint, 4 suítes web/29 testes: 19 passaram e 10 falharam por seletores `button` nas ações agora `menuitem`. As asserções foram conservadas e os seletores corrigidos nesta rodada.
- QA local com quatro fichas fictícias comprovou contador 4→3 ao encerrar, histórico em Todas, exclusão de rascunho 3→2 e Escape. Capturas 1440/390 e resultado sem erros JS/overflow estão na área local do Principal. Não aprovam automaticamente esta versão posterior.

Neste subprocesso nenhum teste foi executado, conforme instrução explícita. A tentativa de `node scripts/governance/check.mjs plan --base 96a0dd5` falhou com `EPERM: lstat C:\Users\yagoa`, antes de executar o planejador. Sem contorno de permissões. Inspeção estática e conferência do hash operacional realizadas; `git diff --check` passou, com avisos de normalização LF/CRLF. O Principal deve registrar resultados reais dos gates.

Execução pendente pelo Principal/controlador, a partir da raiz:

```text
node scripts/governance/check.mjs plan --base 96a0dd5
node apps/api/scripts/verify-encerramento-oportunidades-postgres.mjs <URL-loopback-descartável>
node apps/api/scripts/verify-mensagens-onboarding-postgres.mjs <URL-loopback-descartável>
```

Executar também as suítes acima pelo catálogo existente e repetir QA desktop/celular, incluindo bloqueio por vínculos, detalhe, lista legada, foco e erros. Revisores devem analisar todos os arquivos desde `96a0dd5`, não só os testes novos. Integrações externas, registros reais e produção não foram exercitados.

## Risco e reversão

Risco alto pela capacidade de descarte e concorrência entre domínios. Domínios de revisão: comercial, API/web, comunicação e consumidores de vínculos (documentos, portal, operações, guias/contabilidade quando aplicável). A revisão independente e a sistêmica pertencem ao Principal.

Reverter o incremento de código de forma coordenada entre API e UI preserva registros já encerrados e seu histórico; não executar reversão de dados nem reabrir oportunidades em massa. Exclusão de rascunho é definitiva, portanto os gates de proteção e a confirmação continuam obrigatórios. Não há deploy, merge, commit, mensagens, credenciais ou alteração de dados reais neste subprocesso.

## Correções da rodada 1 após reprovação

Alvos desta rodada: script PostgreSQL específico, `renderOnboardingDetailPage.jsx`, `encerramentoDetalhe.test.jsx` e este relatório. As demais alterações da continuação foram preservadas.

- Fixture de `onboardingAnalise` corrigida para `PUBLICA`/`CONCLUIDA`, conforme os dois CHECKs de `20260908090000_onboarding_comercial`. A execução anterior do arquivo versionado falhou antes das corridas. A cópia diagnóstica que passou 19 cenários não é validação do arquivo entregue.
- A ocupação da atualização manual tem identidade própria, separada da sequência de leitura. Polling pode tornar a resposta manual obsoleta, mas a conclusão dessa operação ainda libera a interface. Troca de contexto ou confirmação de encerramento invalida a posse antiga.
- A continuação da edição confere contexto, sequência, identidade e revisão antes de aplicar ficha, mudar área ou sair da edição. Erros tardios de outra ficha também são descartados.
- Leituras legadas sem versão continuam aceitas apenas quando a ficha exibida também não tem revisão inteira. Uma leitura sem versão não substitui ficha versionada; resposta negativa, vazia ou de outra ficha não anuncia sucesso. Nenhuma versão é fabricada. Prévia e comandos destrutivos continuam exigindo revisão real.
- Regressões adicionadas para essas intercalações e contratos, sem alterar as fixtures ou asserções de `entradaCliente.test.jsx`.

Evidência inspecionada nesta rodada: `round-0-gate-web-regression.stdout.log` registra falha no batch 3; stderr vazio. A auditoria do Principal identifica os dois casos legados de `entradaCliente.test.jsx`. A mesma auditoria informa API/portal/builds e ensaio mensagens/onboarding aprovados na versão anterior; esses resultados não aprovam as correções posteriores.

Nenhum teste executado pelo executor, por instrução expressa. O comando de levantamento `node scripts/governance/check.mjs plan --base 96a0dd5` voltou a falhar antes de iniciar com `EPERM: lstat C:\Users\yagoa`; não houve contorno. `git diff --check` não identificou erros de whitespace, apenas avisos LF/CRLF. Permanecem obrigatórios pelo Principal/controlador: regressão web completa (incluindo `entradaCliente`), suíte de detalhe ampliada, script PostgreSQL **versionado**, QA final e novas revisões independentes/sistêmica da diferença completa desde `96a0dd5`. Não há aprovação técnica declarada.

## Continuação após checkpoint 4cc1c0a40 — correção do token

A regressão web identificou `--shadow-md` sem definição no menu de `AcoesOportunidade.jsx` (batch 8, `tokenSemDefinicaoNaoPassa`, conforme auditoria do Principal). Substituído somente por `--shadow`, já definido em `apps/web/src/styles/tokens.css:140`. Nenhum alias, gate, teste de tokens ou configuração foi alterado. Sem impacto em regra operacional: permanecem os contratos R19–R23/R27–R28, `DESISTIU` e descarte estrito, sem adoção de V08.

Evidências anteriores à correção da sombra, consultadas nesta continuação:

- `.altan-governance/encerramento-postgres-final.log`: arquivo versionado executado pelo Principal, 19 cenários concluídos e zero tentativas de rede; supera a pendência da fixture registrada acima.
- `.altan-governance/test-batches/api-4MdBi6/manifest.json`: 618 suítes aprovadas e uma pendente; 10.926 testes aprovados e um pendente.
- `.altan-governance/lint-web-final.log`: sem saída; a auditoria do Principal registra exit 0 com ESLint 8.57.1.
- `.altan-governance/qa/fluxo-final.log`, `bloqueio-final.log` e `lista-legada-final.log`: `ok:true`, `errors:[]`. A auditoria registra desktop 1440/mobile 390, contador 4→3→2, preservação do histórico, bloqueio por vínculo, detalhe/lista legada e Escape. Essas evidências antecedem a troca do token; o Principal repetirá o QA do menu.

O run 2 foi interrompido supervisionadamente durante os gates por caminho fora da allowlist, com journal preservado; não constitui aprovação. A regressão web completa e as revisões independentes/sistêmica da entrega total (`96a0dd5..HEAD` mais working tree) continuam pendentes para a versão final. Não inferir prontidão dos resultados anteriores.

Neste subprocesso não foram executados testes nem QA, por instrução expressa. O levantamento `node scripts/governance/check.mjs plan --base 96a0dd5` novamente encontrou `EPERM: lstat C:\Users\yagoa` antes de iniciar; encaminhado ao Principal/controlador, sem contorno. Os hashes da referência canônica e da cópia local foram conferidos e correspondem a `c1f80393382c5cc2d6ef1cbfe6b5841e0def479d57d4721dc3c99f83ab73bc94`. Somente o componente e este relatório foram alterados nesta continuação.

## Run 3 — correção dos seletores após reprovação web

O gate web do run `2026-10-20T10-26-21-659Z-165e0202` permanece reprovado: `round-0-gate-web-regression.stdout.log` registra `batch-13: exit=1`; stderr vazio. A auditoria do Principal identifica os dois casos parametrizados de continuação de outra ficha (sucesso/erro tardio): procuravam um heading, mas o título existente é `strong.page-shell__title` em `PageShell.jsx:51`.

Corrigidos somente os dois seletores em `encerramentoDetalhe.test.jsx`, usando texto exato no título existente. Preservados os cenários, resolução/rejeição da promessa antiga, verificação do nome da ficha atual e ausência de alerta. Nenhuma alteração no PageShell, na lógica do produto ou nos gates. A correção preexistente para `--shadow` foi preservada. Sem impacto em regra operacional; aplicação dos contratos atuais R19–R23/R27–R28, sem adoção de V08.

O QA posterior à troca do token já foi executado pelo Principal: `.altan-governance/qa/fluxo-token-final.log`, inspecionado nesta rodada, registra `ok:true`, `errors:[]`, desktop 1440 e mobile 390 sem overflow horizontal, incluindo menu, confirmação, histórico, exclusão e cancelamento. Substitui a pendência de repetição do menu indicada na seção anterior. A auditoria registra também 179 suítes restantes aprovadas em oito grupos diagnósticos; esse diagnóstico não substitui o gate web completo reprovado.

Nenhum teste ou QA foi executado por este executor. Os hashes canônico/local foram novamente conferidos e coincidem com o SHA256 acima. O levantamento de impacto voltou a encontrar `EPERM: lstat C:\Users\yagoa` antes de iniciar, sem contorno de permissões. Permanecem pendentes a repetição dos gates pelo controlador e as revisões independentes/sistêmica sobre a entrega completa desde `96a0dd5`, incluindo as alterações locais. Esta correção não declara aprovação.

## Run 3 — rodada 2, foco após confirmação

Achado UX recebido: a confirmação remove o gatilho junto da ação ou da linha; o retorno de foco do Modal apontava para um elemento desmontado. Corrigido nos três consumidores, mantendo o Modal compartilhado e suas regras de cancelamento:

- `AcoesOportunidade` aplica o fechamento e a atualização confirmada com `flushSync`, concluindo também a limpeza do Modal antes de chamar o destino de foco definido pelo consumidor.
- Comercial e lista de Onboarding direcionam o foco à busca persistente, inclusive quando a última oportunidade sai da lista. No detalhe, a desistência direciona para `Atualizar ficha`.
- Ao excluir no detalhe, a navegação existente é preservada e o foco vai à busca da lista de destino. Se Comercial ainda estiver carregando, usa a aba persistente `Oportunidades`. Não há temporizador nem nova requisição para restaurar foco.
- Cancelar e Escape preservam o retorno ao gatilho original; falha não executa o novo retorno de sucesso. Token `--shadow` e seletores corrigidos anteriormente foram preservados.

Regressões acrescentadas às suítes existentes: foco após desistência/exclusão no Comercial e no Onboarding, lista vazia, desistência no detalhe com falha de releitura e resposta antiga, cancelamento no detalhe/lista e exclusão do detalhe com destino em carregamento. Os testes de navegação usam componentes reais com APIs sintéticas; nenhum teste foi executado por este subprocesso.

Evidências consultadas: auditorias do Principal e `.altan-governance/test-batches/web-wgo26i/manifest.json` (`status: passed`) registram a regressão web anterior à correção de foco. `.altan-governance/plano-final.log` registra o levantamento da entrega completa realizado pelo Principal, superando o impedimento de execução do levantamento nos subprocessos. Esses resultados não validam esta nova alteração. `git diff --check` executado nesta rodada sem erros de whitespace, apenas avisos LF/CRLF.

Nenhuma mudança de regra operacional: aplicação de R22/acessibilidade, mantendo R19–R23/R27–R28, DESISTIU, descarte estrito e decisões pendentes. Referência canônica e snapshot conferidos com SHA256 `c1f80393382c5cc2d6ef1cbfe6b5841e0def479d57d4721dc3c99f83ab73bc94`. Somente arquivos da allowlist foram editados; nenhum backend, gate ou configuração mudou nesta rodada. Reversão desta correção consiste em retirar o callback de foco e seus destinos nos três consumidores, preservando o restante da entrega e os dados.

Pendentes para o Principal/controlador: executar as regressões ampliadas, gates completos, QA de teclado desktop/celular após sucesso e cancelamento e revisão independente/sistêmica da entrega total `96a0dd5..HEAD` mais working tree. Não há aprovação declarada nesta rodada nem atos em produção.

## Continuação após 3a93abfbf — resposta de confirmação após saída

Corrigido o achado residual da revisão UI: a confirmação aguardava a API e ainda chamava `onPersistir` e o fallback de foco quando a ficha já havia sido desmontada. O fallback podia alcançar controles da ficha ou rota nova.

`AcoesOportunidade` agora mantém a instância interna vinculada ao ID da ficha, inclusive quando o consumidor não fornece `key`. Cada montagem recebe uma identidade invalidada na limpeza de layout. A confirmação captura essa identidade antes da chamada e descarta sucesso, erro e atualização de ocupação quando ela já não é atual. A mutação enviada continua normalmente no servidor; não há cancelamento, repetição nem alteração de payload. O fluxo atual conserva `flushSync` para concluir a limpeza do Modal antes do fallback; cancelar/Escape conservam o retorno ao gatilho.

Acrescentados dois casos de troca direta de item sem key externa em `AcoesOportunidade.test.jsx`, preservando a nova confirmação, motivo, foco e ausência de callbacks antigos. Em `encerramentoDetalhe.test.jsx`, oito combinações exercitam encerrar/excluir, troca de ficha/saída para lista e resolução/rejeição tardia. Usam os componentes reais de detalhe/lista com API sintética pendente; verificam foco e texto do controle atual, ausência de diálogo/erro/estado antigo, ausência de navegação ou releitura causada pela resposta antiga e chamada única da mutação.

Escopo desta correção: componente, essas duas suítes e este relatório. Sem alteração de layout, backend, governança ou regra operacional. Aplicam-se R19/R20/R22 e permanecem R23/R27–R28, DESISTIU, descarte estrito e V08 pendente. Canônico e snapshot conferidos com SHA256 `c1f80393382c5cc2d6ef1cbfe6b5841e0def479d57d4721dc3c99f83ab73bc94`. A auditoria do Principal foi consultada; os gates e PG19 anteriores não constituem validação desta correção de interface.

Nenhum teste ou QA executado pelo subprocesso, conforme instrução. `git diff --check` passou, com avisos LF/CRLF. `node scripts/governance/check.mjs plan --base 96a0dd5` falhou antes de iniciar com `EPERM: lstat C:\Users\yagoa`, sem contorno. Principal/controlador devem executar testes dirigidos, gates completos, QA desktop/mobile com asserções de foco e renovar as revisões independentes/sistêmica da entrega completa desde `96a0dd5`. Reversão local desta correção retira somente a guarda de ciclo de vida e seus novos cenários; não reverte dados. Não há aprovação técnica declarada.
