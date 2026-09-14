// O destinatário cadastrado autoriza comunicação. A conta do portal continua sendo
// verificada separadamente pelas ferramentas que consultam dados ou executam atos fiscais.
export function empresasParaComunicacao(vinculo) {
  const base = { empresas: [], userId: null, bloqueado: false };
  if (!['VINCULADO', 'AMBIGUO'].includes(vinculo?.situacao)) return base;
  if (vinculo.leitura && vinculo.leitura !== 'ESTRITA') return { ...base, bloqueado: true };
  const empresas = vinculo.empresas || [];
  if (new Set(empresas.map(e => e.portalClientId)).size !== empresas.length
    || empresas.some(e => !e.portalClientId || e.contatos?.length !== 1)) return { ...base, bloqueado: true };
  const pessoas = new Set(empresas.map(e => e.contatos[0].userId || null));
  return {
    empresas: empresas.map(e => ({ ...e, contatoId: e.contatos[0].contatoId, userId: e.contatos[0].userId || null })),
    userId: pessoas.size === 1 ? [...pessoas][0] : null,
    bloqueado: false,
  };
}
