// O DINHEIRO DA NOTA — quanto sai de imposto e quanto sobra, a partir do que o contador informou.
//
// ⚠ ISTO NÃO INVENTA REGRA FISCAL, E NÃO CALCULA TRIBUTO NENHUM ALÉM DO QUE A PRÓPRIA TELA JÁ
// AFIRMA. A única conta aqui é a que `textoIssRetido` (em `declaracaoNfse.js`) já diz em palavras
// há tempos: *"o prestador recebe o valor do serviço menos o ISS"* quando há retenção. O ISS sai de
// `valor × alíquota`, e a alíquota é a que o contador digitou — não há tabela, dedução nem
// estimativa de alíquota em lugar nenhum deste arquivo.
//
// ⚠ AUSÊNCIA NÃO VIRA ZERO. Campo vazio devolve `null`, e `null` é desenhado como travessão, nunca
// como `R$ 0,00`. Zero é afirmação: "o ISS desta nota é zero" é uma frase sobre a nota, e ela seria
// falsa toda vez que a alíquota ainda não tivesse sido digitada. É a mesma regra do
// `campoComOrigem.valorMonetario` do planejamento tributário e do `Fmt.dinheiro` do protótipo.
//
// ⚠ O QUE **NÃO** SAI DO LÍQUIDO É INFORMAÇÃO, NÃO RODAPÉ. Um bloco que mostra "ISS R$ 30,00" e
// logo abaixo "Líquido R$ 1.500,00" parece defeito de conta — a não ser que diga, ali, que aquele
// ISS não é descontado do que o tomador paga porque quem recolhe é o prestador. Sem essa linha o
// contador ou desconfia do número, ou conclui que a nota está errada.

/** "1.234,56" · "1234.56" · 1234.56 → 1234.56 · vazio → null (vazio continua vazio). */
export function paraNumero(entrada) {
  if (typeof entrada === "number") return Number.isFinite(entrada) ? entrada : null;
  const texto = String(entrada ?? "").trim();
  if (!texto) return null;
  const limpo = texto.replace(/[^\d,.-]/g, "");
  if (!limpo) return null;
  // Vírgula é decimal em pt-BR; o ponto é milhar.
  const normal = limpo.includes(",") ? limpo.replace(/\./g, "").replace(",", ".") : limpo;
  const n = Number(normal);
  return Number.isFinite(n) ? n : null;
}

/** `null` vira travessão. NUNCA "R$ 0,00" — ver o cabeçalho. */
export function dinheiroOuTraco(valor) {
  if (valor == null || !Number.isFinite(Number(valor))) return "—";
  return Number(valor).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

export const AVISO_ESTIMATIVA =
  "Conta feita com o que está preenchido nesta tela, para conferência. O que vale é a nota "
  + "autorizada pela prefeitura.";

/**
 * O bloco de valores da nota.
 *
 * @param {Object} entrada `{ valor, aliquota, issRetido, pTotTribSN }` — números ou o texto cru dos
 *   campos; qualquer um pode estar vazio.
 * @returns {{
 *   valor: number|null, aliquota: number|null, iss: number|null, issRetido: boolean,
 *   liquido: number|null, motivoIss: string|null, motivoLiquido: string|null,
 *   naoSaemDoLiquido: Array<{rotulo: string, motivo: string}>
 * }}
 */
export function calcularTributosDaNota({ valor, aliquota, issRetido, pTotTribSN } = {}) {
  const v = paraNumero(valor);
  const valorValido = v != null && v > 0 ? v : null;
  const a = paraNumero(aliquota);
  const retido = Boolean(issRetido);
  const pTot = paraNumero(pTotTribSN);

  // ⚠ Alíquota ausente ≠ alíquota zero. Vazio quer dizer "vale a da prefeitura", que esta tela não
  // conhece — e não conhecer é o que ela tem a dizer.
  const aliquotaConhecida = a != null && a >= 0;
  const iss = valorValido != null && aliquotaConhecida ? (valorValido * a) / 100 : null;
  const motivoIss = iss != null
    ? null
    : valorValido == null
      ? "informe o valor do serviço"
      : "a alíquota ficou em branco: vale a da prefeitura, que esta tela não conhece";

  let liquido = null;
  let motivoLiquido = null;
  if (valorValido == null) {
    motivoLiquido = "informe o valor do serviço";
  } else if (!retido) {
    // Sem retenção o tomador paga o valor cheio; o ISS é recolhido depois, pelo prestador.
    liquido = valorValido;
  } else if (iss == null) {
    // A tela já recusa esta combinação antes do clique (`problemaAliquotaComRetencao`); aqui ela
    // não é inventada como "líquido = valor", que seria o número errado por omissão.
    motivoLiquido = "com ISS retido é preciso informar a alíquota para saber quanto o tomador retém";
  } else {
    liquido = valorValido - iss;
  }

  const naoSaemDoLiquido = [];
  if (!retido && iss != null) {
    naoSaemDoLiquido.push({
      rotulo: "ISS",
      motivo:
        "não é retido nesta nota — o tomador paga o valor cheio e quem recolhe o ISS é o prestador, "
        + "fora deste pagamento",
    });
  }
  if (pTot != null) {
    naoSaemDoLiquido.push({
      rotulo: "Total de tributos do Simples",
      motivo:
        "percentual informativo que sai impresso na nota; não é descontado do que o tomador paga "
        + "nem recolhido por ele",
    });
  }

  return {
    valor: valorValido,
    aliquota: aliquotaConhecida ? a : null,
    iss,
    issRetido: retido,
    liquido,
    motivoIss,
    motivoLiquido,
    naoSaemDoLiquido,
  };
}
