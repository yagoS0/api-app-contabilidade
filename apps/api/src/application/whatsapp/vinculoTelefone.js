// DE QUEM É ESTA MENSAGEM, E SOBRE QUAL EMPRESA ELA FALA?
//
// Toda mensagem que chegar pelo canal precisa dessa resposta antes de qualquer outra coisa — e ela
// NÃO PODE SER ADIVINHADA. Este módulo é a regra, e só a regra: recebe o número e os contatos JÁ
// CARREGADOS, devolve a resposta. Quem consulta o banco é `ContatoWhatsappService`. Mesma disciplina
// de `fechamentoBlockers.js`, `divergenciaDeFonte.js`, `riscoRescisao.js` e `derivacaoAnalitica.js`
// — sem prisma aqui dentro, para que teste, rota e (um dia) webhook respondam a MESMA coisa.
//
// ── AS TRÊS RESPOSTAS QUE PRECISAM TER NOME PRÓPRIO ─────────────────────────────────────────────
//
// 1. **DESCONHECIDO.** Número que não está cadastrado NÃO VIRA EMPRESA NENHUMA. Não se casa por CNPJ
//    solto, por nome, por semelhança, nem por "só existe uma empresa com esse DDD". Sem cadastro não
//    há vínculo, e isso é uma resposta — não um erro a ser contornado com heurística.
//
// 2. **AMBIGUO.** Um número pode legitimamente falar por MAIS DE UMA empresa: o sócio com três
//    CNPJs, o escritório que atende várias. Um vínculo que assume unicidade escolheria uma delas em
//    silêncio — e a nota sairia no CNPJ errado. Aqui a ambiguidade sobe nomeada, com a lista, para o
//    canal PERGUNTAR de qual empresa se trata.
//    ⚠ A ambiguidade tem DUAS naturezas independentes, e as duas viajam em `ambiguidades[]`:
//    `EMPRESA` (o número fala por mais de um CNPJ) e `PESSOA` (dentro da MESMA empresa, o número
//    casou com mais de um contato — o que a unique `(portalClientId, telefoneE164)` permite quando
//    as duas formas do nono dígito estão cadastradas em nomes diferentes).
//
// 3. **VINCULADO.** Uma empresa, e o papel de quem fala.
//
// ── ⚠ VÍNCULO NÃO É AUTORIZAÇÃO ────────────────────────────────────────────────────────────────
// Reconhecer o número diz QUEM é; não diz o que essa pessoa pode fazer. Emitir nota é ato de
// consequência, e quem decide continua sendo o RBAC de cliente que já existe
// (`CompanyClientUser.role`, gate `requireClientCompanyAccess(minRole)`). Por isso este módulo
// **devolve o papel e para aí**: não há peso, não há comparação, não há `podeEmitir`. Reimplementar
// permissão aqui criaria uma segunda resposta para a pergunta que o middleware já responde — e a
// segunda cópia é sempre a que diverge.
//
// ── ⚠ O NONO DÍGITO TEM DUAS LEITURAS, E ESTE MÓDULO NÃO ESCOLHE SOZINHO ────────────────────────
// Celular brasileiro ganhou o 9 em 2012, e a base da Meta guarda contatos nas duas formas: um número
// cadastrado como `5521999998888` pode chegar como `552199998888`. Errar aqui erra nos DOIS
// sentidos:
//   - achar que são DIFERENTES faz a mensagem legítima cair em "não vinculados" sem motivo aparente;
//   - achar que são o MESMO pode colar dois números que de fato são de pessoas diferentes — porque
//     `variantesE164` acrescenta o 9 a QUALQUER número de 8 dígitos, inclusive a um fixo
//     (`552133334444` gera `5521933334444`, um celular que pode ser de outra pessoa).
// As duas leituras estão NOMEADAS em `TOLERANCIAS` e as duas são calculadas sempre. Quando elas
// discordam, `divergemPeloNonoDigito` acende e `leituras` mostra o que cada uma respondeu — a
// discordância aparece em vez de ser decidida em silêncio. O padrão é `ESTRITA` porque, num ato de
// consequência, o erro barato é perguntar de novo e o erro caro é emitir no CNPJ de outro.

import { normalizarE164, variantesE164, somenteDigitos } from "./telefone.js";

export const SITUACOES = Object.freeze({
  /** O que chegou não dá para afirmar que é telefone. Nem começa a procurar. */
  TELEFONE_INVALIDO: "TELEFONE_INVALIDO",
  /** Número válido, nenhum cadastro. NÃO vira empresa nenhuma. */
  DESCONHECIDO: "DESCONHECIDO",
  /** Fala por mais de uma empresa. O canal tem de perguntar qual. */
  AMBIGUO: "AMBIGUO",
  /** Uma empresa, sem dúvida sobre qual. */
  VINCULADO: "VINCULADO",
});

export const TOLERANCIAS = Object.freeze({
  /** Só casa dígito a dígito. Padrão. */
  ESTRITA: "ESTRITA",
  /** Casa também a outra forma do nono dígito (`variantesE164`). */
  NONO_DIGITO: "NONO_DIGITO",
});

export const AMBIGUIDADES = Object.freeze({ EMPRESA: "EMPRESA", PESSOA: "PESSOA" });

/** Por que um contato que casou pelo número não identifica uma PESSOA com papel. */
export const MOTIVOS_SEM_PAPEL = Object.freeze({
  SEM_USUARIO: "contato não está ligado a um usuário do portal",
  SEM_VINCULO: "usuário não é membro desta empresa",
  VINCULO_INATIVO: "vínculo do usuário com a empresa não está ativo",
});

/** Por que um contato que casou pelo número foi descartado. Nada some em silêncio. */
export const MOTIVOS_DESCARTE = Object.freeze({
  CONTATO_INATIVO: "contato desativado no cadastro",
});

const alvosDaLeitura = (e164, tolerancia) =>
  tolerancia === TOLERANCIAS.NONO_DIGITO ? new Set(variantesE164(e164)) : new Set([somenteDigitos(e164)]);

/**
 * Os números de um contato, na ordem em que o vínculo os prefere.
 *
 * `waId` primeiro porque, quando ele existe, é o identificador que a PRÓPRIA Meta já devolveu para
 * aquele contato — é dado observado, não digitado.
 */
function numerosDoContato(contato) {
  return [
    { valor: somenteDigitos(contato?.waId), casouPor: "WA_ID" },
    { valor: somenteDigitos(contato?.telefoneE164), casouPor: "TELEFONE" },
  ].filter((n) => n.valor);
}

function casarContato(contato, alvos) {
  for (const { valor, casouPor } of numerosDoContato(contato)) {
    if (alvos.has(valor)) return casouPor;
  }
  return null;
}

/**
 * O papel do RBAC de cliente — LIDO, nunca decidido aqui.
 *
 * ⚠ Devolve o motivo quando não há papel. "Contato sem usuário" e "usuário que não é membro" são
 * problemas diferentes, com consertos diferentes; somi-los num `null` faria a tela (e o canal) tratar
 * um cadastro incompleto como se fosse falta de permissão.
 */
function papelDoContato(contato) {
  if (!contato?.userId) return { papelRbac: null, statusRbac: null, motivoSemPapel: MOTIVOS_SEM_PAPEL.SEM_USUARIO };
  const vinculo = contato.vinculoRbac;
  if (!vinculo?.role) return { papelRbac: null, statusRbac: null, motivoSemPapel: MOTIVOS_SEM_PAPEL.SEM_VINCULO };
  if (String(vinculo.status || "").toUpperCase() !== "ACTIVE") {
    return { papelRbac: null, statusRbac: vinculo.status || null, motivoSemPapel: MOTIVOS_SEM_PAPEL.VINCULO_INATIVO };
  }
  return { papelRbac: String(vinculo.role).toUpperCase(), statusRbac: vinculo.status, motivoSemPapel: null };
}

/** Agrupa os contatos casados por empresa. É o agrupamento que decide EMPRESA × PESSOA. */
function agruparPorEmpresa(casados) {
  const porEmpresa = new Map();
  for (const { contato, casouPor } of casados) {
    const id = String(contato.portalClientId);
    if (!porEmpresa.has(id)) {
      porEmpresa.set(id, {
        portalClientId: id,
        razao: contato.portalClient?.razao || null,
        cnpj: contato.portalClient?.cnpj || null,
        contatos: [],
      });
    }
    porEmpresa.get(id).contatos.push({
      contatoId: contato.id,
      nome: contato.nome || null,
      // ⚠ Rótulo de tela ("financeiro", "sócio") — texto livre do cadastro. NÃO é papel de RBAC.
      rotulo: contato.papel || null,
      telefoneE164: contato.telefoneE164 || null,
      waId: contato.waId || null,
      casouPor,
      // Opt-in NÃO filtra aqui: ele é exigência para MANDAR template, não para RECONHECER quem
      // mandou. Filtrar por ele faria uma mensagem recebida de contato conhecido virar "desconhecida".
      optIn: Boolean(contato.optInEm),
      userId: contato.userId || null,
      ...papelDoContato(contato),
    });
  }
  const empresas = [...porEmpresa.values()];
  for (const e of empresas) e.pessoaAmbigua = e.contatos.length > 1;
  return empresas;
}

/** Uma leitura completa (empresas + descartes) para uma tolerância. */
function lerCom(e164, candidatos, tolerancia) {
  const alvos = alvosDaLeitura(e164, tolerancia);
  const casados = [];
  const descartados = [];
  for (const contato of candidatos || []) {
    if (!contato?.portalClientId) continue;
    const casouPor = casarContato(contato, alvos);
    if (!casouPor) continue;
    // Desativar um contato tem de PARAR de identificar, senão desativar não significa nada.
    if (contato.ativo === false) {
      descartados.push({
        contatoId: contato.id,
        portalClientId: String(contato.portalClientId),
        motivo: MOTIVOS_DESCARTE.CONTATO_INATIVO,
      });
      continue;
    }
    casados.push({ contato, casouPor });
  }
  return { empresas: agruparPorEmpresa(casados), descartados };
}

function situacaoDe(empresas) {
  if (!empresas.length) return SITUACOES.DESCONHECIDO;
  return empresas.length > 1 ? SITUACOES.AMBIGUO : SITUACOES.VINCULADO;
}

/** Resumo comparável de uma leitura — é o que faz `divergemPeloNonoDigito` ser uma comparação, não uma impressão. */
function resumo(leitura) {
  return {
    situacao: situacaoDe(leitura.empresas),
    portalClientIds: leitura.empresas.map((e) => e.portalClientId).sort(),
    contatoIds: leitura.empresas.flatMap((e) => e.contatos.map((c) => c.contatoId)).sort(),
  };
}

const mesmoResumo = (a, b) =>
  a.situacao === b.situacao &&
  a.portalClientIds.join("|") === b.portalClientIds.join("|") &&
  a.contatoIds.join("|") === b.contatoIds.join("|");

/**
 * Número → empresa (→ pessoa). PURA.
 *
 * @param {string} telefone o que chegou (do webhook, da tela, do teste) — em qualquer forma
 * @param {Array} candidatos contatos JÁ CARREGADOS, no formato de `SELECT_CONTATO_PARA_VINCULO`,
 *   acrescidos de `userId` e `vinculoRbac: {role,status}|null`. Quem carrega é o service.
 * @param {{tolerancia?: string}} opcoes
 * @returns {{situacao:string, e164:string|null, tolerancia:string, empresas:Array,
 *            ambiguidades:Array<string>, descartados:Array, divergemPeloNonoDigito:boolean,
 *            leituras:object}}
 */
export function resolverVinculoTelefone(telefone, candidatos = [], opcoes = {}) {
  const tolerancia = opcoes.tolerancia === TOLERANCIAS.NONO_DIGITO ? TOLERANCIAS.NONO_DIGITO : TOLERANCIAS.ESTRITA;
  const e164 = normalizarE164(telefone);

  if (!e164) {
    // ⚠ Não é o mesmo que DESCONHECIDO: ali o número existe e ninguém o cadastrou; aqui não há
    // número. Colapsá-los faria lixo digitado parecer cliente novo.
    return {
      situacao: SITUACOES.TELEFONE_INVALIDO,
      e164: null,
      tolerancia,
      empresas: [],
      ambiguidades: [],
      descartados: [],
      divergemPeloNonoDigito: false,
      leituras: {},
    };
  }

  const estrita = lerCom(e164, candidatos, TOLERANCIAS.ESTRITA);
  const tolerante = lerCom(e164, candidatos, TOLERANCIAS.NONO_DIGITO);
  const escolhida = tolerancia === TOLERANCIAS.NONO_DIGITO ? tolerante : estrita;

  const empresas = escolhida.empresas;
  const situacao = situacaoDe(empresas);
  const ambiguidades = [];
  if (empresas.length > 1) ambiguidades.push(AMBIGUIDADES.EMPRESA);
  if (empresas.some((e) => e.pessoaAmbigua)) ambiguidades.push(AMBIGUIDADES.PESSOA);

  const resumoEstrita = resumo(estrita);
  const resumoTolerante = resumo(tolerante);

  return {
    situacao,
    e164,
    tolerancia,
    empresas,
    ambiguidades,
    descartados: escolhida.descartados,
    divergemPeloNonoDigito: !mesmoResumo(resumoEstrita, resumoTolerante),
    leituras: { [TOLERANCIAS.ESTRITA]: resumoEstrita, [TOLERANCIAS.NONO_DIGITO]: resumoTolerante },
  };
}
