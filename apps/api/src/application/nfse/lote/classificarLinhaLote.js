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
// ─── O QUE PREENCHE O ENDEREÇO, NESTA ORDEM ─────────────────────────────────────────────────────
//
//   1. **A PLANILHA**, se ela trouxe qualquer campo de endereço. Quem digitou está afirmando o
//      endereço de hoje, e a memória pode estar velha — é a mesma regra do `aplicarEndereco` do
//      portal ("o que a pessoa digitou vence a consulta").
//   2. **A MEMÓRIA** (`tomadores_emitidos`, Fase 1) — o *"se já teve antes, só preencher"*.
//   3. **A CONSULTA**, e só para CNPJ.
//
// ⚠⚠ **CPF NÃO SE CONSULTA. NUNCA.** Decisão do dono, registrada em `utils/cpf.js` e em
// `consultaTomador.js`: a BrasilAPI é base de **CNPJ**; consulta de CPF é serviço pago e traz LGPD
// junto (o tomador é terceiro). Com 11 dígitos e sem endereço na planilha nem na memória, a linha é
// PENDENTE na hora — nenhuma chamada é sequer sugerida.
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

/** De onde veio o endereço da linha. `null` = não foi resolvido. */
export const ORIGEM_ENDERECO = Object.freeze({
  PLANILHA: "planilha",
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
 * O código IBGE que veio NA PLANILHA — aceito por VERIFICAÇÃO, nunca por confiança.
 *
 * ⚠⚠ **AQUI SÓ DUAS DAS TRÊS PROVAS SÃO POSSÍVEIS, E ISSO É MEDIDO, NÃO PREGUIÇA.** A prova tripla
 * de `codigoMunicipioVerificado` (`portal-cliente-web/.../consultaTomador.js`) é: (1) 7 dígitos;
 * (2) existe na lista oficial do IBGE; (3) o município e a UF dessa linha batem com o
 * `municipio`/`uf` **da mesma resposta**. A prova 3 **não tem como existir para a planilha**: a
 * lista fechada de colunas não tem município nem UF, e inventar essas colunas para poder conferir
 * seria fabricar a segunda afirmação. A prova 3 continua valendo INTEIRA no caminho da consulta,
 * que é onde ela nasceu.
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
function conferirMunicipioDaPlanilha(cMun, municipios) {
  const digitos = soDigitos(cMun);
  if (digitos.length !== 7) {
    return {
      ok: false,
      pendencia: PENDENCIA.MUNICIPIO_FORA_DE_FORMA,
      texto:
        `O código IBGE do município (“${cMun}”) não tem 7 dígitos. ⚠ O NOME do município não serve `
        + "no lugar do código: há cinco “Bom Jesus” no país, e derivar o código pelo nome erra em "
        + "homônimo — a nota sairia no município errado.",
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
      texto: `O código ${digitos} não existe na lista oficial do IBGE.`,
    };
  }
  return { ok: true, municipio: `${linha[1]} / ${linha[2]}` };
}

/**
 * Classifica UMA linha.
 *
 * @param {object} linha `{ numero, valores: { documento, nome, descricao, valor, competencia,
 *   email, cMun, cep, xLgr, nro, xBairro, xCpl } }` — as células como vieram da planilha.
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

  // ── NOME ────────────────────────────────────────────────────────────────────────────────────
  //
  // ⚠ A RAZÃO SOCIAL DA CONSULTA **NÃO** PREENCHE UM NOME EM BRANCO. O nome é coluna obrigatória
  // da lista fechada, e branco é branco — não é um pedido de busca. É a mesma disciplina de
  // `aplicarNome` no portal, onde o que a pessoa escreveu vence a consulta.
  const nome = texto(v.nome);
  if (!nome) pend(PENDENCIA.NOME_AUSENTE, "O nome / razão social do tomador está em branco.");

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

  // ── E-MAIL ──────────────────────────────────────────────────────────────────────────────────
  //
  // ⚠ OPCIONAL DE VERDADE, e malformado NÃO derruba a linha: a nota sai sem e-mail e a linha vai
  // para conferência. O validador não exige e-mail — perder a emissão por causa de um campo que a
  // emissão não pede seria trocar um problema por outro maior.
  const email = lerEmailDaPlanilha(v.email);
  if (!email.ok) {
    conf(
      CONFERENCIA.EMAIL_FORA_DE_FORMA,
      `O e-mail “${email.texto}” não tem “@”. A nota sai SEM e-mail — a emissão não o exige. `
      + "Corrija se quiser que ele fique guardado."
    );
  }

  // ── ENDEREÇO ────────────────────────────────────────────────────────────────────────────────
  const daPlanilha = normalizarEndereco({
    cMun: v.cMun,
    cep: v.cep,
    xLgr: v.xLgr,
    nro: v.nro,
    xCpl: v.xCpl,
    xBairro: v.xBairro,
  });
  const planilhaTrouxeAlgo = CAMPOS_ENDERECO.some((c) => daPlanilha?.[c]);

  let endereco = null;
  let origemEndereco = null;
  let precisaConsulta = false;

  if (planilhaTrouxeAlgo) {
    // ⚠ TUDO-OU-NADA: `buildDpsXml` recusa a emissão (`MISSING_TOMADOR_ADDRESS`) faltando qualquer
    // um dos cinco. Meio endereço é PENDÊNCIA, nunca "quase pronta" — é a mesma disciplina do
    // `xLgr` do portal, onde a palavra "RUA" sozinha passava por logradouro preenchido.
    const faltam = faltantesDoEndereco(daPlanilha);
    if (faltam.length) {
      pend(
        PENDENCIA.ENDERECO_INCOMPLETO,
        `O endereço do tomador está pela metade: falta ${faltam.join(", ")}. A nota exige o `
        + "endereço COMPLETO (só o complemento é opcional) — meio endereço faz a emissão ser "
        + "recusada. Preencha o que falta ou apague o bloco inteiro para buscarmos o endereço."
      );
    } else {
      const municipio = conferirMunicipioDaPlanilha(daPlanilha.cMun, municipios);
      if (!municipio.ok) {
        pend(municipio.pendencia, municipio.texto);
      } else {
        if (municipio.conferencia) conf(municipio.conferencia, municipio.texto);
        endereco = daPlanilha;
        origemEndereco = ORIGEM_ENDERECO.PLANILHA;
      }
    }
  } else if (doc.ok) {
    const daMemoria = normalizarEndereco(tomadorConhecido);
    if (daMemoria && faltantesDoEndereco(daMemoria).length === 0) {
      // ⚠ O *"se já teve antes, só preencher"* do dono. Sem conferência extra: este endereço já
      // saiu numa nota autorizada desta mesma empresa.
      endereco = daMemoria;
      origemEndereco = ORIGEM_ENDERECO.MEMORIA;
    } else if (doc.tipo === "CPF") {
      // ⚠⚠ CPF NÃO SE CONSULTA — decisão do dono. Nenhuma chamada é sugerida.
      pend(
        PENDENCIA.CPF_SEM_ENDERECO,
        "O tomador é pessoa física e nunca emitimos para este CPF, então não temos o endereço — e "
        + "CPF não se consulta (a base pública é de CNPJ). Preencha o endereço do tomador nesta "
        + "linha."
      );
    } else if (consulta === undefined || consulta === null) {
      precisaConsulta = true;
    } else if (!consulta.ok) {
      // ⚠ FALHA DA CONSULTA NÃO É ERRO DO CLIENTE — é pendência DESTA linha, com o motivo.
      pend(
        PENDENCIA.CONSULTA_FALHOU,
        `Não conseguimos consultar este CNPJ: ${consulta.motivo || "a consulta não respondeu"}. `
        + "Preencha o endereço do tomador nesta linha — as outras linhas seguem normalmente."
      );
    } else {
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
      } else if (consulta.cMunVerificado !== true) {
        // ⚠⚠ O `cMun` DA CONSULTA SÓ ENTRA COM A PROVA TRIPLA FEITA. Quem consulta é quem tem a
        // lista oficial e a resposta inteira (município + UF), então é lá que
        // `codigoMunicipioVerificado` roda. Aqui só se exige que o resultado DIGA que a prova
        // passou — aceitar em silêncio um `cMun` não provado é exatamente o que aquela função
        // existe para impedir. Ausente conta como não provado.
        pend(
          PENDENCIA.CONSULTA_MUNICIPIO_NAO_PROVADO,
          "A consulta trouxe um código de município que não foi conferido contra a lista oficial "
          + "do IBGE. Não usamos código de município sem prova: a nota sairia no município errado. "
          + "Preencha o endereço nesta linha."
        );
      } else {
        endereco = daConsulta;
        origemEndereco = ORIGEM_ENDERECO.CONSULTA;
      }
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
    // ⚠ Os dados NA FORMA DO PAYLOAD, para quem for montar a emissão depois não precisar traduzir
    // nada de novo. **Isto não é uma emissão** — é o resultado da leitura.
    dados:
      estado === ESTADO.PRONTA || estado === ESTADO.CONFERIR
        ? {
            tomador: {
              doc: doc.documento,
              nome,
              email: email.ok ? email.email : null,
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
