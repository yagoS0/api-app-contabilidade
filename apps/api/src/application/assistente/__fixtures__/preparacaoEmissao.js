// Dublês dos leitores: estas suítes exercitam autorização, validador e declaração.
// As consultas e resoluções reais são exercitadas em emissaoComDadosDoPortal.test.js.
export const preparacaoEmissaoFalsa = {
  prepararDadosFiscaisDoCliente: async ({ servico, competencia, pTotTribSN }) => ({ ok: true, servico, competencia: competencia || "2026-09", pTotTribSN, regime: null, avisos: [] }),
  prepararTomadorDoCliente: async (input) => ({ ok: true, tomador: { cnpjCpf: input.tomadorDoc, nome: input.tomadorNome, email: input.tomadorEmail, endereco: input.endereco }, avisos: [] }),
};
