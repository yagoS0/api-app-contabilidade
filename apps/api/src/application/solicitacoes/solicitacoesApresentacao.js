const nome = value => typeof value === 'string' && value.trim() ? value : null;

// Internal read projection only: callers have already authorized and projected
// the requests. Never pass these derived fields to versioning or durable writes.
export async function apresentarSolicitacoes(tx, escopo, itens) {
  const empresasPermitidas = new Set(escopo.empresas);
  const empresasIds = [...new Set(itens.map(item => item.portalClientId)
    .filter(id => id && empresasPermitidas.has(id)))];
  const pessoasIds = [...new Set(itens.flatMap(item => [item.responsavelId, item.criadorId]).filter(Boolean))];
  const [empresas, pessoas] = await Promise.all([
    empresasIds.length ? tx.portalClient.findMany({ where: { id: { in: empresasIds } }, select: { id: true, razao: true } }) : [],
    pessoasIds.length ? tx.user.findMany({ where: { id: { in: pessoasIds }, status: 'active',
      OR: [{ accountType: 'FIRM' }, { role: 'admin' }] }, select: { id: true, name: true } }) : [],
  ]);
  const empresasPorId = new Map(empresas.filter(ref => empresasIds.includes(ref.id)).map(ref => [ref.id, nome(ref.razao)]));
  const pessoasPorId = new Map(pessoas.filter(ref => pessoasIds.includes(ref.id)).map(ref => [ref.id, nome(ref.name)]));
  const referencia = (map, id) => map.has(id) ? { id, nome: map.get(id) } : null;
  return itens.map(item => ({ ...item, apresentacao: {
    empresa: referencia(empresasPorId, item.portalClientId),
    responsavel: referencia(pessoasPorId, item.responsavelId),
    criador: referencia(pessoasPorId, item.criadorId),
  } }));
}
