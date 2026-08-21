// A SITUAÇÃO FISCAL NO PORTAL DO CLIENTE — o que esta rota NÃO pode virar.
//
// ⚠⚠ POR QUE VARREDURA DE FONTE, como as outras quatro deste diretório: os dois defeitos que
// importam aqui NÃO SÃO DE COMPORTAMENTO contra um dublê.
//
//  1. **Consultar o SERPRO.** A consulta é PAGA e o limite AV02 do `/Apoiar` é por CONTRATANTE —
//     uma consulta à toa de UMA empresa consome o limite da carteira inteira do escritório. Um
//     teste de comportamento com o SERPRO mockado passaria feliz enquanto a rota o chamasse.
//  2. **Baixar o piso de papel.** Trocar `CLIENT_ADMIN` por `()` continua respondendo 200 para
//     quem tem acesso — só que agora o FINANCEIRO da empresa lê o quadro societário.

const fs = require("node:fs");
const path = require("node:path");

const FONTE = fs.readFileSync(path.join(__dirname, "..", "index.js"), "utf8");

/** O bloco da rota, isolado — as asserções são sobre ele, não sobre o arquivo inteiro. */
function blocoDaRota() {
  const ini = FONTE.indexOf('router.get(\n    "/companies/:companyId/situacao-fiscal"');
  expect(ini).toBeGreaterThan(-1);
  const fim = FONTE.indexOf("\n  );", ini);
  expect(fim).toBeGreaterThan(ini);
  return FONTE.slice(ini, fim);
}

describe("a rota existe e reusa o parser do escritório", () => {
  it("o caminho é `/companies/:companyId/situacao-fiscal`", () => {
    expect(FONTE).toContain('"/companies/:companyId/situacao-fiscal"');
  });

  it("⚠ `parseSitfisRelatorio` vem do backend — não há segundo parser", () => {
    expect(FONTE).toMatch(
      /import \{ parseSitfisRelatorio \} from "\.\.\/\.\.\/application\/fiscal\/serpro\/parseSitfisRelatorio\.js";/
    );
  });
});

describe("⚠⚠ ela LÊ o que o escritório gravou — e não fala com o SERPRO", () => {
  const bloco = blocoDaRota();

  it("é `router.get`; não existe POST de situação fiscal no portal do cliente", () => {
    // Um POST aqui seria o botão de consultar — o que esta rota existe para NÃO ter.
    expect(FONTE).not.toMatch(/router\.post\(\s*\n?\s*"\/companies\/:companyId\/(situacao-fiscal|serpro)/);
  });

  it("⚠ a fonte é o `CompanyFiscalStatus` já gravado, escopado pelo id do path", () => {
    expect(bloco).toMatch(/prisma\.companyFiscalStatus\.findUnique/);
    expect(bloco).toMatch(/where: \{ portalClientId \}/);
  });

  it("⚠⚠ nada do SERPRO é chamado daqui", () => {
    expect(bloco).not.toMatch(/obterSitfisRelatorio|serpro|Sitfis(Apoiar|Emitir)|force/i);
  });
});

describe("⚠⚠ o piso de papel é CLIENT_ADMIN — o relatório carrega quadro societário", () => {
  const bloco = blocoDaRota();

  it("o gate é `requireClientCompanyAccess(\"CLIENT_ADMIN\")`", () => {
    expect(bloco).toMatch(/requireClientCompanyAccess\("CLIENT_ADMIN"\)/);
  });

  it("⚠ e NÃO o piso de membro ativo das rotas financeiras", () => {
    expect(bloco).not.toMatch(/requireClientCompanyAccess\(\)/);
  });
});

describe("⚠ o que a resposta NÃO leva — cada omissão tem motivo", () => {
  const bloco = blocoDaRota();

  it("⚠⚠ o `protocolo` não sai: é credencial de solicitação aberta no SERPRO", () => {
    expect(bloco).not.toMatch(/protocolo/);
  });

  it("⚠ `podeConsultar`/`proximaConsultaEm` não saem: governam um botão que não existe aqui", () => {
    expect(bloco).not.toMatch(/podeConsultar|proximaConsultaEm/);
  });

  it("⚠ o id do PDF não sai: o PDF é outra rota e outra decisão", () => {
    expect(bloco).not.toMatch(/relatorioPdfFileId/);
  });

  it("o `select` pede exatamente os quatro campos que a tela usa", () => {
    expect(bloco).toMatch(
      /select: \{ situacao: true, texto: true, checkedAt: true, ultimoRelatorioEm: true \}/
    );
  });
});

describe("⚠⚠ NUNCA CONSULTADA NÃO É EM DIA", () => {
  const bloco = blocoDaRota();

  it("empresa sem linha responde `situacao: null`, nunca um valor de regularidade", () => {
    const semLinha = bloco.match(/if \(!status\) \{[\s\S]*?\}/)?.[0];
    expect(semLinha).toBeDefined();
    expect(semLinha).toMatch(/situacao: null/);
    expect(semLinha).not.toMatch(/REGULAR/);
  });

  it("⚠ e a situação nunca ganha padrão fabricado: `|| null`, jamais `|| \"REGULAR\"`", () => {
    expect(bloco).toMatch(/situacao: status\.situacao \|\| null/);
  });
});
