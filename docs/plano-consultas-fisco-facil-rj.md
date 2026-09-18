# Integração Fisco Fácil RJ — plano de consultas de NF-e emitidas

Pesquisa e decisão de escopo: 17/09/2026. Pedido do usuário: integrar pelo Fisco Fácil da SEFAZ-RJ seguindo a proposta enviada. Este documento especifica a investigação autenticada e a implementação posterior em desenvolvimento; não registra uma integração já funcionando.

## Objetivo e decisão

Encontrar e baixar os XMLs originais de NF-e modelo 55 emitidas por cada estabelecimento RJ, sem exigir que o cliente envie os arquivos. Fisco Fácil passa a ser a fonte escolhida para o piloto. Conhecer o sistema emissor da Vagalo deixa de ser pré-requisito desta investigação. NF-e recebidas, NFC-e e NFS-e ficam fora desta ampliação; seus fluxos existentes permanecem.

O importador XML/ZIP e o modal de progresso já implementados serão aproveitados. Não exigir dez XMLs iniciais, inferir chaves por numeração ou considerar uma captura habilitada apenas porque um XML foi importado. Séries e números servem para conferência; a descoberta será por estabelecimento e período no extrator.

## Evidências públicas e limites da pesquisa

1. A [página oficial do Fisco Fácil](https://portal.fazenda.rj.gov.br/fisco-facil/), lida no navegador, anuncia o Extrator de Documentos Fiscais Eletrônicos. Permite acesso com e-CNPJ do contribuinte, certificado do contabilista cadastrado ou outorgado com procuração da SEFAZ-RJ. A procuração e-CAC usada por outros serviços do nosso sistema não comprova esse vínculo estadual.
2. O [manual versão 11, seção 17](https://portal.fazenda.rj.gov.br/fisco-facil/wp-content/uploads/sites/28/2023/09/manual-Fisco-Facil-versao11.pdf), indexado no domínio oficial, descreve seleção de NF-e/emitente, pedido, acompanhamento e download. Registra carência de dez dias, janela máxima de 31 dias, histórico de cinco anos, sete dias para download, até três solicitações sem baixar, rejeição de pedidos iguais e consulta por estabelecimento. Também distingue processamento, resultado vazio, erro e expiração.
3. A página hoje aponta para [outro nome de manual](https://portal.fazenda.rj.gov.br/fisco-facil/wp-content/uploads/sites/28/2023/09/manual-fisco-facil.pdf). Seu conteúdo não foi extraído nesta pesquisa: o download por HTTP retornou HTML de bloqueio de IP; o navegador abriu um visualizador sem texto acessível. Portanto, as regras da versão 11 são referência documental, não validação do comportamento atual. A anotação local anterior de seis meses por solicitação não ficou comprovada. Usar janelas mensais conservadoras e parâmetros configuráveis até conferir a tela.
4. O [PEDTIC oficial 2024–2027, versão 2025.2, p. 175](https://portal.fazenda.rj.gov.br/tecnologia-informacao/wp-content/uploads/sites/7/2025/01/PEDTIC-SEFAZ-RJ-2024-2027-versao-2025.2-3.pdf) identifica o extrator DFe para Fisco Fácil como Java/PLSQL com frontend JSF. Isso justifica investigar formulários, estado da sessão e respostas parciais; não prova um endpoint específico ou que a implantação atual permaneça igual.
5. Não foi localizado contrato público de API para o extrator nas fontes consultadas. O fluxo autenticado de pedido/status/download ainda não foi observado. Não foram feitas solicitações de extração reais.

## Etapa 1 — prova autenticada, antes do conector

Usar a Vagalo como candidata a piloto, após confirmar CNPJ completo, IE e acesso ao estabelecimento RJ. Reaproveitar o certificado armazenado quando tecnicamente viável, sem solicitar seu envio pelo chat. Abrir o sistema pelo link oficial e realizar o fluxo normal autorizado.

Roteiro de observação:

| Operação | O que registrar, sem segredos | Evidência para concluir |
|---|---|---|
| Entrar e escolher estabelecimento | Redirecionamentos, tipo de autenticação, duração/renovação de sessão e vínculo autorizado | Empresa correta visível no extrator |
| Listar solicitações existentes | Paginação, identificador, filtros, período, situação, datas e arquivos | Conseguir reencontrar um pedido sem criá-lo novamente |
| Solicitar NF-e como emitente | Método/caminho reais, nomes dos campos, tratamento de datas, estado de formulário/CSRF e confirmação | Pedido identificado na lista após a submissão |
| Consultar andamento | Situações efetivamente retornadas, mensagens e intervalo recomendado | Separar espera, vazio, erro e disponibilidade |
| Baixar todos os arquivos | Quantidade de partes, tipo de conteúdo, expiração, necessidade de sessão e possibilidade de repetir download | ZIP/XML íntegros e ligados ao pedido correto |
| Conferir documentos/eventos | Modelo, CNPJ, período, autorização e cancelamentos disponíveis | Nota de venda original reconhecida pelo nosso parser |

Guardar apenas exemplos sanitizados das mensagens e respostas. Certificados, senhas, cookies, tokens e cabeçalhos de autenticação não entram em Git, screenshots compartilhados ou logs. Não contornar desafios de acesso: se a sessão depender de interação recorrente, registrar a limitação e desenhar conexão assistida. Se necessário, preparar consulta ao suporte sobre integração suportada; não enviar mensagens sem autorização.

Saída desta etapa: contrato observado de autenticação/listagem/solicitação/status/download e um XML obtido pelo fluxo real. A existência de requisições internas não as transforma em API pública. Decidir, com evidência, entre cliente HTTP de sessão ou automação de navegador isolada. Sem prova de execução desassistida, manter a integração identificada como assistida.

## Etapa 2 — planejamento dos períodos

Configuração por empresa: habilitação, estabelecimento, identidade de acesso, data inicial e modo manual/agendado. Aproveitar cadastro, IE, UF, certificado e notas existentes; pedir somente o que não puder ser determinado. A primeira data é uma escolha do contador: notas já armazenadas não provam cobertura de um período inteiro.

Algoritmo proposto:

1. Calcular a data elegível no fuso America/Sao_Paulo usando a carência confirmada. Testar se o portal trabalha com data civil ou instante antes de fixar a inclusão do último dia.
2. Separar o intervalo desejado em janelas mensais que respeitem o teto confirmado. Marcar a parte recente como aguardando disponibilidade da fonte.
3. Consultar primeiro os pedidos remotos existentes; reconciliar com os registros locais. Baixar pedidos prontos e retomar importações antes de abrir outros.
4. Criar somente janelas ainda sem pedido/cobertura válida. Não preencher a fila com pedidos iguais. O escopo exato da cota (identidade, estabelecimento ou outro) precisa ser observado; começar com uma solicitação ativa por identidade e controle conservador compartilhado.
5. Avançar a cobertura somente após todos os arquivos terem sido guardados e tratados, ou após resposta explícita de resultado vazio. Erro, timeout, ZIP vazio inesperado e XML incompatível não comprovam ausência de notas.
6. Registrar intervalos cobertos e lacunas, além da maior data contínua coberta. Uma única `last_sync_at` não permite distinguir meses faltantes.

Exemplo de planejamento, não de consulta executada: em 17/09/2026, com corte civil D−10 confirmado, o intervalo recente elegível terminaria em 07/09. Para pedir agosto e setembro: 01/08–31/08 e 01/09–07/09; os dias posteriores aguardariam a fonte. O limite exato do dia de corte será validado na prova.

Reconciliação posterior será separada da descoberta de novas datas. Não presumir que o portal aceite repetir a mesma janela para obter cancelamentos; conferir comportamento de pedidos já baixados/expirados e fonte dos eventos antes de prometer atualização contínua da situação fiscal.

## Etapa 3 — conector e execução persistente

Contrato interno proposto para `RjFiscoFacilIssuedNfeProvider`: `checkAccess`, `listRequests`, `requestExtraction`, `getRequestStatus`, `listArtifacts`, `downloadArtifact`. São nomes internos a implementar; não representam rotas existentes da SEFAZ. Requisições reais só serão codificadas depois da etapa 1.

Separar estado local de estado remoto:

- Local: planejada → submetendo → aguardando fonte → baixando → importando → concluída / concluída sem documentos / parcial.
- Exceções: submissão sem confirmação, acesso necessário, erro recuperável, expirada, falha que exige ação.
- Persistir a situação remota original e sua tradução, sem inventar sucesso para um estado desconhecido.

Persistência proposta (nomes finais definidos na implementação):

- Configuração: empresa/tenant, provedor, CNPJ/IE, referência à credencial, habilitação, início, parâmetros confirmados, próxima execução.
- Pedido: identidade/estabelecimento/modelo/participação/período, identificador remoto, chave local de idempotência, estados, datas, expiração, tentativas e erro sanitizado.
- Arquivo: pedido, parte remota, checksum, referência privada ao ZIP/XML, tamanho, download e importação, contadores e ocorrências.
- Cobertura: intervalo, pedido que o comprovou, resultado documental e pendências. Manter cobertura de aquisição separada da atualidade dos eventos fiscais.

O worker usa bloqueio com prazo e retomada para impedir duas instâncias de criar o mesmo pedido. Depois de timeout na submissão, consulta a lista antes de tentar novamente. Se o pedido não puder ser identificado com segurança, fica pendente de conferência. Retomar do arquivo armazenado evita novo download e nova consulta.

Agendamento inicial proposto: uma rodada diária às 06h para planejar novos períodos, distribuída entre empresas; acompanhamento dos pedidos existentes com intervalo conservador, recuo progressivo e limite por identidade. Frequência definitiva depende do comportamento e das orientações da fonte. Não usar polling apertado. Priorizar arquivos próximos de expirar. O prazo exibido deve vir da fonte sempre que disponível.

Certificado próprio e atuação por contabilista/procuração estadual precisam de resolução específica para Fisco Fácil. O `CertResolver` atual não possui esse serviço e a procuração federal não pode ser reutilizada como prova estadual. Reaproveitar armazenamento protegido e auditoria, mantendo as regras atuais de DFE/ADN.

## Etapa 4 — ingestão e situação fiscal

Reutilizar `ImportNfeLoteService`, `zipLeitura`, `loteNfe` e `upsertNfeFromParsed`; persistência existente em `PortalInvoice`/`NotaItem`, com unicidade por empresa e chave. O conector fornece arquivos ao serviço no backend, sem simular um upload HTTP do usuário. A ingestão automática terá guarda adicional de emitente/modelo, sem remover a possibilidade de recebidas no importador manual.

Antes do piloto, tratar eventos: hoje o importador apenas conta e ignora cancelamentos. Extrair/reutilizar a lógica de `applyEvent` em `DfeSyncService`, validar vínculo e protocolo, preservar eventos anteriores à chegada da nota e nunca reativar uma cancelada na recaptura. Aplicar eventos recebidos não significa que o extrator forneça todos os eventos futuros; isso precisa de comprovação separada.

Reutilizar as regras de competência fechada: criar pendência de auditoria quando aplicável e não recalcular nem reabrir apuração silenciosamente. Relatar novos documentos, existentes, eventos, recusas e falhas, inclusive em ZIP dividido em várias partes. Se documentos necessários forem recusados, manter a janela como parcial.

## Etapa 5 — experiência na aba Notas

Na área de NF-e de venda: ação “Buscar no Fisco Fácil”, período sugerido elegível e acompanhamento persistente. Configuração de acesso/captura fica em Configurações; a aba Notas apenas utiliza e sinaliza a conexão.

Exibir última tentativa, último download, período efetivamente importado, documentos novos e pendências. Distinguir “Aguardando Fisco Fácil”, “Acesso necessário”, “Período ainda indisponível”, “Nenhuma nota no período” e falha. Não substituir esses estados por erro genérico ou spinner permanente.

O modal existente serve para o processamento ativo de arquivos. A espera assíncrona da SEFAZ deve aparecer numa lista de solicitações que pode ser fechada e retomada, sem travar a tela por horas. Os arquivos já obtidos ficam disponíveis para XML/DANFE e conferência usando os fluxos existentes.

## Verificação e entregas

1. **Pesquisa concluída:** fontes públicas, limites, divergências do contexto e roteiro autenticado documentados aqui.
2. **Prova da fonte pendente:** uma solicitação real, listagem posterior e download integral; execução repetível com o acesso da empresa.
3. **Desenvolvimento:** conector comprovado, estado durável, ingestão/eventos e tela de acompanhamento; feature flag inicialmente desligada.
4. **Testes isolados:** cortes de data/mês, cota compartilhada, paginação, sessão expirada, timeout após criar pedido, concorrência, reinício após download, ZIP parcial/corrompido, resultado vazio, duplicata, CNPJ/modelo incorretos, cancelamento antes/depois da nota e competência fechada. Testes automatizados não chamam a SEFAZ.
5. **Piloto assistido:** comparar todas as partes do pedido e o conjunto de chaves/XMLs com o extrator. Repetir a importação sem duplicar receita e comprovar retomada após interrupção. A nota nova de teste deve ser elegível na fonte; ausência de documento recente não é falha do parser.
6. **Revisão do usuário em dev:** só anunciar captura automática após ciclo completo sem upload manual e renovação de acesso comprovada. Publicação em produção será uma etapa própria.

Próxima dependência concreta: acesso autenticado ao extrator de um estabelecimento piloto. Nenhuma dependência do nome do emissor para começar pelo RJ. Nenhum endpoint foi presumido e nenhuma consulta fiscal foi disparada nesta pesquisa.
