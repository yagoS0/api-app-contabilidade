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
// ── ⚠ O NÚMERO É O DO CADASTRO. NADA É DERIVADO. (decisão do dono, 14/08/2026) ──────────────────
//
// > "os números são sempre com um nove na frente a partir de agora, mas você nunca deve pressupor
// >  o número, o número de comunicação com o cliente será o do cadastro"
//
// Isso resolve o que antes era uma escolha em aberto, e resolve nas duas pontas:
//
//   1. **O CADASTRO É A AUTORIDADE.** Quem responde "que número é este?" é a linha gravada em
//      `contatos_whatsapp`, comparada DÍGITO A DÍGITO. A comparação estrita não é mais um padrão
//      que alguém possa virar: é a regra.
//   2. **NADA É INVENTADO PARA CASAR.** Celular brasileiro ganhou o 9 em 2012 e o mesmo aparelho
//      pode ser escrito das duas formas — mas `variantesE164` acrescenta o 9 a QUALQUER número de
//      8 dígitos, **inclusive a um fixo**: `552133334444` gera `5521933334444`, que pode ser o
//      celular de outra pessoa, de outra empresa. Casar por aí é pressupor o número, e a
//      consequência é emitir no CNPJ de outro.
//
// ⚠ POR ISSO A TOLERÂNCIA NÃO É PARÂMETRO — foi retirada da assinatura de propósito. Enquanto
// `opcoes.tolerancia` existia, bastava um chamador futuro passar `NONO_DIGITO` para violar a regra
// em silêncio, e o violador nem saberia que havia uma regra. A leitura tolerante continua sendo
// CALCULADA, mas ela **nunca pode virar a resposta**: serve só para acender
// `divergemPeloNonoDigito`.
//
// ⚠ E ESSE SINAL MUDOU DE SIGNIFICADO. Ele não é mais "talvez devêssemos ser tolerantes"; é
// **"este cadastro está no formato antigo — conserte o CADASTRO"**. É a diferença entre corrigir a
// origem e remendar a comparação para sempre. Quem escrever o webhook lê o sinal, avisa o contador,
// e não casa.

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

export const LEITURAS = Object.freeze({
  /**
   * A REGRA: casa dígito a dígito com o que está no cadastro. Única que produz resposta.
   */
  ESTRITA: "ESTRITA",
  /**
   * ⚠ DIAGNÓSTICO, NUNCA RESPOSTA. Casa também a outra forma do nono dígito (`variantesE164`).
   * Existe só para comparar com a estrita e acender `divergemPeloNonoDigito` — que significa
   * "o cadastro está no formato antigo", não "case assim mesmo".
   */
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

const alvosDaLeitura = (e164, leitura) =>
  leitura === LEITURAS.NONO_DIGITO ? new Set(variantesE164(e164)) : new Set([somenteDigitos(e164)]);

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

/** Uma leitura completa (empresas + descartes) para uma das leituras de `LEITURAS`. */
function lerCom(e164, candidatos, leitura) {
  const alvos = alvosDaLeitura(e164, leitura);
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
 * @returns {{situacao:string, e164:string|null, leitura:string, empresas:Array,
 *            ambiguidades:Array<string>, descartados:Array, divergemPeloNonoDigito:boolean,
 *            leituras:object}}
 *
 * ⚠ NÃO RECEBE OPÇÕES, e essa ausência é a regra (ver o cabeçalho). A resposta sai SEMPRE da
 * leitura estrita contra o cadastro. Se algum dia alguém precisar da leitura tolerante, ela já está
 * em `leituras[NONO_DIGITO]` para ser OLHADA — o que não existe é o caminho para ela virar a
 * resposta sem que a decisão do dono seja revista.
 */
export function resolverVinculoTelefone(telefone, candidatos = []) {
  const leitura = LEITURAS.ESTRITA;
  const e164 = normalizarE164(telefone);

  if (!e164) {
    // ⚠ Não é o mesmo que DESCONHECIDO: ali o número existe e ninguém o cadastrou; aqui não há
    // número. Colapsá-los faria lixo digitado parecer cliente novo.
    return {
      situacao: SITUACOES.TELEFONE_INVALIDO,
      e164: null,
      leitura,
      empresas: [],
      ambiguidades: [],
      descartados: [],
      divergemPeloNonoDigito: false,
      leituras: {},
    };
  }

  const estrita = lerCom(e164, candidatos, LEITURAS.ESTRITA);
  // ⚠ Calculada, NUNCA escolhida. É o termo de comparação de `divergemPeloNonoDigito`.
  const tolerante = lerCom(e164, candidatos, LEITURAS.NONO_DIGITO);

  const empresas = estrita.empresas;
  const situacao = situacaoDe(empresas);
  const ambiguidades = [];
  if (empresas.length > 1) ambiguidades.push(AMBIGUIDADES.EMPRESA);
  if (empresas.some((e) => e.pessoaAmbigua)) ambiguidades.push(AMBIGUIDADES.PESSOA);

  const resumoEstrita = resumo(estrita);
  const resumoTolerante = resumo(tolerante);

  return {
    situacao,
    e164,
    leitura,
    empresas,
    ambiguidades,
    descartados: estrita.descartados,
    // "o cadastro está no formato antigo — conserte o cadastro", NUNCA "case assim mesmo".
    divergemPeloNonoDigito: !mesmoResumo(resumoEstrita, resumoTolerante),
    leituras: { [LEITURAS.ESTRITA]: resumoEstrita, [LEITURAS.NONO_DIGITO]: resumoTolerante },
  };
}
