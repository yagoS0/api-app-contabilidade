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
 * ⚠⚠ SÓ ENTRA CAMPO QUE `buildDpsXml` JÁ ESCREVE HOJE.
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
  pAliq: "Alíquota do ISS. O gerador não monta `tribMun/pAliq`, e ela é PROIBIDA num cenário "
    + "(E0617) e OBRIGATÓRIA em outro (E0619) — o discriminante é o status do município no Sistema "
    + "Nacional, tabela que não está no repositório.",
  BM: "Benefício municipal. Já está cadastrado em 3 colunas da `Company` e NUNCA chegou ao XML.",
  exigSusp: "Exigibilidade suspensa. Sem escritor no gerador.",
  tpImunidade: "Tipo de imunidade — só faz sentido com `tribISSQN = 2`.",
  tpRetISSQN: "⚠ NÃO é campo de perfil: a retenção do ISS depende do TOMADOR daquela nota, e o "
    + "cliente marca a caixa (decisão do dono, 01/09/2026). Do perfil vem a ALÍQUOTA.",
  comExt: "Exportação. `TCComExterior` tem 7 filhos obrigatórios, e decidir 'é exportação?' passa "
    + "pelos 112 cenários da aba EXPORTACAO_EMISSÃO do ANEXO_I, não extraída.",
  obra: "CNO/CIB. ⚠ O identificador é da OBRA, não da empresa — o perfil só HABILITA o campo "
    + "(`habilitaObra`); quem informa é o cliente, por nota.",
  tribFed: "Retenções federais. As normas foram versionadas em `docs/retencao-fonte/`, mas o grupo "
    + "não tem produtor e `vRetCP` continua sem norma confirmada.",
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
