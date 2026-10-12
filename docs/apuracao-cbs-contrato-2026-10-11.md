# Contrato técnico CBS — consulta documental em 11/10/2026

Escopo: débitos, créditos e situação da apuração assistida CBS. Esta referência orienta implementação; não comprova acesso de qualquer empresa, contrato ativo ou funcionamento do ambiente. Nenhum token foi obtido e nenhuma API fiscal foi chamada nesta pesquisa. Produção Restrita é o nome oficial; sua associação à configuração local HOMOLOGACAO deve ser explícita.

## Endpoints e abertura

| Ambiente oficial | Base |
| --- | --- |
| Produção Restrita | `https://api.receitafederal.gov.br/apuracao-cbs-prr/v2` |
| Produção | `https://api.receitafederal.gov.br/apuracao-cbs/v2` |

| Operação | Método e caminho |
| --- | --- |
| Débitos | `POST /debitos/{cnpj}` |
| Créditos | `POST /creditos/{cnpj}` |
| Situação | `GET /situacao/{tiqueteSolicitacao}` |

Na abertura, `{cnpj}` é o CNPJ-base de oito posições. As páginas ainda descrevem oito dígitos; não confirmam suporte remoto a CNPJ alfanumérico. Cabeçalhos: `Authorization: Bearer <access_token>` e `Content-Type: application/json`. Corpo documentado: `{ "urlRetorno": "https://..." }`. Não há filtro de competência, data inicial/final ou cursor de entrada. Sucesso HTTP 201 devolve `tiqueteSolicitacao` e `tEASegundos` como strings; erros incluem `codigoErro` e `mensagemErro`. O tíquete de exemplo contém UUID e sufixo: tratá-lo como identificador opaco, não UUID puro. Mudanças retornadas abrangem até oito dias; a primeira consulta considera o início do mês corrente. Fontes: [débitos v1.1, 17/09/2026](https://docs.receitafederal.gov.br/apuracao-cbs/debito.html), [créditos v1.1, 17/09/2026](https://docs.receitafederal.gov.br/apuracao-cbs/credito.html).

## Situação, webhook e prazos

O GET usa Bearer e `Accept: application/json`. Campo `estado`: `PENDENTE`, `EM_PROCESSAMENTO`, `CONCLUIDA`, `ERRO`. Concluída retorna `urlAssinada` e `urlAssinadaExpiraEm`; erro retorna `codigoErro` e `mensagemErro`. O corpo de situação não especifica `tiqueteSolicitacao`: a correlação vem do pedido. A URL ilustrativa de download nessa página aponta para `api.receitafederal.gov.br/prr-rtc/download/v2/...`; não é um endpoint a construir localmente. Fonte: [situação v1.1](https://docs.receitafederal.gov.br/apuracao-cbs/situacao-solicitacao.html).

O serviço verifica o webhook por HEAD antes de aceitar a abertura. Esse teste não autentica o POST. Sucesso assíncrono informa tíquete, URL assinada e expiração; erro informa código/mensagem. Não há esquema de assinatura/HMAC, certificado cliente ou cabeçalho autenticador especificado nas páginas examinadas. Limites publicados: quatro aberturas/dia, processamento até 240 minutos e arquivo disponível por 48 horas após aviso de pronto. A URL permite vários downloads dentro da validade. Só responder 2xx depois de aceitar o recebimento; preservar auditoria sem segredos. URL assinada é segredo temporário; não pode aparecer em logs, métricas, histórico, mensagens de erro ou rastreamento. HTTPS e validação TLS permanecem obrigatórios. Fonte: [regras comuns v1.0, 03/09/2026](https://docs.receitafederal.gov.br/apuracao-cbs/guiaapiassincrona.html).

## Autenticação Receita Integra

O manual oficial v1.4, atualizado em 17/07/2026, confirma OAuth2 Client Credentials e `POST https://api.receitafederal.gov.br/token`. Credenciais: `client_id` e `client_secret`, geradas pelo serviço Gerar Credencial de Acesso para API nos portais oficiais. Validade publicada: uma hora; limite: dois tokens por hora. Exige reutilização por cache e Bearer nas APIs. As regras CBS pedem credenciais da matriz. O manual distingue 401 (token), 403 (permissão/escopo), 404 (recurso/endpoint), 429 (limite) e 500 (falha interna). Fonte: [Receita Integra v1.4, páginas 2–5](https://www.cgibs.gov.br/upload/arquivos/202609/05164748-08-manual-de-integracao-tecnica-receita-integra-v-1-4.pdf).

A codificação exata do pedido de token não consta no texto do v1.4 consultado. O exemplo oficial do manual DeRE v1.0.1 utiliza Basic com `CLIENT_ID:CLIENT_SECRET`, `Content-Type: application/x-www-form-urlencoded` e `grant_type=client_credentials`; resposta exemplifica `expires_in`, `token_type`, `access_token`. É referência do mesmo autenticador, publicada para DeRE, e não prova de escopos CBS. Fonte: [manual DeRE v1.0.1, página 12](https://www.cgibs.gov.br/upload/arquivos/202606/22141451-07-manual-do-desenvolvedor-v-1-0-1.pdf).

## Arquivo JSON: campos publicados

Envelope: `tiqueteSolicitacao`, `ni` (oito posições), `niConsumidor`, `geradoEm`, `apuracao[]`. Cada apuração contém `pa` no formato `MM/AAAA` e lista de débitos ou créditos. `niConsumidor` é obrigatório na tabela de débitos e opcional na de créditos. As páginas usam terminologia inconsistente object/array em débitos; os exemplos mostram listas.

Campos de cada débito: `origem`, `documento`, `chave`, `emissao`, `registro`, `atualizacao`, `cbs`. Valores em `cbs`: obrigatórios `apurado`, `saldoDevedor`; opcionais `excedente`, `inexigivel`, `suspenso`, `extinto`. Formato monetário: number (18,2). Atenção ao singular `excedente`. Fonte: [débitos, seção 5](https://docs.receitafederal.gov.br/apuracao-cbs/debito.html).

Campos de cada crédito: `origem`, `documento`, `chave`, `emissao`, `registro`, `atualizacao`, `cbs`. Hierarquia dos valores:

```text
cbs.apurado
cbs.excedentes
cbs.apropriacao.{inapropriavel,suspenso,prescrito,aApropriar,apropriado}
cbs.apropriacao.utilizacao.{inutilizavel,utilizado,restabelecido}
cbs.apropriacao.utilizacao.naoUtilizado.{saldoCredor,pedidoRessarcimento}
```

Somente `apurado` é obrigatório entre esses valores; os demais grupos/valores são opcionais. Atenção ao plural `excedentes`. Valores são number (18,2), sem garantia de precisão caso sejam convertidos prematuramente para ponto flutuante JavaScript. A página não enumera códigos de origem/documento dos créditos. Fonte: [créditos, seção 5](https://docs.receitafederal.gov.br/apuracao-cbs/credito.html).

## Decisões locais propostas — não são requisitos publicados pelo Fisco

- Separar coleta DEBITOS/CREDITOS por contribuinte e ambiente. A resposta pode trazer várias competências; seleção na tela não vira filtro remoto inexistente.
- Persistir intenção/reserva antes do envio. Timeout após início de HTTP implica resultado indeterminado, sem repetir abertura automaticamente. Ticket conhecido permite recuperar a situação por ação explícita.
- Não aproveitar credenciais SERPRO Integra Contador por inferência. Referência de cofre local não prova que o conteúdo é um par OAuth habilitado.
- Isolar cache de token por identidade de credencial; impedir autenticações concorrentes. Compartilhar a cota entre ambientes que usam a mesma credencial. Não reenviar secret/Bearer no download de uma URL assinada de outro serviço.
- Antes de qualquer downloader: HTTPS, hosts previamente aprovados, sem credenciais embutidas, sem redirects automáticos, bloqueio de destinos privados/local e limites de tempo/tamanho. A amostra do webhook usa `storagegw.estaleiro.serpro.gov.br`, mas amostra não é lista oficial completa de hosts; não aceitar qualquer domínio a partir dela.
- Sem contrato verificável de autenticação do webhook, não promover seu conteúdo diretamente a prova fiscal. Correlacionar ticket e confirmar via consulta autenticada antes de usar URL/arquivo. Uma rota aleatória é defesa adicional, não uma assinatura oficial.
- Arquivar bytes originais e hash; validar tíquete, contribuinte, ambiente, estrutura e precisão monetária. Conservar campos desconhecidos. Replay local deve usar o arquivo salvo sem nova abertura.
- Manter estados locais de preparação, aguardando, erro, indeterminado, arquivo recebido e validado distintos de conferência fiscal, guia e pagamento. Valores ausentes não devem ser convertidos em zero silenciosamente.
- A identidade provisória de item (competência, origem, documento, chave) exige validação com o provedor. A documentação não garante unicidade, cardinalidade de repetição, tombstones nem desempate de atualizações. Guardar bruto antes de aplicar agregados; não somar atualizações cumulativamente.
- Respeitar agenda explicitamente salva do ALTAN; nova abertura, recuperação de ticket e replay local são ações diferentes. Não implementar agendamento, catchup, fechamento, guias ou pagamento por consequência desta documentação.

## Lacunas que bloqueiam liberação externa automática

Faltam definição inequívoca do escopo/fuso da cota diária; semântica do marco remoto de última consulta (abertura, conclusão ou download); recuperação além da janela; resposta sem movimento; assinatura e política de repetição do webhook; catálogo de hosts de download; especificação de identidade/revisão/exclusão dos itens; precisão lexical de números nos retornos reais; escopos/permissões por contrato; homologação comprovada do contribuinte. Não há API de fechamento ou emissão de guia descrita nas páginas deste escopo. A presença de URL de produção na documentação não demonstra habilitação nem saúde do serviço.

O portal `arquivos.receitafederal.gov.br` não devolveu conteúdo navegável na consulta pública feita aqui; o manual de autenticação foi localizado no portal oficial do CGIBS. Não se contornou autenticação ou controle de acesso.

## Implementação técnica em 12/10/2026 (runtime continua OFF)

`CbsOAuth.js` expõe `criarProvedorTokenCbs({credencialId,lerCredencial,reservarEmissao,...})`, retornando `obterToken({signal})`. O provedor usa Basic/form no endpoint fixo descrito acima, cache privado com margem de 60 segundos, emissão única compartilhada entre consumidores da mesma instância e resposta limitada a 16 KiB. Prazo máximo inclui cofre, reserva e resposta. Nenhuma falha dispara repetição automática; cancelamento de um consumidor não cancela emissão compartilhada. A composição deve reutilizar uma instância por identidade estável de credencial; rotação/revogação exige descartá-la. Tokens não são persistidos ou registrados em logs.

`CbsTokenReserva.js` expõe `criarReservaEmissaoCbs(db)`. Usa transação Serializable, advisory lock por credencial, relógio PostgreSQL e tabela append-only `ApuracaoCbsTokenEmissao`. Duas reservas na janela móvel de uma hora impedem a próxima; falhas de rede mantêm a reserva. Conflitos são recusados sem retry. A chave deve representar a mesma credencial entre ambientes/réplicas e consumidores ALTAN: criar referências duplicadas do mesmo ClientID ou emitir tokens fora desse coordenador pode consumir a cota remota sem conhecimento local. A cota local é conservadora e não prova saldo disponível no provedor.

`CbsDownloadSeguro.js` resolve todos os IPs antes de conectar, recusa resposta DNS com qualquer endereço reservado/privado e fixa um endereço no lookup da conexão HTTPS. Mantém hostname/SNI e validação TLS, não usa pool, proxy de ambiente ou redirects, não encaminha Bearer e recusa conteúdo comprimido. Abort cobre DNS e conexão; o leitor do cliente limita bytes efetivos e prazo total. `CbsClient` utiliza esse transporte por padrão exclusivamente para download; `downloadFetchImpl` é injeção interna para testes, nunca entrada de API. A allowlist exata de hosts ainda exige confirmação operacional do fornecedor.

`CbsWebhook.js` expõe `criarReceptorWebhookCbs({habilitado:false,registrarSinalPendente})`, sem publicar rota. HEAD habilitado só confirma disponibilidade. POST limitado a 64 KiB descarta URL, grupo, erros e demais campos; entrega somente ticket e sinal `WEBHOOK_NAO_AUTENTICADO`/`REQUER_CONSULTA_AUTENTICADA`. O repositório injetado deve restringir ao contexto confiável do endpoint, correlacionar ticket preexistente e deduplicar atomicamente antes de resolver. Tickets desconhecidos e conhecidos recebem resposta indistinguível. Sem autenticação oficial, não confirmar coleta nem baixar arquivo a partir desse aviso. Consulta autenticada continua ação explícita, sem execução automática pelo handler. Persistência/correlação desse sinal e publicação da rota ainda não estão conectadas.

Verificação local: 111 testes de infraestrutura CBS/IBS, sem credenciais reais e sem chamadas externas. A reserva também exige prova PostgreSQL concorrente na suíte de integração; teste unitário não demonstra isolamento real. Homologação externa, autenticação efetiva do webhook e comprovação de permissão do contribuinte permanecem pendências de operação, não resolvidas por flags locais.

## Composição opt-in do servidor

`criarCompositorCbs({db,autorizacoes:[],protecao})` em `CbsRuntime.js` retorna `resolver({companyId,ambiente,usuario})`. O resultado pode ser usado como dependências do serviço de coleta; ausência de autorização devolve apenas proteção para replay local, quando configurada. Sem proteção, retorna objeto vazio. A lista não vem do formulário de preparação nem de parâmetros HTTP.

Cada autorização exige `habilitado:true`, `contribuinteId`, `ambiente`, `configuracaoId`, `credencialId`, `credencialPortalClientId`, `credencialAtualizadaEm` (ISO exato do `updatedAt` do cofre), `matrizConfirmada:true`, `referenciaHomologacao`, `referenciaContrato`, `referenciaCallback`, `urlRetorno` e `hostsDownloadPermitidos`. Referências são registros operacionais a conferir, não comprovação automática da Receita. Autorizações duplicadas no mesmo grupo/ambiente são recusadas. Mudança na configuração ou no cofre exige nova autorização explícita; não migra silenciosamente para outro segredo.

O cofre existente usa `login` como ClientID e `senhaCifrada` como ClientSecret. Somente ação fiscal explícita decifra usando `utils/crypto.js`, após auditoria commitada `REVELADA`, com motivo de uso interno e ator. Essa ação aproveita o CHECK existente; o segredo não é devolvido ao operador. A leitura do painel apenas verifica metadados. Carteira inteira, vínculo, configuração e versão do cofre são revalidados antes de cada operação, inclusive ao usar token em cache. Operações não possuem retry ou agenda inferida.

Pré-requisitos operacionais ainda precisam ser inventariados: contribuinte piloto e matriz corretos, credencial específica Receita Integra (não gov.br/NFS-e), permissão CBS no ambiente escolhido, callback público disponível com persistência/deduplicação de sinais, hosts confirmados, chave de arquivos com retenção/rotação e referências de homologação. Não se testou segredo nem endpoint fiscal real. Reconsulta pública das páginas oficiais em 12/10/2026 manteve as versões citadas acima; o IBS permanece bloqueado conforme documento separado.
