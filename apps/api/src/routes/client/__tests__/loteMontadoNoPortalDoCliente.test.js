// A MONTAGEM DO LOTE NA PORTA DO CLIENTE — e a prova de que ela não montou o id errado.
//
// ⚠⚠ POR QUE ISTO É UMA VARREDURA DE FONTE, como `contratoDeEmpresasDoCliente.test.js`. O defeito
// desta família NÃO É DE COMPORTAMENTO. Se `createNfseLoteRouter` for montado sem
// `resolverCompanyId`, a rota responde **200**, a tela funciona e o `findMany` da memória de
// tomadores volta **vazio, sem erro nenhum** — porque o `:companyId` do path é um
// `PortalClient.id` e `TomadorEmitido.companyId` é o id da `Company` legada
// (`routes/middlewares/portalAccess.js`: o id de uma nunca encontra a outra).
//
// O sintoma seria a metade do pedido do dono desaparecer em silêncio: *"se o CNPJ preenchido for de
// um tomador que já teve antes, só preencher"* nunca aconteceria, e todo CNPJ iria para a consulta
// à Receita. É a mesma família do `legacyCompanySelect`, que já mordeu três vezes.
//
// O comportamento da resolução em si é medido em `routes/__tests__/nfseLoteRotas.test.js`.

import fs from "node:fs";
import path from "node:path";

const FONTE = fs.readFileSync(path.join(__dirname, "..", "index.js"), "utf8");

/** O bloco do `router.use` do lote, isolado — as asserções são sobre ele. */
function blocoDaMontagem() {
  const ini = FONTE.indexOf('router.use(\n    "/companies/:companyId/nfse/lote"');
  expect(ini).toBeGreaterThan(-1);
  const fim = FONTE.indexOf("\n  );", ini);
  expect(fim).toBeGreaterThan(ini);
  return FONTE.slice(ini, fim);
}

describe("⚠ a rota do lote ESTÁ montada — componente sem chamador é o defeito favorito daqui", () => {
  it("o router é importado e montado sob `/companies/:companyId/nfse/lote`", () => {
    expect(FONTE).toMatch(/import \{ createNfseLoteRouter \} from "\.\.\/nfseLoteRoutes\.js";/);
    expect(FONTE).toContain('"/companies/:companyId/nfse/lote"');
  });
});

describe("⚠⚠ o id da MEMÓRIA é resolvido; o do ACESSO é o do path", () => {
  const bloco = blocoDaMontagem();

  it("`resolverCompanyId: resolveLegacyCompanyId` é passado à fábrica", () => {
    expect(bloco).toMatch(/resolverCompanyId:\s*resolveLegacyCompanyId/);
  });

  it("⚠ a fábrica NÃO é montada sem o resolvedor", () => {
    // Se alguém voltar a `createNfseLoteRouter({ log })`, este teste cai.
    expect(bloco).not.toMatch(/createNfseLoteRouter\(\{\s*log\s*\}\)/);
  });

  it("`resolveLegacyCompanyId` é o MESMO da emissão — não há segunda resolução", () => {
    expect(FONTE).toMatch(/import \{ resolveLegacyCompanyId \} from "\.\.\/middlewares\/portalAccess\.js";/);
    // Uma segunda função de resolução escrita à mão é o que este arquivo já proíbe na emissão.
    expect(FONTE).not.toMatch(/portalClient\.findUnique\(\{\s*where:\s*\{\s*id:\s*String\(companyId\)/);
  });
});

describe("⚠ o portão: LEITURA, sem `minRole` — e nenhum portão de emissão", () => {
  const bloco = blocoDaMontagem();

  it("entra com `requireClientCompanyAccess()` sem papel mínimo", () => {
    expect(bloco).toMatch(/requireClientCompanyAccess\(\)/);
    expect(bloco).not.toMatch(/requireClientCompanyAccess\("/);
  });

  it("⚠⚠ o portão de EMISSÃO não entra aqui — ele é da emissão, que é fase seguinte", () => {
    expect(bloco).not.toContain("ensureEmissaoNfseAutorizada");
    expect(bloco).not.toContain("NfseService");
  });
});
