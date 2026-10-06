import { valorEmCentavos } from './pendenciasSitfis.js';

export const FONTES_MANUAIS = { MUNICIPAL: 'Municipal', ESTADUAL: 'Estadual', RFB: 'Receita Federal', PGFN: 'Dívida ativa — PGFN' };
export const TIPOS_PENDENCIA = { DEBITO: 'Débito', OBRIGACAO: 'Obrigação', PARCELAMENTO: 'Parcelamento', OUTRO: 'Outro registro' };
export const ESTADOS_MANUAIS = { ABERTO: 'Em aberto', SUSPENSO: 'Suspenso', PARCELADO: 'Parcelado', PAGO: 'Pago', CONFERIR: 'A conferir' };
export const CAMPOS_VALOR = { original: 'Valor original', saldo: 'Saldo devedor', multa: 'Multa', juros: 'Juros', total: 'Total informado' };

// A mesma validação atende formulário, mock e servidor. Valores são texto BR na entrada,
// centavos inteiros no armazenamento; vazio nunca vira zero.
export function validarPendenciaManual(entrada = {}) {
  const erro = mensagem => { throw Object.assign(new Error(mensagem), { status: 400 }); };
  if (!entrada || typeof entrada !== 'object' || Array.isArray(entrada)) erro('Dados do lançamento inválidos.');
  const texto = (campo, limite, obrigatorio = false) => {
    if (entrada[campo] != null && typeof entrada[campo] !== 'string') erro(`Campo inválido: ${campo}.`);
    const v = (entrada[campo] || '').trim();
    if ((obrigatorio && !v) || v.length > limite) erro(`Preencha ${campo} com até ${limite} caracteres.`);
    return v || null;
  };
  if (!Object.hasOwn(FONTES_MANUAIS, entrada.fonte)) erro('Selecione a origem.');
  if (!Object.hasOwn(TIPOS_PENDENCIA, entrada.tipo)) erro('Selecione o tipo.');
  if (!Object.hasOwn(ESTADOS_MANUAIS, entrada.estado)) erro('Selecione a situação.');
  const dados = { fonte: entrada.fonte, tipo: entrada.tipo, estado: entrada.estado,
    tributo: texto('tributo', 120, true), orgao: texto('orgao', 160),
    competencia: texto('competencia', 7), inscricao: texto('inscricao', 120), observacoes: texto('observacoes', 2000) };
  if (dados.competencia && !/^(?:(?:0[1-9]|1[0-2])\/)?\d{4}$/.test(dados.competencia)) erro('Use MM/AAAA ou AAAA na competência.');
  for (const campo of ['vencimento', 'dataReferencia']) {
    const valor = texto(campo, 10, campo === 'dataReferencia');
    if (valor && (!/^\d{4}-\d{2}-\d{2}$/.test(valor) || !Number.isFinite(Date.parse(valor)) || new Date(valor).toISOString().slice(0, 10) !== valor)) erro('Informe uma data válida.');
    dados[campo] = valor;
  }
  for (const [campo, label] of Object.entries(CAMPOS_VALOR)) {
    const valor = texto(campo, 24);
    const centavos = valor == null ? null : valorEmCentavos(valor);
    if (valor != null && (centavos == null || centavos < 0 || centavos > 999999999999)) erro(`${label}: use um valor positivo no formato 1.234,56.`);
    dados[campo] = centavos;
  }
  return dados;
}

export function projetarPendenciaManual(item) {
  const d = item.dados;
  return { ...d, id: `manual:${item.id}`, manual: item, titulo: d.tributo,
    situacao: ESTADOS_MANUAIS[d.estado], vencimento: d.vencimento?.split('-').reverse().join('/'),
    evidencia: { registro: { Órgão: d.orgao, 'Data de referência': d.dataReferencia, Observações: d.observacoes || '—' }, anotacoes: {}, descricao: [], anotacoesBloco: [] } };
}
