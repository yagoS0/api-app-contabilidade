# F1 — revisão 2: Operações dentro da Altan

**Status: proposta anterior rejeitada; alternativas A e B aguardam aprovação humana.** A CI e os pareceres técnicos não aprovam o design. Esta revisão atende ao [comentário do PR #287](https://github.com/yagoS0/api-app-contabilidade/pull/287#issuecomment-6898034360). O [plano técnico F0/F2–F6](../modules/plano-diretor-operacoes-apuracao.md) permanece intacto.

Base do PR: `fac886c4dbbf534f76d54d5869ebeee835a31cc9`. Revisão visual posterior ao head `4a409e7318590bde9888c86043bf2d0de0a43bed`. Nenhuma alteração funcional, fiscal, contábil, HTTP, schema, worker ou configuração de produção.

## Abrir e comparar

- [Comparação lado a lado: tela atual, A e B](comparacao-operacoes-f1.html) — selecione largura e estado.
- [Alternativa A: expansão na página](plano-operacoes-apuracao.html?alternativa=A).
- [Alternativa B: área de trabalho focada](plano-operacoes-apuracao.html?alternativa=B).
- [Evidências e resultado automatizado](evidencias-plano-operacoes-apuracao/f1-r2/validacao.json).

Os HTMLs devem permanecer no checkout, junto aos CSS/tokens. Podem ser abertos pelo navegador ou por servidor estático somente em loopback na raiz do repositório. Sem API, armazenamento de negócio, consulta externa ou bibliotecas remotas. CSP bloqueia conexões. Os controles demonstram navegação; não executam comandos reais.

## Comparação com a interface real antes de implementar

Reinspecionados [OperationsPage](../../apps/web/src/features/operacoes/OperationsPage.jsx), [operacoes.css](../../apps/web/src/features/operacoes/operacoes.css), [OperationsCalculationDetails e OperationsTransmissionTable](../../apps/web/src/features/operacoes/OperationsCalculationDetails.jsx), [OperationsRoutineCompanies](../../apps/web/src/features/operacoes/OperationsRoutineCompanies.jsx), [instruções da Apuração](../../apps/web/src/features/apuracao-v2/CLAUDE.md), [regras de design](../design-review.md), [DESIGN_SYSTEM](../../DESIGN_SYSTEM.md) e [UX_RULES](../../UX_RULES.md).

A referência visual desta rodada é o **App real**, rota local `/companies?visao=operacoes&competencia=2026-10`, com Vite mock e sessão sintética. Não se limita ao invólucro `revisao-dev.html` usado na primeira rodada. Não houve acesso à produção. O browser bloqueia rede fora do loopback; os valores são fixtures, não dados reais.

| Elemento atual observado | A | B |
| --- | --- | --- |
| Navegação Operação → Operações, competência acima da página | Preservada no enquadramento | Preservada no enquadramento |
| Três containers lado a lado, empilhados no celular | Preservados, indicadores de Apuração em linhas | Preservados, quatro indicadores em grade dentro de Apuração |
| Quatro distribuições cadastrais abaixo | Preservadas | Preservadas no resumo; recolhidas durante a tarefa |
| Rotinas como faixa horizontal após distribuições | Preservada | Preservada no resumo; recolhida durante a tarefa |
| Clique no indicador abre tabela contextual | Mesa expandida abaixo dos três containers | Mesa focada com os três containers compactados acima |
| Detalhe longo de apuração | Substitui somente o conteúdo da mesa, sem modal pequeno | Usa a largura da mesa focada, sem página independente |
| Guias e Contabilização | Mesmos fatos/indicadores; rótulo proposto Contabilidade | Mesmos fatos/indicadores; resumo recuperável com Voltar |

Os overrides finais do CSS real prevalecem: Rotinas **não** é a antiga sidebar. Cabeçalho de navegação é ilustrativo e inerte no artefato; não é nova navegação do produto. O rótulo Contabilidade segue o pedido atual; não implica renomear rotas ou contratos. Os conjuntos/valores das fixtures atuais e propostas diferem, portanto a comparação é visual, **não paridade de números**.

Capturas atuais em [1440](evidencias-plano-operacoes-apuracao/f1-r2/atual-1440.png), [1366](evidencias-plano-operacoes-apuracao/f1-r2/atual-1366.png), [390](evidencias-plano-operacoes-apuracao/f1-r2/atual-390.png) e [360](evidencias-plano-operacoes-apuracao/f1-r2/atual-360.png). A [Apuração atual desktop](evidencias-plano-operacoes-apuracao/apuracao-empresa-desktop.png) e [mobile](evidencias-plano-operacoes-apuracao/apuracao-empresa-mobile.png) são evidências da rodada anterior, identificadas como tal.

## Duas alternativas para decisão humana

**A — expansão na página.** Mantém a leitura visual mais próxima da Operações atual. A tabela, seleção, prévia de lote e conferência aparecem numa mesa abaixo dos três containers. O foco leva diretamente à tarefa. Ao retornar, busca, seleção e posição são restauradas. Vantagem: continuidade explícita com o resumo; custo: página mais longa, principalmente no celular.

**B — área de trabalho focada.** No resumo, preserva toda a página; Apuração usa quatro indicadores em grade. Ao abrir uma etapa, os três containers são compactados e as distribuições/rotinas recolhidas temporariamente, liberando espaço para a mesa. Voltar ao resumo restaura a organização completa. Vantagem: menor percurso durante a tarefa; custo: mudança visual maior e necessidade de tornar o retorno evidente. Não abre página independente de Apuração.

Nenhuma alternativa foi escolhida pelo agente. A escolha humana deve considerar tanto a página completa quanto tabela, lote e conferência, em desktop e celular.

## Fluxos demonstrados

1. Abrir A calcular, A conferir, Confirmadas ou Transmitidas → lista correspondente.
2. Pesquisar, selecionar uma empresa ou as visíveis → revisar quantidade total e selecionadas fora da busca.
3. Preparar lote → separar elegíveis ilustrativas, impedidas e motivos → alternar origem manual/automática → ver **resultado ilustrativo**, sem executar.
4. Conferir uma empresa → ler origem, revisão, impedimentos e próximo passo → retornar à mesma lista, busca, seleção e posição.
5. Abrir apuração externa → distinguir declaração manual de recibo/transmissão comprovados.
6. Abrir Impedidas / a revisar → examinar procuração, pausa, recusa, base e regime; Lucro Presumido permanece fora da automação PGDAS.
7. Abrir Rotinas → comparar capacidades manuais/programadas e bloqueios; nenhuma configuração ativa transmissão.
8. Abrir notas posteriores → listar empresa e competência, inclusive fora do mês selecionado, sem alterar automaticamente a revisão.

Guias e Contabilidade são referências preservadas, sem novas telas ou regras. Cliques nos seus indicadores apenas informam esse limite do protótipo.

## Indicadores e seleção: proposta, não alteração de regra

Universo sintético: **10 empresas Simples** de outubro; **1 Lucro Presumido** e **1 regime a verificar** fora dele. A calcular = 4; A conferir = 3; Confirmadas = 2; Transmitidas = 2. As duas transmitidas também estão confirmadas. Uma empresa tem apuração externa declarada, sem prova oficial. **Os quatro números não são somáveis.** A lista de cinco impedidas/a revisar inclui regime desconhecido; não é subconjunto exclusivo de um indicador.

Os predicados do plano técnico continuam sujeitos a F2/P2a: mudar denominador não é renomeação visual. Preservar empresa/PA/autorização e origem da evidência. Seleção ilustrativa não é política de permissão. O lote atual ainda exige contrato próprio para seleção explícita.

Busca mantém seleção e explicita quantas ficam ocultas; trocar etapa limpa seleção. O conjunto preparado contém apenas IDs selecionados. Troca real de empresa/competência exigirá invalidar contexto e revalidar no servidor; o protótipo fixa outubro e não simula troca de PA. Zero comprovado, desconhecido e não aplicável são distintos.

## Conferência detalhada e avisos

Horizonte demonstra conferência ampla: empresa/competência/revisão → bloqueio visível junto ao início → cinco informações principais → notas/classificação aberta → Fator R/folha → comparação → documentos e histórico. A organização se baseia na Apuração existente; nenhuma fórmula ou alíquota foi criada. Ausência de FS12 não vira zero; cálculo e comparação permanecem indisponíveis.

As demais empresas têm detalhe de evidência específico, não cópias de valores de Horizonte. Procuração vencida bloqueia a consulta oficial; não redefine ACL da leitura local. Pausa/recusa não dispensam obrigação. Informação externa sem prova não vira transmissão, pagamento ou contabilização. Resultado incerto não recebe botão de repetição automática.

Avisos demonstram ocorrência, causa comprovada ou desconhecida, impacto, responsável e próximo passo seguro. Tipos separados: informação/aviso, divergência, erro e bloqueio. Os caminhos de resolução são orientações no protótipo; nenhum cadastro real é aberto ou alterado. As condições de recuperação e reservas existentes permanecem intactas.

## Tokens e componentes

Reuso direto de [tokens.css](../../apps/web/src/styles/tokens.css) e [operacoes.css](../../apps/web/src/features/operacoes/operacoes.css). Cores: `--bg-page`, `--bg-surface`, `--bg-subtle`, `--text`, `--text-muted`, `--border`, `--border-focus`, `--state-*`; seleção com `--accent-purple-surface`; ação primária com `--primary`. Corpo em fonte de sistema e Inter local na navegação. Espaçamento/raios seguem tokens reais.

Os HTMLs reproduzem visualmente Button, tabela, seletor de competência, indicadores e seções da aplicação; **não são instâncias React dos componentes compartilhados**. Na futura implementação autorizada, reutilizar componentes reais e contratos existentes. Não introduzir biblioteca paralela, motor fiscal ou derivação de autorização no frontend.

## Evidências das alternativas

A galeria mostra lado a lado o atual e as duas propostas, com todos os estados e larguras. Capturas individuais principais:

| Estado | A desktop | B desktop | A celular | B celular |
| --- | --- | --- | --- | --- |
| Operações completa | [1440](evidencias-plano-operacoes-apuracao/f1-r2/A-operacoes-1440.png) | [1440](evidencias-plano-operacoes-apuracao/f1-r2/B-operacoes-1440.png) | [390](evidencias-plano-operacoes-apuracao/f1-r2/A-operacoes-390.png) | [390](evidencias-plano-operacoes-apuracao/f1-r2/B-operacoes-390.png) |
| Tabela A conferir | [1440](evidencias-plano-operacoes-apuracao/f1-r2/A-conferir-1440.png) | [1440](evidencias-plano-operacoes-apuracao/f1-r2/B-conferir-1440.png) | [390](evidencias-plano-operacoes-apuracao/f1-r2/A-conferir-390.png) | [390](evidencias-plano-operacoes-apuracao/f1-r2/B-conferir-390.png) |
| Preparação de lote | [1440](evidencias-plano-operacoes-apuracao/f1-r2/A-lote-1440.png) | [1440](evidencias-plano-operacoes-apuracao/f1-r2/B-lote-1440.png) | [390](evidencias-plano-operacoes-apuracao/f1-r2/A-lote-390.png) | [390](evidencias-plano-operacoes-apuracao/f1-r2/B-lote-390.png) |
| Conferência ampla | [1440](evidencias-plano-operacoes-apuracao/f1-r2/A-conferencia-1440.png) | [1440](evidencias-plano-operacoes-apuracao/f1-r2/B-conferencia-1440.png) | [390](evidencias-plano-operacoes-apuracao/f1-r2/A-conferencia-390.png) | [390](evidencias-plano-operacoes-apuracao/f1-r2/B-conferencia-390.png) |
| Bloqueio acionável | [1366](evidencias-plano-operacoes-apuracao/f1-r2/A-bloqueio-1366.png) | [1366](evidencias-plano-operacoes-apuracao/f1-r2/B-bloqueio-1366.png) | [360](evidencias-plano-operacoes-apuracao/f1-r2/A-bloqueio-360.png) | [360](evidencias-plano-operacoes-apuracao/f1-r2/B-bloqueio-360.png) |

São 128 capturas das propostas (16 estados × 2 alternativas × 4 larguras) e 4 capturas novas do App atual. As quatro imagens do protótipo anterior permanecem apenas como histórico da rejeição e não representam as alternativas atuais.

## Validação, limitações e aprovação

- Chromium/Chrome isolado, rede externa bloqueada: quatro indicadores reconciliados às listas, busca, seleção individual/lote, retorno da conferência e prévia, origens manual/automática, resultado ilustrativo, externo, impedimentos, avisos e rotinas.
- Larguras 1440/1366/390/360: propostas sem overflow global ou erros JavaScript nos estados capturados. Tabelas detalhadas podem rolar dentro do próprio container.
- **Tela atual em 360px apresentou overflow global**: evidência preservada, sem correção funcional neste escopo. Isso não é atribuído às propostas.
- Capturas não certificam ACL, tributação, PostgreSQL ou contratos de provedor. Nenhuma chamada fiscal, envio ou escrita de negócio. Testes anteriores da entrega inicial continuam históricos, não são contados como reexecutados.
- Controlador funcional não iniciado nesta correção exclusivamente documental. Revisão independente UI/UX e resultados atuais registrados no PR e na governança, sem declarar `ready_for_human`.
- Critério de saída: **aprovação humana explícita de A, B ou ajustes definidos**. Nenhuma CI libera F1, P1/P2, integração ou publicação por consequência.
