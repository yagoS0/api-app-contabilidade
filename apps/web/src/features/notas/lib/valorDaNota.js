// ⚠⚠ ESPELHO — ESTE ARQUIVO TEM UMA CÓPIA DELIBERADA NO PORTAL DO CLIENTE.
//
//   `apps/portal-cliente-web/src/features/emitir/lib/valorDaNota.js`
//
// Cópia integral. ⚠ O erro que este módulo fecha é de ORDEM DE GRANDEZA (`1.500,00` → `NaN`,
// `1.500` → `1.5`): uma correção que fique só aqui deixa o outro portal emitindo por 1/1000 do
// valor.
//
// ⚠ Os dois frontends NÃO compartilham código; a obrigação de sincronizar é de quem edita, e a
// tabela "mudou lá, muda aqui" vive em `apps/portal-cliente-web/CLAUDE.md`. ⚠ Duas leituras da
// mesma regra divergem na primeira correção — e a divergência aparece como as duas telas afirmando
// coisas diferentes sobre a MESMA empresa, que é o defeito mais caro de achar.
//
// ⚠ Este aviso foi acrescentado em 24/08/2026: até então **12 dos 13 originais eram mudos** sobre
// ter cópia, e a tabela do `CLAUDE.md` só é consultada por quem já sabe que ela existe.

// O VALOR DOS SERVIÇOS COMO MOEDA BRASILEIRA — uma leitura só, e nenhuma grafia ambígua.
//
// > Pedido do dono, 18/08/2026: *"Ajuste o campo de valor de preenchimento da nota, para valor,
// > com vírgula, não deixando ser escrito de outra forma."*
//
// ⚠⚠ AQUI O ERRO É DE ORDEM DE GRANDEZA, NÃO DE ESTÉTICA. O que este módulo substitui era
// `Number(String(v).replace(",", "."))` — um `replace` só, do PRIMEIRO caractere:
//     "1.500"     → Number("1.500")    = 1,5     (o contador quis mil e quinhentos)
//     "1.500,00"  → Number("1.500.00") = NaN     (valor preenchido na tela, "campo vazio" na regra)
//     "1500.00"   → 1500                         (certo, por acaso)
// Três grafias plausíveis, três desfechos diferentes, e o do meio emite a nota por 1/1000 do valor.
// **Nota emitida não se desfaz** — cancelar é outro ato fiscal, com prazo e motivo.
//
// ⚠ A DECISÃO: O CAMPO SÓ CONSEGUE CONTER A FORMA CANÔNICA. Não há "aceitar as duas grafias e
// tentar adivinhar": o que é digitado passa por `mascararValorDigitado`, que lê o teclado como um
// FLUXO DE DÍGITOS em centavos e devolve sempre `1.234,56`. Digitar `1500.00` é impossível — o
// ponto simplesmente não entra. Ambiguidade que não pode ser escrita não precisa ser resolvida.
//
// ⚠⚠ COLAR É O CASO PERIGOSO, e é por isso que ele tem regra PRÓPRIA (`lerValorColado`). Quem cola
// vem de uma planilha, e a planilha escreve `1500.00`, `R$ 1.500,00` ou `1,500.00` conforme a
// configuração da máquina. Passar o texto colado pelo fluxo de dígitos daria:
//     "1500"   → dígitos 1500   → R$ 15,00   ← ERRADO: quem colou "1500" quis mil e quinhentos
// Então a colagem é PARSEADA, com gramática fechada, e **o que for ambíguo é RECUSADO com o
// motivo** em vez de convertido em silêncio. As duas recusas que importam:
//     "1.500"  → mil e quinhentos (pt-BR) OU um vírgula cinco (en-US) — não dá para saber
//     "1,500"  → um vírgula cinco (pt-BR) OU mil e quinhentos (en-US) — não dá para saber
// Campo intocado + frase dizendo o que houve é melhor que um número plausível e errado.
//
// ⚠ ZERO DIGITADO ≠ CAMPO VAZIO. `""` continua `""` (a máscara nunca fabrica "0,00" num campo em
// branco) e `lerValorDoCampo("")` devolve `null`, não `0`. É a mesma disciplina do `?? ""` do
// `FechamentoModal`, da folha ausente no planejamento e do `pTotTrib*` do cadastro: zero é uma
// AFIRMAÇÃO sobre a nota, ausência não é.
//
// ⚠ O QUE SAI NO PAYLOAD CONTINUA SENDO NÚMERO. `lerValorDoCampo` devolve `number`, e
// `validators/nfsePayload.js` (`valorServicos`) recebe o mesmo que sempre recebeu — nada de string
// mascarada atravessando para o XML.
//
// ⚠ ISTO NÃO VALE PARA PERCENTUAL. Alíquota e `pTotTribSN` continuam aceitando vírgula E ponto
// (`apps/web/src/features/companies/CLAUDE.md`): percentual de 0 a 100 não tem separador de milhar,
// logo não tem a ambiguidade que este módulo existe para matar. Reusar a máscara de moeda lá
// transformaria "5" em "0,05".

/**
 * Teto de dígitos aceitos. 15 dígitos de centavos aproximadamente R$ 9.999.999.999.999,99, dentro
 * do inteiro seguro do JS — acima disso a conta deixaria de ser exata e o campo mentiria.
 */
const MAX_DIGITOS = 15;

export const RECUSA_COLAGEM = {
  AMBIGUO: "ambiguo",
  ILEGIVEL: "ilegivel",
  LONGO: "longo",
};

/** Só os dígitos, com teto. */
function digitos(entrada) {
  return String(entrada ?? "").replace(/\D+/g, "").slice(0, MAX_DIGITOS);
}

/** `150000` (centavos, string) vira `1.500,00`. Milhar com ponto, decimal com vírgula. */
function formatarCentavos(centavos) {
  const d = String(centavos).padStart(3, "0");
  const inteiro = d.slice(0, -2).replace(/^0+(?=\d)/, "");
  const cents = d.slice(-2);
  const comMilhar = inteiro.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return `${comMilhar},${cents}`;
}

/**
 * A MÁSCARA DA DIGITAÇÃO. Recebe o conteúdo bruto do campo depois da tecla e devolve a forma
 * canônica; é a única coisa que pode ficar dentro do input.
 *
 * ⚠ Fluxo de dígitos, não "texto com vírgula": cada dígito empurra o valor uma casa decimal, e o
 * apagar desfaz na mesma ordem. É como se comporta o campo de moeda de banco, e é o que torna
 * `1500.00` impossível de escrever.
 *
 * ⚠ CAMPO EM BRANCO CONTINUA EM BRANCO — apagar tudo devolve string vazia, nunca "0,00".
 */
export function mascararValorDigitado(bruto) {
  const d = digitos(bruto);
  if (!d) return "";
  return formatarCentavos(d);
}

/**
 * O NÚMERO QUE VAI NO PAYLOAD, lido do que está na tela.
 *
 * Devolve `null` para campo vazio (ausência), `0` só quando alguém escreveu zero. A conta passa por
 * INTEIRO de centavos — `Number("1500.00")` seria float, e `0.1 + 0.2` já ensinou o que isso custa
 * num valor que vai para um documento fiscal.
 */
export function lerValorDoCampo(mascarado) {
  const d = digitos(mascarado);
  if (!d) return null;
  return Number(d) / 100;
}

/**
 * O NÚMERO vira A FORMA DO CAMPO. Usado quando o valor já existe (nota reaproveitada) e precisa
 * aparecer no campo já mascarado.
 *
 * ⚠ Vazio para o que não é número ou não é positivo: um campo pré-preenchido com "0,00" a partir de
 * um dado ausente afirmaria que a nota vale zero.
 */
export function formatarValorParaCampo(numero) {
  const n = Number(numero);
  if (!Number.isFinite(n) || n <= 0) return "";
  const centavos = Math.round(n * 100);
  if (String(centavos).length > MAX_DIGITOS) return "";
  return formatarCentavos(String(centavos));
}

/**
 * A COLAGEM. Gramática FECHADA: cada forma aceita tem uma leitura só; o resto é recusado.
 *
 * Retorno: `{ok: true, valor, mascarado}` ou `{ok: false, motivo, texto}`.
 *
 * As formas ACEITAS, e por que cada uma é inequívoca:
 *   `1500`        inteiro sem separador nenhum — não existe idioma em que isso seja 15
 *   `1500,00`     vírgula decimal com 1 ou 2 casas — leitura pt-BR, e só
 *   `1.500,00`    milhar com ponto mais decimal com vírgula — pt-BR completo
 *   `1,500.00`    milhar com vírgula mais decimal com ponto — en-US completo
 *   `1500.00`     ponto com 1 ou 2 casas: NÃO pode ser milhar pt-BR, que agrupa de 3 em 3
 *
 * As formas RECUSADAS, e por que não dá para escolher:
 *   `1.500`       pt-BR: 1500 · en-US: 1,5 — as duas leituras são legítimas
 *   `1,500`       pt-BR: 1,5 · en-US: 1500 — idem
 *   `1,5000`      quatro casas decimais não é moeda; pode ser milhar mal escrito
 *   qualquer outra coisa (letras soltas, sinal negativo, dois separadores iguais)
 */
export function lerValorColado(bruto) {
  const original = String(bruto ?? "");
  // Espaço comum, espaço fino e NBSP saem; "R$" sai. Nada disso muda a leitura do número.
  const t = original.replace(/[\s  ]/g, "").replace(/^R\$/i, "");

  if (!t) return { ok: false, motivo: RECUSA_COLAGEM.ILEGIVEL, texto: original };

  const aceitar = (reais, cents) => {
    const bruta = `${reais}${String(cents ?? "").padEnd(2, "0")}`;
    const d = bruta.replace(/^0+(?=\d)/, "");
    if (d.length > MAX_DIGITOS) return { ok: false, motivo: RECUSA_COLAGEM.LONGO, texto: original };
    return { ok: true, valor: Number(d) / 100, mascarado: formatarCentavos(d) };
  };

  let m;
  // 1500
  if ((m = /^(\d+)$/.exec(t))) return aceitar(m[1], "00");
  // 1.234.567,89 (milhar ponto, decimal vírgula)
  if ((m = /^(\d{1,3}(?:\.\d{3})+),(\d{1,2})$/.exec(t))) return aceitar(m[1].replace(/\./g, ""), m[2].padEnd(2, "0"));
  // 1500,00
  if ((m = /^(\d+),(\d{1,2})$/.exec(t))) return aceitar(m[1], m[2].padEnd(2, "0"));
  // 1,234,567.89 (milhar vírgula, decimal ponto)
  if ((m = /^(\d{1,3}(?:,\d{3})+)\.(\d{1,2})$/.exec(t))) return aceitar(m[1].replace(/,/g, ""), m[2].padEnd(2, "0"));
  // 1500.00 — ponto com 1 ou 2 casas nunca é milhar pt-BR (milhar agrupa de 3 em 3)
  if ((m = /^(\d+)\.(\d{1,2})$/.exec(t))) return aceitar(m[1], m[2].padEnd(2, "0"));

  // ⚠ AS DUAS AMBIGUIDADES QUE O DONO NOMEOU. Ganham motivo próprio para a tela poder DIZER qual é
  // a dúvida, em vez de um "valor inválido" que não ensina nada.
  if (/^\d{1,3}(?:\.\d{3})+$/.test(t)) return { ok: false, motivo: RECUSA_COLAGEM.AMBIGUO, texto: original };
  if (/^\d{1,3}(?:,\d{3})+$/.test(t)) return { ok: false, motivo: RECUSA_COLAGEM.AMBIGUO, texto: original };

  return { ok: false, motivo: RECUSA_COLAGEM.ILEGIVEL, texto: original };
}

/** A frase da recusa — na TELA, ao lado do campo, dizendo o que houve e o que fazer. */
export function textoDaRecusaDeColagem(recusa) {
  if (!recusa || recusa.ok) return null;
  const colado = String(recusa.texto || "").trim();
  const oQueVeio = colado ? ` (“${colado}”)` : "";
  if (recusa.motivo === RECUSA_COLAGEM.AMBIGUO) {
    return (
      `Não colamos este valor${oQueVeio}: ele tem duas leituras possíveis — mil e quinhentos ou um `
      + "e meio, conforme o separador seja de milhar ou de decimal. O campo ficou como estava; "
      + "digite o valor para não haver dúvida."
    );
  }
  if (recusa.motivo === RECUSA_COLAGEM.LONGO) {
    return `Não colamos este valor${oQueVeio}: ele é maior do que este campo consegue representar sem arredondar.`;
  }
  return (
    `Não colamos este valor${oQueVeio}: não é um valor em reais que se possa ler sem adivinhar. `
    + "O campo ficou como estava; digite o valor."
  );
}
