// O DÍGITO VERIFICADOR DO CPF — regra pura, LOCAL, e só isso.
//
// ⚠ **NÃO SE CONSULTA CPF EM LUGAR NENHUM — decisão do dono, 18/08/2026.** A BrasilAPI, que este
// projeto já usa, é base de **CNPJ**; consulta de CPF é serviço pago e traz LGPD junto (dado
// pessoal de terceiro, que é o TOMADOR da nota, não o usuário do sistema). Então aqui não há
// chamada de rede, não há cache, não há gravação: só aritmética sobre os 11 dígitos.
//
// ⚠ O QUE ISTO PROVA E O QUE NÃO PROVA. O DV prova que o número é **bem formado** — que não houve
// dígito trocado ao digitar. Ele **não** prova que o CPF existe, nem que é da pessoa cujo nome vem
// no payload. Quem afirmar o contrário estará dizendo mais do que o cálculo permite.
//
// ─── POR QUE ISTO PASSOU A EXISTIR ──────────────────────────────────────────────────────────
//
// Medido em 18/08/2026: o projeto inteiro não tinha **nenhuma** validação de DV — havia
// `normalizeCpf` (`application/validators/clientPayload.js`) e `fmtCpf` (front), as duas só
// mexendo em pontuação. O tomador pessoa física entrava na DPS com qualquer sequência de 11
// dígitos, e o caminho está ligado e apontado para o sistema nacional de PRODUÇÃO: um CPF com um
// dígito trocado vira nota fiscal emitida contra outra pessoa (ou contra ninguém), e a NFS-e não
// tem inutilização — o conserto é cancelamento, não edição.
//
// ─── A REGRA ────────────────────────────────────────────────────────────────────────────────
//
// Módulo 11 sobre os 9 primeiros dígitos (pesos 10→2) para o 10º, e sobre os 10 primeiros
// (pesos 11→2) para o 11º; resto < 2 ⇒ dígito 0. É a regra clássica da Receita Federal, a mesma
// que qualquer validador local implementa — não há fonte externa a citar aqui porque não há nada
// de externo: é aritmética fechada, e ela pode ser conferida à mão sobre qualquer CPF conhecido.
//
// ⚠ AS SEQUÊNCIAS REPETIDAS (`000.000.000-00`, `111.111.111-11`, …) **PASSAM no módulo 11** e são
// recusadas à parte. Elas são o caso de "campo preenchido para o formulário deixar seguir", e
// aceitá-las é aceitar exatamente o que a validação existe para pegar.

/**
 * O valor tem a forma de um CPF **e** os dois dígitos verificadores batem?
 *
 * @param {unknown} valor CPF com ou sem pontuação
 * @returns {boolean} `false` também para ausente, comprimento diferente de 11 e sequência repetida
 */
export function cpfTemDvValido(valor) {
  const digitos = String(valor ?? "").replace(/\D+/g, "");
  if (digitos.length !== 11) return false;
  // Sequências repetidas satisfazem o módulo 11 — recusadas explicitamente.
  if (/^(\d)\1{10}$/.test(digitos)) return false;

  const numeros = digitos.split("").map(Number);

  for (const [ate, posicao] of [
    [9, 9],
    [10, 10],
  ]) {
    let soma = 0;
    for (let i = 0; i < ate; i += 1) {
      soma += numeros[i] * (ate + 1 - i);
    }
    const resto = soma % 11;
    const esperado = resto < 2 ? 0 : 11 - resto;
    if (numeros[posicao] !== esperado) return false;
  }

  return true;
}
