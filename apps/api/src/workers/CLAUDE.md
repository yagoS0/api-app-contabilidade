# CLAUDE.md — Workers (apps/api/src/workers)

Jobs de background. Executados in-process (sem fila externa), **opt-in por env var**
(default desligados). Cada worker tem um loop próprio com intervalo e lock.

## Padrão de worker

- `runXxxWorkerOnce(options)` — executa **um ciclo** (idempotente, isolado por empresa).
  Retorna um `summary` estruturado. É o que os endpoints de disparo manual chamam.
- `runXxxWorkerLoop()` — `while(true)` com `setTimeout(LOOP_INTERVAL_MS)`; a cada tick
  decide se roda o ciclo (via cron + `tickKey` pra não repetir no mesmo minuto).
- **Lock global** via `tryAcquireGuideLock(LOCK_ID, TTL)` / `releaseGuideLock` — 1
  processador por vez (evita concorrência no mesmo CNPJ contratante SERPRO).
- **Isolamento por empresa:** cada empresa em try/catch; erro de uma não derruba o ciclo.
  O resultado por empresa entra em arrays (`results`, `recheckResults`, `extratoResults`).
- **Auditoria:** `createSerproExecutionLog({ worker, competencia, settings, summary })`.

## Agendamento (não fixo)

O cron **não é hardcoded**: vem de `SerproRuntimeSettings` (configurável na página do
SERPRO). `getSerproRuntimeSettings()` deriva `fetchCron` (diário no `fetchHour` escolhido)
e `fetchDay` (dia do mês a partir do qual a captura começa). O loop usa `matchesCron`.

## Workers existentes

| Worker | Env | O que faz |
|---|---|---|
| `serproPgdasdWorker.js` | `SERPRO_PGDASD_WORKER_ENABLED` | Simples Nacional. Por empresa elegível (regime SIMPLES, não suspensa, c/ e-mail, procuração ATIVA): **Stage 1** captura a guia DAS (`capturePgdasGuideForCompany`); **Stage 3 (Q17)** baixa o **extrato/declaração** e **gera os lançamentos** (`syncPgdasByCompetencia` → `generateEntriesFromCircular`), só se a competência ainda não estiver `serproSyncStatus="SUCCESS"` (idempotente, evita re-hit pago); **Stage 2** re-fetch diário das guias OPEN até o vencimento; **Stage 4 (Q22/Q23)** traz as guias de PARCELAMENTO (atrás de `INTEGRACAO_SERPRO_PARCELAMENTO`) — só dos parcelamentos `status="ATIVO"` + `numeroParcelamento` + **`aberturaEntryId` não nulo** (i.e. a 1ª parcela manual já gerou a provisão); traz só guia+PDF+e-mail e persiste `TributoParcela` (o pagamento sai no "pago"). |
| `serproDctfwebWorker.js` | `SERPRO_DCTFWEB_WORKER_ENABLED` | INSS/DCTFWeb — mesmo padrão de captura de guia. |
| `apuracaoBatchWorker.js` | `APURACAO_BATCH_WORKER_ENABLED` | Fila de transmissão PGDAS-D em lote (consulta-antes-de-transmitir). |
| `guideEmailWorker.js` | `GUIDE_EMAIL_WORKER_ENABLED` (default OFF) | Envio de guias por e-mail. Em prod o envio é manual (BatchEmail); ver `apps/api/CLAUDE.md`. |
| `dfeNotasWorker.js` / heartbeat | `DFE_NOTAS_WORKER_ENABLED` | Captura NF-e (NFeDistribuicaoDFe) + heartbeat. |

## Disparo manual

`POST /firm/serpro/cron/run` (em `routes/firm/index.js`) roda `runSerproPgdasdWorkerOnce`
**e** `runSerproDctfwebWorkerOnce` em paralelo (admin/contador). Como o ciclo agora inclui
o Stage 3, o disparo manual também traz guia **+ extrato + lançamentos**.

## Regras

- **Idempotência é obrigatória** — workers podem rodar várias vezes; nunca duplicar guia,
  lançamento ou transmissão. Guardas: `serproSyncStatus`, `findFirst` antes de criar,
  unique constraints.
- **Custo SERPRO:** cada chamada é paga. Só buscar o que falta (guardas acima).
- Nunca hardcodar credenciais/URLs/cron — tudo via `SerproRuntimeSettings`/`config.js`.
- Isolamento multi-tenant: sempre filtrar por `portalClientId`.
