// O QUE `GET /client/companies` DEVOLVE DO CADASTRO — e o que ele NUNCA pode devolver.
//
// ⚠⚠ POR QUE ISTO É UMA VARREDURA DE FONTE, e não uma chamada HTTP. O defeito desta família não é
// de comportamento: é uma LINHA QUE FALTA no `select`. Coluna ausente do `select` volta
// `undefined`, **sem erro nenhum**, e a tela lê ausência — foi assim que a lista plural de códigos
// de serviço nunca chegou ao cliente, e o seletor ficou impossível de construir sem ninguém
// entender por quê. O mesmo já havia acontecido com a carga tributária e com `codigoMunicipioIbge`.
//
// Um teste de comportamento passaria: a rota responde 200 e a tela "só não mostra". Quem acende é
// a lista explícita abaixo.

import fs from "node:fs";
import path from "node:path";

const FONTE = fs.readFileSync(path.join(__dirname, "..", "index.js"), "utf8");

/**
 * O padrão de uma CHAVE do `select` (`campo: true`), no início de uma linha.
 *
 * ⚠ Escrito com `String.raw` de propósito: numa template string comum, `\s` vira `s` e o padrão
 * deixa de casar com qualquer coisa — foi exatamente o que aconteceu na primeira versão deste
 * arquivo, e um `not.toMatch` contra regex que nunca casa é **sempre verde**.
 */
function chaveDoSelect(campo) {
  return new RegExp(String.raw`^\s*${campo}:\s*true`, "m");
}

/** O bloco `legacyCompanySelect`, isolado — as asserções são sobre ele, não sobre o arquivo. */
function blocoDoSelect() {
  const ini = FONTE.indexOf("const legacyCompanySelect = {");
  expect(ini).toBeGreaterThan(-1);
  const fim = FONTE.indexOf("\n    };", ini);
  expect(fim).toBeGreaterThan(ini);
  return FONTE.slice(ini, fim);
}

describe("⚠ o cadastro fiscal que a tela de emissão do cliente PRECISA", () => {
  const bloco = blocoDoSelect();

  it.each([
    ["codigoServicoNacional", "o código único — a autoridade quando não há lista"],
    ["codigosServicoNacional", "⚠ A LISTA PLURAL: sem ela o seletor não tem o que oferecer"],
    ["inscricaoMunicipal", "sem ela a emissão é recusada no pré-voo"],
    ["regimeTributario", "decide se o campo de ISS existe na tela"],
    ["rpsSerie", "a tela avisa quando falta"],
  ])("`%s` está no select (%s)", (campo) => {
    expect(bloco).toMatch(chaveDoSelect(campo));
  });

  it("⚠ `codigosServicoNacional` e `codigoServicoNacional` são DOIS campos, e os dois viajam", () => {
    // O plural não substitui o singular: a autoridade do backend usa a lista quando ela existe e
    // cai no singular quando não. A tela espelha isso, e para espelhar precisa dos dois.
    expect(bloco).toMatch(/\bcodigoServicoNacional:\s*true/);
    expect(bloco).toMatch(/\bcodigosServicoNacional:\s*true/);
  });
});

describe("⚠⚠ o que NUNCA pode vazar para o lado do cliente", () => {
  const bloco = blocoDoSelect();

  it.each([
    ["emissaoClienteLiberadaEm", "instante do clique do contador — auditoria DELE"],
    ["emissaoClienteLiberadaPor", "id de um usuário do ESCRITÓRIO"],
    ["certPasswordEnc", "senha do certificado A1"],
    ["certPfxBytes", "o próprio certificado"],
  ])("`%s` NÃO está no select (%s)", (campo) => {
    // ⚠ A asserção é sobre a CHAVE (`campo: true`), não sobre o nome solto: o bloco CITA
    // `emissaoClienteLiberadaEm` num comentário que explica por que ele não entra — e um
    // `not.toContain` cru quebrava por causa do próprio comentário que protege a regra.
    expect(bloco).not.toMatch(chaveDoSelect(campo));
  });

  // ⚠⚠ A CONTRAPROVA, e ela existe porque a primeira versão deste bloco passava POR VACUIDADE:
  // o regex tinha sido escrito com `\s` dentro de uma template string, onde `\s` vira `s` — o
  // padrão virou `^s*campo:s*true` e não casava com NADA. Um `not.toMatch` contra um regex que
  // nunca casa é sempre verde.
  //
  // Estes dois casos usam o MESMO construtor sobre campos que ESTÃO no select: se ele voltar a não
  // casar, aqui acende, e o bloco de cima volta a valer alguma coisa.
  it.each(["codigoServicoNacional", "codigosServicoNacional"])(
    "⚠ o construtor do padrão realmente casa — `%s` É encontrado",
    (campo) => {
      expect(bloco).toMatch(chaveDoSelect(campo));
    }
  );
});
