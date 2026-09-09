import { prisma } from "../../infrastructure/db/prisma.js";
import { INTEGRACAO_PERFIL_EMISSAO_NFSE } from "../../config.js";
import { resolverPerfilDeEmissao } from "./perfilEmissao/resolverPerfilDeEmissao.js";
import { resolverOpSimpNac, resolverTpRetIssqn, RESOLUCAO } from "./dpsCodigos.js";
import { escolherCodigoServicoNacional } from "./codigoServicoDaNota.js";
import { pAliqDaDps } from "./pAliqDaDps.js";

const informado = v => v !== null && v !== undefined && String(v).trim() !== "";
const numero = v => informado(v) && Number.isFinite(Number(v)) ? Number(v) : null;
const recusa = (motivo, mensagem, pendencias = [], extra = {}) => ({ ok: false, motivo, mensagem, pendencias, encaminharEscritorio: true, ...extra });

// Espelho da escolha do portal (features/emitir/lib/aliquotaEfetiva.js), amarrado por teste.
// A fonte é DAS do extrato / receita autorizada; pagamento e imposto sobre folha não entram.
export function escolherAliquotaEfetivaDaSerie(serie, competencia) {
  const linhas = (Array.isArray(serie) ? serie : []).filter(l => Number(l?.dasExtrato) > 0 && Number(l?.faturamento) > 0 && l?.deReceita !== null && l?.deReceita !== undefined && l?.deReceita !== "" && Number.isFinite(Number(l.deReceita)));
  const exata = linhas.find(l => l.competencia === competencia);
  const escolhida = exata || linhas.slice().sort((a, b) => String(b.competencia).localeCompare(String(a.competencia)))[0];
  return escolhida ? { valor: Number(escolhida.deReceita), competencia: escolhida.competencia, exata: Boolean(exata) } : { valor: null, competencia: null, exata: false };
}

function competenciaNormalizada(valor, agora) {
  const bruto = valor instanceof Date ? (Number.isNaN(valor.getTime()) ? "" : valor.toISOString().slice(0, 10))
    : informado(valor) ? String(valor).trim()
      : new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" }).format(agora);
  const m = /^(\d{4})-(\d{2})(?:-(\d{2}))?$/.exec(bruto);
  if (!m) return null;
  const [ano, mes, dia] = [Number(m[1]), Number(m[2]), Number(m[3] || 1)];
  const data = new Date(Date.UTC(ano, mes - 1, dia));
  if (ano < 1000 || data.getUTCFullYear() !== ano || data.getUTCMonth() !== mes - 1 || data.getUTCDate() !== dia) return null;
  return { valor: bruto, mes: bruto.slice(0, 7), assumida: !informado(valor) };
}

async function serieDaReceita(client, portalClientId, competencia) {
  const [ano, mes] = competencia.split("-").map(Number);
  const competencias = Array.from({ length: 6 }, (_, i) => {
    const d = new Date(Date.UTC(ano, mes - 6 + i, 1));
    return d.toISOString().slice(0, 7);
  });
  const circulares = await client.companyMonthlyCircular.findMany({
    where: { portalClientId, competencia: { in: competencias } }, select: { competencia: true, dasTotal: true },
  });
  const das = new Map(circulares.map(c => [c.competencia, numero(c.dasTotal)]));
  return Promise.all(competencias.map(async comp => {
    const [y, m] = comp.split("-").map(Number);
    const notas = await client.portalInvoice.aggregate({
      where: { clientId: portalClientId, papel: "EMIT", statusEfetivo: "autorizada", competencia: { gte: new Date(Date.UTC(y, m - 1, 1)), lt: new Date(Date.UTC(y, m, 1)) } },
      _sum: { total: true },
    });
    const faturamento = numero(notas?._sum?.total);
    const dasExtrato = das.get(comp) ?? null;
    return { competencia: comp, faturamento, dasExtrato, deReceita: faturamento > 0 && dasExtrato !== null ? Number(((dasExtrato / faturamento) * 100).toFixed(2)) : null };
  }));
}

/** Só lê cadastro e histórico local. Não reserva numeração, não grava pendência e não emite. */
export async function prepararDadosFiscaisDoCliente({ portalClientId, perfilId = null, competencia = null, servico = {}, pTotTribSN = null } = {}, {
  client = prisma, resolverPerfil = resolverPerfilDeEmissao, perfisHabilitados = INTEGRACAO_PERFIL_EMISSAO_NFSE, agora = new Date(),
} = {}) {
  const pid = String(portalClientId || "").trim();
  if (!pid) return recusa("CADASTRO_FISCAL_INDISPONIVEL", "Não encontrei o cadastro fiscal da empresa. O escritório precisa conferir.");
  const comp = competenciaNormalizada(competencia, agora);
  if (!comp) return recusa("COMPETENCIA_INVALIDA", "Informe uma competência válida para a nota.", ["competencia"], { encaminharEscritorio: false });
  try {
    const portal = await client.portalClient.findUnique({ where: { id: pid }, select: { id: true, companyId: true } });
    if (!portal?.companyId) return recusa("CADASTRO_FISCAL_INDISPONIVEL", "O escritório precisa conferir o cadastro fiscal desta empresa.");
    const [company, cadastro] = await Promise.all([
      client.company.findUnique({ where: { id: portal.companyId }, select: { id: true, regimeTributario: true, codigoServicoNacional: true, codigosServicoNacional: true, codigoMunicipioIbge: true, pTotTribFed: true, pTotTribEst: true, pTotTribMun: true } }),
      client.cadastroFiscal.findUnique({ where: { portalClientId: pid }, select: { regime: true } }),
    ]);
    if (!company) return recusa("CADASTRO_FISCAL_INDISPONIVEL", "O escritório precisa conferir o cadastro fiscal desta empresa.");
    const regimeBruto = cadastro?.regime || company.regimeTributario || null;
    const resolucao = resolverOpSimpNac(regimeBruto);
    if (resolucao.resolucao !== RESOLUCAO.RESOLVIDO) return recusa("NFSE_REGIME_INDEFINIDO", "O escritório precisa confirmar o regime tributário da empresa antes de montar a nota.", ["regime"]);
    const regime = { ...resolucao, rotuloDeclarado: String(regimeBruto), exigePTotTribSN: resolucao.opSimpNac === "3" };
    let perfil = null;
    if (!perfisHabilitados && perfilId) return recusa("NFSE_PERFIL_INDISPONIVEL", "Os perfis de emissão estão desabilitados. O escritório precisa conferir a configuração.", ["perfilId"]);
    if (perfisHabilitados) {
      const r = await resolverPerfil({ portalClientId: pid, perfilId, exigirDisponibilidade: true });
      if (typeof r?.temPerfil !== "boolean" || !Number.isInteger(r?.perfisAtivos) || (r.perfisAtivos === 1 && !r.temPerfil)) return recusa("NFSE_PERFIL_INDISPONIVEL", "Não consegui conferir os perfis de emissão. O escritório precisa verificar a configuração.", ["perfilId"]);
      if (!perfilId && r.perfisAtivos > 1) {
        const perfis = await client.perfilEmissaoNfse.findMany({ where: { portalClientId: pid, ativo: true }, select: { id: true, nome: true, codigoServicoNacional: true }, orderBy: { nome: "asc" } });
        return recusa("ESCOLHER_PERFIL_EMISSAO", "Escolha o tipo de serviço entre os configurados pelo contador.", ["perfilId"], { encaminharEscritorio: false, perfis });
      }
      if (perfilId && (!r.temPerfil || r.perfil?.id !== perfilId)) return recusa("NFSE_PERFIL_INDISPONIVEL", "O perfil escolhido não está mais disponível nesta empresa. O escritório precisa conferir.", ["perfilId"]);
      perfil = r.temPerfil ? r.perfil : null;
    }
    const escolhaCodigo = escolherCodigoServicoNacional({ escolhido: perfil?.codigoServicoNacional || servico.codigoServicoNacional, lista: company.codigosServicoNacional, singular: company.codigoServicoNacional });
    if (!escolhaCodigo.ok || !escolhaCodigo.codigo) return recusa(escolhaCodigo.ok ? "NFSE_CODIGO_SERVICO_AUSENTE" : escolhaCodigo.codigo, "O escritório precisa conferir o código de serviço cadastrado antes de montar a nota.", ["codigoServicoNacional"]);
    const aliquota = numero(informado(perfil?.pAliq) ? perfil.pAliq : servico.aliquota);
    const retencao = resolverTpRetIssqn(servico.issRetido === true);
    const aliquotaDps = pAliqDaDps({ opSimpNac: regime.opSimpNac, regApTribSN: perfil?.regApTribSN || "1", tpRetISSQN: retencao.tpRetISSQN, aliquota });
    if (!aliquotaDps.ok) return recusa(aliquotaDps.codigo, "Há retenção de ISS nesta nota e o escritório precisa conferir a alíquota configurada antes de continuar.", ["aliquota"]);
    if (retencao.exigeAliquota && !(aliquota > 0)) return recusa("NFSE_ISS_RETIDO_SEM_ALIQUOTA", "Há retenção de ISS nesta nota e o escritório precisa conferir a alíquota configurada antes de continuar.", ["aliquota"]);
    const origens = {
      regime: { fonte: cadastro?.regime ? "CADASTRO_FISCAL" : "COMPANY" },
      perfil: { fonte: perfil ? "PERFIL" : "COMPANY", id: perfil?.id || null },
      aliquota: { fonte: informado(perfil?.pAliq) ? "PERFIL" : informado(servico.aliquota) ? "PEDIDO" : "AUSENTE", perfilId: informado(perfil?.pAliq) ? perfil.id : null },
      codigoServicoNacional: { fonte: perfil?.codigoServicoNacional ? "PERFIL" : servico.codigoServicoNacional ? "PEDIDO" : "COMPANY" },
      competencia: { fonte: comp.assumida ? "DATA_DO_ATENDIMENTO" : "PEDIDO" },
    };
    const avisos = [];
    let percentualSimples = null;
    let cargaTributaria = null;
    if (regime.exigePTotTribSN) {
      if (informado(pTotTribSN)) {
        percentualSimples = numero(pTotTribSN);
        origens.pTotTribSN = { fonte: "PEDIDO", competencia: comp.mes, exata: null };
      } else {
        const serie = await serieDaReceita(client, pid, comp.mes);
        const escolha = escolherAliquotaEfetivaDaSerie(serie, comp.mes);
        percentualSimples = escolha.valor;
        const base = serie.find(l => l.competencia === escolha.competencia);
        origens.pTotTribSN = { fonte: "EXTRATO_PGDASD", competencia: escolha.competencia, exata: escolha.exata, dasExtrato: base?.dasExtrato ?? null, faturamento: base?.faturamento ?? null };
        if (escolha.valor !== null && !escolha.exata) avisos.push(`A carga do Simples usa o extrato de ${escolha.competencia}; é a última competência apurada disponível, diferente da competência da nota (${comp.mes}). Confira no resumo antes de confirmar.`);
      }
      if (percentualSimples === null || percentualSimples < 0 || percentualSimples > 100) return recusa("NFSE_ALIQUOTA_SIMPLES_INDISPONIVEL", "Não há uma alíquota do Simples válida para preencher esta nota. O escritório precisa conferir; você não precisa calcular nem informar percentuais.", ["pTotTribSN"]);
    } else {
      cargaTributaria = {};
      for (const campo of ["pTotTribFed", "pTotTribEst", "pTotTribMun"]) {
        const valor = numero(company[campo]);
        if (valor === null && campo === "pTotTribEst" && !informado(company[campo])) {
          cargaTributaria[campo] = 0;
          origens[campo] = { fonte: "REGRA_SERVICO_SEM_ICMS" };
        } else if (valor === null || valor < 0 || valor > 100) return recusa("MISSING_TOT_TRIB_NAO_SIMPLES", "O escritório precisa completar a carga tributária cadastrada antes de montar a nota. Você não precisa informar percentuais.", [campo]);
        else { cargaTributaria[campo] = valor; origens[campo] = { fonte: "COMPANY" }; }
      }
      origens.pTotTribSN = { fonte: "NAO_APLICAVEL" };
    }
    const localDoPerfil = informado(perfil?.cLocPrestacao) ? String(perfil.cLocPrestacao) : null;
    return {
      ok: true, competencia: comp.valor, perfil, regime, pTotTribSN: percentualSimples, cargaTributaria, origens, avisos, aliquotaDps,
      servico: { ...servico, codigoServicoNacional: escolhaCodigo.codigo, aliquota, issRetido: servico.issRetido === true, ...(localDoPerfil ? { cLocPrestacao: localDoPerfil } : {}) },
    };
  } catch {
    return recusa("DADOS_FISCAIS_INDISPONIVEIS", "Não consegui conferir a configuração fiscal da empresa agora. O escritório precisa verificar antes de montar a nota.");
  }
}
