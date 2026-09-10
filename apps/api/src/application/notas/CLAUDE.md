# Certificados por operação

Atualizado em 2026-09-08.

- `CertResolver.js` exige A1 próprio da empresa para os serviços `NFSE` (inclui captura ADN) e `DFE`. Procuração ativa não substitui esse certificado e não deve ganhar precedência quando existe um A1 próprio.
- Para operações delegáveis, como `SN`, o resolver mantém procuração ativa e válida para o serviço/CNPJ. O fluxo Integra Contador possui suas próprias verificações de autorização; não generalize a exigência de A1 próprio para ele.
- Emissão NFS-e, ADN e DFe também verificam a origem do certificado antes de chamar o provedor. Preserve essas verificações mesmo com a restrição no resolver.
- Disponibilidade de certificado deve usar a mesma regra da operação real. Empresa com apenas procuração não está disponível para NFSE/DFE.

Validação local: 53 testes em seis suítes passaram em 2026-09-08: `CertResolver`, `certCnpjProprio`, `nfseCertificado`, `adnErroEco`, `dfeJanelaConsulta` e `procurationPorCnpj`. Incluem ausência de A1 com procuração ativa, precedência do A1 próprio, bloqueio antes de acesso HTTP em ADN/DFe e preservação do caminho autorizado de procuração. Os testes usam mocks; não consultam serviços fiscais reais.
