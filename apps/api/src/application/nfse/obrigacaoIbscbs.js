// Ato Conjunto RFB/CGIBS 4/2026, art. 1º, III e §1º.
// Fontes e limites: docs/nfse-correcoes-prioritarias-2026-10-10.md.
// Não consulta rede nem confunde aceitação do XML com dispensa de obrigação.
export const VERSAO_OBRIGACAO_IBSCBS = 'ato-4-2026-revisao-2026-10-10';
export const CATEGORIAS_IBSCBS = ['SERVICO_ISS', 'PLATAFORMA_DIGITAL'];
const DEZEMBRO = new Set(['0103', '0105', '0109', '1601']);

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
  if (opSimpNac !== '1') {
    if (dia < '2027-01-01') return resultado('FACULTATIVO', 'Prazo do Simples ainda não iniciado pelo Ato 4/2026.', '2027-01-01');
    return indefinido('O enquadramento do Simples para IBS/CBS em 2027 precisa de conferência; este contrato não resolve a opção de apuração.');
  }
  if (dia < '2026-10-01') return resultado('FACULTATIVO', 'Anterior ao primeiro prazo de NFS-e do Ato 4/2026.');
  const codigo = String(codigoServico ?? '');
  if (!/^\d{6}$/.test(codigo) || Number(codigo.slice(0, 2)) < 1 || Number(codigo.slice(0, 2)) > 40) {
    return indefinido('Este fornecimento exige classificação fiscal específica antes de determinar o prazo de IBS/CBS.');
  }
  if (categoria != null && !CATEGORIAS_IBSCBS.includes(categoria)) return indefinido('Categoria de operação de IBS/CBS inválida.');
  // A partir de dezembro, ambas as categorias cobertas estão no prazo.
  // Antes disso não presumir que um serviço comum está fora da hipótese de plataforma.
  let inicio = '2026-12-01';
  if (!DEZEMBRO.has(codigo.slice(0, 4)) && categoria !== 'PLATAFORMA_DIGITAL') {
    if (!categoria && dia < inicio) return indefinido('O contador precisa classificar a operação no perfil: serviço sujeito ao ISS ou hipótese legal de plataforma digital.');
    if (categoria === 'SERVICO_ISS') inicio = '2026-10-01';
  }
  return resultado(dia >= inicio ? 'OBRIGATORIO' : 'FACULTATIVO',
    `Prazo aplicável à categoria de operação: ${inicio}.`, inicio);
}
