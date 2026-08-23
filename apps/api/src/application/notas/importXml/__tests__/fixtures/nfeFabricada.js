// FIXTURES DE NF-e — 100% FABRICADAS.
//
// ⚠⚠ TODO CNPJ E TODA CHAVE AQUI SÃO INVENTADOS. Mesmo FORMATO dos reais (14 dígitos, dígito
// verificador válido, chave de 44 com DV calculado), conteúdo nenhum. Fixture entra no histórico do
// git PARA SEMPRE — não há como despublicar depois.
//
// ⚠ OS CNPJS MORAM SÓ AQUI, e é de propósito: já houve neste projeto um CNPJ anonimizado reusado
// para DUAS empresas diferentes em fixtures distintas, o que fez um teste "provar" o contrário do
// que dizia. Quem precisar de CNPJ de teste para NF-e importa deste arquivo; quem precisar de um
// papel NOVO acrescenta aqui, com nome, em vez de inventar o seu.
//
// Conferido contra a lista de CNPJs já usados em `apps/api/src/**/*.test.js` (23/08/2026): nenhum
// destes cinco colide com fixture existente.

export const CNPJ = {
  /** A empresa do teste — matriz. É este que vai no `PortalClient.cnpj`. */
  EMPRESA_MATRIZ: "71402596000102",
  /** MESMA raiz, ordem 0002 — o lote da filial subido na matriz (`outro_estabelecimento`). */
  EMPRESA_FILIAL: "71402596000285",
  /** Raiz completamente diferente — nota de terceiro (`nota_nao_pertence`). */
  TERCEIRO: "83051742000173",
  /** Quem COMPRA da empresa: destinatário da nota de VENDA (papel EMIT para nós). */
  CLIENTE_COMPRADOR: "52918364000159",
  /** Quem VENDE para a empresa: emitente da nota de compra (papel DEST para nós). */
  FORNECEDOR: "64730851000172",
};

/**
 * Dígito verificador da chave de acesso (módulo 11, pesos 2..9 da direita para a esquerda) —
 * Manual de Orientação do Contribuinte, Anexo "Chave de Acesso".
 */
export function dvDaChave(chave43) {
  let soma = 0;
  let peso = 2;
  for (let i = chave43.length - 1; i >= 0; i -= 1) {
    soma += Number(chave43[i]) * peso;
    peso = peso === 9 ? 2 : peso + 1;
  }
  const resto = soma % 11;
  const dv = 11 - resto;
  return String(dv >= 10 ? 0 : dv);
}

/**
 * Monta a chave de 44: cUF(2) AAMM(4) CNPJ(14) mod(2) serie(3) nNF(9) tpEmis(1) cNF(8) cDV(1).
 * As posições importam para o código: `modelo` é lido de 20-22 e `serie`/`numero` de 22-25/25-34.
 */
export function montarChave({
  cUF = "33", // RJ
  aamm = "2602",
  cnpj = CNPJ.EMPRESA_MATRIZ,
  modelo = "55",
  serie = "001",
  numero = "000000101",
  tpEmis = "1",
  cNF = "00000001",
} = {}) {
  const base = `${cUF}${aamm}${cnpj}${modelo}${serie}${numero}${tpEmis}${cNF}`;
  return base + dvDaChave(base);
}

/**
 * `nfeProc` — o documento AUTORIZADO, que é o que o extrator do Fisco Fácil entrega.
 * Os nomes são de fantasia; os valores, redondos.
 */
export function xmlNfeProc({
  chave = montarChave(),
  emitCnpj = CNPJ.EMPRESA_MATRIZ,
  emitNome = "EMPRESA FABRICADA COMERCIO LTDA",
  destCnpj = CNPJ.CLIENTE_COMPRADOR,
  destNome = "CLIENTE FABRICADO SA",
  numero = "101",
  serie = "1",
  dhEmi = "2026-02-10T09:15:00-03:00",
  modelo = "55",
  vNF = "1500.00",
  itens = [{ xProd: "PRODUTO FABRICADO A", ncm: "84713012", cfop: "5102", vProd: "1500.00" }],
  cStat = "100",
  encoding = "UTF-8",
} = {}) {
  const det = itens.map((it, i) => `
      <det nItem="${i + 1}">
        <prod>
          <cProd>P${i + 1}</cProd>
          <xProd>${it.xProd}</xProd>
          <NCM>${it.ncm}</NCM>
          <CFOP>${it.cfop}</CFOP>
          <uCom>UN</uCom>
          <qCom>1.0000</qCom>
          <vUnCom>${it.vProd}</vUnCom>
          <vProd>${it.vProd}</vProd>
        </prod>
      </det>`).join("");
  return `<?xml version="1.0" encoding="${encoding}"?>
<nfeProc xmlns="http://www.portalfiscal.inf.br/nfe" versao="4.00">
  <NFe>
    <infNFe Id="NFe${chave}" versao="4.00">
      <ide>
        <cUF>33</cUF>
        <natOp>VENDA DE MERCADORIA</natOp>
        <mod>${modelo}</mod>
        <serie>${serie}</serie>
        <nNF>${numero}</nNF>
        <dhEmi>${dhEmi}</dhEmi>
        <tpNF>1</tpNF>
      </ide>
      <emit>
        <CNPJ>${emitCnpj}</CNPJ>
        <xNome>${emitNome}</xNome>
        <IE>11111111</IE>
      </emit>
      <dest>
        <CNPJ>${destCnpj}</CNPJ>
        <xNome>${destNome}</xNome>
      </dest>${det}
      <total><ICMSTot><vNF>${vNF}</vNF></ICMSTot></total>
    </infNFe>
  </NFe>
  <protNFe versao="4.00">
    <infProt>
      <chNFe>${chave}</chNFe>
      <cStat>${cStat}</cStat>
      <xMotivo>Autorizado o uso da NF-e</xMotivo>
      <nProt>133260000000001</nProt>
    </infProt>
  </protNFe>
</nfeProc>`;
}

/** `procEventoNFe` — vem MISTURADO com as notas no ZIP do Fisco Fácil. */
export function xmlEvento({ chave = montarChave(), tpEvento = "110111", cnpjAutor = CNPJ.EMPRESA_MATRIZ } = {}) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<procEventoNFe xmlns="http://www.portalfiscal.inf.br/nfe" versao="1.00">
  <evento versao="1.00">
    <infEvento Id="ID${tpEvento}${chave}01">
      <cOrgao>33</cOrgao>
      <CNPJ>${cnpjAutor}</CNPJ>
      <chNFe>${chave}</chNFe>
      <tpEvento>${tpEvento}</tpEvento>
      <nSeqEvento>1</nSeqEvento>
      <detEvento versao="1.00"><descEvento>Cancelamento</descEvento></detEvento>
    </infEvento>
  </evento>
</procEventoNFe>`;
}

/** `resNFe` — o RESUMO (sem o XML da nota). Não traz destinatário nenhum. */
export function xmlResumo({ chave = montarChave(), emitCnpj = CNPJ.FORNECEDOR, vNF = "300.00" } = {}) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<resNFe xmlns="http://www.portalfiscal.inf.br/nfe" versao="1.01">
  <chNFe>${chave}</chNFe>
  <CNPJ>${emitCnpj}</CNPJ>
  <xNome>FORNECEDOR FABRICADO LTDA</xNome>
  <dhEmi>2026-02-11T10:00:00-03:00</dhEmi>
  <tpNF>1</tpNF>
  <vNF>${vNF}</vNF>
  <nSit>0</nSit>
</resNFe>`;
}
