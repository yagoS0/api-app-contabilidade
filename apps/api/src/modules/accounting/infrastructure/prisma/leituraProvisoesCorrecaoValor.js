// Compõe a leitura da guia sem uma segunda consulta às provisões.
export function incluirProvisoesParaCorrecaoValor() {
  return {
    include: {
      lines: { orderBy: { id: "asc" } },
      baixas: { select: { id: true } },
    },
    orderBy: { id: "asc" },
  };
}
