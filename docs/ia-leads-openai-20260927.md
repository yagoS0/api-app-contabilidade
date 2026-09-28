# IA para leads — primeira entrega e validação interna

Implementação iniciada em 25/09 e retomada em 27/09/2026 na branch `codex/ia-leads-openai`, a partir de `e645434c4e290007d4b006f731cb04107eea9cb7`. Não publicada nem ativada em produção.

## Decisão de integração

A versão atual já possui pré-atendimento curto, resumo no chat, recibos duráveis, envio rastreado, controle de atendimento humano e identidade por canal. A IA foi integrada nesse caminho, preservando a regra de até três perguntas. O antigo assistente comercial com questionário longo/Anthropic não foi reativado.

Esta entrega usa GPT-5.4 Mini na Responses API para **interpretar intenção, declarações e correções**, com saída estruturada estrita. O servidor continua escolhendo a pergunta, o texto comercial existente e o encaminhamento. **Ainda não é uma versão com respostas comerciais livres geradas pela IA.** Consulta à biblioteca por ferramentas, respostas livres avaliadas, agendamento real e otimização com Nano continuam etapas posteriores do plano.

Referências verificadas: [GPT-5.4 Mini](https://developers.openai.com/api/docs/models/gpt-5.4-mini), [Structured Outputs](https://developers.openai.com/api/docs/guides/structured-outputs). Configuração avaliada em 28/09: `reasoning: low` (comparado com `none`), `store: false`, limite de saída, prazo de 12 segundos, sem retentativa automática. Resultados atuais: [diálogos e custo](avaliacao-dialogos-ia-leads-20260928.md).

## Comportamento entregue

- Interpreta somente a mensagem atual, com intenção, pergunta pendente e resumo mínimo de nome/atividade/cidade/necessidade da própria conversa como contexto. Não envia histórico fiscal, cadastro completo nem conversas de outros contatos.
- Recebe apenas sete campos de triagem: nome, atividade, cidade, necessidade, origem declarada, urgência e preferência de contato. Cada valor precisa de trecho literal da mensagem. Isso reduz inferências, mas não substitui avaliação semântica do modelo.
- Correção substitui o resumo; remoção explícita preserva desconhecimento. Evidências ficam associadas à mensagem de origem e visíveis para a equipe. Uma declaração posterior também vence evidência antiga quando a IA está desligada.
- Os dados interpretados ficam na triagem. Não confirmam cadastro fiscal, vínculo de empresa, proposta, contrato ou pagamento. Quando a IA participa, o extrator antigo não pode gravar nome/atividade/cidade/motivo incompatíveis com a interpretação validada.
- Pausa/retomada não consome pergunta. Dados explícitos nessas mensagens são preservados; retomar com dados completos encaminha à equipe. Solicitação humana, desconhecimento e dúvida sem resposta aprovada também encaminham. Nenhum horário é confirmado.
- Recibos evitam nova chamada em reentregas já processadas. Botões, anexos, navegação e pedidos operacionais não chamam o modelo. O caminho normal conserva os leases e o envio rastreado existentes.
- A aplicação confere pessoa, canal, atendimento humano e versões antes de salvar e de enviar. A interpretação acontece fora da transação; versões são revalidadas após obter os locks.
- Ausência de chave, limite, timeout, recusa, JSON inválido ou evidência inexistente encaminham à equipe. A partir de 28/09, o fallback não preenche novos dados por heurísticas; preserva os dados anteriores e o relato. A equipe vê a indicação de fallback, sem mensagens técnicas no atendimento.

## Consumo e isolamento

A guarda existente aceita modelo/chave específicos por chamada, preservando os padrões do assistente de clientes. Preços Mini: entrada US$ 0,75/M, cache US$ 0,075/M, saída US$ 4,50/M. Tokens de cache são subtraídos da entrada normal para não cobrar duas vezes.

Há uma chamada por interpretação, entrada até 4.000 caracteres e pedido até 24.000 bytes, saída até 1.400 tokens. A reserva considera o limite de entrada em bytes, margem de framing e saída máxima. Consumo desconhecido mantém a reserva. Falha ao registrar o resultado descarta a interpretação. Os tetos do escritório, da conversa e de chamadas diárias continuam aplicáveis.

Nenhuma migration nova. A triagem/evidência usa o JSON existente; o consumo usa `chamadaIa`.

## Ativação posterior

Padrão desligado. Para um piloto futuro, após validar o modelo real e revisar as conversas:

1. Configurar `OPENAI_API_KEY` somente no servidor, por variável de ambiente/cofre. Não colocar em Git, navegador ou conversa.
2. Manter o coletor curto habilitado por `WHATSAPP_COLETA_COMERCIAL=1`.
3. Definir `IA_LEADS_OPENAI=1` e os números internos exatos em `IA_COMERCIAL_TELEFONES_PILOTO`.
4. Manter `INTEGRACAO_IA_COMERCIAL=0`: essa flag antiga pertence ao caminho legado.

Mesmo um canal comercial público exige que o número esteja no piloto explícito para usar OpenAI. Para reverter, desligar `IA_LEADS_OPENAI`; o coletor padrão permanece disponível. Não apagar evidências nem reservas para reativar.

## Laboratório de avaliação

`apps/api/scripts/eval-leads-openai.mjs` usa o mesmo adaptador, contrato, prompt e preparação do pré-atendimento, sem importar banco, transporte WhatsApp ou ferramentas fiscais. O corpus contém 100 conversas fictícias de duas mensagens: 20 abertura, 15 transferência, 15 regularização, 10 preço, 10 correção, 10 humano, 10 isolamento e 10 retomada. Vinte são reservadas. Os 20 cenários críticos podem ser repetidos cinco vezes, totalizando 180 execuções/360 mensagens.

Validação **sem custo**, que verifica estrutura e limites do corpus, sem medir qualidade do modelo:

```powershell
node apps/api/scripts/eval-leads-openai.mjs --dry-run --repeat-critical=5
```

Após autorização de orçamento e configuração segura da chave, executar com teto explícito, por exemplo:

```powershell
node apps/api/scripts/eval-leads-openai.mjs --env-file=.env.openai.local --live --max-usd=0.97 --max-requests=160 --conjunto=desenvolvimento --orcamento=test-evidence/orcamento-autorizado-20260927.json
```

O limite pode interromper o conjunto antes de concluí-lo. Execução incompleta retorna falha e não autoriza liberação. O máximo técnico é US$ 5 e 500 chamadas; isso não constitui autorização de gasto. A autorização da etapa de 27/09 foi US$ 1 total, com US$ 0,03 separados para a conexão inicial e US$ 0,97 compartilhados entre rodadas. O arquivo de orçamento mantém reservas e consumo antes de cada requisição, bloqueia execução concorrente e não aceita mudança do teto. Reservas de chamadas incertas continuam no orçamento. Não há retentativa de erro. A precisão do laboratório é de um milionésimo de dólar; a guarda de produção permanece conservadora em centavos.

Relatório JSON local em `test-evidence`, com transcrições fictícias, expectativas, erros, custo estimado com reservas e hash do prompt/schema. As asserções automáticas verificam extrações e comportamento; **não substituem revisão humana**, nem provam qualidade de linguagem ou segurança semântica. A primeira liberação exige revisar as 100 conversas únicas e resolver falhas críticas. Agendamento real permanece fora deste piloto.

## Testes locais

As suítes específicas verificam contrato e evidências, cache/custo, ausência de chave, timeout, erro HTTP, recusa, saída incompleta, limites, fallback, replay, mudança de canal/ficha, intervenção humana, correções, remoção, pausas e limite de perguntas. A interface verifica evidência, fallback e tratamento de texto como conteúdo, sem executar HTML.

`scripts/run-leads-openai-postgres.mjs` cria cluster próprio em `test-evidence`, recusa porta ocupada, aplica migrations e encerra somente o cluster que criou. Valida os caminhos principal/comercial existentes e a integração com modelo simulado; todas as tentativas de rede externa são bloqueadas. Não é teste da OpenAI real.

Na primeira rodada sob carga, o PostgreSQL ultrapassou os 5 segundos de uma transação existente. As suítes gerais também apontaram testes com timeout, testes estáticos sensíveis a CRLF e um teste de relatório de vencimentos com fixture antiga de parcelas. Esses resultados não foram ocultados nem tratados como aprovação geral. A validação direcionada e a repetição do banco são registradas no resumo de execução.

### Resultado consolidado — 27/09/2026

| Verificação concluída | Resultado | Evidência local |
| --- | --- | --- |
| Interpretação, pré-atendimento e guarda de custo | 166 testes / 5 suítes aprovados | `test-evidence/leads-final.json` |
| Chat e componentes WhatsApp | 257 testes / 34 suítes aprovados | `test-evidence/chat-final.json` |
| PostgreSQL: canal principal | 19 verificações aprovadas | `test-evidence/leads-postgres-1790527785183/principal.log` |
| PostgreSQL: canal comercial | 27 verificações aprovadas | `test-evidence/leads-postgres-1790527785183/comercial.log` |
| PostgreSQL: nova IA simulada | 6 verificações aprovadas | `test-evidence/leads-postgres-1790527785183/openai-simulada.log` |
| Compilação web | Aprovada, com aviso de bundles grandes | `test-evidence/build-web.log` |
| Corpus offline | 100 conversas únicas; 180 execuções/360 mensagens com repetições | `eval-leads-openai.mjs --dry-run --repeat-critical=5` |

Total: **423 testes automatizados aprovados, mais 52 verificações PostgreSQL**. Os oito testes do resumo executados separadamente já estão nos 257; não foram somados novamente. Banco descartável encerrado ao final (`stop.log`). Sem mensagens reais, chamadas OpenAI ou consultas fiscais externas.

A regressão geral foi interrompida após identificar falhas fora do escopo e excesso de carga; portanto, **não há aprovação integral do projeto**. Evidências parciais em `api-inicial.log`, `web.log` e `falha-isolada.json`. O teste de escopo de vencimentos também falhou isoladamente: ainda espera `parcela.findMany`, enquanto o serviço atual usa acompanhamento de parcelamentos. Dois testes estáticos diferem por CRLF (`auditoriaNaoEscreve`, `ofxImportDoCliente`). Nenhum código fiscal foi alterado para fazer essas verificações passarem.

A validação real do GPT-5.4 Mini, os critérios de qualidade de atendimento e o piloto externo **não foram executados**. Passar nos testes com transporte simulado não comprova a qualidade de interpretação do modelo.

### Continuação: conexão e dúvidas — 27/09/2026

- Corrigido o caso em que uma dúvida reconhecida pela IA, sem sinal de interrogação, ainda podia ser capturada pelo extrator determinístico como cidade/atividade/necessidade. A dúvida encaminha à equipe sem gravar esse texto na ficha. Declarações explícitas acompanhadas de evidência continuam disponíveis na triagem.
- Erros HTTP agora distinguem autenticação, permissão, modelo indisponível, saldo, limite e falha do provedor; nenhum corpo de erro ou segredo é retornado.
- Novo diagnóstico `verificar-openai.mjs`: offline por padrão, sem revelar chave/telefones; teste real opcional exige teto explícito e faz apenas uma chamada fictícia, sem retentativa ou ativação do piloto.
- Avaliador e diagnóstico aceitam `--env-file` explícito, carregando somente variáveis desta integração. O arquivo privado `.env.openai.local` foi criado sem chave e conferido como ignorado pelo Git. Variáveis já presentes no ambiente têm prioridade.
- Guia de configuração: [conectar-openai.md](conectar-openai.md).

**Resultado desta rodada:** 194 testes de API em seis suítes (`test-evidence/leads-conexao.json`), sete testes dos utilitários (`test-evidence/conexao-cli.log`) e 53 verificações PostgreSQL (19 principal, 27 comercial e sete IA simulada) aprovados. Evidência de banco: `test-evidence/leads-postgres-1790546619259`, encerrado ao final. As suítes web não foram repetidas porque não houve alteração na interface nesta continuação; os 257 testes da rodada anterior permanecem como evidência daquela versão da tela. Os totais desta seção substituem os da API/banco anteriores, não se somam a eles.

Verificação local do ambiente: chave ainda ausente, automação desligada e nenhuma chamada externa realizada. A avaliação paga e a publicação continuam pendentes.

### Chave e avaliação real — continuação de 27/09

O usuário configurou a chave e autorizou US$ 1 total. Conexão real confirmada; automação e piloto permanecem desligados. Foram feitas 668 chamadas fictícias, com estimativa conservadora total até US$ 0,543770. A rodada final cobriu 100 casos únicos/180 execuções: 172 passaram automaticamente. Os 20 casos reservados passaram, mas a revisão identificou limitações além das asserções. Detalhes, falhas e custos: [avaliação real](avaliacao-real-ia-leads-20260927.md).

Corrigidos o preenchimento de profissão como nome pelo extrator antigo, encaminhamento precoce por intenção genérica e preservação de contexto. Adicionada regra de encaminhamento para solicitações de identidade/acesso de terceiros mesmo com classificação incorreta da IA. Validação atualizada: 206 testes API, nove CLI e 55 verificações PostgreSQL aprovados; banco encerrado. A regra nova também foi reaplicada às 180 execuções gravadas, sem novas chamadas.

Os registros anteriores desta página são históricos. Esta seção substitui o status de chave ausente e avaliação não realizada; não constitui liberação do atendimento a clientes.

## Pendências para liberar

**Estado atualizado em 28/09:** a rodada principal teve 108/108 aprovações e os três casos adicionais tiveram 15/15 após correções. O corpus anterior teve 99/100; a ocorrência restante foi corrigida e verificada offline e em cinco conversas completas com modelo real. Passaram 437 testes API, nove de interface, 13 CLI e 55 verificações de banco. Consumo conservador adicional de US$ 1,708607; média principal de US$ 0,003915 por pré-atendimento. [Relatório completo, limites e exemplos](avaliacao-dialogos-ia-leads-20260928.md). Chave configurada; piloto, automação e produção continuam desligados/não publicados.

- Usar a [avaliação de 28/09](avaliacao-dialogos-ia-leads-20260928.md) como estado atual das correções, da qualidade e do orçamento. As contagens e falhas de 27/09 acima são históricas.
- Revisão da equipe dos exemplos e dos relatos de falha. O Codex revisou os resultados, mas isso não substitui aceite humano. Qualquer nova calibração deve usar desenvolvimento; manter casos separados para validação sem ajustar o prompt a partir deles.
- Homologar com números internos autorizados e observar métricas antes de liberar clientes reais.
- Implementar e avaliar as próximas fases: biblioteca comercial por ferramentas e resposta natural; agenda somente com integração real e confirmação persistida.
- Concluir a regressão geral em ambiente estável/Node 20. O ambiente local disponível usa Node 24.19, enquanto a API declara Node 20.x.

