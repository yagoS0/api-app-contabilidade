# NFS-e Nacional — primeiro incremento de confiabilidade

## Evidência e limites — 22/11/2026

Main remota confirmada pelo principal: `b4cf79ef4c0252300950d7f7d9efe94c4efae914`. Branch isolada: `codex/nfse-nacional-fluxo-20261122`. Referência operacional canônica SHA-256: `4edbbc7134008570aa1152d34019c467afabd3aa6768dc89c80830ac166f6113`.

Este incremento acrescenta uma prova encadeada da implementação existente. Não altera código produtivo, cadastro, contratos, schema ou regras fiscais. A empresa é uma fixture; não foi usado cadastro, certificado, documento ou banco de cliente. O ensaio executa serviço, assinatura criptográfica, conciliação e leitor documental reais, com persistência em memória e transporte substituído. Não equivale à homologação perante o autorizador, nem a teste ponta a ponta de interface/HTTP/mTLS.

A ausência de prova integrada era uma lacuna demonstrável. Não foi reproduzido neste recorte um defeito do fluxo regular que autorizasse inventar correção fiscal. Há limitações específicas para os próximos incrementos, abaixo.

## Percurso atual e responsabilidades

Caminhos desta tabela são relativos a `apps/api/src/`.

| Etapa | Componentes | Contrato e efeitos |
|---|---|---|
| Cadastro e perfil | `application/company/companyProfile.js`, `application/nfse/perfilEmissao/`, `Company`, `regimeHistorico` | Identidade, serviços habilitados, município e vigências são fatos cadastrados. Regime atual não substitui histórico. |
| Prévia | `routes/firm/perfisEmissao.js`, `previaFiscalDoContador.js`, `preparacaoFiscalDoCliente.js` | Resolve contexto, fontes e pendências antes da emissão. A nova suíte começa na fixture já cadastrada; prévia é coberta pelas regressões existentes. |
| Entrada/autorização | `routes/nfse.js`, `routes/client/index.js`, `routes/middlewares/emissaoNfseGate.js` | Autenticação, Company/PortalClient e permissão no servidor. ACL não é substituída pela guarda falsa do teste de serviço. |
| Pré-validação | `NfseService.js`, `regimeDaCompetencia.js`, `codigoServicoDaNota.js`, `ambienteNfse.js` | Cadastro, ambiente, certificado próprio, competência, município e tributos antes da reserva. |
| Reserva e assinatura | `nfseNumeracao.js`, `nfseUltimaNota.js`, `infrastructure/db/NfseRepository.js`, `NfseService.js` | Reserva série/número; persiste DPS assinada e contexto antes do POST. Dublê conserva estado/ordem; não prova transação SQL. |
| Resposta | `NfseService.js`, `desfechoEmissao.js`, `numeroDaNfse.js` | HTTP 200 não basta. Distingue rejeição local/fiscal e transporte incerto; não libera número incerto para retry. |
| Consulta | `NfseService.syncFromProvider` | Consulta por chave e atualiza registro local. Não é leitura sem efeitos nem substituto da conciliação de incerteza. |
| Conciliação | `conciliacaoDps.js`, `NfseService.conciliarTentativa` | DPS/XML/eventos: MESMA, OUTRA ou INCONCLUSIVA; aplicação por CAS. Sem novo POST na consulta manual. |
| XML/DANFSe | `lerEnvelopeXml.js`, `danfse/danfseDaNotaDoPortal.js`, `danfse/gerarDanfse.js` | Resolução PortalClient→Company, identidade do XML e geração local. Não cria PortalInvoice na emissão; não retransmite para obter PDF. |

Fiscal/NFS-e coordena a operação; Cadastro fornece parâmetros; Identidade controla acesso. Infraestrutura conserva Prisma, certificado e transporte. Escritório, portal, lotes, recorrências e WhatsApp são consumidores. Nenhum deles foi alterado. Guias, Contabilidade, Operações e B3 ficam preservados.

## Matriz de bloqueios e próximos passos

| Tema | Estado / causa identificada | Correção ou teste necessário | Dependência |
|---|---|---|---|
| Catálogo cTribNac | Código precisa pertencer aos serviços cadastrados; ausência de lista não libera qualquer código. Não reproduzido erro atual de carregamento. | Regressões do catálogo/perfil; em relato real, obter resposta HTTP e versão do artefato, sem substituir por lista fixa. | Anexo B oficial e configuração da empresa. |
| Associação NBS | Catálogo de correlação não é regra de equivalência fiscal obrigatória. | Preservar escolha e validação explícitas; não inferir NBS por CNAE. | Classificação do serviço pelo responsável. |
| Regime e vigência | Sem histórico cobrindo a competência, emissão é corretamente bloqueada. | Novo teste confirma recusa sem reserva; regressões cobrem mensal/diária e sobreposição. | Cadastro comprovado, não preenchimento automático. |
| Município IBGE | Emissor, prestação e incidência são conceitos distintos. Adesão ao portal não preenche configuração da empresa. | Preservar validações e testes de parâmetros; não inventar IBGE/ISS. | Cadastro e parâmetros municipais. |
| Obra por endereço | `dadosEspeciaisDaNota.js` aceita cObra/cCIB; XSD ativo admite também end. Limitação concreta de entrada. | Próximo incremento candidato: caracterizar RN do serviço e admitir endereço na API/UI quando cabível, sem fabricar identificador. | Confirmação de RN e caso de uso; XSD isolado não determina obrigação. |
| Imóvel IBS/CBS | Grupo existe no XSD atual, mas não é gerado pelo emissor. Não é sinônimo de obra. | Separar capacidade específica; mapear cIndOp/RN antes de integrar laboratório. | Classificação, contrato por ambiente e calendário. |
| ISS/retenções | Resolvedores atuais distinguem regime, perfil, natureza e local. | Regressões de alíquota/retencões; não usar tolerância do provedor como dispensa legal. | Evidências fiscais/municipais. |
| Ambiente/schema | Contrato ativo `nfse-nacional-dps-1.01-20260727`; 1.01 sozinho não identifica pacote. | Manter contrato; comparar artefatos por conteúdo antes de atualização. | Publicação oficial por ambiente. |
| Timeout/rejeição | Resultado incerto não autoriza reenvio. | Novo teste timeout→consulta MESMA→DANFSe com um único POST/reserva. | Consulta oficial de DPS/XML/eventos em operação real. |
| DANFSe | Gerado localmente; sem dependência obrigatória da antiga API de PDF. | Novo teste usa leitor documental real e recusa identidade divergente/outra empresa. | XML autorizado íntegro. |
| Revalidação final | Rotas manuais não passam todas as opções de fingerprint/guarda final usadas em caminhos recentes. | Caracterização própria de alteração/revogação entre entrada e POST; não afirmar exploração ou corrigir silenciosamente. | Política atual e testes de concorrência/autorização. |

Recursos avançados permanecem separados: ajustes IBS/CBS, locação/unidades imobiliárias, grupos novos da NT009 e Simples 2027. A presença de implementações em `laboratorio/` não significa suporte produtivo.

## Confronto oficial

Fontes consultadas em 22/11/2026:

- [Comunicado de 29/10/2026](https://www.gov.br/nfse/pt-br/noticias/nfs-e-nacional-confira-oas-rientacoes-sobre-leiaute-em-producao-regras-de-preenchimento-de-ibs-cbs-e-status-da-nota-tecnica-009): produção mantém NT004 com domínio tpRetPisCofins da NT007; NT009 release 1 em produção restrita, releases 1–3 previstos para 01/12/2026. Obrigatoriedade IBS/CBS é escalonada conforme enquadramento; ausência de rejeição técnica não prova dispensa fiscal. Não promover NT009 ao produtivo indiscriminadamente.
- [Documentação produtiva](https://www.gov.br/nfse/pt-br/biblioteca/documentacao-tecnica/documentacao-atual) e [produção restrita](https://www.gov.br/nfse/pt-br/biblioteca/documentacao-tecnica/producao-restrita): pacotes distintos mesmo sob versão nominal 1.01.
- [Biblioteca RTC](https://www.gov.br/nfse/pt-br/biblioteca/documentacao-tecnica/rtc): Anexo VIII de correlação cTribNac/NBS/cClassTrib/cIndOp é orientativo/em desenvolvimento, sem imposição de regras de negócio nos ambientes. Anexo B produtivo identificado como v1.01 de 22/01/2026.
- [NT008 v1.02, 14/07/2026](https://www.gov.br/nfse/pt-br/biblioteca/documentacao-tecnica/rtc/nt-008-se-cgnfse-danfse-20260714-v1-02.pdf): suspensão da API de DANFSe em 03/08/2026. Documento auxiliar deve refletir XML autorizado; documento de teste deve informar ausência de validade jurídica. Altan já gera localmente.
- [NT009 v1.01](https://www.gov.br/nfse/pt-br/biblioteca/documentacao-tecnica/rtc/nota-tecnica-009-se-cgnfs-e-v-1-01.pdf) e [manual API](https://www.gov.br/nfse/pt-br/biblioteca/documentacao-tecnica/documentacao-atual/manual-contribuintes-emissor-publico-api-sistema-nacional-nfs-e-v1-2-out2025.pdf): distinguir DPS, consulta por identidade, documento e eventos. Consulta não é nova emissão.

Comparação local dos pacotes versionados 20260209 e 20260727: `tiposComplexos` idênticos, SHA-256 `6f792f408a33c11e799042a8d61cac7d1c9f5992c53e07e60ce75a15f157d1ac`. `tiposSimples` difere em CNPJ alfanumérico/IDs, série e formatos. Isso não comprova equivalência com todos os arquivos oficiais atualmente publicados; evita apenas uma troca cega baseada no nome do pacote. O teste XSD existente é parcial, não valida integralmente toda RN oficial.

## Ensaio seguro e critérios

`apps/api/src/application/nfse/__tests__/fluxoNacionalSimulado.test.js` usa competência fixa 22/11/2026, empresa/tomador sintéticos e material RSA efêmero em memória. Configuração e Axios/Prisma são substituídos antes das importações; conexões TCP/TLS são bloqueadas. Não carrega .env ou A1 real, não inicia workers, não grava PDF/chave privada.

Cenários: sucesso encadeado; percentual ausente; revogação na guarda final; timeout; resposta incompleta; recuperação MESMA após timeout; isolamento de empresa; XML divergente; ausência de histórico. Verifica assinatura e adulteração, ordem de autorização, número de reservas/POST, XML persistido, identidade e leitura do PDF com marca de teste. O envelope oficial é sintético e mínimo, não uma amostra homologada.

Regressão inicial: 74 suítes/1.591 testes aprovados; quatro suítes PostgreSQL falharam exclusivamente por variável de banco ausente. Preparado novo PostgreSQL 16 em loopback, banco exclusivo terminado em `_governance_test`; as quatro suítes passaram (cinco testes). Nenhum cluster anterior utilizado. Resultado final agregado e CI são registrados no PR, vinculados ao SHA.

## Governança, riscos e reversão

Controlador `2026-11-22T14-17-07-007Z-8cb11c87`: executor concluiu arquivos, mas não executou Node por EPERM do ambiente restrito. Principal executou testes, encontrou fixture inválida e recebeu revisão independente com lacunas do leitor/recuperação. Interrompeu o controlador na fase de gates para concluir correções e validações supervisionadas. Não há `ready_for_human`; gates não concluídos não são declarados aprovados. Pareceres finais e checks pertencem ao SHA entregue.

Sem mudança operacional: R01/R02, R19/R20, regras NFS-e e guardas de 2027 preservadas. Risco alto de interpretação fiscal, embora diff seja somente testes/documentação. Testes simulados não comprovam disponibilidade remota, aceitação real, cadeia ICP-Brasil ou comportamento tributário de clientes.

Rollback: reverter somente o commit deste incremento; nenhum dado, schema, configuração ou serviço exige reversão. Merge, deploy, atos fiscais e envio de mensagens continuam não autorizados. Próxima entrega recomendada: escolher um bloqueio comum reproduzido (primeiro candidato: obra por endereço), caracterizar API/UI/RN e corrigir apenas esse caminho. Homologação remota exige autorização específica e identidade/certificado de testes apropriados.

Validação final pelo principal: **79 suítes API, 1.605 testes aprovados**, incluindo cinco PostgreSQL 16. Após ajuste da prova de marca de homologação, **9/9 focais** reexecutados e aprovados. Governança **40/40**, verificador **4/4**; diagnose **5.019 → 5.019, zero novas violações**. Revisão Fiscal/arquitetura favorável; backend/segurança favorável após tornar a asserção da marca inequívoca. Esses pareceres não homologam produção e não substituem CI no SHA final.
