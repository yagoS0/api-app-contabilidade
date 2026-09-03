// CONSULTA DO TOMADOR NA RECEITA — a REGRA, do lado do SERVIDOR. Pura: sem rede, sem prisma.
//
// ⚠⚠ ESTE É O TERCEIRO LEITOR DA MESMA REGRA. Os dois primeiros moram nos portais:
//   `apps/web/src/features/notas/lib/consultaTomador.js`
//   `apps/portal-cliente-web/src/features/emitir/lib/consultaTomador.js`
// e continuam lá, de propósito (divergem numa frase de PRODUTO; ver a tabela "mudou lá, muda aqui"
// em `apps/portal-cliente-web/CLAUDE.md`). Este nasceu em 02/09/2026 porque o assistente de
// WhatsApp precisa completar o tomador SEM navegador — e a regra é amarrada por teste que importa
// a função do `apps/web` e exige o mesmo veredito nos mesmos casos.
//
// ⚠ CPF NÃO SE CONSULTA (decisão do dono). A BrasilAPI é base de CNPJ; 11 dígitos ⇒ nada acontece.
//
// ⚠ A CONSULTA É AJUDA, NUNCA PORTÃO. Nenhuma função daqui devolve impedimento: falha de rede, CNPJ
// não encontrado ou API fora do ar não bloqueiam a emissão — o que se digita vence.
//
// ⚠⚠ O `cMun` ENTRA POR PROVA TRIPLA, NUNCA POR CONFIANÇA — e nunca se DERIVA código do nome (há
// cinco "Bom Jesus" no país; o erro só aparece como nota emitida no município errado). Aceita-se um
// código que a resposta traga, desde que: (1) tenha 7 dígitos; (2) exista na lista oficial do IBGE
// (`@contabilidade/shared/municipios-ibge`); (3) o município e a UF daquela linha batam com o
// `municipio`/`uf` da MESMA resposta. Falhou qualquer prova: `null` com o motivo, e o endereço
// INTEIRO deixa de ser oferecido (meio endereço é pior que nenhum — o validador só aceita o bloco
// completo).

export const TAMANHO_CODIGO_IBGE = 7;

/** De onde veio o valor. É isto que a tela/o assistente dizem ao lado do campo. */
export const ORIGEM = Object.freeze({ AUSENTE: "ausente", DA_RECEITA: "da_receita", DIGITADO: "digitado" });

/** Por que NÃO se consultou. `CPF` é o único em que se fica em silêncio absoluto. */
export const NAO_CONSULTA = Object.freeze({ CPF: "cpf", FORA_DE_FORMA: "fora_de_forma", REPETIDA: "repetida" });

export function soDigitosDoc(valor) {
  return String(valor ?? "").replace(/\D+/g, "");
}

/** A MESMA normalização dos dois portais (`municipioIbge.normalizarParaBusca`): sem acento, caixa baixa. */
export function normalizarParaBusca(texto) {
  return String(texto ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();
}

/** Quando consultar: só com 14 dígitos, nunca CPF, nunca o mesmo CNPJ duas vezes seguidas. */
export function decidirConsulta(cnpjCpf, { ultimoConsultado = null } = {}) {
  const digitos = soDigitosDoc(cnpjCpf);
  if (digitos.length === 11) return { consultar: false, motivo: NAO_CONSULTA.CPF, digitos };
  if (digitos.length !== 14) return { consultar: false, motivo: NAO_CONSULTA.FORA_DE_FORMA, digitos };
  if (soDigitosDoc(ultimoConsultado) === digitos) return { consultar: false, motivo: NAO_CONSULTA.REPETIDA, digitos };
  return { consultar: true, motivo: null, digitos };
}

export function nomeDaReceita(bruto) {
  return String(bruto?.razao_social || "").trim();
}

/** Situação cadastral ≠ ATIVA muda a conversa — como AVISO, nunca bloqueio. */
export function situacaoCadastral(bruto) {
  const texto = String(bruto?.descricao_situacao_cadastral || "").trim().toUpperCase();
  return {
    texto: texto || null,
    ativa: texto === "ATIVA",
    motivo: String(bruto?.motivo_situacao_cadastral || "").trim() || null,
    data: String(bruto?.data_situacao_cadastral || "").trim() || null,
  };
}

export function avisoSituacao(situacao) {
  if (!situacao?.texto || situacao.ativa) return null;
  const motivo = situacao.motivo ? ` (${situacao.motivo})` : "";
  return `Situação cadastral do tomador na Receita: ${situacao.texto}${motivo}.`;
}

/** Os cinco campos que o validador exige (`hasEnderecoTomador`); `xCpl` é opcional. */
export const CAMPOS_ENDERECO_EXIGIDOS = Object.freeze([
  ["cMun", "o código IBGE do município"],
  ["CEP", "o CEP"],
  ["xLgr", "o logradouro"],
  ["nro", "o número"],
  ["xBairro", "o bairro"],
]);

/**
 * O código IBGE, aceito por VERIFICAÇÃO. `municipios` = as tuplas `[codigo, nome, uf]` da lista oficial.
 * ⚠ O nome do campo na BrasilAPI (`codigo_municipio_ibge`) não está confirmado por documentação
 * oficial neste repositório — é por isso que a aceitação passa pelas três provas.
 */
export function codigoMunicipioVerificado(bruto, municipios) {
  const candidato = soDigitosDoc(bruto?.codigo_municipio_ibge ?? bruto?.codigo_municipio ?? "");
  if (candidato.length !== TAMANHO_CODIGO_IBGE) {
    return { codigo: null, motivo: "a consulta não trouxe o código IBGE do município" };
  }
  if (!Array.isArray(municipios) || municipios.length === 0) {
    return { codigo: null, motivo: "a lista oficial do IBGE não foi carregada para conferir o código" };
  }
  const linha = municipios.find((m) => String(m?.[0] ?? "") === candidato);
  if (!linha) {
    return { codigo: null, motivo: `o código ${candidato} não existe na lista oficial do IBGE` };
  }
  const nomeDaResposta = String(bruto?.municipio || "").trim();
  const ufDaResposta = String(bruto?.uf || "").trim().toUpperCase();
  const bate =
    normalizarParaBusca(linha[1]) === normalizarParaBusca(nomeDaResposta)
    && String(linha[2]).toUpperCase() === ufDaResposta;
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

/** O endereço como a resposta o traz — TUDO OU NADA. O logradouro manda: "RUA" sozinho não é rua. */
export function enderecoDaReceita(bruto, { municipios = null } = {}) {
  const municipio = codigoMunicipioVerificado(bruto, municipios);
  const lido = {
    cMun: municipio.codigo || "",
    CEP: soDigitosDoc(bruto?.cep),
    xLgr: String(bruto?.logradouro || "").trim()
      ? [bruto?.descricao_tipo_de_logradouro, bruto?.logradouro].filter(Boolean).join(" ").trim()
      : "",
    nro: String(bruto?.numero || "").trim(),
    xCpl: String(bruto?.complemento || "").trim(),
    xBairro: String(bruto?.bairro || "").trim(),
  };
  const faltantes = CAMPOS_ENDERECO_EXIGIDOS.filter(([campo]) => !lido[campo]).map(([, rotulo]) => rotulo);
  if (faltantes.length) return { endereco: null, faltantes, motivoMunicipio: municipio.motivo };
  return { endereco: lido, faltantes: [], motivoMunicipio: null };
}

/**
 * O e-mail que a Receita traz, quando traz e quando tem forma de e-mail. Ausente ⇒ `null` — nunca
 * string vazia disfarçada de valor.
 */
export function emailDaReceita(bruto) {
  const e = String(bruto?.email || "").trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) ? e : null;
}

/**
 * O TOMADOR montado a partir da resposta crua — o que o assistente (e qualquer rota) recebe.
 * Nada aqui é inventado: campo que a resposta não deu fica `null`, e o endereço só existe inteiro.
 */
export function tomadorDaReceita(bruto, { municipios = null } = {}) {
  const nome = nomeDaReceita(bruto) || null;
  const situacao = situacaoCadastral(bruto);
  const leitura = enderecoDaReceita(bruto, { municipios });
  return {
    nome,
    email: emailDaReceita(bruto),
    endereco: leitura.endereco,
    enderecoFaltantes: leitura.faltantes,
    motivoMunicipio: leitura.motivoMunicipio,
    situacao,
    avisoSituacao: avisoSituacao(situacao),
    municipioTexto: String(bruto?.municipio || "").trim() || null,
    uf: String(bruto?.uf || "").trim().toUpperCase() || null,
  };
}
