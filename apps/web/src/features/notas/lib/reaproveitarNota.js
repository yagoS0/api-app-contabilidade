// REAPROVEITAR UMA NOTA JÁ EMITIDA — copiar o que descreve o SERVIÇO e o TOMADOR, e NADA MAIS.
//
// Pedido do dono (18/08/2026): *"o portal do contador não está habilitado as notas do jeito que
// lhe disse, como no portal do cliente, podendo apenas clicar em uma nota já emitida para copiar
// dados entre outras coisas"*.
//
// ⚠⚠ NOTA NOVA É NOTA NOVA. Este módulo NUNCA copia identificador de documento fiscal:
// `numero`, `chaveAcesso`, `idNfse`, `idDps`, `rpsSerie`, `rpsNumero`, `emitidaEm`, a `competencia`
// da original, o status e o ciclo. Carregar qualquer um deles produziria (a) duplicidade — a
// rejeição **E0014** da prefeitura, que é exatamente o que o `rpsNumero` do backend existe para
// evitar — ou (b) uma nota que se apresenta como sendo outra. O número da nova é reservado pelo
// BACKEND, na emissão, e não passa por tela nenhuma.
//
// ⚠ REAPROVEITAR NÃO É REEMITIR, E NÃO É SUBSTITUIR.
// A nota original continua exatamente como está — autorizada, cancelada ou substituída. Este
// caminho não cancela nada, não gera evento e **não cria o vínculo de substituição**
// (`chSubstda`): o payload de emissão (`application/validators/nfsePayload.js`) não tem campo de
// substituição, então a nota nova nasce independente. Quem lê a tela precisa saber disso — senão o
// contador acha que "emitiu a correta no lugar da errada" e ficou com duas notas válidas.
//
// ⚠ O QUE ESTE MÓDULO DEVOLVE ENTRA NO ASSISTENTE, NUNCA EM VOLTA DELE.
// O `EmitirNfseWizard` é quem tem o bloqueio de cadastro incompleto, o pré-voo do regime, a
// consulta de CNPJ e as travas de desfecho desconhecido. Um atalho que emitisse direto daqui
// desfaria tudo isso. Estes valores são o ESTADO INICIAL de um formulário que continua sendo
// conferido e confirmado por quem emite.

/** Só dígitos — o campo de documento do assistente é `soDigitos` do outro lado também. */
// ⚠ A MESMA formatação que o campo do assistente usa. Duas cópias fariam o campo abrir com uma
// grafia e ler outra — que é a classe de defeito que `valorDaNota.js` existe para fechar.
import { formatarValorParaCampo } from "./valorDaNota";

const soDigitos = (v) => String(v ?? "").replace(/\D+/g, "");

/**
 * O valor como o campo do assistente o entende.
 *
 * ⚠ A RAZÃO ANTIGA CAIU JUNTO COM O DEFEITO QUE A CRIOU, e ela está aqui porque o argumento
 * inverteu: dizia *"SEM SEPARADOR DE MILHAR — o assistente lê o campo com
 * `Number(String(v).replace(",", "."))`, um replace só, do primeiro caractere; '1.234,56' viraria
 * '1.234.56' → NaN"*. Era verdade, e era um contorno: o campo é que estava errado. Hoje ele é
 * mascarado (`lib/valorDaNota.js`), a leitura é por centavos inteiros e o milhar é obrigatório na
 * forma canônica — então formatar bonito aqui é justamente o que faz o campo abrir certo.
 *
 * ⚠ O total da nota chega como número ou como string de API; `formatarValorParaCampo` devolve `""`
 * para o que não for número positivo — nota sem total abre o campo VAZIO, nunca "0,00".
 */
function paraCampoDeValor(total) {
  const n = Number(String(total ?? "").replace(",", "."));
  return formatarValorParaCampo(n);
}

// ── O que se copia, dito por extenso ─────────────────────────────────────────
// Estas duas listas SÃO O TEXTO DA TELA (o assistente as renderiza). Ficam aqui, e não no
// componente, porque a lista e o que o código realmente faz precisam mudar juntos.

export const CAMPOS_COPIADOS = [
  { chave: "tomadorDoc", rotulo: "CNPJ/CPF do tomador", de: "tomadorDoc da nota" },
  { chave: "tomadorNome", rotulo: "Nome ou razão social do tomador", de: "tomadorNome da nota" },
  { chave: "descricao", rotulo: "Descrição do serviço", de: "o item da nota" },
  { chave: "valor", rotulo: "Valor dos serviços", de: "o total da nota (vServ)" },
];

export const CAMPOS_NAO_COPIADOS = [
  {
    chave: "identificadores",
    rotulo: "Número, chave de acesso, ID NFS-e, ID DPS, série e RPS",
    motivo:
      "nota nova é nota nova: o número é reservado pelo backend na emissão. Reaproveitar um "
      + "identificador produziria duplicidade (rejeição E0014) ou uma nota que se diz ser outra.",
  },
  {
    chave: "competencia",
    rotulo: "Competência e data de emissão da original",
    motivo:
      "a nota nova é de agora, não do mês da antiga. A competência fica em branco para ser "
      + "escolhida (ou deixada para o servidor).",
  },
  {
    chave: "situacao",
    rotulo: "Situação, eventos e vínculo de substituição",
    motivo:
      "são o histórico da nota original, e ele continua sendo dela. A nota nova nasce sem "
      + "história — em particular, ela NÃO substitui a original.",
  },
  {
    chave: "emailEndereco",
    rotulo: "E-mail e endereço do tomador",
    motivo:
      "a nota capturada não guarda esses campos — o que temos dela é nome e documento. Com o CNPJ "
      + "preenchido, o assistente consulta a Receita e oferece o endereço.",
  },
  {
    chave: "aliquota",
    rotulo: "Alíquota de ISS e ISS retido",
    motivo:
      "não estão entre os campos que guardamos da nota capturada. Em branco, vale a alíquota da "
      + "prefeitura — inventar um percentual aqui seria declarar imposto por suposição.",
  },
  {
    chave: "codigoServico",
    rotulo: "Código de serviço da nota nova",
    motivo:
      "ele não vem da nota antiga: a emissão sempre usa o código do cadastro da empresa "
      + "(o bloco “O que” mostra qual vai). O código que a original declarou aparece abaixo, para "
      + "conferência.",
  },
];

export const MOTIVO_NAO_REAPROVEITAVEL = {
  NAO_E_NFSE: "nao_e_nfse",
  RECEBIDA: "recebida",
  SEM_DADOS: "sem_dados",
};

/**
 * Esta nota serve de modelo para uma emissão?
 *
 * ⚠ A SITUAÇÃO DA NOTA **NÃO** ENTRA AQUI — e a decisão é deliberada; ver `avisosDoReaproveitamento`.
 * O que impede é o que tornaria a nota nova ERRADA:
 *   • NF-e não se emite por esta tela (o assistente é de NFS-e, e o backend também);
 *   • nota RECEBIDA (`papel: "DEST"`) tem a própria empresa como tomadora — reaproveitá-la
 *     ofereceria a empresa como tomadora dela mesma. É a mesma razão pela qual a aba só alimenta as
 *     sugestões de tomador com `papel: "EMIT"`;
 *   • sem tomador e sem valor não há o que copiar, e um formulário "pré-preenchido" vazio é pior
 *     que nenhum: ele promete um atalho que não existe.
 */
export function podeReaproveitar(nota) {
  if (!nota) return { pode: false, motivo: MOTIVO_NAO_REAPROVEITAVEL.SEM_DADOS, texto: "A nota ainda não carregou." };

  if (String(nota.type || "").toUpperCase() !== "NFSE") {
    return {
      pode: false,
      motivo: MOTIVO_NAO_REAPROVEITAVEL.NAO_E_NFSE,
      texto:
        "Só nota de serviço (NFS-e) pode ser reaproveitada aqui — este portal não emite NF-e de "
        + "venda, ela é capturada da SEFAZ.",
    };
  }

  if (String(nota.papel || "").toUpperCase() === "DEST") {
    return {
      pode: false,
      motivo: MOTIVO_NAO_REAPROVEITAVEL.RECEBIDA,
      texto:
        "Esta nota foi RECEBIDA pela empresa: quem prestou o serviço foi outro, e a tomadora é a "
        + "própria empresa. Reaproveitá-la ofereceria a empresa como tomadora dela mesma.",
    };
  }

  const temTomador = Boolean(String(nota.tomadorNome || "").trim() || soDigitos(nota.tomadorDoc));
  const temValor = Boolean(paraCampoDeValor(nota.total));
  if (!temTomador && !temValor) {
    return {
      pode: false,
      motivo: MOTIVO_NAO_REAPROVEITAVEL.SEM_DADOS,
      texto:
        "Não guardamos tomador nem valor desta nota — não há o que copiar. Abrir o assistente "
        + "“pré-preenchido” com nada dentro prometeria um atalho que não existe.",
    };
  }

  return { pode: true, motivo: null, texto: null };
}

/**
 * A descrição do serviço, quando ela é UMA.
 *
 * ⚠ COM VÁRIOS ITENS DESCRITOS, NADA É COPIADO. O assistente tem UM campo de descrição livre
 * (`xDescServ`, um só no leiaute da NFS-e); emendar dois itens com " · " escreveria na nota nova uma
 * frase que ninguém redigiu — e ela sai impressa no DANFSe que vai ao tomador. Nesse caso a
 * descrição fica em branco, e a tela diz por quê.
 */
function descricaoDosItens(nota) {
  const itens = Array.isArray(nota?.itens) ? nota.itens : [];
  const descricoes = [...new Set(
    itens.map((i) => String(i?.descricao ?? "").trim()).filter(Boolean),
  )];
  if (descricoes.length === 1) return { descricao: descricoes[0], varios: false };
  return { descricao: "", varios: descricoes.length > 1 };
}

/**
 * Os valores iniciais do `EmitirNfseWizard` a partir de uma nota já emitida.
 *
 * A forma é a dos estados do assistente, de propósito — ele aplica isto sem traduzir nada:
 *   `{ tomador: {cnpjCpf, nome, email}, servico: {descricao, valorServicos, aliquota, issRetido} }`
 *
 * ⚠ NENHUM IDENTIFICADOR SAI DAQUI. Grep neste arquivo por `chaveAcesso`, `numero`, `idDps`,
 * `idNfse`, `serie` só encontra as duas listas de texto e a `origem` (que é REFERÊNCIA à nota
 * modelo, mostrada na tela, e não campo do formulário).
 */
export function valoresIniciaisDaNota(nota) {
  if (!nota) return null;
  const { descricao, varios } = descricaoDosItens(nota);
  const itens = Array.isArray(nota.itens) ? nota.itens : [];
  const codigosDaOriginal = [...new Set(
    itens.map((i) => String(i?.codigoServico ?? "").trim()).filter(Boolean),
  )];

  return {
    tomador: {
      cnpjCpf: soDigitos(nota.tomadorDoc),
      nome: String(nota.tomadorNome ?? "").trim(),
      // ⚠ Vazio porque NÃO TEMOS, não porque escolhemos não mandar. A nota capturada não traz
      // e-mail do tomador em campo nenhum.
      email: "",
    },
    servico: {
      descricao,
      valorServicos: paraCampoDeValor(nota.total),
      // Alíquota e retenção não são copiadas — ver `CAMPOS_NAO_COPIADOS`.
      aliquota: "",
      issRetido: false,
    },
    // ⚠ A COMPETÊNCIA DA ORIGINAL FICA FORA. Ela é do mês dela.
    competencia: "",
    referencia: "",
    // Só para a TELA dizer de onde os valores vieram e o que não veio. Nada aqui é enviado.
    origem: {
      notaId: nota.id ?? null,
      numero: nota.numero ?? null,
      situacao: nota?.ciclo?.situacao ?? nota.statusEfetivo ?? null,
      variosItens: varios,
      semDescricao: !descricao && !varios,
      codigosDaOriginal,
    },
  };
}

/**
 * O que a tela precisa DIZER sobre reaproveitar ESTA nota.
 *
 * ⚠⚠ NOTA CANCELADA E NOTA SUBSTITUÍDA **PODEM** SER MODELO — E O PORQUÊ ESTÁ AQUI, NÃO NUM CHAT.
 *
 * Copiar dados não é reemitir: a nota original não é tocada, nenhum evento é gerado e a nota nova
 * nasce com número próprio. Além disso, o caso que o dono relatou é EXATAMENTE esse — *"cancelamos
 * essa nota, emitimos outra e depois a substituímos"*: a nota errada é justamente o melhor modelo
 * para a certa, porque quase tudo nela está certo. Bloquear seria tirar da tela o caso de uso mais
 * frequente do reaproveitamento.
 *
 * O que NÃO se pode é deixar a tela calada, porque aí o contador conclui duas coisas falsas:
 *   1. que emitir daqui "conserta" a nota cancelada (não conserta — ela continua cancelada);
 *   2. que a nota nova SUBSTITUI a antiga (não substitui — o payload de emissão não tem campo de
 *      substituição; a substituição é outro ato, e passa pela prefeitura).
 * Por isso a permissão vem acompanhada do aviso, sempre — o silêncio é que confundiria.
 */
/**
 * O que o assistente recebe: os valores iniciais MAIS os avisos, numa peça só.
 *
 * Existe para que a tela não precise lembrar de chamar duas funções — esquecer a segunda deixaria o
 * assistente pré-preenchido **sem** a frase "isto é uma nota nova", que é a metade que impede o
 * contador de achar que está reemitindo.
 */
export function modeloDeEmissaoDaNota(nota) {
  const valores = valoresIniciaisDaNota(nota);
  if (!valores) return null;
  return { ...valores, avisos: avisosDoReaproveitamento(nota) };
}

export function avisosDoReaproveitamento(nota, ciclo) {
  const avisos = [];
  const situacao = String(ciclo?.situacao ?? nota?.ciclo?.situacao ?? nota?.statusEfetivo ?? "").toLowerCase();

  // ⚠ ESTE AVISO É INCONDICIONAL. Ele é a frase que impede a tela de parecer uma "reemissão".
  avisos.push({
    codigo: "nota_nova",
    tom: "neutro",
    texto:
      "Isto abre uma NOTA NOVA, com número novo reservado na emissão. A nota de origem não é "
      + "alterada, cancelada nem substituída por este caminho.",
  });

  if (situacao === "cancelada") {
    avisos.push({
      codigo: "origem_cancelada",
      tom: "atencao",
      texto:
        "A nota de origem está CANCELADA. Ela continua cancelada depois desta emissão: a nota nova "
        + "não a corrige nem a substitui — é um documento independente.",
    });
  }

  if (situacao === "substituida") {
    avisos.push({
      codigo: "origem_substituida",
      tom: "atencao",
      texto:
        "A nota de origem já foi SUBSTITUÍDA — quem vale hoje é a substituta. Emitir a partir "
        + "desta cria um TERCEIRO documento, sem vínculo com nenhuma das duas. Confira se o modelo "
        + "certo não é a substituta.",
    });
  }

  const { descricao, varios } = descricaoDosItens(nota);
  if (varios) {
    avisos.push({
      codigo: "varios_itens",
      tom: "atencao",
      texto:
        "A nota de origem tem mais de um item descrito e a NFS-e tem uma descrição só. A descrição "
        + "não foi copiada — emendar os itens escreveria na nota nova uma frase que ninguém "
        + "redigiu. Escreva a descrição do serviço.",
    });
  } else if (!descricao) {
    avisos.push({
      codigo: "sem_descricao",
      tom: "atencao",
      texto:
        "Não guardamos a descrição do serviço desta nota, então ela veio em branco. Escreva o que "
        + "está sendo prestado.",
    });
  }

  return avisos;
}
