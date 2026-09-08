import { prisma } from '../../infrastructure/db/prisma.js';
import { numero, PROCEDENCIA, DIRECAO } from './lib/fluxoDeCaixa.js';

export class SaldoInicialRecusado extends Error {
  constructor(codigo, message, status = 400) {
    super(message);
    this.codigo = codigo;
    this.status = status;
  }
}

function paraTela(registro) {
  if (!registro || registro.valor == null) return null;
  return {
    versao: registro.id,
    dataReferencia: registro.dataReferencia.toISOString().slice(0, 10),
    valor: numero(registro.valor),
    origem: 'DECLARADO',
    criadoEm: registro.criadoEm?.toISOString() || null,
  };
}

export async function lerSaldoInicialFluxo(portalClientId, client = prisma) {
  // Compatibilidade com clientes de teste antigos. Prisma real sem geração não oculta o erro.
  if (!client.saldoInicialFluxo) {
    if (client === prisma) throw new SaldoInicialRecusado('saldo_indisponivel', 'Atualize a estrutura do fluxo de caixa.', 503);
    return null;
  }
  return paraTela(await client.saldoInicialFluxo.findFirst({
    where: { portalClientId: String(portalClientId) }, orderBy: { id: 'desc' },
  }));
}

export function validarSaldoInicial({ dataReferencia, valor }) {
  const data = typeof dataReferencia === 'string' ? dataReferencia : '';
  if (!/^(19|20|21)\d{2}-(0[1-9]|1[0-2])-01$/.test(data)) {
    throw new SaldoInicialRecusado('data_referencia_invalida', 'Informe o primeiro dia de um mês entre 1900 e 2199.');
  }
  const texto = (typeof valor === 'number' || typeof valor === 'string') ? String(valor).trim() : '';
  if (!/^-?\d+(\.\d{1,2})?$/.test(texto) || !Number.isFinite(Number(texto)) || Math.abs(Number(texto)) > 999999999999.99) {
    throw new SaldoInicialRecusado('saldo_invalido', 'Informe um valor de saldo com até duas casas decimais.');
  }
  return { dataReferencia: new Date(`${data}T00:00:00.000Z`), valor: texto };
}

export async function salvarSaldoInicialFluxo({ portalClientId, dataReferencia, valor, usuarioId, remover = false, client = prisma }) {
  if (!portalClientId || !usuarioId) throw new SaldoInicialRecusado('nao_autorizado', 'Acesso não autorizado.', 403);
  const dados = remover ? { dataReferencia: null, valor: null } : validarSaldoInicial({ dataReferencia, valor });
  if (!client.saldoInicialFluxo) throw new SaldoInicialRecusado('saldo_indisponivel', 'Atualize a estrutura do fluxo de caixa.', 503);
  const registro = await client.saldoInicialFluxo.create({ data: {
    portalClientId: String(portalClientId), criadoPor: String(usuarioId), ...dados,
  } });
  return paraTela(registro);
}

// Acumulado gerencial automático; os registros manuais antigos não participam.
export function inicioDoHistoricoFluxo(linhas) {
  const meses = (linhas || []).filter(l => /^\d{4}-(0[1-9]|1[0-2])$/.test(l?.competencia || '') && l.procedencia !== PROCEDENCIA.DESCONHECIDO && numero(l.valor) != null && [DIRECAO.ENTRADA,DIRECAO.SAIDA].includes(l.direcao)).map(l => l.competencia);
  return meses.length ? meses.sort()[0] : null;
}

export function aplicarSaldosProjetados({ meses, linhas }) {
  const ancora = inicioDoHistoricoFluxo(linhas);
  const porMes = new Map();
  for (const linha of linhas || []) {
    if (!ancora || !/^\d{4}-(0[1-9]|1[0-2])$/.test(linha.competencia || '') || linha.procedencia === PROCEDENCIA.DESCONHECIDO) continue;
    const valor = numero(linha.valor);
    if (valor == null || ![DIRECAO.ENTRADA,DIRECAO.SAIDA].includes(linha.direcao)) continue;
    const centavos = Math.round(valor * 100) * (linha.direcao === DIRECAO.SAIDA ? -1 : 1);
    porMes.set(linha.competencia,(porMes.get(linha.competencia) || 0) + centavos);
  }
  return (meses || []).map(mes => {
    if (!ancora || mes.competencia < ancora) return { ...mes, saldo:{inicial:null,final:null,projetado:true} };
    let saldo = 0;
    for (const [competencia,movimento] of porMes) if (competencia < mes.competencia) saldo += movimento;
    return { ...mes, saldo:{inicial:saldo/100,final:(saldo+(porMes.get(mes.competencia)||0))/100,projetado:true} };
  });
}
