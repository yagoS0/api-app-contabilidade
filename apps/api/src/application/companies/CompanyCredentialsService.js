// COFRE DE CREDENCIAIS DA EMPRESA — gov.br, e-CAC, prefeitura, portal do banco, INSS.
//
// Escritório de contabilidade guarda credencial de cliente; a necessidade é real e legítima. O que
// não se assume de passagem é a SENHA: em claro no banco ela vira responsabilidade permanente, e
// este projeto tem LGPD como item nomeado.
//
// ⚠ A CIFRA NÃO É NOVA E NÃO PODE SER. `encryptSecret`/`decryptSecret` (`utils/crypto.js`) já são
// AES-256-GCM com envelope encryption via AWS KMS (`KmsCertVault.js`) quando `isKmsEnabled()`, e
// chave derivada de `CERT_SECRET_KEY` quando não — com detecção de formato pelo prefixo, o que faz
// a migração ser LAZY. É o MESMO caminho do certificado A1. Um segundo caminho de cifra aqui seria
// a segunda cópia da regra mais perigosa do sistema, e as duas divergiriam na primeira correção.
//
// ── AS TRÊS INVARIANTES DESTE ARQUIVO ──────────────────────────────────────────────────────────
//
// 1. A SENHA NUNCA VOLTA NUMA LISTAGEM. `listar()` usa `select` EXPLÍCITO sem `senhaCifrada` — não
//    é `omit`, não é `delete` depois de buscar. `select` é o que sobrevive a alguém acrescentar um
//    campo: um `delete obj.senhaCifrada` esquecido num caminho novo vaza em silêncio, um `select`
//    que não pede a coluna não tem como vazar. A listagem diz que a senha EXISTE (`temSenha`) e
//    quando mudou; ver o valor é outra rota, com outro papel e com auditoria.
//
// 2. A SENHA NUNCA ENTRA EM LOG NEM EM MENSAGEM DE ERRO. Nenhuma função deste arquivo escreve em
//    console/logger, e `CompanyCredentialError` só carrega texto escrito à mão aqui.
//
// 3. TODA REVELAÇÃO É GRAVADA. `revelarSenha` grava `CompanyCredentialAcesso` ANTES de decifrar —
//    ver o comentário na função. Sem isso, credencial vazada é irrastreável.

import { prisma } from "../../infrastructure/db/prisma.js";
import { encryptSecret, decryptSecret } from "../../utils/crypto.js";
import { isKmsEnabled } from "../../infrastructure/security/KmsCertVault.js";

/**
 * O nível de proteção REAL deste ambiente, para a tela dizer em vez de o usuário supor.
 *
 * ⚠ Isto não é enfeite. Sem KMS, a chave-mestra do cofre é uma VARIÁVEL DE AMBIENTE
 * (`CERT_SECRET_KEY`): quem tiver acesso ao painel de deploy tem acesso a todas as senhas. Com
 * KMS, a master key vive no HSM da AWS e o que viaja no banco é uma DEK cifrada por ela. São dois
 * níveis de proteção diferentes, e quem vai guardar a primeira senha precisa saber qual está
 * valendo ANTES de digitar — não depois.
 *
 * ⚠ NÃO DEVOLVE NENHUM SEGREDO — nem o id da chave, nem a região, nem prefixo de valor. Só o
 * booleano e um rótulo.
 */
export function estadoDoCofre() {
  const kms = isKmsEnabled();
  return {
    kms,
    algoritmo: "AES-256-GCM",
    rotulo: kms
      ? "Envelope encryption com AWS KMS (chave-mestra no HSM da AWS)"
      : "Chave derivada de CERT_SECRET_KEY (variável de ambiente do servidor)",
  };
}

// ⚠⚠ DECISÃO DE SEGURANÇA Nº 1 — QUEM VÊ. LEVADA AO DONO, NÃO RESOLVIDA NO DEFAULT PERMISSIVO.
//
// Os papéis do escritório são FIRM_ADMIN(3) > ACCOUNTANT(2) > STAFF(1) (`requireFirmCompanyAccess`).
// O default aqui é o RESTRITIVO, e mudá-lo é trocar UMA constante — de propósito: a escolha é do
// dono, e o custo de errar para o lado frouxo (senha de cliente na mão de quem não precisava) não
// se desfaz, enquanto o de errar para o lado apertado é um pedido de acesso.
//
//   PAPEL_MINIMO_VER_LISTA  = ACCOUNTANT  · saber QUE existe credencial do gov.br já é informação
//   PAPEL_MINIMO_REVELAR    = FIRM_ADMIN  · ver o VALOR
//   PAPEL_MINIMO_ESCREVER   = ACCOUNTANT  · criar/editar/apagar
//   PAPEL_MINIMO_INFO_*     = STAFF/ACCOUNTANT · "outras informações" não são segredo
//
// ⚠ O APP DO CLIENTE NÃO TEM NENHUMA ROTA PARA ISTO, e não é esquecimento: as rotas vivem sob
// `/firm/`, atrás de `requireFirmCompanyAccess`. `CLIENT: OWNER|CLIENT_ADMIN|FINANCEIRO` não
// alcança nenhuma delas. Expor a senha do cliente no portal DELE é decisão do dono, não default.
export const PAPEL_MINIMO_VER_LISTA = "ACCOUNTANT";
export const PAPEL_MINIMO_REVELAR = "FIRM_ADMIN";
export const PAPEL_MINIMO_ESCREVER = "ACCOUNTANT";
export const PAPEL_MINIMO_INFO_LER = "STAFF";
export const PAPEL_MINIMO_INFO_ESCREVER = "ACCOUNTANT";

// ⚠ `select` EXPLÍCITO — ver a invariante 1 no topo. `senhaCifrada` NÃO está aqui e não deve entrar.
const SELECT_SEM_SENHA = {
  id: true,
  rotulo: true,
  login: true,
  observacao: true,
  senhaAtualizadaEm: true,
  criadoPorId: true,
  atualizadoPorId: true,
  createdAt: true,
  updatedAt: true,
};

export const ACOES_AUDITORIA = ["REVELADA", "CRIADA", "ATUALIZADA", "SENHA_ALTERADA", "REMOVIDA"];

export class CompanyCredentialError extends Error {
  constructor(code, message, status = 400) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

function textoObrigatorio(valor, campo) {
  const v = String(valor ?? "").trim();
  if (!v) throw new CompanyCredentialError(`${campo}_vazio`, `O campo "${campo}" não pode ficar vazio.`);
  return v;
}

function textoOpcional(valor) {
  const v = String(valor ?? "").trim();
  return v || null;
}

/**
 * Grava o rastro. É `best-effort` em UM caso só (ver `revelarSenha`), e obrigatório no resto.
 * ⚠ Nada da senha entra aqui — nem claro, nem cifrado, nem hash, nem comprimento.
 */
async function registrarAcesso(tx, { portalClientId, credentialId, acao, rotuloNoMomento, ator }) {
  return tx.companyCredentialAcesso.create({
    data: {
      portalClientId,
      credentialId: credentialId || null,
      acao,
      rotuloNoMomento,
      usuarioId: ator?.id || null,
      usuarioEmail: ator?.email || null,
      motivo: textoOpcional(ator?.motivo),
      ip: textoOpcional(ator?.ip),
      userAgent: textoOpcional(ator?.userAgent)?.slice(0, 300) || null,
    },
  });
}

// ── Credenciais ────────────────────────────────────────────────────────────────────────────────

/**
 * A listagem. Diz que a senha EXISTE, nunca qual é.
 *
 * `temSenha` é derivado do `select` de contagem, não do valor: pedir `senhaCifrada` só para fazer
 * `Boolean(...)` traria o blob para dentro do processo sem necessidade nenhuma.
 */
export async function listar({ portalClientId }) {
  const linhas = await prisma.companyCredential.findMany({
    where: { portalClientId },
    select: { ...SELECT_SEM_SENHA, _count: { select: { acessos: true } } },
    orderBy: [{ rotulo: "asc" }, { createdAt: "desc" }],
  });

  // Uma query para o conjunto, não uma por linha: `temSenha` é a única coisa que a listagem
  // precisa saber sobre a senha, e `count` responde isso sem trazer a coluna.
  const comSenha = await prisma.companyCredential.findMany({
    where: { portalClientId, senhaCifrada: { not: null } },
    select: { id: true },
  });
  const idsComSenha = new Set(comSenha.map((c) => c.id));

  return linhas.map(({ _count, ...c }) => ({
    ...c,
    temSenha: idsComSenha.has(c.id),
    vezesRevelada: _count?.acessos ?? 0,
  }));
}

export async function criar({ portalClientId, rotulo, login, senha, observacao, ator }) {
  const rotuloFinal = textoObrigatorio(rotulo, "rotulo").slice(0, 120);
  const senhaTexto = String(senha ?? "");
  // ⚠ A cifra acontece ANTES da transação, de propósito: `encryptSecret` faz I/O de rede quando o
  // KMS está ligado (GenerateDataKey), e I/O dentro de `$transaction` segura conexão do pool pelo
  // tempo da chamada externa.
  const senhaCifrada = senhaTexto ? await encryptSecret(senhaTexto) : null;

  return prisma.$transaction(async (tx) => {
    const cred = await tx.companyCredential.create({
      data: {
        portalClientId,
        rotulo: rotuloFinal,
        login: textoOpcional(login),
        senhaCifrada,
        observacao: textoOpcional(observacao),
        criadoPorId: ator?.id || null,
        atualizadoPorId: ator?.id || null,
        senhaAtualizadaEm: senhaCifrada ? new Date() : null,
      },
      select: SELECT_SEM_SENHA,
    });
    await registrarAcesso(tx, {
      portalClientId, credentialId: cred.id, acao: "CRIADA", rotuloNoMomento: cred.rotulo, ator,
    });
    return { ...cred, temSenha: Boolean(senhaCifrada), vezesRevelada: 0 };
  });
}

/**
 * Edição parcial. Só toca o que veio — mesma disciplina do PUT de `EntregaObrigacaoArquivo`:
 * trocar o rótulo não pode apagar a senha, e trocar a senha não pode apagar a observação.
 *
 * ⚠ `senha: undefined` (campo ausente) NÃO mexe na senha. `senha: ""` APAGA a senha. Os dois casos
 * são distintos e a rota precisa preservar essa distinção — colapsá-los num `if (senha)` faria o
 * "apagar a senha" ser impossível, e um `if (senha !== undefined)` sem o ramo do vazio gravaria
 * uma senha vazia cifrada, que é pior: a listagem diria que existe senha.
 */
export async function atualizar({ portalClientId, credentialId, rotulo, login, senha, observacao, ator }) {
  const atual = await prisma.companyCredential.findFirst({
    where: { id: credentialId, portalClientId },
    select: { id: true, rotulo: true },
  });
  if (!atual) throw new CompanyCredentialError("credencial_nao_encontrada", "Credencial não encontrada.", 404);

  const data = { atualizadoPorId: ator?.id || null };
  if (rotulo !== undefined) data.rotulo = textoObrigatorio(rotulo, "rotulo").slice(0, 120);
  if (login !== undefined) data.login = textoOpcional(login);
  if (observacao !== undefined) data.observacao = textoOpcional(observacao);

  let senhaMudou = false;
  if (senha !== undefined) {
    const senhaTexto = String(senha ?? "");
    senhaMudou = true;
    data.senhaCifrada = senhaTexto ? await encryptSecret(senhaTexto) : null;
    data.senhaAtualizadaEm = senhaTexto ? new Date() : null;
  }

  return prisma.$transaction(async (tx) => {
    const cred = await tx.companyCredential.update({
      where: { id: atual.id },
      data,
      select: SELECT_SEM_SENHA,
    });
    await registrarAcesso(tx, {
      portalClientId,
      credentialId: cred.id,
      // A troca de senha tem ação própria: "quando esta senha mudou pela última vez" é pergunta
      // diferente de "quando alguém editou o rótulo", e no histórico elas não podem se confundir.
      acao: senhaMudou ? "SENHA_ALTERADA" : "ATUALIZADA",
      rotuloNoMomento: cred.rotulo,
      ator,
    });
    const temSenha = senhaMudou
      ? Boolean(data.senhaCifrada)
      : (await tx.companyCredential.count({ where: { id: cred.id, senhaCifrada: { not: null } } })) > 0;
    return { ...cred, temSenha };
  });
}

export async function remover({ portalClientId, credentialId, ator }) {
  const atual = await prisma.companyCredential.findFirst({
    where: { id: credentialId, portalClientId },
    select: { id: true, rotulo: true },
  });
  if (!atual) throw new CompanyCredentialError("credencial_nao_encontrada", "Credencial não encontrada.", 404);

  return prisma.$transaction(async (tx) => {
    // A auditoria é gravada ANTES do delete: a FK é ON DELETE SET NULL, então a linha sobrevive
    // com `credentialId` nulo e `rotuloNoMomento` preenchido — que é o desenho de `estornos_baixa`
    // (o registro tem de sobreviver ao sumiço daquilo que ele explica).
    await registrarAcesso(tx, {
      portalClientId, credentialId: atual.id, acao: "REMOVIDA", rotuloNoMomento: atual.rotulo, ator,
    });
    await tx.companyCredential.delete({ where: { id: atual.id } });
    return { id: atual.id, rotulo: atual.rotulo };
  });
}

/**
 * ⚠ A ÚNICA porta pela qual uma senha sai deste sistema.
 *
 * Três guardas, nesta ordem:
 *
 * 1. `confirmado === true` no corpo. Mostrar senha é ato de consequência — a rota não pode ser
 *    disparada por um clique distraído nem por um GET repetido pelo navegador. É o mesmo idioma de
 *    `totalConferido` no estorno: o cliente precisa afirmar o que está fazendo.
 * 2. Multi-tenancy: o `findFirst` casa `id` E `portalClientId`. Credencial de outra empresa
 *    responde 404, não 403 — 403 confirmaria que o id existe em algum lugar.
 * 3. AUDITORIA GRAVADA ANTES DE DECIFRAR, e em transação PRÓPRIA, commitada antes da decifra.
 *    Se fosse depois, uma falha do KMS (ou um crash) deixaria a leitura sem rastro; se estivesse na
 *    mesma transação da decifra não haveria transação nenhuma — decifrar não escreve. Gravar antes
 *    tem um custo conhecido e aceito: uma tentativa que falha na decifra fica registrada como
 *    revelação. Registrar a mais é o erro barato; registrar a menos é o que a tabela existe para
 *    impedir.
 */
export async function revelarSenha({ portalClientId, credentialId, confirmado, ator }) {
  if (confirmado !== true) {
    throw new CompanyCredentialError(
      "CONFIRMACAO_OBRIGATORIA",
      "Ver uma senha é registrado em auditoria. Confirme a ação para continuar.",
      400,
    );
  }

  const cred = await prisma.companyCredential.findFirst({
    where: { id: credentialId, portalClientId },
    select: { id: true, rotulo: true, login: true, senhaCifrada: true },
  });
  if (!cred) throw new CompanyCredentialError("credencial_nao_encontrada", "Credencial não encontrada.", 404);
  if (!cred.senhaCifrada) {
    throw new CompanyCredentialError(
      "sem_senha",
      "Esta credencial foi cadastrada sem senha — não há valor para mostrar.",
      404,
    );
  }

  const acesso = await registrarAcesso(prisma, {
    portalClientId, credentialId: cred.id, acao: "REVELADA", rotuloNoMomento: cred.rotulo, ator,
  });

  const senha = await decryptSecret(cred.senhaCifrada);
  if (senha === null) {
    // `decryptSecret` devolve null quando o KMS está indisponível, a chave foi revogada ou o blob
    // está corrompido — ele não distingue os três, e o app não deve derrubar por isso. O que a
    // mensagem NÃO pode fazer é dizer "senha errada": o segredo pode estar íntegro do outro lado
    // de uma indisponibilidade momentânea.
    throw new CompanyCredentialError(
      "SEGREDO_ILEGIVEL",
      "Não foi possível decifrar esta senha agora. Se o problema persistir, o valor precisa ser cadastrado de novo.",
      503,
    );
  }

  return { id: cred.id, rotulo: cred.rotulo, login: cred.login, senha, acessoId: acesso.id };
}

/** O histórico do cofre desta empresa — quem viu o quê e quando. Nunca traz valor nenhum. */
export function listarAcessos({ portalClientId, limite = 100 }) {
  return prisma.companyCredentialAcesso.findMany({
    where: { portalClientId },
    orderBy: { createdAt: "desc" },
    take: Math.min(Math.max(Number(limite) || 100, 1), 500),
  });
}

// ── "Outras informações" — texto livre por rótulo, NÃO cifrado ─────────────────────────────────
//
// ⚠ Separadas das credenciais em tabela, em rota e em seção da tela. Um `secreto: boolean` numa
// estrutura só faria a natureza do dado ser escolhida DEPOIS de digitar, e a pessoa que erra o
// checkbox grava segredo em claro achando que guardou no cofre.

export function listarInfos({ portalClientId }) {
  return prisma.companyInfo.findMany({
    where: { portalClientId },
    orderBy: [{ rotulo: "asc" }, { createdAt: "desc" }],
  });
}

export function criarInfo({ portalClientId, rotulo, valor, ator }) {
  return prisma.companyInfo.create({
    data: {
      portalClientId,
      rotulo: textoObrigatorio(rotulo, "rotulo").slice(0, 120),
      valor: textoObrigatorio(valor, "valor"),
      criadoPorId: ator?.id || null,
    },
  });
}

export async function atualizarInfo({ portalClientId, infoId, rotulo, valor }) {
  const atual = await prisma.companyInfo.findFirst({ where: { id: infoId, portalClientId }, select: { id: true } });
  if (!atual) throw new CompanyCredentialError("informacao_nao_encontrada", "Informação não encontrada.", 404);

  const data = {};
  if (rotulo !== undefined) data.rotulo = textoObrigatorio(rotulo, "rotulo").slice(0, 120);
  if (valor !== undefined) data.valor = textoObrigatorio(valor, "valor");
  return prisma.companyInfo.update({ where: { id: atual.id }, data });
}

export async function removerInfo({ portalClientId, infoId }) {
  const atual = await prisma.companyInfo.findFirst({ where: { id: infoId, portalClientId }, select: { id: true } });
  if (!atual) throw new CompanyCredentialError("informacao_nao_encontrada", "Informação não encontrada.", 404);
  await prisma.companyInfo.delete({ where: { id: atual.id } });
  return { id: atual.id };
}
