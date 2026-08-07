// A CÉLULA DE VALOR DO LANÇAMENTO ACEITA FÓRMULA, COMO UMA CÉLULA DE EXCEL: `=10+10` vira 20.
//
// Por que existe: quando o valor vem de uma soma de notas, de um rateio ou de uma divisão em
// parcelas, o contador calculava fora e transcrevia — e transcrever é onde se erra dígito.
//
// ⚠ NADA DE `eval` NEM `new Function`. Isto é texto digitado por usuário virando lançamento
// contábil; o avaliador abaixo é escrito à mão e só conhece número e cinco símbolos. Não existe
// `eval` em nenhum lugar deste repositório, e este arquivo não vai ser o primeiro.
//
// ⚠ NUNCA DEVOLVE 0 POR DESISTÊNCIA. Fórmula quebrada devolve `ok: false` com motivo, e quem chama
// bloqueia o salvamento. Um parser que devolve 0 quando não entende grava um lançamento de zero
// reais em silêncio — o pior desfecho possível para este campo.

/** Fora de escopo de propósito: funções (SOMA/SE), referência a outra linha, `%`, potência. */
const OPERADORES = {
  "+": { precedencia: 1, aplicar: (a, b) => a + b },
  "-": { precedencia: 1, aplicar: (a, b) => a - b },
  "*": { precedencia: 2, aplicar: (a, b) => a * b },
  "/": { precedencia: 2, aplicar: (a, b) => a / b },
};

const MENSAGENS = {
  formula_incompleta: "Fórmula incompleta.",
  parenteses_abertos: "Falta fechar parêntese.",
  parenteses_sobrando: "Há parêntese fechando a mais.",
  caractere_invalido: "Só dá para usar números e + - * / ( ).",
  use_asterisco: "Use * para multiplicar.",
  numero_ambiguo: "Não dá para saber se a vírgula ou o ponto é o decimal — escreva de um jeito só.",
  numero_invalido: "Número mal escrito.",
  divisao_por_zero: "Divisão por zero.",
  resultado_invalido: "A conta não resulta num número.",
  resultado_fora_da_faixa: "Valor alto demais para um lançamento.",
  valor_nao_positivo: "O valor precisa ser maior que zero.",
};

/**
 * ⚠ TETO DE FAIXA — a coluna é `Decimal(18,2)`, ou seja 16 dígitos inteiros. Sem esta guarda,
 * `=999999999999*9999` passa pelo front, chega ao backend como `1e+16` em notação científica, o
 * `parseFloat` de lá aceita, e o Postgres devolve erro 500. Recusar aqui troca uma falha de
 * servidor por uma frase no campo.
 */
const TETO = 1e15;

const falha = (erro, ehFormula) => ({ ok: false, erro, mensagem: MENSAGENS[erro], ehFormula });

/**
 * ⚠ A REGRA DO SEPARADOR DECIMAL — É AQUI QUE MORA O RISCO DE ORDEM DE GRANDEZA.
 *
 * Em pt-BR a vírgula é decimal e o ponto é milhar, mas quem digita em teclado numérico usa o PONTO
 * como decimal ("10.50"). Ler errado não produz um valor um pouco diferente: produz um valor 100 ou
 * 1000 vezes maior.
 *
 *   "1.234,56"  -> 1234.56   tem vírgula: vírgula é decimal, pontos são milhar
 *   "10,5"      -> 10.5      idem
 *   "10.5"      -> 10.5      um ponto com 1 ou 2 dígitos depois: decimal (teclado numérico)
 *   "10.50"     -> 10.5      idem
 *   "1.234"     -> 1234      um ponto com exatamente 3 dígitos depois: milhar
 *   "1.234.567" -> 1234567   vários pontos: milhar
 *   "10,5.3"    -> ERRO      mistura os dois: recusa em vez de adivinhar
 *
 * ⚠ O PONTO CEGO ASSUMIDO: quem digitar "2.500" querendo R$ 2,50 recebe 2500. Não há como
 * distinguir isso de "dois mil e quinhentos" olhando só o texto — a ambiguidade é da notação, não
 * do parser. É POR ISSO que a tela mostra a prévia do resultado antes de salvar: a leitura fica
 * visível em vez de virar lançamento errado. Se alguém remover a prévia, esta regra fica perigosa.
 */
/**
 * ⚠ GRAMÁTICA ESTRITA, NÃO HEURÍSTICA. Duas formas canônicas são aceitas; TODO o resto é recusado
 * com erro nomeado. A primeira versão disto era permissiva ("tem vírgula? então vírgula é decimal")
 * e transformava lixo em número plausível: `1.23.4` virava 1234, `1.2345,67` virava 12345.67 e
 * `1234.500` virava 1.234.500. Nenhum desses é um número que alguém quis escrever — mas todos
 * saíam do parser com cara de valor válido, prontos para virar lançamento.
 *
 * O que segura a gramática é o AGRUPAMENTO DE 3 DÍGITOS ser obrigatório no milhar. É ele que
 * distingue "1.234" (mil duzentos e trinta e quatro) de "1.23.4" (não é número nenhum).
 */
const FORMA_BR_MILHAR_DECIMAL = /^\d{1,3}(\.\d{3})+,\d+$/;   // 1.234,56 · 1.234.567,89
const FORMA_BR_MILHAR = /^\d{1,3}(\.\d{3})+$/;               // 1.234 · 1.234.567
const FORMA_BR_DECIMAL = /^\d*,\d+$/;                        // 1234,56 · 0,5 · ,5
const FORMA_INTEIRO = /^\d+$/;                               // 1234 · 007
const FORMA_PONTO_DECIMAL = /^\d+\.\d{1,2}$/;                // 10.5 · 10.50 · 1234.56

function lerNumero(bruto) {
  const t = String(bruto).trim();
  if (!t) return { erro: "numero_invalido" };

  // ⚠ VÍRGULA DEPOIS DE PONTO É pt-BR; PONTO DEPOIS DE VÍRGULA É en-US — e este é o caso que mais
  // custa. "1,234.56" colado de planilha em locale americano vale 1234,56; lido como brasileiro
  // viraria 1,23. Erro de 1000× PARA BAIXO, vindo de um copiar-e-colar comum. Recusar é a única
  // resposta honesta: o texto não diz qual das duas notações é.
  if (t.includes(",") && t.includes(".") && t.lastIndexOf(",") < t.lastIndexOf(".")) {
    return { erro: "numero_ambiguo" };
  }

  if (FORMA_BR_MILHAR_DECIMAL.test(t)) {
    const [inteiro, decimal] = t.split(",");
    return { valor: Number(`${inteiro.replace(/\./g, "")}.${decimal}`) };
  }
  if (FORMA_BR_MILHAR.test(t)) return { valor: Number(t.replace(/\./g, "")) };
  if (FORMA_BR_DECIMAL.test(t)) return { valor: Number(t.replace(",", ".")) };
  if (FORMA_INTEIRO.test(t)) return { valor: Number(t) };
  if (FORMA_PONTO_DECIMAL.test(t)) return { valor: Number(t) };

  return { erro: "numero_invalido" };
}

/**
 * Quebra o texto em números, operadores e parênteses.
 * Devolve `null` no primeiro caractere que não pertence à gramática — melhor recusar a expressão
 * inteira que ignorar um pedaço dela e calcular outra coisa.
 */
function tokenizar(texto) {
  const tokens = [];
  let i = 0;
  while (i < texto.length) {
    const c = texto[i];
    if (c === " ") { i += 1; continue; }
    if (OPERADORES[c] || c === "(" || c === ")") { tokens.push({ tipo: c === "(" || c === ")" ? c : "op", valor: c }); i += 1; continue; }
    if (/[\d.,]/.test(c)) {
      let j = i;
      while (j < texto.length && /[\d.,]/.test(texto[j])) j += 1;
      const { valor, erro } = lerNumero(texto.slice(i, j));
      if (erro) return { erro };
      if (!Number.isFinite(valor)) return { erro: "numero_invalido" };
      tokens.push({ tipo: "num", valor });
      i = j;
      continue;
    }
    // ⚠ "x" ganha mensagem PRÓPRIA em vez de cair no genérico. Escrever "10 x 3" é o erro natural
    // de quem veio da calculadora, e "só dá para usar números e + - * /" não diz o que fazer.
    // Aceitar o "x" seria pior: abriria a porta para "X" e "×" e para um x solto virar
    // multiplicação fantasma.
    if (c === "x" || c === "X" || c === "×") return { erro: "use_asterisco" };
    return { erro: "caractere_invalido" };
  }
  return { tokens };
}

/**
 * Shunting-yard + avaliação em pilha. Escolhido em vez de descida recursiva porque cabe inteiro
 * numa tela e não recursa — expressão longa colada de outro lugar não estoura a pilha.
 */
function avaliarTokens(tokens) {
  const valores = [];
  const operadores = [];

  const aplicarTopo = () => {
    const op = operadores.pop();
    const b = valores.pop();
    const a = valores.pop();
    if (a === undefined || b === undefined) return "formula_incompleta";
    if (op === "/" && b === 0) return "divisao_por_zero";
    valores.push(OPERADORES[op].aplicar(a, b));
    return null;
  };

  let esperandoValor = true; // início da expressão, depois de "(" ou depois de um operador
  for (const t of tokens) {
    if (t.tipo === "num") {
      if (!esperandoValor) return { erro: "formula_incompleta" }; // "10 20"
      valores.push(t.valor);
      esperandoValor = false;
    } else if (t.tipo === "op") {
      // Menos unário: "-10", "=(-5+8)". O mais unário também passa, por simetria.
      if (esperandoValor) {
        if (t.valor === "-") { valores.push(0); operadores.push("-"); continue; }
        if (t.valor === "+") continue;
        return { erro: "formula_incompleta" };
      }
      while (operadores.length && operadores.at(-1) !== "(" && OPERADORES[operadores.at(-1)].precedencia >= OPERADORES[t.valor].precedencia) {
        const e = aplicarTopo();
        if (e) return { erro: e };
      }
      operadores.push(t.valor);
      esperandoValor = true;
    } else if (t.tipo === "(") {
      if (!esperandoValor) return { erro: "formula_incompleta" }; // "10(2)"
      operadores.push("(");
      esperandoValor = true;
    } else if (t.tipo === ")") {
      if (esperandoValor) return { erro: "formula_incompleta" }; // "(10+)"
      while (operadores.length && operadores.at(-1) !== "(") {
        const e = aplicarTopo();
        if (e) return { erro: e };
      }
      if (!operadores.length) return { erro: "parenteses_sobrando" };
      operadores.pop();
      esperandoValor = false;
    }
  }

  if (esperandoValor) return { erro: "formula_incompleta" }; // "=10+"
  while (operadores.length) {
    if (operadores.at(-1) === "(") return { erro: "parenteses_abertos" };
    const e = aplicarTopo();
    if (e) return { erro: e };
  }
  if (valores.length !== 1) return { erro: "formula_incompleta" };
  return { valor: valores[0] };
}

/**
 * Arredonda para 2 casas — a coluna é `Decimal(18,2)` no Prisma, então guardar mais casas não é
 * opção. Passa por `Number.EPSILON` porque `Math.round(1.005 * 100)` devolve 100 em ponto
 * flutuante, e um centavo a menos num lançamento contábil é diferença que alguém vai procurar.
 */
function arredondar(n) {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/**
 * Lê o que o usuário digitou na célula de valor.
 *
 * Sempre devolve a MESMA forma — nunca lança, nunca devolve `null` solto:
 *   { ok: true,  valor: 20,   ehFormula: true  }
 *   { ok: true,  valor: null, vazio: true      }   campo em branco NÃO é erro (é o estado inicial)
 *   { ok: false, erro: "...", mensagem: "...", ehFormula }
 *
 * `vazio` é separado de `erro` de propósito: os dois cabem em "não tem valor utilizável", e é
 * juntando os dois que a tela acabaria acusando erro na linha recém-aberta, ou salvando 0.
 */
export function avaliarValor(texto) {
  const t = String(texto ?? "").trim();
  if (!t) return { ok: true, valor: null, vazio: true, ehFormula: false };

  const ehFormula = t.startsWith("=");
  const expressao = ehFormula ? t.slice(1).trim() : t;
  if (!expressao) return falha("formula_incompleta", ehFormula); // só "="

  const { tokens, erro: erroToken } = tokenizar(expressao);
  if (erroToken) return falha(erroToken, ehFormula);
  if (!tokens.length) return falha("formula_incompleta", ehFormula);

  const { valor, erro } = avaliarTokens(tokens);
  if (erro) return falha(erro, ehFormula);
  if (!Number.isFinite(valor)) return falha("resultado_invalido", ehFormula);
  if (Math.abs(valor) >= TETO) return falha("resultado_fora_da_faixa", ehFormula);

  return { ok: true, valor: arredondar(valor), ehFormula };
}

/**
 * O que a célula precisa saber para decidir se pode salvar. Junta a leitura com a regra de negócio
 * ("valor tem que ser > 0", que já existia como `Number(valor) > 0`) para a tela não ter de
 * recombinar as duas — recombinar em três lugares foi como as leituras divergiriam.
 */
export function valorUtilizavel(texto) {
  const r = avaliarValor(texto);
  if (!r.ok) return r;
  if (r.vazio) return r;
  if (r.valor <= 0) return { ok: false, erro: "valor_nao_positivo", mensagem: MENSAGENS.valor_nao_positivo, ehFormula: r.ehFormula };
  return r;
}

export const MENSAGENS_VALOR = MENSAGENS;
