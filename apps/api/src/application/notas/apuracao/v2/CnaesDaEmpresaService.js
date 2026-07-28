// Resolve os CNAEs de uma empresa — principal + secundários — a partir da fonte certa.
//
// POR QUE ISTO EXISTE
// A rota do cadastro fiscal já declarava a regra: "Regime + CNAE são do CADASTRO DA EMPRESA
// (fonte única, editados na aba Editar Cadastro). SEMPRE sobrepõe esses campos com os do Company."
// O ClassificadorService, porém, lia SÓ o `CadastroFiscal`. Como esse registro só nasce quando o
// contador salva a aba fiscal, empresas que nunca passaram por lá ficavam sem CNAE NENHUM na
// classificação — mesmo com principal e secundários preenchidos no cadastro da empresa.
// Em produção isso era 15 de 19 empresas.
//
// Os secundários importam de verdade: o classificador consolida a sugestão de anexo sobre o
// conjunto (principal + secundários). Uma empresa de apoio administrativo que também tem
// "administração de obras" e "serviços de engenharia" nos secundários é um caso completamente
// diferente de quem só tem o primeiro.

import { prisma } from "../../../../infrastructure/db/prisma.js";

// Os CNAEs são gravados em formatos diferentes conforme a origem: a consulta ao CNPJ grava só
// dígitos ("7112000") e o preenchimento manual costuma vir formatado com a descrição junto
// ("82.19-9-99 - Preparação de documentos…"). `CnaeAnexo` é chaveada por 7 dígitos, então
// normalizar é obrigatório — e os 7 PRIMEIROS dígitos são sempre o código, mesmo quando a
// descrição traz números depois.
export function normalizarCnae(valor) {
  const digitos = String(valor || "").replace(/\D+/g, "").slice(0, 7);
  return digitos.length === 7 ? digitos : null;
}

/**
 * @returns {{ principal: string|null, secundarios: string[], todos: string[], origem: "cadastro_fiscal"|"company"|"nenhuma" }}
 */
export async function resolverCnaesDaEmpresa(portalClientId, { cadastroFiscal } = {}) {
  const vazio = { principal: null, secundarios: [], todos: [], origem: "nenhuma" };
  if (!portalClientId) return vazio;

  const montar = (principalRaw, secundariosRaw, origem) => {
    const principal = normalizarCnae(principalRaw);
    const secundarios = [...new Set(
      (secundariosRaw || []).map(normalizarCnae).filter(Boolean).filter((c) => c !== principal),
    )];
    const todos = [principal, ...secundarios].filter(Boolean);
    return todos.length ? { principal, secundarios, todos, origem } : vazio;
  };

  // 1) CadastroFiscal, quando existe e tem CNAE — é onde o contador edita o dado fiscal.
  const cadastro = cadastroFiscal !== undefined
    ? cadastroFiscal
    : await prisma.cadastroFiscal.findUnique({
        where: { portalClientId },
        select: { cnaePrincipal: true, cnaesSecundarios: true },
      }).catch(() => null);
  if (cadastro?.cnaePrincipal) {
    const r = montar(cadastro.cnaePrincipal, cadastro.cnaesSecundarios, "cadastro_fiscal");
    if (r.todos.length) return r;
  }

  // 2) Cadastro da empresa (Company) — a fonte que a própria rota do cadastro fiscal já usa
  //    para sobrepor regime/CNAE. Sem este passo, empresa sem CadastroFiscal fica sem CNAE.
  const portal = await prisma.portalClient.findUnique({
    where: { id: portalClientId },
    select: { companyId: true },
  }).catch(() => null);
  if (!portal?.companyId) return vazio;

  const company = await prisma.company.findUnique({
    where: { id: portal.companyId },
    select: { cnaePrincipal: true, cnaesSecundarios: true },
  }).catch(() => null);
  if (!company?.cnaePrincipal) return vazio;

  return montar(company.cnaePrincipal, company.cnaesSecundarios, "company");
}
