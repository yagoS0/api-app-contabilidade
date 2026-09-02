// ⚠⚠ O REGIME CHUTADO VIRAVA DADO GRAVADO — e nada, no banco, o distinguia de um regime afirmado.
//
// `mapRegime` (`routes/firm/apuracaoV2.js`) terminava em `return "SIMPLES_NACIONAL"`, descrito como
// inofensivo ("a maioria das empresas do app é SN"). Seria, se só alimentasse tela. Mas o
// `PUT /perfil-fiscal` fazia `cadastroFiscal.create({ regime: mapRegime(company) })`, e a linha
// criada ali é lida como AUTORIDADE por SETE serviços — `NfseService`, `ClassificadorService`,
// `CnaesDaEmpresaService`, `DisparidadeService`, `FechamentoService`, `MotorApuracaoService` e
// `PerfilFiscalService`.
//
// ⚠⚠ O QUE TORNAVA ISSO CARO NÃO ERA "FALTAR VALIDAÇÃO". A validação EXISTE e foi escrita de
// propósito: `dpsCodigos.resolverOpSimpNac` recusa regime desconhecido (`NFSE_REGIME_INDEFINIDO`) e
// o cabeçalho dele diz que NÃO reusa o `mapRegime` justamente porque *"na apuração o default é
// inofensivo; numa DPS ele declararia o regime da empresa por suposição"*. O autor viu a função,
// recusou-a e escreveu o motivo — e o `create` gravava o resultado dela assim mesmo.
//
// **Guarda nenhuma resiste a um caminho de escrita que fabrica exatamente o dado que a satisfaz.**
// É por isso que o conserto é no ESCRITOR, e é por isso que esta varredura existe: comentário não
// impede o default de voltar, e ele estava escrito em DUAS cópias que já divergiam entre si.
//
// ⚠ O QUE ESTE TESTE **NÃO** PEDE: que a apuração passe a bloquear. `apps/api/CLAUDE.md:3009`
// registra que ali *"bloquear por falta de dado é o erro caro"*, e isso continua valendo. O que
// mudou é **não PERSISTIR** a tolerância. Tolerar em memória ≠ gravar.

import fs from "node:fs";
import path from "node:path";

jest.mock("../../../../../infrastructure/db/prisma.js", () => {
  const model = () => ({
    findUnique: jest.fn(async () => null),
    findMany: jest.fn(async () => []),
  });
  return { prisma: { cadastroFiscal: model(), portalClient: model(), company: model(), cnaeAnexo: model() } };
});

import { prisma } from "../../../../../infrastructure/db/prisma.js";
import { resolverPerfilFiscal } from "../PerfilFiscalService.js";

const PORTAL = "pc-1";

const CATALOGO = [
  { cnae: "7319003", descricao: "Marketing direto", tipoReceitaSugerido: "SERVICO_FATOR_R", ambiguo: false },
];

/** A ficha da empresa, com o `regimeTributario` que o caso quer exercitar. */
function comFicha(regimeTributario, optanteSimples = false) {
  prisma.cadastroFiscal.findUnique.mockResolvedValue(null);
  prisma.portalClient.findUnique.mockResolvedValue({ companyId: "co-1" });
  prisma.company.findUnique.mockResolvedValue({
    cnaePrincipal: "7319003", cnaesSecundarios: [], regimeTributario, optanteSimples,
  });
  prisma.cnaeAnexo.findMany.mockResolvedValue(CATALOGO);
}

beforeEach(() => jest.clearAllMocks());

describe("⚠⚠ regime irreconhecível vira NULL, nunca Simples Nacional", () => {
  it("ficha VAZIA não afirma Simples Nacional", async () => {
    comFicha("");
    const r = await resolverPerfilFiscal({ portalClientId: PORTAL });
    expect(r.regime).toBeNull();
  });

  it("ficha com texto DESCONHECIDO não afirma Simples Nacional", async () => {
    // O caso que o default escondia: alguém digita "LUCRO ARBITRADO" ou um nome novo, e o sistema
    // respondia "Simples Nacional" com a mesma confiança de um cadastro conferido.
    comFicha("LUCRO ARBITRADO");
    const r = await resolverPerfilFiscal({ portalClientId: PORTAL });
    expect(r.regime).toBeNull();
  });

  it("mas o que É reconhecível continua sendo reconhecido — os quatro", async () => {
    for (const [ficha, esperado] of [
      ["SIMPLES", "SIMPLES_NACIONAL"],
      ["LUCRO_PRESUMIDO", "LUCRO_PRESUMIDO"],
      ["LUCRO_REAL", "LUCRO_REAL"],
      ["SIMPLES NACIONAL - MEI", "MEI"],
    ]) {
      comFicha(ficha);
      // eslint-disable-next-line no-await-in-loop
      const r = await resolverPerfilFiscal({ portalClientId: PORTAL });
      expect([ficha, r.regime]).toEqual([ficha, esperado]);
    }
  });

  it("⚠ `optanteSimples` volta a contar — as duas cópias divergiam nisto", async () => {
    // `mapRegime` consultava `company.optanteSimples`; esta cópia NÃO consultava. A mesma empresa
    // tinha duas respostas possíveis conforme o caminho que a alcançasse. Antes o defeito ficava
    // escondido porque as duas terminavam no mesmo default; sem ele, a divergência apareceria como
    // `null` de um lado e `SIMPLES_NACIONAL` do outro.
    comFicha("", true);
    const r = await resolverPerfilFiscal({ portalClientId: PORTAL });
    expect(r.regime).toBe("SIMPLES_NACIONAL");
  });

  it("o CadastroFiscal salvo continua vencendo a ficha", async () => {
    // A precedência não mudou: quem tem regime salvo lê o salvo. O conserto é sobre o que se GRAVA
    // quando não há nada salvo, não sobre quem manda quando há.
    prisma.cadastroFiscal.findUnique.mockResolvedValue({
      cnaePrincipal: "7319003", cnaesSecundarios: [], regime: "LUCRO_PRESUMIDO",
      usaFatorR: false, perfilAtividades: [],
    });
    prisma.cnaeAnexo.findMany.mockResolvedValue(CATALOGO);
    const r = await resolverPerfilFiscal({ portalClientId: PORTAL });
    expect(r.regime).toBe("LUCRO_PRESUMIDO");
    expect(r.temCadastro).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// A VARREDURA — porque comentário não é guarda
// ═══════════════════════════════════════════════════════════════════════════════════════════════

/**
 * ⚠ O alvo é o `SIMPLES_NACIONAL` escrito como ÚLTIMA saída de uma cascata — o default. As
 * atribuições legítimas (`=== "SIMPLES"` ⇒ `"SIMPLES_NACIONAL"`) continuam permitidas: o que se
 * proíbe é responder Simples Nacional para o que NÃO se reconheceu.
 *
 * Corta comentários antes de olhar, senão este próprio cabeçalho seria uma violação — a mesma
 * armadilha que `tintaProibidaNaoVolta.test.js` documenta em `semComentarios`.
 */
function semComentarios(fonte) {
  let dentro = false;
  return fonte.split("\n").map((l) => {
    let saida = "";
    let i = 0;
    while (i < l.length) {
      if (dentro) {
        const fim = l.indexOf("*/", i);
        if (fim === -1) return saida;
        dentro = false;
        i = fim + 2;
        continue;
      }
      const abre = l.indexOf("/*", i);
      const linha = l.indexOf("//", i);
      if (linha !== -1 && (abre === -1 || linha < abre)) return saida + l.slice(i, linha);
      if (abre === -1) return saida + l.slice(i);
      saida += l.slice(i, abre);
      dentro = true;
      i = abre + 2;
    }
    return saida;
  });
}

const SRC = path.resolve(__dirname, "../../../../..");
const OS_DOIS = [
  path.join(SRC, "routes", "firm", "apuracaoV2.js"),
  path.join(SRC, "application", "notas", "apuracao", "v2", "PerfilFiscalService.js"),
];

describe("⚠⚠ e o default não volta a nenhum dos dois arquivos", () => {
  it("nenhum `return \"SIMPLES_NACIONAL\"` como saída final de cascata", () => {
    const achados = [];
    for (const alvo of OS_DOIS) {
      semComentarios(fs.readFileSync(alvo, "utf-8")).forEach((l, i) => {
        // `return "SIMPLES_NACIONAL"` sem condição na mesma linha = o default.
        if (/^\s*return\s+"SIMPLES_NACIONAL"\s*;?\s*$/.test(l)) {
          achados.push(`${path.basename(alvo)}:${i + 1}`);
        }
        // A forma ternária: `: "SIMPLES_NACIONAL";` fechando a cascata.
        if (/^\s*:\s*"SIMPLES_NACIONAL"\s*;\s*$/.test(l)) {
          achados.push(`${path.basename(alvo)}:${i + 1}`);
        }
      });
    }
    expect(achados).toEqual([]);
  });

  it("⚠ a varredura VARRE MESMO — se ela vier vazia por engano, este caso cai", () => {
    // Sem isto, um caminho errado faria a guarda passar dizendo "nada errado".
    for (const alvo of OS_DOIS) expect(fs.existsSync(alvo)).toBe(true);
    const texto = OS_DOIS.map((f) => semComentarios(fs.readFileSync(f, "utf-8")).join("\n")).join("\n");
    expect(texto).toMatch(/SIMPLES_NACIONAL/); // as atribuições legítimas continuam lá
    expect(texto.length).toBeGreaterThan(1000);
  });

  it("⚠⚠ o `create` do perfil fiscal recusa em vez de gravar regime suposto", () => {
    // A prova de que o caminho de ESCRITA ganhou a guarda — é ele, e não a validação, que fabricava
    // o dado. Amarrado pelo código da recusa, que é o contrato com a tela.
    const rota = semComentarios(
      fs.readFileSync(path.join(SRC, "routes", "firm", "apuracaoV2.js"), "utf-8"),
    ).join("\n");
    expect(rota).toMatch(/regime_nao_confirmado/);
    // E o `create` não pode voltar a chamar `mapRegime` direto no `data`.
    expect(rota).not.toMatch(/regime:\s*mapRegime\(/);
  });
});
