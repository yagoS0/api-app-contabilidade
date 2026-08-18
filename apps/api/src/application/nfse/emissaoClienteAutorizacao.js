// QUEM PODE EMITIR (E CANCELAR) NFS-e PELO LADO DO CLIENTE — a regra, pura.
//
// ⚠ O QUE ESTAVA MEDIDO ANTES DISTO EXISTIR. `POST /nfse/issue` e `POST /nfse/:chave/eventos` são
// os dois ATOS FISCAIS do sistema, e os dois autorizavam por `ensureLegacyCompanyAccess` — que é
// checagem de **VÍNCULO**, não de permissão: `listAccessibleLegacyCompanyIds` inclui todo
// `CompanyClientUser` com `status: "ACTIVE"`, sem olhar papel. Ou seja, qualquer membro ativo do
// lado do cliente, inclusive o de menor peso, alcançava a emissão. Não havia flag, não havia papel
// mínimo, não havia nada que o contador ligasse ou desligasse.
//
// ⚠ E O CAMINHO ESTÁ LIGADO EM PRODUÇÃO (medido em 18/08/2026): `NFSE_ENV=producao`,
// `NFSE_BASE_URL=https://sefin.nfse.gov.br/SefinNacional` e 1 `ServiceInvoice` `issued` com chave.
// Errar aqui produz nota fiscal de verdade.
//
// Decisão do dono (18/08/2026): *"o acesso a emissão deve ser liberado para o cliente pelo portal
// do contador"*, com DUAS guardas independentes:
//   1. uma chave POR EMPRESA (`PortalClient.emissaoClienteLiberada`), que só o contador liga;
//   2. um PAPEL MÍNIMO do lado do cliente, para que o papel mais fraco não emita nem com a
//      empresa liberada.
// Uma sem a outra não serve: só a flag deixaria o FINANCEIRO emitir na empresa liberada; só o
// papel tiraria do contador a decisão de liberar (ou não) aquele cliente.
//
// ⚠ MESMA REGRA PARA CANCELAR. Emitir e cancelar são os dois atos da mesma tela, e duas regras
// divergem na primeira correção.
//
// Esta função é PURA de propósito (nenhum Prisma, nenhum `res`): quem lê o banco e responde HTTP é
// `routes/middlewares/emissaoNfseGate.js`.

/**
 * Pesos dos papéis do CLIENTE, copiados de `apps/api/CLAUDE.md` (e de
 * `middlewares/requireClientCompanyAccess.js`, que é quem gateia o resto do portal do cliente).
 * `CLIENT_USER` é legado — não é ofertado no app do cliente — e vale o mesmo que `FINANCEIRO`.
 */
export const PESO_PAPEL_CLIENTE = Object.freeze({
  OWNER: 3,
  CLIENT_ADMIN: 2,
  FINANCEIRO: 1,
  CLIENT_USER: 1,
});

/**
 * ⚠ O MÍNIMO É `CLIENT_ADMIN` POR PRECEDENTE, NÃO POR INVENÇÃO.
 *
 * Este projeto já decidiu, antes desta entrega, que três coisas do lado do cliente exigem
 * `CLIENT_ADMIN`: **pró-labore**, **certificado A1** e **sócios** (regra escrita no `CLAUDE.md` da
 * raiz e no de `apps/api`). Emitir nota fiscal em nome da empresa, contra o sistema nacional, em
 * produção, é pelo menos tão grave quanto qualquer uma das três — subir a barra acima disso
 * (exigir `OWNER`) inventaria uma régua que o projeto não usa em lugar nenhum a não ser em GESTÃO
 * DE USUÁRIOS; descer abaixo entregaria o ato fiscal ao papel que existe para conferir guia.
 */
export const PAPEL_MINIMO_EMISSAO = "CLIENT_ADMIN";

export const CODIGO_NAO_LIBERADA = "EMISSAO_CLIENTE_NAO_LIBERADA";
export const CODIGO_PAPEL_INSUFICIENTE = "EMISSAO_CLIENTE_PAPEL_INSUFICIENTE";

function normalizarPapel(valor) {
  return String(valor || "").trim().toUpperCase();
}

export function pesoDoPapelCliente(papel) {
  return PESO_PAPEL_CLIENTE[normalizarPapel(papel)] || 0;
}

/**
 * Decide se um pedido de emissão/cancelamento pode seguir.
 *
 * @param {object} entrada
 * @param {boolean} entrada.ladoEscritorio  usuário admin-like OU com `CompanyFirmAccess` ATIVO
 * @param {boolean} entrada.empresaLiberada `PortalClient.emissaoClienteLiberada`
 * @param {string|null} entrada.papelCliente `CompanyClientUser.role` (nulo = sem vínculo de cliente)
 * @returns {{ok: true, via: string} | {ok: false, codigo: string, motivos: string[], papel: string|null, papelMinimo: string, message: string, correcao: string}}
 */
export function decidirEmissaoCliente({ ladoEscritorio = false, empresaLiberada = false, papelCliente = null } = {}) {
  // ⚠ `=== true`, NUNCA truthy. É a disciplina que este projeto já aplica a `semFaturamento` e a
  // toda coluna tri-estado, e aqui ela vale mais: `Boolean("false")` é `true`, e uma autorização
  // que se abre por coerção de tipo é a que ninguém revisa. O chamador coage o valor vindo do
  // banco (a coluna é BOOLEAN NOT NULL), mas a regra pura não pode depender disso — ela é o que
  // um chamador futuro vai reusar sem ler o chamador atual.
  const liberada = empresaLiberada === true;
  // ⚠ REGRA 1, E ELA VEM PRIMEIRO: o usuário do ESCRITÓRIO passa SEMPRE, sem consultar a flag.
  // O contador emite hoje — foi por esse caminho que a nota real de 17/08/2026 saiu — e uma chave
  // que o próprio contador liga não pode ser pré-requisito para ele mesmo trabalhar. Quebrar isto é
  // a regressão mais cara desta entrega.
  if (ladoEscritorio) {
    return { ok: true, via: "ESCRITORIO" };
  }

  const papel = normalizarPapel(papelCliente) || null;
  const peso = pesoDoPapelCliente(papel);
  const pesoMinimo = PESO_PAPEL_CLIENTE[PAPEL_MINIMO_EMISSAO];
  const papelSuficiente = peso >= pesoMinimo;

  if (liberada && papelSuficiente) {
    return { ok: true, via: "CLIENTE_AUTORIZADO" };
  }

  // ⚠ A RECUSA NOMEIA O MOTIVO, SEMPRE. Um 403 mudo faz o cliente ligar para o escritório sem que
  // nenhum dos dois saiba o que houve — e os dois problemas têm conserto DIFERENTE: "a empresa não
  // foi liberada" é um clique do contador; "seu papel não alcança" é uma troca de papel (ou a
  // pessoa certa fazendo a emissão). Um código só faria os dois virarem o mesmo telefonema.
  //
  // ⚠ Quando as DUAS faltam, o `codigo` nomeia a da EMPRESA (é a guarda de fora, e é a que o
  // contador resolve) — mas `motivos` traz as duas. Nomear só uma esconderia a outra e produziria
  // a segunda recusa logo depois do primeiro conserto.
  const motivos = [];
  if (!liberada) motivos.push(CODIGO_NAO_LIBERADA);
  if (!papelSuficiente) motivos.push(CODIGO_PAPEL_INSUFICIENTE);

  const codigo = !liberada ? CODIGO_NAO_LIBERADA : CODIGO_PAPEL_INSUFICIENTE;

  const message = !liberada
    ? "A emissão de NFS-e por usuários do cliente não está liberada para esta empresa."
    : papel
      ? `O papel ${papel} não alcança a emissão de NFS-e desta empresa.`
      : "Seu usuário não tem papel cadastrado nesta empresa.";

  const correcao = !liberada
    ? "Peça ao escritório de contabilidade que libere a emissão desta empresa no cadastro dela."
    : `A emissão exige o papel ${PAPEL_MINIMO_EMISSAO} ou superior. Peça ao responsável da empresa (OWNER) que ajuste seu papel, ou que a emissão seja feita por quem já o tem.`;

  return {
    ok: false,
    codigo,
    motivos,
    papel,
    papelMinimo: PAPEL_MINIMO_EMISSAO,
    empresaLiberada: liberada,
    message,
    correcao,
  };
}
