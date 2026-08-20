// A CLASSIFICAÇÃO DE CADA LINHA DA PLANILHA — função PURA, lista de estados FECHADA.
//
// ⚠⚠ **NADA AQUI EMITE, CONSULTA OU ESCREVE.** Sem `prisma`, sem `axios`, sem `fetch`, sem `Date.now`
// implícito. A função recebe o que já se sabe e devolve o que a linha É. Quem lê o banco, quem
// consulta a Receita e quem (um dia) emite são outros — e é essa separação que torna a regra
// testável sem banco e sem rede.
//
// > Dono (19/08/2026): *"se o CNPJ preenchido for de um tomador que já teve antes, só preencher; se
// > não teve consultamos na API; e se a API não retornar nós avisamos isso em uma tela para ajuste
// > daquela nota."*
//
// ─── OS QUATRO ESTADOS, E POR QUE SÃO QUATRO ────────────────────────────────────────────────────
//
//   PRONTA     nada falta e nada ficou por provar.
//   CONFERIR   a linha está completa, mas carrega uma afirmação que ESTA camada não conseguiu
//              provar, ou um dado que NÓS mudamos. Uma pessoa precisa olhar. Não bloqueia.
//   CONSULTAR  falta o endereço, o documento é CNPJ e ninguém consultou ainda. A consulta resolve.
//   PENDENTE   falta algo que só uma pessoa resolve. Espera ajuste.
//
// ⚠⚠ **LISTA FECHADA, E O PADRÃO É NÃO SER "PRONTA".** `PRONTA` exige que as duas listas
// (`pendencias` e `conferencias`) estejam vazias E que o endereço tenha sido resolvido por uma
// origem conhecida. Estado que ninguém previu cai em `PENDENTE`, nunca em `PRONTA`: numa planilha
// de 200 linhas, o erro que se paga caro é a linha ruim passando por boa.
//
// ⚠ **UMA LINHA RUIM NÃO INVALIDA A PLANILHA.** Esta função classifica UMA linha e não conhece as
// outras. As boas seguem; a ruim espera.
//
// ─── ⚠⚠ O QUE PREENCHE O TOMADOR (NOME, E-MAIL E ENDEREÇO), NESTA ORDEM ─────────────────────────
//
// > Dono (20/08/2026): *"não precisamos de nada do tomador, apenas o CNPJ ou CPF. Em caso que
// > precise de mais informações, na hora da revisão nós avisamos e permitimos o preenchimento."*
// > E, sobre o município: *"só deve ser preenchido pelo cliente se a consulta do CNPJ não retornar;
// > aí sim deixa para que ele preencha na revisão."*
//
//   1. **A REVISÃO** — a célula que uma PESSOA digitou na tela de ajuste. Ela vence, sempre: é a
//      mesma regra do `aplicarEndereco`/`aplicarNome` do portal ("o que a pessoa digitou vence a
//      consulta"), e a memória pode estar velha.
//      ⚠ Desde 20/08/2026 estas células **não vêm mais da planilha** — nome, e-mail e endereço
//      deixaram de ser colunas (ver `colunasLote.js`). Elas só existem se alguém as preencheu na
//      revisão, e é por isso que a origem se chama REVISÃO e não PLANILHA.
//   2. **A MEMÓRIA** (`tomadores_emitidos`) — o *"se já teve antes, só preencher"* do dono.
//   3. **A CONSULTA**, e só para CNPJ.
//
// ⚠⚠ **NÃO EXISTE QUARTA ORIGEM, E O MUNICÍPIO NÃO TEM PADRÃO NENHUM.** Nada é preenchido a partir
// do cadastro da EMPRESA, da última nota, de proximidade ou de semelhança. Um município
// pré-preenchido com a cidade da empresa faria toda nota para tomador de fora sair com a cidade
// errada — **e parecendo conferida**, porque o campo estaria cheio. Valor escolhido pelo sistema
// fica indistinguível de valor conferido por uma pessoa; é a mesma razão pela qual a série da DPS e
// o código de serviço não nascem preenchidos.
//
// ⚠⚠ **CPF NÃO SE CONSULTA. NUNCA.** Decisão do dono, registrada em `utils/cpf.js` e em
// `consultaTomador.js`: a BrasilAPI é base de **CNPJ**; consulta de CPF é serviço pago e traz LGPD
// junto (o tomador é terceiro). Então, para um CPF que nunca recebeu nota desta empresa, **não
// existe origem** nem para o nome nem para o endereço: a linha é PENDENTE na hora, a revisão
// pergunta, e nenhuma chamada é sequer sugerida. **Isso é a regra, não um buraco.**
//
// ⚠ **FALHA DA CONSULTA NÃO É ERRO DO CLIENTE.** É pendência daquela linha, com o motivo — é
// literalmente o que o dono descreveu ("se a API não retornar nós avisamos isso em uma tela para
// ajuste daquela nota"). Nada é preenchido por aproximação.

import {
  lerDocumentoDaPlanilha,
  lerValorDaPlanilha,
  lerCompetenciaDaPlanilha,
  lerEmailDaPlanilha,
} from "./celulasLote.js";
import { ENDERECO_EXIGIDO, CAMPOS_ENDERECO } from "./colunasLote.js";

export const ESTADO = Object.freeze({
  PRONTA: "pronta",
  CONFERIR: "conferir",
  CONSULTAR: "consultar",
  PENDENTE: "pendente",
});

/**
 * De onde veio cada dado do tomador (nome e endereço). `null` = não foi resolvido.
 *
 * ⚠ **`PLANILHA` VIROU `REVISAO` EM 20/08/2026, E NÃO É RENOMEAÇÃO COSMÉTICA.** Nome, e-mail e
 * endereço deixaram de ser colunas da planilha (dono: *"não precisamos de nada do tomador, apenas o
 * CNPJ ou CPF"*). Uma célula desses campos só existe porque alguém a preencheu na tela de revisão —
 * chamá-la de "planilha" mandaria a próxima sessão procurar uma coluna que não existe.
 */
export const ORIGEM_DO_DADO = Object.freeze({
  REVISAO: "revisao",
  MEMORIA: "memoria",
  CONSULTA: "consulta",
});

/**
 * Todos os códigos que esta função sabe produzir. Lista FECHADA — há teste varrendo o resultado de
 * todos os cenários e recusando código que não esteja aqui.
 */
export const PENDENCIA = Object.freeze({
  DOCUMENTO_AUSENTE: "documento_ausente",
  DOCUMENTO_FORA_DE_FORMA: "documento_fora_de_forma",
  DOCUMENTO_ZERO_A_ESQUERDA: "documento_zero_a_esquerda",
  CPF_DV_INVALIDO: "cpf_dv_invalido",
  NOME_AUSENTE: "nome_ausente",
  DESCRICAO_AUSENTE: "descricao_ausente",
  VALOR_AUSENTE: "valor_ausente",
  VALOR_AMBIGUO: "valor_ambiguo",
  VALOR_ILEGIVEL: "valor_ilegivel",
  VALOR_LONGO: "valor_longo",
  VALOR_NAO_POSITIVO: "valor_nao_positivo",
  VALOR_CASAS_DEMAIS: "valor_casas_demais",
  COMPETENCIA_AUSENTE: "competencia_ausente",
  COMPETENCIA_ILEGIVEL: "competencia_ilegivel",
  ENDERECO_INCOMPLETO: "endereco_incompleto",
  MUNICIPIO_FORA_DE_FORMA: "municipio_fora_de_forma",
  MUNICIPIO_INEXISTENTE: "municipio_inexistente",
  CPF_SEM_ENDERECO: "cpf_sem_endereco",
  CONSULTA_FALHOU: "consulta_falhou",
  CONSULTA_SEM_ENDERECO: "consulta_sem_endereco",
  CONSULTA_MUNICIPIO_NAO_PROVADO: "consulta_municipio_nao_provado",
  SEM_ENDERECO: "sem_endereco",
});

export const CONFERENCIA = Object.freeze({
  ZERO_A_ESQUERDA_RECUPERADO: "zero_a_esquerda_recuperado",
  MUNICIPIO_NAO_CONFERIDO: "municipio_nao_conferido",
  EMAIL_FORA_DE_FORMA: "email_fora_de_forma",
});

const TEXTO_DOCUMENTO = {
  [PENDENCIA.DOCUMENTO_AUSENTE]: "O CNPJ/CPF do tomador está em branco.",
  [PENDENCIA.DOCUMENTO_FORA_DE_FORMA]:
    "O CNPJ/CPF não tem 11 nem 14 dígitos. Confira o número — e confira também se a coluna da "
    + "planilha está formatada como TEXTO, porque o Excel apaga o zero da frente.",
  [PENDENCIA.DOCUMENTO_ZERO_A_ESQUERDA]:
    "Este documento parece um CPF que perdeu o zero da frente (o Excel apaga zeros à esquerda em "
    + "coluna numérica), mas o dígito verificador não fecha com nenhum zero recolocado. Não "
    + "completamos por conta própria: inventar dígito de CPF emite a nota contra outra pessoa. "
    + "Formate a coluna como TEXTO e digite o CPF completo.",
  [PENDENCIA.CPF_DV_INVALIDO]:
    "O dígito verificador deste CPF não confere — o número foi digitado errado. (Isto não prova "
    + "que o CPF existe, só que ele é bem formado.)",
};

const TEXTO_VALOR = {
  [PENDENCIA.VALOR_AUSENTE]: "O valor do serviço está em branco.",
  [PENDENCIA.VALOR_AMBIGUO]:
    "Este valor tem duas leituras possíveis — mil e quinhentos ou um e meio, conforme o separador "
    + "seja de milhar ou de decimal. Não convertemos: escreva o valor com vírgula nos centavos "
    + "(1500,00).",
  [PENDENCIA.VALOR_ILEGIVEL]: "Não é um valor em reais que se possa ler sem adivinhar.",
  [PENDENCIA.VALOR_LONGO]: "O valor é maior do que se consegue representar sem arredondar.",
  [PENDENCIA.VALOR_NAO_POSITIVO]: "O valor do serviço tem de ser maior que zero.",
  [PENDENCIA.VALOR_CASAS_DEMAIS]:
    "Este valor tem mais de duas casas decimais, então não é um valor em reais. Não arredondamos "
    + "por conta própria o valor de uma nota fiscal.",
};

function soDigitos(valor) {
  return String(valor ?? "").replace(/\D+/g, "");
}

function texto(valor) {
  const t = String(valor ?? "").trim();
  return t || null;
}

/**
 * Um bloco de endereço vindo de qualquer das três origens, na forma da DPS.
 *
 * ⚠ Aceita `CEP` e `cep` porque as origens divergem: o portal (`enderecoDaReceita`) devolve `CEP`
 * maiúsculo, como o XML; a tabela `tomadores_emitidos` guarda `cep`. A tradução é ESTA função e só
 * ela.
 */
function normalizarEndereco(bruto) {
  if (!bruto) return null;
  return {
    cMun: texto(bruto.cMun),
    cep: soDigitos(bruto.CEP ?? bruto.cep) || null,
    xLgr: texto(bruto.xLgr),
    nro: texto(bruto.nro),
    xCpl: texto(bruto.xCpl),
    xBairro: texto(bruto.xBairro),
  };
}

function faltantesDoEndereco(endereco) {
  return ENDERECO_EXIGIDO.filter(([campo]) => !endereco?.[campo]).map(([, rotulo]) => rotulo);
}

/**
 * O código IBGE que veio DA REVISÃO — aceito por VERIFICAÇÃO, nunca por confiança.
 *
 * ⚠⚠ **NINGUÉM DIGITA ESTE CÓDIGO.** *"Código do IBGE é abstração"* (dono, 20/08/2026), e a tela de
 * revisão não oferece um campo de sete dígitos: ela usa o seletor que já existe
 * (`portal-cliente-web/src/features/emitir/SeletorMunicipio.jsx`), que busca por NOME, mostra
 * município **e UF** em toda opção, não autosseleciona nem com resultado único, e devolve o código
 * junto da escolha. O código chega aqui **como consequência de uma escolha explícita**.
 *
 * ⚠⚠ **E É POR ISSO QUE NÃO EXISTE, EM LUGAR NENHUM DESTE MÓDULO, CONVERSÃO DE NOME EM CÓDIGO.**
 * Medido na lista oficial: **240 nomes de município cobrem 521 municípios** (cinco "Bom Jesus",
 * cinco "São Domingos"). Resolver por nome escolheria um deles em silêncio, e o erro só apareceria
 * como nota emitida no município errado — que não se corrige, se cancela.
 *
 * ⚠⚠ **AQUI SÓ DUAS DAS TRÊS PROVAS SÃO POSSÍVEIS, E ISSO É MEDIDO, NÃO PREGUIÇA.** A prova tripla
 * de `codigoMunicipioVerificado` (`portal-cliente-web/.../consultaTomador.js`) é: (1) 7 dígitos;
 * (2) existe na lista oficial do IBGE; (3) o município e a UF dessa linha batem com o
 * `municipio`/`uf` **da mesma resposta**. A prova 3 **não tem contra o que rodar aqui**: não há uma
 * "resposta" com nome e UF — há a escolha de uma pessoa, feita numa tela que já mostrava a UF de
 * cada opção. A prova 3 continua valendo INTEIRA no caminho da consulta, que é onde ela nasceu.
 *
 * ⚠⚠ **A LISTA OFICIAL DO IBGE NÃO É LIDA POR ESTE MÓDULO — ela é INJETADA.** Sem ela, o código
 * passa só pela FORMA e a linha sai marcada `municipio_nao_conferido`.
 *
 * ⚠ **ONDE ELA MORA MUDOU EM 20/08/2026, e o texto anterior aqui ficou falso.** Ele dizia que a
 * tabela morava "nos dois fronts (5.571 linhas, ~197 KB **cada**)" e que uma terceira cópia no
 * `apps/api` havia sido recusada em 19/08/2026. Hoje ela é **arquivo único**, em
 * `@contabilidade/shared/municipios-ibge` (`packages/shared`), consumido pelos dois portais.
 *
 * ⚠ **ISSO NÃO REABRE A RECUSA DE 19/08** — pelo contrário. O que se recusou lá foi **acrescentar**
 * uma terceira cópia; mover ELIMINA cópias (de duas para uma), que é o que o cabeçalho das duas
 * pedia por escrito. A decisão de mover é do dono, 20/08/2026.
 *
 * ⚠ **E ESTE MÓDULO CONTINUA PURO E CONTINUA RECEBENDO A LISTA POR PARÂMETRO.** Que o pacote seja
 * agora alcançável a partir do `apps/api` **não** significa que este arquivo passou a importá-lo:
 * ele não importa, o default de `municipios` continua `null`, e quem não passar a lista continua
 * recebendo `municipio_nao_conferido`. Trocar a injeção por um import aqui dentro é decisão à
 * parte, não uma consequência da mudança de lugar.
 *
 * ⚠⚠ **`municipio_nao_conferido` NÃO QUER DIZER "ACEITAMOS SEM CONFERIR" — QUER DIZER "A
 * CONFERÊNCIA É ADIANTE".** A tela de conferência do lote roda no FRONT, e **o front tem a lista**
 * (é a mesma que o cadastro da empresa e a emissão avulsa já usam). A prova completa não se perde:
 * ela muda de camada. É por isso que a linha marcada assim **NUNCA sai como `PRONTA`** — ela sai
 * como `CONFERIR`, e quem lê sabe que falta um passo.
 */
function conferirMunicipioDaRevisao(cMun, municipios) {
  const digitos = soDigitos(cMun);
  if (digitos.length !== 7) {
    return {
      ok: false,
      pendencia: PENDENCIA.MUNICIPIO_FORA_DE_FORMA,
      texto:
        `Não reconhecemos “${cMun}” como um município. Escolha o município do tomador na lista, na `
        + "revisão desta linha — o código do IBGE vem junto da escolha, e é a UF ao lado do nome "
        + "que separa os cinco “Bom Jesus” do país.",
    };
  }
  if (!Array.isArray(municipios) || municipios.length === 0) {
    return {
      ok: true,
      conferencia: CONFERENCIA.MUNICIPIO_NAO_CONFERIDO,
      texto:
        `O código IBGE ${digitos} tem a forma certa, mas não foi conferido contra a lista oficial `
        + "aqui — a conferência acontece na tela de ajuste, que tem a lista. Confira o município "
        + "antes de emitir.",
    };
  }
  const linha = municipios.find((m) => m?.[0] === digitos);
  if (!linha) {
    return {
      ok: false,
      pendencia: PENDENCIA.MUNICIPIO_INEXISTENTE,
      texto:
        `O código ${digitos} não existe na lista oficial do IBGE. Escolha o município do tomador na `
        + "lista, na revisão desta linha.",
    };
  }
  return { ok: true, municipio: `${linha[1]} / ${linha[2]}` };
}

/**
 * O `cMun` que veio da CONSULTA — provado AQUI, no servidor, e não aceito por afirmação do navegador.
 *
 * ─── ⚠⚠ O QUE MUDOU EM 20/08/2026, E POR QUE ────────────────────────────────────────────────
 *
 * Antes esta decisão era uma linha só: `if (consulta.cMunVerificado !== true) pendência`. Ou seja,
 * **a prova era um booleano que o navegador mandava**. Na emissão avulsa isso é uma nota por vez,
 * com uma pessoa olhando a tela; na emissão em LOTE seriam 50 notas fiscais a partir de uma
 * afirmação que o servidor nunca conferiu — e nota emitida no município errado não se corrige, se
 * cancela.
 *
 * Com a lista do IBGE alcançável pelo `apps/api` (Bloco A), o servidor **refaz a prova tripla**:
 *
 *   1. o código tem 7 dígitos;
 *   2. ele existe na lista oficial;
 *   3. o município e a UF daquela linha batem com o `municipio`/`uf` **da mesma resposta**.
 *
 * ⚠ **`cMunVerificado` NÃO É MAIS LIDO EM LUGAR NENHUM.** Não é que ele "também" seja conferido:
 * ele deixou de participar da decisão. Um front que mandasse `cMunVerificado: true` com um código
 * de outro município é RECUSADO aqui.
 *
 * ⚠ **A PROVA 3 EXIGE QUE A CONSULTA CARREGUE `municipio`/`uf` CRUS.** Sem eles não há contra o quê
 * conferir, e a resposta é PENDÊNCIA, não "passa assim mesmo" — falha fechado. É o que obriga o
 * front a relatar a resposta da BrasilAPI em vez de resumi-la num booleano.
 *
 * ⚠ **SEM A LISTA INJETADA, NADA É PROVADO** — e a linha cai em `municipio_nao_conferido`
 * (conferência ⇒ `CONFERIR`, nunca `PRONTA`), exatamente como já acontecia no caminho da planilha.
 * As duas origens passaram a falhar do mesmo jeito, de propósito: uma lista que não carregou não
 * pode significar "aceite sem conferir" em nenhum dos dois caminhos.
 */
function conferirMunicipioDaConsulta(cMun, consulta, municipios) {
  const digitos = soDigitos(cMun);
  if (digitos.length !== 7) {
    return {
      ok: false,
      pendencia: PENDENCIA.CONSULTA_MUNICIPIO_NAO_PROVADO,
      texto:
        "A consulta não trouxe um código de município com 7 dígitos. Não usamos código de "
        + "município sem prova: a nota sairia no município errado. Preencha o endereço nesta linha.",
    };
  }
  if (!Array.isArray(municipios) || municipios.length === 0) {
    return {
      ok: true,
      conferencia: CONFERENCIA.MUNICIPIO_NAO_CONFERIDO,
      texto:
        `O código IBGE ${digitos} veio da consulta com a forma certa, mas a lista oficial não pôde `
        + "ser carregada aqui para conferi-lo. Confira o município antes de emitir.",
    };
  }
  const linha = municipios.find((m) => m?.[0] === digitos);
  if (!linha) {
    return {
      ok: false,
      pendencia: PENDENCIA.CONSULTA_MUNICIPIO_NAO_PROVADO,
      texto:
        `A consulta trouxe o código ${digitos}, que não existe na lista oficial do IBGE. Preencha o `
        + "endereço nesta linha.",
    };
  }
  // ⚠ A PROVA 3. O nome e a UF vêm da MESMA resposta que trouxe o código — é isso que impede um
  // código válido de outro município passar por válido para ESTE tomador.
  const nomeDaResposta = String(consulta?.municipio ?? "").trim();
  const ufDaResposta = String(consulta?.uf ?? "").trim().toUpperCase();
  if (!nomeDaResposta || !ufDaResposta) {
    return {
      ok: false,
      pendencia: PENDENCIA.CONSULTA_MUNICIPIO_NAO_PROVADO,
      texto:
        `O código ${digitos} existe na lista oficial, mas a consulta não informou o NOME e a UF do `
        + "município para conferir se é o mesmo. Sem essa conferência o código não é aceito — "
        + "preencha o endereço nesta linha.",
    };
  }
  const bate =
    normalizarParaBusca(linha[1]) === normalizarParaBusca(nomeDaResposta) &&
    String(linha[2]).toUpperCase() === ufDaResposta;
  if (!bate) {
    return {
      ok: false,
      pendencia: PENDENCIA.CONSULTA_MUNICIPIO_NAO_PROVADO,
      texto:
        `O código ${digitos} é de ${linha[1]}/${linha[2]}, mas a consulta diz `
        + `${nomeDaResposta}/${ufDaResposta}. Os dois têm de ser o mesmo município — preencha o `
        + "endereço nesta linha.",
    };
  }
  return { ok: true, municipio: `${linha[1]} / ${linha[2]}` };
}

/**
 * "São Gonçalo" e "sao goncalo" precisam casar — a resposta da consulta vem com acento e a lista
 * também, mas não necessariamente com a mesma grafia.
 *
 * ⚠ É a MESMA normalização de `normalizarParaBusca` dos dois portais
 * (`lib/municipios/municipioIbge.js`). Duas leituras diferentes fariam o servidor recusar um
 * município que a tela aceitou.
 */
function normalizarParaBusca(texto) {
  return String(texto ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();
}

/**
 * Classifica UMA linha.
 *
 * @param {object} linha `{ numero, valores: { … } }` — as células desta linha, na lista fechada de
 *   `CAMPOS_DA_REVISAO`. ⚠ Só `documento`, `descricao`, `valor` e `competencia` podem ter vindo da
 *   PLANILHA; `nome`, `email` e o bloco de endereço só existem se alguém os preencheu na revisão.
 * @param {object} [opcoes]
 * @param {object|null} [opcoes.tomadorConhecido] o registro de `tomadores_emitidos` deste
 *   documento nesta empresa, ou `null`. **Quem busca é o chamador** — esta função não lê banco.
 * @param {object|undefined} [opcoes.consulta] o resultado JÁ RESOLVIDO da consulta para este
 *   documento. ⚠ `undefined` significa **"ainda não consultado"**, e é o que produz o estado
 *   `CONSULTAR`. Ver a nota sobre resultados parciais em `classificarPlanilhaLote`.
 * @param {Array|null} [opcoes.municipios] a lista oficial do IBGE, injetada. `null` = não
 *   conferível nesta camada.
 */
export function classificarLinhaLote(linha, { tomadorConhecido = null, consulta = undefined, municipios = null } = {}) {
  const v = linha?.valores || {};
  const pendencias = [];
  const conferencias = [];
  const pend = (codigo, txt) => pendencias.push({ codigo, texto: txt });
  const conf = (codigo, txt) => conferencias.push({ codigo, texto: txt });

  // ── DOCUMENTO ───────────────────────────────────────────────────────────────────────────────
  const doc = lerDocumentoDaPlanilha(v.documento);
  if (!doc.ok) {
    pend(doc.motivo, TEXTO_DOCUMENTO[doc.motivo] || "Documento do tomador inválido.");
  } else if (doc.zeroRecuperado) {
    conf(
      CONFERENCIA.ZERO_A_ESQUERDA_RECUPERADO,
      `A planilha trouxe “${String(v.documento).trim()}” e nós lemos como o CPF ${doc.documento}: `
      + "o Excel apaga o zero da frente em coluna numérica, e o dígito verificador fecha com ele "
      + "recolocado. Confira o CPF antes de emitir — nós mudamos o número que veio."
    );
  }

  // ── DESCRIÇÃO ───────────────────────────────────────────────────────────────────────────────
  const descricao = texto(v.descricao);
  if (!descricao) {
    pend(
      PENDENCIA.DESCRICAO_AUSENTE,
      "A descrição do serviço está em branco. Ela sai impressa no DANFSe que vai ao tomador."
    );
  }

  // ── VALOR ───────────────────────────────────────────────────────────────────────────────────
  const valor = lerValorDaPlanilha(v.valor);
  if (!valor.ok) pend(valor.motivo, TEXTO_VALOR[valor.motivo] || "Valor do serviço inválido.");

  // ── COMPETÊNCIA ─────────────────────────────────────────────────────────────────────────────
  const competencia = lerCompetenciaDaPlanilha(v.competencia);
  if (!competencia.ok) {
    pend(
      competencia.motivo,
      competencia.motivo === PENDENCIA.COMPETENCIA_AUSENTE
        ? "A data da competência está em branco. Ela é obrigatória aqui: em branco, a nota sairia "
          + "com a data de hoje sem ninguém ver — e num lote isso carimbaria todas as notas."
        : `Não conseguimos ler “${competencia.texto}” como data. Use dd/mm/aaaa (ex.: 31/07/2026) `
          + "ou aaaa-mm-dd."
    );
  }

  // ═══════════════════════════════════════════════════════════════════════════════════════════
  // ⚠⚠ O TOMADOR — nome, e-mail e endereço, nas TRÊS origens: REVISÃO → MEMÓRIA → CONSULTA
  // ═══════════════════════════════════════════════════════════════════════════════════════════
  //
  // ⚠ Até 20/08/2026 o NOME era coluna obrigatória e só a planilha o preenchia ("branco é branco,
  // não é um pedido de busca"). Aquela regra caiu com a coluna: hoje o nome tem as mesmas três
  // origens do endereço, e é a ausência das TRÊS que vira pendência. O que NÃO mudou é a
  // precedência — o que uma pessoa digitou continua vencendo memória e consulta.

  // ── E-MAIL: opcional de verdade, e malformado NÃO derruba a linha ────────────────────────────
  // A nota sai sem e-mail e a linha vai para conferência. O validador não exige e-mail — perder a
  // emissão por causa de um campo que a emissão não pede seria trocar um problema por outro maior.
  const emailDigitado = lerEmailDaPlanilha(v.email);
  if (!emailDigitado.ok) {
    conf(
      CONFERENCIA.EMAIL_FORA_DE_FORMA,
      `O e-mail “${emailDigitado.texto}” não tem “@”. A nota sai SEM e-mail — a emissão não o exige. `
      + "Corrija se quiser que ele fique guardado."
    );
  }

  let nome = texto(v.nome);
  let origemNome = nome ? ORIGEM_DO_DADO.REVISAO : null;
  let email = emailDigitado.ok ? emailDigitado.email : null;
  let endereco = null;
  let origemEndereco = null;
  let precisaConsulta = false;

  // ── (1) A REVISÃO — o endereço que uma PESSOA digitou ────────────────────────────────────────
  const daRevisao = normalizarEndereco({
    cMun: v.cMun,
    cep: v.cep,
    xLgr: v.xLgr,
    nro: v.nro,
    xCpl: v.xCpl,
    xBairro: v.xBairro,
  });
  const revisaoTrouxeEndereco = CAMPOS_ENDERECO.some((c) => daRevisao?.[c]);

  if (revisaoTrouxeEndereco) {
    // ⚠ TUDO-OU-NADA: `buildDpsXml` recusa a emissão (`MISSING_TOMADOR_ADDRESS`) faltando qualquer
    // um dos cinco. Meio endereço é PENDÊNCIA, nunca "quase pronta" — é a mesma disciplina do
    // `xLgr` do portal, onde a palavra "RUA" sozinha passava por logradouro preenchido.
    const faltam = faltantesDoEndereco(daRevisao);
    if (faltam.length) {
      pend(
        PENDENCIA.ENDERECO_INCOMPLETO,
        `O endereço do tomador está pela metade: falta ${faltam.join(", ")}. A nota exige o `
        + "endereço COMPLETO (só o complemento é opcional) — meio endereço faz a emissão ser "
        + "recusada. Preencha o que falta ou apague o bloco inteiro para buscarmos o endereço."
      );
    } else {
      const municipio = conferirMunicipioDaRevisao(daRevisao.cMun, municipios);
      if (!municipio.ok) {
        pend(municipio.pendencia, municipio.texto);
      } else {
        if (municipio.conferencia) conf(municipio.conferencia, municipio.texto);
        endereco = daRevisao;
        origemEndereco = ORIGEM_DO_DADO.REVISAO;
      }
    }
  }

  // ── (2) A MEMÓRIA — o *"se já teve antes, só preencher"* do dono ─────────────────────────────
  //
  // ⚠ Sem conferência extra: este nome e este endereço já saíram numa nota que o sistema nacional
  // AUTORIZOU, para esta mesma empresa. E a memória só completa o que está faltando — ela nunca
  // escreve por cima do que uma pessoa digitou.
  if (doc.ok && tomadorConhecido) {
    if (!nome) {
      const daMemoria = texto(tomadorConhecido.nome);
      if (daMemoria) {
        nome = daMemoria;
        origemNome = ORIGEM_DO_DADO.MEMORIA;
      }
    }
    // ⚠ E-MAIL MALFORMADO NÃO CAI PARA A MEMÓRIA. A conferência acima já diz que a nota sai SEM
    // e-mail; preencher de outra fonte faria a frase virar mentira na mesma linha.
    if (!email && emailDigitado.ok) email = texto(tomadorConhecido.email);
    if (!endereco && !revisaoTrouxeEndereco) {
      const daMemoria = normalizarEndereco(tomadorConhecido);
      if (daMemoria && faltantesDoEndereco(daMemoria).length === 0) {
        endereco = daMemoria;
        origemEndereco = ORIGEM_DO_DADO.MEMORIA;
      }
    }
  }

  // ── (3) A CONSULTA — e SÓ para CNPJ ──────────────────────────────────────────────────────────
  //
  // ⚠⚠ **A CONSULTA É PEDIDA PELO NOME TAMBÉM, NÃO SÓ PELO ENDEREÇO.** Sem isto, um CNPJ cujo
  // endereço a pessoa já digitou na revisão, mas cujo nome ninguém sabe, viraria PENDENTE por
  // `nome_ausente` sem que a Receita fosse sequer perguntada — mandando alguém digitar à mão a razão
  // social que a consulta traz de graça.
  const faltaEndereco = !endereco && !revisaoTrouxeEndereco;
  if (doc.ok && (!nome || faltaEndereco)) {
    if (doc.tipo === "CPF") {
      // ⚠⚠ CPF NÃO SE CONSULTA — decisão do dono. Nenhuma chamada é sugerida, e as duas faltas
      // viram pendência nomeada mais abaixo, cada uma com a sua frase.
    } else if (consulta === undefined || consulta === null) {
      precisaConsulta = true;
    } else if (!consulta.ok) {
      // ⚠ FALHA DA CONSULTA NÃO É ERRO DO CLIENTE — é pendência DESTA linha, com o motivo.
      pend(
        PENDENCIA.CONSULTA_FALHOU,
        `Não conseguimos consultar este CNPJ: ${consulta.motivo || "a consulta não respondeu"}. `
        + "Preencha o nome e o endereço do tomador nesta linha — as outras linhas seguem normalmente."
      );
    } else {
      // ⚠ A RAZÃO SOCIAL DA RESPOSTA, e nada além dela. Resposta sem `nome` não preenche nada:
      // campo que a API não deu fica vazio, nunca inventado (mesma regra de `nomeDaReceita`).
      if (!nome) {
        const daConsulta = texto(consulta.nome);
        if (daConsulta) {
          nome = daConsulta;
          origemNome = ORIGEM_DO_DADO.CONSULTA;
        }
      }
      if (faltaEndereco) {
        const daConsulta = normalizarEndereco(consulta.endereco);
        if (!daConsulta || faltantesDoEndereco(daConsulta).length) {
          const faltam = consulta.faltantes?.length
            ? consulta.faltantes.join(", ")
            : faltantesDoEndereco(daConsulta).join(", ");
          pend(
            PENDENCIA.CONSULTA_SEM_ENDERECO,
            `A consulta respondeu, mas não trouxe ${faltam || "o endereço"}. A nota exige o endereço `
            + "completo — preencha nesta linha."
          );
        } else {
          // ⚠⚠ A PROVA TRIPLA É REFEITA **AQUI**, no servidor — ver `conferirMunicipioDaConsulta`.
          // Até 20/08/2026 este ramo lia `consulta.cMunVerificado`, um booleano do NAVEGADOR. Numa
          // emissão em lote isso seriam 50 notas fiscais apoiadas numa afirmação não conferida.
          const municipio = conferirMunicipioDaConsulta(daConsulta.cMun, consulta, municipios);
          if (!municipio.ok) {
            pend(municipio.pendencia, municipio.texto);
          } else {
            if (municipio.conferencia) conf(municipio.conferencia, municipio.texto);
            endereco = daConsulta;
            origemEndereco = ORIGEM_DO_DADO.CONSULTA;
          }
        }
      }
    }
  }

  // ── (4) O QUE NENHUMA DAS TRÊS RESOLVEU ──────────────────────────────────────────────────────
  //
  // ⚠ As pendências só entram quando não há consulta pendente: uma linha que ainda vai ser
  // consultada não pode acusar falta do que a consulta traria — ela iria para PENDENTE em vez de
  // CONSULTAR, e o segundo passe nunca aconteceria.
  if (!precisaConsulta) {
    if (!nome) {
      pend(
        PENDENCIA.NOME_AUSENTE,
        doc.ok && doc.tipo === "CPF"
          ? "Não sabemos o nome deste tomador: é pessoa física, nunca emitimos para este CPF e CPF "
            + "não se consulta (a base pública é de CNPJ). Escreva o nome do tomador nesta linha."
          : "Não sabemos o nome deste tomador — não emitimos para este documento antes e a consulta "
            + "não trouxe a razão social. Escreva o nome do tomador nesta linha."
      );
    }
    if (doc.ok && doc.tipo === "CPF" && faltaEndereco) {
      pend(
        PENDENCIA.CPF_SEM_ENDERECO,
        "O tomador é pessoa física e nunca emitimos para este CPF, então não temos o endereço — e "
        + "CPF não se consulta (a base pública é de CNPJ). Preencha o endereço do tomador nesta "
        + "linha."
      );
    }
  }

  // ── O ESTADO ────────────────────────────────────────────────────────────────────────────────
  //
  // ⚠⚠ A ORDEM É A PRIORIDADE, e o último ramo é o único que produz `PRONTA`. Qualquer caminho
  // não previsto termina aqui sem `endereco` e sem `origemEndereco` — logo, em `PENDENTE`.
  let estado;
  if (pendencias.length) {
    estado = ESTADO.PENDENTE;
  } else if (precisaConsulta) {
    estado = ESTADO.CONSULTAR;
  } else if (!endereco || !origemEndereco) {
    // Sem endereço e sem pendência nomeada não existe caminho conhecido — e não vira "pronta".
    pend(
      PENDENCIA.SEM_ENDERECO,
      "Não foi possível determinar o endereço do tomador desta linha. Preencha o endereço."
    );
    estado = ESTADO.PENDENTE;
  } else if (conferencias.length) {
    estado = ESTADO.CONFERIR;
  } else {
    estado = ESTADO.PRONTA;
  }

  return {
    numero: linha?.numero ?? null,
    estado,
    pendencias,
    conferencias,
    // ⚠ `documento` é o que a leitura ENTENDEU (já com o zero recolocado, quando o DV fechou), e
    // vem sempre acompanhado da conferência que avisa que ele foi mudado.
    documento: doc.ok ? doc.documento : null,
    tipoDocumento: doc.ok ? doc.tipo : null,
    origemEndereco,
    /**
     * ⚠ De onde saiu o NOME do tomador — e ele passou a ter procedência porque passou a ter três
     * origens. A tela mostra ("do cadastro de tomador" × "da Receita" × "você escreveu"): nome
     * preenchido sem dizer de onde veio é indistinguível de nome conferido por uma pessoa.
     */
    origemNome,
    // ⚠ Os dados NA FORMA DO PAYLOAD, para quem for montar a emissão depois não precisar traduzir
    // nada de novo. **Isto não é uma emissão** — é o resultado da leitura.
    dados:
      estado === ESTADO.PRONTA || estado === ESTADO.CONFERIR
        ? {
            tomador: {
              doc: doc.documento,
              nome,
              email,
              endereco: {
                cMun: endereco.cMun,
                CEP: endereco.cep,
                xLgr: endereco.xLgr,
                nro: endereco.nro,
                xCpl: endereco.xCpl,
                xBairro: endereco.xBairro,
              },
            },
            servico: { descricao, valorServicos: valor.valor },
            competencia: competencia.competencia,
          }
        : null,
  };
}

/**
 * A planilha inteira, linha a linha.
 *
 * ⚠⚠ **ACEITA RESULTADOS PARCIAIS, DE PROPÓSITO.** Numa planilha de 200 linhas o front consulta em
 * série; exigir o conjunto completo travaria a tela esperando tudo, e uma consulta que falhasse no
 * meio derrubaria o lote inteiro. Então `consultas` é um mapa **por documento** com o que já se
 * sabe: as linhas cobertas são reclassificadas, as demais continuam em `CONSULTAR` e a tela vai
 * preenchendo. Chamar de novo com o mapa maior é a operação normal.
 *
 * ⚠ **O MAPA É POR DOCUMENTO, NÃO POR LINHA.** Vinte linhas do mesmo CNPJ consomem UMA consulta —
 * a BrasilAPI é pública e tem throttle, e é a mesma economia que `decidirConsulta` já faz no portal
 * com o `ultimoConsultado`.
 *
 * @param {Array} linhas
 * @param {object} [opcoes]
 * @param {Map|object} [opcoes.tomadoresConhecidos] documento → registro de `tomadores_emitidos`
 * @param {Map|object} [opcoes.consultas] documento → resultado da consulta (parcial)
 * @param {Array|null} [opcoes.municipios]
 */
export function classificarPlanilhaLote(linhas, { tomadoresConhecidos = null, consultas = null, municipios = null } = {}) {
  const pegar = (mapa, chave) => {
    if (!mapa || !chave) return undefined;
    if (mapa instanceof Map) return mapa.get(chave);
    return Object.prototype.hasOwnProperty.call(mapa, chave) ? mapa[chave] : undefined;
  };

  const classificadas = (Array.isArray(linhas) ? linhas : []).map((linha) => {
    // ⚠ A busca usa o documento **como a leitura o entendeu** (com o zero recolocado quando o DV
    // fechou). Buscar pelos dígitos crus erraria justamente a linha que já foi consertada.
    const doc = lerDocumentoDaPlanilha(linha?.valores?.documento);
    const chave = doc.ok ? doc.documento : null;
    return classificarLinhaLote(linha, {
      tomadorConhecido: pegar(tomadoresConhecidos, chave) ?? null,
      consulta: pegar(consultas, chave),
      municipios,
    });
  });

  const contar = (estado) => classificadas.filter((l) => l.estado === estado).length;
  return {
    linhas: classificadas,
    resumo: {
      total: classificadas.length,
      prontas: contar(ESTADO.PRONTA),
      conferir: contar(ESTADO.CONFERIR),
      consultar: contar(ESTADO.CONSULTAR),
      pendentes: contar(ESTADO.PENDENTE),
    },
    /**
     * Os CNPJs que ainda precisam de consulta — sem repetição, na ordem em que aparecem.
     * É a lista de trabalho do front; linha de CPF nunca entra aqui.
     */
    aConsultar: [
      ...new Set(
        classificadas.filter((l) => l.estado === ESTADO.CONSULTAR && l.documento).map((l) => l.documento)
      ),
    ],
  };
}
