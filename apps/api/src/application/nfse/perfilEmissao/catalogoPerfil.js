import { correlacaoDoItem, itemLc116DoCodigoNacional } from "../../fiscal/ibscbs/index.js";
import { nbsPorCodigo, nbsParaDps } from "../../fiscal/nbs/index.js";
import { validarTributacaoMunicipal } from "../tributacaoMunicipalDoPerfil.js";
import { CATALOGO_IBSCBS, validarCodigosIbscbs } from "../../fiscal/ibscbs/catalogoOficial.js";

export function sugestoesDoPerfil(company) {
  const codigos = company?.codigosServicoNacional?.length
    ? company.codigosServicoNacional : [company?.codigoServicoNacional].filter(Boolean);
  return {
    fonte: "NFS-e Nacional — Anexo VIII v1.01.00 e tabela NBS versionados no sistema",
    url: "https://www.gov.br/nfse/pt-br/biblioteca/documentacao-tecnica",
    orientativo: true,
    catalogoValidacao: CATALOGO_IBSCBS,
    porServico: [...new Set(codigos)].map((codigo) => {
      const r = correlacaoDoItem(itemLc116DoCodigoNacional(codigo));
      return { codigo, descricao: r.descricao ?? null, combinacoes: r.combinacoes,
        nbs: r.nbs.map(nbsPorCodigo).filter((n) => n && nbsParaDps(n.codigo).ok) };
    }),
  };
}

// Valida o estado final, incluindo valores preservados por PATCH parcial.
export function validarCatalogoPerfil(perfil, dataReferencia) {
  const erros = validarTributacaoMunicipal(perfil);
  if (perfil.codigoNbs && !nbsParaDps(perfil.codigoNbs).ok) {
    erros.push({ campo: "codigoNbs", motivo: "Selecione um código NBS terminal existente na tabela oficial." });
  }
  const { ibscbsCIndOp: cIndOp, ibscbsCClassTrib: cClassTrib, ibscbsCst: cst } = perfil;
  if (cIndOp || cClassTrib || cst) {
    erros.push(...validarCodigosIbscbs({ cIndOp, cClassTrib, cst, dataReferencia }));
  }
  return erros;
}
