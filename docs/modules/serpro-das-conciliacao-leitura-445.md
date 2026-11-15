# DAS/SERPRO — projeção interna somente leitura 4.4.5

Base `044b687bab081592d6a49d2d3749fa80ae2c296c` (PR #281). Complementa a [caracterização de recuperação 4.4.4](serpro-das-recuperacao-conciliacao-444.md). Não implementa recuperação, repetição, reparação contábil ou resolução de reservas.

## Contrato e autorização

Entrada interna: `consultarConciliacaoDas445Interna(input, { auth })`, em `apps/api/src/composition/conciliacaoDas445.js`. Não há rota, UI, worker ou consumidor automático novo.

```js
await consultarConciliacaoDas445Interna({
  companyId: 'empresa-autorizada', competencia: '2026-10',
  servico: 'GERARDAS12', // opcional: GERARDAS12 ou GERARDASCOBRANCA17
  documentoId: 'guia-local', // opcional; nunca amplia a empresa
  limit: 50 // opcional, 1–100 por fonte
}, { auth: sessaoAutenticadaPeloServidor });
```

`auth` deve vir exclusivamente da autenticação do servidor; nunca do corpo de uma requisição. A composição reutiliza `requireAccountType('FIRM')` e `requireFirmCompanyAccess({minRole:'ACCOUNTANT'})` antes de qualquer leitura de evidência. Preserva a exceção admin existente, vínculo ACTIVE e peso de papel. Ausência de sessão, conta CLIENT ou vínculo insuficiente recusa com `ACESSO_NEGADO` e status 401/403. Entrada inválida recusa com `ENTRADA_INVALIDA`. Falha na autorização é fatal, não resultado parcial. A operação não substitui a autenticação da futura entrada que a consumir.

A proteção do #275 permanece intacta. O lote moderno tem política global admin/contador diferente; não foi harmonizada nem reutilizada aqui.

## Donos e portas

| Contexto | Capacidades específicas | Associação e limite |
| --- | --- | --- |
| Fiscal | chamadas, cache, despachos; interpretação fiscal pura | Ledger por empresa/competência/PGDASD/serviço. Cache apenas por assinaturas selecionadas; despacho por reserva e empresa conferidas. Não usa o leitor legado que pode invalidar cache. |
| Guias | guias, pagamentos; projeção documental | Guias mensais não parceladas, inclusive upload e sourceFileId nulo; ID opcional sempre escopado. Calcula versão de pagamento pela função legada e compara eventos históricos; consulta estado separado por chave exata. |
| Contabilidade | circular, lancamentos; projeção contábil | Circular mensal, fechamento contábil e linhas. Distingue sourceGuideId de candidatos DAS sem vínculo inequívoco. Circular não prova provisão; estado de confirmação não prova baixa. |
| Operações | execucoes, worker; coordenação da consulta | FiscalExecutionLog e itens da empresa/competência nos logs multiempresa. Não expõe resumo global, settings, CNPJ/email de terceiros ou mensagens livres. |

A aplicação de Operações recebe essas capacidades e as projeções públicas pela composição, sem importar Prisma, SDKs ou implementações de outro contexto. Os adaptadores Prisma pertencem aos respectivos contextos. Pontos públicos específicos desta entrega não alteram fachadas ou exports legados.

`servico` restringe o ledger/cache, **não** os documentos mensais: uploads reutilizáveis não têm serviço confiável. `guias.guias.recorte` informa expressamente essa diferença. Documento selecionado não cria vínculo implícito com uma chamada, circular ou provisão.

## Forma do resultado

O DTO contém `contrato`, entrada normalizada, `consultadoEm`, `consistencia`, quatro dimensões (`fiscal`, `guias`, `contabilidade`, `operacoes`) e `lacunas`. Cada fonte tem `consulta`, `items`, `truncated`, `limit` e lacunas próprias. Falha usa `items:null`, nunca lista vazia. Não existe booleano global `conciliado` nem decisão de retry.

Exemplos resumidos, ilustrativos dos contratos testados:

```json
{
  "fiscal": {"estado":"Incerto","lacunas":["RESULTADO_EXTERNO_INCERTO_CACHE_NAO_RESOLVE_RESERVA"]},
  "guias": {"estado":"Não verificável"},
  "lacunas":["CACHE_SEM_GUIA_NO_RECORTE"]
}
```

```json
{
  "guias":{"estado":"Confirmado pela evidência local","fatoConfirmado":"REGISTRO_DOCUMENTAL_LOCAL_APENAS"},
  "contabilidade":{"estado":"Parcial","lacunas":["LANCAMENTO_SEM_VINCULO_DOCUMENTAL_INEQUIVOCO"]}
}
```

```json
{
  "contabilidade":{"circular":{"consulta":"falhou","items":null,"erro":"FONTE_INDISPONIVEL"}},
  "lacunas":["FONTE_NAO_VERIFICAVEL:circular"]
}
```

O último cenário não afirma circular ausente. Truncamento impede provar unicidade documental ou ausência de provisão. Fechamento produz dimensão contábil `Bloqueado`, mas não bloqueia a própria consulta. Confirmado significa somente registro local identificado, nunca validade fiscal externa, pagamento, entrega ou conciliação global.

## Limites e dados sensíveis

- Observações independentes, algumas paralelas, sem snapshot global: fontes podem mudar entre consultas. Nenhuma trava ou reserva é adquirida para esta leitura.
- Cache órfão ou ledger legado sem empresa/competência/assinatura correlacionável não pode ser descoberto com segurança. Não há varredura global do cache.
- Limite por fonte e por linhas, ordenação estável e truncamento explícito; não é relatório exaustivo ou paginado. Falha de uma fonte não é repetida e não impede as fontes independentes.
- PDF incorporado, storageKey e comprovante são presença/referência, não validação de conteúdo. Não há download, consulta ao SERPRO nem parsing externo de PDF. Interpretação pura do cache pode não obter o valor que o fluxo de captura recuperaria pelo PDF; não inventa esse fallback.
- Revisão de pagamento legada é distinta do token de correção SHA-256 e da comprovação de entrega. Eventos de revisão anterior são preservados e identificados.
- `completed`/`entriesGenerated:0` não persistem `accounting.ok`. Não se reconstrói sucesso ou falha contábil apenas desse log. O cenário de captura com `accounting.ok:false` permanece caracterizado na suíte 4.4.4.
- Lançamento sem sourceGuideId é candidato mensal, não provisão comprovada para a guia. Linhas não certificam correção do razão; valores são devolvidos como strings e comparados sem arredondamento.
- DTO não contém bytes, resposta bruta, extracted integral, credenciais ou mensagens livres. Logs e fixtures de teste não devem conter dados reais.

## Evidências, revisão e rollback

A seleção foi caracterizada antes da projeção por ensaio PostgreSQL 16 sintético: 13 verificações, seis SELECTs, rollback integral das fixtures. As suítes versionadas de seleção, aplicação, autorização e PostgreSQL cobrem os 14 cenários solicitados e as correções identificadas na revisão. PostgreSQL compara registros antes/depois, mede somente SELECTs durante a consulta e usa adaptadores de leitura que recusam outras operações; transporte fiscal é substituído por doubles que falham se chamados.

Código de captura, workers, cache/TTL, reservas, schema/migrations, pagamentos e escritores contábeis não são alterados. O workflow focal executa as novas suítes no PostgreSQL 16 descartável; governança e arquitetura permanecem em diagnose. Resultados finais e pareceres ficam no registro da mudança e no PR, sem simular aprovação humana.

Controlador `2026-11-14T21-25-39-128Z-3e3afa68`: `escalated`, timeout do executor; não atingiu `ready_for_human`. O Principal concluiu a validação e submeteu o diff a revisores independentes, registrando as limitações reais.

Rollback: reverter apenas os commits desta entrega, removendo contrato interno, testes, documentação e inclusão no workflow. Não há alteração de dados a desfazer. Preservar worktree, logs privados e banco sintético; nenhuma limpeza ou recuperação funcional está autorizada.
