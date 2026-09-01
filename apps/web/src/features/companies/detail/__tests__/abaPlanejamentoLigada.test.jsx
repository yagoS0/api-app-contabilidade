// ⚠⚠ AS TRÊS PEÇAS DA ABA PLANEJAMENTO — e faltar uma FALHA EM SILÊNCIO.
//
// Aba nova neste app exige três coisas: entrada em `GROUPS`, par em `SEGMENT_TO_TAB`/
// `TAB_TO_SEGMENT`, e o bloco `if` na página. **Sem o par, a URL cai em Anotações sem erro
// nenhum** — o defeito que `rotasDaEmpresa.js` já registra duas vezes. Este arquivo é o molde do
// `abaEmissaoNfseLigada.test.jsx`: ele mede as peças, uma a uma.

import fs from "node:fs";
import path from "node:path";
import { SEGMENT_TO_TAB, TAB_TO_SEGMENT, companyTabPath } from "../lib/rotasDaEmpresa";

const ler = (...p) => fs.readFileSync(path.join(__dirname, "..", ...p), "utf8");

describe("⚠⚠ peça 2 — o par de rota, nos DOIS sentidos", () => {
  it("o segmento `planejamento` resolve para a aba `planejamento`", () => {
    expect(SEGMENT_TO_TAB.planejamento).toBe("planejamento");
  });

  it("⚠⚠ e a volta existe — sem ela a URL cai em Anotações SEM ERRO NENHUM", () => {
    expect(TAB_TO_SEGMENT.planejamento).toBe("planejamento");
  });

  it("`companyTabPath` monta a URL da aba — é a MESMA função que a navegação usa", () => {
    // Duas construções da mesma URL divergem na primeira correção, e aí o link leva a um lugar e o
    // clique a outro.
    expect(companyTabPath("emp-1", "planejamento")).toBe("/companies/emp-1/planejamento");
  });
});

describe("⚠⚠ peça 1 — a entrada em GROUPS, no grupo Fiscal e DEPOIS de Apuração", () => {
  // ⚠ A leitura é do TEXTO do arquivo: `GROUPS` não é exportado, e exportá-lo só para o teste
  // mudaria o código por causa da medição. É a mesma disciplina das varreduras de `select` da api.
  const fonte = ler("components", "renderCompanyDetailHeader.jsx");

  it("a aba está declarada", () => {
    expect(fonte).toMatch(/\{ key: "planejamento", label: "Planejamento" \}/);
  });

  it("⚠ ela vem DEPOIS de Apuração — ela lê o RBT12 e a folha que a apuração acabou de apurar", () => {
    expect(fonte.indexOf('key: "cadastroFiscal"')).toBeLessThan(fonte.indexOf('key: "planejamento"'));
  });

  it("⚠ e ANTES de Guias — a ordem do grupo Fiscal é o fluxo de trabalho", () => {
    expect(fonte.indexOf('key: "planejamento"')).toBeLessThan(fonte.indexOf('key: "guides"'));
  });

  it("⚠⚠ ela fica FORA de `TABS_COM_COMPETENCIA`", () => {
    // O planejamento usa o mês corrente e uma janela de 12 meses. Um seletor de mês no topo
    // prometeria um filtro que a rota ignora — o mesmo argumento já escrito para o Perfil fiscal.
    const linha = /const TABS_COM_COMPETENCIA = new Set\(\[([^\]]*)\]\)/.exec(fonte);
    expect(linha).not.toBeNull();
    expect(linha[1]).not.toMatch(/planejamento/);
  });
});

describe("⚠⚠ peça 3 — o bloco `if` na página, e a tela que ele monta", () => {
  const fonte = ler("pages", "renderCompanyDetailPage.jsx");

  it("o ramo existe — sem ele o clique na aba abriria Anotações", () => {
    expect(fonte).toMatch(/companyDetailTab === "planejamento"/);
  });

  it("⚠⚠ ela reusa a MESMA `PlanejamentoPage` da tela global — não uma segunda tela", () => {
    // Duas implementações do mesmo comparativo divergiriam na primeira correção fiscal, e a que
    // ninguém abre é a que erra.
    expect(fonte).toMatch(/planejamento\/pages\/renderPlanejamentoPage/);
  });

  it("⚠⚠ e ela é montada com `empresaFixa`, SEM a lista de empresas", () => {
    // Sem `empresas` o seletor não renderiza: dentro de uma empresa, trocar de empresa por ali
    // seria uma segunda porta para a mesma tela — o defeito que este projeto já nomeou com a
    // emissão de NFS-e.
    const ramo = fonte.slice(fonte.indexOf('companyDetailTab === "planejamento"'));
    const bloco = ramo.slice(0, ramo.indexOf("// Auditoria pré-apuração"));
    expect(bloco).toMatch(/empresaFixa/);
    expect(bloco).not.toMatch(/empresas=\{/);
  });
});
