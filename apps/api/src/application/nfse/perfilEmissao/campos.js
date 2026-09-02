// OS CAMPOS DO PERFIL DE EMISSÃO — uma fonte, quatro consumidores.
//
// ⚠⚠ ESTE ARQUIVO EXISTE PARA IMPEDIR A REPETIÇÃO DE UM DEFEITO MEDIDO. `CadastroFiscal.perfilAtividades`
// tem 8 campos, e **3 não têm um único leitor** — `codigoServicoMunicipal`, `retencaoFonte` e
// `domicilioFiscal`, o último sem sequer um input na tela. A tela chegou a rotulá-los "⚠ ainda sem
// uso". Ninguém soube disso até uma varredura de 25/08/2026.
//
// O que faltou lá não foi disciplina: foi **mecanismo**. Comentário não impede campo morto; uma
// lista que o teste confere, sim. Aqui cada campo declara **quem o lê**, e há teste que cai quando
// existir coluna no Prisma fora desta lista, ou campo desta lista sem leitor.
//
// ⚠ A LISTA É A FONTE, e quatro peças a consomem: a rota (o que aceita), o resolvedor (o que
// resolve), a tela do contador (o que renderiza) e — quando a flag ligar — o gerador do XML.
// Escrever a lista quatro vezes é como as quatro cópias divergem.
//
// ⚠⚠ `caminhoNoXml` NÃO É DECORAÇÃO. É o de-para que permite ao painel dizer "este valor vira ESTA
// tag", e é onde a versão do leiaute importa: `TCTribMunicipal` **reordenou os filhos** entre 1.00 e
// 1.01, então quem for acrescentar `pAliq`/`BM` aqui precisa olhar `DPS_VERSAO` junto.

/** Vocabulário fechado de quem produz o valor de um campo do perfil. */
export const LEITOR = Object.freeze({
  RESOLVEDOR: "resolverPerfilDeEmissao",
  ROTA: "rota /perfis-emissao",
  TELA: "painel do contador",
  GERADOR: "buildDpsXml",
});

/**
 * ⚠⚠ SÓ ENTRA CAMPO COM ESCRITOR — e o escritor nasce NO MESMO COMMIT da coluna.
 *
 * ⚠ Esta frase dizia "só entra campo que `buildDpsXml` JÁ escreve hoje", o que era a formulação
 * certa enquanto a fase 1 só lia campos existentes. Os quatro campos de NBS/IBS-CBS (02/09/2026)
 * entraram junto com o código que os escreve, no mesmo commit — que é o que a regra protege. O que
 * continua PROIBIDO é a coluna que espera um leitor futuro.
 *
 * É o critério que mantém a fase honesta: o resolvedor tem o que resolver, o painel tem contra o
 * que comparar ("hoje sai X, o perfil mandaria Y"), e nenhuma coluna nasce esperando um leitor
 * futuro. Campo do leiaute que o gerador ainda não monta (`pAliq`, `BM`, `exigSusp`, `tpImunidade`,
 * `comExt`, `obra`) entra na fase que o montar — está em `FORA_DESTA_FASE`, com o motivo.
 */
export const CAMPOS = Object.freeze([
  Object.freeze({
    id: "codigoServicoNacional",
    rotulo: "Código de Tributação Nacional",
    tag: "cTribNac",
    caminhoNoXml: "infDPS/serv/cServ/cTribNac",
    forma: /^[0-9]{6}$/,
    formaDescrita: "6 dígitos",
    obrigatorio: true,
    // ⚠ A autoridade continua sendo `escolherCodigoServicoNacional`: o perfil não pode oferecer
    // código fora de `Company.codigosServicoNacional`. Quem confere isso é a rota.
    hojeSaiDe: "Company.codigoServicoNacional",
    leitores: [LEITOR.RESOLVEDOR, LEITOR.ROTA, LEITOR.TELA],
  }),
  Object.freeze({
    id: "codigoServicoMunicipal",
    rotulo: "Código Complementar Municipal",
    tag: "cTribMun",
    caminhoNoXml: "infDPS/serv/cServ/cTribMun",
    forma: /^[0-9]{3}$/,
    formaDescrita: "exatamente 3 dígitos",
    obrigatorio: false,
    // ⚠⚠ TRÊS DÍGITOS, E NÃO "SÓ DÍGITOS". O gerador faz `.slice(-3)`, que ENCURTA o longo e **não
    // completa o curto** — um "12" gravado sairia como `12` no XML, e a nota é recusada. A rota do
    // cadastro aceita qualquer comprimento; aqui o perfil é mais estrito de propósito, porque aqui
    // o valor é escolhido campo a campo e o erro aparece na tela, não numa nota recusada.
    hojeSaiDe: "Company.codigoServicoMunicipal",
    leitores: [LEITOR.RESOLVEDOR, LEITOR.ROTA, LEITOR.TELA],
  }),
  Object.freeze({
    id: "cLocPrestacao",
    rotulo: "Município da prestação",
    tag: "cLocPrestacao",
    caminhoNoXml: "infDPS/serv/locPrest/cLocPrestacao",
    forma: /^[0-9]{7}$/,
    formaDescrita: "código do IBGE, 7 dígitos",
    obrigatorio: false,
    // Ausente, o gerador aplica a regra geral do art. 3º da LC 116 (o município do emissor) e
    // registra `localPrestacaoAssumido: true` no retorno.
    hojeSaiDe: "payload da nota, ou o município do emissor",
    leitores: [LEITOR.RESOLVEDOR, LEITOR.TELA],
  }),
  Object.freeze({
    id: "regEspTrib",
    rotulo: "Regime Especial de Tributação",
    tag: "regEspTrib",
    caminhoNoXml: "infDPS/prest/regTrib/regEspTrib",
    valores: Object.freeze(["0", "1", "2", "3", "4", "5", "6", "9"]),
    // ⚠ `TSRegEspTrib` não tem 7 nem 8 — conferido no XSD, não deduzido por intervalo.
    formaDescrita: "0 Nenhum · 1 Ato Cooperado · 2 Estimativa · 3 ME Municipal · 4 Notário · 5 Prof. Autônomo · 6 · 9",
    obrigatorio: false,
    hojeSaiDe: 'Company.regimeEspecialTributacao, ou "0"',
    leitores: [LEITOR.RESOLVEDOR, LEITOR.ROTA, LEITOR.TELA],
  }),
  Object.freeze({
    id: "regApTribSN",
    rotulo: "Regime de Apuração no Simples Nacional",
    tag: "regApTribSN",
    caminhoNoXml: "infDPS/prest/regTrib/regApTribSN",
    valores: Object.freeze(["1", "2", "3"]),
    formaDescrita: "1 federais e municipal pelo SN · 2 federais pelo SN, ISSQN por fora · 3 ambos por fora",
    obrigatorio: false,
    // ⚠⚠ DEFEITO CONHECIDO QUE ESTE CAMPO EXISTE PARA CONSERTAR: `NfseService.js:826` escreve "1"
    // para TODO optante, e `CadastroFiscal.sublimiteICMSISS` é literalmente o cadastro do caso 2.
    // Empresa do Simples acima do sublimite declara hoje o regime de apuração ERRADO — e o dado que
    // provaria isso já está no banco.
    hojeSaiDe: 'CRAVADO em "1" no gerador',
    cravadoHoje: true,
    leitores: [LEITOR.RESOLVEDOR, LEITOR.ROTA, LEITOR.TELA],
  }),
  Object.freeze({
    id: "tribISSQN",
    rotulo: "Tributação do ISSQN",
    tag: "tribISSQN",
    caminhoNoXml: "infDPS/valores/trib/tribMun/tribISSQN",
    valores: Object.freeze(["1", "2", "3", "4"]),
    formaDescrita: "1 Operação tributável · 2 Imunidade · 3 Exportação · 4 Não incidência",
    obrigatorio: false,
    // ⚠⚠ CRAVADO EM "1" (`NfseService.js:887`) — é por isso que exportação de serviço é impossível
    // de declarar hoje, havendo empresa na carteira que presta para o exterior.
    hojeSaiDe: 'CRAVADO em "1" no gerador',
    cravadoHoje: true,
    leitores: [LEITOR.RESOLVEDOR, LEITOR.ROTA, LEITOR.TELA],
  }),

  Object.freeze({
    id: "pAliq",
    rotulo: "Alíquota do ISSQN",
    tag: "pAliq",
    caminhoNoXml: "infDPS/valores/trib/tribMun/pAliq",
    forma: /^\d(\.\d{1,2})?$/,
    formaDescrita: "percentual, até 9,99 (`TSDec1V2`: um dígito inteiro e duas casas)",
    obrigatorio: false,
    // ⚠⚠ TER A COLUNA PREENCHIDA NÃO QUER DIZER QUE ELA VAI À NOTA. `pAliq` é PROIBIDO num cenário
    // (E0625/E0631) e OBRIGATÓRIO em outro (E0621/E0628), e os dois são rejeição. Quem decide é
    // `pAliqDaDps`, que só emite onde a norma PROVA — Simples com `regApTribSN = 1` e ISS retido.
    hojeSaiDe: "não era escrito",
    leitores: [LEITOR.RESOLVEDOR, LEITOR.ROTA, LEITOR.TELA, LEITOR.GERADOR],
  }),

  // ── retenção federal — art. 30 da Lei 10.833/2003 (02/09/2026) ────────────────────
  Object.freeze({
    id: "retencaoFederalArt30",
    rotulo: "Serviço sujeito à retenção federal (art. 30)",
    tag: "tpRetPisCofins",
    caminhoNoXml: "infDPS/valores/trib/tribFed/piscofins/tpRetPisCofins",
    valores: Object.freeze(["true", "false"]),
    formaDescrita: "sim ou não — declarado pelo contador",
    obrigatorio: false,
    // ⚠⚠ DECLARAR `true` NÃO BASTA. Três coisas decidem a retenção e só esta é do perfil: o REGIME
    // (vedada no Simples), o SERVIÇO estar no art. 30 (esta), e o TOMADOR ser PJ (derivado do
    // documento da nota). Mais a dispensa pelo piso de R$ 10,00.
    // ⚠⚠ O SISTEMA NÃO DERIVA ISSO DO CNAE — errar aqui erra nos DOIS sentidos.
    hojeSaiDe: "não era escrito",
    leitores: [LEITOR.RESOLVEDOR, LEITOR.ROTA, LEITOR.TELA, LEITOR.GERADOR],
  }),
  Object.freeze({
    id: "cstPisCofins",
    rotulo: "CST do PIS/COFINS",
    tag: "CST",
    caminhoNoXml: "infDPS/valores/trib/tribFed/piscofins/CST",
    // ⚠ Os 34 valores de `TSTipoCST` (XSD 1.01), TRANSCRITOS — e há teste que os confere contra o
    // arquivo, um a um. Transcrição sem amarração é como as duas listas divergem.
    valores: Object.freeze([
      "00", "01", "02", "03", "04", "05", "06", "07", "08",
      "09", "49", "50", "51", "52", "53", "54", "55", "56",
      "60", "61", "62", "63", "64", "65", "66", "67", "70",
      "71", "72", "73", "74", "75", "98", "99",
    ]),
    formaDescrita: "dois dígitos, da tabela do PIS/COFINS",
    obrigatorio: false,
    // ⚠ O XSD o exige DENTRO do grupo `piscofins`, e não existe de-para serviço → CST em fonte
    // versionada aqui. Sem ele o grupo não se monta — recusa NOMEADA, nunca um "01" fabricado.
    hojeSaiDe: "não era escrito",
    leitores: [LEITOR.RESOLVEDOR, LEITOR.ROTA, LEITOR.TELA, LEITOR.GERADOR],
  }),

  // ── NBS e IBS/CBS (02/09/2026) ─────────────────────────────────────────────────────────────
  // ⚠ Estes QUATRO são os primeiros campos cujo escritor nasceu NO MESMO COMMIT da coluna — e
  // não antes dele. É a regra da casa aplicada na direção certa: coluna sem leitor é o defeito
  // que `perfilAtividades` tem; leitor sem coluna não compila.
  Object.freeze({
    id: "codigoNbs",
    rotulo: "Item da NBS",
    tag: "cNBS",
    caminhoNoXml: "infDPS/serv/cServ/cNBS",
    // ⚠ A COLUNA GUARDA A FORMA PONTUADA; a DPS leva `[0-9]{9}`. Quem converte — e quem RECUSA os
    // 292 níveis intermediários, nomeando-os "não terminal" em vez de "inválido" — é `nbsParaDps`.
    forma: /^[0-9]\.[0-9]{4}(\.[0-9]{1,2}){0,2}$/,
    formaDescrita: "código NBS pontuado e TERMINAL (ex.: 1.1502.10.00)",
    obrigatorio: false,
    // ⚠⚠ Obrigatório na EXPORTAÇÃO (E0318) e sempre que houver IBS/CBS (E0322).
    hojeSaiDe: "não era escrito",
    leitores: [LEITOR.RESOLVEDOR, LEITOR.ROTA, LEITOR.TELA, LEITOR.GERADOR],
  }),
  Object.freeze({
    id: "ibscbsCIndOp",
    rotulo: "Código indicador da operação (IBS/CBS)",
    tag: "cIndOp",
    caminhoNoXml: "infDPS/IBSCBS/cIndOp",
    forma: /^[0-9]{6}$/,
    formaDescrita: "6 dígitos, do ANEXO VIII",
    obrigatorio: false,
    // ⚠⚠ A tabela OFICIAL é o ANEXO C (E0901), NÃO versionado aqui. Conferimos contra o ANEXO
    // VIII, que é subconjunto — mais estrito que a norma, portanto falha FECHADA.
    hojeSaiDe: "não era escrito",
    leitores: [LEITOR.RESOLVEDOR, LEITOR.ROTA, LEITOR.TELA, LEITOR.GERADOR],
  }),
  Object.freeze({
    id: "ibscbsCst",
    rotulo: "Situação tributária do IBS/CBS (CST)",
    tag: "CST",
    caminhoNoXml: "infDPS/IBSCBS/valores/trib/gIBSCBS/CST",
    forma: /^[0-9]{3}$/,
    formaDescrita: "3 dígitos",
    obrigatorio: false,
    // ⚠⚠ **NÃO EXISTE LISTA VERSIONADA DISTO.** O XSD dá `[0-9]{3}` sem enumeração e o ANEXO_I
    // não enumera. Só a FORMA é conferiível; o conteúdo é declaração do contador.
    hojeSaiDe: "não era escrito",
    leitores: [LEITOR.RESOLVEDOR, LEITOR.ROTA, LEITOR.TELA, LEITOR.GERADOR],
  }),
  Object.freeze({
    id: "ibscbsCClassTrib",
    rotulo: "Classificação tributária do IBS/CBS",
    tag: "cClassTrib",
    caminhoNoXml: "infDPS/IBSCBS/valores/trib/gIBSCBS/cClassTrib",
    forma: /^[0-9]{6}$/,
    formaDescrita: "6 dígitos, do ANEXO VIII",
    obrigatorio: false,
    // ⚠ Conferido em PAR com o `cIndOp`: em 7 itens o produto cartesiano das duas listas contém
    // combinações que a fonte não autoriza.
    hojeSaiDe: "não era escrito",
    leitores: [LEITOR.RESOLVEDOR, LEITOR.ROTA, LEITOR.TELA, LEITOR.GERADOR],
  }),
]);

/** Campos de IDENTIDADE e FORMA — não afirmam nada sobre tributo, e por isso têm default. */
export const CAMPOS_DE_IDENTIDADE = Object.freeze([
  "nome", "ativo", "padrao", "origem", "habilitaObra", "habilitaExportacao",
]);

/** Colunas do Prisma que não são campo de perfil (chave, auditoria, relação). */
export const COLUNAS_TECNICAS = Object.freeze([
  "id", "portalClientId", "createdByUserId", "criadoEm", "atualizadoEm", "portalClient",
]);

/**
 * ⚠⚠ O QUE FICOU DE FORA DESTA FASE, E POR QUÊ — nomeado, para não ser descoberto de novo.
 *
 * Cada linha é um campo do leiaute que o perfil PODERIA ter e não tem, porque `buildDpsXml` ainda
 * não o monta. Acrescentar a coluna antes do escritor é exatamente como `perfilAtividades` ganhou
 * três campos sem leitor.
 */
export const FORA_DESTA_FASE = Object.freeze({
  BM: "Benefício municipal. Já está cadastrado em 3 colunas da `Company` e NUNCA chegou ao XML.",
  exigSusp: "Exigibilidade suspensa. Sem escritor no gerador.",
  tpImunidade: "Tipo de imunidade — só faz sentido com `tribISSQN = 2`.",
  tpRetISSQN: "⚠ NÃO é campo de perfil: a retenção do ISS depende do TOMADOR daquela nota, e o "
    + "cliente marca a caixa (decisão do dono, 01/09/2026). Do perfil vem a ALÍQUOTA.",
  comExt: "Exportação. `TCComExterior` tem 7 filhos obrigatórios, e decidir 'é exportação?' passa "
    + "pelos 112 cenários da aba EXPORTACAO_EMISSÃO do ANEXO_I, não extraída.",
  obra: "CNO/CIB. ⚠ O identificador é da OBRA, não da empresa — o perfil só HABILITA o campo "
    + "(`habilitaObra`); quem informa é o cliente, por nota.",
  vRetIRRF: "⚠ A alíquota do IRRF vive na legislação do IR e NÃO está versionada aqui. O campo "
    + "existe no leiaute e continua sem produtor — emitir percentual de memória é o que a regra 1 "
    + "do projeto proíbe.",
  vRetCP: "⚠ A retenção previdenciária de 11% (Lei 8.212/1991, art. 31) e sua interação com o "
    + "Anexo IV do Simples não foram confirmadas em fonte primária. Sem produtor, de propósito.",
});

const POR_ID = new Map(CAMPOS.map((c) => [c.id, c]));

/** O campo, ou `null` — nunca um objeto vazio que pareça campo. */
export function campoPorId(id) {
  return POR_ID.get(String(id ?? "")) || null;
}

/** Os ids aceitos pela rota, na ordem em que a tela os desenha. */
export const IDS = Object.freeze(CAMPOS.map((c) => c.id));

/**
 * Confere a FORMA de um valor contra o campo. Não julga o conteúdo.
 *
 * ⚠ `null`/`""` é AUSÊNCIA, e ausência é válida em campo não obrigatório — é o "não respondi",
 * que este modelo trata como estado legítimo. Quem recusa ausência em campo obrigatório é a rota.
 */
export function conferirForma(id, valor) {
  const campo = campoPorId(id);
  if (!campo) return { ok: false, motivo: `Campo desconhecido: ${id}.` };

  const bruto = valor === null || valor === undefined ? "" : String(valor).trim();
  if (bruto === "") {
    return campo.obrigatorio
      ? { ok: false, motivo: `${campo.rotulo} é obrigatório.` }
      : { ok: true, valor: null };
  }
  if (campo.valores && !campo.valores.includes(bruto)) {
    return {
      ok: false,
      motivo: `${campo.rotulo} aceita apenas: ${campo.valores.join(", ")} (${campo.formaDescrita}).`,
    };
  }
  if (campo.forma && !campo.forma.test(bruto)) {
    return { ok: false, motivo: `${campo.rotulo} precisa ter ${campo.formaDescrita}.` };
  }
  return { ok: true, valor: bruto };
}
