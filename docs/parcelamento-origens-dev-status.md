# Integração Circular, Lançamentos e Parcelamento — desenvolvimento

Atualizado em 07/10/2026. Branch local `codex/parcelamento-origens-dev`. Não publicado em main/produção. Escrita da composição real depende de `PARCELAMENTO_ORIGENS_ENABLED=true` (desativada por padrão); leitura e proteção das origens existentes permanecem disponíveis.

## Implementado e verificado em dev

- Seleção por imposto e competência, filtros, seleção de todos os elegíveis, vencimento, total selecionado e atualização dos saldos.
- Composição separada e imutável, preservando as provisões e pagamentos anteriores. Inclusão do saldo residual integral; não permite repartir uma origem entre acordos.
- Sugestão editável de lançamentos e histórico resumido por imposto/ano; conferência de principal, contas, empresa, modalidade e saldo atualizado no servidor.
- Circular com estado Parcelado distinto de Pago, retirada da fila de baixa direta e acesso à composição do acordo.
- Situação Fiscal/PDF com origem Contabilidade. Rescisão apresenta A conciliar e saldo desconhecido, sem inventar rateio ou restaurar o valor integral original.
- Proteção transacional e no PostgreSQL contra baixa, alteração financeira, estorno ou exclusão das origens incluídas. Concorrência, repetição de pedido, fechamento mensal e rollback verificados.
- Conversão explícita de vínculo legado no próprio acordo ativo quando a reclassificação existente é compatível; casos ambíguos permanecem protegidos.
- Correção das caixas transitórias no carregamento de Parcelamento incorporada nesta branch.

## Validação executada

- 718 testes de accounting/API e Circular aprovados; 42 testes focados adicionais aprovados após a proteção de exclusão concorrente.
- 378 testes web de parcelamento, regras da Circular, mock e PDF aprovados; 44 testes do componente Circular aprovados, incluindo Parcelado sem sinal de pagamento.
- Oito cenários de integração com PostgreSQL real: concorrência/idempotência, proteção de origem, projeções, rollback, saldo desatualizado, criação contábil, mês fechado e conversão legada.
- Todas as 186 migrations aplicadas em banco local isolado e descartável `altan_parcelamento_test`, porta 55444. Nenhuma migration aplicada em produção. Prisma validate e auditoria de migrations aprovados.
- Build web aprovado. Fluxo visual demonstrado com dados fictícios: criação com PIS/COFINS, sugestão dos lançamentos, composição, Circular e retorno ao acordo.
- Preview local em http://127.0.0.1:5201 usa modo demonstração, sem consultas fiscais externas; seus dados são temporários em memória.

## Ainda pendente antes de liberar o circuito completo

- Conciliação explícita do saldo após rescisão e regras de reparcelamento. Exclusão de acordo com composição continua bloqueada; não há liberação automática das origens.
- Inventário e homologação dos vínculos legados reais; nenhuma migração automática desses vínculos foi realizada.
- Homologação contábil com contas e guias reais, especialmente guias sem provisão e separação de principal/encargos.
- Rateio parcial entre acordos não faz parte desta etapa.
- Revisão de ciclo de vida e confirmação de exclusão previstas no plano original ainda exigem implementação/homologação próprias.

Plano de referência: `docs/plano-parcelamento-dividas-circular-20261006.md` no checkout `pendencias-fiscais-dev`.

## Entrada diferente da parcela regular — 07/10/2026

- Cadastro com entrada única ou dividida, valor de cada entrada, vencimento próprio e início separado das parcelas regulares. O total inclui a entrada; a numeração é contínua.
- Prévia do cronograma e total restante consideram cada prestação, inclusive contratos cadastrados com histórico de pagamentos.
- Cronograma explícito persistido e materializado em `parcelas`, com valor/data próprios. Reingestão não substitui cronograma existente nem pagamentos.
- Referência do cartão representa a parcela regular; entradas identificadas na tabela. Amortização por média não é estimada para cronogramas explícitos; permanece disponível o saldo contábil do razão.
- Migration `20261007180000_parcelamento_cronograma_entrada` aplicada somente ao banco local isolado. Cadastros existentes não recebem valores inferidos nem alteração automática.
- Validação: 723 testes API, 342 testes web; ensaio PostgreSQL ampliado para 10 cenários, incluindo PARCSN e LUCRO_PRESUMIDO com composição da Circular, entrada de 3000 + dez parcelas de 700, baixa das duas primeiras prestações e reenvio sem duplicação. Tela testada com criação de acordo fictício e conferência dos valores salvos.
- Mudança em dev; nenhuma operação fiscal ou escrita em produção. Conciliação/rescisão/reparcelamento continuam com os limites descritos acima.
