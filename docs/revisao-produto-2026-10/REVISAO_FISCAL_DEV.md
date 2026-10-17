# Revisão fiscal em desenvolvimento — 16/10/2026

## Direção e impacto

Leitura da referência viva `../altan-regras-operacionais/REGRAS_OPERACIONAIS.md`, dos quatro documentos do usuário e das decisões dos módulos. Escopo deste agente: Notas, Apuração, Guias, Situação Fiscal e Planejamento. Sem publicação, migração, envio, consulta fiscal paga ou mudança de matriz tributária.

Aplicam-se R02 (erro não é ausência), R04–R06 (reabertura auditável, persistida e sem transmissão implícita), R10–R12 (documento/envio/pagamento separados), R19–R22 (propagação, concorrência e interface). Alterações técnicas implementam esses contratos, sem aprovar V01–V08. A frase auxiliar sob o resumo de guias foi explicitamente rejeitada pelo usuário e não é requisito visual vigente.

## Matriz de atendimento

| Tela / requisito do plano | Situação | Evidência / decisão |
| --- | --- | --- |
| Notas: auditoria compacta e contextual | Implementado neste incremento | `PendenciasPeriodoBanner`: contador e acesso à auditoria em faixa compacta; eliminado parágrafo permanente, preservado contexto no detalhe e bloqueio durante operação. |
| Notas: captura, emissão, importação e paginação | Já atendido, preservado | Fluxos existentes separados; lista de até 100 notas, download e próxima página. Auditoria tem URL própria. Sem nova captura externa não comprovada. |
| Notas: posteriores ao fechamento/transmissão | Já atendido, preservado | Pendências persistidas por empresa/competência, conclusão com justificativa; não retifica automaticamente. Marco novo ainda depende de V07. |
| Apuração: base, revisão, conferência e confirmação | Já atendido, preservado | FechamentoModal reutilizado; cálculo identifica versão, alteração invalida resultado, confirmação exige competência. Não criadas novas etapas de navegação. |
| Apuração: faixas recolhidas/Fator R apenas condicional | Substituído por decisão específica do módulo | CLAUDE exige tabela sempre aberta, seguida de Fator R e comparação. Mantida ordem e ações junto da competência. |
| Apuração: não simular progresso indisponível | Implementado neste incremento | Barra do Fator R existe apenas quando o índice é conhecido; ausência continua no campo e indicadores, sem barra indeterminada. |
| Apuração: reabrir realmente | Implementado neste incremento | Confirmação em Modal compartilhado com motivo; lock síncrono; exige `ok:true` e snapshot `aberta`; relê dados antes do editor; descarta resposta de outro contexto. |
| Apuração: histórico e atomicidade da reabertura | Implementado neste incremento | CAS e evento `APURACAO_REABERTA` em uma transação. Evento contém snapshot anterior serializável, revisão anterior/nova, autor, motivo e data. Legado sem motivo mantém `null` explícito. Sem apagar declaração, guia, envio ou pagamento. |
| Guias: competência × vencimento | Já atendido, preservado | Cabeçalho deriva mês de vencimento da competência da empresa; não adiciona seletor independente, por decisão específica posterior. Histórico e anteriores são filtros explícitos. |
| Guias: estados separados e ações elegíveis | Já atendido, preservado | Documento, pagamento com origem, envio por canal; seleção, confirmação, recálculo por guia e comprovantes existentes. Informação do cliente não foi convertida em baixa contábil. |
| Guias: reduzir legendas e reconhecer recálculo | Implementado neste incremento | `Processada` sai da segunda linha repetida (continua no título da célula). Erro/processamento continuam visíveis. Valor recalculado ganha rótulo e cor de token legível no dark. |
| Guias: código truncado, copiar, histórico | Já atendido, preservado | Linha digitável tem ellipsis e botão de copiar dígitos; histórico é acessível. |
| Guias: novo denominador universal de documentos esperados | Pendente de negócio/dados | V02/V03 não aprovados. Não fabricar quantidade de PDFs a partir de tributos ou consolidar sem identidade documental. |
| Situação fiscal: origem, atualidade, custo e recálculo individual | Já atendido, preservado | Relatório federal separado de registros manuais/contabilidade; última leitura e janela de 4h; consulta explícita; recálculo seleciona guia e não identifica débitos por valor. |
| Situação fiscal: falha não vira ausência/sucesso | Implementado neste incremento | GET inválido gera erro; POST sem confirmação não anuncia sucesso; lock síncrono impede consulta duplicada. Nenhuma chamada fiscal automática. |
| Planejamento: premissas/cenários/comparativo | Já atendido, preservado | Premissas, comparativos, cálculo por tributo, Fator R; salvar/abrir/imprimir cenário. Ausência de margem/crédito permanece insuficiência de dados. |
| Planejamento: menos orientação fiscal permanente | Implementado neste incremento | Exceções da sugestão CNAE deduplicadas em `Conferir enquadramento`, junto ao campo correspondente. Divergência efetiva permanece visível. |
| Planejamento: sensibilidade/relatório/etapas extras | Substituído por decisão específica do módulo | CLAUDE de 14/10 exige estrutura enxuta e não restaurar estudos/etapas removidos. Componentes compartilhados preservados. |
| Planejamento: IBS/CBS e nova cobertura fiscal | Pendente de fonte/negócio quando não suportado | Não ampliar motores ou presumir alíquotas; estudo opcional e limites existentes preservados. |

## Rotas e verificação visual

Aplicação completa em `http://127.0.0.1:5276`, modo mock. Rotas verificadas da mesma empresa: `notas-fiscais`, `cadastro-fiscal`, `guides`, `sitfis`, `planejamento`. `cadastro-fiscal` é a URL de Apuração; não substituí-la por um segmento inventado. Auditoria permanece `auditoria`.

Capturas em `test-evidence/fiscal`, desktop 1440 e celular 390. `result.json` registra URL e overflow; nenhuma exceção JavaScript nem rolagem horizontal global nas dez visitas. Tabelas extensas mantêm rolagem local. A primeira captura de Notas móvel pegou carregamento e não comprova a tabela; o roteiro foi corrigido para aguardar a paginação antes da captura final.

A revisão integrada da equipe também produziu `test-evidence/rotas-produto`, com as cinco rotas fiscais nas duas larguras, incluindo Notas carregada. Essas capturas finais complementam as primeiras e integram o smoke de 14 rotas.

## Testes e limites

- Primeira rodada dirigida: 24 testes UI aprovados (Apuração e avisos de período).
- Backend após auditoria: `procedenciaDas` — 39 testes aprovados; cobre CAS, autoria/motivo, preservação de número da declaração e rejeição de falha da auditoria. Banco mockado: não afirmar prova de rollback PostgreSQL com esse teste.
- Rodada UI dirigida final: 79 testes aprovados em sete suítes (reabertura, Fator R, avisos de período, SITFIS, apresentação de guias, prefill e salvar/PDF do planejamento). O teste de PDF que havia expirado sob carga passou na execução dirigida.
- Navegador na aplicação completa: preencher receita fictícia → calcular → salvar/fechar → reabrir revisão → transmitir com competência confirmada → retificar com motivo → editor aberto para novo cálculo. Executado com sucesso, somente no mock. Evidência `test-evidence/fiscal/fechamento-aberto.png` e roteiro `work/fiscal-interactions.cjs`.
- Corrigida divergência do mock detectada nessa navegação: `getFechamento` passou a retornar `calculoRecuperavel` somente para cálculo válido em estado calculada/fechada. Antes, salvar e reabrir perdia a possibilidade de transmitir mesmo com versão íntegra. Retificação invalida a recuperação como no contrato real.
- `fechamentoPerfilEstado`: três testes aprovados após corrigir recuperação do cálculo mock.
- Rodada ampla de UI interrompida por sobrecarga simultânea; timeouts de Planejamento não são contados como testes aprovados. Reexecução dirigida registrada no relatório final da equipe.
- Os testes e a navegação mock não homologam o SERPRO, entrega de mensagens ou contabilização em produção. A equipe valida separadamente o fluxo persistido com banco de desenvolvimento e serviços externos substituídos.

## Histórico técnico

16/10/2026: eliminados falsos sucessos de reabertura e consulta SITFIS, criada auditoria transacional de reabertura e reduzidas legendas persistentes. Não houve alteração de política tributária, de elegibilidade de guias ou de confirmação de pagamento.

Revisão cruzada somente leitura dos diffs de `FechamentoService`, `SerproPgdasDeclaracaoService` e `OperationsExecution`: nenhum bloqueante encontrado. O parser mantém número/null; exigir zero explícito não converte ausência em dispensa. Execução preserva reserva, acesso e hash da versão antes da transmissão; resposta não confirmada segue para atenção sem repetir. Reabertura conserva a permissão da rota, compara a versão e grava o evento na mesma transação. A prova de rollback PostgreSQL não é substituída pelos testes unitários.
