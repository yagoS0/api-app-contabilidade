# Planejamento tributário: comparação com o mercado

Pesquisa realizada em 15/09/2026. Base interna: código local até `f285c24f`, incluindo os ajustes recentes ainda não publicados. Esta análise propõe evolução; não implementa funcionalidades nem valida integralmente regras tributárias.

## Conclusão

A aba possui uma base relevante de simulação para empresas de serviços: três regimes, detalhamento, origem dos dados, Fator R, pró-labore, cenários salvos e exportação. Ainda não é completa como planejamento recorrente, nem como comparador universal para comércio, indústria e operações mistas.

O principal objetivo dado pelo usuário — verificar se a empresa está no caminho certo — exige realizado versus planejado e projeção mês a mês. Hoje predominam entradas anuais e comparação estática. Antes de aumentar a cobertura, devem ser corrigidas limitações na recomendação e nas premissas do pró-labore.

## Referências externas e limites da pesquisa

Foram consultadas páginas oficiais dos fornecedores. São funcionalidades publicamente declaradas, não auditoria dos motores ou comprovação por uso de uma assinatura. Ausência de um recurso na página não prova ausência no produto. As soluções abaixo têm escopos diferentes; não se pressupõe que pertençam ao mesmo plano comercial.

| Referência | Recurso declarado que orienta a comparação |
|---|---|
| [Econet SPTE](https://lp.econeteditora.com.br/simulador-de-planejamento-tributario/) | Compara três regimes, trabalha com até três CNAEs simultâneos e apresenta bases e memória. O tour inclui receitas/deduções mensais ou consolidadas, custos, despesas e FAP. |
| [IOB Online](https://iob.com.br/iob-online/) | Oferece comparação de regimes e simulador do Simples com impactos mensais. |
| [IOB Simulador Tributário](https://iob.com.br/simulador-tributario/) | Profundidade por operação: ICMS/ST, PIS/Cofins, benefícios e serviços; ISSQN e retenções com identificação de incidência e responsável. É referência de cobertura, não equivalência direta ao nosso planejamento. |
| [IOB Gestão Tributária](https://noticias.iob.com.br/reforma-projecao-de-impostos/) | Anuncia projeções da reforma até 2033 a partir de documentos fiscais. O artigo foi atualizado em 22/04/2026. |
| [Sittax RT](https://sittax.com.br/sittax-rt/) | Declara simulações a partir de XML/PGDAS/RBT12, detalhamento de 2027–2033, bases de débito/crédito e créditos por fornecedor. Os números ilustrativos da página não foram usados para validar nenhuma fórmula nossa. |

## Inventário interno

| Capacidade | Estado observado | Limite relevante |
|---|---|---|
| Simples, Presumido e Real | Implementada | Real usa margem e créditos agregados informados; não reconstrói o lucro tributável a partir da contabilidade. |
| Impostos separados, alíquota, base e valor | Implementada | Cards novos disponíveis localmente; não significa cobertura de todos os tributos de toda atividade. |
| Prefill com procedência | Implementada | Lê notas, snapshots, folha e perfil. Fontes podem ter períodos distintos, identificados no retorno; falta avaliação consolidada de atualização/completude. |
| Fator R, anexos III/V e ponto de equilíbrio | Implementada | Comparação anual estática; não projeta a janela móvel da folha e receita para cada mês futuro. |
| Pró-labore versus economia no DAS | Implementada com limitação material | Usa folha total anual dividida por 12 como pró-labore mensal de uma pessoa. Não separa empregados, encargos e sócios. |
| Cenários salvos e PDF | Implementada | Guarda entradas, resultado, procedências, vigência e autor. Reabrir recalcula com tabelas atuais; documento original preserva a foto. Falta comparação entre cenários, conclusão do contador e fluxo de revisão. |
| Início de atividade | Implementada parcialmente | Série mensal serve ao RBT12 proporcional/limites; não é previsão tributária completa dos próximos 12 meses. |
| Várias atividades simultâneas | Não atende no comparador atual | A entrada trabalha com uma categoria do Presumido e um anexo resolvido, mesmo que o perfil fiscal possua vários CNAEs. |
| Tributos por produto/operação | Parcial | ICMS/ST, particularidades de produtos e benefícios não compõem integralmente os totais do planejamento. |
| Reforma tributária | Parcial | Bloco próprio para 2026 e 2027–2028, por dentro/fora do Simples; não cobre toda a transição por operação/fornecedor. |
| Realizado versus planejado | Não encontrado na aba | Não confronta o cenário salvo com o que foi posteriormente apurado, nem projeta desvios e ações. |
| Carteira de empresas | Parcial | Há escolha de empresa, mas não diagnóstico consolidado de oportunidades e pendências de planejamento. |

## Achados prioritários de código

### P0 — Comparar totais de cobertura equivalente

Em `apps/web/src/features/planejamento/lib/comparador.js`, `comparaveis` remove somente resultados indisponíveis ou inelegíveis. Não verifica `naoConsiderado`. Assim, um total sem CPP por falta de folha, ou sem ICMS em mercadorias, ainda pode ganhar o selo de menor carga.

Proposta: separar simulação completa para o escopo, estimativa parcial e dados insuficientes. O contador deve continuar podendo simular, mas a conclusão deve ser condicional quando custos relevantes não foram estimados. A cobertura precisa ser avaliada conforme a operação, não apenas pelo número de avisos.

`economiaAnual` calcula diferença entre os dois resultados mais baratos. Isso é comparação entre alternativas, não economia de migração do regime atual. Exibir separadamente economia versus regime atual, diferença para a segunda opção e itens excluídos da conta.

### P0 — Separar folha, encargos e pró-labore

Em `lib/proLabore.js`, `proLaboreHoje = folha12mAtual / 12`; `PainelProLabore.jsx` o apresenta como pró-labore mensal atual. O prefill fornece folha agregada, que pode incluir empregados e mais de um sócio. A equivalência não é geral e afeta o custo incremental de INSS/IRRF.

Proposta: informar pró-labore por sócio, separar os componentes da folha e preservar o que entra no Fator R. Projetar quando a alteração entra na janela móvel. Não apresentar o total da folha como remuneração de um sócio.

### P1 — Planejamento mensal com acompanhamento

O Simples anual usa uma alíquota efetiva sobre a receita anual; o Real distribui lucro uniformemente em quatro trimestres para o adicional. A série de início de atividade não substitui sazonalidade futura.

Proposta: manter histórico realizado e projeção dos meses restantes; recalcular RBT12, folha, Fator R, faixas e limites a cada mês; mostrar tributos mensais/trimestrais e desvio do plano. Diferenciar tributo apurado, retido e pago, evitando somar retenção como imposto adicional. Permitir cenário base, crescimento e queda sem exigir do usuário uma grade longa quando ele só precisa de uma comparação simples.

### P1 — Receitas mistas e Lucro Real detalhado

Separar receita por atividade/anexo, mercado e tratamento tributário; não deduzir a distribuição só da lista de CNAEs. Para o Real, oferecer custos/despesas e ajustes ao lucro, mantendo o modo simplificado por margem claramente identificado. Aprofundar créditos e exclusões por operação conforme as empresas efetivamente atendidas.

### P2 — Reforma completa, decisão e escala

Ampliar cenários por ano até 2033, com premissas versionadas e distinção entre regras confirmadas e estimativas. Integrar créditos de compras e impacto no cliente/fornecedor quando houver documentos adequados. Acrescentar relatório executivo com recomendação fundamentada, condições, data de revisão e cenários comparados. Depois, consolidar alertas e oportunidades por carteira.

## Organização recomendada da interface

Manter a aba simples, respeitando o pedido do usuário por menos poluição:

1. Visão inicial: regime atual, realizado versus plano, projeção do ano e ações que precisam de atenção.
2. Botão Simular cenário: receita, atividade, folha e parâmetros essenciais; opções avançadas sob demanda.
3. Cards comparativos: total, cobertura da estimativa e impostos expansíveis, reutilizando o que já foi feito.
4. Relatório: comparação com a situação atual, premissas, ressalvas concretas e conclusão do contador.

A ordem recomendada é: confiabilidade da comparação e do pró-labore → acompanhamento mensal → atividades mistas/cobertura → reforma completa e carteira. Não é necessário acrescentar todas essas funções ao formulário principal.

## Evidências internas consultadas

- `apps/web/src/features/planejamento/pages/renderPlanejamentoPage.jsx`: formulário, cenários, comparação, início de atividade e exportação.
- `apps/web/src/features/planejamento/lib/comparador.js`: ranking, economia, Real e ponto de equilíbrio.
- `apps/web/src/features/planejamento/lib/simplesNacional.js` e `lucroPresumido.js`: cálculo anual, incidência e exclusões.
- `apps/web/src/features/planejamento/lib/proLabore.js` e `components/PainelProLabore.jsx`: premissas e apresentação da remuneração.
- `apps/web/src/features/planejamento/lib/ibsCbsNoSimples.js`: alcance dos cenários da reforma.
- `apps/api/src/application/planejamento/DadosPlanejamentoService.js`: prefill e procedência.
- `apps/api/src/application/planejamento/SimulacaoPlanejamentoService.js`: persistência e documentos.

Na etapa de pesquisa, somente documentação foi alterada. Após a autorização do usuário, iniciou-se a execução descrita em [planejamento-evolucao-2026-09-15.md](planejamento-evolucao-2026-09-15.md), que separa entregas e limites ainda existentes. Não houve publicação deste lote.

Continuação de 15/09: comparação de até três cenários salvos e visão consolidada da carteira implementadas e conferidas. A carteira apresenta potencial apenas com cobertura explícita e regime atual registrado; mantém revisão e lacunas visíveis. Não amplia o motor para operações especiais nem representa economia realizada.
