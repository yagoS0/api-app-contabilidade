// A MEMÓRIA DO TOMADOR — escrita DEPOIS do sucesso, e que nunca derruba uma emissão.
//
// > Pedido do dono (19/08/2026): *"ao emitir a nota para um tomador vamos salvar as informações; na
// > hora de emitir o cliente pode escolher o tomador ao qual ele já emitiu."*
//
// ⚠⚠ ISTO NÃO É CADASTRO. É o registro do que a emissão TEVE — sem tela de gestão, sem edição, sem
// exclusão. O porquê está por extenso no model `TomadorEmitido` (`prisma/schema.prisma`); aqui fica
// só a regra de gravação. Ninguém digita nada nesta tabela: a única coisa que escreve nela é uma
// nota que o sistema nacional autorizou.
//
// ─── AS TRÊS INVARIANTES, e por que cada uma existe ─────────────────────────────────────────────
//
// ⚠ 1. **SÓ O QUE A EMISSÃO DE FATO TEVE.** Nada é completado por consulta e nada é deduzido. Nota
//    que saiu sem e-mail vira registro sem e-mail; nota sem endereço completo vira registro sem
//    endereço. O validador (`validators/nfsePayload.js`) já entrega `endereco: undefined` quando
//    qualquer um dos CINCO exigidos falta, então ou os cinco chegam juntos ou nenhum chega — e é
//    isso que se grava. Preencher um campo "para não ficar vazio" seria uma afirmação sobre um
//    TERCEIRO (o tomador não é usuário deste sistema) que ninguém fez.
//
// ⚠ 2. **DEPOIS DO SUCESSO, NUNCA ANTES.** A chamada mora após o `markIssued` de
//    `NfseService.issue` — depois do POST ter voltado e da nota estar gravada como emitida. Gravar
//    antes registraria como "já emitimos para este tomador" uma nota que a Receita ainda podia
//    recusar, e a memória passaria a oferecer, na emissão seguinte, dados que nunca saíram em
//    documento nenhum.
//
// ⚠ 3. **NUNCA DERRUBA A EMISSÃO — e a garantia é DESTE módulo, não do chamador.** Todo o corpo de
//    `registrarTomadorEmitido` está dentro de um `try`, da primeira linha à última: ele devolve o
//    desfecho, jamais lança. Isso importa porque no ponto de chamada existe um `catch` que é o
//    CLASSIFICADOR DE FALHA da emissão (`classificarFalha`): qualquer exceção que escapasse daqui
//    transformaria uma nota AUTORIZADA em `falha_envio`, ou seja, mascararia um ato fiscal
//    consumado. O chamador ainda põe um `try/catch` próprio por cima — cinto e suspensório, porque
//    o custo de errar aqui é o desfecho de uma nota fiscal.
//
// ─── DENTRO OU FORA DA TRANSAÇÃO: FORA, e não por conveniência ──────────────────────────────────
//
// A única transação de `NfseService.issue` é a RESERVA DE NUMERAÇÃO (etapa 2), que acontece
// **antes** do envio — nesse instante ninguém sabe ainda se a nota vai sair. O sucesso só é
// conhecido na etapa 3, quando o POST volta e `NfseRepository.markIssued` grava; ali não há
// transação aberta.
//
// Ou seja, "dentro da transação" nem sequer está disponível: seria preciso ABRIR uma nova,
// envolvendo `markIssued` e esta gravação. E isso é exatamente o que não se pode fazer — uma falha
// ao gravar a memória do tomador faria ROLLBACK da linha que diz que a nota foi emitida. A nota
// existiria no sistema nacional (não há inutilização na NFS-e) e não existiria aqui. Trocaríamos
// uma perda irrelevante (uma memória de conveniência) por uma perda irreparável (o registro de um
// documento fiscal autorizado).
//
// Fora, portanto: escrita própria, independente, e que só sabe falhar em silêncio anotado no log.

/** Só os dígitos — a mesma forma que `onlyDigits` entrega no validador. */
function soDigitos(valor) {
  return String(valor ?? "").replace(/\D+/g, "");
}

/** Texto aparado, ou `null`. `""` diria "tem e é vazio"; `null` diz "a emissão não teve". */
function textoOuNulo(valor) {
  const t = String(valor ?? "").trim();
  return t || null;
}

/**
 * Os campos de endereço, com os nomes da DPS. `xCpl` é o único opcional — aqui e lá.
 *
 * ⚠ A ORDEM E OS NOMES SÃO OS DO XML de propósito. Traduzir para "logradouro"/"numero" nesta
 * fronteira criaria um de-para a mais entre o validador, o `buildDpsXml` e a tabela.
 */
export const CAMPOS_ENDERECO = Object.freeze(["cMun", "cep", "xLgr", "nro", "xCpl", "xBairro"]);

/** Os campos comparados para decidir se o dado MUDOU. */
export const CAMPOS_DO_REGISTRO = Object.freeze(["nome", "email", ...CAMPOS_ENDERECO]);

/**
 * O tomador validado vira a forma da tabela. **Função pura.**
 *
 * ⚠ O `endereco` do payload validado usa `CEP` (maiúsculo, como no XML) e a coluna é `cep` — a
 * tradução é ESTA linha e só ela. Se o validador mudar o nome, quebra aqui, num lugar só.
 *
 * @returns {object|null} `null` quando não há documento ou nome: sem os dois não há o que lembrar,
 *   e um registro sem nome apareceria na tela do cliente como uma linha em branco clicável.
 */
export function dadosDoTomadorEmitido(tomador) {
  const documento = soDigitos(tomador?.doc ?? tomador?.documento ?? tomador?.cnpjCpf);
  const nome = textoOuNulo(tomador?.nome);
  if (!documento || !nome) return null;

  const endereco = tomador?.endereco || null;
  return {
    documento,
    nome,
    email: textoOuNulo(tomador?.email),
    cMun: textoOuNulo(endereco?.cMun),
    cep: textoOuNulo(endereco?.CEP ?? endereco?.cep),
    xLgr: textoOuNulo(endereco?.xLgr),
    nro: textoOuNulo(endereco?.nro),
    xCpl: textoOuNulo(endereco?.xCpl),
    xBairro: textoOuNulo(endereco?.xBairro),
  };
}

/**
 * Algum campo mudou em relação ao que já está guardado?
 *
 * ⚠ COMPARA CAMPO A CAMPO, contra a lista fechada `CAMPOS_DO_REGISTRO`. Um `JSON.stringify` dos
 * dois objetos daria "mudou" por ordem de chave ou por uma coluna nova que ninguém quis comparar.
 *
 * ⚠ `null` e `undefined` são a MESMA ausência aqui: o Prisma devolve `null` para coluna vazia e o
 * shaping acima devolve `null` também, mas um registro lido com `select` parcial traria
 * `undefined`. Tratar os dois como iguais evita que uma leitura incompleta seja lida como mudança.
 */
export function dadosMudaram(atual, novo) {
  if (!atual) return true;
  return CAMPOS_DO_REGISTRO.some((campo) => (atual[campo] ?? null) !== (novo[campo] ?? null));
}

/** Os desfechos possíveis. Fechado — quem lê o log sabe o vocabulário inteiro. */
export const ACAO = Object.freeze({
  CRIADO: "criado",
  ATUALIZADO: "atualizado",
  INALTERADO: "inalterado",
  IGNORADO: "ignorado",
  FALHOU: "falhou",
});

/**
 * Guarda (ou atualiza) o tomador desta emissão.
 *
 * ⚠ **NÃO LANÇA NUNCA.** Devolve `{ acao, motivo }` — ver a invariante 3 no cabeçalho.
 *
 * ⚠ NÃO É UPSERT DO PRISMA, e a razão é a data. `upsert` não sabe dizer se o `update` mudou alguma
 * coisa, e `dadosAtualizadosEm` só pode subir quando o dado DE FATO mudou (é o "registra quando" do
 * pedido). Com `upsert`, ou a data subiria em toda reemissão idêntica — mentindo sobre quando o
 * endereço mudou —, ou não subiria nunca. Então: lê, compara, escreve.
 *
 * ⚠ A CORRIDA ENTRE O `findUnique` E O `create` É CONHECIDA E É INOFENSIVA. Duas emissões
 * simultâneas para o mesmo tomador podem tentar criar a mesma linha; a segunda bate na constraint
 * única (P2002) e cai no `catch`, que registra `FALHOU` e devolve. A memória fica com o dado da
 * primeira — que é uma emissão bem-sucedida de verdade — e a próxima emissão a atualiza. Resolver
 * isso com transação ou retry custaria complexidade para um empate que só perde uma atualização de
 * conveniência.
 *
 * @param {object} p
 * @param {object} p.prisma cliente Prisma (injetado — é o que torna isto testável sem banco)
 * @param {string} p.companyId a empresa EMISSORA; sem ela não se escreve nada
 * @param {object} p.tomador o `data.tomador` já VALIDADO
 * @param {object} [p.log]
 * @param {Date} [p.agora] injetável para o teste; nunca use em produção
 */
export async function registrarTomadorEmitido({ prisma, companyId, tomador, log = null, agora = null }) {
  try {
    if (!prisma?.tomadorEmitido || !companyId) {
      return { acao: ACAO.IGNORADO, motivo: "sem prisma ou sem companyId" };
    }
    const dados = dadosDoTomadorEmitido(tomador);
    if (!dados) {
      return { acao: ACAO.IGNORADO, motivo: "emissão sem documento ou sem nome do tomador" };
    }

    const quando = agora || new Date();
    const chave = { companyId_documento: { companyId, documento: dados.documento } };
    const atual = await prisma.tomadorEmitido.findUnique({ where: chave });

    if (!atual) {
      await prisma.tomadorEmitido.create({
        data: { companyId, ...dados, ultimaEmissaoEm: quando },
      });
      return { acao: ACAO.CRIADO, motivo: null };
    }

    const mudou = dadosMudaram(atual, dados);
    await prisma.tomadorEmitido.update({
      where: chave,
      data: {
        ...dados,
        ultimaEmissaoEm: quando,
        // ⚠ SÓ SOBE QUANDO MUDOU. Reemissão idêntica não pode carimbar "o dado mudou hoje" — é
        // justamente essa data que responde "desde quando o endereço deste cliente é este".
        ...(mudou ? { dadosAtualizadosEm: quando } : {}),
      },
    });
    return { acao: mudou ? ACAO.ATUALIZADO : ACAO.INALTERADO, motivo: null };
  } catch (err) {
    // ⚠ `warn`, não `error`: a nota FOI emitida e está gravada. O que falhou é a memória de
    // conveniência, e tratá-la como erro da emissão contaminaria o alerta de quem monitora.
    log?.warn?.(
      { companyId, err: err?.message, code: err?.code },
      "NFS-e: nota emitida, mas a memória do tomador não foi gravada"
    );
    return { acao: ACAO.FALHOU, motivo: err?.message || "erro desconhecido" };
  }
}

/**
 * Os tomadores que esta empresa JÁ conhece, entre os documentos pedidos.
 *
 * É o *"se o CNPJ preenchido for de um tomador que já teve antes, só preencher"* do dono, do lado
 * da LEITURA. Devolve um `Map` documento → registro, pronto para `classificarPlanilhaLote`.
 *
 * ⚠ **NÃO LANÇA.** Enquanto a migration `20260819140000_add_tomador_emitido` não estiver aplicada,
 * a tabela não existe (P2021) — e isso não pode derrubar a leitura de uma planilha. Sem memória, as
 * linhas simplesmente caem no caminho da consulta, que é o comportamento correto para um tomador
 * que nunca recebeu nota. O motivo volta em `motivo`, para a tela poder dizer que a memória não foi
 * consultada em vez de afirmar que ninguém é conhecido.
 *
 * ⚠ **ESCOPADO PELA EMPRESA**, sempre. Um `where` só por `documento` devolveria o endereço que
 * OUTRA empresa usou — vazamento entre clientes num portal multi-empresa.
 *
 * @returns {Promise<{tomadores: Map<string, object>, motivo: string|null}>}
 */
export async function buscarTomadoresEmitidos({ prisma, companyId, documentos = [], log = null }) {
  const alvos = [...new Set((documentos || []).map((d) => soDigitos(d)).filter(Boolean))];
  if (!prisma?.tomadorEmitido || !companyId || !alvos.length) {
    return { tomadores: new Map(), motivo: alvos.length ? "memória de tomadores indisponível" : null };
  }
  try {
    const linhas = await prisma.tomadorEmitido.findMany({
      where: { companyId, documento: { in: alvos } },
    });
    return { tomadores: new Map(linhas.map((l) => [l.documento, l])), motivo: null };
  } catch (err) {
    log?.warn?.(
      { companyId, err: err?.message, code: err?.code },
      "NFS-e em lote: a memória de tomadores não pôde ser lida — as linhas seguem pelo caminho da consulta"
    );
    return { tomadores: new Map(), motivo: err?.message || "erro ao ler a memória de tomadores" };
  }
}
