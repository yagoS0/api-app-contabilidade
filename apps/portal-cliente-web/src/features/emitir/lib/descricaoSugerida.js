// ⚠ ORIGEM: `apps/web/src/features/notas/lib/descricaoSugerida.js` (portal do escritório). MESMA
// REGRA, apps separados e sem código compartilhado entre eles — o mesmo arranjo de
// `consultaTomador.js`, `aliquotaEfetiva.js` e `municipioIbge.js` aqui do lado. Mudou lá, muda
// aqui: a frase que sai no DANFSe não pode depender de qual portal emitiu a nota.
//
// A DESCRIÇÃO DO SERVIÇO, SUGERIDA A PARTIR DO QUE JÁ ESTÁ NO CADASTRO.
//
// > Pedido do dono, 18/08/2026: *"a sugestão do campo descrição da nota, pode ser feito com
// > 'serviço prestado de' + 'atividade' + competência"*
// > Correção do mesmo dia, e ela troca a FONTE: *"não, a atividade é pré-configurada no cadastro do
// > cliente no portal do contador, devemos usar o máximo dos dados que já temos para facilitar."*
//
// ⚠⚠ ONDE ISTO SAI IMPRESSO. O que este módulo devolve vira o `xDescServ` da DPS e sai **no DANFSe
// que o tomador recebe**. Não é rótulo de tela: é texto de documento fiscal. Frase quebrada,
// redundante ou com dado de outra empresa chega ao cliente do cliente.
//
// ── A FONTE, MEDIDA (produção, 33 empresas, só leitura) ──────────────────────────────────────
//   `Company.atividades`            33/33 preenchido   ← ESTA
//   `Company.cnaePrincipal`         33/33
//   `Company.codigosServicoNacional` 2/33
//   `Company.codigoServicoMunicipal` 2/33
// A primeira ideia era a lista oficial do Anexo B (`lib/servicosNacionais/`), que é o texto que sai
// no DANFSe — mas ela depende do `codigoServicoNacional` da empresa, e ele existe em DUAS empresas
// da carteira inteira. Uma sugestão que só funciona para 2 de 33 não facilita nada. `atividades`
// cobre as 33, e é isso que o dono quer dizer com *"usar o máximo dos dados que já temos"*.
//
// ── O FORMATO, MEDIDO ────────────────────────────────────────────────────────────────────────
//   ["46.19-2-00 - Representantes comerciais e agentes do comércio…"]   ← código + " - " + texto
//   ["73.19-0-03 - Marketing direto"]
//   ["70.20-4-00 - Atividades de consultoria em gestão empresarial…"]
//   ["71.12-0-00","4120400","4399101","4399103"]                        ← CÓDIGOS NUS, sem texto
//
// ⚠⚠ CÓDIGO NU NÃO VIRA TEXTO. Não existe tabela CNAE→descrição neste repositório (o `CnaeAnexo`
// mapeia CNAE para ANEXO DO SIMPLES, que é outra coisa, de outra lei). Sem o texto ao lado do
// número não há descrição a oferecer, e inventá-la é exatamente o que a regra 1 do projeto proíbe.
// A forma `código - descrição` é RECONHECIDA; qualquer outra é NÃO RECONHECIDA, sem adivinhação.
//
// ⚠ E NÃO SE USA O CNAE COMO TEXTO DA NOTA POR CONTA PRÓPRIA: o que entra na frase é a DESCRIÇÃO
// que o contador cadastrou, nunca o número. "Serviço prestado: 46.19-2-00" não descreve nada.
//
// ── O PROBLEMA DE PORTUGUÊS, E A REGRA QUE O RESOLVE ─────────────────────────────────────────
// Aplicar a fórmula ao pé da letra quebra em português com muita frequência, e isso foi medido nas
// duas fontes possíveis. Na lista oficial do Anexo B, **61 dos 335 códigos começam com
// "Serviço(s)"** (34 deles literalmente "Serviços de …"): "Serviço prestado de Serviços de
// consultoria…". Nas descrições de CNAE o problema é maior e tem mais formas — "Atividades de
// consultoria em gestão empresarial" e, pior, os nomes de AGENTE no plural ("Representantes
// comerciais e agentes do comércio"), onde "prestado de Representantes comerciais" não é
// redundância, é frase errada.
//
// ⚠ NÃO EXISTE HEURÍSTICA CONFIÁVEL para decidir se "de" cabe antes de um sintagma nominal que não
// controlamos. Tentar é adivinhar gramática sobre texto de terceiro, e o erro sai impresso. Por
// isso a regra é DOIS RAMOS, e só dois:
//
//   1. A descrição já começa com "Serviço"/"Serviços" ⇒ **o prefixo SOME.** Ela já nomeia o
//      serviço; emendar produziria "serviço prestado de serviços de…".
//         → "Serviços de consultoria em gestão empresarial — competência 07/2026"
//   2. Qualquer outra ⇒ **"Serviço prestado: " + a descrição, inteira e intocada.**
//      Os DOIS PONTOS são a peça que faz isso funcionar sempre: eles introduzem uma aposição, que
//      aceita qualquer sintagma nominal — nome de atividade, nome de agente, plural, singular —
//      sem exigir concordância nem regência. É a mesma frase do dono ("serviço prestado"), com o
//      "de" trocado por um sinal que não pode brigar com o texto oficial.
//         → "Serviço prestado: Marketing direto — competência 07/2026"
//         → "Serviço prestado: Representantes comerciais e agentes do comércio — competência 07/2026"
//         → "Serviço prestado: Atividades de consultoria em gestão empresarial — competência 07/2026"
//
// ⚠ O TEXTO OFICIAL NÃO É REESCRITO. Nada de baixar caixa, cortar "Atividades de" ou reordenar: o
// único ajuste mecânico é tirar o ponto final da descrição, senão o " — competência 07/2026" ficaria
// depois de um ponto ("…empresarial. — competência 07/2026").
//
// ── AS TRAVAS ────────────────────────────────────────────────────────────────────────────────
// ⚠ SUGESTÃO NÃO É TRAVA. Este módulo só devolve texto e procedência; quem escreve no campo é a
// tela, e o que o contador digitar vence. Mesmo desenho de `emitir/lib/aliquotaEfetiva.js`.
// ⚠ SEM DADO, CAMPO VAZIO — nunca meia frase. Empresa sem atividade, com atividade sem texto, ou
// com várias sem uma que seja inequivocamente a do CNAE principal: `texto` volta `null` e `motivo`
// diz por quê. "Serviço prestado: — competência 08/2026" é pior que campo em branco.
// ⚠ MAIS DE UMA ATIVIDADE NÃO SE RESOLVE EM SILÊNCIO. Tenta-se casar com o `cnaePrincipal`
// (33/33 preenchido); sem casamento único, NÃO se elege ninguém — as opções voltam em `opcoes`
// para a tela oferecer, e resultado único não se autosseleciona. É o "encontra, nunca escolhe" que
// já vale na busca de município, de serviço nacional e de tomador.

/** Por que não há sugestão. Cada um tem frase própria — "sem dados" não ensina nada. */
export const SEM_SUGESTAO = {
  SEM_CADASTRO: "sem_cadastro",
  SEM_ATIVIDADE: "sem_atividade",
  SEM_DESCRICAO: "sem_descricao",
  VARIAS: "varias",
};

/** Como a atividade foi escolhida — vai para a tela, junto do texto. */
export const ESCOLHA = {
  UNICA: "unica",
  CNAE_PRINCIPAL: "cnae_principal",
};

const COMECA_COM_LETRA = /^[A-Za-zÀ-ÖØ-öø-ÿ]/;

/**
 * Uma entrada de `Company.atividades` virando `{ bruto, codigo, descricao }`.
 *
 * ⚠ `descricao: null` é o caso do código nu, e ele é FREQUENTE (uma das quatro empresas medidas
 * tem as quatro atividades assim). Não é erro de cadastro a consertar aqui — é ausência de texto,
 * e ausência de texto é ausência de sugestão.
 *
 * O separador aceito é `-`, `–` ou `—`, e a descrição precisa **começar por letra**. Sem essa
 * conferência, `"71.12-0-00"` casaria com código `71.12-0` e descrição `"00"`: a busca pelo traço
 * encontra o traço de dentro do próprio CNAE.
 */
export function lerAtividade(bruto) {
  const texto = String(bruto ?? "").trim();
  if (!texto) return null;

  const m = /^([0-9][0-9.\-/]*)\s*[-–—]\s*(.+)$/.exec(texto);
  if (!m) {
    // Só o código (ou algo que não reconhecemos). Guardamos o bruto para a tela poder dizer o que
    // está cadastrado — sumir com ele faria o contador achar que o cadastro está vazio.
    return { bruto: texto, codigo: soDigitos(texto) || null, descricao: null };
  }

  const descricao = m[2].trim().replace(/\s+/g, " ");
  if (!COMECA_COM_LETRA.test(descricao)) {
    return { bruto: texto, codigo: soDigitos(texto) || null, descricao: null };
  }
  return { bruto: texto, codigo: soDigitos(m[1]) || null, descricao };
}

function soDigitos(v) {
  return String(v ?? "").replace(/\D+/g, "");
}

/** Todas as entradas do cadastro, na ordem em que estão gravadas. */
export function lerAtividades(atividades) {
  const lista = Array.isArray(atividades) ? atividades : atividades == null ? [] : [atividades];
  return lista.map(lerAtividade).filter(Boolean);
}

/**
 * QUAL ATIVIDADE. Devolve `{ escolhida, como, opcoes, motivo }`.
 *
 * ⚠ Com várias atividades COM texto e nenhuma que case de forma única com o `cnaePrincipal`, não se
 * elege nenhuma: `escolhida` volta `null` e `opcoes` traz as que têm texto, para a tela oferecer
 * sem pré-selecionar. Escolher a primeira da lista seria o sistema decidindo o que vai escrito na
 * nota — e a ordem de um `String[]` não significa nada.
 */
export function escolherAtividade(atividades, cnaePrincipal) {
  const todas = lerAtividades(atividades);
  if (!todas.length) return { escolhida: null, como: null, opcoes: [], motivo: SEM_SUGESTAO.SEM_ATIVIDADE };

  const comTexto = todas.filter((a) => a.descricao);
  if (!comTexto.length) {
    return { escolhida: null, como: null, opcoes: [], motivo: SEM_SUGESTAO.SEM_DESCRICAO };
  }
  if (comTexto.length === 1) {
    return { escolhida: comTexto[0], como: ESCOLHA.UNICA, opcoes: comTexto, motivo: null };
  }

  const principal = soDigitos(cnaePrincipal);
  const casam = principal ? comTexto.filter((a) => a.codigo && a.codigo === principal) : [];
  if (casam.length === 1) {
    return { escolhida: casam[0], como: ESCOLHA.CNAE_PRINCIPAL, opcoes: comTexto, motivo: null };
  }

  return { escolhida: null, como: null, opcoes: comTexto, motivo: SEM_SUGESTAO.VARIAS };
}

/** `"2026-07"` ou `"2026-07-15"` viram `"07/2026"`. Fora da forma, `null` — nunca um mês inventado. */
function mmAaaa(competencia) {
  const m = /^(\d{4})-(\d{2})/.exec(String(competencia ?? ""));
  return m ? `${m[2]}/${m[1]}` : null;
}

/**
 * A FRASE. Ver a regra de dois ramos no cabeçalho.
 *
 * ⚠ SEM COMPETÊNCIA, A FRASE SAI SEM A CLÁUSULA DE COMPETÊNCIA — e não sai pela metade. No
 * assistente do contador o campo de competência nasce vazio (a nota sem `dCompet` recebe a data de
 * hoje no servidor); exigir os três pedaços faria a sugestão nunca aparecer ali. "Serviço prestado:
 * Marketing direto" é uma descrição completa e verdadeira; "…— competência" pendurado não seria.
 */
export function montarFrase(descricaoAtividade, competencia) {
  const nucleo = String(descricaoAtividade ?? "").trim().replace(/\s+/g, " ").replace(/[.;]+$/, "").trim();
  if (!nucleo) return null;

  // Ramo 1: a descrição já é o serviço. O prefixo some em vez de duplicar a palavra.
  const jaEhServico = /^servi[çc]os?\b/i.test(nucleo);
  const corpo = jaEhServico ? nucleo : `Serviço prestado: ${nucleo}`;

  const comp = mmAaaa(competencia);
  return comp ? `${corpo} — competência ${comp}` : corpo;
}

/**
 * A SUGESTÃO INTEIRA, pronta para a tela.
 *
 * @param atividades      `legacyCompany.atividades` (String[])
 * @param cnaePrincipal   `legacyCompany.cnaePrincipal`
 * @param competencia     a competência da nota — `"YYYY-MM"` (contador) ou `"YYYY-MM-DD"` (cliente)
 * @param temCadastro     a tela recebeu o cadastro da empresa? ⚠ Prop ausente ≠ cadastro vazio:
 *                        sem o cadastro esta tela não afirma que a empresa não tem atividade.
 *
 * @returns `{ texto, procedencia, motivo, opcoes, atividade }` — `texto: null` quando não há o que
 *          sugerir, sempre com `motivo` preenchido.
 */
export function sugerirDescricaoDaNota({ atividades, cnaePrincipal, competencia, temCadastro = true } = {}) {
  if (!temCadastro) {
    return { texto: null, procedencia: null, motivo: SEM_SUGESTAO.SEM_CADASTRO, opcoes: [], atividade: null };
  }

  const escolha = escolherAtividade(atividades, cnaePrincipal);
  if (!escolha.escolhida) {
    return { texto: null, procedencia: null, motivo: escolha.motivo, opcoes: escolha.opcoes, atividade: null };
  }

  const texto = montarFrase(escolha.escolhida.descricao, competencia);
  if (!texto) {
    return { texto: null, procedencia: null, motivo: SEM_SUGESTAO.SEM_DESCRICAO, opcoes: escolha.opcoes, atividade: null };
  }

  return {
    texto,
    procedencia: textoDaProcedencia(escolha),
    motivo: null,
    opcoes: escolha.opcoes,
    atividade: escolha.escolhida,
  };
}

/**
 * DE ONDE VEIO A FRASE — vai para a TELA, embaixo do campo.
 *
 * ⚠ Frase sem procedência é o que ninguém confere. O código do CNAE entra aqui (e só aqui, nunca na
 * nota) porque é por ele que se confere contra o cadastro.
 */
export function textoDaProcedencia(escolha) {
  if (!escolha?.escolhida) return null;
  const { codigo, descricao } = escolha.escolhida;
  const nomeDoCnae = codigo ? `${codigo} — ${descricao}` : descricao;
  if (escolha.como === ESCOLHA.CNAE_PRINCIPAL) {
    return `Sugerido a partir da atividade do cadastro que corresponde ao CNAE principal da empresa (${nomeDoCnae}).`;
  }
  return `Sugerido a partir da única atividade com descrição no cadastro da empresa (${nomeDoCnae}).`;
}

/**
 * POR QUE NÃO HÁ SUGESTÃO — e onde se resolve. O texto do "onde" muda por portal (o cliente não
 * edita o próprio cadastro), então ele entra por parâmetro em vez de existir em duas versões.
 *
 * ⚠⚠ ENCURTADO EM 19/08/2026 (dono, com a tela do cliente na frente: *"esse tanto de legenda é
 * desnecessário"*), E O QUE SAIU FOI SÓ A NOSSA MECÂNICA. Saiu *"e não deduzimos o texto a partir
 * do número do CNAE"*: isso explica como o PORTAL raciocina, e o cliente não tem o que fazer com
 * essa informação. **Ficou tudo o que responde a pergunta dele:** que não há sugestão (senão o
 * campo vazio vira mistério), por quê, e a quem pedir. Encolher não é apagar a distinção — a
 * ausência continua NOMEADA, com motivo próprio para cada caso.
 */
export function textoDoMotivo(motivo, { ondeSeResolve = "" } = {}) {
  const onde = ondeSeResolve ? ` ${ondeSeResolve}` : "";
  if (motivo === SEM_SUGESTAO.SEM_CADASTRO) return null; // esta tela não recebeu o cadastro: não afirma nada
  if (motivo === SEM_SUGESTAO.SEM_ATIVIDADE) {
    return `Sem sugestão: esta empresa não tem atividade cadastrada.${onde}`;
  }
  // ⚠⚠ ESTE TEXTO SAIU DA TELA EM 19/08/2026 — pedido do dono, com a tela na frente. Era:
  // *"Sem sugestão: as atividades cadastradas têm só o código, sem o texto. Quem cadastra a
  // atividade é o seu escritório de contabilidade."*
  //
  // ⚠ A REGRA CONTINUA VIVA: `SEM_SUGESTAO.SEM_DESCRICAO` continua sendo CLASSIFICADO por
  // `motivoDaAusencia` e continua viajando no retorno — quem perguntar por que não houve sugestão
  // continua tendo a resposta em DADO. O que saiu foi o consumo visível, e `null` aqui é o mesmo
  // caminho que `SEM_CADASTRO` já usava: a tela simplesmente não renderiza a linha.
  //
  // ⚠ OS OUTROS DOIS MOTIVOS CONTINUAM NA TELA de propósito, e não é inconsistência: `SEM_ATIVIDADE`
  // e `VARIAS` pedem AÇÃO de quem está emitindo (cadastrar a atividade; escolher entre as que
  // existem). Este aqui não pedia nada — o cliente não edita o próprio cadastro, e o campo de
  // descrição logo abaixo está livre para ele escrever.
  if (motivo === SEM_SUGESTAO.SEM_DESCRICAO) return null;
  if (motivo === SEM_SUGESTAO.VARIAS) {
    // ⚠ "nenhuma delas é, sem dúvida, a do CNAE principal" descrevia a NOSSA tentativa de casar a
    // atividade com o CNAE — o mesmo tipo de frase que saiu em 19/08 ("não deduzimos o texto a
    // partir do número do CNAE"). O cliente não escolhe pelo CNAE; ele escolhe pelo que prestou.
    // ⚠ A ausência continua NOMEADA ("Sem sugestão"), que é o que impede o campo vazio de virar
    // mistério — e o que fazer continua na segunda oração.
    return "Sem sugestão: esta empresa tem mais de uma atividade. Escolha abaixo ou escreva a descrição.";
  }
  return null;
}
