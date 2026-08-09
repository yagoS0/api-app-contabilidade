// O ENVIO EM LOTE NÃO PODE PULAR GUIA COM `emailStatus` NULL.
//
// ⚠ POR QUE ESTE TESTE EXISTE
// `sendCompanyGuidesEmail` filtrava por `{ emailStatus: { in: ["PENDING","ERROR"] } }`, e **`IN` do
// SQL nunca casa com NULL**. A DARF consolidada do Lucro Presumido é a única guia do sistema que
// nasce sem `emailStatus` (é criada direto por `LucroPresumidoProvisaoService`, sem passar pelo
// `GuideService`, e a coluna é `String?` sem `@default`).
//
// O efeito não era um erro: a matriz do lote INCLUI `emailStatus: null` e oferecia a guia como
// pendente, o envio a excluía dos anexos, e a rota respondia `ok: true, sent: 0`. A célula
// continuava "📄 guia" depois do clique, e clicar de novo repetia o nada — **sucesso reportado
// sobre trabalho não feito**. Medido em produção em 2026-08-08: 10 guias nessa situação, todas do LP.
//
// O teste afirma a FORMA DO FILTRO, não o efeito: exercitar o envio exigiria banco, PDF e SMTP.
// O que pode regredir é alguém reescrever o `where` — e é isso que fica travado.

import { whereGuiaPendenteDeEnvio } from "../guideContract.js";

/** Aplica um `where` no formato `{ OR: [...] }` a uma guia. Basta para o que se afirma aqui. */
function casa(where, guia) {
  return (where.OR || []).some((ramo) =>
    Object.entries(ramo).every(([campo, cond]) => {
      if (cond && typeof cond === "object" && "lte" in cond) {
        return guia[campo] != null && guia[campo] <= cond.lte;
      }
      return guia[campo] === cond;
    }),
  );
}

const AGORA = new Date("2026-08-09T12:00:00Z");
const ONTEM = new Date("2026-08-08T12:00:00Z");
const AMANHA = new Date("2026-08-10T12:00:00Z");

const DARF_DO_LP = Object.freeze({ emailStatus: null, emailNextRetryAt: null });
const NASCIDA_NORMAL = Object.freeze({ emailStatus: "PENDING", emailNextRetryAt: null });
const JA_ENVIADA = Object.freeze({ emailStatus: "SENT", emailNextRetryAt: null });
const EM_ENVIO = Object.freeze({ emailStatus: "SENDING", emailNextRetryAt: null });

describe("guia pendente de envio", () => {
  it("⚠ ALCANÇA a guia com `emailStatus` NULL — é a DARF do Lucro Presumido", () => {
    expect(casa(whereGuiaPendenteDeEnvio(), DARF_DO_LP)).toBe(true);
  });

  it("o filtro antigo NÃO a alcançava — é esta a diferença que o defeito era", () => {
    // `{ in: ["PENDING","ERROR"] }` traduzido para a forma testável aqui.
    const filtroAntigo = { OR: [{ emailStatus: "PENDING" }, { emailStatus: "ERROR" }] };
    expect(casa(filtroAntigo, DARF_DO_LP)).toBe(false);
  });

  it("continua alcançando a guia que nasce PENDING", () => {
    expect(casa(whereGuiaPendenteDeEnvio(), NASCIDA_NORMAL)).toBe(true);
  });

  it("não reenvia o que já foi enviado", () => {
    expect(casa(whereGuiaPendenteDeEnvio(), JA_ENVIADA)).toBe(false);
  });

  it("não pega guia em pleno envio", () => {
    // SENDING é estado transitório de outro processo; pegá-la duplicaria o e-mail.
    expect(casa(whereGuiaPendenteDeEnvio(), EM_ENVIO)).toBe(false);
  });
});

describe("a janela de retry separa o laço automático do clique", () => {
  const FALHOU_RETRY_VENCIDO = Object.freeze({ emailStatus: "ERROR", emailNextRetryAt: ONTEM });
  const FALHOU_RETRY_FUTURO = Object.freeze({ emailStatus: "ERROR", emailNextRetryAt: AMANHA });

  it("o AUTOMÁTICO espera a janela vencer", () => {
    expect(casa(whereGuiaPendenteDeEnvio(AGORA), FALHOU_RETRY_VENCIDO)).toBe(true);
    expect(casa(whereGuiaPendenteDeEnvio(AGORA), FALHOU_RETRY_FUTURO)).toBe(false);
  });

  it("⚠ o MANUAL não espera — quem clicou quer agora", () => {
    // Adiar um envio pedido explicitamente, sem dizer por quê, seria o mesmo defeito com outra
    // roupa: o contador clica e nada acontece.
    expect(casa(whereGuiaPendenteDeEnvio(), FALHOU_RETRY_FUTURO)).toBe(true);
  });

  it("guia NULL entra nos dois modos — ela não tem retry para esperar", () => {
    expect(casa(whereGuiaPendenteDeEnvio(AGORA), DARF_DO_LP)).toBe(true);
    expect(casa(whereGuiaPendenteDeEnvio(), DARF_DO_LP)).toBe(true);
  });
});
