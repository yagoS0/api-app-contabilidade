// DPS sintética e não assinada. Nenhum dado de cliente.
export const xmlBase = `<DPS xmlns="http://www.sped.fazenda.gov.br/nfse" versao="1.01"><infDPS Id="DPS330455723925424300019100001000000000000001">
<tpAmb>2</tpAmb><dhEmi>2026-11-03T12:00:00-03:00</dhEmi><verAplic>teste-local</verAplic><serie>1</serie><nDPS>1</nDPS><dCompet>2026-11-03</dCompet><tpEmit>1</tpEmit><cLocEmi>3304557</cLocEmi>
<prest><CNPJ>39254243000191</CNPJ><regTrib><opSimpNac>3</opSimpNac><regApTribSN>1</regApTribSN><regEspTrib>0</regEspTrib></regTrib></prest>
<toma><CNPJ>11222333000181</CNPJ><xNome>Tomador sintético &amp; teste</xNome><end><endNac><cMun>3304557</cMun><CEP>20040002</CEP></endNac><xLgr>Rua de teste</xLgr><nro>1</nro><xBairro>Centro</xBairro></end></toma>
<serv><locPrest><cLocPrestacao>3304557</cLocPrestacao></locPrest><cServ><cTribNac>170601</cTribNac><cTribMun>001</cTribMun><xDescServ>Teste local &amp; campanha</xDescServ><cNBS>114061100</cNBS></cServ></serv>
<valores><vServPrest><vServ>1.00</vServ></vServPrest><trib><tribMun><tribISSQN>1</tribISSQN><tpRetISSQN>1</tpRetISSQN></tribMun><totTrib><pTotTribSN>6.00</pTotTribSN></totTrib></trib></valores>
<IBSCBS><finNFSe>0</finNFSe><cIndOp>100301</cIndOp><indDest>0</indDest><valores><trib><gIBSCBS><CST>000</CST><cClassTrib>000001</cClassTrib></gIBSCBS></trib></valores></IBSCBS>
</infDPS></DPS>`;
