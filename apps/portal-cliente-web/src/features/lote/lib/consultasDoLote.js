// O SEGUNDO PASSE DA CONSULTA — a Receita é consultada AQUI, do navegador, uma linha por vez.
//
// ⚠⚠ **A DECISÃO JÁ ESTAVA TOMADA E ESTÁ ESCRITA NO BACKEND** (`nfseLoteRoutes.js`): o
// classificador é PURO e devolve `consultar` para a linha que precisa; quem consulta é o front,
// porque é aqui que a chamada à BrasilAPI já mora (`api/real/brasilApi.js`, direto do browser, sem
// proxy) e é aqui que está a lista oficial do IBGE que faz a prova tripla do `cMun`. Um segundo
// cliente HTTP no servidor seria uma segunda implementação da mesma consulta.
//
// ⚠⚠ **CPF NÃO SE CONSULTA. NUNCA.** Decisão do dono, registrada em `utils/cpf.js`, em
// `consultaTomador.js` e no classificador. A BrasilAPI é base de CNPJ. Aqui a guarda é
// `decidirConsulta`, a MESMA da emissão avulsa — e há teste provando que nenhuma chamada sai.
// (Por construção o backend nunca põe CPF em `aConsultar`: com 11 dígitos e sem endereço a linha
// já nasce PENDENTE. A guarda existe porque "por construção" é o que muda sem avisar.)
//
// ⚠⚠ **RESULTADO PARCIAL É NORMAL, E É O QUE IMPEDE A TELA DE TRAVAR.** Numa planilha de 200 linhas
// a consulta é em SÉRIE. Uma consulta que falha **não interrompe** as outras: ela vira o resultado
// daquela linha, com o motivo, e o lote segue. E o mapa acumulado pode ser devolvido ao servidor a
// qualquer momento — 40 resolvidas e 160 ainda em `consultar` é um estado que o backend aceita.
//
// ⚠ **O MAPA É POR DOCUMENTO, NÃO POR LINHA.** Vinte linhas do mesmo CNPJ consomem UMA consulta —
// a BrasilAPI é pública e tem throttle. É a mesma economia que `decidirConsulta` já faz na emissão
// avulsa com o `ultimoConsultado`.

import { decidirConsulta, enderecoDaReceita, NAO_CONSULTA } from "../../emitir/lib/consultaTomador";

/**
 * Traduz a resposta da BrasilAPI para o que o backend espera em `consultas[documento]`.
 *
 * O contrato foi LIDO de `classificarLinhaLote.js`, não deduzido:
 *   `{ ok: false, motivo }`                       → pendência `consulta_falhou`, com o motivo
 *   `{ ok: true, endereco: null, faltantes }`     → pendência `consulta_sem_endereco`
 *   `{ ok: true, endereco, municipio, uf }`       → endereço aceito, origem `consulta`
 *
 * ─── ⚠⚠ QUEM PROVA O MUNICÍPIO É O SERVIDOR, DESDE 20/08/2026 ───────────────────────────────
 *
 * Este módulo continua fazendo a prova tripla **para a tela** (é ela que precisa decidir o que
 * mostrar, e `enderecoDaReceita` devolve `endereco: null` quando a prova falha). O que mudou é que
 * **o backend não acredita mais nela**: ele refaz as três provas com a lista oficial, que agora
 * alcança pelo pacote compartilhado.
 *
 * ⚠ **POR ISSO `municipio` E `uf` VIAJAM CRUS.** Sem eles o servidor consegue provar que o código
 * existe, mas **não** que ele é o município DESTA resposta — a prova 3 — e recusa a linha. Resumir
 * a resposta num booleano era exatamente o que deixava 50 notas fiscais apoiadas na palavra do
 * navegador.
 *
 * ⚠ `cMunVerificado` continua sendo enviado por COMPATIBILIDADE de contrato, mas o backend **não o
 * lê mais**. Não acrescente regra nova apoiada nele: um front adulterado mandando `true` com um
 * código de outro município é recusado no servidor.
 */
export function resultadoParaOBackend(resposta, { municipios = null } = {}) {
  if (!resposta || resposta.ok !== true) {
    return {
      ok: false,
      // ⚠ A `mensagem` do `brasilApi.js` diz o FATO ("não conseguimos consultar a Receita agora").
      // O que fazer é da tela, e o backend já completa a frase da pendência com isso.
      motivo: String(resposta?.mensagem || resposta?.motivo || "a consulta não respondeu"),
    };
  }

  const leitura = enderecoDaReceita(resposta.bruto, { municipios });
  if (!leitura.endereco) {
    return { ok: true, cMunVerificado: false, endereco: null, faltantes: leitura.faltantes };
  }
  return {
    ok: true,
    cMunVerificado: true,
    endereco: leitura.endereco,
    // ⚠ O NOME E A UF **DA MESMA RESPOSTA**, crus, para o servidor refazer a prova 3. Mandar o que
    // a LISTA diz (em vez do que a consulta disse) faria a conferência comparar a lista consigo
    // mesma e passar sempre — que é o mesmo que não conferir.
    municipio: String(resposta.bruto?.municipio ?? "").trim(),
    uf: String(resposta.bruto?.uf ?? "").trim().toUpperCase(),
  };
}

/**
 * Consulta os documentos em SÉRIE, com progresso, e devolve o mapa acumulado.
 *
 * @param {string[]} documentos o `aConsultar` que o backend devolveu.
 * @param {object} opcoes
 * @param {(cnpj: string) => Promise<object>} opcoes.consultar normalmente `api.consultarCnpj`.
 * @param {Array|null} opcoes.municipios a lista oficial do IBGE (para a prova tripla).
 * @param {object} [opcoes.jaConhecidos] o mapa que já se tem — documento repetido não é reconsultado.
 * @param {(p: {feitas: number, total: number, documento: string}) => void} [opcoes.aoProgredir]
 * @param {() => boolean} [opcoes.deveParar] chamada ANTES de cada consulta; `true` interrompe e
 *   devolve o que já foi resolvido. É o botão "Parar" — e o que já veio não se perde.
 */
export async function consultarDocumentos(
  documentos,
  { consultar, municipios = null, jaConhecidos = null, aoProgredir = null, deveParar = null } = {}
) {
  const resultados = { ...(jaConhecidos || {}) };
  const alvos = [...new Set((documentos || []).map((d) => String(d || "")).filter(Boolean))].filter(
    (d) => !Object.prototype.hasOwnProperty.call(resultados, d)
  );

  let feitas = 0;
  let parou = false;
  const ignorados = [];

  for (const documento of alvos) {
    if (typeof deveParar === "function" && deveParar()) {
      parou = true;
      break;
    }

    // ⚠ A MESMA guarda da emissão avulsa. CPF não gera chamada nenhuma — nem uma recusa, que na
    // tela de quem não errou nada não significaria coisa alguma.
    const decisao = decidirConsulta(documento);
    if (!decisao.consultar) {
      ignorados.push({ documento, motivo: decisao.motivo });
      // ⚠ Nada é gravado no mapa: um resultado inventado aqui viraria pendência `consulta_falhou`
      // numa linha que o backend nunca mandou consultar.
      if (decisao.motivo === NAO_CONSULTA.CPF) continue;
      continue;
    }

    let resposta;
    try {
      resposta = await consultar(documento);
    } catch (err) {
      // ⚠ `brasilApi.js` não lança — mas quem chama esta função passa uma dependência, e uma
      // exceção que escapasse aqui interromperia o lote inteiro na primeira linha ruim.
      resposta = { ok: false, mensagem: String(err?.message || "a consulta não respondeu") };
    }

    resultados[documento] = resultadoParaOBackend(resposta, { municipios });
    feitas += 1;
    if (typeof aoProgredir === "function") {
      aoProgredir({ feitas, total: alvos.length, documento });
    }
  }

  return { resultados, feitas, total: alvos.length, parou, ignorados };
}
