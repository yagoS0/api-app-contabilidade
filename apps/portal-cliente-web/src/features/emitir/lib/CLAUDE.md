# Modelo da nota — endereço (23/09/2026)

Usar como modelo carrega primeiro `GET /client/companies/:id/invoices/:invoiceId`. A listagem permanece leve, sem parsing XML por linha. O detalhe lê somente `DPS/infDPS/toma` da própria nota (NFSe capturada ou DPS emitida localmente), conferindo o documento do tomador. Não consultar a memória mais recente como substituto do endereço antigo; ausência, XML inválido ou endereço exterior não produzem endereço nacional fictício.

`camposDaNota` mapeia `tomador.email` e `tomador.endereco.{cMun,CEP,xLgr,nro,xCpl,xBairro}`. `numero` é exclusivamente o número do imóvel (`nro`), nunca `nota.numero`. Número fiscal, chave, série e competência continuam fora dos campos reaproveitados. Endereço parcial mantém campos ausentes vazios.

A ação da listagem aguarda o detalhe, apresenta erro com retentativa pelo próprio botão e descarta respostas após troca de empresa/competência, desmontagem ou escolha de outra nota. `getInvoiceDetail` não usa fallback de dados reais para mock: erro de rede não pode colocar tomador fictício numa emissão. Modo mock explícito continua disponível.
