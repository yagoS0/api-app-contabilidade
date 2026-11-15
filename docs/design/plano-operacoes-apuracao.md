# F1 — proposta UX/UI de Operações e Apuração

Documento revisável do [plano diretor](../modules/plano-diretor-operacoes-apuracao.md), base `fac886c4dbbf534f76d54d5869ebeee835a31cc9`. **Não implementar interface antes da aprovação humana de F1.** Aprovação visual não autoriza regra tributária, transmissão ou mudança de permissão.

## Evidência da tela atual

Inspeção em 15/11/2026, Chrome isolado em desenvolvimento local, `VITE_API_MODE=mock`, nenhum backend iniciado. Navegação permitida somente em loopback; rede externa bloqueada. Operações usa `revisao-dev.html`, que monta `OperationsPage` real. Apuração usa App real, sessão exclusivamente sintética do mock e rota `/companies/:id/cadastro-fiscal`. Não houve login real ou acesso à produção.

Foram observados: Operações normal e erro, lista global de Apuração vazia e Apuração da empresa com dados fictícios/Fator R sem folha, nas larguras 1440 e390. A primeira captura da empresa ainda carregava; foi substituída após conclusão da leitura local. Sem overflow global nos estados medidos. Nenhuma captura nova de Operações/Apuração foi fornecida neste pedido; a imagem antiga de NFS-e da conversa não foi usada como prova dessas telas.

| Tela real com fixture | Desktop | Celular |
| --- | --- | --- |
| Operações | [Captura](evidencias-plano-operacoes-apuracao/operacoes-desktop.png) | [Captura](evidencias-plano-operacoes-apuracao/operacoes-mobile.png) |
| Apuração da empresa | [Captura](evidencias-plano-operacoes-apuracao/apuracao-empresa-desktop.png) | [Captura](evidencias-plano-operacoes-apuracao/apuracao-empresa-mobile.png) |

Achados observados:

- Operações mantém três blocos altos (Apuração, Guias, Contabilização), indicadores cadastrais e rotinas abaixo. No celular, o percurso até as rotinas fica longo. Não se trata de overflow: é densidade/hierarquia a revisar.
- O mock informa explicitamente conferência indisponível e não simula aprovação. Isso limita a validação de modais/ações reais; não afirmar homologação integral.
- Apuração já agrupa competência/ações/cinco indicadores e expõe a tabela de anexo, Fator R e comparação. Preservar essa decisão; não substituir por novo painel de cálculo.
- Ações “Buscar extrato”, “Atualizar na Receita” e “Calcular/Fechar” convivem na mesma área. A nova organização deve explicar efeitos sem renomear comando de consulta/simulação como cálculo puramente local.
- Valores ausentes e cenários hipotéticos já têm distinção visual. Não eliminar avisos fiscais para reduzir densidade.

## Tokens e componentes a reutilizar

Fonte: `apps/web/src/styles/tokens.css`. Fundo `--bg-page`, superfícies `--bg-surface/--bg-subtle`, texto `--text/--text-muted`, borda `--border`, foco `--border-focus`, ação `--primary`, estados `--state-*`. Corpo usa fonte de sistema; Inter fica na navegação/marca. Escala existente4/8/12/16/24/32, raios10/8; mobile com alvos44px. O protótipo carrega o CSS de tokens da própria árvore; não define sistema visual paralelo.

Reutilizar `components/ui/Button`, `Painel`, `Modal`, `components/layout/PageHeader`, seletor de competência e padrões de tabelas/alertas. Novos nomes abaixo são responsabilidades de componentes propostos, não criação autorizada de uma biblioteca.

## Alternativas e fluxo recomendado

**A — recomendada:** resumo compacto no contexto Operações; tabela da etapa no mesmo espaço; conferência abre a superfície ampla da Apuração da empresa. Voltar preserva competência, etapa, filtro e seleção. Evita duplicar o motor e o formulário de fechamento.

**B — alternativa:** painel lateral amplo no desktop e página inteira no celular. Exige prova de espaço/foco e preservação de formulários; risco maior de duas implementações da conferência. Não usar modal pequeno para todas as notas, fundamentos, valores e histórico.

Fluxo: selecionar competência → abrir etapa → examinar pendência/evidências → escolher empresas → revisar elegíveis/bloqueadas e efeito → entrar no comando autorizado. A conferência da revisão não transmite. Consulta, simulação e transmissão possuem confirmações e requisitos próprios. O protótipo demonstra somente navegação, filtro, seleção e detalhe de uma empresa sintética.

## Contadores: definição proposta a aprovar em F2

Universo U = pares únicos empresa/competência autorizados, com Simples comprovado e obrigação aplicável. Exibir cobertura e origem da leitura; regime/aplicabilidade desconhecidos ficam “A verificar”, sem sumir ou virar não aplicável. Pausas e recusas não eliminam obrigação: mostrar responsabilidade e elegibilidade separadas.

| Contador | Predicado proposto | Limite |
| --- | --- | --- |
| A calcular | Execução interna em escopo, sem cálculo vigente utilizável | Bloqueadas são identificadas dentro da lista; apuração externa não cria cálculo local fictício. |
| A conferir | Cálculo/revisão disponível e aprovação humana ausente/invalidada | Pode coexistir com declaração oficial já existente. |
| Confirmadas | Aprovação válida da revisão corrente | Não equivale a autorização de transmissão. |
| Transmitidas | Declaração comprovada, interna ou externa com evidência | Informação manual sem prova não entra como transmissão comprovada. |

Não somar contadores como partição de U. IDs contados e tabela devem usar o mesmo predicado/snapshot ou explicitar atualização concorrente. As projeções atuais `operacoes.js` misturam regimes e incluem desconhecidos em missing; mudar o denominador **não é renomeação visual** e exige P2a/P2b.

Tabela proposta: empresa, PA, regime, origem, resultado, pendência, situação e ação. No desktop, alinhamento numérico à direita e detalhes sob demanda; celular usa linhas/cartões com a mesma informação, sem corte global. Seleção informa total selecionado, elegíveis por capacidade, bloqueadas e motivos. Filtro não amplia seleção; troca de competência invalida a seleção anterior. A opção de preservar seleção ao trocar etapa precisa de decisão explícita; o protótipo a limpa e informa isso.

## Conferência aprofundada

Reutilizar ordem vigente: quadro de competência/revisão/ações/cinco indicadores → anexo/tabela aberta e classificação → Fator R → comparação. Acrescentar acesso contextual às notas/segregação e fontes, premissas por receita, alíquota nominal/efetiva, estimativa, comparação R×V e histórico de aprovações/divergências. Não incluir nova fórmula no frontend.

No desenho, a conferência ocupa a página, com evidências principais à esquerda e pendência/histórico à direita no desktop; no celular, segue uma coluna. Dados fictícios não apresentam classificação, alíquota ou imposto inventados. O detalhamento interativo é somente da empresa Horizonte; outros registros demonstram conjuntos e seleção e informam a limitação ao abrir.

## Catálogo de pendências acionáveis

Contrato de apresentação proposto: `tipo`, resumo, empresa, PA, etapa, origem, causa comprovada ou hipótese identificada, consequência, responsável, próximo passo seguro, resolução, revisão e data. Código técnico vai em detalhes; não criar código de backend por conveniência de UI. Causa desconhecida permanece desconhecida.

| Situação | Tipo / mensagem ao contador | Consequência, responsável e próximo passo |
| --- | --- | --- |
| Regime sem prova no PA | Bloqueio: “Confirme o regime deste período.” | Fiscal/cadastro; consultar histórico e evidência, sem copiar regime atual. |
| Folha/base ausente | Bloqueio: “Faltam dados para conferir esta revisão.” | Contador/DP; completar fonte; não preencher zero. |
| Sem movimento comprovado | Informação: “Sem movimento; confira a obrigação aplicável.” | Fiscal; fluxo específico, sem concluir dispensa. |
| Procuração ausente/vencida | Bloqueio da consulta oficial: “A autorização para esta consulta não está válida.” | Responsável cadastral; verificar poderes/vigência; leitura local permanece conforme ACL. |
| Sem vínculo de acesso | Recusa: “Seu acesso não permite esta operação para a empresa.” | Gestor de acesso; não oferecer atalho que amplie permissões. |
| Revisão alterada | Revisão: “A base mudou depois da conferência.” | Contador; abrir diferenças e conferir novamente; não retransmitir. |
| Diferença interno/oficial | Divergência: “Os resultados comparáveis diferem.” | Fiscal; mostrar fonte/revisão/componentes; tolerância não presumida. |
| Provedor indisponível | Erro técnico: “Não foi possível confirmar o resultado da consulta.” | Operador/suporte; preservar tentativa; não dizer imposto zero. |
| Reserva/aceite incerto | Bloqueio: “O resultado ainda não está confirmado; não repita a transmissão.” | Fiscal/suporte; seguir conciliação vigente; não botão genérico Tentar novamente. |
| PDF ausente após confirmação | Pendência documental: “Declaração confirmada; documento ainda indisponível.” | Fiscal/Guias; manter prova, não repetir ato fiscal nem iniciar recuperação automaticamente. |
| Falha contábil após guia | Erro parcial: “Documento salvo; contabilização requer conferência.” | Contabilidade; comando próprio, fechamento protegido. |
| Pausa/recusa contratual | Bloqueio operacional: “Execução suspensa neste escopo.” | Responsável pelo contrato/rotina; mostrar motivo/vigência, sem afirmar dispensa legal. |

Resolução proposta: aberta → em análise → resolvida por evidência/revisão; recorrência registra novo fato, não apaga histórico. Reconhecer aviso não resolve uma obrigação. Esse ciclo não é nova persistência autorizada.

## Protótipos revisáveis

[Abrir HTML navegável](plano-operacoes-apuracao.html). Abrir a partir do checkout preserva a referência aos tokens; para servir localmente, usar servidor estático somente em loopback na raiz do repositório. Sem API, fetch, formulário de transmissão ou bibliotecas remotas; CSP bloqueia conexões.

| Proposta | Desktop | Celular |
| --- | --- | --- |
| Resumo e tabela | [Captura](evidencias-plano-operacoes-apuracao/proposta-desktop.png) | [Captura](evidencias-plano-operacoes-apuracao/proposta-mobile.png) |
| Conferência ampla | [Captura](evidencias-plano-operacoes-apuracao/proposta-conferencia-desktop.png) | [Captura](evidencias-plano-operacoes-apuracao/proposta-conferencia-mobile.png) |

O protótipo contém seis pares aplicáveis e um aviso separado de regime desconhecido. Confirmadas e transmitidas se sobrepõem. A lista desconhecida completa e outros modais não foram prototipados; continuam requisitos do incremento, não funcionalidades demonstradas.

## Critérios de aprovação visual e limites

- Aprovar alternativa A/B, hierarquia, nomenclatura e semântica dos contadores separadamente das regras fiscais.
- Desktop1440/1366, mobile390/360 e zoom200%; sem overflow global, nomes longos, tabelas e foco visível. Testar carregamento, erro, vazio, dados incompletos, zero comprovado, fonte incerta e revisão antiga.
- Antes de introduzir confirmação real no mobile, incluir resumo/âncora da pendência bloqueante junto ao contexto/ação inicial; a explicação completa pode permanecer abaixo. O protótipo só informa requisitos, sem confirmar.
- Teclado: etapa, pesquisa, seleção, detalhe, retorno ao gatilho, confirmação; texto além de cor. A ação bloqueada explica motivo sem desaparecer.
- Contagem/lista/seleção reconciliadas, inclusive paginação e troca de empresa/PA; dado atrasado não repõe outro contexto.
- Na inspeção inicial foram medidos1440/390; foco de detalhe/retorno e seleção com exclusão foram exercitados no protótipo. Demais dimensões/estados são critérios de aceite do PR funcional, não homologação declarada.
- Jest e mock não certificam ACL, persistência, legalidade ou provedor. Resultados completos e revisão UI/UX ficam no registro e no PR. Nenhuma tela produtiva foi alterada.
