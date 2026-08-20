// CONSULTA DO TOMADOR NA RECEITA — a REGRA, sem tela e sem rede.
//
// ⚠ ORIGEM: `apps/web/src/features/notas/lib/consultaTomador.js` (25 testes), do portal do
// escritório. O comportamento foi REPLICADO, não reinventado — as regras abaixo vieram de defeito
// real e não podem divergir entre os dois lados do mesmo ato fiscal. A chamada em si mora na
// camada de API deste app (`api/…/consultarCnpj`), que é o par mock/real, e não neste módulo:
// aqui só está o que a EMISSÃO decide em cima da resposta.
//
// ⚠ CPF NÃO SE CONSULTA. O campo do tomador é `cnpjCpf` e o tomador pode ser pessoa física. Com 11
// dígitos NADA acontece: sem chamada, sem "não encontrado", sem piscar, sem botão. A BrasilAPI é
// base de CNPJ; perguntar por CPF devolveria uma recusa que não significa nada, na tela de quem
// não errou nada.
//
// ⚠ A CONSULTA É AJUDA, NUNCA PORTÃO. Nenhuma função daqui devolve impedimento: falha de rede,
// CNPJ não encontrado ou API fora do ar não podem bloquear a emissão. A recusa APARECE — com a
// frase "a emissão segue normalmente" — e o botão Emitir fica como estava.
//
// ⚠ O QUE VEM DA API É SUGESTÃO; QUEM DIGITOU MANDA. O nome que vai na nota é ato fiscal. Se a
// pessoa digitou por cima, o digitado vence uma consulta nova — e a tela mostra os dois lados, com
// a origem no rótulo.

import {
  municipioPorCodigo,
  normalizarParaBusca,
  TAMANHO_CODIGO_IBGE,
} from "../../../lib/municipios/municipioIbge";

/** De onde veio o valor que está no campo. É isto que a tela mostra ao lado do rótulo. */
export const ORIGEM = { AUSENTE: "ausente", DA_RECEITA: "da_receita", DIGITADO: "digitado" };

/** Por que NÃO se consultou. `CPF` é o único em que a tela fica em silêncio absoluto. */
export const NAO_CONSULTA = { CPF: "cpf", FORA_DE_FORMA: "fora_de_forma", REPETIDA: "repetida" };

export function soDigitosDoc(valor) {
  return String(valor ?? "").replace(/\D+/g, "");
}

export function rotuloOrigem(origem) {
  if (origem === ORIGEM.DA_RECEITA) return "da Receita";
  if (origem === ORIGEM.DIGITADO) return "digitado";
  return "";
}

/**
 * Quando disparar a consulta.
 *
 * ⚠ Não é a cada tecla: só com os 14 dígitos completos, e **nunca duas vezes o mesmo CNPJ**
 * (`ultimoConsultado`). Sem essa memória, todo re-render que passasse pelo mesmo documento
 * repetiria a chamada — a BrasilAPI é pública e tem throttle.
 */
export function decidirConsulta(cnpjCpf, { ultimoConsultado = null } = {}) {
  const digitos = soDigitosDoc(cnpjCpf);
  if (digitos.length === 11) return { consultar: false, motivo: NAO_CONSULTA.CPF, digitos };
  if (digitos.length !== 14) return { consultar: false, motivo: NAO_CONSULTA.FORA_DE_FORMA, digitos };
  if (soDigitosDoc(ultimoConsultado) === digitos) {
    return { consultar: false, motivo: NAO_CONSULTA.REPETIDA, digitos };
  }
  return { consultar: true, motivo: null, digitos };
}

/**
 * O nome/razão social que a resposta traz — e a decisão de aplicá-lo ou não.
 *
 * ⚠ Duas recusas de aplicar, e as duas importam:
 *   • resposta sem `razao_social` ⇒ **não escreve nada** (campo que a API não deu fica vazio, nunca
 *     com string vazia disfarçada de valor);
 *   • campo já digitado por cima ⇒ o digitado VENCE, inclusive numa consulta posterior.
 */
export function nomeDaReceita(bruto) {
  return String(bruto?.razao_social || "").trim();
}

export function aplicarNome({ nomeAtual = "", origemAtual = ORIGEM.AUSENTE, nome = "" } = {}) {
  const daReceita = String(nome || "").trim();
  const atual = String(nomeAtual || "");
  if (!daReceita) {
    return {
      nome: atual,
      origem: origemAtual,
      aplicou: false,
      motivo: "a consulta não trouxe a razão social",
    };
  }
  if (origemAtual === ORIGEM.DIGITADO && atual.trim()) {
    return {
      nome: atual,
      origem: ORIGEM.DIGITADO,
      aplicou: false,
      motivo: "o nome digitado vence a consulta",
    };
  }
  return { nome: daReceita, origem: ORIGEM.DA_RECEITA, aplicou: true, motivo: null };
}

/**
 * Os cinco campos que o backend exige para aceitar o endereço do tomador
 * (`hasEnderecoTomador`, em `apps/api/src/application/validators/nfsePayload.js`). `xCpl` fica
 * fora: é o único opcional.
 */
export const CAMPOS_ENDERECO_EXIGIDOS = [
  ["cMun", "o código IBGE do município"],
  ["CEP", "o CEP"],
  ["xLgr", "o logradouro"],
  ["nro", "o número"],
  ["xBairro", "o bairro"],
];

/**
 * O código IBGE do município do tomador — aceito por VERIFICAÇÃO, nunca por confiança.
 *
 * ⚠ ESTE PROJETO PROÍBE DERIVAR CÓDIGO DE MUNICÍPIO A PARTIR DO NOME (homônimo: há cinco "Bom
 * Jesus" no país, e o erro só apareceria como nota emitida no município errado). Aqui NÃO se
 * deriva nada: o que se faz é o contrário, aceitar um código que a resposta traga **desde que ele
 * se prove**, contra a lista oficial versionada do IBGE:
 *   1. tem exatamente 7 dígitos;
 *   2. existe na lista (`@contabilidade/shared/municipios-ibge`);
 *   3. o município e a UF dessa linha batem com o `municipio`/`uf` da MESMA resposta.
 *
 * ⚠ O NOME DO CAMPO NA BRASILAPI NÃO ESTÁ CONFIRMADO por documentação oficial neste repositório —
 * e é justamente por isso que a aceitação passa pelas três provas acima. Campo ausente, com outro
 * nome ou com outro significado simplesmente NÃO produz código: devolve `null` com o motivo, e o
 * endereço inteiro deixa de ser oferecido. Nada é fabricado em nenhum caminho.
 */
export function codigoMunicipioVerificado(bruto, municipios) {
  const candidato = soDigitosDoc(bruto?.codigo_municipio_ibge ?? bruto?.codigo_municipio ?? "");
  if (candidato.length !== TAMANHO_CODIGO_IBGE) {
    return { codigo: null, motivo: "a consulta não trouxe o código IBGE do município" };
  }
  if (!Array.isArray(municipios) || municipios.length === 0) {
    return { codigo: null, motivo: "a lista oficial do IBGE não foi carregada para conferir o código" };
  }
  const linha = municipioPorCodigo(municipios, candidato);
  if (!linha) {
    return { codigo: null, motivo: `o código ${candidato} não existe na lista oficial do IBGE` };
  }
  const nomeDaResposta = String(bruto?.municipio || "").trim();
  const ufDaResposta = String(bruto?.uf || "").trim().toUpperCase();
  const bate =
    normalizarParaBusca(linha[1]) === normalizarParaBusca(nomeDaResposta) &&
    String(linha[2]).toUpperCase() === ufDaResposta;
  if (!bate) {
    return {
      codigo: null,
      motivo:
        `o código ${candidato} é de ${linha[1]}/${linha[2]} e a consulta diz `
        + `${nomeDaResposta || "(sem município)"}/${ufDaResposta || "(sem UF)"}`,
    };
  }
  return { codigo: candidato, nome: linha[1], uf: linha[2], motivo: null };
}

/**
 * O endereço do tomador como a resposta o traz — TUDO OU NADA.
 *
 * ⚠ Meio endereço é pior que nenhum: o validador do backend só aceita o bloco COMPLETO e descarta
 * o resto em silêncio, e o formulário marca os cinco campos como obrigatórios. Ou seja, preencher
 * quatro dos cinco transformaria uma consulta BEM-SUCEDIDA em bloqueio da emissão — a consulta
 * virando portão, exatamente o que ela não pode ser. Faltando um pedaço, devolve `endereco: null`
 * e diz o que faltou.
 */
export function enderecoDaReceita(bruto, { municipios = null } = {}) {
  const municipio = codigoMunicipioVerificado(bruto, municipios);
  const lido = {
    cMun: municipio.codigo || "",
    CEP: soDigitosDoc(bruto?.cep),
    // ⚠ O LOGRADOURO É QUEM MANDA — o tipo sozinho NÃO é um logradouro. Enquanto isto era
    // `[tipo, logradouro].filter(Boolean).join(" ")`, uma resposta com
    // `descricao_tipo_de_logradouro: "RUA"` e `logradouro` vazio produzia a string **"RUA"** —
    // não-vazia, portanto **aprovada** pela checagem de tudo-ou-nada logo abaixo. Meio campo
    // passando por inteiro, na exata regra que existe para impedir isso ("meio endereço é pior
    // que nenhum"): o endereço inteiro entrava no formulário com a palavra "Rua" no lugar da rua,
    // e ia para o XML da nota. Sem logradouro, `xLgr` fica VAZIO e o bloco todo é recusado.
    xLgr: String(bruto?.logradouro || "").trim()
      ? [bruto?.descricao_tipo_de_logradouro, bruto?.logradouro].filter(Boolean).join(" ").trim()
      : "",
    nro: String(bruto?.numero || "").trim(),
    xCpl: String(bruto?.complemento || "").trim(),
    xBairro: String(bruto?.bairro || "").trim(),
  };
  const faltantes = CAMPOS_ENDERECO_EXIGIDOS.filter(([campo]) => !lido[campo]).map(([, rotulo]) => rotulo);
  if (faltantes.length) {
    return { endereco: null, faltantes, motivoMunicipio: municipio.motivo };
  }
  return { endereco: lido, faltantes: [], motivoMunicipio: null };
}

export function mensagemEndereco(leitura) {
  if (leitura?.endereco) {
    return "Endereço preenchido com o que a consulta devolveu — confira antes de emitir.";
  }
  const faltantes = leitura?.faltantes || [];
  const detalhe = leitura?.motivoMunicipio ? ` (${leitura.motivoMunicipio})` : "";
  // ⚠ ENCURTADA EM 19/08/2026. Saiu *"meio endereço seria descartado inteiro, então ele fica
  // vazio"* — é o nosso raciocínio. FICOU o que o cliente precisa: o endereço não veio, o que
  // faltou, que a nota exige ele completo, e o que fazer.
  return (
    `O endereço NÃO foi preenchido: a consulta não trouxe ${faltantes.join(", ")}${detalhe}. `
    + "A nota exige o endereço do tomador completo. Preencha à mão."
  );
}

/** Aplica o endereço consultado. Mesma regra do nome: o que a pessoa digitou vence. */
export function aplicarEndereco({ enderecoAtual = {}, origemAtual = ORIGEM.AUSENTE, endereco = null } = {}) {
  if (!endereco) return { endereco: enderecoAtual, origem: origemAtual, aplicou: false };
  const jaTemAlgo = Object.values(enderecoAtual || {}).some((v) => String(v || "").trim());
  if (origemAtual === ORIGEM.DIGITADO && jaTemAlgo) {
    return { endereco: enderecoAtual, origem: ORIGEM.DIGITADO, aplicou: false };
  }
  return { endereco: { ...enderecoAtual, ...endereco }, origem: ORIGEM.DA_RECEITA, aplicou: true };
}

/**
 * A situação cadastral vem de graça na mesma resposta e muda a conversa: emitir nota para um
 * tomador BAIXADO/INAPTO é decisão de quem emite, mas ele precisa saber. Aviso — nunca bloqueio.
 */
export function avisoSituacao(situacao) {
  if (!situacao?.texto || situacao.ativa) return null;
  const motivo = situacao.motivo ? ` (${situacao.motivo})` : "";
  return `Situação cadastral do tomador na Receita: ${situacao.texto}${motivo}.`;
}
