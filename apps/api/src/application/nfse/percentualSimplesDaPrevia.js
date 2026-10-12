const numero = v => v == null || v === '' ? null : Number.isFinite(Number(v)) ? Number(v) : null;
const percentual = v => v != null && v >= 0 && v <= 100;
const positivas = obj => Object.entries(obj || {}).filter(([, v]) => numero(v) > 0);

// Usa apenas dados já apurados/importados. Nunca consulta ou transmite PGDAS-D nesta leitura.
export async function percentualSimplesDaPrevia({ db, portalClientId, competencia, servicoUnico }) {
  const mes = String(competencia).slice(0, 7);
  const [ano, numeroMes] = mes.split('-').map(Number);
  const mesAnterior = `${numeroMes === 1 ? ano - 1 : ano}-${String(numeroMes === 1 ? 12 : numeroMes - 1).padStart(2, '0')}`;
  const vazio = { estado: 'INDISPONIVEL', valor: null, competencia: null, fonte: null,
    mensagem: 'Não há percentual compatível disponível. Informe o percentual conferido pelo contador.' };
  if (!servicoUnico) return { ...vazio, mensagem: 'Há mais de um serviço no cadastro. Confira o percentual aplicável à atividade desta nota.' };
  try {
    const where = { portalClientId, competencia: { lte: mes } };
    const [apuracoes, circulares] = await Promise.all([
      db.apuracaoSnapshot.findMany({ where, orderBy: { competencia: 'desc' }, take: 12,
        select: { competencia: true, estado: true, receitaPorTipo: true, aliquotaEfetivaPorAnexo: true, dasCalculadoLocalProcedencia: true, simulacaoSerpro: true } }),
      db.companyMonthlyCircular.findMany({ where, orderBy: { competencia: 'desc' }, take: 12,
        select: { competencia: true, metadata: true, pgdasNumeroDeclaracao: true } }),
    ]);
    const candidatos = [];
    for (const c of circulares) {
      const p = c.metadata?.parsedPgdas;
      const atividades = p?.atividades?.filter(a => numero(a.receita) > 0) || [];
      const receita = numero(p?.receitaBruta), imposto = numero(p?.impostoApurado);
      // Não divide DAS pago/recalculado por notas capturadas: usa imposto APURADO e receita
      // do mesmo extrato, somente quando uma única atividade de serviço explica toda a receita.
      if (c.metadata?.integrationSource !== 'SERPRO_PGDASD_DECLARACAO' || !c.pgdasNumeroDeclaracao
        || atividades.length !== 1 || atividades[0].categoria !== 'servico' || !(receita > 0)
        || imposto == null || imposto < 0 || Math.abs(Number(atividades[0].receita) - receita) > 0.01) continue;
      const valor = Number((imposto / receita * 100).toFixed(2));
      if (percentual(valor)) candidatos.push({ valor, competencia: c.competencia, fonte: 'PGDAS_D',
        referencia: c.pgdasNumeroDeclaracao, prioridade: 0, exigeConfirmacao: true, permiteAnterior: true });
    }
    for (const a of apuracoes) {
      const tipos = positivas(a.receitaPorTipo);
      const anexos = Object.entries(a.aliquotaEfetivaPorAnexo || {}).filter(([, v]) => numero(v?.receita) > 0);
      if (a.dasCalculadoLocalProcedencia !== 'MOTOR_LOCAL' || !['calculada', 'fechada', 'transmitida', 'confirmada'].includes(a.estado)
        || tipos.length !== 1 || !/^SERVICO_/.test(tipos[0][0]) || anexos.length !== 1
        || !['III', 'IV', 'V'].includes(anexos[0][0])) continue;
      const efetiva = numero(anexos[0][1].efetiva);
      if (efetiva === null || efetiva < 0 || efetiva > 1) continue;
      const valor = efetiva == null ? null : Number((efetiva * 100).toFixed(2));
      if (percentual(valor)) candidatos.push({ valor, competencia: a.competencia, fonte: 'APURACAO_LOCAL', anexo: anexos[0][0], prioridade: 1,
        exigeConfirmacao: Boolean(a.simulacaoSerpro) || !['fechada', 'confirmada'].includes(a.estado),
        permiteAnterior: !a.simulacaoSerpro && ['fechada', 'confirmada'].includes(a.estado) });
    }
    candidatos.sort((a, b) => b.competencia.localeCompare(a.competencia) || a.prioridade - b.prioridade);
    const escolhido = candidatos[0];
    if (!escolhido) return vazio;
    const { prioridade, exigeConfirmacao, permiteAnterior, ...dados } = escolhido;
    const exata = escolhido.competencia === mes;
    const conflito = candidatos.some(c => c.competencia === escolhido.competencia && Math.abs(c.valor - escolhido.valor) > 0.01);
    const referenciaAnterior = escolhido.competencia === mesAnterior && permiteAnterior && !conflito;
    const confirmar = conflito || (!referenciaAnterior && (!exata || exigeConfirmacao));
    return { ...dados, exata, provisorio: referenciaAnterior, estado: confirmar ? 'REFERENCIA' : 'AUTOMATICO',
      mensagem: conflito ? 'Apuração e PGDAS-D divergem. Confira antes de usar o percentual.'
        : referenciaAnterior ? `Percentual provisório do mês anterior (${mesAnterior}); ajuste se necessário para esta nota.`
        : !exata ? `Referência de ${escolhido.competencia}; confirme se é aplicável à competência desta nota.`
          : confirmar ? 'Percentual sugerido para conferência da atividade e da competência.'
            : 'Percentual preenchido pela apuração da competência.' };
  } catch { return { ...vazio, mensagem: 'Não foi possível consultar a apuração. Confira o percentual antes de emitir.' }; }
}
