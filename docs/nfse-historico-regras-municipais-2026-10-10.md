# NFS-e: histórico, primeira validação municipal e destaque IBS/CBS

Segunda entrega local do plano, em 10/10/2026. Reutiliza `RegimeHistorico`, o cadastro existente, o núcleo fiscal e o DANFSe. Não altera notas autorizadas nem executa publicação ou transmissão.

## Histórico por competência

`regimeDaCompetencia.js` resolve um único período que cubra a competência. Data final inclusiva; início do próximo período deve ser posterior. Competência mensal exige cobertura do mês inteiro. Se houver mudança dentro do mês, informar o dia da prestação. Lacunas, sobreposições, datas inválidas e ausência do histórico geram recusa antes da numeração.

`NfseService` e `preparacaoFiscalDoCliente` leem a relação existente da empresa autorizada. Nenhum deles usa mais o regime atual como prova do passado. O snapshot registra regime, período, vigência e competência usados; a preparação retorna a mesma procedência. O cadastro recusa períodos sobrepostos, datas impossíveis e linhas incompletas; a tela explica o efeito do histórico na emissão.

Não há migração nova para este histórico, nem preenchimento automático de períodos. Antes de publicar, conferir as vigências da carteira: **empresa sem histórico cobrindo a nota será bloqueada mesmo que tenha regime atual cadastrado**. O histórico anterior era informativo; precisa ser revisado pelo escritório antes de passar a orientar emissões. Apuração e captura permanecem com seus resolvedores atuais.

## Primeira validação municipal

`incidenciaMunicipal.js` identifica exceções com localização na execução, obra, evento ou bem. Nesses casos exige `cLocPrestacao` informado na operação, sem aceitar somente o padrão do perfil. Mantém o resultado no snapshot, sem inserir uma tag de incidência calculada pelo sistema na DPS.

Casos que dependem de distribuição entre municípios, bens/pessoas vigiados, estabelecimento do tomador de mão de obra ou contexto jurisprudencial retornam pendência específica. A regra geral continua identificada como sujeita a conferência; não é atestado da legislação municipal. Imunidade/não incidência continuam nos validadores existentes.

Fontes consultadas em 10/10/2026:

- [LC 116, art. 3º](https://planalto.gov.br/ccivil_03/leis/lcp/lcp116.htm): mapa das exceções. Subitens cobertos estão explícitos no módulo, com testes. Competências anteriores a 2018 exigem revisão nesta versão.
- [LC 218/2025](https://www.planalto.gov.br/ccivil_03/leis/lcp/lcp218.htm): inclusão de 14.14 na hipótese de execução de obra. Antes da publicação em 25/09/2025, o módulo pede revisão histórica.
- [STF, ADIs 5835/5862 e ADPF 499](https://portal.stf.jus.br/noticias/verNoticiaDetalhe.asp?idConteudo=508709&ori=1): não se aplicaram automaticamente as regras de deslocamento ao tomador dos serviços atingidos; os casos ficam pendentes de contexto específico.
- [APIs oficiais](https://www.gov.br/nfse/pt-br/biblioteca/documentacao-tecnica/apis-prod-restrita-e-producao/apis-prod-restrita-e-producao): identificada a API de parâmetros municipais. Sua consulta e persistência por vigência ainda não estão integradas nesta entrega.

Pendências municipais: convênio/CNC, envio de IM (inclusive exceção legada do Rio), complemento municipal, alíquotas locais, responsabilidade por retenção, múltiplos municípios, águas marítimas e hipóteses transversais do art. 3º. Não se presume que endereço do tomador resolve esses fatos. `validacaoMunicipalCompleta` permanece falso.

## Destaque de IBS/CBS

Reutilizado o leitor do DANFSe. A DPS declara o enquadramento já validado; valores destacados são lidos do grupo `infNFSe/IBSCBS` do documento retornado. Não se adotou alíquota fixa para a carteira nem se recalculou o valor final da nota.

O detalhe da NFS-e no escritório exibe base, classificação, alíquotas, IBS estadual/municipal/total, CBS e total IBS/CBS. Distingue ausência de XML autorizado, grupo não informado, declaração na DPS sem valores retornados, valores parciais e valores presentes. Presença não atesta conformidade fiscal. A rota mantém a consulta por nota e empresa autorizada.

Corrigido o total no DANFSe: se falta IBS ou CBS, o total fica ausente; zero explícito continua zero. A soma de valores declarados usa centavos inteiros, sem erro de ponto flutuante. O valor final da nota permanece o da origem, sem somar novamente os tributos. Escritório e portal usam o mesmo gerador.

Referências: [NT 008 — DANFSe](https://www.gov.br/nfse/pt-br/biblioteca/documentacao-tecnica/rtc/nt-008-se-cgnfse-danfse-20260505.pdf) e [implantações oficiais](https://www.gov.br/nfse/pt-br/biblioteca/documentacao-tecnica/atualizacoes-e-implantacoes/atualizacoes-e-implantacoes). O contrato de envio continua o XSD versionado de 27/07/2026. Publicação/aprovação da NT 009 não foi tratada como confirmação de implantação do novo envio.

## Validação

Testados limites de vigência, lacunas, sobreposição, troca dentro do mês, preferência pelo histórico sobre o regime atual, recusa antes da transação, snapshot, preparo do cliente, exceções municipais, leitura de IBS/CBS, valores parciais/zero, soma decimal, escopo da rota e detalhe visual.

Build do escritório aprovado. Amostra sintética do DANFSe gerada e renderizada com Poppler, inspecionada em uma página; sem emissão externa. Arquivos de verificação em `.local/nfse-historico-ibs-20261010/`.

Execuções finais direcionadas: 138 testes de histórico, emissão, preparação, cadastro e rota de detalhe aprovados; 111 testes de destaque/leitor/DANFSe/rota aprovados em execução anterior à última adição de teste da rota; 29 testes da interface de detalhe aprovados. As contagens se sobrepõem e não devem ser somadas. A regressão ampliada cobriu 50 suítes; suas duas suítes inicialmente falhas foram corrigidas e aprovadas nas execuções direcionadas finais. `git diff --check` sem erros nos arquivos desta entrega.

Ainda não concluídos: histórico de `regApTribSN`/sublimite e da carga aproximada, revisão integral de retenções, integração dos parâmetros municipais, diagnóstico da carteira real e homologação com a Sefin. A migração de categoria IBS/CBS da entrega anterior continua necessária antes de publicar aquela parte.

## Revisão adicional e regressão — 10/10/2026

Corrigidas entradas que escapavam à validação: datas impossíveis eram normalizadas pelo JavaScript; competências mensais viravam dia 1 antes da conferência de vigência; períodos incompletos eram descartados pelo formulário. Agora a API rejeita datas impossíveis, preserva a precisão mensal e recebe as linhas incompletas para apresentar erro. Timestamps que atravessam o dia em UTC preservam o dia civil informado, mantendo o horário das integrações quando não há mudança de dia. Escritório e portal receberam mensagem para competência inválida.

O histórico aceita também datas serializadas pelo banco em UTC à meia-noite, com validação do dia original. O teste de montagem do lote normaliza CRLF antes de inspecionar o código, evitando falha específica do Windows.

Resultados desta revisão (execuções com sobreposição, não somar):

- Regressão da API: 53 suítes, 990 testes aprovados.
- Telas do escritório: 3 suítes, 51 testes aprovados; serialização do histórico e mensagens: 2 suítes, 13 testes aprovados.
- Portal: 3 suítes, 53 testes aprovados.
- Verificação ampliada de recorrência/lote: 570 testes passaram; houve uma expectativa de horário e uma falha de leitura CRLF. Ambas corrigidas; execução final direcionada com 5 suítes e 75 testes aprovada, incluindo os validadores, histórico, recorrência e montagem do lote.
- Builds do escritório e portal aprovados, com avisos de tamanho de bundles e imports estáticos/dinâmicos no escritório.

Testes locais, sem publicação ou transmissão de notas. Estes resultados validam o comportamento implementado; as pendências fiscais e de homologação acima permanecem.

## Integração de consultas municipais — 10/10/2026

Implementada consulta manual de convênio municipal e parâmetros por código nacional de serviço, acessível na configuração de emissão da empresa. Usa o A1 da própria Company, resolvido pelo vínculo autorizado do PortalClient, e separa produção restrita de produção pelo `NFSE_ENV`. Endereços fixos do diretório oficial, TLS verificado inclusive em homologação, sem redirecionamentos, limite de resposta de 1 MiB e timeout de 15 segundos.

As rotas do escritório exigem acesso à carteira e nível ACCOUNTANT: `GET /firm/companies/:companyId/parametros-municipais` lê registros locais; `POST /firm/companies/:companyId/parametros-municipais/consultas` inicia uma consulta explícita. O servidor aceita somente convênio ou serviço cadastrado na empresa. A consulta não é disparada pela abertura da tela, por worker ou pela emissão da DPS.

Cada tentativa tem autor, empresa legada, município, serviço, ambiente, caminho da fonte e datas. A reserva é gravada antes do GET externo. Repetição da mesma chave recupera o registro; concorrência é protegida por índice único. Falha de persistência do retorno conserva a reserva sem repetição automática. Falhas ficam distintas de retornos recebidos. A interface mostra histórico, ambiente e resposta para conferência; o mock identifica explicitamente os dados sintéticos.

**Limite desta etapa:** retorno HTTP/JSON recebido não comprova convênio ativo, vigência, enquadramento ou ausência de obrigação. Data de consulta não é vigência fiscal. O conteúdo é preservado para conferência e ainda não alimenta decisões automáticas de alíquota, IM, retenção, benefício ou liberação de emissão. `validacaoMunicipalCompleta` permanece falso.

Fontes verificadas:

- [Diretório oficial de APIs](https://www.gov.br/nfse/pt-br/biblioteca/documentacao-tecnica/apis-prod-restrita-e-producao/apis-prod-restrita-e-producao): bases de parametrização para ambos os ambientes.
- [Manual dos Contribuintes, seção 1.2.1](https://www.gov.br/nfse/pt-br/biblioteca/documentacao-tecnica/documentacao-atual/manual-contribuintes-emissor-publico-api-sistema-nacional-nfs-e-v1-2-out2025.pdf): caminhos de convênio e parâmetros por serviço. Não foram usados endpoints de manutenção dos municípios.

O Swagger público de parametrização não pôde ser lido nesta execução (falha de acesso/TLS sem sessão autenticada). Portanto, base/caminhos documentados ainda precisam de ensaio autenticado para confirmar o contrato operacional. O manual dos contribuintes apresenta o mesmo caminho resumido para retenções e benefícios, sem permitir diferenciá-los de forma segura; a consulta CNC também exige confirmação do contrato de consulta destinado ao contribuinte. Esses conectores e a interpretação dos retornos por vigência continuam pendentes, sem simular um contrato oficial.

Instalação: aplicar `20261010160000_nfse_consultas_municipais`, gerar Prisma no ambiente de destino e habilitar `INTEGRACAO_PARAMETROS_MUNICIPAIS=1` primeiro em produção restrita. A flag nasce desligada; nesse estado a tela informa a indisponibilidade e não lê a tabela nova. Não houve alteração de flags, migrations de banco real, consulta autenticada ou publicação nesta execução.

Validação desta etapa: 96 testes de API (consultas, acesso, rotas de perfil e configuração) e 119 testes da interface aprovados. Após acrescentar cenários de concorrência e certificado, as duas suítes da integração passaram novamente com 28 testes. Build do escritório e `prisma validate` aprovados. As contagens se sobrepõem. O ensaio posterior de PostgreSQL está registrado abaixo.

## PostgreSQL e transmissão autorizada em produção restrita — 10/10/2026

`scripts/run-nfse-municipal-postgres.mjs` aplica as migrations em PostgreSQL 16 descartável e executa `apps/api/scripts/verify-nfse-municipal-postgres.mjs`. Sete cenários aprovados: oito pedidos concorrentes geram uma consulta; retorno e autoria persistidos; idempotência após reinício; isolamento por empresa/ambiente; falha de gravação do retorno impede replay; falha de rede preserva o histórico; constraints e chave estrangeira efetivas. Provedor simulado e rede bloqueada neste ensaio. Evidência local: `test-evidence/nfse-municipal-postgres-1791641617461`.

O acesso real identificou uma falha anterior ao HTTP: OpenSSL 3 recusava a cifra legada do contêiner PFX. Transporte da emissão e consulta municipal agora usam o PEM já extraído pelo resolvedor do A1, mantendo identidade, assinatura e validação TLS. Falhas nativas de conexão/criptografia são classificadas como falha de consulta, sem afirmar que houve resposta inválida do provedor. O transporte da emissão passa a verificar TLS também em homologação.

O usuário autorizou uma NFS-e de R$ 1,00 da Klaus Nigro exclusivamente em homologação, reutilizando tomador e descrição da última nota, e confirmou Simples desde a abertura. O cadastro não tem data de abertura nem histórico de regime. O ensaio registrou a confirmação apenas para 10/10/2026 em banco isolado; não inventou uma data de opção nem alterou o histórico de produção. Dados cadastrais e modelo foram lidos em transação somente leitura. Certificado próprio e conteúdo privado ficaram fora do Git; acessos anteriores ao certificado geraram a auditoria normal do cofre.

Resultado: HEAD da DPS em produção restrita retornou 404 antes de um único POST pelo `NfseService.issue`; a Sefin autorizou a **NFS-e nº 1, R$ 1,00**. Conferência do XML retornado confirmou raiz NFSe, `tpAmb=2`, emitente, valor, identificador/chave e preservação de tomador/descrição. O registro local de tentativa impede repetir o envio. Numeração, notas e configurações de produção não foram alteradas. Banco do ensaio encerrado após execução.

O retorno deste caso não contém IBS/CBS: o leitor apresenta `NAO_INFORMADO`, sem converter ausência em zero. O núcleo resolveu `FACULTATIVO` para este cenário Simples/2026. **Este resultado não homologa casos com valores de IBS/CBS destacados**; essa matriz permanece dependente de cenário aplicável e enquadramento confirmado.

Evidência privada: `.local/nfse-parametros-review/conferencia-retorno.json` e `nfse-klaus-homolog-autorizada.xml`; banco isolado em `test-evidence/nfse-klaus-homolog-1791642293629`. Não versionar esses arquivos. Swagger autenticado da Sefin de homologação consultado com sucesso. Consulta de parâmetros no ADN ainda não homologada: conexão TLS falhou, sem resposta fiscal. Não inferir ausência de convênio ou alíquota a partir disso.

Regressão final: 136 testes em cinco suítes de certificado, emissão, cancelamento, XSD e parâmetros; mais 31 testes de rotas municipais e histórico/incidência. Uma execução intermediária usou caminho de teste inexistente; corrigida para a suíte `historicoMunicipal.test.js`, aprovada. Sem publicação, mudança de flags ou migration em produção. Permanecem pendentes a data de abertura/histórico definitivo, homologação do ADN e cobertura real dos demais cenários fiscais.

## Conclusão do ensaio IBS/CBS e correção do ADN — 10/10/2026

Após autorização para continuar e confirmação de que o serviço corresponde à gestão de campanhas de anúncios/tráfego pago, foi criado somente no banco isolado um perfil de teste com NBS `1.1406.11.00`, indicador `100301`, CST `000` e classificação `000001`. Referências: tabelas oficiais já versionadas e correlação orientativa do Anexo VIII. O perfil de homologação não configura a tributação de produção nem comprova sozinho o enquadramento de outras operações.

Uma única transmissão adicional pelo fluxo real do projeto autorizou a **NFS-e nº 2**, DPS nº 6, série 00001, R$ 1,00, `tpAmb=2`. O XML autorizado confirma base R$ 1,00, alíquotas IBS UF 0,10%, IBS municipal 0,00%, CBS 0,90%; valores IBS R$ 0,00, CBS R$ 0,01, total IBS/CBS R$ 0,01 e total da nota R$ 1,00. Valores lidos da Sefin, sem cálculo local substituindo o retorno. Tomador e descrição preservados. Livro local da tentativa encerrado como autorizado para impedir repetição.

DANFSe gerado a partir desse XML, renderizado e conferido em uma página com marca de homologação e destaque. Fontes Arial/Microsoft Sans Serif do ambiente local usadas sem copiá-las para o repositório. Ajustada a folga vertical da marca de homologação para não encostar na divisória com Arial Bold. Evidências privadas em `.local/nfse-parametros-review/conferencia-ibscbs-retorno.json`, `nfse-klaus-ibscbs-autorizada.xml` e `danfse-klaus-ibscbs-homolog.pdf`; banco em `test-evidence/nfse-klaus-ibscbs-1791642821840`.

ADN: a causa do erro TLS era a omissão da cadeia de certificação ao converter PFX para PEM. O mesmo A1 contém quatro certificados. Com a cadeia completa, o ADN respondeu HTTP 200 usando TLS 1.3 e verificação de certificado habilitada; TLS 1.2 também funcionou no diagnóstico. A assinatura XML continua contendo somente o certificado do emitente; o transporte preserva a cadeia. Nenhuma redução de segurança ou retentativa automática foi introduzida.

O contrato autenticado corrigiu o caminho anterior baseado no manual resumido:

- Convênio: `GET /parametrizacao/{municipio}/convenio`.
- Histórico de alíquotas: `GET /parametrizacao/{municipio}/{codigoServico}/historicoaliquotas`.
- O código do serviço precisa de **máscara `00.00.00.000`**, com seis dígitos nacionais e três municipais. Sem máscara o provedor retornou 400 mesmo com nove dígitos. Não completar o municipal com zeros por suposição.
- O serviço interno recebe os dois campos separados, confere o nacional no cadastro, preserva os nove dígitos e o caminho efetivo na consulta. A tela solicita o complemento e o limpa ao trocar serviço ou município.

Consultas reais do convênio do Rio e do histórico de `17.06.01.001` retornaram HTTP 200. O histórico de homologação contém alíquota de 5%, início 17/09/2025 e fim ausente. Esse retorno **não foi aplicado ao ISS da empresa do Simples nem tratado como parâmetro confirmado de produção**. A consulta continua manual, registrada e destinada à conferência.

Fonte: [OpenAPI autenticado do ADN em produção restrita](https://adn.producaorestrita.nfse.gov.br/parametrizacao/swagger/v1/swagger.json), snapshot `docs/leiaute-nfse/documentacao-tecnica/adn-parametrizacao-homolog-v1-20261010.json`, SHA-256 `fe11afdc72ee27161af5d906206e4f1d422f48e7556525324ca52a72867d3bd5`. O snapshot é público e não contém dados do certificado/empresa.

Validação desta revisão: 145 testes de API em seis suítes, mais 94 de DANFSe/leitura RTC; cinco testes da tela municipal; oito cenários com PostgreSQL real e provedor simulado (`test-evidence/nfse-municipal-postgres-1791642993083`); build web aprovado. Consultas municipais autenticadas e emissão com valores IBS/CBS concluídas em homologação. Produção, suas flags, perfis e numeração continuam preservados. Permanecem a conferência cadastral definitiva, testes de outros enquadramentos e a interpretação municipal por competência.
