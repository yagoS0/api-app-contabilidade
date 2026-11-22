# Operações — Alternativa B2: tabela contextual

Base de caracterização: `1bfe21340db796ff668773c1a015ad07da2cce92` (B1). Escopo: composição React e contexto visual da carteira. Não implementa B3, nova conferência, regra fiscal, indicador ou contrato de backend.

## Matriz de equivalência

| Entrada | Fonte e conjunto preservados | Apresentação B2 e ações |
| --- | --- | --- |
| Apuração | Todas as `summary.items`, de `resumirEtapasOperacoes` | Região contextual geral; evidências, obrigações e apuração da empresa |
| Calculado | `OperationsApproval`, todas as linhas originais; evidências locais e ordenação da agenda | Mesmo componente incorporado; busca, filtros, seleção, cálculo explícito e detalhes existentes |
| Confirmado | Presumido: conclusão externa `apurar.concluida`. Demais: `CONFIRMED`, `RELEASED`, `EXECUTED`, `ATTENTION`, `INVALIDATED` | Fila própria preservada; não substituir pelo numerador da barra; confirmações e liberação permanecem explícitas |
| Transmitido | Todas as empresas do conjunto, inclusive sem evidência; filtros existentes | `OperationsTransmissionTable`, documentos vinculados, procedência, seleção e limite de ZIP existentes |
| Guias / Disponível / Enviado / Pago | Eixos independentes; `rows`, `filteredRows` e `visibleRows` distintos | `OperationsGuides`; selecionar todas elegíveis do filtro continua abrangendo outras páginas |
| Contabilização | Checklist existente, revisão, fechamento e tarefas | Mesmas situações e links para lançamentos; nenhuma escrita contábil introduzida |
| Alertas, distribuições e rotinas | Leitores e fluxos especializados existentes | Modais necessários e ações preservados; não incorporados à conferência futura B3 |

Os indicadores continuam usando empresas com eixo `true` no numerador. O denominador exclui apenas `na`; informação desconhecida permanece explícita. Busca e paginação não recalculam barras. A lista de pendências histórica inclui falso e desconhecido, sem tornar ambos semanticamente equivalentes.

Calculado/Confirmado filtram evidência de cálculo, enquanto os demais contextos usam eixos das projeções. Esses predicados não foram unificados. A nova paginação altera somente linhas visíveis, não elegibilidade, seleção ou alcance dos comandos.

## Responsabilidades e contratos

`OperationsPage` compõe os indicadores e o contexto ativo. `OperationsContextualTable` apresenta a região e paginação. `useOperationsTableContext` interpreta parâmetros de apresentação. `OperationsApproval`, `OperationsGuides` e `OperationsTransmissionTable` continuam donos de seus fluxos de interface, reutilizando os leitores e comandos existentes.

Nenhuma API, autorização por empresa, contrato HTTP, FS12, revisão fiscal, payload, reserva, idempotência, pagamento, provisão ou fechamento é alterado. A seleção de indicador não autoriza cálculo, consulta fiscal, transmissão ou envio. Esses efeitos continuam exigindo as ações e confirmações existentes, com validação no servidor.

Persistir somente competência, etapa, modo, busca, filtro, ordenação e página. Não persistir seleção executável, confirmação, revisão, autorização ou evidência. Mudança de competência descarta contexto incompatível; login e encerramento da sessão limpam a memória de retorno. O provedor de navegação mantém montagem e proteção de rascunhos existentes.

## Caracterização e evidências

Antes da extração: 398 testes aprovados em 29 suítes de Operações, navegação e carteira. O primeiro conjunto dirigido teve 73 testes aprovados (subconjunto, não somar).

A bancada exporta a base exata, usa componentes reais com fixtures sintéticas e bloqueia rede externa. Comparação prevista em 1440, 390 e 360 pixels, reflow e zoom nativo de 200%. Base: zero overflow global, erros JavaScript e chamadas externas; seis ocorrências axe preexistentes de `label-content-name-mismatch`. Resultados finais e capturas são registrados no PR e no registro de governança.

O controlador `2026-11-22T11-02-18-744Z-787780ff` terminou em `escalated` por timeout do executor. A implementação parcial foi preservada e a conclusão supervisionada pelo principal; não foi declarado `ready_for_human`. Testes e pareceres independentes não devem ser confundidos com conclusão automática desse controlador.

## Riscos, limites e rollback

Risco elevado: navegação compartilhada, seleção entre páginas e substituição do isolamento do modal. Validar ação pendente, resposta tardia, retorno da empresa, recarga, troca de competência e sessão. Não interpretar testes sintéticos como homologação fiscal ou produtiva.

Rollback: reverter exclusivamente o commit de apresentação, testes e documentação. Sem migração, backfill, alteração ou restauração de dados. Publicação e integração dependem de autorização humana separada.

B3 deve caracterizar a conferência integrada antes de retirar os diálogos remanescentes. Este incremento não cria novos denominadores, capacidades de lote ou fluxos fiscais do protótipo.
