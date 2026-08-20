// A PORTA DE LEITURA DA MEMÓRIA DE TOMADORES, no portal do CLIENTE.
//
// ⚠⚠ POR QUE ISTO É UMA VARREDURA DE FONTE, como `loteMontadoNoPortalDoCliente.test.js` e
// `contratoDeEmpresasDoCliente.test.js`. O defeito desta família NÃO É DE COMPORTAMENTO: se a rota
// esquecer `resolveLegacyCompanyId`, ela responde **200** com `data: []` e a tela conclui "esta
// empresa nunca emitiu para ninguém" — porque o `:companyId` do path é um `PortalClient.id` e
// `TomadorEmitido.companyId` é o id da `Company` legada, e o id de uma NUNCA encontra a outra
// (`routes/middlewares/portalAccess.js`). Um teste de comportamento contra um dublê passaria.
//
// Esta é a QUINTA vez que essa confusão de ids aparece nesta semana; a última foi na rota do lote.

import fs from "node:fs";
import path from "node:path";

const FONTE = fs.readFileSync(path.join(__dirname, "..", "index.js"), "utf8");

/** O bloco da rota, isolado — as asserções são sobre ele, não sobre o arquivo inteiro. */
function blocoDaRota() {
  const ini = FONTE.indexOf('router.get(\n    "/companies/:companyId/nfse/tomadores"');
  expect(ini).toBeGreaterThan(-1);
  const fim = FONTE.indexOf("\n  );", ini);
  expect(fim).toBeGreaterThan(ini);
  return FONTE.slice(ini, fim);
}

describe("⚠ a rota EXISTE e está montada — componente sem chamador é o defeito favorito daqui", () => {
  it("`listarTomadoresEmitidos` é importado do módulo que a EMISSÃO já alimenta", () => {
    expect(FONTE).toMatch(
      /import \{ listarTomadoresEmitidos \} from "\.\.\/\.\.\/application\/nfse\/tomadorEmitido\.js";/
    );
  });

  it("o caminho é `/companies/:companyId/nfse/tomadores`", () => {
    expect(FONTE).toContain('"/companies/:companyId/nfse/tomadores"');
  });

  it("⚠ não colide com o router do lote, que é montado em `/nfse/lote`", () => {
    expect(FONTE).toContain('"/companies/:companyId/nfse/lote"');
  });
});

describe("⚠⚠ o id da MEMÓRIA é resolvido; o do ACESSO é o do path", () => {
  const bloco = blocoDaRota();

  it("chama `resolveLegacyCompanyId` com o id do path antes de consultar a memória", () => {
    expect(bloco).toMatch(/const legacyCompanyId = await resolveLegacyCompanyId\(portalClientId\)/);
  });

  it("⚠ o `companyId` que vai para a lista é o RESOLVIDO, nunca `req.params`", () => {
    // ⚠ Só os ARGUMENTOS da chamada — um `[\s\S]*` solto varreria o `log.error` do fim do bloco,
    // que legitimamente cita o id do path, e o teste passaria pelo motivo errado.
    const chamada = bloco.match(/listarTomadoresEmitidos\(\{[\s\S]*?\}\)/)?.[0];
    expect(chamada).toBeDefined();
    expect(chamada).toMatch(/companyId: legacyCompanyId/);
    expect(chamada).not.toMatch(/portalClientId/);
    expect(chamada).not.toMatch(/req\.params/);
  });

  it("o ACESSO continua sendo conferido pelo id do path — `requireClientCompanyAccess()`, sem papel mínimo", () => {
    expect(bloco).toMatch(/requireClientCompanyAccess\(\)/);
    // Leitura não passa pelo portão do ATO fiscal.
    expect(bloco).not.toMatch(/ensureEmissaoNfseAutorizada/);
  });

  it("⚠ empresa sem `Company` legada devolve lista vazia, não 404 — é o estado de quem não foi provisionada", () => {
    expect(bloco).toMatch(/if \(!legacyCompanyId\) return res\.json\(\{ data: \[\], total: 0, recortada: false \}\)/);
  });
});

describe("⚠⚠ SÓ LEITURA — não existe cadastro de tomador do lado do cliente", () => {
  it("não há POST/PATCH/PUT/DELETE de tomador em nenhum lugar do router do cliente", () => {
    expect(FONTE).not.toMatch(/router\.(post|patch|put|delete)\([\s\S]{0,80}nfse\/tomadores/);
  });

  it("⚠ a rota não chama `registrarTomadorEmitido` — quem escreve nessa tabela é a emissão autorizada", () => {
    expect(blocoDaRota()).not.toMatch(/registrarTomadorEmitido/);
    expect(FONTE).not.toMatch(/prisma\.tomadorEmitido\.(create|update|upsert|delete)/);
  });
});

describe("⚠ o que viaja até o cliente", () => {
  const bloco = blocoDaRota();

  it("os campos do endereço vão com os nomes da DPS — os mesmos do model e do `buildDpsXml`", () => {
    for (const campo of ["documento", "nome", "email", "cMun", "cep", "xLgr", "nro", "xCpl", "xBairro"]) {
      expect(bloco).toContain(`${campo}:`);
    }
  });

  it("⚠ o `companyId` LEGADO não viaja — o cliente não o conhece e não tem o que fazer com ele", () => {
    expect(bloco).not.toMatch(/data: tomadores\.map\(\(t\) => \(\{[\s\S]*companyId: t\.companyId/);
  });
});
