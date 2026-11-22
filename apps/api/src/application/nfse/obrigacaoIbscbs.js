// Ato Conjunto RFB/CGIBS 4/2026, art. 1º, III e §1º, alterado pelo Ato 7/2026.
// Fontes e limites: docs/nfse-calendario-ibscbs-p01-20261122.md.
// Não consulta rede nem confunde aceitação do XML com dispensa de obrigação.
export const VERSAO_OBRIGACAO_IBSCBS = 'ato-7-2026-revisao-2026-11-22';
export const CATEGORIAS_IBSCBS = ['SERVICO_ISS', 'PLATAFORMA_DIGITAL'];
const SUBITENS_MARCO_2027 = new Set(['0103', '0105', '0109', '1601']);

function diaCivil(entrada) {
  const texto = entrada instanceof Date && !Number.isNaN(entrada.getTime())
    ? entrada.toISOString().slice(0, 10) : String(entrada ?? '').trim();
  if (!/^\d{4}-\d{2}(?:-\d{2})?$/.test(texto)) return null;
  const dia = texto.length === 7 ? `${texto}-01` : texto;
  const data = new Date(`${dia}T00:00:00Z`);
  return !Number.isNaN(data.getTime()) && data.toISOString().slice(0, 10) === dia ? dia : null;
}

export function obrigacaoIbscbs({ competencia, opSimpNac, codigoServico, categoria }) {
  const dia = diaCivil(competencia);
  const resultado = (estado, motivo, inicio = null) => ({ estado, motivo, inicio, versao: VERSAO_OBRIGACAO_IBSCBS });
  const indefinido = motivo => resultado('INDETERMINADO', motivo);
  if (!dia) return indefinido('Confirme uma competência válida antes de verificar IBS/CBS.');
  if (!['1', '2', '3'].includes(opSimpNac)) return indefinido('Confirme o regime aplicável à competência da nota.');
  const simples = opSimpNac !== '1';
  const codigo = String(codigoServico ?? '');
  const codigoCoberto = /^\d{6}$/.test(codigo) && Number(codigo.slice(0, 2)) >= 1 && Number(codigo.slice(0, 2)) <= 40;
  const categoriaValida = categoria == null || CATEGORIAS_IBSCBS.includes(categoria);
  const marcoEspecial = SUBITENS_MARCO_2027.has(codigo.slice(0, 4)) || categoria === 'PLATAFORMA_DIGITAL';
  // Nenhuma hipótese do Simples inicia em 2026. Preservar a resposta histórica,
  // sem inventar início exato quando a classificação ainda é insuficiente.
  if (simples && dia < '2027-01-01') return resultado('FACULTATIVO',
    'Nenhum prazo do Simples previsto no Ato 7/2026 iniciado.',
    codigoCoberto && categoriaValida ? (marcoEspecial ? '2027-03-01' : categoria === 'SERVICO_ISS' ? '2027-01-01' : null) : null);
  if (dia < '2026-10-01') return resultado('FACULTATIVO', 'Anterior aos prazos das hipóteses de NFS-e cobertas por este contrato.');
  if (!codigoCoberto) {
    return indefinido('Este fornecimento exige classificação fiscal específica antes de determinar o prazo de IBS/CBS.');
  }
  if (!categoriaValida) return indefinido('Categoria de operação de IBS/CBS inválida.');
  // Alíneas a–c: mesmo prazo para não optantes e Simples (§1º, II).
  // Categoria não é inferida do uso da internet; alíneas e–h não têm contrato aqui.
  let inicio = '2027-03-01';
  if (!marcoEspecial) {
    if (!categoria) {
      if (!simples && dia >= '2027-03-01') return resultado('OBRIGATORIO',
        'Todos os prazos das hipóteses cobertas já iniciaram; a categoria não permite identificar a data inicial exata.');
      return indefinido('O contador precisa classificar a operação no perfil: serviço sujeito ao ISS ou hipótese legal de plataforma digital.');
    }
    inicio = simples ? '2027-01-01' : '2026-10-01';
  }
  // Calendário documental apenas: não resolve opção de apuração nem homologa XML.
  // O verificador de XML também consome estado: não exigir bloco do Simples2027
  // sem contrato homologado para seu enquadramento. inicio registra só o prazo legal.
  if (simples && dia >= inicio) return resultado('INDETERMINADO',
    'O prazo documental do Simples iniciou, mas o enquadramento de IBS/CBS em 2027 precisa de conferência; este contrato não resolve a opção de apuração.', inicio);
  return resultado(dia >= inicio ? 'OBRIGATORIO' : 'FACULTATIVO',
    `Prazo aplicável à categoria de operação: ${inicio}.`, inicio);
}
