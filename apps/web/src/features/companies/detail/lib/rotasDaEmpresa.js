// AS ROTAS DAS ABAS DA EMPRESA — uma fonte só, porque agora há DOIS consumidores.
//
// ⚠ POR QUE ESTE ARQUIVO EXISTE. Os dois mapas abaixo moravam dentro de
// `app/hooks/useManageCompaniesWorkspace.js` e serviam a um consumidor só (a navegação por
// clique). A partir do pedido do dono de 19/08/2026 — *"ao apertar control + uma das abas, abrir
// em uma nova guia do navegador aquela aba que clicamos"* — a aba passou a ser um `<a href>` de
// verdade, e o `href` PRECISA sair daqui, da MESMA fonte que a navegação usa.
//
// Montar a URL à parte no header ("/companies/" + id + "/" + segmento) funcionaria hoje e
// divergiria na primeira correção: o link levaria a um lugar e o clique a outro, e o sintoma
// apareceria como "abri em nova guia e caiu em Anotações" — que é exatamente o que a falta do par
// `SEGMENT_TO_TAB`/`TAB_TO_SEGMENT` já causou com `/calendario` e `/pendencias`.
//
// ⚠ ABA NOVA EXIGE TRÊS PEÇAS, e este arquivo é UMA delas: entrada em `GROUPS`
// (`detail/components/renderCompanyDetailHeader.jsx`), o par nos dois mapas aqui, e o bloco
// `if (companyDetailTab === …)` em `detail/pages/renderCompanyDetailPage.jsx`. Faltando o par, a
// URL cai em Anotações sem erro nenhum.

export const SEGMENT_TO_TAB = {
  guides: "guides",
  lancamentos: "lancamentos",
  circular: "circular",
  parcelamento: "parcelamento",
  obrigacoes: "obrigacoes",
  relatorios: "relatorios",
  "notas-fiscais": "notasFiscais",
  // Auditoria pré-apuração (grupo Fiscal). ⚠ O PAR EM `TAB_TO_SEGMENT` É OBRIGATÓRIO — sem ele o
  // clique na aba não navega e a URL cai em Anotações, sem erro nenhum.
  auditoria: "auditoria",
  sitfis: "sitfis",
  "cadastro-fiscal": "cadastroFiscal",
  // Configuração da emissão de NFS-e — aba própria desde 19/08/2026 (antes era um bloco dentro do
  // formulário de edição). ⚠ O PAR EM `TAB_TO_SEGMENT` É OBRIGATÓRIO: sem ele o clique na aba não
  // navega e a URL cai em Anotações, sem erro nenhum.
  "emissao-nfse": "emissaoNfse",
  // Sugestão e Pendências viraram sub-abas INTERNAS do Cadastro (estado local, não URL).
  // Links antigos caem no Cadastro Fiscal.
  sugestao: "cadastroFiscal",
  pendencias: "cadastroFiscal",
  "apuracao-v2": "cadastroFiscal",
  "plano-contas": "planoContas",
  // "configuracoes" (Configurações de Lançamentos) foi removida: lançamento não se configura,
  // ele aprende do histórico. Link antigo cai em Lançamentos.
  configuracoes: "lancamentos",
  cadastro: "cadastro",
  documentos: "documentos",
  // Cofre de senhas da empresa (grupo Empresa). ⚠ O PAR ABAIXO (`TAB_TO_SEGMENT`) É OBRIGATÓRIO:
  // sem ele o clique na aba não navega e a URL cai em Anotações sem erro nenhum.
  credenciais: "credenciais",
  anotacoes: "anotacoes",
  edit: "edit",
};

export const TAB_TO_SEGMENT = {
  guides: "guides",
  lancamentos: "lancamentos",
  circular: "circular",
  parcelamento: "parcelamento",
  obrigacoes: "obrigacoes",
  relatorios: "relatorios",
  notasFiscais: "notas-fiscais",
  auditoria: "auditoria",
  sitfis: "sitfis",
  cadastroFiscal: "cadastro-fiscal",
  emissaoNfse: "emissao-nfse",
  planoContas: "plano-contas",
  cadastro: "cadastro",
  documentos: "documentos",
  credenciais: "credenciais",
  anotacoes: "anotacoes",
  edit: "edit",
};

/**
 * A URL de uma aba desta empresa — a MESMA que `openCompanyTab` navega.
 *
 * ⚠ Devolve `""` (e não uma URL chutada) para aba desconhecida ou empresa ausente. Quem consome
 * o valor para virar `href` trata a string vazia como "esta aba não tem URL" e continua sendo
 * `<button>`: link para um lugar que não existe abriria uma guia quebrada em Ctrl+clique, que é
 * pior que não abrir nada.
 */
export function companyTabPath(companyId, tab) {
  const segmento = TAB_TO_SEGMENT[tab];
  const id = String(companyId || "").trim();
  if (!segmento || !id) return "";
  return `/companies/${id}/${segmento}`;
}
