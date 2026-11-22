# Proposta: evidências para integração sem publicação automática

Status: **candidata, não vigente**. Elaboração autorizada em 22/11/2026; ativação e integração dependem de aprovação específica do proprietário. Não desbloqueia os PRs #307/#308 nem aprova a própria entrega.

## Diagnóstico e autoridade

Base inspecionada: `1bfe21340db796ff668773c1a015ad07da2cce92`.

| Fonte | Exigência efetiva |
| --- | --- |
| [POLICY.md](../../POLICY.md), [README](../../README.md), AGENTS | Diff/SHA, checks, revisão independente, autorização humana e reversão; aprovação técnica não autoriza publicação. |
| `scripts/governance/check.mjs`, `orchestrate.mjs`, `gates.json` | Impacto, testes, papéis e evidências de desenvolvimento. Não consultam Auto Deploy nem executam merge. |
| Ordens do Controller para #305/#306/#307 | Condições operacionais específicas anteriores ao merge. Não são configuração de branch nem gate implementado no controlador. |
| Conector Railway | `describe_service` mostra fonte, configuração, serviço/ambiente, deployment e mudanças preparadas; não expõe os gatilhos de repositório. Ausência desse campo não prova desligamento. |
| Credencial local | Consulta anterior retornou `Not Authorized`; estado do gatilho inconclusivo. Não foi reutilizada nesta investigação. |

A repetição decorre da ausência de contrato para evidência alternativa, somada à confusão entre fonte Git configurada e gatilho automático. A política candidata não transforma falha de acesso em sucesso.

Histórico verificável: [coordenação #305](https://github.com/yagoS0/api-app-contabilidade/pull/305#issuecomment-7027166242) separou integração/publicação; [registro #306](https://github.com/yagoS0/api-app-contabilidade/pull/306#issuecomment-7066471826) aceitou observação expressa do proprietário, identificada como humana, e comparou deployments. #307 não tinha comentários na consulta de 22/11; seu bloqueio consta no chat do Controller e do executor, não se inventa registro GitHub equivalente. A confirmação do #306 não é autorização reutilizável para #307.

Workflows inspecionados: `deploy-digitalocean.yml` é manual (`workflow_dispatch`); `release.yml` e `release-ecr.yml` publicam artefatos por tags `v*`, não por push comum na main. CI/governança executam testes; migrações desses testes usam serviços descartáveis. Isso não comprova inexistência de integrações externas desconhecidas. Aplicativos instalados, isoladamente, não provam um gatilho ativo; investigar evidência concreta de publicação.

## Consulta oficial e acesso mínimo

Fontes oficiais consultadas em 22/11/2026: [API pública](https://docs.railway.com/integrations/api), [OAuth e escopos](https://docs.railway.com/integrations/oauth/scopes-and-user-consent), [membros do projeto](https://docs.railway.com/projects/project-members), [GitHub Autodeploys](https://docs.railway.com/deployments/github-autodeploys) e [consulta de deployments](https://docs.railway.com/integrations/api/manage-deployments).

A introspecção pública, sem token, confirmou a assinatura abaixo no endpoint `https://backboard.railway.com/graphql/v2`. Isto valida o contrato, não o estado privado da Altan. Alternativa disponível: `service(id: String!).repoTriggers(first:, after:)`. O tipo retornado é `DeploymentTrigger`, sem booleano `enabled/disabled`.

```graphql
query IntegrationTriggers($projectId: String!, $environmentId: String!, $serviceId: String!, $after: String) {
  deploymentTriggers(projectId: $projectId, environmentId: $environmentId,
    serviceId: $serviceId, first: 100, after: $after) {
    edges { node { id projectId environmentId serviceId provider repository branch checkSuites validCheckSuites } }
    pageInfo { hasNextPage endCursor }
  }
}
```

Percorrer todas as páginas; conferir escopo de cada nó. `checkSuites` significa espera pela CI, não desligamento. Lista completa vazia sustenta apenas “nenhum gatilho Git encontrado”. Antes de automatizar sua tradução em `disabled`, homologar essa equivalência contra o painel autorizado para o escopo real. Outros mecanismos de publicação não são excluídos por essa query. Campo desconhecido, `errors`, dados parciais ou HTTP 200 com erro não são sucesso. Não foram feitas consultas privadas com a credencial rejeitada nesta pesquisa.

Permissão mínima proposta: OAuth `openid` + `project:viewer`, projeto explicitamente compartilhado e papel de leitura. Viewer não pode publicar ou ler valores de variáveis. A documentação não especifica ACL por resolver: o acesso concreto a `deploymentTriggers` ainda precisa ser homologado com credencial autorizada. Não prometer que o conector atual tenha esse escopo, nem pedir admin/member automaticamente. Tokens de projeto usam `Project-Access-Token`; conta/workspace/OAuth usam Bearer. Não substituir cabeçalhos ou repetir token rejeitado por tentativa. Login/credencial nova somente por mecanismo seguro autorizado, sem segredos no registro.

O painel oficial continua sendo fonte válida: observar Settings → Auto Deploy para cada serviço, sem clicar em Disable/Enable nesta entrega. A declaração humana deve referenciar essa observação. Não se implementou adaptador de API ou OAuth neste candidato.

## Separação de decisões

1. **Merge:** repositório, PR, head, base, método e autorização identificados; CI/checks obrigatórios, proteção de branch e revisões continuam obrigatórios. Usar proteção pelo SHA esperado e reconferir a base imediatamente antes da operação.
2. **Deploy:** exige autorização própria para SHA, projeto, ambiente e serviço. Merge, CI verde ou declaração de Auto Deploy não concedem essa autorização.
3. **Configuração:** alterar gatilho, fonte, variável ou permissão exige autorização própria. Falha de leitura nunca autoriza ampliar acesso, trocar credencial, habilitar/desabilitar serviço ou mudar configuração automaticamente.

## Evidências aceitas — proposta sujeita a aprovação

O Principal valida a identidade e a origem da evidência no canal autorizado. Um JSON com `actor` e `reference` não autentica o proprietário. Não usar `humanApproved: true` como substituto de autorização. Registrar mensagem/comentário original, responsável e momento, sem tokens, cookies, dados de clientes ou valores de variáveis.

Para cada integração registrar: repositório, PR, head esperado, base esperada, projeto/ambiente por ID e nome, inventário completo de serviços ligados à branch, fonte Git/branch, fingerprint dos campos de publicação observáveis e referência das consultas. Incluir serviços novos, não fixar a regra para sempre nos quatro atuais. O inventário do ambiente deve ser consultado antes de cada merge; falha não equivale a inventário vazio.

| Evidência | Requisitos e validade proposta |
| --- | --- |
| Técnica | Consulta oficial autorizada, completa/paginada e sem erros; todos os serviços abrangidos; observação há no máximo 15 minutos. Fonte, identidade, escopo e resultado preservados. |
| Declaração do proprietário | Somente se consulta técnica indisponível/inconclusiva. Declaração explícita, referência verificável, observação no painel, data e responsável, projeto/ambiente/serviços, estado desligado e PR/head/base específicos. Máximo 24 horas desde a observação; vale apenas para a integração nomeada, não para próximos PRs. |

Os limites de 15 minutos e 24 horas são escolhas propostas da Altan, não garantias Railway. Datas precisam conter fuso; futuro, validade malformada ou expirada não são aceitos. Configuração alterada, revogação, origem/branch diferente, serviço/ambiente novo, base/head diferente ou publicação inesperada invalidam a evidência imediatamente, mesmo dentro do prazo. Mudança de CI também exige nova avaliação. Uma prova técnica de gatilho ativo prevalece sobre declaração humana conflitante: interromper e reconciliar sem desativá-lo automaticamente.

A indisponibilidade técnica tem registro próprio: motivo conhecido, referência da falha original e data da constatação, sem repetir credencial rejeitada. Sua reconfirmação por inspeção da capacidade da ferramenta não é uma nova consulta ao estado do Railway. O registro de limitação pode durar até 24 horas e serve apenas para explicar o uso da declaração humana; não prova desligamento. Resultados parciais/erro GraphQL devem ser normalizados explicitamente como indisponíveis com motivo e evidência, preservando qualquer gatilho ativo conhecido. Uma resposta parcial rotulada como sucesso permanece inconclusiva; status arbitrário não libera o gate. SHA, CI e inventário observável continuam exigindo leitura recente independente da limitação de acesso ao gatilho.

No contrato candidato, `technical.status: unavailable` exige motivo conhecido, `originalFailureRef`, `observedAt` da ocorrência original e `registeredAt` da inspeção da limitação. Motivos aceitos: `not_authorized`, `credential_rejected`, `capability_not_exposed`, `transport_error`, `partial_response`, `graphql_error` e `schema_unknown`. Um adaptador futuro deve preservar os estados ativos conhecidos, inclusive em resposta parcial, antes de chamar o avaliador. `available` incompleto permanece inconclusivo e não cai silenciosamente no caminho humano. A verificação de deployments recebe também `mergedAt`, com snapshot anterior ao merge e leitura posterior; só certifica a comparação sintética do intervalo informado.

Não existe registro completo de alterações de gatilhos disponível pelo conector atual. O fingerprint detecta mudanças observáveis, mas não prova que o gatilho permaneceu intocado. A declaração deve afirmar que a observação cobre o estado atual e que não houve mudança conhecida; qualquer indício contrário invalida-a. A janela curta reduz, mas não elimina, esse risco.

Modelo de declaração (a preencher pelo proprietário; não é autorização emitida pelo agente):

> Observei no painel Railway em [instante com fuso] que o Auto Deploy está desligado no projeto [nome/ID], ambiente [nome/ID], serviços [nomes/IDs], fontes [repo/branch]. A confirmação abrange exclusivamente o PR [número], head [SHA], base [SHA]. Não tenho conhecimento de mudança posterior. Referência da observação: [mensagem/captura privada]. Qualquer mudança de publicação invalida esta confirmação. Esta declaração não autoriza deploy ou configuração.

A autorização de merge deve existir separadamente, ainda que na mesma mensagem. Uma condição humana mais restritiva continua prevalecendo até ser explicitamente revista; a política não reinterpreta retroativamente autorizações anteriores.

## Matriz decisória

| Cenário | Resultado candidato |
| --- | --- |
| SHA/base, CI completa, revisão e autorização válidos + prova técnica desligada | Condições documentais satisfeitas para decisão do Principal; não executar automaticamente. |
| Gatilho ativo | Bloqueado, mesmo com declaração humana. |
| `Not Authorized`, timeout, erro GraphQL, campo ausente ou paginação incompleta | Consulta inconclusiva; não afirmar ligado/desligado. |
| Consulta inconclusiva + declaração válida e específica | Aceitar evidência humana como humana, com limitação registrada. |
| Declaração ausente, expirada, outro escopo ou não verificável | Bloqueado. |
| Serviço novo, mudança de configuração, revogação ou indício de deploy inesperado | Invalidar confirmação e interromper. |
| SHA/base divergente, checks faltantes/pendentes/falhos/cancelados ou autorização ausente | Bloqueado, independentemente do Railway. |

## Conferência posterior

Antes do merge, capturar histórico completo desde o início da janela, por serviço e ambiente: IDs, horários, status, SHA quando disponível, motivo/origem quando informado. Registrar também deployments já enfileirados, não apenas o último SUCCESS. A leitura deve ter cobertura completa/paginação e horário de coleta. Se não for possível criar essa referência, registrar pendência antes da integração.

Depois, consultar imediatamente e ao término da CI pós-merge. A documentação informa que Wait for CI pode aguardar até duas horas: quando esse mecanismo não puder ser excluído, incluir conferência após essa janela; encerramento antecipado deve informar cobertura temporal limitada e acompanhamento pendente. Comparar IDs, escopo, SHA e eventos de retomada/status de deployments preexistentes. ID novo não comprova causalidade do merge: interromper a sequência e investigar origem. Deploy já autorizado por outro fluxo precisa de referência própria e análise, sem presumir que é permitido. Consulta falha ou histórico incompleto resulta **monitoramento inconclusivo**, nunca “nenhum deploy”.

O monitor candidato compara inventários completos de IDs; investigação de mudanças de status, causas, SHA e correlação é responsabilidade do Principal. Não cria cron, webhook, automação permanente, cancelamento ou rollback. Registrar período observado; não prometer ausência de eventos futuros. Monitoramento detecta incidentes, não substitui prevenção. Diante de ocorrência inesperada, preservar evidência e informar o proprietário; não cancelar ou reverter produção sem autorização.

## Implementação candidata e adoção

`gate.candidate.mjs` e seu teste são um ensaio puro, sem rede, credenciais, banco ou comandos. Não são importados pelo controlador, não integram gates vigentes e não substituem checks GitHub. O resultado nunca concede autorização operacional nem autentica evidências. Casos sintéticos usam `node --test docs/governance/proposals/integration-evidence/gate.candidate.test.mjs`.

Manter POLICY, AGENTS, runtime, gates e workflows intactos nesta entrega. A menor adoção posterior é incorporar a política aprovada ao procedimento de integração do Principal e ao registro de evidências, preservando o controlador de desenvolvimento. Se for desejada automação executável futura, apresentar adaptadores de leitura e origem autenticada da decisão em incremento próprio; não conectar este ensaio diretamente a uma ferramenta de merge.

Critérios de aceite: todos os cenários de recusa e aceitação sintéticos aprovados; revisão independente de governança/arquitetura, CI/CD e segurança; diff sem alteração produtiva; validade e limites aprovados pelo proprietário; decisão explícita de ativação com versão/data. Não usar este candidato para aprovar a si mesmo ou integrações pendentes.

Rollback da proposta: reverter apenas os novos arquivos; nenhum recurso externo ou regra vigente foi alterado. Após futura adoção, suspender aceitação alternativa e voltar à evidência técnica até revisão, preservando registros antigos. Rollback de política não desfaz merge nem autoriza rollback produtivo.

Impacto operacional do produto: nenhum. Não altera regras fiscais, autorização por empresa, API, frontend, schema, Railway ou dados. Risco de governança alto: declaração desatualizada, origem forjada e corrida entre observação/merge exigem controle humano e rastreabilidade.
