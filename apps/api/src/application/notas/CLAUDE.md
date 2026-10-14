# Certificados por operação

## Limites do upload — 17/09/2026

Produção registrou `MulterError: Too many files` antes do handler: o lote NF-e aceita 20 arquivos e NFS-e 50. `uploadNotas` converte excesso em 400 JSON e arquivo grande em 413 com orientação. Preservar tetos e armazenamento em disco do ZIP; o contador divide seleções maiores em requisições sequenciais. Regressão exercita multipart real nas duas rotas, sem banco ou chamadas fiscais.

## Importação informativa — 17/09/2026

`portalInvoices /import/xml` valida XML e rejeita raízes de NF-e com `nfe_na_area_nfse`; documento sem identificador reconhecido é `formato_nao_suportado`. Motivos permanecem por arquivo em `errors`, e documentos válidos no mesmo lote continuam sendo importados. O contador agora acessa também `/import/nfe` por XML/ZIP na área NF-e. Manter ingestão, autorização, titularidade por estabelecimento e deduplicação existentes. Testes de ingestão NFS-e, campos fiscais e lote NF-e: 62 aprovados. Nenhuma importação fiscal real foi feita na conferência.

## Revisão fiscal — 14/09/2026

`download/NotasSelecionadasService` baixa somente os IDs selecionados e pertencentes à empresa autorizada (PortalInvoice ou ServiceInvoice). Limites: 100 notas, 50 MB de arquivos. XML completo existente é obrigatório; PDF NF-e exige modelo 55 e protocolo autorizado, gera DANFE com `nfe-danfe-pdf` 1.0.3 (MIT). NFS-e reutiliza `gerarDanfseDaNota`, inclusive QR e ciclo fiscal. Não captura XML, não chama provedor, não grava documentos/estado fiscal. Falhas parciais são relatadas dentro do ZIP; nenhum arquivo válido retorna 422, ID desconhecido/de outro tenant retorna 404 indistinguível. Autorização é `requireFirmCompanyAccess` no POST `/notas/download-selecionadas`.

`getDadosFechamento` retorna `entregaPgdas.extratoSalvo` com dados/IDs dos PDFs já registrados na circular. Abertura da tela e downloads dos PDFs usam esse registro; consulta na Receita é atualização explícita. Não substituir esse GET por sync pago.

Pré-checagem do motor usa `coletarCnaesEConfig` como fallback quando não há CadastroFiscal, reconhecendo o mesmo regime/CNAE que o Perfil fiscal deriva da ficha. Não cria cadastro nem presume regime desconhecido. Relatório continua uma foto: números salvos não são reescritos na leitura, e diagnóstico de cadastro antigo é reconferido. Orientação de classificar só se aplica à falta de classificação, não a toda recusa do motor.

Atualizado em 2026-09-08.

- `CertResolver.js` exige A1 próprio da empresa para os serviços `NFSE` (inclui captura ADN) e `DFE`. Procuração ativa não substitui esse certificado e não deve ganhar precedência quando existe um A1 próprio.
- Para operações delegáveis, como `SN`, o resolver mantém procuração ativa e válida para o serviço/CNPJ. O fluxo Integra Contador possui suas próprias verificações de autorização; não generalize a exigência de A1 próprio para ele.
- Emissão NFS-e, ADN e DFe também verificam a origem do certificado antes de chamar o provedor. Preserve essas verificações mesmo com a restrição no resolver.
- Disponibilidade de certificado deve usar a mesma regra da operação real. Empresa com apenas procuração não está disponível para NFSE/DFE.

Validação local: 53 testes em seis suítes passaram em 2026-09-08: `CertResolver`, `certCnpjProprio`, `nfseCertificado`, `adnErroEco`, `dfeJanelaConsulta` e `procurationPorCnpj`. Incluem ausência de A1 com procuração ativa, precedência do A1 próprio, bloqueio antes de acesso HTTP em ADN/DFe e preservação do caminho autorizado de procuração. Os testes usam mocks; não consultam serviços fiscais reais.


## Revisão de períodos apurados — 14/10/2026

`pendenciasDoPeriodo.js` é a regra local comum: circular + ApuracaoSnapshot; recibo/número da declaração prova transmissão, cálculo/simulação não. Alertas não afirmam retificação obrigatória sem comparar a receita declarada. Não consultar RFB/ADN nem recalcular/transmitir na leitura. Prévia do contador e GET de período do cliente usam vínculo autorizado; falha permanece explícita, sem fallback para mock/ABERTA. Na emissão, revalidar antes de reservar DPS. Preservar bloqueio de 2027 antes de qualquer envio.

PendenciaPosFechamento usa hash único de empresa/competência/identidade fiscal/evento. Emissão e captura vinculam a mesma pendência; cancelamento é outra ocorrência. Recaptura de nota já existente não cria alerta novo; resolução exige motivo, ator e data e não é apagada pelo upsert. Nota recebida pede revisão de despesas/retenções, não é receita de PGDAS. Sem competência explícita na NFS-e, não deduzir o mês do alerta pela data de emissão.

ServiceInvoice grava revisaoPeriodoPendente junto ao desfecho autorizado em produção; falha do aviso nunca muda issued para falha_envio. O worker local recupera somente o aviso, nunca repete chamada fiscal. Migration 20261014160000_avisos_periodos_apurados antes da API. Nenhum backfill em massa: fatos legados exigem comparação e revisão, sem transformar captura histórica em receita nova. Testes com provedores simulados e PostgreSQL isolado; não emitir nota real para validar.
