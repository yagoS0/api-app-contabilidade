# CLAUDE.md — Guias (apps/web/src/features/guides)

Feature de guias no frontend: listagem por empresa, upload/identificação, captura,
envio em lote e o painel de guias esperadas.

## Subpastas

- `list/` — tabela de guias da empresa (`renderCompanyGuidesTable.jsx`). No topo, o
  **ExpectedGuidesPanel (Q17)**: lista as guias **esperadas** do mês (por regime/prolabore,
  via `GET /firm/companies/:id/guides/expected`), cada uma com 3 estados —
  **presente** (verde, mostra dados), **vazio** (amarelo, botão "desfazer") e **faltando**
  (vermelho, botão **"Vazio"**). Botão Vazio chama `markGuideVazio`/`undoGuideVazio`.
- `capture/` — modal de captura SERPRO. `batch-email/` — envio em lote (3 estados por
  célula: ausente X / contendo guia / enviado).

## Padrões

- A lista de guias e ações chegam por props (hooks/pages). O `ExpectedGuidesPanel` é
  auto-contido e usa `createApiClient()` direto (mini-página).
- `tipo="SIMPLES"` é a guia do DAS; a UI rotula como "DAS". `status="VAZIO"` = ausência
  confirmada (amarelo) — não é guia com PDF.
- **Lucro Presumido = 1 DARF consolidada `tipo="OUTRA"`** (não pode ser split). `tipoGuiaLabel`
  (`list/renderCompanyGuidesTable.jsx`) troca "OUTRA" pelos impostos contidos ("PIS · COFINS"),
  lendo `guide.extracted.composicao` — que **o backend precisa enviar** (`toGuideResponse`).
  Se voltar a aparecer "OUTRA" na tela, o suspeito nº 1 é a composição não estar vindo na resposta.
- ⚠ **A coluna PARC do envio em lote carrega DOIS conteúdos** e só um é enviável: a **guia da
  parcela** (SERPRO/V2 — tem PDF, precisa entrar no envio) e a **linha leve de rastreio do V1**
  (`isParcelamento`, sem documento, só informa). Por isso o "info-only" é do **valor da célula**, não
  da coluna: enquanto era da coluna, empresa cuja única pendência do mês era a parcela sumia do
  filtro "só pendentes" e ninguém conseguia selecioná-la.
- Cores de estado: verde `#69FF47`, amarelo `#FFB347`, vermelho `#FF5757`.
- Toda chamada nova precisa de par mock/real em `src/api/`.
