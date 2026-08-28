// O IMPORT DE EXTRATO EM EXCEL, montado no portal do CLIENTE.
//
// ⚠⚠ VARREDURA DE FONTE, pelo mesmo motivo de `ofxImportDoCliente.test.js`: o defeito desta família
// NÃO É DE COMPORTAMENTO. A rota responde 200 com um relatório de aparência normal e o estrago só
// aparece na tela do CONTADOR, dias depois, como despesa que não chegou na fila.
//
// ⚠⚠ E A ARMADILHA INVERTIDA VALE INTEIRA AQUI: o `:companyId` do path JÁ É um `PortalClient.id`,
// que é a chave em que o declarado é gravado e pela qual a fila do contador o procura. Resolver
// para a `Company` legada gravaria a despesa sob um id que a fila NUNCA consulta — o extrato
// entraria, o relatório diria "23 criadas", e a fila ficaria vazia para sempre, sem erro nenhum.
// A tentação da próxima sessão é literal ("esqueceram o resolveLegacyCompanyId"). Não é.

import fs from "node:fs";
import path from "node:path";

const FONTE = fs.readFileSync(path.join(__dirname, "..", "index.js"), "utf8");

const CAMINHO = '"/companies/:companyId/extrato-excel/import"';

/** O bloco da rota, isolado — as asserções são sobre ele, não sobre o arquivo inteiro. */
function blocoDaRota() {
  const ini = FONTE.indexOf(`router.post(\n    ${CAMINHO}`);
  expect(ini).toBeGreaterThan(-1);
  const fim = FONTE.indexOf("\n  );", ini);
  expect(fim).toBeGreaterThan(ini);
  return FONTE.slice(ini, fim);
}

describe("⚠ a rota EXISTE, está montada, e é PRÓPRIA", () => {
  it("`importarExtratoExcelDoCliente` é importado do serviço da conferência", () => {
    expect(FONTE).toMatch(
      /import \{ importarExtratoExcelDoCliente \} from "\.\.\/\.\.\/application\/declarados\/ImportExcelExtratoService\.js";/,
    );
  });

  it("registrada uma vez só", () => {
    expect(FONTE.split(CAMINHO).length - 1).toBe(1);
  });

  it("⚠⚠ NÃO é um `if` dentro do import de OFX — os desfechos são diferentes", () => {
    // Este caminho pode voltar `precisaDeMapeamento: true` (nada entrou, e o que falta é um clique
    // do CONTADOR). Espremido na resposta do OFX, a tela do cliente teria de adivinhar qual das
    // duas conversas está acontecendo.
    const ofx = FONTE.slice(FONTE.indexOf('"/companies/:companyId/ofx/import"'));
    const bloco = ofx.slice(0, ofx.indexOf("\n  );"));
    expect(bloco).not.toContain("importarExtratoExcelDoCliente");
    expect(bloco).not.toContain("extrato-excel");
  });

  it("⚠ reusa o MESMO envelope de upload do OFX — não um segundo multer", () => {
    // Duas montagens do multer divergiriam no tratamento do arquivo grande demais, e é ele que
    // desarma o fallback do portal.
    expect(blocoDaRota()).toContain("receberArquivoDoExtrato");
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

  it("⚠⚠ o corpo NÃO pode escolher a empresa, ainda que ele SEJA lido aqui", () => {
    // Diferente do OFX: este caminho lê `req.body` de propósito (a conta bancária e a aba vêm do
    // multipart). Por isso a asserção é ESTREITA — só os dois campos previstos —, em vez de proibir
    // `req.body` inteiro. Um `portalClientId` vindo do corpo apontaria o import para outra empresa
    // DEPOIS de o acesso ter sido conferido nesta: o furo medido na F1 do WhatsApp.
    const chamada = bloco.match(/importarExtratoExcelDoCliente\(\{[\s\S]*?\n {8}\}\)/)?.[0];
    expect(chamada).toBeDefined();
    const campos = [...chamada.matchAll(/req\.body\?\.(\w+)/g)].map((m) => m[1]).sort();
    expect(campos).toEqual(["aba", "contaBancaria"]);
    expect(chamada).not.toMatch(/portalClientId:.*req\.body|\.\.\.req\.body/);
  });
});

describe("⚠ o piso de papel é ESCRITO, não herdado", () => {
  const bloco = blocoDaRota();

  it("`requireClientCompanyAccess()` SEM papel mínimo", () => {
    // Mesma decisão do OFX: subir o próprio extrato é ato financeiro do cliente, e ele NÃO cria
    // lançamento contábil — tudo nasce na fila, e quem contabiliza é o contador.
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
    const antes = bloco.slice(0, bloco.indexOf("importarExtratoExcelDoCliente"));
    expect(antes).toContain('error: "file_required"');
    expect(antes).toContain("status(400)");
  });

  it("⚠⚠ o relatório é espalhado, nunca resumido a uma contagem", () => {
    // É por ele que `precisaDeMapeamento`, as linhas não legíveis e `dedupeAtravessaFormatos`
    // chegam à tela. Um "criei 23" sozinho esconderia os três.
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

  it("⚠⚠ nenhum outro campo recebe o relógio", () => {
    // A data de cada transação vem do ARQUIVO. Um `dataPagamento: new Date()` aqui afirmaria que
    // toda despesa do extrato foi paga no instante do upload — a invariante do caixa morre assim.
    const relogios = [...bloco.matchAll(/(\w+): new Date\(\)/g)].map((m) => m[1]);
    expect(relogios).toEqual(["agora"]);
  });
});

describe("⚠ FACHADA — nenhuma regra do extrato mora na rota", () => {
  const bloco = blocoDaRota();

  it("não lê a planilha nem decide coluna aqui", () => {
    // Uma segunda leitura divergiria na primeira correção de separador decimal, onde o erro é de
    // 1000× — e uma segunda leitura de COLUNA poria a data no lugar do valor.
    expect(bloco).not.toMatch(/XLSX|sheet_to_json|proporMapeamento|validarMapeamento|assinaturaDoCabecalho/);
  });

  it("⚠⚠ NÃO confirma mapeamento — essa porta é do CONTADOR", () => {
    // Se o upload do cliente pudesse confirmar, a trava da fase inteira deixaria de existir: a
    // planilha viraria lançamento sem nenhuma pessoa ter olhado as colunas.
    expect(bloco).not.toMatch(/confirmar|confirmado/);
  });

  it("não decide identidade: nada de hash ou dedupe aqui", () => {
    expect(bloco).not.toMatch(/hashDedupe|createHash/);
  });

  it("⚠⚠ não escreve no banco, e muito menos no razão", () => {
    expect(bloco).not.toMatch(/prisma\.|\$transaction|accountingEntry|lancamentoDeclarado/);
  });
});
