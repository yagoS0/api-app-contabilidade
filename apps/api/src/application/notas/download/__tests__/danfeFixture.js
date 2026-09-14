import { xmlNfeProc } from "../../importXml/__tests__/fixtures/nfeFabricada.js";

// Dados inteiramente fictícios para testar o leiaute, inclusive múltiplas páginas.
export function xmlParaDanfe(quantidade = 1) {
  const itens = Array.from({ length: quantidade }, (_, i) => ({ xProd: `PRODUTO DE TESTE ${i + 1}`, ncm: "84713012", cfop: "5102", vProd: "1500.00" }));
  return xmlNfeProc({ itens, vNF: String(1500 * quantidade) })
    .replace("</ide>", "<tpAmb>2</tpAmb><tpEmis>1</tpEmis></ide>")
    .replace("</emit>", "<enderEmit><xLgr>RUA DE TESTE</xLgr><nro>100</nro><xBairro>CENTRO</xBairro><xMun>RIO DE JANEIRO</xMun><UF>RJ</UF><CEP>20000000</CEP></enderEmit></emit>")
    .replace("</dest>", "<enderDest><xLgr>RUA EXEMPLO</xLgr><nro>200</nro><xBairro>CENTRO</xBairro><xMun>RIO DE JANEIRO</xMun><UF>RJ</UF><CEP>20000000</CEP></enderDest></dest>")
    .replaceAll("</prod>", "</prod><imposto><ICMS><ICMSSN102><orig>0</orig><CSOSN>102</CSOSN></ICMSSN102></ICMS></imposto>")
    .replace("<ICMSTot>", `<ICMSTot><vBC>0</vBC><vICMS>0</vICMS><vBCST>0</vBCST><vST>0</vST><vProd>${1500 * quantidade}</vProd><vFrete>0</vFrete><vSeg>0</vSeg><vDesc>0</vDesc><vII>0</vII><vIPI>0</vIPI><vPIS>0</vPIS><vCOFINS>0</vCOFINS><vOutro>0</vOutro>`)
    .replace("</infNFe>", `<transp><modFrete>9</modFrete></transp><pag><detPag><tPag>01</tPag><vPag>${1500 * quantidade}</vPag></detPag></pag><infAdic><infCpl>DOCUMENTO FICTICIO PARA TESTE DE LAYOUT. SEM VALIDADE FISCAL.</infCpl></infAdic></infNFe>`)
    .replace("</infProt>", "<dhRecbto>2026-02-10T09:15:10-03:00</dhRecbto></infProt>");
}
