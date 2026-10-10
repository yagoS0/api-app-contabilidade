// Regras do bloco IBS/CBS da DPS 1.01, verificadas antes de reservar numeração.
// Anexo VIII é orientativo; domínio e compatibilidade vêm das tabelas oficiais.

import { validarCodigosRtc, classificacaoRtc } from "../fiscal/ibscbs/tabelasRtc.js";
import { RECUSA_NBS, nbsParaDps } from "../fiscal/nbs/index.js";

/** ⚠ Único valor de `TSRTCFinNFSe` no XSD 1.01. */
export const FIN_NFSE_REGULAR = "0";
/** Padrão sem destinatário distinto; dadosEspeciaisDaNota trata o caso indDest=1. */
export const IND_DEST_E_O_TOMADOR = "0";

/** Forma do XSD; existência e compatibilidade são conferidas na tabela SVRS abaixo. */
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
 * @param {object|null} p.perfil
 * @param {boolean} p.ligado   `INTEGRACAO_NFSE_IBSCBS`
 * @param {string|null} p.cNBS o `cNBS` já resolvido por `nbsDaDps` — a E0322 se confere aqui
 * @param {string|Date} p.competencia data da prestação para conferir a vigência publicada
 */
export function ibscbsDaDps({ perfil, ligado, cNBS, competencia, obrigacao }) {
  const cIndOp = texto(perfil?.ibscbsCIndOp);
  const cst = texto(perfil?.ibscbsCst);
  const cClassTrib = texto(perfil?.ibscbsCClassTrib);
  const declarados = [cIndOp, cst, cClassTrib].filter(Boolean).length;

  if (obrigacao?.estado === 'INDETERMINADO') return {
    ok: false, codigo: 'NFSE_IBSCBS_ENQUADRAMENTO_PENDENTE', message: obrigacao.motivo,
    correcao: 'O escritório precisa conferir o enquadramento e a competência antes de emitir.',
  };
  if (obrigacao?.estado === 'OBRIGATORIO' && (!ligado || declarados === 0)) return {
    ok: false, codigo: !ligado ? 'NFSE_IBSCBS_OBRIGATORIO_DESLIGADO' : 'NFSE_IBSCBS_OBRIGATORIO_AUSENTE',
    message: 'IBS/CBS é obrigatório para esta operação e competência, mas não seria informado na nota.',
    correcao: !ligado ? 'Habilite e valide a integração de IBS/CBS antes de emitir esta operação.' : 'Complete NBS, indicador da operação, CST e classificação tributária no perfil de emissão.',
  };

  // ⚠⚠ A FLAG DESLIGADA NÃO É "IGNORE EM SILÊNCIO" QUANDO HÁ DADO. Perfil sem nada declarado é o
  // caso de 100% das linhas hoje, e ali não há o que dizer. Mas um perfil COM os três campos
  // preenchidos e a flag OFF é uma configuração que o contador fez e que não está saindo — o
  // `motivo` existe para o painel poder dizer isso, em vez de o campo sumir sem explicação.
  if (!ligado) {
    return { ok: true, informar: false, motivo: declarados ? "INTEGRACAO_DESLIGADA" : null };
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
      correcao: "Complete os três campos de IBS/CBS no perfil. A omissão só é admitida quando não houver obrigação para a operação.",
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
        "Informe o código NBS no perfil de emissão. Não apague IBS/CBS para contornar uma obrigação fiscal.",
    };
  }

  const [erro] = validarCodigosRtc({ cIndOp, cst, cClassTrib, competencia });
  if (erro) return {
    ok: false, codigo: erro.codigo, message: erro.motivo,
    correcao: "Confira os códigos nas tabelas oficiais de IBS/CBS e no Anexo C da NFS-e Nacional.",
  };

  return {
    ok: true,
    informar: true,
    bloco: Object.freeze({
      finNFSe: FIN_NFSE_REGULAR,
      cIndOp,
      indDest: IND_DEST_E_O_TOMADOR,
      cst,
      cClassTrib,
    }),
  };
}

/** Relação explícita na tabela SVRS; nunca escolhe o enquadramento nem altera o XML. */
export function cstSugeridoPeloClassTrib(cClassTrib) {
  const classe = classificacaoRtc(texto(cClassTrib));
  if (!classe?.nfse) return null;
  return Object.freeze({ cst: classe.cst, verificadoNaFonte: true,
    motivo: "Relação CST/cClassTrib publicada na tabela oficial SVRS, consultada em 05/10/2026." });
}
