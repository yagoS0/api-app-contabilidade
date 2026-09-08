# DRE gerencial — contrato e qualidade (08/09/2026)

- A DRE lê os lançamentos da empresa e competência pedidas, pelo plano resolvido com precedência da empresa sobre o global. Não usa mês do pagamento, não substitui fluxo de caixa e não chama provedores.
- `AccountingEntryLine.valor` chega do Prisma como `Decimal`, antes de qualquer JSON. A regra pura aceita Decimal real, number e string numérica finitos. Nunca volte ao guard que aceitava só number/string: ele produzia DRE toda zerada com lançamentos reais.
- Sinais continuam definidos pela hierarquia do plano: receitas C−D; despesas/deduções aparecem com seus sinais. Estorno participa da soma, sem apagar o original. Código reduzido identifica a conta; `codigoCompleto` decide a linha gerencial.
- Contas patrimoniais ficam fora do resultado. Código de resultado (grupos 3/4/5) sem prefixo gerencial reconhecido aparece em `naoClassificado`, causa `resultado_sem_mapeamento`. Não inventar uma classificação por nome nem jogar tudo em despesas gerais.
- Valores/tipos de linha inválidos são contados em `inconsistencias`, com causa, frase, quantidade de linhas e contas. Não possuem valor monetário fabricado. Linhas válidas continuam sendo somadas.
- Lançamento `RASCUNHO` com linhas válidas continua no resultado e torna a DRE provisória. O serviço seleciona `status`; não filtre rascunhos para fazer o aviso desaparecer.

## Contrato aditivo

`linhas`, `naoClassificado`, `semLancamento` e `demonstracao: false` continuam presentes. Adições:

```javascript
qualidade: {
  status: 'SEM_LANCAMENTOS' | 'PROVISORIO' | 'SEM_PENDENCIAS_IDENTIFICADAS',
  provisorio: boolean,
  linhasNaoClassificadas: number,
  linhasInvalidas: number,
  lancamentosRascunho: number,
  motivos: string[],
},
inconsistencias: [{ causa, frase, linhas, contas: [{ codigo, nome, linhas }] }],
```

`PROVISORIO` indica classificação pendente, linha inválida ou lançamento em rascunho. `SEM_PENDENCIAS_IDENTIFICADAS` não atesta fechamento/completude contábil, nem torna o relatório uma peça fiscal. O valor de `naoClassificado` é soma absoluta das linhas envolvidas, não saldo líquido nem estimativa de despesa a subtrair dos subtotais.

Fixtures de cliente em `apps/portal-cliente-web/src/api/mock/dreDoMock.js`: normal tem classificação pendente e rascunho; `pc-003` também mostra valor inválido; `pc-007` mostra ausência de lançamentos. São dados fictícios de teste, não valores atuais de clientes.

## Validação

54 testes API passaram: regra pura e serviço, usando `Prisma.Decimal` real para receitas, despesas, deduções, estornos e valores não classificados; contrato JSON e preservação de rascunhos válidos também cobertos. O mock tem suíte de contrato própria.

`apps/api/scripts/verify-dre-postgres.js` exercita o serviço com Decimal lido do banco, isolamento de competência/empresa, estorno, conta desconhecida e rascunho. Só aceita PostgreSQL loopback com nome terminado em `_check`, não lê `.env`, bloqueia fetch e limpa apenas empresas UUID criadas pelo ensaio. Requer migrations e geração Prisma do gate CI. Sintaxe validada localmente; execução em banco não foi realizada nesta frente. Não gerar Prisma sobre dependências compartilhadas de trabalho paralelo.
