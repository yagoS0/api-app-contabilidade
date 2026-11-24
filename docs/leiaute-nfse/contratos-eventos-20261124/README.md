# Evidências contratuais de eventos — 24/11/2026

Material fornecido pelo proprietário para o PR315. Nenhum documento fiscal de cliente.

| Evidência | Origem e versão | SHA-256 |
|---|---|---|
| [ADN original](adn-swagger-original.json) | OpenAPI3.0.1, API NFS-e ADN Contribuinte v1; exportação de produção restrita, arquivo original | b2d8d5aec4b621db552bfca4d7b39ec2403c0aa552b8fe4b9b2f02a02b64a342 |
| [SEFIN fornecido como texto](sefin-texto-proprietario.json) | Swagger2.0, API NFS-e Sefin Nacional v1; recebido no chat, host declarado sefin.nfse.gov.br | c62127ca7468514a2970f6efaa9b8e5e7d45a00c8f6cbb0db1f237c8be6987bc |

ADN: URL de exportação confirmada nos metadados locais do download: https://adn.producaorestrita.nfse.gov.br/contribuintes/swagger/v1/swagger.json ; painel https://adn.producaorestrita.nfse.gov.br/contribuintes/docs/index.html . Recebido em24/11/2026; arquivo local modificado às15:38 BRT. Esse dado não comprova a versão de produção.

SEFIN: o proprietário informou obtenção no painel, mas não forneceu arquivo original ou URL exata da exportação. O hash acima corresponde ao texto materializado com newline final. O texto UTF-8 com trim tem SHA-256 6e4c0fc66bd568e9967e5abc21a79ce4c73912e73796b29b75ac5809c9a36642. Não é hash de um arquivo original exportado. O campo schemes:http não autoriza redução da segurança: o adaptador exige HTTPS e preserva mTLS.

Na caracterização, os documentos passaram validação dos schemas oficiais Swagger2/OpenAPI3.0.1. As 29 referências internas SEFIN e 118 ADN foram novamente resolvidas ao versionar os arquivos. As versões v1 não comprovam equivalência entre ambientes nem disponibilidade efetiva de todos os endpoints. Nenhuma operação fiscal foi executada para homologação.

Os exemplos oficiais são ilustrativos: não são comprovantes fiscais nem fixtures de assinatura. Os testes usam documentos sintéticos assinados com certificado efêmero.
