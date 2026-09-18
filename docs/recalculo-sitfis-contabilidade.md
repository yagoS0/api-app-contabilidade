# Recálculo na Situação Fiscal — 18/09/2026

## Escopo vigente

O pedido foi restringido a oferecer recálculo na Situação Fiscal e informar sua ocorrência na Circular e nos Lançamentos. Não substituir valores contábeis, criar baixas, reabrir competências nem gerar partidas por causa do aviso. Implementação em desenvolvimento, sem publicação nesta etapa.

## Comportamento

- Área recolhível **Recalcular guias**, abaixo do relatório salvo, usando as guias cadastradas da empresa. Inicialmente lista vencidas; permite incluir não vencidas. Respeita modalidades suportadas, pagamento e parcelamentos.
- O relatório fiscal não fornece `guideId`. Não associar suas linhas às guias por valor, descrição ou competência. Recalcular não atualiza o diagnóstico documental salvo.
- Confirmação usa o modal existente e informa o possível envio por e-mail que já ocorre no fluxo DAS/DARF. Não houve envio ou consulta fiscal real na validação.
- Registro explícito `Guide.extracted.recalculoGuia`, após geração confirmada, inclusive se o total não mudar. INSS exige atualização explícita e retorno `EMITTED` com guia.
- Consultas contábeis expõem somente o registro da guia vinculada; o fallback DAS legado exige uma única guia mensal da mesma empresa e competência. Total de DARF consolidada não equivale ao valor individual de cada tributo.
- Circular: sinal **Recalculada** e detalhes ao abrir a célula. Lançamentos: **Guia recalculada** expansível, com data, total anterior e atual. Indicadores legados permanecem legíveis.
- Troca de empresa invalida listas e respostas antigas. Bloqueio compartilhado impede repetição concorrente pelo navegador.

## Validação

- Backend: 10 suítes / 91 testes, incluindo rotas Express, falha fiscal sem registro, registro antes de eventual falha de e-mail, guia paga, estados INSS, preservação em recaptura e isolamento entre empresas.
- Frontend: testes da seleção/confirmação, concorrência e troca de empresa, INSS sem confirmação, circular, lançamentos e mock integrado.
- Validação no navegador com dados fictícios: recálculo de SIMPLES 12/2025, de R$ 2.382,50 para R$ 2.501,63. Lançamento conservou R$ 2.382,50 e mostrou os dois totais no detalhe.
- Circular conferida visualmente após o mesmo recálculo: sinal na célula DAS, data e totais nos detalhes; valor contábil preservado. O novo vencimento da guia é refletido na leitura do prazo, sem marcar pagamento. O agrupamento sem subtipo/fora do regime também sinaliza recálculo e identifica somente as entradas afetadas.
- Compilação final do frontend concluída (591 módulos), com avisos preexistentes de tamanho dos arquivos e importações. `git diff --check` sem erros.
- O mock tem exemplos vinculados de SIMPLES 12/2025 e INSS 02/2026 na primeira empresa. Acréscimo de demonstração não representa fórmula tributária real.

Contextos detalhados: `apps/web/src/features/fiscal/sitfis/CLAUDE.md`, `apps/web/src/features/accounting/CLAUDE.md` e `apps/api/src/application/accounting/CLAUDE.md`.
