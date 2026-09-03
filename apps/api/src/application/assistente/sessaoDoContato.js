// A IDENTIDADE DO CLIENTE DENTRO DE UM TURNO — quem é a pessoa por trás do número, e o que ela pode.
//
// Pura. Recebe o que o vínculo já resolveu (`resolverVinculoPorTelefone` → o contato e o
// `vinculoRbac`) e devolve a SESSÃO que as ferramentas usam como escopo e como papel.
//
// ⚠⚠ VÍNCULO NÃO É AUTORIZAÇÃO, E PAPEL NUNCA É PRESUMIDO. O número identifica a EMPRESA; quem
// identifica a PESSOA é `contatos_whatsapp.userId`, e o papel sai de `CompanyClientUser.role` — o
// MESMO RBAC das rotas do cliente (`requireClientCompanyAccess(minRole)`). Contato sem `userId`,
// ou com vínculo inativo, tem papel NULO: a IA responde que o número está cadastrado mas ainda não
// ligado a um acesso, e não faz nada que exija papel — nem listar guias.
//
// ⚠ Os pesos são os de `emissaoClienteAutorizacao.PESO_PAPEL_CLIENTE` — a mesma tabela que decide a
// emissão. Uma segunda tabela aqui divergiria na primeira correção.

import { pesoDoPapelCliente, PAPEL_MINIMO_EMISSAO } from "../nfse/emissaoClienteAutorizacao.js";

/** O piso das leituras financeiras do cliente (guias, notas, fluxo): membro ATIVO, qualquer papel. */
export const PAPEL_MINIMO_LEITURA = "FINANCEIRO";
/** Situação fiscal (quadro societário): o mesmo piso da rota do cliente. */
export const PAPEL_MINIMO_SITUACAO_FISCAL = "CLIENT_ADMIN";
export { PAPEL_MINIMO_EMISSAO };

export const MOTIVOS_SEM_SESSAO = Object.freeze({
  SEM_EMPRESA: "SEM_EMPRESA",
  SEM_PESSOA: "SEM_PESSOA",
  VINCULO_INATIVO: "VINCULO_INATIVO",
});

/**
 * @param {object} p
 * @param {string|null} p.portalClientId  a empresa do fio (`conversa.portalClientId`)
 * @param {object|null} p.contato  o contato que casou com o número (com `userId`)
 * @param {{role:string, status:string}|null} p.vinculoRbac  `CompanyClientUser` da pessoa nesta empresa
 * @returns {{ok:boolean, portalClientId:string|null, userId:string|null, papel:string|null, motivo:string|null, contatoNome:string|null}}
 */
export function sessaoDoContato({ portalClientId, contato, vinculoRbac } = {}) {
  const base = { portalClientId: portalClientId ? String(portalClientId) : null, userId: null, papel: null, contatoNome: contato?.nome || null };
  if (!base.portalClientId) return { ...base, ok: false, motivo: MOTIVOS_SEM_SESSAO.SEM_EMPRESA };
  if (!contato?.userId) return { ...base, ok: false, motivo: MOTIVOS_SEM_SESSAO.SEM_PESSOA };
  if (!vinculoRbac || vinculoRbac.status !== "ACTIVE") {
    return { ...base, userId: String(contato.userId), ok: false, motivo: MOTIVOS_SEM_SESSAO.VINCULO_INATIVO };
  }
  return { ...base, ok: true, userId: String(contato.userId), papel: String(vinculoRbac.role || "").toUpperCase() || null, motivo: null };
}

/** `papel` alcança `minimo`? Pela MESMA tabela de pesos da emissão. Papel nulo nunca alcança nada. */
export function papelAlcanca(papel, minimo) {
  if (!papel) return false;
  return pesoDoPapelCliente(papel) >= pesoDoPapelCliente(minimo);
}

/** A frase fixa para quem escreveu sem sessão — dita ao cliente, uma vez por turno. */
export function fraseSemSessao(motivo) {
  if (motivo === MOTIVOS_SEM_SESSAO.SEM_EMPRESA) {
    return "Não reconheci este número em nenhuma empresa. O escritório vai conferir o cadastro e responder por aqui.";
  }
  if (motivo === MOTIVOS_SEM_SESSAO.VINCULO_INATIVO) {
    return "Seu número está cadastrado, mas o acesso ligado a ele não está ativo nesta empresa. O escritório resolve — enquanto isso, não consigo consultar nada por aqui.";
  }
  return "Seu número está cadastrado na empresa, mas ainda não ligado a um acesso do portal. O escritório resolve isso — enquanto isso, não consigo consultar nada por aqui.";
}
