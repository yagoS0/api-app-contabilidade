function dia(valor) {
  if (typeof valor !== 'string' || !/^\d{4}-\d{2}-\d{2}(?:T|$)/.test(valor)) return null;
  const texto = valor.slice(0, 10);
  const d = new Date(`${texto}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === texto ? texto : null;
}

// Contrato ResultadoConsultaAliquotas do OpenAPI ADN; não atribui semântica a JSON desconhecido.
export function resumoParametrosMunicipais(registro, competencia) {
  const origem = registro?.resposta?.aliquotas;
  if (registro?.status !== 'RECEBIDO_PARA_CONFERENCIA' || registro.recurso !== 'servico' || !origem || Array.isArray(origem) || typeof origem !== 'object') return [];
  const mensal = /^\d{4}-\d{2}$/.test(competencia || '');
  const inicio = dia(mensal ? `${competencia}-01` : competencia);
  const fim = inicio && mensal ? new Date(Date.UTC(Number(inicio.slice(0, 4)), Number(inicio.slice(5, 7)), 0)).toISOString().slice(0, 10) : inicio;
  return Object.entries(origem).flatMap(([servico, valores]) => !Array.isArray(valores) ? [] : valores.map(v => {
    const de = dia(v?.DtIni);
    const ate = v?.DtFim == null ? null : dia(v.DtFim);
    const datasValidas = !!de && (v?.DtFim == null || !!ate) && (!ate || ate >= de);
    const mesmoServico = servico.replace(/\D/g, '') === String(registro.codigoServico);
    let situacao = 'Selecione uma competência para comparar.';
    if (!mesmoServico) situacao = 'Código retornado diferente do serviço consultado; conferir resposta.';
    else if (!datasValidas) situacao = 'Vigência não interpretável; conferir resposta original.';
    else if (inicio) situacao = de <= inicio && (!ate || ate >= fim) ? 'Período cobre a competência informada; aplicação depende de conferência fiscal.'
      : de <= fim && (!ate || ate >= inicio) ? 'Período cobre apenas parte da competência; informe o dia da prestação.'
        : 'Período fora da competência informada.';
    return { servico, incidencia: typeof v?.Incidencia === 'string' ? v.Incidencia : 'Não informada',
      aliquota: typeof v?.Aliq === 'number' && Number.isFinite(v.Aliq) ? v.Aliq : null,
      inicio: de, fim: ate, situacao,
      abrange: mesmoServico && datasValidas && !!inicio && de <= fim && (!ate || ate >= inicio) };
  }));
}
