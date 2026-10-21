import { getComplianceTags } from '../components/renderCompanyCard';

// Counts coverage nodes, not PDFs: one consolidated document can cover several
// obligations. Parcel agreements have their own projection and remain separate.
export function resumirGuias(compliance) {
  const tags = getComplianceTags(compliance).filter(tag => tag.key !== 'parcDas');
  const known = compliance && !compliance.erro && !compliance.error
    && ['das', 'inss', 'irpj', 'csll', 'pisCofins', 'iss'].some(key => typeof compliance[key]?.required === 'boolean');
  const items = tags.map(tag => {
    const state = tag.state;
    const dispensada = ['vazio', 'na'].includes(state);
    const disponivel = ['gerada', 'enviada', 'falhou'].includes(state);
    const enviada = state === 'enviada';
    const falha = state === 'falhou';
    const revisar = !['vazio', 'na', 'missing', 'gerada', 'enviada', 'falhou'].includes(state);
    return { ...tag, dispensada, disponivel, enviada, falha, revisar,
      faltante: state === 'missing',
      envioPendente: disponivel && !enviada,
      documento: dispensada ? 'Dispensado' : disponivel ? 'Disponível' : state === 'missing' ? 'Faltante' : 'A conferir',
      comunicacao: enviada ? 'Enviada' : falha ? 'Falhou' : disponivel ? 'Pendente' : '—',
    };
  });
  const count = predicate => items.filter(predicate).length;
  const esperadas = count(item => !item.dispensada);
  const disponiveis = count(item => item.disponivel);
  const faltantes = count(item => item.faltante);
  const enviadas = count(item => item.enviada);
  const enviosPendentes = count(item => item.envioPendente);
  const falhas = count(item => item.falha);
  const revisoes = count(item => item.revisar);
  const completo = Boolean(known) && !revisoes;
  const parcelas = Array.isArray(compliance?.coberturaParcelamentoMes) ? compliance.coberturaParcelamentoMes : [];
  const documentosParcelamento = new Set(parcelas.filter(p => p.documento === 'disponivel' && p.guideId).map(p => p.guideId)).size;
  return { items, completo, esperadas, disponiveis, faltantes, enviadas, enviosPendentes, falhas, revisoes,
    parcelas, documentosParcelamento,
    rotulo: !completo ? 'Cobertura a conferir' : esperadas ? `${disponiveis}/${esperadas} disponíveis` : 'Nenhuma guia exigível',
    // Unit remains explicit until the domain supplies document expectation IDs.
    unidade: 'obrigações com guia',
  };
}
