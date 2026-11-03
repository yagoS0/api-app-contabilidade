# R2A — coleta e cálculo automático do Simples

Candidato local sobre `8630808923d0978ce648b2eca8adc3881a8a90bc`.
Implementa o contrato da seção 32 da referência operacional, sem mudar regras fiscais,
regimes, alíquotas, gates ou autorizações. Não publicado nem ativado.

## Caminho funcional

- Rotinas → Configuração oferece agenda matinal dos dias 1 a 8, em Brasília, desligada
  por padrão. O worker `SIMPLES_COLETA_CALCULO_WORKER_ENABLED` exige opt-in de infraestrutura
  e configuração persistida; não foi habilitado nesta entrega.
- Automação da empresa permite selecionar o ciclo e as fontes NF-e/NFS-e. A seleção é
  versionada e auditada no mesmo fluxo existente; não modifica as rotinas padrão
  obrigatórias, a agenda global ou as pausas.
- O worker usa a reserva de janela existente, sem recuperar horários perdidos, e
  revalida pausa geral, empresa, identidade e configuração antes dos efeitos.
- A coleta deve comprovar término. Cursor parcial, erro ou ausência de documentos
  não autorizam receita zero. A coleta final pertinente ocorre no dia 8.
- O núcleo reserva estado durável por empresa, competência e revisão antes das
  chamadas. Cálculo automático tem uma simulação nova; o caminho manual preserva
  seu comportamento. Concorrência e reinício não repetem a reserva de cálculo.
- Resultado confirmado permanece no snapshot de apuração existente e aguarda o
  contador. Não confirma nem transmite automaticamente.
- Ciclo por competência mostra diagnóstico e revisão. Correção explícita registra
  autor, motivo e versão anterior; resultado fiscal incerto não libera repetição.
  Fora da janela, a tela orienta continuar pela Apuração, sem prometer execução futura
  impossível para a mesma competência.

## Limites de elegibilidade

A distribuição NF-e disponível captura documentos, mas não comprova por si só a
integralidade da receita emitida. Essa fonte não libera simulação automática: exige
conferência. NFS-e exige término comprovado e dados fiscais suficientes.

Cadastro fiscal, regime vigente na competência, receitas e classificação devem ser
comprovados. RBT12 parcial, enquadramento ausente, movimento zero não confirmado e
Fator R sem comprovação suficiente permanecem com motivo de revisão. Nenhum default
visual é promovido a autorização fiscal. Não houve consulta real para validar esses
contratos: os testes substituem os transportes por respostas fictícias.

## Evidência e revisão

O primeiro executor entregou fragmento insuficiente; o Principal interrompeu os gates
amplos, preservando o run e suas duas chamadas, e dividiu a conclusão em núcleo,
integração e interface. Não declarou o fragmento aprovado.

Provas focais registradas em `../output/rotinas-simples-20261102/`: configuração,
agenda, ACL, worker, coletores, tentativa única/manual, PostgreSQL descartável com
concorrência e reinício, integração real até snapshot com transporte simulado,
interface, identidade, rascunhos e foco. Contagens de reexecuções não são aditivas.

O Chrome local completou 22 verificações em 390/1440 px, sem rede externa ou erros
JavaScript. Capturas adicionais somente leitura cobrem agenda e cálculo. O ajuste
posterior de motivo mínimo de três caracteres tem delta de hashes e teste focal;
os percursos inalterados foram reaproveitados. A validação ampla e o parecer final
são registrados pelo controlador separadamente; este documento não os substitui.

## Continuação e reversão

Ainda separados: liberação de todas as confirmadas/transmissão, envio completo,
corte parcial/complementos, acompanhamento D−2/D0/D+2, novo design de Operações e
pendências por aba. A pausa anterior permanece aprovada e não foi reimplementada.
Guru em conferência, eNotas ativo, benefício pendente e Sintropia fora da ativação.

Reversão: manter a agenda/worker desligados e reverter o incremento de código
revisado. Preservar registros de tentativa/auditoria; apagar reservas não é reversão
segura. Não há migração de schema nem alteração de dados produtivos nesta etapa.