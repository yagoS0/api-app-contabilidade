# Política de risco e aprovação

Esta política governa o desenvolvimento; não altera regras fiscais ou contábeis.
A autorização do usuário para implementar esta governança cobre arquivos, testes e
documentação locais. Publicação, atos externos e mudanças de negócio pendentes são
ações distintas. Decisões anteriores só valem para o escopo em que foram concedidas.

| Risco mínimo | Exemplos | Revisão e decisão |
| --- | --- | --- |
| low | Texto sem regra/comportamento | Revisão do escopo; testes quando pertinentes |
| medium | Interface ou serviço local compatível | Revisor de domínio/técnico independente; UI/UX se tela |
| high | Contabilidade, fiscal, autenticação, dados, contratos compartilhados, CI/governança | Revisores dos afetados + sistêmico; aprovação humana na integração |
| critical | Destruição de dados, mudança de permissões sensíveis, ato fiscal, envio/cobrança real | Preparar plano/testes/rollback; decisão humana explícita para a ação real |

O classificador estabelece um piso por caminho, não compreende semântica nem concede
aprovação. Ele deve ser elevado quando o conteúdo exigir. Até uma alteração em docs
pode ser critical se redefinir autorização de produção. Caminho desconhecido bloqueia
o gate de impacto até mapear sua responsabilidade; não inserir regra universal para
silenciar o bloqueio. Mudanças AGENTS/CLAUDE são de governança mesmo em subpastas.

Fluxo: inventário → mapa de impacto → plano → implementação pequena → testes →
revisões independentes → correções → revisão sistêmica → entrega revisável → decisão
humana aplicável. Apenas etapas realmente concluídas podem ser marcadas concluídas.
Um domínio afetado entrega parecer antes da integração; não é necessário pedir
permissão humana para cada inspeção ou correção reversível já autorizada.

Não há votação: defeito crítico/alto fundamentado impede aprovação técnica; divergência
recebe cenário reproduzível. Duas rodadas sem convergência levam ao usuário com opções,
consequências e recomendação. Escopo adicional volta ao mapa. Um único escritor por
arquivo; revisores não corrigem sua própria revisão. Parecer identifica base e diff;
alteração posterior exige renovar a revisão afetada. Não inventar revisores, identidades,
testes ou aprovações. Sem subagentes disponíveis, registrar a revisão como pendente.

AGENTS.md e perfis são instruções, não fronteiras de segurança. Os agentes herdam
permissões da sessão. O gate confere estrutura e declaração de impacto; não autentica
pareceres, não comprova testes declarados e não impede administrador de alterar CI.
Proteção de branch, revisão humana nativa e proteção dos próprios workflows precisam
ser ativadas no GitHub. Não armazenar booleano `humanApproved` como substituto disso.

Antes de merge/publicação: conferir diff final e SHA revisado, checks obrigatórios,
decisão humana aplicável, plano de implantação e reversão. Testes usam mocks e banco
descartável. Jamais disparar worker, consulta paga, envio ou transmissão real como teste.
Não remover validações existentes para passar gates. Falha anterior deve ser isolada
com evidência e reportada; não transformar teste falho em aprovação.


## Decisão de adoção permanente — 16/10/2026

O usuário autorizou tornar o Orquestrador Principal a única interlocução e acionar
automaticamente executores e revisores. O Principal faz a coordenação; não transfere
ao usuário a escolha de especialistas, descoberta dos módulos ou execução dos gates.
O runtime implementa essa sequência e persiste evidências; instruções isoladas não
comprovam execução. Mudanças do próprio runtime recebem revisão independente.
Planejador/revisor não executam atos operacionais. Testes são executados pelo controlador
com catálogo carregado antes do executor. Não aceitar texto de agente como prova de teste.

## Integração autorizada — 16/10/2026

O usuário autorizou concluir a integração desta governança e avançar as proteções
do GitHub. O Principal prepara a branch e o PR, verifica CI e preserva proteções
existentes. Essa autorização não homologa V01–V08 nem publica a entrega funcional
em desenvolvimento. Não usar bypass para resolver falta de revisão humana exigida.

### Aprovação humana no projeto individual

Em 16/10/2026, após esclarecer que o repositório tem somente um colaborador,
o usuário escolheu aprovar pelo Orquestrador no chat. GitHub exigirá PR e checks,
sem aprovação de uma segunda conta. O Principal registra a autorização humana
aplicável e não confunde parecer de IA com essa autorização. Não usar bypass de
checks. GitHub não verifica consentimento dado em chat: essa parte é responsabilidade
do Principal e do proprietário. Autorização de integração desta governança já concedida.
