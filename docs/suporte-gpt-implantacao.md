# GPT no suporte

Implementação em DEV, em branch isolada `codex/ia-suporte-gpt-20261009`, baseada na main `fe0b493`. A ativação do GPT e os testes pelo telefone dependem da configuração do piloto. A produção não foi alterada por esta entrega.

## Funcionamento

O suporte usa `gpt-5.4-mini` pela Responses API quando `IA_SUPORTE_OPENAI=1`. A configuração do comercial permanece independente. O adaptador preserva o ciclo das ferramentas existentes e as confirmações fiscais por código. Ele valida argumentos, limita o tamanho do contexto e as rodadas, conserva o raciocínio necessário entre ferramentas e não repete chamadas HTTP automaticamente.

Pedidos naturais chegam ao assistente pelo roteamento já existente. O prompt distingue a empresa emissora da sessão e o tomador informado na mensagem. Para “emiti essa nota de 11.000 para mim da Gusmed”, orienta buscar Gusmed nos tomadores, esclarecer ambiguidades e preparar o pedido de R$ 11.000,00 antes da confirmação. Correções explícitas como “na verdade são 12 mil” suspendem o código anterior; dúvidas não cancelam automaticamente um pedido.

O atendimento humano cria uma pendência durável e um evento de notificação na mesma transação da pausa. A interface mostra Equipe, com Assumir, Resolver e Devolver à IA. Ler a conversa não resolve a pendência. Resolver conserva a pausa; Devolver à IA encerra as pendências e permite atendimento de novas mensagens. O push depende da configuração e inscrição existentes; o aviso do portal permanece disponível mesmo sem push ou se o aviso pela Meta falhar.

Cada rodada OpenAI passa pela guarda comum de custos. O registro mantém tokens, cache, reserva, modelo, finalidade e custo estimado em microdólares. A API de detalhamento agrupa por área, empresa, conversa, modelo e status; a interface apresenta os totais por área. Os tetos existentes continuam conservadores em centavos. Registros antigos conservam a aproximação original, identificada por `legado_arredondado`.

## Preparação do piloto

Aplicar primeiro a migração `20261009180000_suporte_gpt` e gerar o Prisma Client. A migração é aditiva e preserva o histórico de custos e atendimento.

Configurar no servidor, sem incluir segredos em arquivos versionados:

| Variável | Uso |
| --- | --- |
| `OPENAI_API_KEY` | Chave existente do projeto OpenAI |
| `INTEGRACAO_WHATSAPP_IA=1` | Habilita a automação de suporte |
| `IA_EMPRESAS_PILOTO` | IDs das empresas autorizadas |
| `IA_SUPORTE_OPENAI=1` | Seleciona o adaptador GPT |
| `IA_SUPORTE_TELEFONES_PILOTO` | Números exatos em E.164; verificar `5521994400833` no cadastro antes de habilitar |
| `IA_SUPORTE_CANAIS_PILOTO` | IDs exatos dos canais de suporte |
| `IA_SUPORTE_TETO_TOTAL_CENTAVOS` | Teto acumulado positivo em centavos de USD; zero impede chamadas |
| `IA_OPENAI_TETO_COMPARTILHADO_CENTAVOS` | Teto acumulado opcional para suporte e comercial juntos; zero desabilita somente este teto adicional |

Os limites mensais do escritório e da empresa também continuam valendo. Listas vazias impedem o piloto GPT. O vínculo do contato, suas permissões e a seleção de empresa são obrigatórios; cadastrar um telefone no piloto não concede permissões fiscais.

Para interromper toda IA de suporte, desligar `INTEGRACAO_WHATSAPP_IA`. Desligar apenas `IA_SUPORTE_OPENAI` restaura a seleção anterior de provedor e não equivale a desligar toda IA. Pendências humanas e custos permanecem preservados. Não remover a migração para fazer rollback operacional.

## Testes locais

Na raiz do projeto:

```powershell
npm ci --ignore-scripts --no-audit --no-fund
npm run prisma:generate
```

Em `apps/api`, executar a regressão relevante:

```powershell
node ../../node_modules/jest/bin/jest.js --runInBand --testPathPatterns='assistente|whatsapp|atendimentoPush'
```

Em `apps/web`:

```powershell
node ../../node_modules/jest/bin/jest.js --runInBand --testPathPatterns='whatsapp|OfficeNavigation'
```

Na raiz, executar o banco descartável local e a compilação:

```powershell
node scripts/run-suporte-comercial-postgres.mjs 'C:\Users\yagoa\code\.tools\postgresql16\pgsql\bin' --gpt
npm run build -w @contabilidade/web
```

O verificador cria seu próprio banco, aplica todas as migrações e proíbe rede externa no processo de testes. Verifica rollback conjunto da pausa e da notificação, concorrência dos encaminhamentos, leitura sem resolução, isolamento por carteira, reservas concorrentes e precisão dos custos.

## Avaliação com GPT real

O laboratório `apps/api/scripts/avaliar-suporte-gpt.mjs` contém 56 mensagens sintéticas: os 50 casos de emissão, guias, notas, atendimento humano e esclarecimentos, mais seis casos de documento disponível, tomadores duplicados ou ausentes, tentativa de acesso a outra empresa, falta de configuração fiscal e falha de PDF. Usa o adaptador real, mas todas as ferramentas de negócio são simuladas. Nenhuma mensagem vai ao WhatsApp e nenhuma nota é emitida.

O arquivo de ambiente do laboratório precisa conter `OPENAI_API_KEY`; o teto positivo `IA_SUPORTE_TESTE_TETO_CENTAVOS` pode vir do arquivo ou do ambiente do processo, que tem precedência. O teto deve caber no orçamento disponível autorizado para a avaliação. O relatório local conserva custo e reservas entre execuções, bloqueia execução concorrente e interrompe antes de ultrapassar o teto, incluindo reservas. O teto persistido não aumenta ao repetir o comando. Não apagar o relatório para restaurar saldo. Use `--rodada=nome` para repetir os cenários depois de uma correção, mantendo o mesmo relatório e orçamento. Esse relatório de laboratório é separado do registro de chamadas do aplicativo.

```powershell
node apps/api/scripts/avaliar-suporte-gpt.mjs --env-file=C:/caminho/ambiente-laboratorio.env
```

A validação automática verifica ferramentas escolhidas, valor e documento do tomador nos casos inequívocos, além de proibir preparação nos casos ambíguos. Revisar também o texto das respostas e os casos de esclarecimento: passar nesse verificador não substitui avaliação humana da qualidade. Exigir pelo menos 95% de acerto nos pedidos inequívocos e nenhum erro crítico de escopo ou confirmação antes do piloto real.

A chave comercial foi localizada em 10/10/2026 no arquivo privado `.env.openai.local` do checkout `ia-leads-work`, fora deste repositório. Foi carregada apenas no processo do laboratório, sem copiar o segredo para este checkout. A execução real está documentada abaixo.

## Teste pelo telefone

Depois da avaliação real, habilitar o contato e a empresa de teste. Percorrer emissão para Gusmed, troca para 12 mil, consulta de guia, tomador ambíguo, pedido de humano, indisponibilidade da IA e devolução ao automático. Conferir a fila e os custos no portal a cada cenário. Uma emissão real exige teste separado e confirmação fiscal normal.

## Validação em 9 de outubro de 2026

- API: 83 suítes, 2.181 testes aprovados; depois do ajuste de destino do push, 68 testes relevantes passaram novamente.
- Interface: regressão de 43 suítes executada. Um teste novo tinha uma espera insuficiente pelo término da ação; foi corrigido e aprovado. A verificação final das três suítes alteradas passou em 33 testes, e os cinco testes do worker de notificações também passaram.
- PostgreSQL: 188 migrações aplicadas ao banco descartável e seis verificações de integração aprovadas. Auditoria de migrações aprovada.
- Prévia DEV conferida no navegador: fila, assumir, conversa aberta e indicador persistente após leitura. A prévia usa dados fictícios.
- Avaliação paga dos 50 casos e teste pelo telefone: pendentes de configuração, sem consumo de OpenAI nesta entrega.

Evidências locais ficam em `test-evidence`, incluindo `suporte-gpt-dev.png` e o relatório da execução `suporte-comercial-1791572994492/summary.json`.

## Documentação oficial

O adaptador segue o protocolo de [chamadas de funções](https://developers.openai.com/api/docs/guides/function-calling) e utiliza o modelo e os preços de [GPT-5.4 mini](https://developers.openai.com/api/docs/models/gpt-5.4-mini), consultados em 9 de outubro de 2026.

## Avaliação real de 10 de outubro de 2026

Teto escolhido para esta autorização: US$ 1,00, somando todas as rodadas. A mesma chave do comercial foi aceita pela API. O modelo permaneceu `gpt-5.4-mini`; os preços foram reconferidos na documentação oficial. Os valores do laboratório são estimativas calculadas pelo consumo retornado pela API; a cobrança definitiva é a da OpenAI.

A revisão das respostas encontrou problemas que a checagem inicial de escolha de ferramenta não detectava: exemplos/códigos de confirmação inventados e promessas de encaminhamento sem a chamada efetiva. Também houve uma solicitação explícita de atendente ignorada pelo modelo. As correções incluem:

- Explicação de confirmação sem código inventado: códigos citados precisam constar no contexto ou na preparação. Se surgir um código desconhecido, a resposta remete ao resumo oficial do sistema.
- Frases inequívocas pedindo uma pessoa acionam a ferramenta de encaminhamento diretamente, sem consumir tokens. Outras formulações continuam sendo interpretadas pelo modelo.
- Falta do PDF da guia aciona a transferência; uma promessa textual de encaminhamento reconhecida pelo adaptador também exige executar a ferramenta antes de responder.
- O laboratório verifica os códigos, os identificadores de envio e o encaminhamento após falha de PDF. O verificador foi corrigido para distinguir a expressão comum “confirmar se” de uma instrução com código.

Os testes de regressão das alterações passaram em quatro suítes, 116 testes. Um teste separado, sem rede e com chave fictícia, comprovou que um teto insuficiente interrompe a execução antes de qualquer chamada externa. Os registros de todas as tentativas reais permanecem no mesmo relatório, sem zerar o consumo entre rodadas.

Resultado final: **56/56 cenários aprovados** na rodada `validada`, com revisão dos textos e chamadas. Sete solicitações explícitas de humano foram resolvidas pela regra direta; os outros 49 cenários usaram a API real. Os dez pedidos completos interpretaram Gusmed como tomador e o valor como R$ 11.000,00. Tomadores duplicados/ausentes exigiram esclarecimento; a tentativa de consultar outra empresa não enviou documentos; a falha de PDF acionou `chamar_escritorio`.

Foram 218 execuções de cenários ao longo de quatro rodadas (incluindo falhas anteriores e repetições). Custo estimado total: **US$ 0,394151**, incluindo **US$ 0,096353** da rodada validada. Teto US$ 1,00; saldo US$ 0,605849; nenhuma reserva incerta remanescente. As rodadas antigas permanecem no relatório para auditoria; seus critérios eram menos completos e não representam a aprovação final.

Evidências: `test-evidence/avaliacao-suporte-gpt.json`, `test-evidence/suporte-gpt-regressao-final-20261010.log` e `test-evidence/guarda-orcamento-suporte-20261010.json`. A aprovação se refere a este conjunto sintético; conversas longas, correções em sequência e entregas reais precisam do piloto supervisionado.

Esta avaliação usa ferramentas fiscais, documentos e encaminhamentos simulados. A persistência da fila e dos avisos foi validada nos testes locais com PostgreSQL registrados acima; o envio real pelo WhatsApp e a recepção do aviso no telefone ainda dependem do piloto. Nenhuma configuração de produção foi alterada por esta avaliação.
