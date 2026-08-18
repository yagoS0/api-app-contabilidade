// O QUE ESTA TELA PODE OFERECER — a leitura do portão de emissão, pura.
//
// ⚠ ISTO NÃO É A AUTORIZAÇÃO, E A DISTINÇÃO É O PONTO. Quem autoriza é
// `ensureEmissaoNfseAutorizada` (`apps/api/src/routes/middlewares/emissaoNfseGate.js`), no
// servidor, a cada emissão, com as MESMAS duas guardas: empresa liberada pelo contador
// (`PortalClient.emissaoClienteLiberada`) **E** papel ≥ `CLIENT_ADMIN`. Esta função existe só para
// a tela não montar um formulário que já se sabe que vai ser recusado depois de a pessoa preencher
// a nota inteira — que era exatamente o que acontecia antes de `emissaoNfseLiberada` viajar no
// `GET /client/companies`.
//
// ⚠⚠ **AUSENTE NÃO É `false`.** Um campo que não veio significa *"esta tela não recebeu o
// estado"*, e não *"o contador não liberou"*. As duas coisas têm frases diferentes e consertos
// diferentes: a primeira é um portal falando com uma API antiga (ou uma resposta que não trouxe o
// campo) e se resolve recarregando/atualizando; a segunda é um clique do contador. Dizer "peça a
// liberação ao seu contador" para uma empresa que talvez esteja liberada manda o cliente ligar
// para o escritório atrás de algo que já está feito — e o contador não encontra nada para
// consertar. É a mesma disciplina tri-estado que o projeto já aplica a `obrigatoriedadeDefis`
// (`obrigada` × `dispensada` × `indefinida`) e a `folha ausente ≠ zero`.
//
// ⚠ Nos DOIS casos o formulário não aparece — mas por razões diferentes, e a tela precisa dizer
// qual é. Não mostrar o formulário quando não se sabe não é tratar ausência como `false`: é não
// oferecer um ATO FISCAL sobre um estado que ninguém afirmou. O que seria tratar como `false` é
// **dizer** "não liberada", e é isso que `DESCONHECIDO` impede.

import { isAdminOrAbove, PAPEL_MINIMO_EMISSAO } from "../../../lib/roles";

export const ESTADO = Object.freeze({
  /** Empresa liberada e papel suficiente: o formulário aparece. */
  LIBERADO: "LIBERADO",
  /** `emissaoNfseLiberada === false` — o contador não liberou esta empresa. */
  NAO_LIBERADA: "NAO_LIBERADA",
  /** Empresa liberada, mas o papel desta pessoa não alcança `CLIENT_ADMIN`. */
  PAPEL_INSUFICIENTE: "PAPEL_INSUFICIENTE",
  /** ⚠ O campo não veio. Não se afirma nem liberada nem bloqueada. */
  DESCONHECIDO: "DESCONHECIDO",
});

/**
 * Lê o portão a partir do que `GET /client/companies` devolveu para ESTA empresa.
 *
 * @param {object|null} empresa item de `GET /client/companies`
 * @returns {{estado: string, papel: string|null, papelMinimo: string, podeEmitir: boolean}}
 */
export function lerPortaoEmissao(empresa) {
  const papel = empresa?.myRole ? String(empresa.myRole).toUpperCase() : null;
  const base = { papel, papelMinimo: PAPEL_MINIMO_EMISSAO, podeEmitir: false };

  const bruto = empresa ? empresa.emissaoNfseLiberada : undefined;
  if (bruto === undefined || bruto === null) {
    return { ...base, estado: ESTADO.DESCONHECIDO };
  }

  // ⚠ `=== true`, nunca truthy — a mesma linha que `decidirEmissaoCliente` carrega no backend.
  // `Boolean("false")` é `true`, e um portão que se abre por coerção de tipo é o que ninguém
  // revisa. Aqui vale tanto quanto lá: um `"false"` vindo de um JSON malformado abriria a tela.
  if (bruto !== true) {
    return { ...base, estado: ESTADO.NAO_LIBERADA };
  }

  if (!isAdminOrAbove(papel)) {
    return { ...base, estado: ESTADO.PAPEL_INSUFICIENTE };
  }

  return { ...base, estado: ESTADO.LIBERADO, podeEmitir: true };
}
