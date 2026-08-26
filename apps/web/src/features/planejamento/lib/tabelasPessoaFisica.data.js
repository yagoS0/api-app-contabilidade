// GERADO POR `apps/api/scripts/gerar-tabelas-pessoa-fisica.mjs` — NÃO EDITAR À MÃO.
//
// IRPF e teto do INSS, vigência 2026. Elas existem para UMA pergunta — quanto custa ao sócio
// subir o pró-labore até o Fator R alcançar 28% — e não devem ser usadas para calcular folha real.
//
//   IRPF  docs/irpf/rfb-tabelas-2026.html   SHA-256 473649f0edef1d370e29afc63ec2e372391272d2e3d53de0dc0a1274ada91985
//   INSS  docs/irpf/inss-tabela-contribuicao-2026.html   SHA-256 59f669fe4edd969e532534cbcc17fc20bc6568f8abecc864ff3b05c14a70875d
//
// ⚠⚠ ELAS TÊM VIGÊNCIA, E A VIGÊNCIA VAI À TELA. Mudam por portaria/lei ANUAL — uma tabela de
// pessoa física sem data impressa envelhece calada, e o número velho é indistinguível do certo.
//
// ⚠ O QUE CONTINUA FORA, e a recusa segue valendo: **RAT/FAP e contribuições a terceiros**. Eles
// variam por CNAE e pelo FAP de CADA empresa — não são tabela anual, são cadastro. Ver
// `tabelasFiscais.js`, `ENCARGOS_FOLHA`.

/** A vigência, para a tela IMPRIMIR. Sem ela, nada aqui deve ser usado. */
export const VIGENCIA_PESSOA_FISICA = "2026";

/** Tabela progressiva MENSAL do IRPF. `ate: null` = última faixa. */
export const IRPF_MENSAL = Object.freeze([
  { ate: 2428.8, aliquota: 0, deduzir: 0 },
  { ate: 2826.65, aliquota: 0.075, deduzir: 182.16 },
  { ate: 3751.05, aliquota: 0.15, deduzir: 394.16 },
  { ate: 4664.68, aliquota: 0.225, deduzir: 675.49 },
  { ate: null, aliquota: 0.275, deduzir: 908.73 },
]);

/** Limite mensal do desconto simplificado (substitui as demais deduções legais). */
export const DESCONTO_SIMPLIFICADO_MENSAL = 607.2;

/**
 * O REDUTOR da Lei 15.270/2025 — a isenção até R$ 5.000 e a redução parcial até R$ 7.350.
 *
 * ⚠ A fórmula é da própria Receita, e ela FECHA nos dois extremos (conferido na geração):
 * em `isentoAte` dá exatamente `reducaoMaxima`; em `parcialAte` dá zero.
 */
export const IRPF_REDUTOR_MENSAL = Object.freeze({
  isentoAte: 5000,
  parcialAte: 7350,
  reducaoMaxima: 312.89,
  constante: 978.62,
  fator: 0.133145,
});

/** Salário de contribuição do RGPS — o teto é o que limita o INSS do pró-labore. */
export const INSS_SALARIO_CONTRIBUICAO = Object.freeze({ piso: 1621, teto: 8475.55 });
