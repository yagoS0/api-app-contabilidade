# Avaliação real da IA de leads — 27/09/2026

Autorização: US$ 1 no total. A chave privada configurada pelo usuário funcionou com GPT-5.4 Mini. Os US$ 10 informados são saldo da conta; não ampliam o orçamento desta sessão. Não houve publicação nem envio de mensagens a clientes.

## O que foi corrigido

- O pedido genérico de regularizar a empresa podia ser interpretado como problema já suficientemente explicado e encaminhar sem pergunta de contexto. Agora o fluxo mantém a pergunta curta.
- A regra antiga de preenchimento podia gravar “Vou produzir jogos digitais” como nome enquanto a IA identificava atividade. Com uma interpretação válida, campos de triagem passam a depender da evidência correspondente; o extrator antigo não pode preencher outro campo por suposição.
- A IA confundia insatisfação com o contador anterior com reclamação do atendimento atual e perdia o motivo da troca. O contexto e a orientação de extração foram refinados.
- Relatos de regularização perdiam partes do pedido. A orientação agora preserva a frase e sua incerteza, sem transformá-la em diagnóstico ou contratação.

O corpus não foi alterado para fazer a avaliação passar. Os ajustes do prompt usaram somente os 80 casos de desenvolvimento. Os outros 20 ficaram reservados para a rodada final.

## Rodadas e evidências

| Rodada | Resultado automático | Chamadas | Consumo estimado |
| --- | --- | --- | --- |
| Conexão inicial | Aprovada | 1 | Até US$ 0,01, arredondado para cima |
| Desenvolvimento inicial | 60/80 | 147 | US$ 0,096284 |
| Desenvolvimento após correções | 77/80 | 160 | US$ 0,126720 |
| Validação final | 172/180 execuções; 95/100 casos únicos sem falha | 360 | US$ 0,310766 |

**Total: 668 chamadas, estimativa conservadora de até US$ 0,543770**, incluindo US$ 0,01 para a conexão inicial. O laboratório registrou US$ 0,533770 e nenhuma reserva pendente. O limite de US$ 1 foi respeitado; não é necessário consumir todo o orçamento.

Os 20 casos reservados passaram automaticamente: 36 execuções contando repetições críticas. Isso não equivale a aprovação semântica integral. Na revisão dos 100 casos únicos, o Codex observou nomes excessivamente longos em algumas extrações, como “Sou o Caetano” e “Eu me chamo Iara”. O conteúdo tem evidência literal, mas ainda precisa de melhor apresentação. A revisão da equipe permanece pendente.

### Falhas da rodada final e tratamento

- Quatro das cinco repetições de `isolamento-03`: pedido para mudar vínculo para a empresa de outro contato classificado como dado comercial. Acrescentada regra no aplicativo para encaminhar pedidos explícitos envolvendo identidade/acesso de terceiros e impedir a captura desses dados, independentemente do modelo. Nenhum vínculo foi alterado pelo ensaio.
- `transferencia-04`: “O atendimento demora demais” encaminhou à equipe, mas perdeu o motivo no campo necessidade. Continua pendente de aprimoramento; a mensagem original permanece no histórico.
- `retomada-07`, `abertura-08` e `transferencia-08`: resposta rejeitada pelo contrato de evidências. O adaptador não liberou o conteúdo inválido. O caminho de fallback tem testes internos, mas essas ocorrências continuam sendo falhas de qualidade do modelo.

A proteção nova foi verificada em testes unitários, PostgreSQL e reprodução offline das 180 execuções gravadas (`replay-aplicacao.json`). As cinco variações gravadas de `isolamento-03` passaram a encaminhar sem preencher necessidade. Essa reprodução não fez novas chamadas e não altera a nota original de 172/180. Não houve nova calibração do prompt após observar os casos reservados.

A primeira aprovação automática era insuficiente: não detectava campos extras preenchidos incorretamente. A avaliação final também verifica evidência por campo, limite de perguntas e respeito a pausa/retomada/encaminhamento. Os 60/80 iniciais não são uma medida integral de qualidade.

Evidências locais em `test-evidence`: `openai-conexao-real.json`, `eval-leads-1790549540376/resultados.json`, `eval-leads-1790549797755/resultados.json` e `eval-leads-1790549965003/resultados.json`. O registro compartilhado de gastos é `orcamento-autorizado-20260927.json`.

## Testes internos

- 206 testes API, seis suítes: `leads-real-final.json`.
- Nove testes dos utilitários: `laboratorio-cli-final.log`.
- 55 verificações de banco descartável: `leads-postgres-1790550282463` (19 principal, 27 comercial, nove integração simulada). O banco foi encerrado ao final.
- A tela não foi alterada nesta rodada; a evidência anterior permanece em `chat-final.json`: 257 testes de WhatsApp. Não houve nova validação visual nesta sessão.

Uma primeira reexecução PostgreSQL falhou porque o modelo simulado não declarava o nome/atividade presentes na mensagem, mas o teste esperava que o extrator antigo os completasse. A fixture foi corrigida para declarar os dados com evidência, e foi acrescentada a regressão de profissão confundida com nome. A execução final passou.

## Consumo e limites

O laboratório reserva US$ 0,03 antes de cada chamada e ajusta o valor pelo uso retornado, com arredondamento para cima em milionésimos de dólar. O orçamento persistente impede que novas rodadas reiniciem a contagem; consumo desconhecido mantém a reserva. Não há repetição automática de erro.

Foi reservado um teto compartilhado de US$ 0,97, deixando US$ 0,03 para a conexão inicial. Valores são estimativas pela [tabela oficial do modelo](https://developers.openai.com/api/docs/models/gpt-5.4-mini), conferida em 27/09; a cobrança efetiva deve ser conferida no painel da OpenAI. A guarda do aplicativo continua conservadora, arredondando cada chamada para centavos.

## O que esta avaliação não libera

A IA está conectada localmente, com automação desligada e nenhum número no piloto. Ela interpreta mensagens; o aplicativo ainda escolhe respostas controladas. Resposta natural com biblioteca comercial e agendamento real são próximas fases.

Os cenários são fictícios e não provam qualidade em todo tipo de conversa. Ainda é necessária revisão da equipe e homologação com números internos antes de atender clientes. A regressão ampla do projeto segue com as limitações registradas no relatório técnico; os testes locais usam Node 24, embora a API declare Node 20. Não houve aprovação integral do projeto.
