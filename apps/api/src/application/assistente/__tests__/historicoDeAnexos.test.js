// Evidência persistida de anexos entre turnos. Não há modelo, transporte ou banco externos.
import { montarHistorico } from "../AssistenteService.js";
import { evidenciaDoAnexo } from "../evidenciaDoAnexo.js";

const entrada = { id: "m1", direcao: "in", tipo: "text", corpo: "Manda meu contrato social", registradaEm: new Date("2026-09-08T15:00:00Z") };
const anexo = { id: "a1", direcao: "out", tipo: "document", corpo: "Contrato social · contrato-social.pdf", registradaEm: new Date("2026-09-08T15:00:01Z"), statusEnvio: "enviado", enviadoEm: new Date("2026-09-08T15:00:02Z") };
const atual = { id: "m2", direcao: "in", tipo: "text", corpo: "Agora manda o cartão CNPJ", registradaEm: new Date("2026-09-08T15:01:00Z") };
const historico = (arquivo = anexo, pedido = atual) => montarHistorico([entrada, arquivo], pedido);
const evidencia = (arquivo = anexo) => historico(arquivo).find(t => t.role === "assistant")?.content;

it("pedido de outro documento mantém prova do anexo anterior aceito, com nome e data do aceite", () => {
  const h = historico();
  expect(h[1].content).toContain("Anexo de saída: documento");
  expect(h[1].content).toContain("Contrato social · contrato-social.pdf");
  expect(h[1].content).toContain("envio aceito pelo WhatsApp");
  expect(h[1].content).toContain("Data do aceite: 08/09/2026, 12:00:02");
  expect(h.at(-1).content).toContain("Agora manda o cartão CNPJ");
});

it("aceite da Meta não é apresentado como entrega ou leitura confirmada", () => {
  const texto = evidencia();
  expect(texto).toContain("entrega ao destinatário ainda sem confirmação");
  expect(texto).not.toMatch(/entrega confirmada|leitura confirmada/);
});

it.each([
  ["entregue", "entregueEm", "entrega confirmada", "Data da entrega"],
  ["lido", "lidoEm", "leitura confirmada", "Data da leitura"],
])("status %s usa o evento real correspondente", (statusEnvio, campo, estado, data) => {
  const texto = evidencia({ ...anexo, statusEnvio, [campo]: new Date("2026-09-08T15:00:05Z") });
  expect(texto).toContain(estado);
  expect(texto).toContain(`${data}: 08/09/2026, 12:00:05`);
});

it("imagem anexada preserva tipo e identificação, sem ser convertida em texto falado", () => {
  const texto = evidencia({ ...anexo, tipo: "image", corpo: "Cartão CNPJ · cartao.png" });
  expect(texto).toContain("Anexo de saída: imagem");
  expect(texto).toContain("cartao.png");
});

it("registro legado sem estado não inventa envio aceito", () => {
  const texto = evidencia({ ...anexo, statusEnvio: null, enviadoEm: null });
  expect(texto).toContain("sem confirmação de envio registrada");
  expect(texto).not.toContain("envio aceito");
});

it("estado válido sem timestamp não inventa data do aceite a partir do registro", () => {
  const texto = evidencia({ ...anexo, enviadoEm: null });
  expect(texto).toContain("envio aceito pelo WhatsApp");
  expect(texto).not.toContain("Data do aceite:");
  expect(texto).toContain("Data do registro: 08/09/2026, 12:00:01");
});

it.each(["falhou", "enviando", "indeterminado"])("%s permanece fora da evidência de anexo confirmado", (statusEnvio) => {
  expect(historico({ ...anexo, statusEnvio }).some(t => t.role === "assistant")).toBe(false);
  expect(evidenciaDoAnexo({ ...anexo, statusEnvio })).toBeNull();
});

it("pedido explícito de reenvio permanece no turno atual, mesmo com envio anterior comprovado", () => {
  const h = historico(anexo, { ...atual, corpo: "Pode reenviar o contrato social?" });
  expect(h.at(-1).content).toContain("Pode reenviar o contrato social?");
  expect(h.at(-1).role).toBe("user");
  expect(evidenciaDoAnexo(h.at(-1))).toBeNull();
});
