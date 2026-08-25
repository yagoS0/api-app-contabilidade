// O PRÉ-PREENCHIMENTO DA EMPRESA — e a PROCEDÊNCIA de cada campo, que é metade do produto.
//
// A tela de planejamento tem dois modos com a MESMA tela de resultado: simulação livre (formulário
// em branco, cenário de reunião com prospect) e carteira (pré-preenchida com a empresa). Este
// módulo é a ligação do segundo — ele traduz o que a API devolve
// (`GET /firm/companies/:id/planejamento`) nos valores dos campos e nas linhas de origem.
//
// ⚠⚠ TRÊS REGRAS, E NENHUMA É COSMÉTICA:
//
//  1. **AUSÊNCIA CHEGA COMO AUSÊNCIA.** Campo não apurado devolve `null` e a tela deixa o input
//     VAZIO, dizendo que não foi possível apurar. Nunca zero, nunca um default plausível. O caso
//     que custa dinheiro é a folha: `folha/rbt12` decide Anexo III (≥ 28%) ou V, e uma folha
//     desconhecida lida como zero derruba a empresa no V e troca o regime recomendado.
//  2. **CADA CAMPO PRÉ-PREENCHIDO MOSTRA DE ONDE VEIO.** O contador precisa saber se aquele RBT12
//     saiu da apuração transmitida, da soma dos lançamentos ou da mão dele — são confiabilidades
//     diferentes e ele decide diferente com cada uma.
//  3. **EDITADO POR CIMA CONTINUA SENDO EDITADO POR CIMA.** O valor é cenário, não cadastro: mudar
//     é o uso normal. Mas o PDF circula sozinho, e dois PDFs da mesma empresa com números
//     diferentes precisam se distinguir NO PAPEL — senão a diferença parece erro de cálculo.

/** Os campos que a empresa pode pré-preencher, na ordem em que aparecem na tela e no PDF. */
export const CAMPOS_PREENCHIDOS = Object.freeze([
  { chave: "receitaAnual", rotulo: "Receita anual", tipo: "brl" },
  { chave: "rbt12", rotulo: "RBT12", tipo: "brl" },
  { chave: "folhaAnual", rotulo: "Folha de 12 meses (com pró-labore)", tipo: "brl" },
  { chave: "regimeAtual", rotulo: "Regime atual", tipo: "texto" },
  { chave: "anexo", rotulo: "Anexo do Simples", tipo: "texto" },
  { chave: "sujeitoFatorR", rotulo: "Sujeito ao Fator R", tipo: "booleano" },
  { chave: "aliquotaIss", rotulo: "Alíquota de ISS", tipo: "percentual" },
  { chave: "atividadePresumido", rotulo: "Atividade no Lucro Presumido", tipo: "texto" },
]);

const CHAVES = CAMPOS_PREENCHIDOS.map((c) => c.chave);

const campoVazio = Object.freeze({ valor: null, apurado: false, origem: null, motivoAusencia: null });

/**
 * ⚠ ACEITA A FORMA ANTIGA (plana) DE PROPÓSITO. O `PlanejamentoPage` nasceu com um `empresa` de
 * campos soltos (`{ razao, receitaAnual, rbt12, folhaAnual, aliquotaIss }`) e ninguém nunca o
 * passou — não havia chamador. Manter a leitura aqui custa dez linhas e evita que um chamador
 * antigo passe a receber `null` em silêncio; o que ele NÃO ganha é origem, e a tela diz isso
 * ("origem não informada") em vez de inventar uma.
 */
function normalizarCampos(dados) {
  if (!dados || typeof dados !== "object") return null;
  if (dados.campos && typeof dados.campos === "object") return dados.campos;

  const legado = {};
  for (const chave of CHAVES) {
    const bruto = dados[chave];
    legado[chave] = bruto == null
      ? campoVazio
      : { valor: bruto, apurado: true, origem: "origem não informada (dados passados diretamente à tela)", motivoAusencia: null };
  }
  return legado;
}

/**
 * @param {object|null} dados — o payload de `GET /firm/companies/:id/planejamento`, ou `null`
 *   (simulação livre: sem empresa vinculada).
 * @returns {{ empresa, referencia, valores, campos, temEmpresa: boolean }}
 *   `valores[chave]` é `null` quando o campo NÃO foi apurado — a tela deixa o input vazio.
 */
export function prefillDaEmpresa(dados) {
  const campos = normalizarCampos(dados);
  if (!campos) {
    return { empresa: null, referencia: null, valores: {}, campos: {}, fatorR: null, presumido: null, temEmpresa: false };
  }

  const valores = {};
  const normalizados = {};
  for (const chave of CHAVES) {
    const c = campos[chave] || campoVazio;
    const apurado = Boolean(c.apurado) && c.valor !== null && c.valor !== undefined;
    normalizados[chave] = {
      valor: apurado ? c.valor : null,
      apurado,
      origem: apurado ? (c.origem || null) : null,
      motivoAusencia: apurado ? null : (c.motivoAusencia || "Não foi possível apurar este campo."),
    };
    valores[chave] = normalizados[chave].valor;
  }

  return {
    empresa: dados.empresa || (dados.razao ? { razao: dados.razao } : null),
    referencia: dados.referencia || null,
    valores,
    campos: normalizados,
    // ⚠ A DIVERGÊNCIA ENTRE O PERFIL DE ATIVIDADES E O CADASTRO viaja inteira. Ela não é campo:
    // é o aviso de que as duas fontes discordam sobre a MESMA empresa — o defeito que o dono
    // relatou (o Perfil dizia "III ou V (Fator R)" e esta tela mostrava o checkbox desmarcado).
    // ⚠ A tela AVISA; ela não conserta o cadastro. Corrigir em silêncio deixaria o cadastro errado
    // para sempre, e quem responde pelo cadastro é o contador.
    fatorR: dados.fatorR || null,
    // ⚠⚠ A SUGESTÃO DA CATEGORIA DE PRESUNÇÃO — e ela NÃO é um campo. O campo
    // `atividadePresumido` continua AUSENTE de propósito: `apurado: true` quer dizer "veio da
    // empresa", e a linha de origem imprime "da empresa · …" ao lado. Uma sugestão carimbada assim
    // se leria como confirmada — que é a confusão que a decisão do dono ("sugerir, você confirma")
    // existe para evitar. Ela viaja separada, com `confirmadoPeloContador: false`.
    presumido: dados.presumido || null,
    temEmpresa: true,
  };
}

/** Compara dois valores de campo tolerando centavo e string × número. */
function mesmoValor(a, b) {
  if (a === null || a === undefined || b === null || b === undefined) return a === b;
  if (typeof a === "boolean" || typeof b === "boolean") return Boolean(a) === Boolean(b);
  const na = Number(a);
  const nb = Number(b);
  if (Number.isFinite(na) && Number.isFinite(nb)) return Math.abs(na - nb) < 0.005;
  return String(a) === String(b);
}

/**
 * A PROCEDÊNCIA DO VALOR QUE ESTÁ EM USO — uma linha por campo, para a tela e para o PDF.
 *
 * Quatro respostas, e cada uma é uma coisa diferente:
 *  • `da_empresa`  — veio da empresa e não foi tocado. Traz a origem apurada.
 *  • `digitado`    — a empresa tinha um valor e o contador pôs outro por cima. Traz OS DOIS.
 *  • `informado`   — a empresa não tinha o dado e alguém digitou. Não é "da empresa".
 *  • `ausente`     — a empresa não tinha e ninguém digitou. Traz o motivo da ausência.
 *
 * @param {{ campos: object }} prefill — o retorno de `prefillDaEmpresa`.
 * @param {object} emUso — os valores atualmente nos campos da tela (já parseados).
 */
export function procedenciaDosCampos(prefill, emUso = {}) {
  const campos = (prefill && prefill.campos) || {};
  return CAMPOS_PREENCHIDOS.map(({ chave, rotulo, tipo }) => {
    const doCadastro = campos[chave] || campoVazio;
    const atual = emUso[chave];
    const temAtual = atual !== null && atual !== undefined && atual !== "";

    if (doCadastro.apurado && mesmoValor(doCadastro.valor, atual)) {
      return { chave, rotulo, tipo, estado: "da_empresa", valor: atual, valorDaEmpresa: doCadastro.valor, texto: doCadastro.origem };
    }
    if (doCadastro.apurado && temAtual) {
      return {
        chave, rotulo, tipo, estado: "digitado", valor: atual, valorDaEmpresa: doCadastro.valor,
        texto: `digitado por cima do valor da empresa (${doCadastro.origem})`,
      };
    }
    if (doCadastro.apurado && !temAtual) {
      // Apagado à mão: o campo da empresa existia e o contador o esvaziou. Não é ausência de dado.
      return { chave, rotulo, tipo, estado: "digitado", valor: null, valorDaEmpresa: doCadastro.valor, texto: `apagado à mão (a empresa tem ${doCadastro.origem})` };
    }
    if (temAtual) {
      return { chave, rotulo, tipo, estado: "informado", valor: atual, valorDaEmpresa: null, texto: "informado nesta simulação — não veio da empresa" };
    }
    return { chave, rotulo, tipo, estado: "ausente", valor: null, valorDaEmpresa: null, texto: doCadastro.motivoAusencia };
  });
}
