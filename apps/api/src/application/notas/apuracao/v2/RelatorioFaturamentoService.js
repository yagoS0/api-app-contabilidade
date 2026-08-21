// RELATÓRIO "Faturamento no Período — Consolidado" (empresas do Simples Nacional).
//
// Sai na aba Apuração, ao lado do cálculo, e é SALVO por competência. A FORMA veio do impresso do
// Scritta/Nasajon que o dono trouxe (bloco por tipo de operação com total próprio · total do mês ·
// total consolidado · quadro-resumo no rodapé), e ele liberou o resto: *"o print que te mandei é
// apenas uma base do que quero, não precisa ser exatamente igual"*.
//
// ─────────────────────────────────────────────────────────────────────────────────────────────
// ⚠ O VOCABULÁRIO É O DA RECEITA, NÃO O DO SCRITTA.
//
// Os códigos `01 - sem Subst.Tributária` e `02 - PIS/COFINS MF` do impresso **não existem em fonte
// pública nenhuma e não são padrão de mercado** — são a abreviação, feita por aquele software, da
// segregação que a própria RFB exige. Copiá-los seria carimbar código privado de terceiro num
// relatório fiscal. Então este arquivo usa o **Manual do PGDAS-D e DEFIS (RFB)**:
//
//   · item 6.5 (pp. 23-26) — a segregação da REVENDA, em duas opções mutuamente exclusivas
//   · item 6.6.1 (p. 27)   — as OITO qualificações da receita
//
// Os rótulos oficiais estão transcritos LITERALMENTE nas constantes abaixo. Os `codigo` são NOSSOS
// (identificadores internos) e estão marcados como tal: a numeração oficial dessas opções não foi
// conferida, e inventar "01"/"02" seria repetir o erro do Scritta com outra roupa.
// ─────────────────────────────────────────────────────────────────────────────────────────────
//
// ⚠ O QUE ESTE RELATÓRIO **NÃO** AFIRMA — leia antes de mudar qualquer coisa aqui.
//
// 1. **Não existem colunas de IPI, ST, "Outros" e "Líquido".** Elas saíram. Não há parser de
//    `vIPI`, `vST` nem `vICMSST` em toda a `apps/api/src` — nenhum desses valores jamais foi lido
//    de um XML. A regra de fundo não mudou (não se afirma zero sobre o que não se mediu); o que
//    mudou foi o LUGAR onde ela se expressa: em vez de quatro colunas vazias atravessando o
//    relatório inteiro — que é ruído, não denúncia —, o aviso vive uma vez em `limitacoes[]`, e
//    diz o que importa: **o `valorContabil` está sem esses descontos**.
// 2. **A segregação do item 6.5 tem TRÊS estados, não dois.** `flagST` e `flagMonofasico` não têm
//    um escritor sequer (ver `FLAGS_TEM_ESCRITOR`), então `false` no banco não quer dizer "conferi
//    e não é ST" — quer dizer "ninguém nunca olhou". Ler esse `false` como a opção *"Sem
//    substituição tributária/…"* seria responder uma pergunta da Receita por default, com
//    confiança, em nome do contribuinte. É a mesma classe de erro do zero fabricado, e a mesma
//    solução que `obrigatoriedadeDefis`/`obrigatoriedadeEfd` já usam neste projeto: o terceiro
//    estado, `INDETERMINADA`, que não afirma nem uma coisa nem outra.
// 3. **As 8 qualificações são MODELADAS mesmo vindo sempre vazias.** Omitir a dimensão faria o
//    relatório parecer completo; trazê-la vazia, com `estado: "NAO_APURADO"`, diz a verdade — "não
//    sabemos". O vocabulário completo viaja no topo (`vocabulario.qualificacoes`) para a tela
//    poder desenhar a coluna mesmo sem nenhum valor.
// 4. **O grupo NÃO CLASSIFICADO é a informação mais valiosa daqui.** `tipoReceita` é nulo em
//    16.153 de 16.153 itens em produção — a classificação existe (aba Apuração → Sugestão →
//    "Classificar competência") e nunca foi usada. Esse grupo aparece nomeado, separado, nunca
//    somado no meio dos outros, e o total dele sobe para o topo (`naoClassificado`) para a tela
//    poder avisar ANTES do total.
//
// ⚠ N PARCELAS NA MESMA ATIVIDADE — a forma daqui NÃO impede.
// O manual (item 6.5, p. 26) diz que uma mesma linha de atividade pode ter várias parcelas de
// receita com qualificações diferentes; a tela do PGDAS-D tem um "+" exatamente para isso. A
// unidade deste relatório é o **item da nota**, que é mais fino que a atividade, e a chave de
// grupo é `tipoReceita × segregação × qualificações` — subdividir é simplesmente produzir mais
// grupos, sem mudar estrutura nenhuma. O que QUEBRARIA isso é agrupar só por `tipoReceita`, ou
// colapsar as linhas para uma por nota. Não faça nenhum dos dois.
//
// ⚠ ZERO CHAMADA EXTERNA. Nem ADN, nem SEFAZ, nem SERPRO. Tudo aqui é leitura do nosso banco.

import { prisma } from "../../../../infrastructure/db/prisma.js";
import {
  faturamentoEmitDaCompetencia,
  notasEmitDaCompetencia,
} from "./FechamentoService.js";
import { calcularApuracaoLocal } from "./MotorApuracaoService.js";
import { ehCalculoNosso } from "./procedenciaDas.js";

export class RelatorioFaturamentoError extends Error {
  constructor(code, message, extra = {}) { super(message); this.code = code; Object.assign(this, extra); }
}

function round2(n) { return +Number(n || 0).toFixed(2); }

const MESES_PT = [
  "Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
  "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro",
];

function competenciaPorExtenso(competencia) {
  const [y, m] = String(competencia).split("-").map(Number);
  return `${MESES_PT[m - 1]}/${y}`;
}

/**
 * ⚠ A CHAVE DE TODA A HONESTIDADE DESTE ARQUIVO.
 *
 * `NotaItem.flagST` e `NotaItem.flagMonofasico` existem como coluna e **não têm escritor nenhum**:
 * `DfeSyncService.js:195-196` grava `it.flagST || false` a partir de itens que o `DfeParser` nunca
 * preenche, e a criação do item da NFS-e (`AdnNotasService.js:229`) não as toca. `NotaItem` também
 * não tem CST nem CSOSN, então não há de onde derivá-las.
 *
 * Enquanto isto for `false`, um `false` no banco **não é informação** — é o default da coluna. Por
 * isso a segregação do item 6.5 fica `INDETERMINADA` em vez de "Sem substituição tributária/…", e
 * as qualificações ficam `NAO_APURADO` em vez de lista vazia.
 *
 * No dia em que um parser passar a gravá-las: vire esta constante para `true`. A segregação passa a
 * ler `false` como a opção "Sem…", e as qualificações passam a ser afirmação. É uma linha, e o
 * teste `relatorioFaturamento.test.js` trava as duas leituras.
 */
export const FLAGS_TEM_ESCRITOR = false;

/**
 * Item 6.5 do Manual do PGDAS-D e DEFIS (pp. 23-26) — a segregação da receita de REVENDA, em duas
 * opções **mutuamente exclusivas**.
 *
 * ⚠ `rotuloOficial` é transcrição LITERAL do manual. Não reescreva para caber na tela: a tela
 * abrevia com `rotuloCurto` e mostra o texto integral onde couber (tooltip, quadro-resumo, PDF).
 * ⚠ `codigo` é NOSSO. A numeração oficial destas opções não foi conferida — foi exatamente
 * inventá-la que produziu o `01`/`02` do Scritta.
 */
export const SEGREGACAO_REVENDA = {
  SEM: {
    codigo: "SEM",
    rotuloOficial: "Sem substituição tributária/tributação monofásica/antecipação com encerramento de tributação",
    rotuloCurto: "Sem ST/monofásica/antecipação",
  },
  COM: {
    codigo: "COM",
    rotuloOficial: "Com substituição tributária/tributação monofásica/antecipação com encerramento de tributação",
    rotuloCurto: "Com ST/monofásica/antecipação",
  },
  INDETERMINADA: {
    codigo: "INDETERMINADA",
    // ⚠ Este NÃO é do manual — é nosso, e o rótulo diz isso. O manual só tem as duas opções acima;
    // o terceiro estado existe porque nós não temos o dado para escolher entre elas.
    rotuloOficial: null,
    rotuloCurto: "Segregação não apurada",
    motivo: "O portal não extrai ST nem tributação monofásica do XML (`flagST`/`flagMonofasico` não "
      + "têm escritor, e não há CST/CSOSN em `NotaItem`). Escolher \"Sem\" por ausência de dado "
      + "seria responder ao PGDAS-D por default, em nome do contribuinte.",
  },
};

/**
 * Item 6.6.1 do Manual do PGDAS-D e DEFIS (p. 27) — as OITO qualificações da receita.
 *
 * Lista **fechada**, na ordem do manual. `rotuloOficial` é transcrição; `codigo` é nosso.
 */
export const QUALIFICACOES = [
  { codigo: "ANTECIPACAO_COM_ENCERRAMENTO", rotuloOficial: "antecipação com encerramento de tributação" },
  { codigo: "SUBSTITUICAO_TRIBUTARIA", rotuloOficial: "substituição tributária" },
  { codigo: "TRIBUTACAO_MONOFASICA", rotuloOficial: "tributação monofásica" },
  { codigo: "EXIGIBILIDADE_SUSPENSA", rotuloOficial: "exigibilidade suspensa" },
  { codigo: "IMUNIDADE", rotuloOficial: "imunidade" },
  { codigo: "ISENCAO_REDUCAO", rotuloOficial: "isenção/redução" },
  { codigo: "ISENCAO_REDUCAO_CESTA_BASICA", rotuloOficial: "isenção/redução cesta básica" },
  { codigo: "LANCAMENTO_DE_OFICIO", rotuloOficial: "lançamento de ofício" },
];

/**
 * Rótulos dos NOSSOS tipos de receita — leitura literal dos comentários do enum `TipoReceita`
 * (`schema.prisma`), não tabela fiscal nova. O valor cru do enum viaja junto (`tipoReceita`) para a
 * tela nunca depender do rótulo.
 */
const TIPO_RECEITA_ROTULO = {
  REVENDA_MERCADORIA: "Revenda de mercadoria (Anexo I)",
  INDUSTRIALIZACAO: "Industrialização (Anexo II)",
  SERVICO_ANEXO_III: "Serviço — Anexo III",
  SERVICO_ANEXO_IV: "Serviço — Anexo IV",
  SERVICO_ANEXO_V: "Serviço — Anexo V",
  SERVICO_FATOR_R: "Serviço sujeito ao Fator R (Anexo III ou V)",
  RECEITA_NAO_CLASSIFICADA: "Receita classificada como NÃO CLASSIFICADA",
};

/**
 * Quem tem as duas opções Com/Sem do item 6.5 — confirmado em fonte primária.
 *
 * São a **linha 1** (revenda de mercadorias, exceto para o exterior) e a **linha 3** (venda de
 * mercadorias industrializadas pelo contribuinte, exceto para o exterior), com os MESMOS dois
 * rótulos. Ver `docs/segregacao-receitas-simples.md`, seção (A).
 *
 * ⚠ E SÓ ESSES DOIS. As linhas 11/12 (comunicação e transporte intermunicipal/interestadual)
 * também têm subdivisão com/sem ST de ICMS, mas o nosso enum `TipoReceita` **não tem valor** para
 * elas — não há o que segregar, e criar um seria inventar. Todo o resto sai com `segregacao: null`.
 */
const TIPOS_COM_SEGREGACAO_65 = new Set(["REVENDA_MERCADORIA", "INDUSTRIALIZACAO"]);

/**
 * ⚠ AS 14 LINHAS DE ATIVIDADE DA RFB — a estrutura comporta, o conteúdo ainda não existe.
 *
 * O Manual do PGDAS-D e DEFIS (RFB, versão de 17/06/2025), item 6.5, pp. 23-25, lista **14** linhas
 * de atividade; a base legal é a **Resolução CGSN 140/2018, art. 25, §1º, incisos I a IX** (o §3º
 * trata da exportação). O nosso enum `TipoReceita` tem **7** valores e foi desenhado para decidir
 * ANEXO, não para reproduzir a segregação da declaração.
 *
 * Os dois **não são a mesma lista**, e tratar os nossos 7 como se fossem os 14 da Receita seria
 * exatamente o erro do Scritta noutra direção: carimbar vocabulário privado num relatório fiscal.
 * Por isso cada grupo carrega `linhaAtividade`, com `origem: "TIPO_RECEITA_LOCAL"` e `rfb: null` —
 * o campo existe, está declarado como não resolvido, e quem for preencher sabe onde procurar.
 *
 * ⚠ A lista das 14 NÃO está transcrita aqui porque não a tenho em mãos. Inventá-la a partir do
 * nosso enum é o que este comentário existe para impedir.
 */
const LINHAS_ATIVIDADE_RFB = {
  // ⚠ A FONTE DE VERDADE É O ARQUIVO, NÃO ESTA CONSTANTE.
  // A lista abaixo é cópia da seção "(A) As 14 linhas de atividade" de
  // `docs/segregacao-receitas-simples.md`, que por sua vez cita o manual e foi escrita a partir de
  // leitura em fonte primária. Mudou alguma coisa? Muda-se LÁ primeiro, e só depois aqui — duas
  // transcrições independentes do mesmo manual divergiriam, e a divergência apareceria num
  // relatório fiscal.
  fonte: "docs/segregacao-receitas-simples.md, seção (A) — transcrito do Manual do PGDAS-D e DEFIS "
    + "(RFB, 17/06/2025), item 6.5, pp. 23-25",
  baseLegal: "Resolução CGSN 140/2018, art. 25, §1º, incisos I a IX (§3º para exportação)",
  quantidade: 14,
  itens: [
    { linha: 1, descricao: "Revenda de mercadorias, exceto para o exterior", mercado: "INTERNO", temSegregacaoComSem: true },
    { linha: 2, descricao: "Revenda de mercadorias para o exterior", mercado: "EXTERIOR", temSegregacaoComSem: false },
    { linha: 3, descricao: "Venda de mercadorias industrializadas pelo contribuinte, exceto para o exterior", mercado: "INTERNO", temSegregacaoComSem: true },
    { linha: 4, descricao: "Venda de mercadorias industrializadas pelo contribuinte para o exterior", mercado: "EXTERIOR", temSegregacaoComSem: false },
    { linha: 5, descricao: "Locação de bens móveis, exceto para o exterior", mercado: "INTERNO", temSegregacaoComSem: false },
    { linha: 6, descricao: "Locação de bens móveis para o exterior", mercado: "EXTERIOR", temSegregacaoComSem: false },
    { linha: 7, descricao: "Prestação de serviços, exceto para o exterior", mercado: "INTERNO", temSegregacaoComSem: false, subOpcoes: 10 },
    { linha: 8, descricao: "Serviços dos subitens 7.02, 7.05 e 16.1 da LC 116/2003, exceto para o exterior", mercado: "INTERNO", temSegregacaoComSem: false, subOpcoes: 9 },
    { linha: 9, descricao: "Prestação de serviços para o exterior", mercado: "EXTERIOR", temSegregacaoComSem: false, subOpcoes: 4 },
    { linha: 10, descricao: "Serviços dos subitens 7.02 e 7.05 da LC 116/2003, para o exterior", mercado: "EXTERIOR", temSegregacaoComSem: false, subOpcoes: 2 },
    { linha: 11, descricao: "Comunicação; transporte intermunicipal/interestadual de carga e de passageiros (art. 17, VI, LC 123), exceto para o exterior", mercado: "INTERNO", temSegregacaoComSem: false, subOpcoes: 4 },
    { linha: 12, descricao: "Idem (comunicação; transporte intermunicipal/interestadual), para o exterior", mercado: "EXTERIOR", temSegregacaoComSem: false, subOpcoes: 2 },
    { linha: 13, descricao: "Atividades com incidência simultânea de IPI e de ISS, exceto para o exterior", mercado: "INTERNO", temSegregacaoComSem: false, subOpcoes: 3 },
    { linha: 14, descricao: "Atividades com incidência simultânea de IPI e de ISS para o exterior", mercado: "EXTERIOR", temSegregacaoComSem: false },
  ],
  aviso: "O de-para do enum LOCAL `TipoReceita` (7 valores, desenhados para decidir ANEXO) para "
    + "estas 14 linhas é PARCIAL por construção, e cada grupo declara o que falta em "
    + "`linhaAtividade.rfb.faltam`. Um de-para que se apresentasse como completo sendo parcial "
    + "seria pior que não ter de-para nenhum.",
  dimensoesFaltantes: {
    mercado: "Interno × exterior. Separa a linha 1 da 2, a 3 da 4, a 7 da 9. Existe em "
      + "`ApuracaoConfigMemory.mercado` (da FORMA da apuração, não da nota) e em "
      + "`NotaItem.flagExportacao`, que é `false` em 16.153/16.153 itens — o único escritor é o "
      + "parser de NF-e (CFOP 7xxx), e a criação do item da NFS-e nunca o toca.",
    estado_iss: "Sem retenção com ISS a outro município · sem retenção com ISS ao próprio · com "
      + "retenção/substituição. É um dos eixos das 10 sub-opções da linha 7. **Não existe campo "
      + "nenhum** para isto em `PortalInvoice`/`NotaItem` (`issRetido` só existe em "
      + "`ServiceInvoice`, que é emissão, não captura).",
    escritorio_contabil_iss_fixo: "Sub-opção própria da linha 7 (CGSN 140/2018, art. 25, §1º, "
      + "VIII). Não sai do nosso enum nem de nenhum campo da nota.",
    subitem_lc116: "Se o serviço é dos subitens 7.02, 7.05 ou 16.1 da LC 116/2003, a linha deixa "
      + "de ser a 7 e passa a ser a 8 (ou a 10, no exterior). `NotaItem.codigoServico` existe, mas "
      + "o de-para código→subitem não está construído — e ele é frequentemente genérico ou ausente.",
    segregacao: "As opções Com/Sem do item 6.5 (linhas 1 e 3). Ver `SEGREGACAO_REVENDA` e "
      + "`FLAGS_TEM_ESCRITOR`: hoje a resposta é `INDETERMINADA` para todo item.",
  },
};

/**
 * O de-para PARCIAL do nosso enum para a linha da RFB.
 *
 * ⚠ PARCIAL É O PONTO, NÃO UM DEFEITO A ESCONDER. O nosso `TipoReceita` decide **anexo**; a linha
 * da RFB decide **linha da declaração**, e ela cruza dimensões que o enum não carrega (mercado,
 * estado do ISS, escritório contábil com ISS fixo, subitem da LC 116). Por isso cada entrada traz
 * `completo: false` e a lista NOMEADA do que falta, mais as linhas alternativas que passariam a
 * valer se a dimensão que falta viesse com outro valor.
 */
const DEPARA_TIPO_RECEITA_LINHA_RFB = {
  REVENDA_MERCADORIA: { linha: 1, faltam: ["mercado"], linhasAlternativas: [2] },
  INDUSTRIALIZACAO: { linha: 3, faltam: ["mercado"], linhasAlternativas: [4] },
  SERVICO_ANEXO_III: { linha: 7, faltam: ["mercado", "estado_iss", "subitem_lc116"], linhasAlternativas: [8, 9, 10] },
  SERVICO_ANEXO_IV: { linha: 7, faltam: ["mercado", "estado_iss", "subitem_lc116"], linhasAlternativas: [8, 9, 10] },
  SERVICO_ANEXO_V: { linha: 7, faltam: ["mercado", "estado_iss", "subitem_lc116"], linhasAlternativas: [8, 9, 10] },
  SERVICO_FATOR_R: { linha: 7, faltam: ["mercado", "estado_iss", "subitem_lc116"], linhasAlternativas: [8, 9, 10] },
  // ⚠ `RECEITA_NAO_CLASSIFICADA` fica de fora de propósito: não é uma atividade, é a ausência de
  // classificação. Dar-lhe uma linha da RFB seria fabricar a resposta que o relatório existe para
  // dizer que não temos.
};

export const CHAVE_NAO_CLASSIFICADO = "NAO_CLASSIFICADO";

/**
 * ⚠ "NUNCA RECEBEMOS O DETALHE" NÃO É "NINGUÉM CLASSIFICOU". São dois blocos.
 *
 * A NF-e capturada pelo RESUMO do DFe (`resNFe`) não traz itens — `DfeParser.js:165` devolve
 * `items: []` explicitamente, porque o resumo não é o XML da nota. Jogá-la no grupo "não
 * classificado" misturaria *"temos o detalhe e ninguém classificou"* (que se resolve com um
 * clique em Classificar competência) com *"nunca recebemos o detalhe"* (que se resolve
 * manifestando/baixando a NF-e completa). São causas diferentes, ações diferentes e responsáveis
 * diferentes.
 *
 * É a mesma separação que o projeto já faz em `lib/entregaPgdas.js` (cinco procedências), no
 * tri-estado de `semFaturamento` e no painel de captura do ADN: "não sabemos" nunca se parece com
 * "não fizemos".
 *
 * ⚠ ELE SOMA NO TOTAL DO MÊS — a receita existe e está no valor contábil. O que ele não faz é
 * contar como receita não classificada.
 */
export const CHAVE_SEM_DETALHE = "SEM_DETALHE_CAPTURADO";

/**
 * O MODELO do documento.
 *
 * NF-e: não existe campo `modelo` no `PortalInvoice`; ele é derivável da chave de acesso, que tem
 * 44 dígitos e leiaute fixo (cUF 0-1 · AAMM 2-5 · CNPJ 6-19 · **mod 20-21** · série 22-24 ·
 * nNF 25-33). Os fatiamentos de série e número já em uso em `DfeParser.js` (`slice(22,25)` e
 * `slice(25,34)`) confirmam o deslocamento.
 *
 * NFS-e: **não tem modelo**, e inventar um seria preencher coluna com suposição. A chave da NFS-e
 * Nacional nem tem 44 dígitos — por isso a guarda é o comprimento exato, e não "tem chave".
 */
export function modeloDoDocumento(nota) {
  const chave = String(nota?.chaveAcesso || "").replace(/\D+/g, "");
  const tipo = String(nota?.type || "").toUpperCase();
  if (chave.length === 44) {
    return { modelo: chave.slice(20, 22), rotulo: chave.slice(20, 22), fonte: "chaveAcesso" };
  }
  if (tipo.includes("NFSE")) return { modelo: null, rotulo: "NFS-e", fonte: "tipo_documento" };
  return { modelo: null, rotulo: tipo || null, fonte: tipo ? "tipo_documento" : null };
}

/**
 * A segregação do item 6.5 para um item — três estados (ver `FLAGS_TEM_ESCRITOR`).
 * `null` quando o tipo de receita não é daqueles em que o manual faz essa pergunta.
 */
export function segregacaoDoItem(item, tipoReceita) {
  if (!tipoReceita || !TIPOS_COM_SEGREGACAO_65.has(tipoReceita)) return null;

  const temMarca = Boolean(item?.flagST) || Boolean(item?.flagMonofasico);
  if (temMarca) return { ...SEGREGACAO_REVENDA.COM, fonte: "flag_da_nota" };

  // ⚠ AQUI MORA A DECISÃO. Sem escritor, `false` é o default da coluna, não uma conferência.
  if (!FLAGS_TEM_ESCRITOR) return { ...SEGREGACAO_REVENDA.INDETERMINADA, fonte: "sem_dado" };
  return { ...SEGREGACAO_REVENDA.SEM, fonte: "flag_da_nota" };
}

/**
 * As qualificações (item 6.6.1) de um item.
 *
 * Hoje sempre `NAO_APURADO` com lista vazia — e é isso que o relatório precisa DIZER, não omitir.
 * A forma já suporta o dia em que houver dado: `codigos` é uma LISTA porque o manual permite mais
 * de uma qualificação na mesma parcela de receita.
 */
export function qualificacoesDoItem(item) {
  const codigos = [];
  if (item?.flagST) codigos.push("SUBSTITUICAO_TRIBUTARIA");
  if (item?.flagMonofasico) codigos.push("TRIBUTACAO_MONOFASICA");

  if (codigos.length) {
    return {
      estado: "APURADO",
      codigos,
      rotulos: codigos.map((c) => QUALIFICACOES.find((q) => q.codigo === c)?.rotuloOficial || c),
      motivo: null,
    };
  }
  return {
    estado: FLAGS_TEM_ESCRITOR ? "NENHUMA" : "NAO_APURADO",
    codigos: [],
    rotulos: [],
    motivo: FLAGS_TEM_ESCRITOR ? null
      : "O portal não extrai qualificação de receita do XML. Ausência aqui é falta de leitura, "
        + "não ausência de qualificação.",
  };
}

/**
 * A chave e o rótulo do grupo "Tipo de Operação", a partir do que EXISTE.
 *
 * ⚠ A chave inclui a segregação e as qualificações de propósito: é isso que permite uma mesma
 * atividade aparecer subdividida em N parcelas (manual, item 6.5, p. 26) sem mudar a estrutura.
 */
export function grupoDoItem(item, { semDetalhe = false } = {}) {
  const tipoReceita = item?.tipoReceita || null;

  // Nota da qual nunca recebemos o detalhe (resumo do DFe). Bloco PRÓPRIO — ver `CHAVE_SEM_DETALHE`.
  if (semDetalhe) {
    return {
      chave: CHAVE_SEM_DETALHE,
      rotulo: "SEM DETALHE CAPTURADO — o resumo do DFe não traz os itens da nota",
      tipoReceita: null,
      classificado: false,
      temDetalhe: false,
      linhaAtividade: linhaAtividadeDe(null),
      segregacao: null,
      qualificacoes: {
        estado: "NAO_APURADO", codigos: [], rotulos: [],
        motivo: "Nota sem itens capturados — não há o que qualificar.",
      },
    };
  }

  if (!tipoReceita) {
    // ⚠ NUNCA se mistura com os demais, e não ganha segregação nem qualificação: o item não
    // classificado não teve nada conferido, e afirmar qualquer dimensão dele seria inventar.
    return {
      chave: CHAVE_NAO_CLASSIFICADO,
      rotulo: "NÃO CLASSIFICADO — a competência não foi classificada",
      tipoReceita: null,
      classificado: false,
      temDetalhe: true,
      linhaAtividade: linhaAtividadeDe(null),
      segregacao: null,
      qualificacoes: { estado: "NAO_APURADO", codigos: [], rotulos: [], motivo: "Item ainda não classificado por tipo de operação." },
    };
  }

  const segregacao = segregacaoDoItem(item, tipoReceita);
  const qualificacoes = qualificacoesDoItem(item);
  const base = TIPO_RECEITA_ROTULO[tipoReceita] || tipoReceita;

  const partesChave = [tipoReceita];
  if (segregacao) partesChave.push(segregacao.codigo);
  if (qualificacoes.codigos.length) partesChave.push(qualificacoes.codigos.join("+"));

  const partesRotulo = [base];
  if (segregacao) partesRotulo.push(segregacao.rotuloCurto);
  if (qualificacoes.rotulos.length) partesRotulo.push(qualificacoes.rotulos.join(" · "));

  return {
    chave: partesChave.join("|"),
    rotulo: partesRotulo.join(" · "),
    tipoReceita,
    classificado: true,
    temDetalhe: true,
    linhaAtividade: linhaAtividadeDe(tipoReceita, segregacao),
    segregacao,
    qualificacoes,
  };
}

/**
 * A linha de atividade: o nosso código + a linha da RFB **declaradamente parcial**.
 *
 * ⚠ `rfb.completo` é SEMPRE `false` hoje, e `rfb.faltam` diz por quê, dimensão por dimensão. Um
 * de-para que se apresentasse como completo sendo parcial é pior que `rfb: null` — o `null` ao
 * menos não engana. Ver `DEPARA_TIPO_RECEITA_LINHA_RFB` e `LINHAS_ATIVIDADE_RFB`.
 *
 * @param {string|null} tipoReceita
 * @param {Object|null} segregacao — para acrescentar `"segregacao"` ao que falta quando a resposta
 *   Com/Sem do item 6.5 é `INDETERMINADA` (é uma das dimensões que faltam para chegar à sub-opção).
 */
function linhaAtividadeDe(tipoReceita, segregacao = null) {
  const base = {
    origem: "TIPO_RECEITA_LOCAL",
    codigo: tipoReceita,
    rotulo: tipoReceita ? (TIPO_RECEITA_ROTULO[tipoReceita] || tipoReceita) : null,
  };

  const dp = tipoReceita ? DEPARA_TIPO_RECEITA_LINHA_RFB[tipoReceita] : null;
  // Sem de-para (item não classificado, ou `RECEITA_NAO_CLASSIFICADA`): `rfb: null`, que é a
  // resposta honesta — não há atividade da qual falar.
  if (!dp) return { ...base, rfb: null };

  const faltam = [...dp.faltam];
  if (segregacao?.codigo === "INDETERMINADA") faltam.push("segregacao");

  const item = LINHAS_ATIVIDADE_RFB.itens.find((l) => l.linha === dp.linha) || null;
  return {
    ...base,
    rfb: {
      linha: dp.linha,
      descricao: item?.descricao || null,
      // ⚠ Nunca `true` enquanto as dimensões acima não existirem no banco.
      completo: false,
      faltam,
      // As linhas que passariam a valer se a dimensão que falta viesse com outro valor. É isto que
      // impede alguém de ler `linha: 7` como "é a 7" — pode ser a 8, a 9 ou a 10.
      linhasAlternativas: dp.linhasAlternativas,
      fonte: LINHAS_ATIVIDADE_RFB.fonte,
    },
  };
}

/** Os totais de um conjunto de linhas. Só o que medimos: contagem e valor contábil. */
function totalizar(linhas) {
  return {
    itens: linhas.length,
    valorContabil: round2(linhas.reduce((s, l) => s + Number(l.valorContabil || 0), 0)),
  };
}

/**
 * O rodapé de honestidade do relatório. Substitui as quatro colunas vazias que existiam antes —
 * mesma regra, um lugar só.
 */
const LIMITACOES = [
  {
    codigo: "VALOR_CONTABIL_SEM_DESCONTOS",
    titulo: "O valor contábil não tem os descontos de IPI, ST e ICMS-ST",
    efeito: "Não extraímos `vIPI`, `vST` nem `vICMSST` do XML hoje — não existe parser desses "
      + "campos em nenhum caminho de captura (NF-e ou NFS-e). O valor de cada linha é o valor "
      + "contábil do documento rateado pelos itens; um \"valor líquido\" não é calculável a partir "
      + "dele, e imprimir 0,00 nessas parcelas seria afirmar uma conferência que não houve.",
    // Deixado escrito para quem pegar a frente do parser: o dado EXISTE, e só de um lado.
    ondeEstaODado: "NF-e completa (`procNFe`): os valores estão no XML, que já guardamos inteiro "
      + "em `PortalInvoice.xmlRaw` — logo um backfill é possível sem recapturar. NFS-e: **não "
      + "existe** IPI/ST/ICMS-ST, são tributos que não incidem sobre o documento de serviço. NF-e "
      + "capturada só pelo resumo (`resNFe`) não tem XML completo e ficaria de fora do backfill.",
    frenteSeparada: true,
  },
  {
    codigo: "SEGREGACAO_65_NAO_APURADA",
    titulo: "A segregação do item 6.5 (com/sem ST, monofásica, antecipação) não é apurada",
    efeito: "`NotaItem.flagST` e `flagMonofasico` não têm escritor, e não há CST/CSOSN gravado. "
      + "As linhas de revenda saem como \"Segregação não apurada\" em vez de serem lançadas na "
      + "opção \"Sem substituição tributária/…\" por default.",
  },
  {
    codigo: "QUALIFICACOES_NAO_APURADAS",
    titulo: "As 8 qualificações do item 6.6.1 não são apuradas",
    efeito: "A dimensão aparece no relatório com `estado: \"NAO_APURADO\"` e o vocabulário "
      + "completo, em vez de ser omitida — omitir faria o relatório parecer completo.",
  },
];

/**
 * Monta o relatório. **Não grava nada** — nem o relatório, nem a apuração.
 */
export async function montarRelatorioFaturamento({ portalClientId, competencia }) {
  if (!portalClientId) throw new RelatorioFaturamentoError("MISSING_PORTAL", "portalClientId obrigatório");
  if (!/^\d{4}-\d{2}$/.test(String(competencia || ""))) {
    throw new RelatorioFaturamentoError("INVALID_COMPETENCIA", `Formato YYYY-MM esperado, recebido: ${competencia}`);
  }

  const empresa = await prisma.portalClient.findUnique({
    where: { id: String(portalClientId) },
    select: { id: true, razao: true, cnpj: true, municipio: true, uf: true },
  });
  if (!empresa) throw new RelatorioFaturamentoError("PORTAL_NOT_FOUND", "Empresa não encontrada");

  // ⚠ A POPULAÇÃO NÃO É REESCRITA. `notasEmitDaCompetencia` é a variante de
  // `faturamentoEmitDaCompetencia` (mesma cláusula, mesma janela) — ver o comentário lá.
  const notas = await notasEmitDaCompetencia(portalClientId, competencia);

  const gruposPorChave = new Map();
  let semItemNenhum = 0;
  let semItemValorado = 0;

  function pushLinha(meta, linha) {
    if (!gruposPorChave.has(meta.chave)) gruposPorChave.set(meta.chave, { ...meta, linhas: [] });
    gruposPorChave.get(meta.chave).linhas.push(linha);
  }

  for (const nota of notas) {
    const totalNota = Number(nota.total || 0);
    const mod = modeloDoDocumento(nota);
    const data = nota.issueDate || nota.competencia || null;
    const baseLinha = {
      notaId: nota.id,
      tipoDocumento: nota.type || null,
      numero: nota.numero || null,
      serie: nota.serie || null,
      chaveAcesso: nota.chaveAcesso || null,
      data: data ? new Date(data).toISOString() : null,
      modelo: mod.modelo,
      modeloRotulo: mod.rotulo,
      modeloFonte: mod.fonte,
      tomadorNome: nota.tomadorNome || null,
      tomadorDoc: nota.tomadorDoc || null,
    };

    const itens = Array.isArray(nota.itens) ? nota.itens : [];
    const somaItens = itens.reduce((s, it) => s + Number(it.valor || 0), 0);

    // Nota sem item, ou com itens que somam zero: não há por onde repartir o valor contábil.
    //
    // ⚠ ELA NÃO PODE SUMIR. O motor de apuração, nesse caso, multiplica os itens por escala 0 e o
    // valor da nota evapora do detalhe (embora continue na receita do mês) — aqui não dá: o total
    // do relatório tem de fechar com o faturamento da competência, senão o contador vê duas somas
    // diferentes do mesmo mês. A nota entra INTEIRA no grupo não classificado, com o motivo.
    if (!itens.length || somaItens <= 0) {
      // ⚠ DOIS CASOS DIFERENTES, DOIS BLOCOS DIFERENTES.
      //   · sem item nenhum  → nunca recebemos o detalhe (resumo do DFe) → SEM_DETALHE_CAPTURADO
      //   · itens que somam 0 → o detalhe VEIO, e é ele que não tem valor → NÃO CLASSIFICADO
      // O discriminador é o `motivoNaoClassificado` que já existia.
      const semDetalhe = !itens.length;
      if (semDetalhe) semItemNenhum += 1; else semItemValorado += 1;
      const meta = grupoDoItem(null, { semDetalhe });
      pushLinha(meta, {
        ...baseLinha,
        itemId: null,
        descricao: null,
        cfop: null,
        codigoServico: null,
        codigoOperacao: null,
        codigoOperacaoFonte: null,
        linhaAtividade: meta.linhaAtividade,
        segregacao: null,
        qualificacoes: meta.qualificacoes,
        valorContabil: round2(totalNota),
        motivoNaoClassificado: semDetalhe ? "nota_sem_item" : "itens_sem_valor",
      });
      continue;
    }

    // Rateio proporcional do total da nota pelos itens — a MESMA regra que a apuração usa
    // (`FechamentoService.receitaPorTipoMercado` / `MotorApuracaoService`). O total da nota é o
    // valor contábil; a soma dos itens pode divergir dele (frete, desconto), e usar o item cru
    // faria o rodapé do relatório discordar do faturamento da competência.
    const escala = totalNota / somaItens;
    for (const it of itens) {
      const meta = grupoDoItem(it);
      pushLinha(meta, {
        ...baseLinha,
        itemId: it.id,
        descricao: it.descricao || null,
        cfop: it.cfop || null,
        codigoServico: it.codigoServico || null,
        // NF-e classifica a operação pelo CFOP; NFS-e não tem CFOP — o análogo é o código do
        // serviço (LC 116). São campos diferentes e viajam separados; `codigoOperacao` é só a
        // conveniência de quem for imprimir uma coluna só, com a fonte declarada ao lado.
        codigoOperacao: it.cfop || it.codigoServico || null,
        codigoOperacaoFonte: it.cfop ? "cfop" : (it.codigoServico ? "codigoServico" : null),
        linhaAtividade: meta.linhaAtividade,
        segregacao: meta.segregacao,
        qualificacoes: meta.qualificacoes,
        valorContabil: round2(Number(it.valor || 0) * escala),
        ...(meta.classificado ? {} : { motivoNaoClassificado: "item_sem_tipo_receita" }),
      });
    }
  }

  // Ordem: classificados (por rótulo) → SEM DETALHE → NÃO CLASSIFICADO.
  // O não classificado fica por ÚLTIMO porque é o alarme; o sem-detalhe vem antes dele porque é
  // outra pergunta, com outra ação.
  const peso = (g) => (g.classificado ? 0 : (g.chave === CHAVE_SEM_DETALHE ? 1 : 2));
  const grupos = [...gruposPorChave.values()]
    .sort((a, b) => (peso(a) - peso(b)) || String(a.rotulo).localeCompare(String(b.rotulo), "pt-BR"))
    .map((g) => ({
      chave: g.chave,
      rotulo: g.rotulo,
      tipoReceita: g.tipoReceita,
      classificado: g.classificado,
      temDetalhe: g.temDetalhe,
      linhaAtividade: g.linhaAtividade,
      segregacao: g.segregacao,
      qualificacoes: g.qualificacoes,
      linhas: g.linhas,
      total: totalizar(g.linhas),
    }));

  const todasAsLinhas = grupos.flatMap((g) => g.linhas);
  const totalMes = totalizar(todasAsLinhas);

  const grupoSemDetalhe = grupos.find((g) => g.chave === CHAVE_SEM_DETALHE) || null;
  const grupoNaoClassificado = grupos.find((g) => g.chave === CHAVE_NAO_CLASSIFICADO) || null;

  // ⚠ Este bloco NÃO inclui o sem-detalhe. "Ninguém classificou" e "nunca recebemos o detalhe"
  // pedem ações diferentes, de pessoas diferentes — somá-los daria um número que não aponta para
  // lugar nenhum.
  const naoClassificado = {
    valorContabil: grupoNaoClassificado ? grupoNaoClassificado.total.valorContabil : 0,
    itens: grupoNaoClassificado ? grupoNaoClassificado.total.itens : 0,
    notasComItensSemValor: semItemValorado,
    fracaoDoTotal: totalMes.valorContabil > 0 && grupoNaoClassificado
      ? +(grupoNaoClassificado.total.valorContabil / totalMes.valorContabil).toFixed(4)
      : 0,
    // ⚠⚠ ISTO SAI NA TELA DO CONTADOR, e é por isso que não há caminho de API aqui. O texto
    // imprimia `(POST /firm/companies/:companyId/classificar-v2)` e o nome de coluna `tipoReceita`
    // entre crases — endereço interno e nome de campo, num aviso que ele lê para saber o que
    // CLICAR. Quem consome esta frase não tem como usar nenhum dos dois. O que ela diz continua
    // igual: onde clicar, e o que fica impedido enquanto não se clicar.
    comoResolver: "Aba Apuração → sub-aba Sugestão → botão \"Classificar competência\". "
      + "Enquanto a receita não estiver classificada, o relatório não consegue dizer de que tipo "
      + "de operação ela é — e o motor de apuração não calcula o DAS.",
  };

  const semDetalheCapturado = {
    valorContabil: grupoSemDetalhe ? grupoSemDetalhe.total.valorContabil : 0,
    notas: semItemNenhum,
    fracaoDoTotal: totalMes.valorContabil > 0 && grupoSemDetalhe
      ? +(grupoSemDetalhe.total.valorContabil / totalMes.valorContabil).toFixed(4)
      : 0,
    // Soma no total do mês: a receita existe e está contada. O que falta é o detalhe dela.
    somaNoTotal: true,
    // ⚠ MESMO CRITÉRIO: `resNFe`, `procNFe` e `items: []` são nomes do leiaute e da nossa
    // implementação. O contador precisa saber que veio o RESUMO e não a nota inteira, e o que
    // fazer — não o nome do elemento XML. A distinção (falta o documento × falta classificar)
    // continua explícita, porque é ela que manda o contador para o lugar certo.
    motivo: "A NF-e foi capturada pelo RESUMO do documento, que por definição não traz os itens "
      + "da nota. Não é falta de classificação: é falta do documento completo.",
    comoResolver: "Manifestar ou baixar a NF-e completa na aba Notas Fiscais. Com a nota inteira "
      + "os itens são gravados e ela passa a poder ser classificada.",
  };

  // ⚠ CONFERÊNCIA DO PRÓPRIO RELATÓRIO. O total das linhas TEM de bater com
  // `faturamentoEmitDaCompetencia` — a função que a apuração e o "mês sem faturamento" já usam.
  // Não bater significa que este relatório está contando a competência de um jeito e o resto do
  // portal de outro, que é precisamente o defeito que a reutilização da população existe para
  // impedir. Vai como DADO, não como exceção: um relatório que se recusa a aparecer esconde o
  // problema em vez de mostrá-lo.
  const faturamentoEmit = await faturamentoEmitDaCompetencia(portalClientId, competencia);
  const conferencia = {
    totalRelatorio: totalMes.valorContabil,
    faturamentoEmit,
    diferenca: round2(totalMes.valorContabil - faturamentoEmit),
    confere: Math.abs(totalMes.valorContabil - faturamentoEmit) < 0.01,
  };

  const ausenciaDeNotas = await montarAusenciaDeNotas({ portalClientId, competencia, totalMes });
  const preApurado = await montarPreApurado({ portalClientId, competencia, naoClassificado, totalMes });

  return {
    versao: 2,
    competencia,
    competenciaExtenso: competenciaPorExtenso(competencia),
    titulo: "Faturamento no Período - Consolidado",
    subtitulo: "Documentos Emitidos",
    empresa: {
      portalClientId: empresa.id,
      razaoSocial: empresa.razao,
      cnpj: empresa.cnpj,
      municipio: empresa.municipio || null,
      uf: empresa.uf || null,
    },
    // O vocabulário oficial viaja com o relatório para a tela poder desenhar as dimensões mesmo
    // quando nenhuma linha tem valor — e para o rótulo integral do manual estar disponível.
    vocabulario: {
      fonte: "Manual do PGDAS-D e DEFIS (RFB) — item 6.5 (pp. 23-26) e item 6.6.1 (p. 27)",
      avisoCodigos: "Os campos `codigo` são identificadores NOSSOS. A numeração oficial destas "
        + "opções não foi conferida — só os `rotuloOficial` vêm do manual, transcritos.",
      segregacaoRevenda: Object.values(SEGREGACAO_REVENDA),
      qualificacoes: QUALIFICACOES,
      linhasAtividadeRfb: LINHAS_ATIVIDADE_RFB,
    },
    naoClassificado,
    semDetalheCapturado,
    ausenciaDeNotas,
    gruposPorTipoOperacao: grupos,
    totalMes,
    // No modelo do Scritta o consolidado soma vários meses; aqui o período é SEMPRE uma
    // competência, então ele é igual ao total do mês. Fica como campo próprio para a tela poder
    // imprimir as duas linhas do modelo sem recalcular nada.
    totalConsolidado: totalMes,
    resumoPorTipoOperacao: grupos.map((g) => ({
      chave: g.chave,
      rotulo: g.rotulo,
      classificado: g.classificado,
      segregacao: g.segregacao,
      qualificacoes: g.qualificacoes,
      ...g.total,
    })),
    conferencia,
    preApurado,
    limitacoes: LIMITACOES,
  };
}

/**
 * ⚠ TOTAL ZERO É A LEITURA DE TRÊS SITUAÇÕES DIFERENTES, E O RELATÓRIO NÃO PODE ESCOLHER UMA.
 *
 * "Nenhuma nota encontrada" pode ser: a empresa não emitiu · o município está fora do ADN · o
 * cursor NSU travou ou o A1 venceu. As três dão zero no banco e significam coisas opostas — é o
 * mesmo problema que fez `semFaturamentoConferencia` existir.
 *
 * Este bloco **lê os dois sinais que o projeto já tem**, sem recriar nenhum:
 *   · `CompanyMonthlyCircular.semFaturamento` — tri-estado. `null` é "ninguém afirmou nada", que
 *     NÃO é o mesmo que "afirmaram que teve". Escrito só por `marcarSemFaturamento`, com as duas
 *     recusas (faturamento > 0 e conferência divergente), e com quem/quando gravados.
 *   · `ApuracaoSnapshot.conferenciaStatus` — `ok` · `divergente` · `nao_conferivel` · nunca
 *     conferida (`null`).
 *
 * `podeAfirmarAusencia` só é verdadeiro com **afirmação do contador** ou **conferência `ok`**.
 * Sem um dos dois, a resposta honesta é a do `mensagem`: "nenhuma nota encontrada — isto não é o
 * mesmo que ausência de receita".
 */
async function montarAusenciaDeNotas({ portalClientId, competencia, totalMes }) {
  const total = totalMes?.valorContabil ?? 0;

  const [circular, snap] = await Promise.all([
    prisma.companyMonthlyCircular.findUnique({
      where: { portalClientId_competencia: { portalClientId: String(portalClientId), competencia } },
      select: { semFaturamento: true, semFaturamentoEm: true, semFaturamentoPor: true, semFaturamentoConferencia: true },
    }).catch(() => null),
    prisma.apuracaoSnapshot.findUnique({
      where: { portalClientId_competencia: { portalClientId: String(portalClientId), competencia } },
      select: { conferenciaStatus: true, conferidaEm: true },
    }).catch(() => null),
  ]);

  const semFaturamentoAfirmado = {
    // ⚠ Tri-estado preservado: `null` viaja como `null`, nunca vira `false`.
    valor: circular?.semFaturamento ?? null,
    em: circular?.semFaturamentoEm ? new Date(circular.semFaturamentoEm).toISOString() : null,
    por: circular?.semFaturamentoPor || null,
    conferenciaNoMomento: circular?.semFaturamentoConferencia || null,
  };
  const conferenciaAdn = {
    status: snap?.conferenciaStatus || null,
    em: snap?.conferidaEm ? new Date(snap.conferidaEm).toISOString() : null,
  };

  const podeAfirmarAusencia = semFaturamentoAfirmado.valor === true || conferenciaAdn.status === "ok";

  return {
    aplicavel: total === 0,
    total,
    semFaturamentoAfirmado,
    conferenciaAdn,
    podeAfirmarAusencia,
    mensagem: total !== 0
      ? null
      : (podeAfirmarAusencia
        ? "Nenhuma nota na competência, e há confirmação: "
          + (semFaturamentoAfirmado.valor === true
            ? "o contador afirmou que o mês não teve faturamento."
            : "a conferência com o ADN fechou (`ok`).")
        : "Nenhuma nota encontrada — isto NÃO é o mesmo que ausência de receita. Zero também é o "
          + "que aparece quando o município está fora do ADN, quando o certificado A1 venceu ou "
          + "quando o cursor NSU travou. Para afirmar ausência: marque \"mês sem faturamento\" na "
          + "aba Lançamentos, ou rode a conferência com o ADN."),
  };
}

/**
 * Nomes de bloqueio do motor que a tela pode traduzir sem adivinhar. O texto é NOSSO (descreve o
 * estado do portal), não regra fiscal.
 */
const MOTIVO_BLOQUEIO = {
  // ⚠ Este texto SAI NA TELA do contador, dentro da caixa do pré-apurado. `tipoReceita` é nome de
  // coluna nossa — ele não tem como usar isso. Ficou o que descreve o estado e a consequência.
  RECEITA_NAO_CLASSIFICADA: "A receita da competência não está classificada — as notas ainda não "
    + "foram classificadas por tipo de operação, e sem isso não há anexo, não há alíquota e não "
    + "há DAS.",
  PENDENCIAS_ABERTAS: "Há pendências de classificação em aberto para esta empresa.",
  CADASTRO_FALTANDO: "A empresa não tem Cadastro Fiscal preenchido (regime + CNAE).",
  REGIME_INVALIDO: "A empresa não está cadastrada no Simples Nacional — o motor só apura SN.",
  FOLHA_12M_FALTANDO: "Há receita sujeita ao Fator R e a folha de 12 meses não foi informada.",
};

/**
 * O bloco do DAS — o NOSSO cálculo ao lado do número oficial, quando ele existe.
 *
 * ⚠ PROCEDÊNCIA É DADO, NÃO NOTA DE RODAPÉ. `origem: "MOTOR_LOCAL"` viaja junto do valor porque
 * um número de DAS sem dono é lido como "o que a Receita disse" — e não é: é uma conta nossa,
 * feita com a tabela versionada de alíquotas, para conferência.
 *
 * ⚠ NÃO PERSISTE. `calcularApuracaoLocal({ persistir: false })` — abrir um relatório não pode
 * mudar o estado da apuração da empresa.
 *
 * ⚠ ZERO CHAMADA AO SERPRO. O número oficial é LIDO do `ApuracaoSnapshot` que uma transmissão
 * anterior gravou; nada é consultado.
 *
 * ⚠ A RECUSA DO MOTOR É RESULTADO DE PRIMEIRA CLASSE, NÃO ERRO. Hoje ele recusa em 100% das
 * empresas: `MotorApuracaoService` devolve `bloqueada_pendencias` quando há receita não
 * classificada, e `tipoReceita` é nulo em 16.153/16.153 itens em produção. O relatório sai
 * inteiro assim mesmo — a parte do faturamento não depende do motor —, e este bloco devolve o
 * motivo NOMEADO e o TAMANHO do buraco (valor, fração e contagem de itens).
 */
async function montarPreApurado({ portalClientId, competencia, naoClassificado, totalMes }) {
  const snap = await prisma.apuracaoSnapshot.findUnique({
    where: { portalClientId_competencia: { portalClientId, competencia } },
    select: {
      estado: true, dasRetornadoSerpro: true, dasSimuladoSerpro: true,
      dasCalculadoLocal: true, dasCalculadoLocalProcedencia: true,
      numeroDeclaracao: true, reciboNumero: true, transmitidoEm: true, fechadaEm: true,
    },
  }).catch(() => null);

  // ⚠ TRÊS COLUNAS, TRÊS FATOS DIFERENTES — e a ordem em que a tela deve preferi-los é esta:
  // transmitido (a declaração existe na Receita) → simulado (a RFB calculou, nada foi declarado)
  // → o nosso motor. Colapsá-los num campo só foi o defeito que este bloco documentava.
  const ambigua = snap?.dasCalculadoLocal != null && !ehCalculoNosso(snap.dasCalculadoLocalProcedencia);
  const oficial = {
    fonte: "ApuracaoSnapshot",
    estado: snap?.estado || null,
    numeroDeclaracao: snap?.numeroDeclaracao || null,
    reciboNumero: snap?.reciboNumero || null,
    transmitidoEm: snap?.transmitidoEm ? new Date(snap.transmitidoEm).toISOString() : null,
    dasRetornadoSerpro: snap?.dasRetornadoSerpro != null ? Number(snap.dasRetornadoSerpro) : null,
    // A simulação oficial do PGDAS-D (`indicadorTransmissao:false`). É número DA RECEITA, mas não é
    // declaração: nada foi transmitido. Antes vinha misturado em `dasCalculadoLocal`.
    dasSimuladoSerpro: snap?.dasSimuladoSerpro != null ? Number(snap.dasSimuladoSerpro) : null,
    // ⚠ ESTE CAMPO SÓ VIAJA QUANDO A PROCEDÊNCIA É DESCONHECIDA — e aí vem rotulado assim.
    //
    // `dasCalculadoLocal` marcada `MOTOR_LOCAL` é o NOSSO número e não tem nada que fazer no bloco
    // "oficial": ela sai daqui como `null` e quem mostra o nosso cálculo é o bloco do motor, acima.
    // O que sobra são os snapshots gravados ANTES da separação, cuja procedência não pôde ser
    // provada por nenhum outro campo da linha. Esses continuam ambíguos, para sempre — a marca
    // existe justamente para não inventar de quem é o número.
    dasCalculadoLocalNoSnapshot: ambigua ? {
      valor: Number(snap.dasCalculadoLocal),
      procedenciaAmbigua: true,
      aviso: "Snapshot anterior à separação das colunas: a coluna `dasCalculadoLocal` era gravada "
        + "tanto pelo motor local quanto pela simulação oficial do PGDAS-D, e nada na linha diz "
        + "qual dos dois é este número. Não use como \"nosso cálculo\" sem conferir.",
    } : null,
  };

  // O tamanho do buraco, para viajar junto de qualquer recusa. Sai do MESMO agrupamento que o
  // relatório imprime — não de uma segunda contagem.
  const semClassificacao = {
    valorContabil: naoClassificado?.valorContabil ?? null,
    itens: naoClassificado?.itens ?? null,
    fracaoDoTotal: naoClassificado?.fracaoDoTotal ?? null,
    totalDaCompetencia: totalMes?.valorContabil ?? null,
  };

  let motor;
  try {
    motor = await calcularApuracaoLocal({ portalClientId, competencia, persistir: false });
  } catch (err) {
    return {
      origem: "MOTOR_LOCAL",
      ok: false,
      // ⚠ `null`, não 0: o motor não chegou a um número. Zero seria a afirmação "o DAS deste mês
      // é zero", que é a mesma mentira que a remoção das colunas de IPI/ST evita.
      das: null,
      estado: "erro_calculo",
      motivo: { code: err?.code || "ERRO", mensagem: err?.message || String(err) },
      blockers: [],
      semClassificacao,
      oficial,
      diferenca: null,
    };
  }

  if (!motor.ok) {
    const blockers = motor.blockers || [];
    const principal = blockers[0] || null;
    return {
      origem: "MOTOR_LOCAL",
      ok: false,
      das: null,
      estado: motor.estado || null,
      // O motivo NOMEADO, no singular, para a tela não ter de escolher dentro do array.
      motivo: principal ? {
        code: principal.tipo,
        mensagem: MOTIVO_BLOQUEIO[principal.tipo] || principal.mensagem || null,
        detalhe: principal.mensagem || null,
      } : null,
      blockers,
      semClassificacao,
      comoResolver: naoClassificado?.comoResolver || null,
      receitaPorTipo: motor.receitaPorTipo || null,
      oficial,
      diferenca: null,
    };
  }

  const das = motor.dasCalculadoLocal != null ? Number(motor.dasCalculadoLocal) : null;
  return {
    origem: "MOTOR_LOCAL",
    ok: true,
    das,
    persistido: false,
    rbt12: motor.rbt12 ?? null,
    fatorR: motor.fatorR || null,
    receitaPorTipo: motor.receitaPorTipo || null,
    receitaPorAnexo: motor.receitaPorAnexo || null,
    aliquotaEfetivaPorAnexo: motor.aliquotaEfetivaPorAnexo || null,
    divergencias: motor.divergencias || [],
    blockers: [],
    motivo: null,
    semClassificacao,
    oficial,
    // Só há diferença quando existem OS DOIS números. Comparar o nosso com um oficial ausente
    // produziria uma "divergência" que é só a falta do segundo valor.
    diferenca: das != null && oficial.dasRetornadoSerpro != null
      ? round2(das - oficial.dasRetornadoSerpro)
      : null,
  };
}

/** Gera (ou regera) e SALVA o relatório da competência. */
export async function gerarRelatorioFaturamento({ portalClientId, competencia, userId = null }) {
  const dados = await montarRelatorioFaturamento({ portalClientId, competencia });
  const geradoEm = new Date();
  const payload = { dados, geradoEm, geradoPor: userId ? String(userId) : null };

  const existing = await prisma.relatorioFaturamento.findUnique({
    where: { portalClientId_competencia: { portalClientId: String(portalClientId), competencia } },
    select: { id: true },
  });
  const relatorio = existing
    ? await prisma.relatorioFaturamento.update({ where: { id: existing.id }, data: payload })
    : await prisma.relatorioFaturamento.create({
      data: { ...payload, portalClientId: String(portalClientId), competencia },
    });
  return relatorio;
}

/** Lê o relatório salvo. `null` quando nunca foi gerado — ausência não é erro. */
export async function lerRelatorioFaturamento({ portalClientId, competencia }) {
  if (!/^\d{4}-\d{2}$/.test(String(competencia || ""))) {
    throw new RelatorioFaturamentoError("INVALID_COMPETENCIA", `Formato YYYY-MM esperado, recebido: ${competencia}`);
  }
  return prisma.relatorioFaturamento.findUnique({
    where: { portalClientId_competencia: { portalClientId: String(portalClientId), competencia } },
  });
}
