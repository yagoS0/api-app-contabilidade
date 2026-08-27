// O IMPORT DE EXTRATO OFX, montado no portal do CLIENTE.
//
// ⚠⚠ POR QUE ISTO É UMA VARREDURA DE FONTE, como `loteMontadoNoPortalDoCliente.test.js`,
// `tomadoresEmitidosDoCliente.test.js` e `contratoDeEmpresasDoCliente.test.js`: o defeito desta
// família NÃO É DE COMPORTAMENTO. A rota responde 200 com um relatório de aparência normal e o
// estrago só aparece na tela do CONTADOR, dias depois, como despesa que não chegou na fila.
//
// ⚠⚠ E AQUI HÁ UMA ARMADILHA INVERTIDA, que é a razão principal deste arquivo existir.
//
// Nas outras três rotas o defeito era ESQUECER `resolveLegacyCompanyId`. Aqui ele seria
// ACRESCENTÁ-LO. Medido no `schema.prisma` em 24/08/2026, os três lados apontam para a MESMA
// tabela:
//
//   CompanyClientUser.companyId    -> PortalClient @relation(references: [id])   (linha 1441)
//   CompanyFirmAccess.companyId    -> PortalClient @relation(references: [id])   (linha 1459)
//   LancamentoDeclarado.portalClientId -> PortalClient @relation(references: [id])
//
// Ou seja: o `:companyId` do path JÁ É um `PortalClient.id`, e é exatamente a chave em que o
// declarado é gravado e pela qual a fila do contador o procura. Resolver para a `Company` legada
// aqui gravaria a despesa sob um id que a fila NUNCA consulta — o extrato entraria, o relatório
// diria "23 criadas", e a fila do contador ficaria vazia para sempre, sem erro nenhum.
//
// A tentação da próxima sessão é literal: "esqueceram o resolveLegacyCompanyId, é a sexta vez".
// Não é. Este teste existe para que a diferença seja lida antes de o remédio ser aplicado ao
// paciente errado.

import fs from "node:fs";
import path from "node:path";

const FONTE = fs.readFileSync(path.join(__dirname, "..", "index.js"), "utf8");

/** O bloco da rota, isolado — as asserções são sobre ele, não sobre o arquivo inteiro. */
function blocoDaRota() {
  const ini = FONTE.indexOf('router.post(\n    "/companies/:companyId/ofx/import"');
  expect(ini).toBeGreaterThan(-1);
  const fim = FONTE.indexOf("\n  );", ini);
  expect(fim).toBeGreaterThan(ini);
  return FONTE.slice(ini, fim);
}

describe("⚠ a rota EXISTE e está montada — e substituiu o stub 501", () => {
  it("`importarOfxDoCliente` é importado do serviço da conferência", () => {
    expect(FONTE).toMatch(
      /import \{ importarOfxDoCliente \} from "\.\.\/\.\.\/application\/declarados\/ImportOfxService\.js";/,
    );
  });

  it("o caminho é `/companies/:companyId/ofx/import`", () => {
    expect(FONTE).toContain('"/companies/:companyId/ofx/import"');
  });

  it("⚠⚠ o stub 501 daquele caminho NÃO existe mais", () => {
    // Ele existia em `:654` e respondia `not_implemented_yet`. Deixá-lo registrado ANTES da rota
    // real faria o Express casar nele primeiro, e o import responderia 501 com o código todo certo.
    const bloco = blocoDaRota();
    expect(bloco).not.toContain("not_implemented_yet");
    const ocorrencias = FONTE.split('"/companies/:companyId/ofx/import"').length - 1;
    expect(ocorrencias).toBe(1);
  });
});

describe("⚠⚠ O ID É O DO PATH, CRU — resolver para a Company legada aqui é o defeito", () => {
  const bloco = blocoDaRota();

  it("`portalClientId` sai de `req.params.companyId`", () => {
    expect(bloco).toMatch(/portalClientId: String\(req\.params\.companyId\)/);
  });

  it("⚠⚠ NÃO chama `resolveLegacyCompanyId` — ver o cabeçalho deste arquivo", () => {
    expect(bloco).not.toContain("resolveLegacyCompanyId");
    expect(bloco).not.toContain("legacyCompanyId");
  });

  it("⚠ o corpo NÃO pode escolher a empresa", () => {
    // `upload.single` preenche `req.body` com os campos de texto do multipart: um `portalClientId`
    // ali apontaria o import para outra empresa DEPOIS de o acesso ter sido conferido nesta — o
    // furo de multi-tenancy medido na F1 do WhatsApp e repetido na emissão de NFS-e.
    const chamada = bloco.match(/importarOfxDoCliente\(\{[\s\S]*?\}\)/)?.[0];
    expect(chamada).toBeDefined();
    expect(chamada).not.toMatch(/req\.body/);
  });
});

describe("⚠ o piso de papel é ESCRITO, não herdado", () => {
  const bloco = blocoDaRota();

  it("`requireClientCompanyAccess()` SEM papel mínimo", () => {
    // Decisão declarada: subir o próprio extrato é ato financeiro do cliente, e o piso das rotas
    // financeiras dele é "membro ativo" (guias, alíquota, fluxo). O import NÃO cria lançamento
    // contábil — tudo nasce na fila, e quem contabiliza é o contador, do outro lado.
    expect(bloco).toMatch(/requireClientCompanyAccess\(\)/);
    expect(bloco).not.toMatch(/requireClientCompanyAccess\(\s*["'{]/);
  });

  it("⚠ não há portão de emissão aqui — importar extrato não é ato fiscal", () => {
    expect(bloco).not.toContain("ensureEmissaoNfseAutorizada");
  });
});

describe("⚠ o relatório INTEIRO volta, e a recusa é nomeada", () => {
  const bloco = blocoDaRota();

  it("arquivo ausente recusa com 400 nomeado, ANTES de chamar o serviço", () => {
    const antesDaChamada = bloco.slice(0, bloco.indexOf("importarOfxDoCliente"));
    expect(antesDaChamada).toContain('error: "file_required"');
    expect(antesDaChamada).toContain("status(400)");
  });

  it("⚠⚠ o relatório é espalhado, nunca resumido a uma contagem", () => {
    // "criei 23" sozinho esconderia descartadas, fora do escopo e as anomalias da identidade — e
    // deixaria "não veio nada" indistinguível de "deu erro".
    expect(bloco).toMatch(/res\.json\(\{ ok: true, \.\.\.r \}\)/);
  });

  it("⚠ `DeclaradoRecusado` vira 400 com o CÓDIGO da recusa, nunca 500", () => {
    expect(bloco).toMatch(/e instanceof DeclaradoRecusado/);
    expect(bloco).toMatch(/error: e\.codigo/);
  });

  it("⚠ o 500 não vaza a exceção para o cliente", () => {
    const catchBloco = bloco.slice(bloco.indexOf("} catch"));
    expect(catchBloco).toContain("status(500)");
    expect(catchBloco).not.toMatch(/message: e\.message|error: e\.message|err: e\.stack/);
  });
});

describe("⚠⚠ O RELÓGIO DAQUI É CARIMBO DE AUDITORIA — nunca data de pagamento", () => {
  const bloco = blocoDaRota();

  it("`agora` é passado explicitamente", () => {
    expect(bloco).toMatch(/agora: new Date\(\)/);
  });

  it("⚠⚠ nenhum outro campo recebe o relógio", () => {
    // A data de cada transação vem do ARQUIVO (`DTPOSTED`). Um `dataPagamento: new Date()` aqui
    // afirmaria que toda despesa do extrato foi paga no instante do upload — a invariante do caixa
    // (`application/declarados/CLAUDE.md`) morre exatamente assim.
    const relogios = [...bloco.matchAll(/(\w+): new Date\(\)/g)].map((m) => m[1]);
    expect(relogios).toEqual(["agora"]);
  });
});

describe("⚠ FACHADA — nenhuma regra do extrato mora na rota", () => {
  const bloco = blocoDaRota();

  it("não lê o arquivo: nada de `parseOfx`, `lerOfx` ou varredura de OFX aqui", () => {
    // Uma segunda leitura do extrato divergiria na primeira correção de separador decimal, onde o
    // erro é de 1000×.
    expect(bloco).not.toMatch(/parseOfx|lerOfx|STMTTRN|DTPOSTED|TRNAMT/);
  });

  it("não decide identidade: nada de hash ou dedupe aqui", () => {
    expect(bloco).not.toMatch(/hashDedupe|createHash|FITID|fitId/);
  });

  it("⚠⚠ não escreve no banco, e muito menos no razão", () => {
    expect(bloco).not.toMatch(/prisma\.|\$transaction|accountingEntry|lancamentoDeclarado/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────
// ⚠⚠ O ESTOURO DE 10 MB DEVOLVIA HTML 500 SEM CÓDIGO — e isso ARMAVA o fallback do portal.
//
// Medido em 26/08/2026: não existe error handler global neste app (zero `(err, req, res, next)` em
// `server.js` e nos middlewares). O multer chamava `next(err)` e o handler padrão do Express
// respondia HTML 500.
//
// ⚠⚠ E `deveCairParaMock` (`apps/portal-cliente-web/src/api/index.js`) cai para o MOCK em 5xx **sem
// `code`**. No modo `real_with_mock_fallback`, um extrato de 11 MB mostraria ao cliente uma
// IMPORTAÇÃO FICTÍCIA BEM-SUCEDIDA, com um relatório inventado. Com o `error` no corpo, o fallback
// fica desarmado POR CONSTRUÇÃO — é o campo, não o status, que o desarma.
//
// ⚠ Varredura de fonte pelo mesmo motivo do resto deste arquivo: o defeito não é de comportamento
// da rota, é da COMPOSIÇÃO do middleware. Um teste de status HTTP passaria com o corpo mudo.
// ─────────────────────────────────────────────────────────────────────────────────────────────
describe("⚠⚠ o arquivo grande demais recusa NOMEANDO", () => {
  it("⚠⚠ o multer NÃO é montado cru na rota — ele é envolvido", () => {
    // `upload.single("file")` direto na lista de middlewares é o defeito: sem `next(err)` tratado,
    // o Express responde HTML.
    expect(FONTE).not.toMatch(/"\/companies\/:companyId\/ofx\/import",\s*\n\s*requireClientCompanyAccess\(\),\s*\n\s*upload\.single/);
    expect(FONTE).toMatch(/receberArquivoDoExtrato/);
  });

  it("⚠⚠ o 413 leva `error` NO CORPO — é ele que desarma o fallback, não o status", () => {
    expect(FONTE).toMatch(/status\(413\)/);
    expect(FONTE).toMatch(/error:\s*"arquivo_grande_demais"/);
  });

  it("⚠ e a mensagem diz o CONSERTO — dividir o período —, não só o problema", () => {
    expect(FONTE).toMatch(/períodos menores/i);
  });

  it("⚠ o limite continua sendo o do multer, não um número escrito à mão na rota", () => {
    expect(FONTE).toMatch(/LIMIT_FILE_SIZE/);
    // o teto vive num lugar só, na configuração do multer
    expect(FONTE).toMatch(/fileSize:\s*10\s*\*\s*1024\s*\*\s*1024/);
  });

  it("⚠ qualquer OUTRA falha do multer também sai nomeada — 500 mudo reabriria o fallback", () => {
    expect(FONTE).toMatch(/error:\s*"arquivo_invalido"/);
  });

  it("⚠⚠ NÃO foi criado error handler GLOBAL — isso mudaria a forma de falha de toda a API", () => {
    expect(FONTE).not.toMatch(/router\.use\(\s*\(err\s*,/);
    expect(FONTE).not.toMatch(/app\.use\(\s*\(err\s*,/);
  });
});
