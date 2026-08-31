// ⚠⚠ A ABA DE GUIAS MOSTRA AS GUIAS DA EMPRESA — e as AÇÕES continuam travadas (30/08/2026)
//
// > Dono: *"arruma a aba de guias, INSS e parcelamento não aparecem"* — e, logo depois, o critério:
// > *"a aba de guias é aba de guias, o fluxo é o fluxo."*
//
// A lista deixou de filtrar por `liberadaCliente`. ⚠⚠ **`liberadaCliente` marca que o contador
// ENVIOU a guia**, não que ela existe: filtrar a LISTA por ele fazia um registro de ENVIO decidir o
// que o cliente sabe dever. Medido em produção (`scripts/diag-guias-do-cliente.mjs`): a ERISANGELA
// via **7 de 17**, e a carteira inteira tem **24 liberadas contra 232 não liberadas**.
//
// ⚠⚠ ESTE TESTE É DE FONTE, e tinha de ser: a suíte inteira ficou VERDE com a mudança, porque
// ninguém nunca afirmou o `apenasLiberadas` da rota do cliente. Um teste de comportamento com dublê
// não pegaria o dia em que alguém "restaurasse" o filtro, e a aba voltaria a esconder a dívida
// sem um vermelho sequer.

// ⚠ `require`, não `import`: esta suíte roda em CommonJS, e `import.meta` quebra em tempo de
// PARSE — o arquivo inteiro morre antes do primeiro teste. É o molde das outras varreduras daqui.
const fs = require("node:fs");
const path = require("node:path");

const FONTE = fs.readFileSync(path.join(__dirname, "..", "index.js"), "utf8");

// ⚠ Tira comentários de BLOCO antes dos de LINHA — a ordem inversa deixa o fecho órfão e come
// código. ⚠ E esta nota é de LINHA de propósito: escrever o fecho de bloco dentro de um bloco
// encerra o comentário ali mesmo, e o arquivo morre no PARSE — foi o que aconteceu ao escrevê-la.
function semComentarios(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
}
const CODIGO = semComentarios(FONTE);

/** O corpo de uma rota, do `router.<verbo>("<caminho>"` até o fecho do arquivo (basta para varrer). */
function trechoDaRota(caminho, verbo = "get") {
  const i = CODIGO.indexOf(`router.${verbo}(`);
  const alvo = CODIGO.indexOf(caminho);
  expect(alvo).toBeGreaterThan(-1);
  return CODIGO.slice(alvo, alvo + 2500);
}

describe("⚠⚠ a LISTA de guias do cliente não filtra por liberação", () => {
  it("⚠⚠ `apenasLiberadas` é FALSE na rota da lista", () => {
    const trecho = trechoDaRota('"/companies/:companyId/guides"');
    expect(trecho).toMatch(/apenasLiberadas:\s*false/);
    expect(trecho).not.toMatch(/apenasLiberadas:\s*true/);
  });

  it("⚠⚠ e o estado da liberação DESCE na resposta — senão a tela oferece o que o servidor recusa", () => {
    // Sem este campo o "Baixar PDF" apareceria habilitado numa guia cujo download responde 404.
    const service = fs.readFileSync(
      path.join(__dirname, "..", "..", "..", "application", "guides", "GuideService.js"), "utf8"
    );
    expect(semComentarios(service)).toMatch(/liberadaCliente:\s*Boolean\(item\.liberadaCliente\)/);
  });
});

describe("⚠⚠ as TRÊS ações continuam exigindo `liberadaCliente: true`", () => {
  // ⚠ Este é o outro lado da mudança, e é o que impede que ela vire "o cliente pode tudo".
  // ⚠⚠ O recálculo gasta dinheiro do escritório — o comentário dele diz "este gate NÃO se afrouxa".
  it.each([
    ['"/companies/:companyId/guides/:guideId/download"', "get"],
    ['"/companies/:companyId/guides/:guideId/recalculate"', "post"],
    ['"/companies/:companyId/guides/:guideId/confirmar-pagamento"', "post"],
  ])("%s continua com o gate", (caminho) => {
    const trecho = trechoDaRota(caminho);
    expect(trecho).toMatch(/liberadaCliente:\s*true/);
  });
});
