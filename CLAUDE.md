# CLAUDE.md — Portal Contábil

Instruções e contexto para o Claude Code neste projeto.

## Visão Geral

Portal contábil full-stack multi-tenant para gestão de documentos fiscais brasileiros (NFe, NFS-e, guias).

**Dois perfis de uso:**
- **Escritório:** gerencia carteira de empresas clientes
- **Cliente:** gerencia seus próprios documentos fiscais

## Monorepo — Estrutura

```
apps/api/         - Backend Node.js/Express (porta 3000)
apps/web/         - Frontend React/Vite
apps/pdf-reader/  - Serviço Python/FastAPI de parsing de PDF (porta 8000)
packages/shared/  - Contratos e tipos compartilhados
```

Cada app tem seu próprio `CLAUDE.md` com regras específicas.

## Tech Stack

| Camada     | Tecnologia                              |
|------------|-----------------------------------------|
| Backend    | Node.js 20, Express.js, Prisma, PostgreSQL |
| Frontend   | React 19, Vite, TailwindCSS             |
| Parser     | Python 3.12, FastAPI, pdfplumber        |
| Auth       | JWT + RBAC                              |
| Email      | Gmail API (delegação) / Nodemailer SMTP |
| Deploy     | Railway / DigitalOcean + Docker + GitHub Actions |

## RBAC

- **FIRM:** `ADMIN`, `ACCOUNTANT`, `STAFF`
- **CLIENT:** `OWNER`, `ADMIN`, `USER`

Rotas protegidas pelo middleware `requireRole`. Nunca bypassar sem motivo explícito.

## Progresso e Histórico de Mudanças

### Em andamento (branch `dev`)

- [x] Módulo de lançamentos contábeis — base completa (plano de contas, OFX,
  export CSV, baixa de provisões, circular anual, históricos persistentes,
  funções de lançamento, parcelamentos)
- [x] **Módulo de Notas Fiscais (Q12)** — captura NF-e (SEFAZ DFe) + NFS-e (ADN
  Nacional gov.br) com cert A1 por empresa; manifestação destinatário; workers
  automáticos com rate limit; alertas de cursor desatualizado.
- [x] **Apuração Simples Nacional — refundação (Q14)** — cadastro = autoridade,
  classificação como sinal, motor de cálculo local, Fator-R mensal, filas de
  pendência. Models: CadastroFiscal, ProdutoServico, RegraClassificacao,
  CnaeAnexo, AliquotaSimplesNacional, ApuracaoSnapshot, etc.
- [~] **Apuração — fluxo de fechamento + SERPRO (Q15)** — tabela global com
  seleção múltipla; FechamentoModal (atividades, folha 12m, disparidade);
  **simulação oficial PGDAS-D (TRANSDECLARACAO11) validada em produção real**;
  fila de transmissão em lote (consulta-antes-de-transmitir).
  - Pendente: validar os demais `idAtividade` (só o 11 exercido); transmissão
    real (`indicadorTransmissao:true`) ainda não testada; ligar worker da fila.
  - Detalhes técnicos do PGDAS-D: ver `apps/api/CLAUDE.md`.
- [x] **Parcelamento real (Q16)** — 1 provisão (abertura) + linhas leves de parcela +
  baixa por pagamento; contas D/C em branco com memória por linha (igual Simples);
  envio em lote com 3 estados; selo de e-mail no dashboard.
- [~] **Fluxo mensal do contador (Q17)** — cron busca **extrato** (gera lançamentos) além
  das guias; guia **"Vazio"** (ausência confirmada → amarelo); **circular com trimestre/anual**
  por linha; **fechamento contábil do mês** (bloqueia se houver lançamento em branco/D≠C);
  dashboard filtra por competência (mês anterior) + pendências; card muda de cor quando
  fechada; aba **Lançamentos** vira a primeira. Cada bloco de arquitetura tem seu `CLAUDE.md`.
  - Pendente: aplicar a migração `add_fechamento_contabil` (requer o banco no ar).
- [x] **UI do dashboard + aba Lançamentos (Q18)** — dashboard: botões reordenados
  (Nova empresa · Envio de e-mails · Apuração · Configurações-dropdown), "Atualizar" vira
  ícone, filtros compactos, cards menos coloridos (tags só com borda), CNPJ branco, card
  teal quando fechada. Lançamentos: **adicionar inline** (DraftEntryRow, auto-reabre até
  ESC/Sair), **filtros compactos**, **cadeado** de fechamento perto da tabela, colunas
  **Tipo/Status removidas**, títulos centralizados/brancos, e **carga automática** ao
  abrir a aba/mudar competência (effect em `useManageAccountingWorkspace`).
  **Mês fechado bloqueia** novo lançamento e upload/registro de guia manual + marcar Vazio
  (helper `isMonthClosed`; back retorna 409/`MES_FECHADO`; front desabilita os botões).
  Aba **Apuração V2 removida** do header da empresa.
- [x] **Guias — barra de ações única (Q57)** — ao selecionar 1 guia: **Recalcular** (um botão,
  detecta INSS→DCTFweb / DAS→PGDAS-D), **Confirmar pagamento**, **Liberar ao cliente** (envia SÓ a
  guia por e-mail; se já enviada, modal de reenvio), **Excluir** (hard-delete já revoga). Removidos
  Reenviar/Revogar/Parcelamento solto/Recalcular INSS. Liberar por-guia: `POST /firm/guides/:id/liberar-cliente`
  (o empacotamento DAS+INSS fica só no envio em lote da página principal).
- [x] **Notas Fiscais — aba enxuta (Q58)** — 2 janelas: **NFS-e** (ADN + import XML) e **NF-e**
  (SEFAZ), a de NF-e **só com inscrição estadual** (`selectedCompany.legacyCompany.inscricaoEstadual`).
  Sem stats/legendas/rodapé; captura compacta.
- [~] **Robustez NFS-e/ADN (Q59)** — captura deve virar *fluxo de eventos por NSU*, não *snapshot por data*.
  Roadmap em **`docs/robustez-nfse-adn.md`**. **Fase 1** (ledger append-only `documentos`/`eventos` +
  `nsu_watermark`/`nsu_gaps` + projeção recalculável) codada e **verificada offline** — ainda NÃO ligada
  à captura (`PortalInvoice` intacto). **Camada 2** (conferência de contagem por chave vs ADN) **trava o
  fechamento** no "28 vs 27" (`ConferenciaAdnService`; `POST .../fechamento/:comp/conferencia`;
  `scripts/conferir-adn.mjs` roda em prod). Fase 0 (forense) superada pela detecção automática.
- [x] **Apuração dentro da empresa (Q60)** — aba Fiscal "Cadastro" → **"Apuração"**: faturamento +
  prévia (reusa `FechamentoModal`) + **extrato do Simples** (`syncPgdasCircular`) + fechar/transmitir/retificar
  por dentro da empresa. Cadastro enxuto (só regime + atividades permitidas). Tela de lote global vira
  **select-only** (só seleciona fechadas + apura em lote; o filtro `estado="fechada"` já é server-side).
- [x] **Reorganização do dashboard + fluxo fiscal (Lote C)** — dashboard com **duas visões**
  (Cards ⇄ **Ano**: grade 12 meses × empresas, fechamento contábil + apuração por célula, clique
  abre a empresa naquela competência); **filtros recolhidos** (só busca + competência aparentes,
  com setas ‹ ›); **card redesenhado** (regime·SERPRO·A1 no mesmo design; tags de guia dão lugar a
  "Enviado" quando todas enviadas; ⚠ pendência fiscal; selo PARC); **selo de processos em segundo
  plano**. "Funções em lote" virou **Consultas** e absorveu **Pendências** (aba "Situação Fiscal").
  Abas fiscais da empresa reordenadas (Notas Fiscais → Apuração → Guias → Situação Fiscal), **LP
  sem aba Apuração** (ainda não apuramos Presumido), módulo fiscal centralizado, **resumo na aba
  Notas Fiscais**. Fiscal: guia do LP mostra os tributos (PIS/COFINS) em vez de "OUTRA";
  **transmitir já devolve extrato + guia**; SITFIS mostra o relatório salvo ao abrir e reconsulta
  só pelo botão, **1× a cada 4h**.
  - ⚠ **Exige Volume no Railway em `/app/storage`** — sem ele o filesystem é efêmero e **todo
    deploy apaga os PDFs** (guias e relatórios SITFIS). Ver `apps/api/CLAUDE.md`.
- [ ] **Cofre de certificados / hardening LGPD (Q13)** — planejado (AWS KMS
  envelope encryption); remover fallback JWT→CERT_SECRET_KEY. Não iniciado.

### Concluído (main)

- [x] Autenticação JWT com workflow de aprovação por admin
- [x] Sincronização NFe via XML (import + parsing)
- [x] Emissão e consulta de NFS-e com certificado A1
- [x] Integração ADN para sync de NFS-e
- [x] Upload e parsing automático de guias PDF
- [x] Envio em lote de guias por email (worker background)
- [x] Multi-tenant: `CompanyFirmAccess` vinculando empresas a escritórios
- [x] Rota `/firm` com gestão de clientes, guias, NFS-e
- [x] PDF reader Python integrado como serviço separado
- [x] Deploy Railway com Dockerfile e variáveis de ambiente

## Princípios de trabalho (INEGOCIÁVEIS)

> Definidos pelo dono do projeto. Valem pra qualquer tarefa, em qualquer arquivo.

1. **NÃO INVENTAR NADA.** Não chutar valores, IDs, nomes de campo, endpoints,
   regras fiscais, alíquotas, estruturas de payload de API, nem comportamento de
   integração. Se um dado é externo (SERPRO, SEFAZ, RFB, gov.br) e não está
   confirmado por documentação oficial ou pelo dono, **não preencher por suposição**.
2. **O QUE NÃO SOUBER, PERGUNTAR.** Diante de incerteza sobre um requisito, um
   dado fiscal, um ID de atividade, um campo de API ou o efeito de uma ação —
   **perguntar ao dono antes de codar/executar**, não adivinhar.
3. **MARCAR O NÃO-VERIFICADO.** Quando algo só puder ser confirmado em ambiente
   externo (ex: `idAtividade` do PGDAS-D no trial), deixar explícito no código
   (ex: flag `verificadoTrial: false`) e avisar — nunca tratar como certo.
4. **FONTE OFICIAL VENCE.** Documentação oficial (apicenter SERPRO, manuais RFB,
   LC 123/06) tem prioridade sobre memória, exemplos de terceiros ou inferência.
5. **NUNCA transmitir/gravar ato fiscal por suposição.** Transmissão PGDAS-D,
   manifestação, emissão — só com dados confirmados e confirmação explícita.

## Regras Gerais

- Sempre considerar o contexto fiscal brasileiro (NFe, NFS-e, SEFAZ)
- Respeitar multi-tenancy: nunca vazar dados entre escritórios/clientes
- Não remover validações de CNPJ, certificado A1, ou regras fiscais
- Preferir editar arquivos existentes a criar novos
- Não adicionar abstrações desnecessárias — três linhas duplicadas são melhores que uma abstração prematura
