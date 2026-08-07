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

## ⚠ Como uma guia se chama na tela — `lib/rotuloGuia.js`, e só ele

O nome da guia **não sai do `tipo`**: a parcela de parcelamento é `tipo:"SIMPLES"` igual ao DAS do
mês, e a DARF do LP é `tipo:"OUTRA"`. A regra morava **inline no JSX** de `renderCompanyGuidesTable`,
então toda listagem que não repetisse aquela expressão mostrava a parcela como se fosse o DAS.

`rotuloTipoGuia(guide)` / `tituloTipoGuia(guide)` / `ehGuiaDeParcelamento(guide)` (espelho de
`isGuiaDeParcelamento` do backend). Usados pela **aba Guias** (a caixa "Ver todas as competências" é
filtro da mesma tabela) e pela página de **guias pendentes**. Listagem nova usa o helper.

Formato: **`PARCSN Nº 1234567 · 3/10`** — modalidade · número do parcelamento · parcela atual/total.

- ⚠ **A modalidade sai CRUA (`PARCSN`, `PERT_SN`…).** O dono pediu **"PARC SN"**, mas não existe no
  projeto nenhuma tabela de abreviação de modalidade — só rótulos longos
  (`ParcelamentoModals.jsx`: `"Simples Nacional (PARCSN)"`). Escrever uma aqui seria inventar
  vocabulário fiscal. **Pendente de decisão do dono.**
- ⚠ **Nada é deduzido do `tipo` da guia.** O fallback antigo era `parcelamentoTipo || tipo`: com a
  modalidade nula (parcelamento criado pelo caminho V1, que não grava `tipo`) ele imprimia
  literalmente **"Parc. SIMPLES"** — o nome do DAS do mês, o oposto do que se queria. Modalidade
  desconhecida vira **"Parcelamento"**, o mesmo genérico do chip do dashboard (uma parcela de INSS
  parcelado também cai aqui).
- Cada pedaço só aparece com o dado presente. Total ausente **não** vira `3/?`.
- Depende de `parcelamentoTipo` / `parcelamentoNumero` / `quantidadeParcelas` no contrato — se o
  rótulo voltar a degradar, o suspeito nº 1 é a relação `parcelamento` não estar no `include`.

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
