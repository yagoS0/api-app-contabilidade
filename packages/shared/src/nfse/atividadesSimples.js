// NT009 v1.01, Anexo VI v1.04.01: serv/cServ/cAtvSN e RN 449–453.
// Declaração do contador: não inferir atividade ou fator R pelo NBS.
export const ATIVIDADES_SIMPLES = Object.freeze([
  ['07', 'Prestação de serviços, cessão de direitos, de uso ou de espaço com incidência do ISS, tributados exclusivamente pelo Anexo III'],
  ['08', 'Serviços contábeis autorizados a pagar ISS fixo em guia do Município — Anexo III'],
  ['09', 'Prestação de serviços sujeitos ao fator R — Anexo III ou V'],
  ['10', 'Transporte municipal rodoviário, metroviário, ferroviário e aquaviário de passageiros — subitem 16.01 — Anexo III'],
  ['11', 'Locação de bens móveis e operações com serviços, bens imateriais e direitos, inclusive imóveis, sem incidência de ISS — Anexo III'],
  ['12', 'Construção civil — subitens 7.02 e 7.05 — Anexo III'],
  ['13', 'Construção civil — subitens 7.02 e 7.05 — Anexo IV'],
  ['14', 'Prestação de serviços — Anexo IV'],
  ['90', 'Operações não tributadas'],
].map(([codigo, descricao]) => Object.freeze({ codigo, descricao })));

export function erroAtividadeSimples(cAtvSN, cTribNac) {
  if (!ATIVIDADES_SIMPLES.some(a => a.codigo === cAtvSN)) return 'Selecione um código de atividade do Simples com duas posições.';
  if (!/^\d{6}$/.test(cTribNac || '')) return 'Selecione o serviço nacional antes de declarar a atividade do Simples.';
  const subitem = cTribNac.slice(0, 4);
  const vinculos = [
    [subitem === '1601', cAtvSN === '10'],
    [cTribNac === '990401', cAtvSN === '11'],
    [['0702', '0705'].includes(subitem), ['12', '13'].includes(cAtvSN)],
  ];
  return vinculos.some(([servico, atividade]) => servico !== atividade)
    ? 'A atividade do Simples não corresponde ao código de tributação nacional do serviço.' : null;
}
