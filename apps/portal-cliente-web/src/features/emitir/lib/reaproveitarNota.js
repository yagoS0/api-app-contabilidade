// REAPROVEITAR UMA NOTA JÁ EMITIDA — copiar o que descreve o TOMADOR, e NADA MAIS.
//
// > Pedido do dono (19/08/2026): *"não podemos usar uma nota já emitida para preencher os dados do
// > tomador, e da nota no geral, apenas apagando o valor — isso deveria ser possível."*
//
// ⚠ ORIGEM: `apps/web/src/features/notas/lib/reaproveitarNota.js` (portal do escritório, 30 testes).
// MESMA REGRA, apps separados e sem código compartilhado — o mesmo arranjo de `consultaTomador.js`,
// `valorDaNota.js` e `municipioIbge.js` aqui do lado. **Mudou lá, muda aqui.** As invariantes de lá
// valem aqui sem exceção; o que muda são DUAS coisas, e as duas estão escritas embaixo:
//
//   1. ⚠⚠ **O VALOR VEM VAZIO** — foi exatamente o que o dono pediu. Lá o valor é copiado; aqui,
//      não. E **vazio é vazio, nunca `0,00`**: zero é uma AFIRMAÇÃO sobre quanto vale a nota, e o
//      campo mascarado (`valorDaNota.js`) nunca fabrica "0,00" num campo em branco. A tela DIZ que
//      o valor não veio — senão o campo em branco vira esquecimento, e alguém emite achando que
//      copiou.
//   2. ⚠ **A DESCRIÇÃO NÃO CHEGA A ESTE PORTAL, e isso foi MEDIDO, não suposto.** O contrato do
//      cliente não traz os itens da nota: `serializeInvoice`
//      (`apps/api/src/routes/portalInvoices.js`) devolve `invoiceId · type · numero · competencia ·
//      issueDate · status · total · emitente · tomador · updatedAt · hasXml · hasPdf` — sem
//      `itens` —, e a rota de detalhe responde `items: []` cravado. Ou seja: **hoje a descrição
//      sempre vem vazia, com aviso.** A regra do item único fica escrita mesmo assim, porque é a
//      MESMA do portal do escritório e porque o dia em que o contrato trouxer os itens ela já tem
//      de estar certa — emendar dois itens com " · " escreveria na nota nova uma frase que ninguém
//      redigiu, e ela sai impressa no DANFSe que vai ao tomador.
//
// ⚠⚠ NOTA NOVA É NOTA NOVA. Este módulo NUNCA copia identificador de documento fiscal: `numero`,
// `chaveAcesso`, `idNfse`, `idDps`, série/RPS, a competência da original, status, ciclo e eventos.
// Carregar qualquer um deles produz (a) duplicidade — a rejeição **E0014** —, ou (b) uma nota que
// se apresenta como sendo outra. O número da nova é reservado pelo BACKEND, numa transação, no
// instante da emissão, e não passa por tela nenhuma. A invariante é testada por **VARREDURA** do
// objeto devolvido, não campo a campo: um teste que só olhasse os campos conhecidos deixaria passar
// alguém acrescentando `chaveAcesso` "só para a tela mostrar".
//
// ⚠ REAPROVEITAR NÃO É REEMITIR, E NÃO É SUBSTITUIR. A nota de origem continua exatamente como
// está. Este caminho não cancela nada, não gera evento e **não cria o vínculo de substituição**: o
// payload de emissão (`apps/api/src/application/validators/nfsePayload.js`) não tem campo de
// substituição, então a nota nova nasce independente.
//
// ⚠ O QUE ESTE MÓDULO DEVOLVE ENTRA NO FORMULÁRIO NORMAL, NUNCA EM VOLTA DELE. Quem tem o portão
// (`portaoEmissao.js`), o aviso de cadastro incompleto, a consulta do CNPJ e as travas de desfecho
// é a `EmitirNotaPage`. Estes valores são o ESTADO INICIAL de um formulário que continua sendo
// conferido e confirmado por quem emite.
//
// ⚠ **POR QUE NÃO EXISTEM AQUI AS LISTAS `CAMPOS_COPIADOS`/`CAMPOS_NAO_COPIADOS` DO ESCRITÓRIO.**
// Lá elas SÃO o texto da tela: o assistente renderiza os seis itens com o motivo de cada um. Aqui
// quem lê é o CLIENTE, e o dono acabou de dizer, com esta tela na frente, que *"esse tanto de
// legenda é desnecessário"*. Duas listas renderizadas seriam doze linhas novas na tela que ele
// pediu para encolher. O que não pode sumir — "isto é nota nova" e "o valor não veio" — vive nos
// AVISOS, que a tela mostra. Lista que ninguém renderiza é código morto, e código morto é pior que
// texto curto.

const soDigitos = (v) => String(v ?? "").replace(/\D+/g, "");

export const MOTIVO_NAO_REAPROVEITAVEL = {
  NAO_E_NFSE: "nao_e_nfse",
  RECEBIDA: "recebida",
  SEM_DADOS: "sem_dados",
};

/**
 * Esta nota serve de modelo para uma emissão?
 *
 * ⚠ A SITUAÇÃO DA NOTA **NÃO** ENTRA AQUI — é deliberado; ver `avisosDoReaproveitamento`. O que
 * impede é o que tornaria a nota NOVA errada:
 *   • NF-e não se emite por esta tela (o backend também não: a porta é `POST .../nfse`, de NFS-e);
 *   • nota RECEBIDA tem a própria empresa como tomadora — reaproveitá-la ofereceria a empresa como
 *     tomadora dela mesma;
 *   • sem tomador não há o que copiar, e um formulário "pré-preenchido" vazio é pior que nenhum:
 *     ele promete um atalho que não existe.
 *
 * ⚠ **A NOTA RECEBIDA É RECONHECIDA PELO CNPJ, NÃO PELO `papel`** — e a diferença é de contrato: o
 * `papel: "DEST"` existe no portal do ESCRITÓRIO e **não vem** no payload do cliente
 * (`serializeInvoice`). O que vem é o `tomador.cnpjCpf`, e a pergunta é a mesma: o tomador desta
 * nota é a própria empresa? A lista já pede `direcao: "emitidas"` (o backend filtra por
 * `emitenteDoc`), então isto é o cinturão — e cinturão que depende de um campo inexistente não
 * segura nada. O `papel` continua sendo lido caso ele passe a vir um dia.
 *
 * ⚠ **SEM O CNPJ DA EMPRESA NÃO SE AFIRMA NADA.** Ausência de dado não vira acusação: sem
 * `cnpjDaEmpresa` a comparação simplesmente não acontece, e vale o filtro do servidor.
 *
 * ⚠ **AQUI "TER VALOR" NÃO SALVA A NOTA, e lá salvava.** No escritório uma nota sem tomador mas com
 * total ainda serve de modelo, porque o valor É copiado. Aqui o valor não viaja — então uma nota
 * sem tomador não tem literalmente nada a oferecer, e abrir o formulário "pré-preenchido" com nada
 * dentro seria a promessa vazia que a regra de lá existe para impedir.
 */
export function podeReaproveitar(nota, { cnpjDaEmpresa = "" } = {}) {
  if (!nota) {
    return { pode: false, motivo: MOTIVO_NAO_REAPROVEITAVEL.SEM_DADOS, resumo: "sem dados", texto: "A nota ainda não carregou." };
  }

  if (String(nota.type || "").toUpperCase() !== "NFSE") {
    return {
      pode: false,
      motivo: MOTIVO_NAO_REAPROVEITAVEL.NAO_E_NFSE,
      resumo: "só NFS-e",
      texto:
        "Só nota de serviço (NFS-e) serve de modelo aqui — a NF-e de venda não é emitida por este "
        + "portal, ela é capturada da SEFAZ.",
    };
  }

  const docEmpresa = soDigitos(cnpjDaEmpresa);
  const docTomador = soDigitos(nota.tomador?.cnpjCpf);
  const recebida =
    String(nota.papel || "").toUpperCase() === "DEST"
    || (docEmpresa.length === 14 && docTomador === docEmpresa);
  if (recebida) {
    return {
      pode: false,
      motivo: MOTIVO_NAO_REAPROVEITAVEL.RECEBIDA,
      resumo: "nota recebida",
      texto:
        "Nesta nota a tomadora é a sua própria empresa: quem prestou o serviço foi outro. "
        + "Reaproveitá-la ofereceria a sua empresa como tomadora dela mesma.",
    };
  }

  const temTomador = Boolean(String(nota.tomador?.nome || "").trim() || docTomador);
  if (!temTomador) {
    return {
      pode: false,
      motivo: MOTIVO_NAO_REAPROVEITAVEL.SEM_DADOS,
      resumo: "sem tomador",
      texto:
        "Não guardamos o tomador desta nota — e o valor não é copiado. Não há o que preencher: "
        + "abrir a emissão “pré-preenchida” com nada dentro prometeria um atalho que não existe.",
    };
  }

  return { pode: true, motivo: null, resumo: null, texto: null };
}

/**
 * A descrição do serviço, quando ela é UMA.
 *
 * ⚠ Hoje `itens` NUNCA vem no contrato do cliente (ver o cabeçalho): o caminho de verdade é o
 * `{ descricao: "", varios: false }`, que a tela traduz em "a descrição não veio da nota".
 */
function descricaoDosItens(nota) {
  const itens = Array.isArray(nota?.itens) ? nota.itens : [];
  const descricoes = [...new Set(itens.map((i) => String(i?.descricao ?? "").trim()).filter(Boolean))];
  if (descricoes.length === 1) return { descricao: descricoes[0], varios: false };
  return { descricao: "", varios: descricoes.length > 1 };
}

/**
 * Os campos do formulário de emissão a partir de uma nota já emitida.
 *
 * ⚠ A FORMA É A DOS CAMPOS DA TELA, de propósito: a página espalha isto por cima do formulário
 * vazio, sem traduzir nada. Chave que não seja campo do formulário não entra aqui — e é isso que a
 * varredura do teste prende.
 *
 * ⚠ `valorServicos` sai SEMPRE `""`. Não é "o total não veio": é o pedido do dono. E `""` é o único
 * valor aceitável — `formatarValorParaCampo` (`valorDaNota.js`), que o portal do escritório usa
 * para trazer o total da original, **não é importada aqui** justamente por isso.
 */
export function camposDaNota(nota) {
  if (!nota) return null;
  const { descricao } = descricaoDosItens(nota);
  return {
    tomadorDoc: soDigitos(nota.tomador?.cnpjCpf),
    tomadorNome: String(nota.tomador?.nome ?? "").trim(),
    // ⚠ Vazio porque NÃO TEMOS, não porque escolhemos não mandar: a nota capturada não traz e-mail
    // do tomador em campo nenhum. Com o CNPJ preenchido, a consulta à Receita oferece o endereço.
    tomadorEmail: "",
    descricao,
    // ⚠⚠ O VALOR VEM VAZIO — o pedido do dono. Nunca "0,00".
    valorServicos: "",
  };
}

/**
 * O que a tela precisa DIZER sobre reaproveitar ESTA nota.
 *
 * ⚠⚠ NOTA CANCELADA E NOTA SUBSTITUÍDA **PODEM** SER MODELO — e o porquê está aqui, não num chat.
 * Copiar dados não é reemitir: a original não é tocada, nenhum evento é gerado, e a nota nova nasce
 * com número próprio. Além disso é justamente o caso mais frequente (a nota errada é o melhor
 * modelo para a certa). O que NÃO se pode é a tela calar, porque aí quem emite conclui duas coisas
 * falsas: que isto "conserta" a cancelada, e que a nota nova SUBSTITUI a antiga. Por isso a
 * permissão vem sempre acompanhada do aviso.
 */
export function avisosDoReaproveitamento(nota) {
  const avisos = [];
  // ⚠ TRÊS FONTES, NESTA ORDEM, e nenhuma delas é inventada: `ciclo.situacao` é a leitura do
  // escritório (não vem neste contrato, mas se vier é a mais forte), `statusEfetivo` é a coluna
  // interna, e `status` é o que o portal do cliente REALMENTE recebe — `CANCELADA`/`SUBSTITUIDA`
  // em caixa alta e SEM acento (`PortalInvoice.status`, `apps/api/prisma/schema.prisma`), que é o
  // mesmo vocabulário do chip da lista.
  const situacao = String(nota?.ciclo?.situacao ?? nota?.statusEfetivo ?? nota?.status ?? "").toLowerCase();

  // ⚠ INCONDICIONAL: é a frase que impede a tela de parecer uma "reemissão".
  avisos.push({
    codigo: "nota_nova",
    tom: "neutro",
    texto:
      "Esta é uma nota NOVA, com número novo reservado na emissão. A nota de origem não é alterada, "
      + "cancelada nem substituída por aqui.",
  });

  // ⚠⚠ INCONDICIONAL, e é a diferença pedida pelo dono. Sem esta frase o campo vazio vira
  // esquecimento — e alguém emite achando que o valor veio junto.
  avisos.push({
    codigo: "valor_em_branco",
    tom: "atencao",
    texto: "O valor NÃO foi copiado: digite o valor desta nota.",
  });

  if (situacao === "cancelada") {
    avisos.push({
      codigo: "origem_cancelada",
      tom: "atencao",
      texto:
        "A nota de origem está CANCELADA e continua cancelada: esta emissão não a corrige nem a "
        + "substitui.",
    });
  }

  if (situacao === "substituida") {
    avisos.push({
      codigo: "origem_substituida",
      tom: "atencao",
      texto:
        "A nota de origem já foi SUBSTITUÍDA — quem vale hoje é a substituta. Emitir a partir desta "
        + "cria um TERCEIRO documento, sem vínculo com nenhuma das duas.",
    });
  }

  const { descricao, varios } = descricaoDosItens(nota);
  if (varios) {
    avisos.push({
      codigo: "varios_itens",
      tom: "atencao",
      texto:
        "A nota de origem tem mais de um item descrito e a NFS-e tem uma descrição só. A descrição "
        + "não foi copiada — escreva o que está sendo prestado.",
    });
  } else if (!descricao) {
    avisos.push({
      codigo: "sem_descricao",
      tom: "atencao",
      texto: "A descrição do serviço não veio da nota de origem — confira o que está no campo.",
    });
  }

  return avisos;
}

/**
 * O que a tela de emissão recebe: os campos MAIS os avisos MAIS a referência da origem, numa peça
 * só.
 *
 * Existe para que a tela não precise lembrar de chamar três funções — esquecer a segunda deixaria o
 * formulário pré-preenchido **sem** o "o valor não veio", que é a metade que impede a emissão
 * errada.
 *
 * ⚠ `companyId` viaja junto porque este objeto atravessa a casca do app: aplicar numa empresa o
 * modelo tirado da nota de OUTRA seria emitir no CNPJ errado — o pior desfecho possível num portal
 * multi-empresa, e irreversível aqui. A `EmitirNotaPage` confere antes de aplicar.
 *
 * ⚠ `origem` é REFERÊNCIA DE TELA ("a partir da nota nº X"), nunca campo de formulário. O número
 * dela existe aqui e **não pode** existir em `campos` — é a varredura do teste que separa os dois.
 */
export function modeloDeEmissaoDaNota(nota, { companyId = null, cnpjDaEmpresa = "" } = {}) {
  const permissao = podeReaproveitar(nota, { cnpjDaEmpresa });
  if (!permissao.pode) return null;
  return {
    companyId,
    campos: camposDaNota(nota),
    avisos: avisosDoReaproveitamento(nota),
    origem: {
      invoiceId: nota.invoiceId ?? null,
      numero: nota.numero ?? null,
      competencia: nota.competencia ?? null,
    },
  };
}
