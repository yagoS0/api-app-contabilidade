import { liberarComCanais } from "./liberarComCanais";
import { decidirCanaisAoLiberar, PERGUNTA_WHATSAPP } from "./canalDeEnvio";

// Um clique processa os IDs escolhidos e mantém o resultado de cada documento.
export async function liberarSelecao({ api, companyId, items, onProgress, perguntar = (texto) => window.confirm(texto) }) {
  if (api.sendGuidesTask) {
    const cadastro = await api.listarContatosWhatsapp(companyId);
    if (!["EMAIL", "WHATSAPP", "PERGUNTAR"].includes(cadastro?.canalPadraoEnvio)) throw new Error("Não foi possível conferir a configuração de envio. Nenhum envio foi iniciado.");
    const decisao = decidirCanaisAoLiberar(cadastro);
    const whatsappRequested = decisao.whatsapp || (decisao.perguntar && perguntar(PERGUNTA_WHATSAPP));
    return api.sendGuidesTask(companyId, { items, whatsappRequested }, onProgress);
  }
  const resultados = [];
  const perguntas = new Map();
  for (const item of items) {
    try {
      const resultado = await liberarComCanais({
        api, companyId, guideId: item.guideId, reenviarConfirmado: item.reenviarConfirmado,
        perguntar: (texto) => {
          if (!perguntas.has(texto)) perguntas.set(texto, perguntar(texto));
          return perguntas.get(texto);
        },
      });
      resultados.push({ ...item, ...resultado });
    } catch (erro) {
      resultados.push({ ...item, ok: false, tom: "erro", texto: erro?.message || "Não foi possível confirmar o envio. Confira o histórico antes de repetir." });
    }
    onProgress?.([...resultados]);
  }
  return resultados;
}
