import { createHash } from "node:crypto";
import { motivoImpedimentoDaGuia, valorDaCorrecaoEmCentavos, evidenciaConfirmaValor } from "../domain/correcaoDeValor.js";
import { motivoImpedimentoDaProvisao, motivoImpedimentoPorFechamento } from "../../accounting/public.js";

export class CorrecaoValorError extends Error {
  constructor(code, message, status = 409) { super(message); this.code = code; this.status = status; }
}
const recusar = (code, message, status) => { throw new CorrecaoValorError(code, message, status); };
export async function carregarGuiaParaCorrecao({ companyId, guideId, novoValor }, { lerGuia, lerFechamento }) {
  const g = await lerGuia(companyId, guideId);
  if (!g) recusar("guia_nao_encontrada", "Guia não encontrada.", 404);
  const impedimentoGuia = motivoImpedimentoDaGuia(g);
  if (impedimentoGuia) recusar(impedimentoGuia.code, impedimentoGuia.message);
  const entradas = g.accountingEntries;
  const impedimentoProvisao = motivoImpedimentoDaProvisao(entradas, companyId, g.valor, novoValor);
  if (impedimentoProvisao) recusar(impedimentoProvisao.code, impedimentoProvisao.message);
  const fechadas = await lerFechamento(companyId, [g.competencia, ...entradas.map(e => e.competencia)]);
  const impedimentoFechamento = motivoImpedimentoPorFechamento(fechadas);
  if (impedimentoFechamento) recusar(impedimentoFechamento.code, impedimentoFechamento.message);
  const revisao = createHash("sha256").update(JSON.stringify(g)).digest("hex");
  return { g, revisao };
}

export async function preverCorrecaoValorGuia({ companyId, guideId, valor }, leituras) {
  const centavos = valorDaCorrecaoEmCentavos(valor);
  if (centavos === null) recusar("valor_invalido", "Informe o valor positivo da guia, com até duas casas decimais.", 400);
  const novoValor = centavos / 100;
  const { g, revisao } = await carregarGuiaParaCorrecao({ companyId, guideId, novoValor }, leituras);
  const leitura = await leituras.lerDocumento(g, novoValor);
  if (!evidenciaConfirmaValor(leitura)) recusar("pdf_nao_confirma_valor", "O PDF original não confirmou este valor pela linha digitável. Corrija após revisar o documento.");
  return { guideId, companyId, valorAtual: Number(g.valor), novoValor, revisao, lancamentosAfetados: g.accountingEntries.length,
    pdfPreservado: true, linhaConfirmada: true, _leitura: leitura };
}
