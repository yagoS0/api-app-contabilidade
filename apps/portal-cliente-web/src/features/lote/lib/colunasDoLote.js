// AS COLUNAS DA PLANILHA DO LOTE — ESPELHO da lista fechada do backend.
//
// ⚠⚠ **A AUTORIDADE É `apps/api/src/application/nfse/lote/colunasLote.js`**, e este arquivo é
// cópia. O espelho é **amarrado por teste**: `__tests__/colunasDoLote.test.js` importa a lista do
// backend e exige as MESMAS chaves, os MESMOS rótulos, na MESMA ordem, com a mesma
// obrigatoriedade. Sem esse amarre, "espelho" é intenção, não fato — e a divergência apareceria
// como *"ajustei o campo e o servidor recusou dizendo que ele não existe"*.
//
// ⚠ POR QUE HÁ CÓPIA, se o teste consegue importar o original: o **build** não consegue. O Docker
// deste portal tem Root Directory `apps/portal-cliente-web` (ver `Dockerfile` e `railway.toml`), e
// `apps/api` **não está no contexto de build** — um import cruzado no código de produção quebraria
// o deploy. No teste, que roda no monorepo inteiro, ele funciona; é exatamente a mesma solução do
// `codigoServicoDaNota.js`.
//
// ⚠ **O que NÃO foi copiado, de propósito:** os `aliases` (só o leitor da planilha os usa) e o
// texto de `ajuda` (ele descreve como PREENCHER a planilha; na tela quem diz o que fazer é a
// pendência que o backend devolveu, com a frase daquele caso). Copiar os dois seria trazer duas
// listas a mais para divergir sem que nada na tela dependesse delas.

/** Na ordem do modelo. `chave` é o vocabulário do domínio — o mesmo do XML e do validador. */
export const COLUNAS_DO_LOTE = Object.freeze([
  { chave: "documento", rotulo: "CNPJ/CPF do tomador", obrigatoria: true },
  { chave: "nome", rotulo: "Nome / razão social do tomador", obrigatoria: true },
  { chave: "descricao", rotulo: "Descrição do serviço", obrigatoria: true },
  { chave: "valor", rotulo: "Valor do serviço (R$)", obrigatoria: true },
  { chave: "competencia", rotulo: "Data da competência (dd/mm/aaaa)", obrigatoria: true },
  { chave: "email", rotulo: "E-mail do tomador", obrigatoria: false },
  { chave: "cMun", rotulo: "Código IBGE do município do tomador", obrigatoria: false },
  { chave: "cep", rotulo: "CEP do tomador", obrigatoria: false },
  { chave: "xLgr", rotulo: "Logradouro do tomador", obrigatoria: false },
  { chave: "nro", rotulo: "Número", obrigatoria: false },
  { chave: "xBairro", rotulo: "Bairro", obrigatoria: false },
  { chave: "xCpl", rotulo: "Complemento", obrigatoria: false },
]);

/**
 * O bloco de endereço, que a emissão exige INTEIRO (só `xCpl` é opcional).
 *
 * ⚠ Ele fica junto no formulário de ajuste porque é TUDO OU NADA: `buildDpsXml` recusa a emissão
 * (`MISSING_TOMADOR_ADDRESS`) faltando qualquer um dos cinco. Espalhar esses campos entre os
 * outros faria a pessoa preencher quatro e achar que adiantou.
 */
export const CAMPOS_DE_ENDERECO = Object.freeze(["cMun", "cep", "xLgr", "nro", "xBairro", "xCpl"]);

export const CHAVES_DO_LOTE = Object.freeze(COLUNAS_DO_LOTE.map((c) => c.chave));

export function rotuloDaColuna(chave) {
  return COLUNAS_DO_LOTE.find((c) => c.chave === chave)?.rotulo || String(chave || "");
}

/**
 * O nome do arquivo que a pessoa salva ao baixar o modelo.
 *
 * ⚠ ESPELHO de `NOME_DO_ARQUIVO` (`modeloPlanilhaLote.js`), e composto AQUI porque o
 * `Content-Disposition` **não é legível por JavaScript entre origens** (não está na lista segura do
 * CORS, e o portal roda em outra porta que a API). Ler aquele cabeçalho produziria um download
 * chamado `undefined.xlsx` — é a mesma razão já registrada em `notas/lib/loteDanfse.js`.
 */
export const NOME_DO_ARQUIVO_MODELO = "modelo-emissao-em-lote.xlsx";
