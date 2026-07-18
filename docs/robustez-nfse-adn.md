# Plano de Robustez — Captura de NFS-e para Apuração do Simples Nacional

**Escopo:** municípios do RJ, apuração do Simples (PGDAS-D) a partir das notas capturadas.
**Origem:** documento estratégico do dono (17/07/2026). Este arquivo é o **roadmap oficial**.

## Status de implementação
- **Fase 1 (ledger append-only) — INICIADA no backend.** Modelos `documentos`, `eventos`,
  `nsu_watermark`, `nsu_gaps` (schema.prisma) + migration `20260717120000_add_notas_ledger`;
  primitivas em `apps/api/src/application/notas/ledger/` (`LedgerService`, `LedgerProjectionService`,
  `NsuGapService`). **Ainda NÃO ligado à captura atual** (a captura em `PortalInvoice` segue intacta).
- **Fase 0 (forense do 28 vs 27) — PENDENTE DO DONO.** Precisa de dados de produção que só o dono
  acessa: competência, CNPJ, as 28 chaves do lado nacional × as 27 do nosso, e os logs da execução
  daquela captura. O ledger acima é fundação correta **independente** do resultado da forense.
- Demais fases (2–8): não iniciadas — ver roadmap abaixo.

## Dois problemas (mesma raiz)
1. **Cancelamento tardio** de nota da competência apurada.
2. **Notas que somem** (nacional 28, nós 27).
Raiz: a captura hoje é *snapshot por janela de data*; deveria ser *assinatura de um fluxo de eventos por NSU*.

## Restrições externas que fixam a direção
- **CGSN nº 189/2026 (vigência 01/09/2026):** ME/EPP do Simples prestadoras emitem NFS-e nacional
  exclusivamente pelo Emissor Nacional. **ADN vira fonte primária; RPA municipal vira contingência/histórico.**
- **Regra do Simples:** nota cancelada em período subsequente é deduzida da receita **do período original**,
  exigindo retificar aquele PGDAS-D e, como muda a RBT12, também as competências seguintes (cascata até M+12).

---

## Fase 0 — Forense do 28 vs 27 (bloqueia o resto)
Descobrir *por que* a nota sumiu, ≥10 casos, classificando a causa: (A) janela de data · (B) paginação/limite ·
(C) falha silenciosa (erro tratado como "zero notas") · (D) escopo do provedor · (E) timing ADN ·
(F) dedupe agressivo. Entregável: distribuição percentual das causas. Se dominante (A)/(E), o robô está
correto e o bug é o modelo temporal.

## Arquitetura
- **Fonte primária: ADN por NSU.** Distribui notas E eventos no mesmo fluxo (cancelamento chega como evento).
  Fatos que precisam estar no código: até 50 DF-e/consulta (loop até lote vazio); ordem por recepção no ADN
  (progresso só por NSU, nunca por data de emissão); sem `maxNSU`; NSU menor que o disponível → devolve do
  primeiro (detectar salto, não é gap); CNPJ vem do certificado (**um e-CNPJ por estabelecimento — caminho
  crítico**); distribui pra emitente e não-emitente (**validar em homologação**); consulta pontual
  `GET /nfse/{chave}` e `/eventos`; Cláusula 17 do Convênio pode cobrar acesso em massa (instrumentar contagem).
- **Fonte secundária: municipal (RJ)** — contingência/histórico/reconciliação; não é mais a verdade.
- **Princípio inegociável: ledger append-only; status é projeção, nunca coluna gravada.**

## Modelo de dados (Fase 1 — implementado)
`documentos` e `eventos` imutáveis; `nsu_watermark` (progresso por NSU) e `nsu_gaps` (lacunas).
Projeção `situacao_nota = f(documento, eventos)`: sem eventos → AUTORIZADA; cancelamento/ofício → CANCELADA;
substituição → SUBSTITUIDA (aponta chave substituta); bloqueio sem desbloqueio → BLOQUEADA.
Regras: nunca UPDATE em documentos/eventos; escrita idempotente (dedupe por chave / (chave,tipo,nSeq));
projeção reconstruível do zero.

## Pipeline de ingestão (Fase 3 — pendente)
Loop por estabelecimento (~1h): lê watermark → distribui (≤50) → persiste doc/evento idempotente → detecta gaps →
**persiste, confirma, e SÓ ENTÃO move o watermark** → recalcula projeção das chaves tocadas → notifica cancelamentos.
Gap: NSU pulado → grava `nsu_gaps(aberto)` + consulta pontual; 3 falhas → alerta humano; gap aberto > 24h
**bloqueia o fechamento da competência**. RPA municipal (fallback): janela deslizante com folga retroativa
(−10 dias), falha nunca é zero, paginação até o fim.

## Reconciliação — 3 camadas (Fase 4/5 — pendente)
1. **Varredura retroativa de eventos (semanal):** notas AUTORIZADAS emitidas nos últimos 90d → reconsulta `/eventos`.
2. **Conferência de contagem por competência (antes do fechamento):** compara **conjuntos de chaves** (não só total)
   contra a fonte oficial; divergência **bloqueia o fechamento** (é o teste que pega o 28 vs 27 antes da apuração).
3. **Detecção ativa de faltantes (contínua):** sequência de numeração por prestador, heartbeat de emissor recorrente,
   gaps de NSU abertos.

## Apuração — cancelamento e cascata RBT12 (Fase 5 — pendente)
Máquina da competência: ABERTA → EM_CONFERENCIA → FECHADA → TRANSMITIDA → [REABERTA] → RETIFICADA.
Nunca sair de ABERTA com gap aberto, divergência de contagem, ou robô com falha no período.
Cancelamento: antes do fechamento = não entra; após fechamento antes de transmitir = reabrir/recalcular;
**após transmitir = retificação** da competência original **+ retificar M+1..M+12** (RBT12 mudou → alíquota das
seguintes foi calculada sobre base errada). DAS a maior → restituição/compensação; a menor → complementar.
**Não automatizar a transmissão da retificadora** — gerar tarefa/cálculo/diff/impacto; envio é humano.
Regime de caixa vs. competência: PGDAS-D tem os dois campos; ambos preenchidos (caixa = base mensal;
competência = alimenta a RBT12/alíquota).

## Observabilidade (Fase 7 — pendente)
Métricas por município/estabelecimento: defasagem de captura (p50/p95), gaps abertos, notas sem reconferência 90d,
divergência de contagem por competência, taxa de erro (≠ "0 notas"), chamadas ADN/dia (custo), competências
reabertas por cancelamento tardio. Alertas: gap > 24h, divergência em conferência, watermark parado > 6h,
certificado a vencer < 30d.

## Roadmap
| Fase | Escopo | Critério |
|---|---|---|
| 0 | Forense 28 vs 27 (≥10 casos) | distribuição de causas — **precisa de dados de prod (dono)** |
| 1 | Ledger append-only + projeção | **iniciada** (modelo + primitivas; falta backfill/cutover) |
| 2 | e-CNPJ por estabelecimento | levantar custo/prazo — **caminho crítico, semana 1** |
| 3 | Ingestão ADN por NSU + gaps | reprocessável, idempotente, gap em teste sintético |
| 4 | Camada 2 (contagem) + bloqueio de fechamento | 28 vs 27 detectado antes da apuração |
| 5 | Camada 1 (90d) + cancelamento tardio com cascata RBT12 | tarefas de retificação M..M+12 |
| 6 | Robô RJ como fallback (janela, erro≠zero, paginação) | erros deixam de ser silenciosos |
| 7 | Observabilidade + alertas | dashboards no ar |
| 8 | Camada 3 (sequência/heartbeat) | faltante detectado sem a fonte oficial |

**Prazo forçado:** Fases 2 e 3 antes de 01/09/2026 (CGSN 189/2026). Certificado tem lead time → Fase 2 começa
junto com a Fase 0.

## Riscos
- Custo/prazo de e-CNPJ por estabelecimento (limitação do ADN, não contornável) — levantar semana 1.
- ADN pode não distribuir emissão própria como esperado — **validar em homologação na Fase 3 antes de commitment**.
- Instabilidade do ambiente nacional — manter fallback municipal; não desligar o robô RJ antes de 2 competências
  100% conciliadas.
- Cobrança por acesso em massa (Cláusula 17) — instrumentar contagem desde o dia 1.
- Retificação em massa ao ligar a Camada 1 — rodar primeiro em dry-run (dimensionar passivo), depois ligar tarefas.

## Fora de escopo
- Transmissão automática de PGDAS-D retificador (gerar tarefa, não transmitir).
- Expansão fora do RJ (design já suporta; validação de cobertura é projeto próprio).
- OCR de PDF (só se a Fase 0 mostrar causa dominante em documentos só-papel/PDF).
