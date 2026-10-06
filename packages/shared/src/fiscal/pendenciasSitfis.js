// Projeção documental pura. IDs identificam linhas de um relatório, não dívidas permanentes.
// Não consulta o fisco, não infere pagamento e não vincula guias por competência/valor.
const FONTES = [
  ["RFB", "Receita Federal"], ["PGFN", "Dívida ativa — PGFN"],
  ["MUNICIPAL", "Municipal — ISS e taxas"], ["ESTADUAL", "Estadual"],
];
const normalizar = v => String(v || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

export function valorEmCentavos(valor) {
  const texto = String(valor ?? "").trim();
  if (!/^-?(?:\d+|\d{1,3}(?:\.\d{3})+),\d{2}$/.test(texto)) return null;
  const numero = Number(texto.replaceAll(".", "").replace(",", ""));
  return Number.isSafeInteger(numero) ? numero : null;
}

function campo(registro, nomes) {
  for (const nome of nomes) {
    if (registro[nome] != null && String(registro[nome]).trim()) return String(registro[nome]).trim();
  }
  return null;
}

export function projetarPendenciasSitfis(relatorio) {
  const fontes = FONTES.map(([id, nome]) => ({ id, nome, cobertura: "NAO_CONSULTADO", linhas: [], avisos: [] }));
  const avisos = [...(relatorio?.naoInterpretado || [])];
  for (const [di, diagnostico] of (relatorio?.diagnosticos || []).entries()) {
    let fonte = fontes.find(f => f.id === diagnostico.chave);
    if (!fonte) {
      fonte = { id: `OUTRA_${di}`, nome: diagnostico.orgao || "Outra origem", cobertura: "INCONCLUSIVO", linhas: [], avisos: [] };
      fontes.push(fonte);
    }
    const blocos = diagnostico.blocos || [];
    fonte.cobertura = diagnostico.semPendencia && blocos.length === 0 ? "SEM_REGISTROS" : "INCONCLUSIVO";
    if (diagnostico.semPendencia && blocos.length) fonte.avisos.push("O relatório contém indicação de ausência de pendências e blocos de informação. Confira a origem.");
    for (const [bi, bloco] of blocos.entries()) {
      const titulo = bloco.titulo || "Seção sem título";
      const tipo = /parcelamento/.test(normalizar(titulo)) ? "PARCELAMENTO"
        : /omissao|declaracao/.test(normalizar(titulo)) ? "OBRIGACAO"
          : /debito|inscricao/.test(normalizar(titulo)) ? "DEBITO" : "OUTRO";
      if (bloco.aviso) fonte.avisos.push(`${titulo}: ${bloco.aviso}`);
      if (bloco.naoInterpretado?.length || !bloco.registros?.length) {
        fonte.avisos.push(`${titulo}: leitura incompleta. Consulte o relatório original.`);
      }
      for (const [ri, registro] of (bloco.registros || []).entries()) {
        const anotacoes = bloco.anotacoesPorRegistro?.[ri] || {};
        fonte.linhas.push({
          id: `${di}:${bi}:${ri}`, fonte: fonte.id, tipo, titulo,
          tributo: campo(registro, ["Receita", "Tributo", "Tipo"]),
          competencia: campo(registro, ["PA/Exerc.", "PA", "Exercício"]),
          vencimento: campo(registro, ["Dt. Vcto", "Vencimento"]),
          inscricao: campo(registro, ["Inscrição", "Processo", "Parcelamento"]),
          situacao: campo(registro, ["Situação"]) || campo(anotacoes, ["Situação"]) || titulo,
          original: valorEmCentavos(campo(registro, ["Vl. Original", "Vl.Original"])),
          saldo: valorEmCentavos(campo(registro, ["Sdo. Devedor", "Sdo.Devedor"])),
          multa: valorEmCentavos(registro.Multa), juros: valorEmCentavos(registro.Juros),
          total: valorEmCentavos(registro["Sdo. Dev. Cons."]),
          // Campos originais e anotações nunca são descartados pela projeção operacional.
          evidencia: { registro, anotacoes, descricao: bloco.descricao || [], anotacoesBloco: bloco.anotacoes || [] },
        });
      }
    }
    if (fonte.linhas.length) fonte.cobertura = fonte.avisos.length ? "PARCIAL" : "COM_REGISTROS";
    else if (fonte.avisos.length) fonte.cobertura = "PARCIAL";
  }
  return { versao: 1, emitidoEm: relatorio?.emitidoEm || null, fontes, avisos };
}

export function subtotalDocumental(linhas) {
  const debitos = linhas.filter(l => l.tipo === "DEBITO");
  const conhecidos = debitos.filter(l => l.total != null);
  const centavos = conhecidos.reduce((s, l) => s + l.total, 0);
  return { centavos: conhecidos.length && Number.isSafeInteger(centavos) ? centavos : null,
    semValor: debitos.length - conhecidos.length, quantidade: debitos.length };
}
