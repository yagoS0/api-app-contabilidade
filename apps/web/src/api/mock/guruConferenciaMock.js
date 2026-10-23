// Demonstração explicitamente desconectada: nenhuma escrita real vira sucesso simulado.
export function criarGuruConferenciaMock() {
  const indisponivel = async () => { throw Object.assign(new Error('Guru indisponível na demonstração.'), { code: 'guru_desconectado', status: 409 }); };
  return {
    listarGuruConferencia: async (_companyId, pagina = 1) => ({ items: [], total: 0, pagina, tamanhoPagina: 20,
      resumo: { vendas: 0, notasVinculadas: 0, vendasSemVinculo: 0, valoresAusentes: 0, moedasAusentes: 0, moedas: [] },
      conexao: 'DESCONECTADA', ocupada: false, ultimaImportacao: null, demonstracao: true }),
    obterGuruConferencia: indisponivel,
    importarGuruConferencia: indisponivel,
    conferirGuruConferencia: indisponivel,
    buscarNotasGuru: async (...args) => ({ items: [], total: 0, pagina: args[2] ?? 1, tamanhoPagina: 20, demonstracao: true }),
    obterNotaGuru: indisponivel,
    vincularNotaGuru: indisponivel,
    baixarNotaGuru: indisponivel,
  };
}
