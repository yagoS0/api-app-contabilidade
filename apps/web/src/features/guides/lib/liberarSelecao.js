import { liberarComCanais } from "./liberarComCanais";

// Um clique processa os IDs escolhidos e mantém o resultado de cada documento.
export async function liberarSelecao({ api, companyId, items, perguntar = (texto) => window.confirm(texto) }) {
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
  }
  return resultados;
}
