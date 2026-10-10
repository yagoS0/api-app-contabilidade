# Plano de adequação da emissão de NFS-e

Data: 06/10/2026. Base: `api-app-contabilidade`, HEAD `7061b2f`, checkout `codex/pendencias-fiscais-dev`, com alterações locais de outros trabalhos. Este documento é planejamento; não altera configurações, banco, emissão ou publicação.

## Objetivo

Atualização de 10/10/2026: primeira entrega das correções prioritárias implementada e validada localmente. Escopo implementado, migração, fontes, resultados de testes e pendências estão em [nfse-correcoes-prioritarias-2026-10-10.md](nfse-correcoes-prioritarias-2026-10-10.md). As etapas abaixo continuam sendo o plano completo, não uma declaração de conclusão.

Adequar a configuração e a emissão ao contrato efetivamente implantado da NFS-e Nacional e às regras fiscais aplicáveis à empresa e à operação. Preservar a interface existente e centralizar decisões no backend. Autorização da NFS-e, validade estrutural do XML e conformidade tributária são verificações diferentes.

Não é necessário reproduzir toda a interface do gov.br para atender uma operação. É necessário representar corretamente seus dados, atender as condições aplicáveis e declarar os cenários não suportados antes da transmissão. A legislação municipal e o enquadramento concreto continuam necessários; o plano não atesta a regularidade de toda a carteira.

## Base existente que será reutilizada

| Componente atual | Encaixe na implementação |
| --- | --- |
| `apps/api/src/application/nfse/NfseService.js` | Orquestra emissão, certificado, validações, numeração, XML e transmissão; integrar a decisão fiscal comum antes da reserva. |
| `application/validators/nfsePayload.js` | Validar forma das entradas e recusar recursos não suportados; não colocar toda a legislação neste validador. |
| `application/nfse/preparacaoFiscalDoCliente.js` | Evoluir preparação existente para consumir a mesma resolução usada na emissão. |
| `application/nfse/perfilEmissao/{campos,resolverPerfilDeEmissao,catalogoPerfil}.js` | Preservar catálogo, isolamento por empresa, serviços habilitados e seleção do perfil. |
| `application/nfse/{ibscbsDaDps,pAliqDaDps,tributacaoMunicipalDoPerfil,retencaoFederalDaDps,retencoesComplementares}.js` | Manter resolvedores especializados; acrescentar contexto fiscal e decisões explícitas. |
| `application/nfse/{contratoNacional,snapshotFiscal}.js` | Reutilizar identificação do contrato e registro dos parâmetros; ampliar rastreabilidade sem armazenar segredos. |
| `Company`, `CadastroFiscal`, `PerfilEmissaoNfse` no Prisma | Reutilizar cadastros; acrescentar vigência, contexto e evidências somente onde faltarem. |
| `routes/firm/perfisEmissao.js` e rota de configuração em `routes/firm/index.js` | Preservar salvamentos separados, permissões e semântica de ausente versus apagar. |
| `apps/web/src/features/companies/detail/components/{renderEmissaoNfseTab,EditorPerfilEmissao,PainelProximaDps}.jsx` | Evoluir configuração e diagnóstico na área atual. |
| `apps/web/src/features/companies/form/components/CamposEmissaoNfse.jsx` | Adequar parâmetros gerais, benefício e instruções. |
| `apps/web/src/features/notas/components/EmitirNfseWizard.jsx` | Confirmar os fatos da operação e mostrar a resolução real do servidor. |
| `apps/portal-cliente-web/src/features/emitir/` | Preservar fluxo simples; encaminhar decisões fiscais pendentes ao escritório. |
| `EmissaoGuiadaWhatsappService`, `nfse/lote/emissaoLote.js`, `NfseRecorrenciaService` | Consumir o mesmo núcleo, sem caminhos alternativos que ignorem bloqueios. |

Os caminhos abreviados do backend acima partem de `apps/api/src/`. As três cópias locais de release não devem receber edições manuais duplicadas: implementar na base acordada e integrar pelo fluxo Git de publicação, após conferir divergências. Não misturar as alterações fiscais com os trabalhos locais de pendências/comercial.

## Decisões de arquitetura

1. Criar em `application/nfse/` um resolvedor comum, por exemplo `resolverContextoFiscalDaNota.js`, composto pelos módulos especializados atuais. Separar carregamento de dados da resolução pura para permitir testes determinísticos.
2. Entradas: empresa autorizada, perfil e sua revisão, regime aplicável à competência, fatos da operação, parâmetros municipais válidos, contrato técnico ativo e versão das regras.
3. Saída: valores efetivos, procedência por campo, campos exigidos/proibidos, pendências, avisos, recursos não suportados e versões das evidências. Cada pendência terá código, campo, motivo e responsável pela correção.
4. Distinguir obrigação legal (`OBRIGATORIO`, `FACULTATIVO`, `NAO_APLICAVEL`, `INDETERMINADO`) de capacidade técnica de representar a operação. Integração desligada não dispensa obrigação.
5. Não impor uma precedência única a todos os campos: fatos da operação, como local efetivo, não podem ser sobrescritos por padrões; parâmetros fiscais continuam sujeitos às permissões e regras do escritório. Ausência não é zero, isenção ou dispensa.
6. A prévia e o XML usam a mesma resolução. Na confirmação, validar novamente a revisão do cadastro/perfil e as entradas; mudança relevante devolve nova prévia, sem emitir sob confirmação antiga.
7. Registrar o contexto efetivamente usado no `snapshotFiscal` e conservar o XML autorizado. Nunca recalcular o passado com o cadastro atual nem alterar notas autorizadas em migrações.

## Etapa 1 — Matriz normativa e diagnóstico da base (P0)

Entregas:

- Matriz por campo/cenário: fonte oficial, regra de negócio, condição, vigência, ambiente, tag e implementação atual. Usar os arquivos e hashes de `docs/leiaute-nfse/documentacao-tecnica/rtc-2026-10-05/` como ponto de partida.
- Conferir contrato nacional atual de 27/07/2026, regras municipais e notas técnicas posteriores. Publicação de NT não prova implantação; mudanças de estrutura precisam de cronograma e contrato confirmados.
- Levantamento somente de leitura dos cadastros, perfis, regimes, municípios e integração efetiva no ambiente a ser publicado. Não presumir que o estado dos testes reproduz produção.
- Diagnóstico por empresa/serviço: pronto para cenários cobertos, pendência cadastral, enquadramento não confirmado, recurso não suportado ou falha técnica. Se algum dado depender da nota, mostrar “depende da operação”, sem um selo genérico de conformidade.
- Atualizar comentários desatualizados: há comentários no Prisma anteriores às tabelas RTC e integrações já implementadas. O comportamento e as fontes atuais prevalecem sobre comentários históricos.

Aceite: toda regra proposta para bloquear emissão tem fonte, condição e teste identificados. Dados desconhecidos são listados para revisão, sem preenchimento fiscal automático.

## Etapa 2 — Núcleo comum e correções imediatas (P0)

### IBS/CBS

- Evoluir `ibscbsDaDps` para receber a decisão de obrigatoriedade além da flag técnica. Hoje flag desligada ou três códigos vazios permitem omissão.
- Implementar regras versionadas por data do fato gerador/competência aplicável, regime e categoria da operação. Conferir o Ato Conjunto RFB/CGIBS nº 4/2026 e alterações na implementação; não aplicar a mesma data a todos.
- Se obrigatório e faltam dados, impedir transmissão e apontar a configuração faltante. Se o contrato necessário não estiver disponível, retornar incapacidade técnica; não enviar nota regular incompleta como alternativa.
- Remover a orientação irrestrita de apagar os campos para prosseguir: omissão só será opção quando admitida no cenário.
- Preservar validação NBS terminal, cIndOp, CST/cClassTrib, vigência e indicação de uso em NFS-e. Anexo VIII continua sugestão, sem escolher benefício/enquadramento automaticamente.

### Local da prestação e incidência

- Corrigir a precedência atual `perfil.cLocPrestacao || operacao.cLocPrestacao`: o fato confirmado da operação deve prevalecer sobre o padrão do perfil.
- Exibir o local sugerido e pedir confirmação quando o cenário exigir, sem confundir local físico da prestação com município de incidência do ISS.
- Mapear exceções aplicáveis da LC 116, art. 3º, a partir do serviço e dos fatos. Não inferir incidência exclusivamente pelo endereço do tomador ou pelo município emissor. Respeitar cálculos e validações da Sefin.
- Quando os elementos não bastarem, devolver pendência específica; não aplicar regra geral como se todas as exceções tivessem sido descartadas.

### Capacidades e bloqueios

- Mostrar a integração efetiva junto à configuração, não apenas dentro do diagnóstico recolhido.
- Informar no seletor que exportação ainda não é atendida, mantendo o bloqueio backend existente. Preservar perfis antigos sem convertê-los em operação tributável.
- Enquanto o benefício não estiver integrado, impedir a emissão que dependa dele. Um campo legado preenchido não prova aplicabilidade: exigir revisão do contexto, sem aplicar nem descartar automaticamente.

Aceite: escritório, cliente, WhatsApp, lote e recorrência devolvem a mesma decisão; validação acontece antes de reservar numeração ou transmitir. Testes cobrem flag desligada com obrigação vigente, limites de data, regimes diferentes, perfil desatualizado e local da operação divergente.

## Etapa 3 — Regime, ISS, retenções e contexto municipal (P0/P1)

Entrega local de 10/10/2026: histórico existente passou a resolver o regime por competência, com recusa de lacunas e ambiguidades. Implementada primeira validação de exceções municipais e adequação do destaque de IBS/CBS solicitada durante esta etapa. Ver [escopo, fontes, validação e limites](nfse-historico-regras-municipais-2026-10-10.md). Os itens restantes desta etapa continuam pendentes.

Continuação: consultas manuais de convênio e parâmetros por serviço implementadas com certificado da empresa, persistência de tentativas e interface no escritório. Integração desativada até migration e ensaio autenticado em produção restrita. Os retornos ficam para conferência; aplicação automática por vigência, CNC, IM, retenções e benefícios permanecem pendentes do contrato operacional. Detalhes e testes no mesmo relatório.

- Confirmar se as fontes existentes sustentam regime por competência; o regime atual sozinho não resolve emissão retroativa. Usar histórico disponível e acrescentar vigências sem inventar períodos anteriores.
- Conferir `regApTribSN`, sublimite e situações de ISS fora do Simples; não manter `1` como padrão sem suporte no contexto.
- Revisar `pAliqDaDps`: separar limite estrutural do XML, condição de informar a alíquota e alíquota legal aplicável. Um percentual caber no XML não o torna correto. Corrigir referências legais imprecisas nos comentários.
- Separar alíquota de ISS retido, alíquota efetiva pertinente do Simples e percentual aproximado de tributos. A razão DAS/faturamento usada hoje para a carga aproximada não deve ser tratada como prova da alíquota de ISS retido.
- Revisar retenções federais por natureza do serviço, sujeitos, regime, fato gerador e dispensas; não transformar o booleano do art. 30 ou o valor da nota em decisão universal. Preservar valores explícitos e encaminhar cenários sem dados suficientes.
- Conferir inscrição municipal, complemento municipal e envio de IM conforme CNC/parâmetros do município e regra vigente. Revisar a exceção fixa de Rio de Janeiro e a exigência global de complemento; não remover exigências apenas porque o XSD admite ausência.
- Identificar APIs oficiais já disponíveis para parâmetros municipais. Reutilizar integração existente quando possível; caso falte capacidade confirmada, permitir fonte documental validada com data e vigência. Não presumir endpoint, consulta gratuita ou atualização automática.

Dados propostos: histórico de enquadramento e parâmetros com vigência, origem, data de conferência e responsável. Selecionar modelo definitivo após inventário das estruturas existentes para evitar tabelas redundantes.

Aceite: cenários de mudança de regime, competência retroativa, sublimite, retenção/não retenção e parâmetros municipais desconhecidos têm decisões verificáveis e mensagens específicas.

## Etapa 4 — Benefício municipal aplicado de ponta a ponta (P1)

- Reutilizar `beneficioMunicipalNumero`, `beneficioMunicipalTipoReducao` e `beneficioMunicipalPRedBC` existentes; migrá-los como cadastro legado a conferir, nunca como benefício validado.
- Representar município concedente/incidência, serviços/prestador abrangidos, vigência, evidência da concessão e responsável pela conferência. Permitir mais de um benefício por contexto se o levantamento da carteira demonstrar necessidade.
- Separar parâmetro recorrente da escolha na nota. Benefício por valor precisa do valor da operação; percentual não equivale a valor monetário.
- Validar aplicabilidade, tipo e exclusividade das reduções; integrar `BM` na posição correta do XSD e validar as regras condicionais. Não tratar qualquer benefício como isenção nem prometer que todo benefício reduz a base.
- Prévia, XML, snapshot, leitura da nota autorizada e DANFSe devem refletir o mesmo tratamento. Remover o aviso de “cadastro sem efeito” somente quando o fluxo estiver implementado e habilitado.

Aceite: fixtures oficiais/representativas para sem redução, percentual e valor, além de benefício expirado, município divergente, serviço incompatível e valor indevido. Homologação externa dos cenários antes da liberação.

## Etapa 5 — Interface e todos os canais (acompanha etapas 2–4)

- Configuração da empresa: manter parâmetros gerais e liberação ao cliente separados dos perfis.
- Perfil: mostrar valores recorrentes, procedência, vigência e pendências; evitar repetir campos fiscais nas telas do cliente.
- Diagnóstico: evoluir `PainelProximaDps` com contexto efetivo e limitações. Quando não há tomador/valor/local/competência suficientes, apresentar simulação parcial explicitamente.
- Emissão: coletar fatos faltantes em `EmitirNfseWizard`, `DadosDaOperacao`, `EmitirNotaPage` e coleta WhatsApp. Cliente informa fatos; escritório resolve enquadramento.
- Atualizar clientes de API e mocks junto com contratos; respostas tardias não podem trocar contexto de empresa ou apagar edição.
- Lote: resultado individual por linha; dados inválidos não contaminam as demais. Recorrência: revalidar a cada ocorrência e encaminhar pendências, sem repetir transmissão incerta.

Aceite: prévia e XML coincidem; alteração relevante após confirmação exige nova conferência; permissões por carteira/empresa continuam no backend; cancelamento da edição preserva cadastro.

## Etapa 6 — Ampliação de cobertura (P2, separada das correções)

- Exportação, tomador estrangeiro/NIF, endereço exterior, país de resultado e `comExt`: implementação completa por cenário, com critérios de exportação e fontes oficiais; manter bloqueio enquanto incompleta.
- Intermediário e retenção por responsável correspondente: primeiro confirmar demanda e abrangência do contrato, depois implementar entrada, validação, XML e retorno.
- Alternativas de identificação de obra/endereço: ampliar a partir dos identificadores já suportados, sem exigir todos os campos em todas as operações.
- NT 009: adaptador próprio para contrato confirmado, incluindo finalidades/ajustes, novos grupos e pagamentos vinculados conforme aplicabilidade. Não mover tags do contrato atual somente porque existe nova publicação.
- NFS-e Via, emissão geral por pessoa física e outros documentos especiais não entram automaticamente neste escopo. Não acrescentar substituição de notas, anteriormente excluída pelo dono, como requisito desta correção.

Aceite: cada nova capacidade só aparece como disponível após validação completa e homologação do contrato aplicável. A falta de uma capacidade fora das operações da carteira não bloqueia as operações suportadas.

## Testes e implantação

1. Regressão: reaproveitar suítes de perfis, salvamento isolado, `perfilNaEmissao`, `dpsContraXsd`, IBS/CBS, retenções, benefício, portal, WhatsApp, lote e recorrência. Na revisão anterior passaram 133 testes em seis suítes; isso não é homologação integral.
2. Matriz de negócio: Simples/MEI/não optante quando suportados, transições de regime, competências retroativas, exceções de local, ausência de fonte municipal, benefícios, obrigações IBS/CBS por data e cenário não suportado.
3. Integração: banco PostgreSQL de teste, isolamento entre empresas, concorrência e revisão da prévia; validar XML no pacote XSD exato e nas regras condicionais, além de testes de tela.
4. Migração: apenas aditiva inicialmente; novos dados desconhecidos ficam pendentes. Diagnosticar antes de ativar, preservar números e documentos fiscais e não converter nulos em valores tributários.
5. Homologação: ambiente restrito com casos controlados. Testes locais não transmitem notas, não enviam mensagens e não fazem consultas fiscais pagas. Não usar emissão real e cancelamento como teste automatizado.
6. Publicação em entregas pequenas: backend/migrações compatíveis antes das telas; revisar empresas afetadas antes de ativar bloqueios. Não manter janela permissiva para casos comprovadamente obrigatórios. Caso não atendido deve usar o canal oficial apropriado.
7. Reversão: retornar a uma versão compatível preservando bloqueios legais, snapshots, numeração e migrações aditivas. Desligar uma flag não pode dispensar a obrigação fiscal. Desfecho de transmissão incerto exige conciliação, não reenvio automático.

Sequência sugerida de PRs: (1) matriz/diagnóstico e contratos; (2) núcleo comum, IBS/CBS e local; (3) regime/ISS/parâmetros municipais; (4) benefício completo; (5) conclusão da experiência e cobertura entre canais; (6+) capacidades adicionais. As adaptações mínimas de todos os canais acompanham cada mudança backend, sem aguardar a quinta PR.

## Fontes e dependências

- [Documentação oficial de produção](https://www.gov.br/nfse/pt-br/biblioteca/documentacao-tecnica/documentacao-atual): manual, XSD e Anexo I; usar regras condicionais, não apenas lista de campos.
- [Guia do Emissor Nacional Web](https://www.gov.br/nfse/pt-br/biblioteca/documentacao-tecnica/documentacao-atual/guia-emissorpubliconacionalweb_snnfse-ern-v12.pdf): comparação de fluxo, pessoas, serviço e benefício municipal.
- [LC 116/2003](https://www.planalto.gov.br/ccivil_03/leis/lcp/lcp116.htm): incidência/local, exportação, responsabilidade e limites do ISS; complementar com legislação municipal e decisões aplicáveis.
- [Orientação oficial de IBS/CBS](https://www.gov.br/nfse/pt-br/noticias/cgnfs-e-orienta-sobre-os-prazos-para%20destaque-de-ibs-cbs-nas-notas-fiscais-de-servico) e [Ato Conjunto RFB/CGIBS nº 4/2026](https://www.cgibs.gov.br/upload/arquivos/202607/31091735-20260730-16h30-ato-conjunto-rfb-cgibs-na-c2-ba-4-260731-090909.pdf): distinguir cronograma de obrigação de aceitação técnica da nota.
- [Portal RTC](https://www.gov.br/nfse/pt-br/biblioteca/documentacao-tecnica/rtc) e [NT 009 v1.01](https://www.gov.br/nfse/pt-br/biblioteca/documentacao-tecnica/rtc/nota-tecnica-009-se-cgnfs-e-v-1-01.pdf): Anexo VIII orientativo e dependência de cronograma de implantação.
- Na etapa normativa, complementar e verificar textos consolidados do Simples Nacional, retenções federais e legislação dos municípios efetivamente envolvidos. Não extrapolar a revisão inicial como se essas áreas já estivessem integralmente auditadas.

Dependências concretas de liberação: inventário real da carteira, vigências/enquadramentos confirmados, concessões municipais aplicáveis, capacidades do ambiente implantado e resultados de homologação. O desenvolvimento do núcleo e dos testes locais pode avançar antes dessas confirmações; habilitar cenários que dependam delas, não.

## Análise das telas do contador após homologação — 10/10/2026

Pedido posterior do usuário: analisar mudanças no cadastro das notas do contador. A lista abaixo registra a análise inicial; a implementação autorizada está descrita ao final desta seção. Reaproveitar cadastro de empresa, `RegimeHistoricoEditor`, `EditorPerfilEmissao`, `PainelProximaDps`, `EmitirNfseWizard` e `NotaDetailModal`.

1. **P0 — Prévia por competência.** `EmitirNfseWizard.jsx:534` ainda resolve o regime apenas de `regimeCadastrado`, enquanto `NfseService.issue` exige histórico da competência. Criar leitura de preparação para o contador usando o núcleo existente; reavaliar ao mudar competência/perfil/serviço/tomador/local. Informar período e procedência, pendências antes da confirmação e revalidar no envio. Hoje o campo de competência é mensal; admitir dia quando a mudança de regime dentro do mês exigir essa precisão.
2. **P0 — Cadastro confirmado.** Data de abertura e histórico já têm campos, mas precisam de preenchimento e acesso direto a partir da pendência de emissão. Não usar criação no sistema como abertura nem preencher períodos automaticamente. O caso Klaus mostrou ambos vazios. Evoluir histórico de apuração no Simples/sublimite e carga aproximada, que o histórico de regime sozinho não resolve.
3. **P1 — Perfil de serviço completo.** NBS, indicador, CST, classificação, categoria e complemento municipal já existem. Exibir código e descrição, completude e coerência por operação; separar sugestão orientativa de decisão confirmada. Ao trocar serviço, exigir revisão das classificações anteriores. Evitar duplicar campos entre cadastro geral e perfil; o perfil é a configuração recorrente por serviço/município, sem copiar o ensaio para a carteira.
4. **P1 — Parâmetros municipais legíveis.** Conexão/caminhos e complemento já corrigidos. Evoluir o JSON bruto atual para resumo com município, serviço/complemento, incidência, alíquota, início/fim e ambiente/origem. Cruzar a competência com o período retornado e registrar conferência do contador antes de qualquer uso fiscal. A taxa municipal consultada não define automaticamente ISS retido, ISS fora do Simples ou benefícios. Retenções, benefícios e CNC exigem conectores e contexto próprios.
5. **P1 — Conferência da nota.** Hoje a confirmação inclui nome/código do perfil, tomador e valores, mas não o contexto fiscal completo. Mostrar regime efetivo, serviço/NBS, local/incidência, IBS/CBS obrigatório/facultativo/pendente, retenções, perfil e ambiente. Preservar escolhas da operação; não reaproveitar competência, enquadramento ou autorização antiga ao usar uma nota como modelo. Valores finais IBS/CBS devem continuar vindo do XML autorizado, não de campos livres preenchidos para gerar destaque.
6. **P1 — Histórico da nota autorizada.** O detalhe já mostra destaque do XML e o backend já guarda `configuracaoFiscal` por tentativa. Expor essa fotografia junto da nota, com procedência e distinção entre configuração enviada e valores retornados. Alterar perfil não deve mudar a explicação de notas antigas. Captura/importação usa o XML recebido, sem completar tributos ausentes ou recalcular totais.

Ordem de implementação: preparação única da nota e histórico; revisão dos perfis; resumo municipal por vigência; conferência de emissão e fotografia no detalhe. A homologação positiva é evidência do cenário de R$ 1,00 executado, não uma liberação geral de todos os enquadramentos ou ambientes.

### Implementação no contador — 10/10/2026

- Nova leitura `POST /firm/companies/:companyId/previa-emissao`, com acesso mínimo ACCOUNTANT e vínculo da empresa. Reutiliza `regimeDaCompetencia`, resolução de perfil/serviço, `resolverContextoFiscalDaNota`, `pAliqDaDps` e `snapshotFiscal`. Não reserva numeração, grava dados ou consulta o ADN. Retorna contexto parcial e pendências; não substitui validação integral da emissão.
- Assistente consulta a prévia quando os dados mudam, descarta respostas antigas e bloqueia avanço sem resultado válido. Regime declarado vem da competência, incluindo escolha de mês completo ou dia da prestação. Há acesso ao histórico e às configurações, além de município da prestação informado na operação.
- Antes da confirmação, relê a configuração fiscal e exige nova revisão se mudou. A confirmação inclui ambiente, regime/vigência, serviço, NBS, local, condição e classificação de IBS/CBS e ISS. O espelho respeita a decisão de envio da alíquota na DPS. Os valores definitivos continuam vindo do XML autorizado.
- Perfis mostram campos de classificação ausentes e descrições disponíveis nas tabelas existentes. Trocar serviço preserva os valores e exige confirmação de revisão de complemento municipal, NBS e tributação. Preenchimento não é certificado de enquadramento fiscal.
- Parâmetros municipais mostram fonte, ambiente, serviço, incidência, alíquota (inclusive zero) e intervalos reconhecidos do contrato ADN. A comparação com o dia da prestação usa somente o histórico salvo, sinaliza divergências/ambiguidade e não aplica alíquota, retenção ou benefício automaticamente. JSON original continua disponível; formatos não reconhecidos exigem conferência.
- Detalhe da NFS-e emitida lê a configuração preservada de `ServiceInvoice`, vinculada à empresa e chave/DPS, sem consultar perfil atual. Ausência, ambiguidade e indisponibilidade são estados explícitos. Notas importadas sem emissão local não recebem contexto inventado.
- QA local: API com dublês, testes de interface, build Vite e navegador com fixtures sintéticas; conferência de prévia, perfis, vigência e largura de 390 px. Servidor e arquivos temporários de QA removidos após a inspeção. Nenhuma nova transmissão fiscal ou publicação realizada nesta etapa.

Limites mantidos: parâmetros municipais precisam de conferência humana; histórico específico de opção de apuração do Simples/sublimite/carga e hipóteses excepcionais não representadas continuam sujeitos às pendências do núcleo fiscal. O mock identifica a prévia como demonstração indisponível para validação fiscal, sem liberar emissão ficticiamente como se tivesse histórico confirmado.
