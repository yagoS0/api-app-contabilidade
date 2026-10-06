import { correlacaoDoItem, itemLc116DoCodigoNacional } from "../../fiscal/ibscbs/index.js";
import { validarCodigosRtc, TABELAS_RTC } from "../../fiscal/ibscbs/tabelasRtc.js";
import { nbsPorCodigo, nbsParaDps } from "../../fiscal/nbs/index.js";
import { validarTributacaoMunicipal } from "../tributacaoMunicipalDoPerfil.js";

export function sugestoesDoPerfil(company) {
  const codigos = company?.codigosServicoNacional?.length
    ? company.codigosServicoNacional : [company?.codigoServicoNacional].filter(Boolean);
  return {
    fonte: "NFS-e Nacional — Anexo VIII v1.01.00 e tabela NBS versionados no sistema",
    url: "https://www.gov.br/nfse/pt-br/biblioteca/documentacao-tecnica",
    orientacao: "O Anexo VIII é orientativo. Outras combinações das tabelas oficiais podem ser declaradas conforme a operação.",
    tabelasRtc: {
      consultadoEm: TABELAS_RTC.consultadoEm,
      classificacoes: TABELAS_RTC.classificacoes.filter(c => c.nfse),
      operacoes: TABELAS_RTC.operacoes,
    },
    porServico: [...new Set(codigos)].map((codigo) => {
      const r = correlacaoDoItem(itemLc116DoCodigoNacional(codigo));
      return { codigo, descricao: r.descricao ?? null, combinacoes: r.combinacoes,
        nbs: r.nbs.map(nbsPorCodigo).filter((n) => n && nbsParaDps(n.codigo).ok) };
    }),
  };
}

// Valida o estado final, incluindo valores preservados por PATCH parcial.
export function validarCatalogoPerfil(perfil) {
  const erros = validarTributacaoMunicipal(perfil);
  if (perfil.codigoNbs && !nbsParaDps(perfil.codigoNbs).ok) {
    erros.push({ campo: "codigoNbs", motivo: "Selecione um código NBS terminal existente na tabela oficial." });
  }
  erros.push(...validarCodigosRtc({ cIndOp: perfil.ibscbsCIndOp,
    cst: perfil.ibscbsCst, cClassTrib: perfil.ibscbsCClassTrib }));
  return erros;
}
