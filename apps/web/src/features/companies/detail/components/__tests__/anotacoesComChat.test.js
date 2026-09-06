// ANOTAÇÕES + CHAT LADO A LADO — as peças que só a montagem tem (F2, 06/09/2026).
//
// > Dono: *"em cada cliente tenha um chat, no mesmo lugar de anotações"*.
//
// ⚠ POR QUE ESTE TESTE LÊ O TEXTO DA FONTE, e não renderiza. `CompanyDetailPage` é uma cadeia de
// `if` com meia dúzia de hooks e cinco `lazy` — renderizá-la aqui provaria menos e quebraria por
// motivos alheios. O que se prende são quatro decisões que somem em SILÊNCIO se alguém as desfizer,
// e é o mesmo recurso que `legacyCompanySelect` já usa nesta base: varredura do texto, sem lista de
// isentos. O comportamento (o fio abrindo, o seletor, a ausência dita) tem teste de verdade em
// `features/whatsapp/components/__tests__/chatDaEmpresa.test.jsx`.

import fs from "node:fs";
import path from "node:path";

const RAIZ = path.resolve(__dirname, "../../../../..");
const PAGINA = fs.readFileSync(path.join(RAIZ, "features/companies/detail/pages/renderCompanyDetailPage.jsx"), "utf8");
const CSS = fs.readFileSync(path.join(RAIZ, "App.css"), "utf8");

function ramo(nomeDaAba) {
  const i = PAGINA.indexOf(`companyDetailTab === "${nomeDaAba}"`);
  expect(i).toBeGreaterThan(-1);
  const j = PAGINA.indexOf("</CompanyTabLayout>", i);
  return PAGINA.slice(i, j);
}

describe("⚠ Anotações deixou de dividir o ramo com Documentos", () => {
  it("cada uma tem o próprio `if` — o compartilhado sumiu", () => {
    expect(PAGINA).not.toMatch(/companyDetailTab === "documentos" \|\| companyDetailTab === "anotacoes"/);
    expect(PAGINA).toMatch(/if \(companyDetailTab === "anotacoes"\)/);
    expect(PAGINA).toMatch(/if \(companyDetailTab === "documentos"\)/);
  });

  it("⚠⚠ Anotações é `trabalho` — com o chat ao lado, `leitura` espreme as duas colunas", () => {
    expect(ramo("anotacoes")).toMatch(/largura="trabalho"/);
  });

  it("⚠ Documentos NÃO mudou de largura: a divisão do ramo não podia arrastá-la junto", () => {
    expect(ramo("documentos")).toMatch(/largura="leitura"/);
  });
});

describe("⚠⚠ o chat está MONTADO ao lado das anotações", () => {
  const wrapper = PAGINA.slice(
    PAGINA.indexOf("function CompanyNotesTabWrapper"),
    PAGINA.indexOf("function CompanyCredentialsTabWrapper"),
  );

  it("as duas colunas saem da MESMA grade, e a classe é a do CSS", () => {
    expect(wrapper).toMatch(/className="anotacoes-com-chat"/);
    expect(wrapper).toMatch(/<CompanyNotesTab notes={notes} \/>/);
    expect(wrapper).toMatch(/<ChatDaEmpresa/);
  });

  it("⚠⚠ o hook monta com `companyDocsApi` — `CompanyDetailPage` NÃO recebe uma prop `api`", () => {
    // Este erro já compilou, passou nos testes e explodiu só no navegador.
    expect(wrapper).toMatch(/<ChatDaEmpresa api={companyDocsApi}/);
    expect(wrapper).not.toMatch(/<ChatDaEmpresa api={api}/);
  });

  it("⚠ ANOTAÇÕES vem PRIMEIRO no documento — é a aba dela, e é o que põe o chat embaixo no estreito", () => {
    expect(wrapper.indexOf("CompanyNotesTab")).toBeLessThan(wrapper.indexOf("ChatDaEmpresa api"));
  });
});

describe("⚠⚠ a largura vem de MEDIA QUERY, e o chat nunca some", () => {
  const bloco = CSS.slice(CSS.indexOf(".anotacoes-com-chat {"), CSS.indexOf(".anotacoes-com-chat {") + 1400);

  it("duas colunas por padrão", () => {
    expect(bloco).toMatch(/grid-template-columns:\s*minmax\(0, 1fr\) minmax\(0, 460px\)/);
  });

  it("abaixo de 1000px vira UMA coluna", () => {
    expect(bloco).toMatch(/@media \(max-width: 1000px\)/);
  });

  it("⚠⚠ em nenhum ponto o chat é ESCONDIDO — some da tela seria dizer que a empresa não fala por WhatsApp", () => {
    expect(bloco).not.toMatch(/display:\s*none/);
    expect(bloco).not.toMatch(/visibility:\s*hidden/);
  });

  it("⚠ a decisão de largura NÃO está em JavaScript", () => {
    expect(PAGINA).not.toMatch(/window\.innerWidth/);
  });
});
