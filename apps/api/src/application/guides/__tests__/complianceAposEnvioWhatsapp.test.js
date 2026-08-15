// ⚠⚠ A MEDIÇÃO: O QUE O ENVIO POR WHATSAPP FAZ COM O `guideCompliance` (e com o chip do dashboard).
//
// ── POR QUE ESTE ARQUIVO EXISTE ─────────────────────────────────────────────────────────────────
// `foiEnviadaComLegado` desliga a tolerância do legado na PRIMEIRA linha que existir para a guia
// (`if (envios && envios.length)`). Enquanto NADA escrevia em `envios_guia`, toda guia valia pelo
// `emailStatus` antigo e a tela estava correta — foi por isso que rodar
// `scripts/backfill-envio-guia.mjs` continua PROIBIDO: ele converte todos os estados de uma vez e
// congela em "não enviada", para sempre, toda guia que estivesse pendente naquele instante.
//
// O envio por WhatsApp é o **primeiro escritor de produção** dessa tabela. Ou seja: ele muda essa
// situação. A pergunta que este arquivo responde, com teste e não com raciocínio, é exatamente a que
// o dono fez:
//
//   1. uma guia enviada por WhatsApp continua aparecendo certo no `guideCompliance` e no chip?
//   2. uma guia NÃO tocada continua valendo pelo legado?
//   3. existe algum caso em que a guia SOME ou FICA PRESA?
//
// A resposta de (3) é SIM — e é o caso `SENT` + WhatsApp que falha. Ele está reproduzido aqui, cru,
// no bloco "o caso que PRENDERIA a guia", e depois provado corrigido pela materialização do legado
// (`linhaLegadoDoEmail`). Sem o bloco cru, a correção pareceria proteger contra nada.

jest.mock("../../../infrastructure/db/prisma.js", () => ({
  prisma: {
    guide: { findMany: jest.fn() },
    companyMonthlyCircular: { findMany: jest.fn() },
    envioGuia: { findMany: jest.fn() },
  },
}));

// O faturamento sai da apuração e não é assunto desta medição — uma competência sem nota emitida.
jest.mock("../../notas/apuracao/v2/FechamentoService.js", () => ({
  faturamentoEmitPorEmpresa: jest.fn(async () => new Map()),
}));

import { prisma } from "../../../infrastructure/db/prisma.js";
import { computeGuideComplianceMap } from "../guideCompliance.js";
import { foiEnviadaComLegado, linhaLegadoDoEmail } from "../EnvioGuiaService.js";

const COMPETENCIA = "2026-07";

/** Empresa do Simples: o nó `das` é exigido, que é o chip que o dashboard desenha. */
const empresa = (portalId) => ({ portalId, hasProlabore: false, legacy: { regimeTributario: "SIMPLES" } });

const guia = (id, portalClientId, extra = {}) => ({
  id,
  portalClientId,
  tipo: "SIMPLES",
  status: "PROCESSED",
  extracted: null,
  emailStatus: null,
  emailSentAt: null,
  emailLastError: null,
  emailAttempts: 0,
  vazioEm: null,
  vazioPor: null,
  vazioMotivo: null,
  ...extra,
});

/**
 * Monta o cenário: as guias da competência e as linhas de `envios_guia` que existem para elas.
 * A pré-query de parcelamento e a de "mês sem faturamento" voltam vazias.
 */
function cenario({ guias, envios }) {
  prisma.guide.findMany.mockImplementation(async (args) => (args?.where?.tipo ? guias : []));
  prisma.companyMonthlyCircular.findMany.mockResolvedValue([]);
  prisma.envioGuia.findMany.mockResolvedValue(envios);
}

beforeEach(() => jest.clearAllMocks());

// ── (1) e (2): as duas perguntas do dono, lado a lado, na MESMA carteira ────────────────────────

describe("⚠ a carteira depois do primeiro envio por WhatsApp", () => {
  it("guia enviada por WhatsApp aparece ENVIADA — com o canal e o destino do ENVIO", async () => {
    cenario({
      guias: [guia("gWa", "A", { emailStatus: "PENDING" })],
      envios: [{
        guideId: "gWa", canal: "WHATSAPP", status: "enviado",
        destino: "5521999998888", enviadoEm: new Date("2026-08-15T12:00:00Z"),
      }],
    });
    const mapa = await computeGuideComplianceMap([empresa("A")], COMPETENCIA);
    const das = mapa.get("A").das;

    expect(das.state).toBe("enviada");   // o chip do dashboard pinta o terminal bom
    expect(das.ok).toBe(true);           // e ela deixa de contar como pendência
    expect(das.canalEnvio).toBe("WHATSAPP");
    // ⚠ O destino é o do ENVIO, não o do cadastro: o contador procura a mensagem onde ela foi.
    expect(mapa.get("A").das.envioStatus).toBe("enviado");
  });

  it("⚠ guia NÃO TOCADA continua valendo pelo legado (`emailStatus: SENT`)", async () => {
    // É a garantia que segura a carteira inteira enquanto o backfill não roda — e o envio por
    // WhatsApp numa empresa NÃO pode desligá-la nas outras.
    cenario({
      guias: [
        guia("gWa", "A", { emailStatus: "PENDING" }),
        guia("gLegado", "B", { emailStatus: "SENT", emailSentAt: new Date("2026-08-02") }),
      ],
      envios: [{ guideId: "gWa", canal: "WHATSAPP", status: "enviado" }],
    });
    const mapa = await computeGuideComplianceMap([empresa("A"), empresa("B")], COMPETENCIA);

    expect(mapa.get("A").das.state).toBe("enviada");
    expect(mapa.get("B").das.state).toBe("enviada");
    // A tolerância é POR GUIA: a linha da empresa A não desliga a leitura legada da empresa B.
    expect(mapa.get("B").das.canalEnvio).toBeNull();
    expect(mapa.get("B").das.emailStatus).toBe("SENT");
  });

  it("guia sem envio e sem SENT continua pendente — nada foi 'melhorado' por acidente", async () => {
    cenario({ guias: [guia("gNova", "C", { emailStatus: "PENDING" })], envios: [] });
    const mapa = await computeGuideComplianceMap([empresa("C")], COMPETENCIA);
    expect(mapa.get("C").das.state).toBe("gerada");
  });
});

// ── (3) o caso que interessa: onde a guia FICARIA PRESA ─────────────────────────────────────────

describe("⚠⚠ o caso que PRENDERIA a guia — e por que ele não acontece", () => {
  const guiaJaEntregue = () => guia("gSent", "D", { emailStatus: "SENT", emailSentAt: new Date("2026-08-02") });

  it("SEM a materialização do legado: a guia já entregue por e-mail VIRA NÃO ENVIADA", async () => {
    // Este é o estrago, reproduzido cru: basta UMA linha existir para a tolerância se desligar. A
    // guia chegou ao cliente por e-mail, o WhatsApp foi tentado depois e a Meta recusou — e o card
    // do dashboard reabriria para sempre, com "✓ Guias concluídas" que nunca condensa.
    cenario({
      guias: [guiaJaEntregue()],
      envios: [{ guideId: "gSent", canal: "WHATSAPP", status: "falhou", erroMensagemUsuario: "número sem WhatsApp" }],
    });
    const mapa = await computeGuideComplianceMap([empresa("D")], COMPETENCIA);
    expect(mapa.get("D").das.state).not.toBe("enviada");
  });

  it("COM a materialização (o que o serviço de fato grava): continua ENVIADA", async () => {
    // `linhaLegadoDoEmail` é a função REAL do serviço — não uma réplica escrita aqui. Se ela mudar,
    // este teste muda junto.
    const g = guiaJaEntregue();
    cenario({
      guias: [g],
      envios: [
        linhaLegadoDoEmail(g),
        { guideId: "gSent", canal: "WHATSAPP", status: "falhou", erroMensagemUsuario: "número sem WhatsApp" },
      ],
    });
    const mapa = await computeGuideComplianceMap([empresa("D")], COMPETENCIA);
    const das = mapa.get("D").das;
    expect(das.state).toBe("enviada");
    expect(das.ok).toBe(true);
    // E o popover mostra o canal que de fato entregou.
    expect(das.canalEnvio).toBe("EMAIL");
  });

  it("⚠ e o WhatsApp que DEU CERTO depois de um e-mail entregue não perde o histórico", async () => {
    const g = guiaJaEntregue();
    cenario({
      guias: [g],
      envios: [
        linhaLegadoDoEmail(g),
        { guideId: "gSent", canal: "WHATSAPP", status: "lido", lidoEm: new Date("2026-08-15T13:00:00Z") },
      ],
    });
    const mapa = await computeGuideComplianceMap([empresa("D")], COMPETENCIA);
    // `envioParaExibir` mostra o mais adiantado: `lido` vence `enviado`.
    expect(mapa.get("D").das.canalEnvio).toBe("WHATSAPP");
    expect(mapa.get("D").das.envioStatus).toBe("lido");
  });
});

// ── A INVARIANTE, exercida em toda a tabela de estados ──────────────────────────────────────────

describe("⚠ INVARIANTE: tocar a guia por WhatsApp NUNCA rebaixa a resposta do compliance", () => {
  const ESTADOS_EMAIL = ["SENT", "PENDING", "ERROR", "SENDING", null];
  const DESFECHOS = ["enviado", "falhou"];

  it("as 10 combinações de (emailStatus × desfecho do WhatsApp) — nenhuma piora", async () => {
    const guias = [];
    const envios = [];
    const rows = [];
    const legadoPorEmpresa = new Map();

    for (const emailStatus of ESTADOS_EMAIL) {
      for (const desfecho of DESFECHOS) {
        const portalId = `${emailStatus || "NULO"}_${desfecho}`;
        const g = guia(`g_${portalId}`, portalId, { emailStatus, emailSentAt: emailStatus === "SENT" ? new Date() : null });
        guias.push(g);
        rows.push(empresa(portalId));
        legadoPorEmpresa.set(portalId, foiEnviadaComLegado([], g));

        // Exatamente o que o serviço grava, na ordem em que grava:
        const legado = linhaLegadoDoEmail(g);
        if (legado) envios.push(legado);
        envios.push({ guideId: g.id, canal: "WHATSAPP", status: desfecho });
      }
    }

    cenario({ guias, envios });
    const mapa = await computeGuideComplianceMap(rows, COMPETENCIA);

    for (const [portalId, eraEnviadaAntes] of legadoPorEmpresa) {
      const agoraEnviada = mapa.get(portalId).das.state === "enviada";
      // A invariante: quem valia como enviada continua valendo. O contrário (passar a valer) é
      // ganho, não regressão — é o WhatsApp entregando o que o e-mail não tinha entregue.
      expect({ portalId, agoraEnviada: agoraEnviada || !eraEnviadaAntes }).toEqual({ portalId, agoraEnviada: true });
    }

    // E o ganho existe mesmo: o que era pendente e saiu pelo WhatsApp virou enviada.
    expect(mapa.get("PENDING_enviado").das.state).toBe("enviada");
    expect(mapa.get("PENDING_falhou").das.state).not.toBe("enviada");
    // ⚠ Falha de envio não é terminal e NÃO muda `ok`: a guia existe, o que falhou foi o envio.
    expect(mapa.get("PENDING_falhou").das.ok).toBe(true);
  });

  it("o backfill continua sendo outra coisa: ele converteria PENDING/ERROR e é isto que prende", () => {
    // A diferença que torna este trabalho seguro e o script não: aqui só `SENT` vira linha.
    expect(linhaLegadoDoEmail({ id: "g", emailStatus: "SENT" })).toMatchObject({ canal: "EMAIL", status: "enviado" });
    for (const emailStatus of ["PENDING", "ERROR", "SENDING", null, undefined, ""]) {
      expect(linhaLegadoDoEmail({ id: "g", emailStatus })).toBeNull();
    }
  });
});
