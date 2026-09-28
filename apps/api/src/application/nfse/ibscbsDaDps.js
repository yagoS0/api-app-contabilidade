import { CATALOGO_IBSCBS, validarCodigosIbscbs, classificacaoPorCodigo } from "../fiscal/ibscbs/catalogoOficial.js";
import { RECUSA_NBS, nbsParaDps } from "../fiscal/nbs/index.js";
import { exigenciaIbscbs } from './exigenciaIbscbs.js';

/** ⚠ Único valor de `TSRTCFinNFSe` no XSD 1.01. */
export const FIN_NFSE_REGULAR = "0";
/** Tomador como destinatário; dadosEspeciaisDaNota muda para 1 se houver dest. */
export const IND_DEST_E_O_TOMADOR = "0";

/** Forma XSD. A existência e o vínculo com cClassTrib são conferidos no catálogo. */
const FORMA_CST = /^[0-9]{3}$/;

const texto = (v) => {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t === "" ? null : t;
};

/**
 * O `<cNBS>` que a DPS vai levar — ou a recusa.
 *
 * ⚠ NÃO DECLARADO É O ESTADO NORMAL, e não é erro: a coluna nasceu nula em todo perfil, e enquanto
 * ninguém preencher, nenhuma nota ganha `cNBS`. É o mesmo desenho do resto do perfil — o campo
 * nasce desligado pelo DADO, não por uma flag.
 */
export function nbsDaDps(perfil) {
  const declarado = texto(perfil?.codigoNbs);
  if (!declarado) return { ok: true, informar: false, cNBS: null };

  const r = nbsParaDps(declarado);
  if (r.ok) return { ok: true, informar: true, cNBS: r.cNBS, codigo: r.codigo };

  // ⚠⚠ "NÃO TERMINAL" GANHA MENSAGEM PRÓPRIA. `1.0101` é código publicado e correto — ele só
  // identifica uma FAMÍLIA. Dizer "inválido" mandaria o contador procurar erro de digitação.
  if (r.motivo === RECUSA_NBS.NAO_TERMINAL) {
    return {
      ok: false,
      codigo: "NFSE_NBS_NAO_TERMINAL",
      message:
        `O código NBS ${r.codigo} identifica uma FAMÍLIA de serviços, não um serviço. ` +
        "A DPS só aceita códigos terminais.",
      correcao:
        "Escolha um dos códigos mais específicos abaixo dele no perfil de emissão: " +
        `${r.descendentes.slice(0, 6).join(" · ")}` +
        (r.descendentes.length > 6 ? ` (e mais ${r.descendentes.length - 6})` : ""),
    };
  }
  return {
    ok: false,
    codigo: "NFSE_NBS_INVALIDO",
    message: `O código NBS declarado no perfil de emissão não está na tabela oficial: ${declarado}`,
    correcao: "Corrija o código NBS do perfil de emissão. Ele é escolhido na lista oficial da NBS 2.0.",
  };
}

/**
 * O bloco `IBSCBS` da DPS — ou a recusa, ou "não informar".
 *
 * @param {object} p
 * @param {string} p.cTribNac  o código de tributação nacional QUE A NOTA VAI LEVAR (já decidido
 *                             pelo pré-voo, nunca o payload cru)
 * @param {object|null} p.perfil
 * @param {boolean} p.ligado   `INTEGRACAO_NFSE_IBSCBS`
 * @param {string|null} p.cNBS o `cNBS` já resolvido por `nbsDaDps` — a E0322 se confere aqui
 */
export function ibscbsDaDps({ cTribNac, perfil, ligado, cNBS, dataReferencia, opSimpNac }) {
  const cIndOp = texto(perfil?.ibscbsCIndOp);
  const cst = texto(perfil?.ibscbsCst);
  const cClassTrib = texto(perfil?.ibscbsCClassTrib);
  const declarados = [cIndOp, cst, cClassTrib].filter(Boolean).length;
  const exigencia = exigenciaIbscbs({ opSimpNac, dataReferencia, cTribNac, categoria: perfil?.ibscbsCategoriaOperacao });
  if (exigencia.revisao) return { ok: false, codigo: 'NFSE_IBSCBS_ENQUADRAMENTO_PENDENTE', message: exigencia.motivo,
    correcao: 'O escritório deve revisar o enquadramento fiscal antes da emissão.' };
  if (exigencia.obrigatorio && !ligado) return { ok: false, codigo: 'NFSE_IBSCBS_INTEGRACAO_DESLIGADA', message: 'Esta operação exige IBS/CBS, mas a integração está desativada.',
    correcao: 'Habilite e homologue a integração antes da emissão. O desligamento não dispensa os tributos.' };
  if (exigencia.obrigatorio && !declarados) return { ok: false, codigo: 'NFSE_IBSCBS_OBRIGATORIO', message: 'Esta operação exige IBS/CBS e o perfil não informa a classificação.',
    correcao: 'Complete NBS, indicador da operação, CST e classificação tributária no perfil.' };

  // Dados declarados nunca são omitidos silenciosamente por uma flag desligada.
  if (!ligado) {
    return declarados ? { ok: false, codigo: 'NFSE_IBSCBS_INTEGRACAO_DESLIGADA', message: 'O perfil declara IBS/CBS, mas a integração está desativada. A emissão não pode omitir os tributos configurados.', correcao: 'Solicite ao escritório a habilitação e homologação da integração IBS/CBS.' } : { ok: true, informar: false, motivo: null };
  }
  if (declarados === 0) return { ok: true, informar: false, motivo: null };

  // ⚠ MEIO BLOCO É NOTA RECUSADA. Os três são obrigatórios no XSD (`TCRTCInfoIBSCBS` +
  // `TCRTCInfoTributosSitClas`), então declarar um e esquecer outro não pode virar XML.
  if (declarados < 3) {
    const faltando = [
      !cIndOp && "código indicador da operação (cIndOp)",
      !cst && "código de situação tributária (CST)",
      !cClassTrib && "código de classificação tributária (cClassTrib)",
    ].filter(Boolean);
    return {
      ok: false,
      codigo: "NFSE_IBSCBS_INCOMPLETO",
      message: `O bloco de IBS/CBS do perfil de emissão está incompleto: falta ${faltando.join(" e ")}.`,
      correcao: "Complete os três campos de IBS/CBS no perfil conforme a operação.",
      faltando,
    };
  }

  if (!FORMA_CST.test(cst)) {
    return {
      ok: false,
      codigo: "NFSE_IBSCBS_CST_INVALIDO",
      message: `O CST do IBS/CBS tem de ter 3 dígitos. Declarado: ${cst}`,
      correcao: "Corrija o CST no perfil de emissão.",
    };
  }

  // ⚠⚠ E0322: sem NBS, o bloco não pode sair. Recusar aqui é o que impede a nota de ir e voltar
  // rejeitada por uma regra que está no nosso disco.
  if (!cNBS) {
    return {
      ok: false,
      codigo: "NFSE_IBSCBS_SEM_NBS",
      message:
        "Declarar IBS/CBS na nota obriga a informar um item da NBS (regra E0322 do Padrão Nacional), " +
        "e o perfil de emissão não tem código NBS.",
      correcao:
        "Informe o código NBS terminal no perfil de emissão.",
    };
  }

  const erros = validarCodigosIbscbs({ cst, cClassTrib, cIndOp, dataReferencia });
  if (erros.length) return { ok: false, codigo: erros[0].codigo, message: erros[0].motivo,
    correcao: 'Revise os códigos do perfil conforme a tabela oficial e a operação realizada.', erros };
  return {
    ok: true, informar: true, catalogo: CATALOGO_IBSCBS,
    bloco: Object.freeze({ finNFSe: FIN_NFSE_REGULAR, cIndOp, indDest: IND_DEST_E_O_TOMADOR, cst, cClassTrib }),
  };
}

/** Sugestão confirmada pelo vínculo da classificação na tabela SVRS. */
export function cstSugeridoPeloClassTrib(cClassTrib) {
  const classe = classificacaoPorCodigo(texto(cClassTrib));
  return classe ? Object.freeze({ cst: classe.Cst, verificadoNaFonte: true,
    motivo: 'Correspondência publicada na tabela oficial de classificação tributária.', catalogo: CATALOGO_IBSCBS.versao }) : null;
}
