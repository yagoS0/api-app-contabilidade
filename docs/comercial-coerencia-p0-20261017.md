# Comercial — coerência técnica P0 em DEV

Base: `711990eff25fae68106a09505f4e4d326dd057cf`. Executor delegado, rodada 0.
Objetivo: apresentar a jornada e as evidências já persistidas de maneira coerente,
sem criar estados, políticas de contratação ou ações externas.

Referência operacional lida: `../altan-regras-operacionais/REGRAS_OPERACIONAIS.md`,
SHA256 `c24fdc32afdafd83f7ec7702ae08f21d710ad4419f43befadae5ff2641ffd96f`.
Aplicam-se R19–R23: leitura não conclui etapas persistidas, identidade e versões
permanecem preservadas, informação indisponível não equivale a sucesso. Nenhuma
regra operacional é modificada. V02/V03/V05–V08 e as decisões comerciais do
planejamento anterior continuam fora do incremento.

## Matriz requisito / código / causa / solução

| Requisito | Código e causa identificada | Solução implementada | Evidência de regressão preparada |
| --- | --- | --- | --- |
| Mesma jornada em lista, ficha e conversa | `comercialModel.js` inferia implantação de `faseComercial=CONTRATADO` + `EM_TRILHA`; a conversa usava `PoliticaJornadaComercial` | `ProjecaoComercialService.js` reutiliza `montarJornadaComercial` e a mesma leitura de evidências de `JornadaLeadService.js`; `listar` e `obter` expõem o resumo. `montarJornada` devolve integralmente a projeção recebida, sem executar primeiro o fallback antigo | `projecaoComercial.test.js`: fase manual não aceita proposta; proposta aceita entre versões; erro de leitura. `coerenciaComercialP0.test.jsx`: precedência da projeção |
| Situação dos dados distinta da jornada | Status da ficha e classificação manual pareciam etapas equivalentes | Listas rotulam o status como Ficha; checklist mantém unidade explícita. `PainelComercial` identifica classificação e anotações como legadas, sem apagar valores nem alterar payload | Testes de Comercial e revisão visual pendente |
| Nome consistente | Oportunidades usava Novo contato e onboarding usava identificador | `nomeDaOportunidade` compartilhado por oportunidades, quadro, detalhe e fluxo da conversa; ausência vira Atendimento + seis caracteres do ID | Teste de nome vazio e espaços |
| Próxima ação, data e responsável | `RETORNO_COMERCIAL` já era retornado, mas o responsável não era exibido e a lista geral só mostrava atualização | `resumoRetorno` usa exclusivamente ação/quando/responsável persistidos, com ausências explícitas. Hoje, oportunidades, quadro e acompanhamento usam o mesmo texto. Erro/carga não dizem que não há retorno | `coerenciaComercialP0.test.jsx`; testes existentes de conflito e preparação de contato preservados |
| Requisitos de Adicionar à carteira | A ação abria o cadastro sem explicar o contrato validado pelo servidor | `obter` chama a validação vigente `conferirContratoDeConversao` em leitura e devolve motivo; `ConversaoModal` explica condições, compatibilidade SEM proposta e efeitos. O POST mantém validações e permissões originais, inclusive nova conferência transacional | Teste de rota com ficha sem proposta; testes existentes de conversão e PF/avulso continuam necessários |
| Evidência fiscal sem segunda marcação | Checklist só lia `concluidaEm`, ignorando relatório conferido no diagnóstico | Evidências projetadas por chave, CNPJ e análise vigente. SITFIS concluído e conferido satisfaz apenas a tarefa SITFIS, sem escrever no GET. A UI explica origem/referência/data. Contagem e detalhe usam a mesma evidência | Testes de evidência no backend e checkbox na UI |
| Autorização SITFIS não conclui acessos amplos | Procuração na implantação tem alcance maior que autorização do diagnóstico | Evidência da procuração aparece com estado, escopo e validade, sempre `satisfaz: false`; não conclui acessos, certificado ou emissão | Teste de autorização e de outro CNPJ |
| Preservar tarefas editadas e histórico | Implantação já possuía sobreposição de etapas herdadas por tarefas próprias | Mantida precedência integral de `implantacaoTarefa`; evidência é anexada para consulta e não reabre/conclui a tarefa editada. Observações, origem e histórico permanecem | `implantacao.test.js`: tarefa editada prevalece, evidência continua consultável |
| Atualização sem perder rascunhos | Mudanças comerciais não atualizavam a checklist da ficha | Callback após ação relê a ficha sem remontar painel/formulários. Mudanças da checklist também releem evidências; falha informa que a ação foi salva e a leitura falhou. Acompanhamento recebe key por ficha | Cenários existentes de formulário/conflito e inspeção de callbacks; validação integrada pendente |

O fallback antigo da jornada permanece para contratos anteriores e demonstração;
não foi criada uma política alternativa. O mock reutiliza esse fallback existente
e devolve a mesma projeção à lista, à ficha e à conversa da demonstração. Não certifica
equivalência de todas as políticas comerciais com o servidor real.

Não se concluem automaticamente viabilidade/DBE/registro, conferência de débitos,
documentos, certificado ou acessos: a mera existência de diagnóstico não comprova
essas tarefas mais amplas. Conversão continua encerrando a ficha comercial e
mantendo a implantação da empresa, sem afirmar implantação concluída.

## Impacto e limites

Domínios diretos: commercial, api, web, operations, documentation. Comunicação
consome o mesmo FluxoComercial; accounting/guides/portal são dependências
transitivas do fluxo de empresa e requerem os revisores definidos pelo controlador.
Os caminhos usam os mapeamentos existentes; nenhum mapa/gate/política foi editado.
Risco: alto pelo contrato de projeção compartilhado e consumidores de onboarding.

Nenhuma migração, backfill, geração Prisma, atualização de permissões, regra fiscal,
GANHA, novo gate de contratação, exceção, marco de implantação, exclusão ou
arquivamento. Nenhuma chamada fiscal, IA paga, mensagem, produção, commit, merge
ou deploy. O executor não iniciou controlador nem delegou tarefas.

A lista continua sem paginação, como antes. A recuperação substitui o N+1 serial
por oito leituras de conjuntos de evidências e, quando há diagnóstico, uma leitura
de saídas por seus IDs. A seleção autorizada da lista antecede essas consultas.
A projeção por ficha passa os fatos à mesma função de leitura da jornada, sem I/O
adicional por item. Não foi inventado cache persistido ou materialização.

Limite de desempenho: quantidade constante de consultas não significa custo
constante. O lote carrega o histórico dos tipos pertinentes das fichas selecionadas
e aplica em memória as janelas individuais já vigentes (100 análises do CNPJ,
último diagnóstico, 100 conferências e 30 marcos mistos). Propostas, contratos e
saídas conservam os recortes anteriores. Volume transferido e memória ainda crescem
com o histórico; latência e consumo de memória com volume representativo permanecem
pendentes. Ordenações e critérios de identidade existentes foram preservados,
inclusive critérios anteriores sem desempate explícito. Não foi criada paginação
ou política nova para resolver ambiguidades legadas.

## Recuperação do executor e achados do Principal

O patch `.altan-governance/comercial-p0/interrupted.patch` foi aplicado com
`git apply`, preservando os novos arquivos; o stash não foi alterado. A referência
canônica teve o SHA256 acima reconferido. Os achados independentes foram confrontados
com o patch recuperado, sem considerá-los aprovações ou automaticamente atuais.

| Achado | Correção final e teste preparado |
| --- | --- |
| N+1 serial | `projetarComerciais` lê conjuntos delimitados pelos IDs autorizados. Teste de `listar` com 1/100 fichas verifica nove chamadas de leitura em ambos os casos sem diagnóstico. Ensaio PostgreSQL opcional conta SELECTs reais com diagnóstico e retorno persistidos, sem fixar a estratégia interna do Prisma. |
| Resposta bruta de concluirEtapa apagava evidências | O comando mantém seu contrato; a ficha mescla etapas persistidas com provas atuais antes da releitura. Falha do GET não apaga provas nem apresenta a escrita como falha. Teste de tela salva outra tarefa com GET indisponível e conserva prova e observação em edição. |
| Janela de pagamentos divergente | A projeção individual e em lote usam os mesmos 30 marcos mistos de `PropostasComerciaisService.painel`. Teste põe pagamento na posição 31 de uma ficha e na posição 1 de outra. |
| Progresso ignorava evidência | Lista e detalhe contabilizam conclusão manual ou evidência satisfatória da tarefa específica; não escrevem conclusão em GET. |
| Filho não propagava ação ao pai | Ações e callbacks de análise/autorizações atualizam o pai, mantendo os componentes montados. Falhas de releitura são separadas da escrita confirmada. Teste integrado de componentes salva nome no filho, atualiza cabeçalho do pai e conserva anotações em edição. |
| Autorização vencida parecia atual | A prova conserva estado registrado, origem, validade e CNPJ, mas é rotulada como EXPIRADA/histórica. Nunca satisfaz a tarefa ampla de acessos. |
| conclusao parecia atendimento entregue | Projeção, mock e conversa mostram Execução e conclusão enquanto pendente; estados CONVERTIDO, CONCLUIDO_AVULSO e DESISTIU têm rótulos próprios. Conversão não afirma implantação concluída. |
| Consistência somente por helper | Teste HTTP percorre criação, conferência cadastral manual persistida, nova ação de checklist e releitura de lista/ficha/painel da conversa. Testes de UI também cobrem resposta tardia de outra ficha e retorno salvo seguido de GET falho. |

O ensaio adicional `apps/api/src/routes/firm/__tests__/coerenciaComercialP0.test.js`
é explicitamente omitido sem `ALTAN_P0_DATABASE_URL`. O Principal deve fornecer
PostgreSQL local já migrado, com banco terminado em `_governance_test`, e executar
esse arquivo para obter evidência de contagem SQL real. O teste cria e remove apenas
seus registros fictícios; não gera Prisma nem aplica migrações. Omitido não significa
aprovado. Os testes com mocks verificam chamadas ao cliente, não plano SQL ou latência.

## Validação desta execução

- `git diff --check`: executado sem erros de whitespace; avisos Git de conversão LF/CRLF.
- `node scripts/governance/check.mjs plan --base 711990eff25fae68106a09505f4e4d326dd057cf`: tentou executar e falhou com EPERM em `lstat C:\Users\yagoa`, limite conhecido do sandbox. Nenhuma permissão foi alterada.
- Testes Jest preparados/ajustados, **não executados neste subprocesso**. O controlador deve executar as suítes de projeção, onboardingService, onboardingRotas, implantação, ComercialPage, AcompanhamentoComercial, jornadaComercial, comercialPublico, coerenciaComercialP0 e checklistImplantacao, além dos gates reais do catálogo.
- Validação visual desktop/celular **pendente do Principal**, com componentes reais e dados fictícios: nomes ausentes, retorno completo/ausente, jornada divergente da fase legada, conversão sem/com proposta, evidência SITFIS e autorização limitada, tarefa operacional editada. CSS usa tokens existentes e permite quebra dos metadados no celular; isso não equivale a inspeção visual concluída.
- Revisões independentes e sistêmica **pendentes do controlador**. Este documento não declara aprovação.

Rollback: reverter apenas este diff de produto/documentação após separar qualquer
edição concorrente posterior. Não há dados migrados ou estados persistidos novos
para desfazer. Evidências e tarefas existentes permanecem nas fontes originais.

## Correção da rodada 1 — 18/10/2026

O trabalho recuperado já estava aplicado nesta árvore e foi preservado; nesta rodada
não se reaplicou o patch nem se alterou o stash. A referência canônica foi novamente
conferida por SHA256. Não houve mudança operacional: permanecem R19–R23, condições
de conversão e limites de escopo anteriores.

| Requisito / achado | Código e causa | Solução desta rodada / cenário preparado |
| --- | --- | --- |
| Aceite externo deve atualizar ficha e conversa | `FluxoComercial.jsx`: polling só atualizava estado do filho | Polling propaga releitura ao pai por callback atual, sem reiniciar o componente. Identidade, sequência de leitura e versão protegem respostas; versão igual permite mudanças de evidências sem edição cadastral. Teste sem comando local avança proposta → contrato, conserva anotações, verifica leitura falha, versão inferior e resposta de outra ficha. |
| Compatibilidade com projeção sem nome | `jornadaComercial.js`: retorno integral não fornecia metadado usado por `toLowerCase` | Completa nome e identificação PF/abertura somente quando ausentes. Passos, etapa, acessibilidade e evidências permanecem do servidor, sem recalcular jornada. Regressão existente `PassosDoLead.test.jsx` é preservada. |
| Etapa visível mesmo com jornada recolhida | `renderOnboardingDetailPage.jsx`: cabeçalho mostrava apenas situação da ficha | `headerExtra` do PageShell exibe `comercial.titulo` retornado pelo servidor, ou indisponibilidade explícita. Mantém formulários montados. Teste inicia RASCUNHO com expansão fechada e confere etapa antes/depois do polling. |
| Testes de identidade usavam heading inexistente | `coerenciaComercialP0.test.jsx`: PageShell usa `strong.page-shell__title` | Seletores ajustados ao elemento real, preservando afirmações de nome salvo, ausência do nome antigo e rascunho. PageShell não foi alterado. |
| Dois erros novos de lint e aviso de ref | Helper exportado por `ChecklistEtapas.jsx`, destructuring não usado no teste e referência de cleanup | Helper compartilhado movido para o módulo de lib já autorizado; fixture remove evidências explicitamente; cleanup captura a referência da leitura. Nenhuma regra de lint desativada. |

Evidência examinada: `round-0-gate-web-regression.stdout.log` registra falha do
batch-1 em `web-cEmLQl`; o JSON identifica `PassosDoLead.test.jsx`, erro de nome
ausente. Os achados do Principal registram os dois seletores incorretos e erros de
lint. Resultados anteriores de API/portal/PostgreSQL e capturas não aprovam este novo
snapshot. O limite de desempenho com históricos volumosos continua pendente, como
descrito acima; esta rodada não altera o lote ou suas janelas.

Validação do executor: `git diff --check` sem erros de whitespace; o planejamento
via Node encontrou novamente EPERM em `C:\Users\yagoa`. Jest/lint/build não foram
executados neste subprocesso: o controlador deve renovar os gates, incluindo os
cenários novos de polling e a suíte existente PassosDoLead. Não se contornou o sandbox.

O Principal ainda deve renovar `interactions.mjs` e `visual-final.mjs` e completar
desktop/celular para resumo no cabeçalho, ConversaoModal, evidências expandidas,
autorização expirada e precedência de tarefa operacional editada, incluindo
foco/teclado e falhas. Esta rodada não declara validação visual nem aprovação de
revisores. Nenhuma decisão de negócio pendente foi implementada.

## Correção da rodada 2 — 18/10/2026

Foram preservadas as alterações das rodadas anteriores, sem reaplicar o patch ou
alterar o stash. Esta rodada modifica apenas o mock, o nome acessível de um campo,
a regressão de coerência e esta documentação. R19–R23 continuam aplicáveis; nenhuma
regra, permissão, condição de conversão ou estado operacional foi alterado.

| Requisito / achado | Código e causa | Solução / regressão preparada |
| --- | --- | --- |
| Mesma etapa no mock entre lista, ficha e conversa | `mockApi.js`: somente listarOnboardings acrescentava comercial; getOnboarding omitia a projeção e o cabeçalho mostrava Indisponível | Composição compartilhada consulta a mesma instância de comercialMock usada pela conversa. Lista, detalhe, criação e respostas de escrita que retornam ficha recebem o resumo, sem persistir outra etapa. Teste com createMockApi real cria abertura, salva dados/classificação legada/checklist, relê e renderiza lista, ficha e FluxoComercial; depois salva campos da jornada e verifica a mudança de etapa nas três superfícies e a versão preservada. |
| Preservar contrato acessível e rascunhos | `PainelComercial.jsx`: renomear o campo impediu dois testes existentes de localizar Proposta e condições | Restaurado o nome acessível original, mantendo a explicação de registro legado sem aceite e sem autoridade sobre a jornada. entradaCliente.test.jsx permanece intocado. Seletores dos novos testes usam o mesmo nome e preservam todas as verificações de rascunho, polling e respostas tardias. |

Evidência examinada: `round-1-gate-web-regression.stdout.log` aponta falha no
batch-2 de `web-BCpfxj`; o respectivo JSON registra 472 testes aprovados e dois
falhos nesse batch. São os cenários existentes de preservação de link/proposta ao
atualizar e alternar áreas. O stderr do gate está vazio. Os achados independentes
e capturas do Principal documentam a divergência de etapa no mock. Resultados de
API/portal/builds da rodada anterior não equivalem à aprovação deste snapshot.

Validação do executor: `git diff --check` sem erros de whitespace, com os avisos
LF/CRLF preexistentes. O comando de planejamento com a base registrada acima
encontrou o EPERM conhecido em `lstat C:\Users\yagoa`; não se alterou o sandbox.
Testes, lint e builds **não executados neste subprocesso**. O controlador deve
renovar o gate web completo, incluindo entradaCliente e coerenciaComercialP0.

O Principal deve renovar `interactions.mjs` e `visual-final.mjs`, afirmando
explicitamente a igualdade da etapa da mesma ficha na lista, no cabeçalho do
detalhe e na conversa após salvar e recarregar, em desktop/celular. Esses arquivos
estão fora da allowlist do executor e não foram editados. Permanecem as limitações
de latência/memória com históricos volumosos e a necessidade de revisão independente
do snapshot final. Não há aprovação técnica ou visual declarada nesta rodada.
