// Módulo Fiscal (Aba Fiscal / Bloco A) — resolve o "perfil fiscal" da empresa:
// a lista pequena de atividades permitidas, derivada dos CNAEs do cadastro.
//
// Reusa CnaeAnexo (cnae → tipoReceitaSugerido + ambiguo) e o mesmo mapa
// TipoReceita → Anexo do MotorApuracaoService. NÃO chama SERPRO.
//
// O resultado (candidatos por CNAE, com a config editável do contador mesclada)
// é a ENTRADA do motor de sugestão de anexo (§1.3): restringe os candidatos ao
// conjunto de 1–10 CNAEs da empresa, eliminando ambiguidade em runtime.

import { prisma } from "../../../../infrastructure/db/prisma.js";
import { sujeitoAoFatorR, RESPOSTA as RESPOSTA_FATOR_R } from "../../../planejamento/lib/sujeitoAoFatorR.js";

// TipoReceita → Anexo. SERVICO_FATOR_R decide III↔V mensalmente pelo Fator R;
// RECEITA_NAO_CLASSIFICADA nunca chuta (vai pra revisão).
const TIPO_RECEITA_PARA_ANEXO = {
  REVENDA_MERCADORIA: "I",
  INDUSTRIALIZACAO: "II",
  SERVICO_ANEXO_III: "III",
  SERVICO_ANEXO_IV: "IV",
  SERVICO_ANEXO_V: "V",
};

/**
 * Deriva o anexo (ou o rótulo) a partir do TipoReceita sugerido pelo CNAE.
 * @returns {{ anexo: string|null, anexoLabel: string, sujeitoFatorR: boolean, revisao: boolean }}
 */
export function anexoDeTipoReceita(tipoReceita) {
  const tipo = String(tipoReceita || "");
  if (tipo === "SERVICO_FATOR_R") {
    return { anexo: null, anexoLabel: "III ou V (Fator R)", sujeitoFatorR: true, revisao: false };
  }
  if (tipo === "RECEITA_NAO_CLASSIFICADA" || !tipo) {
    return { anexo: null, anexoLabel: "—", sujeitoFatorR: false, revisao: true };
  }
  const anexo = TIPO_RECEITA_PARA_ANEXO[tipo] || null;
  return { anexo, anexoLabel: anexo ? `Anexo ${anexo}` : "—", sujeitoFatorR: false, revisao: !anexo };
}

const onlyDigits = (v) => String(v || "").replace(/\D+/g, "");

/**
 * Coleta os CNAEs efetivos da empresa (CadastroFiscal → senão Company/CNPJ) e a config salva.
 */
async function coletarCnaesEConfig(portalClientId) {
  const cadastro = await prisma.cadastroFiscal.findUnique({
    where: { portalClientId },
    select: { cnaePrincipal: true, cnaesSecundarios: true, regime: true, usaFatorR: true, perfilAtividades: true },
  });

  let cnaePrincipal = cadastro?.cnaePrincipal ? onlyDigits(cadastro.cnaePrincipal) : "";
  let cnaesSecundarios = Array.isArray(cadastro?.cnaesSecundarios)
    ? cadastro.cnaesSecundarios.map(onlyDigits).filter(Boolean)
    : [];
  let regime = cadastro?.regime || null;
  const usaFatorR = Boolean(cadastro?.usaFatorR);
  const config = Array.isArray(cadastro?.perfilAtividades) ? cadastro.perfilAtividades : [];
  const temCadastro = Boolean(cadastro);

  // Sem CadastroFiscal salvo → prefill dos CNAEs do Company (dados do CNPJ), como faz a rota GET /cadastro-fiscal.
  if (!cnaePrincipal) {
    const pc = await prisma.portalClient.findUnique({ where: { id: portalClientId }, select: { companyId: true } });
    const company = pc?.companyId
      ? await prisma.company.findUnique({
          where: { id: pc.companyId },
          select: { cnaePrincipal: true, cnaesSecundarios: true, regimeTributario: true, optanteSimples: true },
        }).catch(() => null)
      : null;
    if (company?.cnaePrincipal) {
      cnaePrincipal = onlyDigits(company.cnaePrincipal);
      cnaesSecundarios = (company.cnaesSecundarios || []).map(onlyDigits).filter(Boolean);
      if (!regime) {
        const raw = String(company.regimeTributario || "").toUpperCase();
        regime = /PRESUMID/.test(raw) ? "LUCRO_PRESUMIDO"
          : /REAL/.test(raw) ? "LUCRO_REAL"
          : /MEI/.test(raw) ? "MEI"
          : "SIMPLES_NACIONAL";
      }
    }
  }

  return { cnaePrincipal, cnaesSecundarios, regime, usaFatorR, config, temCadastro };
}

/**
 * Resolve o perfil fiscal (Bloco A) da empresa.
 *
 * @returns {Promise<{ regime, usaFatorR, temCadastro, temFatorR, candidatos: Array }>}
 *   candidatos = [{ cnae, descricao, tipoReceita, anexo, anexoLabel, sujeitoFatorR, ambiguo,
 *                   impeditivo, isPrincipal, ativo, padrao, aliquotaIss, codigoServicoMunicipal,
 *                   retencaoFonte, domicilioFiscal, obs }]
 */
export async function resolverPerfilFiscal({ portalClientId }) {
  if (!portalClientId) throw new Error("portalClientId obrigatório");
  const { cnaePrincipal, cnaesSecundarios, regime, usaFatorR, config, temCadastro } =
    await coletarCnaesEConfig(portalClientId);

  // CNAEs únicos, principal primeiro.
  const ordenados = [cnaePrincipal, ...cnaesSecundarios].map(onlyDigits).filter((c) => c.length >= 7).map((c) => c.slice(0, 7));
  const unicos = [...new Set(ordenados)];

  const refs = unicos.length
    ? await prisma.cnaeAnexo.findMany({
        where: { cnae: { in: unicos } },
        select: { cnae: true, descricao: true, tipoReceitaSugerido: true, ambiguo: true },
      })
    : [];
  const refByCnae = new Map(refs.map((r) => [r.cnae, r]));
  const configByCnae = new Map(
    (Array.isArray(config) ? config : [])
      .filter((c) => c && c.cnae)
      .map((c) => [onlyDigits(c.cnae).slice(0, 7), c])
  );

  const candidatos = unicos.map((cnae, idx) => {
    const ref = refByCnae.get(cnae) || null;
    const tipoReceita = ref?.tipoReceitaSugerido || null;
    const { anexo, anexoLabel, sujeitoFatorR, revisao } = anexoDeTipoReceita(tipoReceita);
    const cfg = configByCnae.get(cnae) || {};
    // Default: atividade ativa; sem match no catálogo CNAE → impeditivo/revisão sinalizado.
    return {
      cnae,
      descricao: ref?.descricao || (cfg.obs ? String(cfg.obs) : "CNAE não catalogado — revisar"),
      tipoReceita,
      anexo,
      anexoLabel,
      sujeitoFatorR,
      ambiguo: Boolean(ref?.ambiguo),
      // "impeditivo": sem tipoReceita conhecido = precisa de decisão manual (não é vedação legal formal).
      impeditivo: !ref,
      revisao,
      isPrincipal: idx === 0,
      // Config editável do contador (Bloco A) — defaults quando ausente.
      ativo: cfg.ativo === undefined ? true : Boolean(cfg.ativo),
      padrao: Boolean(cfg.padrao),
      aliquotaIss: cfg.aliquotaIss ?? null,
      codigoServicoMunicipal: cfg.codigoServicoMunicipal ?? null,
      retencaoFonte: cfg.retencaoFonte ?? null,
      domicilioFiscal: cfg.domicilioFiscal ?? null,
      obs: cfg.obs ?? null,
    };
  });

  // ⚠⚠ A DERIVAÇÃO DO FATOR R MORA EM `planejamento/lib/sujeitoAoFatorR.js`, e é CHAMADA — não
  // repetida. O Planejamento faz a mesma pergunta sobre a mesma empresa, e duas implementações
  // divergiriam na primeira correção: era exatamente esse o defeito relatado pelo dono (o Perfil
  // dizia "III ou V (Fator R) — sim" e o Planejamento mostrava o checkbox desmarcado).
  //
  // ⚠ E ELA CONSERTA UM DEFEITO DAQUI: o `temFatorR` anterior era um `if (sujeitoFatorR) … = true`
  // dentro do laço, ANTES de `cfg.ativo` ser lido — uma atividade que o contador DESATIVOU
  // continuava forçando o Fator R da empresa inteira.
  const fatorR = sujeitoAoFatorR({ atividades: candidatos, usaFatorRCadastro: usaFatorR, temCadastro });

  return {
    regime,
    usaFatorR,
    temCadastro,
    // ⚠ `temFatorR` MANTIDO no contrato (a tela já o consome), agora derivado da regra. Só `sim`
    // vira `true` — `indefinido` NÃO é `true` nem é `false` afirmado, e quem quiser a distinção lê
    // `fatorR.resposta`.
    temFatorR: fatorR.resposta === RESPOSTA_FATOR_R.SIM,
    // A resposta inteira, com origem, motivo e a divergência entre perfil e cadastro.
    fatorR,
    candidatos,
  };
}

/**
 * Valida/normaliza o array de config do perfil vindo do PUT (Bloco A).
 * Mantém só campos conhecidos; ignora ruído.
 */
export function normalizarPerfilConfig(perfilAtividades) {
  if (!Array.isArray(perfilAtividades)) return [];
  return perfilAtividades
    .filter((c) => c && c.cnae)
    .map((c) => ({
      cnae: onlyDigits(c.cnae).slice(0, 7),
      ativo: c.ativo === undefined ? true : Boolean(c.ativo),
      padrao: Boolean(c.padrao),
      aliquotaIss: c.aliquotaIss === "" || c.aliquotaIss == null ? null : Number(c.aliquotaIss),
      codigoServicoMunicipal: c.codigoServicoMunicipal ? String(c.codigoServicoMunicipal) : null,
      retencaoFonte: c.retencaoFonte == null ? null : Boolean(c.retencaoFonte),
      domicilioFiscal: c.domicilioFiscal ? String(c.domicilioFiscal) : null,
      obs: c.obs ? String(c.obs) : null,
    }))
    .filter((c) => c.cnae.length >= 7);
}
