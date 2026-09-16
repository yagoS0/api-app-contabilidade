import { liberarSelecao } from "../liberarSelecao";

function apiTeste() {
  return {
    listarContatosWhatsapp: jest.fn().mockResolvedValue({ canalPadraoEnvio: "PERGUNTAR" }),
    liberarGuiaCliente: jest.fn().mockResolvedValue({ sent: true }),
    resendGuideEmail: jest.fn().mockResolvedValue({ sent: true }),
    enviarGuiaWhatsapp: jest.fn().mockResolvedValue({ ok: true, estado: "aceito" }),
  };
}

it("usa os canais cadastrados, pergunta uma vez e distingue envio de reenvio", async () => {
  const api = apiTeste(); const perguntar = jest.fn(() => true);
  const resultados = await liberarSelecao({ api, companyId: "c1", perguntar, items: [
    { guideId: "nova", reenviarConfirmado: false }, { guideId: "antiga", reenviarConfirmado: true },
  ] });
  expect(perguntar).toHaveBeenCalledTimes(1);
  expect(api.liberarGuiaCliente).toHaveBeenCalledWith("nova");
  expect(api.resendGuideEmail).toHaveBeenCalledWith("antiga");
  expect(api.enviarGuiaWhatsapp.mock.calls).toEqual([["c1", "nova", { complementar: true }], ["c1", "antiga", { reenviar: true }]]);
  expect(resultados.map((r) => r.tom)).toEqual(["pendente", "pendente"]);
});

it("preserva a falha de uma guia e continua as demais sem repetir o envio", async () => {
  const api = apiTeste();
  api.listarContatosWhatsapp.mockResolvedValue({ canalPadraoEnvio: "EMAIL" });
  api.liberarGuiaCliente.mockRejectedValueOnce(Object.assign(new Error("Documento recusado"), { status: 422 }));
  const resultados = await liberarSelecao({ api, companyId: "c1", items: [{ guideId: "falha" }, { guideId: "ok" }] });
  expect(resultados.map((r) => r.ok)).toEqual([false, true]);
  expect(api.liberarGuiaCliente.mock.calls).toEqual([["falha"], ["ok"]]);
  expect(api.enviarGuiaWhatsapp).not.toHaveBeenCalled();
});
