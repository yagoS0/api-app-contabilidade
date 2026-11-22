# Obra por endereço nacional — 22/11/2026

Incremento separado da PR310, sobre `b4cf79ef4c0252300950d7f7d9efe94c4efae914`. Implementação local; sem emissão, rede externa, migração ou publicação. Registro de governança e revisões independentes pertencem ao Principal.

## Caracterização da base

Inspeção anterior à edição: `normalizarObra` aceitava apenas `cObra`, `cCIB` e `inscImobFisc`; rejeitava `end`. O XML preservava inscrição antes do identificador. E0370 usava uma lista explícita de 13 códigos. Ambos os portais consumiam `packages/shared/src/nfse/dadosDaOperacao.js`, com grupos vazios omitidos. O cliente já limpava dados específicos ao trocar empresa/modelo ou apagar o formulário. O wizard inicializava obra somente na montagem. Esta caracterização é estática, não uma execução de testes da base.

## Contrato e consumidores

Fiscal é dono da interpretação e serialização. A política pura `normalizarObraDaNota`, exportada pelo ponto público de shared, recebe `obra: { end: { CEP, xLgr, nro, xCpl?, xBairro } }`. CEP aceita oito dígitos ou máscara postal e sai com oito dígitos, preservando zeros. Textos são aparados; complemento vazio é omitido. Limites: logradouro 255, número 60, complemento 156 e bairro 60. Campos desconhecidos, controles e tipos inválidos são recusados; endereço não aceita identificadores irmãos. A inscrição imobiliária opcional (até 30 caracteres, tipo TSInscImobFisc) pode acompanhar qualquer alternativa e precede end no XML. Campos de endereço seguem o alfabeto TSString; inscrição não recebe indevidamente essa restrição. Exterior, município e UF dentro de `end` são recusados.

`dadosEspeciaisDaNota` preserva a fachada, mensagens e XML dos identificadores legados, destinatário e retenções. A lista E0370 permanece idêntica; o novo endereço é permitido somente nela ou em `990101` (E0372). Não se amplia a restrição dos identificadores antigos. A compatibilidade legada da inscrição junto de CIB permanece expressamente preservada; este incremento não reinterpreta esse contrato.

O validador HTTP existente consome essa fachada, sem mudança nas rotas, autenticação, autorização, revisão ou persistência. `NfseService` continua serializando a obra pelo mesmo ponto; somente o endereço novo é revalidado no final do pré-voo, antes da reserva de numeração. Serviço incompatível é recusado sem transação, escrita ou transporte. Escritório e cliente usam os campos independentes da obra, resumo/previa coerentes com o payload e limpeza dos campos exclusivos ao trocar alternativa; inscrição comum é preservada. Troca de empresa ou modelo/reset existente limpa todos os campos. Não copiam dados do tomador. Nenhum consumidor de Guias, Contabilidade, Operações, comunicação ou B3 ganha comportamento novo.

R01/R02/R19/R20/R22: identidade própria, ausência distinta de dado válido, guardas existentes, erro visível e orientação acessível. A relação CEP/município (E0380) exige conferência; regex comprova apenas formato. A tela informa que o CEP deve pertencer ao município da prestação. Não há consulta postal nem alegação de verificação geográfica.

## Fonte e limites

Contrato fornecido pelo Principal: índice oficial de produção atualizado em 04/11, [Anexo I 20260209](https://www.gov.br/nfse/pt-br/biblioteca/documentacao-tecnica/documentacao-atual/anexo_i-sefin_adn-dps_nfse-snnfse-v1-01-20260209.xlsx) e XSD 1.01. Referência local: `docs/leiaute-nfse/documentacao-tecnica/rtc-2026-10-05/xsd-20260727/tiposComplexos_v1.01.xsd`, tipos `TCInfoObra`/`TCEnderObraEvento`. A pesquisa independente informada pelo Principal identificou equivalência desses tipos com 20260209. Download remoto retornou 403 naquela pesquisa; este executor não baixou artefatos e não afirma hash remoto validado. NT009 e regras fiscais adicionais estão fora do incremento.

## Evidência e pendências

Adicionados casos nas suítes `dadosEspeciaisDaNota`, `dpsContraXsd`, `nfsePayload`, `portaoEmissaoNfse`, `emissaoNfseCliente`, regras `dadosDaOperacao` dos dois portais, ligação do cliente e `obraEndereco` do escritório. Cobrem normalização, escaping/ordem XML, limites, alternativas exclusivas, E0370/E0372, contrato HTTP, isolamento, prévia, confirmação e payload com fixtures. O oráculo estrutural XSD existente não equivale a homologação fiscal; sua validação complementar lxml continua sendo uma etapa distinta.

Executado: `git diff --check`, sem erros de whitespace. `node scripts/governance/check.mjs plan --base b4cf79ef4c0252300950d7f7d9efe94c4efae914` falhou antes de executar por `EPERM: lstat C:\Users\yagoa`. Conforme divisão de papéis, execução das suítes/builds, validação visual desktop/celular e pareceres ficam pendentes com o Principal. Não declarar testes aprovados com base nesta implementação.

Rollback: reverter somente este diff de aplicação/shared/testes/documentação; não há schema ou transformação de registros. Antes de eventual rollback após uso, considerar que dados de endereço já registrados precisam continuar legíveis e não podem ser reenviados automaticamente. Nenhuma decisão de negócio adicional foi presumida.

## Validação final supervisionada

O controlador `2026-11-22T15-08-45-997Z-3340853e` concluiu a etapa executor. O Principal interrompeu o acompanhamento dos gates para corrigir achados das revisões independentes e executar os testes no ambiente disponível; o executor havia encontrado EPERM em Node. Não houve `ready_for_human`; nenhum gate interrompido é considerado aprovado.

Revisões independentes Fiscal, backend/arquitetura e UI/UX identificaram e corrigiram: inscrição junto ao endereço; alfabeto TSString dos campos de endereço (sem estendê-lo à inscrição); recusa E0372 antes da reserva; preservação da inscrição ao trocar alternativa. A fixture de DPS passou a informar explicitamente o município da prestação, preservando a guarda de incidência municipal. Expectativas de UI passaram a exigir a inscrição corretamente preservada.

- API: 50 suítes, 1.165 testes aprovados, incluindo contratos HTTP e autorizações existentes.
- XSD completo lxml: 12/12 XMLs válidos no schema DPS1.01; 25 testes na suíte, incluindo contraprova inválida. Transporte simulado; não é homologação fiscal oficial.
- Interface: 59 testes do escritório e 24 do portal aprovados. Builds de escritório/portal usam configurações existentes; avisos de tamanho de bundle são registrados sem ocultar falhas.
- Governança: 40 testes aprovados. Diagnose: 5.019 ocorrências legadas, zero novas.
- QA local dos componentes reais em1440/390/360: sem overflow, erros JavaScript ou rede externa; labels, navegação por teclado, prévia e inscrição verificados. Capturas em `test-evidence/obra-ui` na worktree, dados sintéticos. Não representa sessão autenticada produtiva.

A base foi caracterizada estaticamente e pelos testes legados mantidos; não se afirma execução integral de duas árvores idênticas. Não houve alteração de schema, autenticação, catálogo, NBS, incidência, ISS, retenções, assinatura, transporte, estados incertos, recuperação ou regras de emissão exterior. CEP válido em formato não comprova vínculo municipal: conferência permanece necessária e a regra oficial permanece vigente.

Capturas sintéticas revisadas: [escritório desktop](design/evidencias-nfse-obra-endereco/wizard-1440.png), [escritório celular](design/evidencias-nfse-obra-endereco/wizard-390.png), [portal desktop](design/evidencias-nfse-obra-endereco/portal-1440.png), [portal celular](design/evidencias-nfse-obra-endereco/portal-390.png). As capturas são de componentes reais em harness local; não documentam emissão efetiva.
