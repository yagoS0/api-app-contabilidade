# IA de leads — diálogos, correções e custo

28/09/2026. Trabalho local na cópia `ia-leads-work`, branch `codex/ia-leads-openai`. Sem publicação nem ativação do WhatsApp.

## Resultado

O pré-atendimento passou na rodada principal de **108 conversas completas: 36 cenários, três repetições de cada**. Os três cenários adicionais de retomada passaram em **15 execuções: cinco de cada**, após correções. São **39 cenários únicos** no conjunto ampliado, não 123 situações diferentes. A regressão separada dos 100 casos curtos anteriores teve 99/100 aprovações com modelo real; o caso restante foi corrigido e validado offline e em cinco novas conversas completas com a OpenAI.

A média principal foi **US$ 0,003915 por conversa de pré-atendimento**, aproximadamente **US$ 0,39 por 100** ou **US$ 3,91 por 1.000**, usando GPT-5.4 Mini com esforço `low`. O total conservador desta etapa foi **US$ 1,708607**, dentro dos **US$ 5 adicionais** autorizados. Não foi necessário consumir o teto inteiro.

Esses resultados validam o recorte testado. Ainda não constituem aprovação integral do projeto nem liberação para clientes reais. As respostas são escolhidas pelo fluxo controlado do app; a IA interpreta intenção e dados, sem gerar livremente o atendimento.

## Como foi testado

O laboratório executa o serviço real de coleta comercial, com migrations e PostgreSQL descartável. Cada entrada passa pela guarda de custo, OpenAI, validação, atualização da triagem, escolha da resposta e conferência antes do envio. O transporte final captura o texto em arquivo, sem envio pela Meta. Outras saídas de rede são bloqueadas.

As pessoas, telefones e mensagens são fictícios. A linguagem reproduz situações cotidianas: abreviações, emojis, respostas fora de ordem, correções, pausas, dúvidas de preço, reclamações do contador anterior, empresa parada, mais de um pedido, anexos e tentativas de obter dados de terceiros. Nenhum histórico de cliente foi enviado à OpenAI.

Dos 36 cenários principais, 24 eram de desenvolvimento e 12 foram reservados antes da calibração. Os reservados não orientaram mudanças de prompt. Na rodada principal aprovada, os 12 reservados passaram nas três repetições. Os três casos extras são de desenvolvimento e foram acrescentados na revisão do fluxo e na regressão.

As asserções conferem campos, encaminhamento, resposta única por turno, pausa, limite de perguntas registrado, ausência de promessas específicas indevidas, novos pedidos e reentrega sem nova chamada. Também foram revisados os textos efetivamente capturados e as evidências dos casos problemáticos. A revisão do Codex não substitui o aceite da equipe sobre linguagem, serviços oferecidos e horário de atendimento.

## Correções realizadas

- Nome e cidade deixam de incluir introduções como “sou a Clara” e “em Recife”; a validação conserva trechos literais da mensagem.
- A IA recebe um resumo mínimo da própria conversa para entender respostas curtas e correções. Não recebe outros clientes ou cadastro fiscal completo.
- “Não sei a cidade” não vira uma cidade cadastrada. Dúvidas complexas seguem para a equipe.
- “Meu contador só manda guia” no contexto de troca de contador é tratado como motivo da troca. Pedidos operacionais para enviar ou emitir uma guia continuam no fluxo operacional.
- Reclamações sobre demora/falta de retorno e dúvidas entre fechar ou reativar preservam o relato completo, sem transformar incerteza em diagnóstico.
- O resumo distingue informação extraída pela IA de relato copiado diretamente da mensagem e mostra o trecho que sustenta cada campo.
- Uma falha da IA encaminha à equipe sem preencher novos dados por adivinhação. A tela informa que a interpretação falhou e pede conferência do relato.
- Pausa e retomada podem conter dados. Se a pessoa retoma com tudo preenchido, o atendimento segue à equipe; não fica preso em “podemos continuar”. A pausa explícita ainda é respeitada.
- Em pausa/retomada sem um novo pedido de serviço, uma intenção indevida do modelo é descartada. Nome, atividade e cidade só são aproveitados se passarem individualmente pela exigência de evidência literal. Um novo pedido explícito continua exigindo evidência válida.
- O relato explícito de retomada das vendas/atividades fica no resumo mesmo quando o modelo classifica como dado, mas não extrai a necessidade. O texto é identificado como relato direto, sem confirmar uma ação fiscal.
- A gravação do orçamento do laboratório tolera bloqueios transitórios de arquivo no Windows. Apenas a escrita local é repetida; a chamada paga não é repetida automaticamente.

Valores interpretados continuam pertencendo à triagem. Isso não confirma cadastro fiscal, vínculo de empresa, diagnóstico, proposta ou contrato. A ficha legada pode precisar de conferência humana quando houver correção no resumo.

## Histórico das rodadas

Falhas anteriores permanecem registradas; não foram retiradas para produzir uma taxa artificial de acerto.

| Rodada | Execuções aprovadas | Chamadas OpenAI | Custo conservador da rodada |
| --- | ---: | ---: | ---: |
| Desenvolvimento inicial | 15/24 | 64 | US$ 0,058419 |
| Contexto/prompt ajustados, esforço `none` | 43/48 | 128 | US$ 0,142119 |
| Comparação com esforço `low` | 43/48 | 128 | US$ 0,178361 |
| Primeira rodada ampliada | 103/108 | 285 | US$ 0,540821 |
| Principal após correções | **108/108** | 288 | **US$ 0,422769** |
| Casos extras de retomada, primeira avaliação | 5/6 | 18 | US$ 0,026261 |
| Casos extras após correção | **10/10** | 30 | **US$ 0,043355** |
| Regressão dos 100 casos curtos anteriores | 99/100 | 200 | US$ 0,279628 |
| Retomada das vendas após correção | **5/5** | 10 | **US$ 0,016874** |
| Total desta etapa, incluindo calibração | 457 execuções | **1.151** | **US$ 1,708607** |

Na comparação de esforço, ambos tiveram 43/48 aprovações, com falhas diferentes; `low` custou cerca de 25,5% a mais. Essa amostra não demonstra superioridade geral de um modo. O candidato mantido e validado usa `low`, e a melhora final também depende das proteções do aplicativo.

A primeira rodada ampliada teve uma falha de preservação de dúvida, três falhas locais antes da chamada do adaptador e um timeout de API. A hipótese para as falhas locais é bloqueio transitório da gravação do orçamento; o código do erro original não foi capturado, portanto a causa específica não está comprovada. Foram adicionados repetição limitada da escrita e diagnóstico da etapa. Não houve recorrência nas rodadas posteriores. O timeout encaminhou à equipe e conservou a reserva.

O caso extra reprovado tinha nome, atividade e cidade literais, mas trazia uma intenção de abertura com evidência inventada. A validação anterior rejeitou a resposta inteira e encaminhou ao humano. A correção descarta essa intenção espúria na retomada, preservando somente os campos comprovados. A ocorrência original passou na reprodução offline e os dois cenários passaram nas cinco novas repetições.

A regressão dos 100 casos encontrou apenas `inativa-11`: “Vou retomar as vendas no próximo mês”. O modelo classificou como dados, mas não extraiu a necessidade, e o app repetiu a pergunta. Foi acrescentada preservação literal desse relato específico no contexto de regularização. A ocorrência original foi corrigida na reprodução offline; as 100 expectativas de campo/comportamento passaram nessa revalidação e o caso afetado passou cinco vezes no fluxo completo com modelo real. O resultado original de 99/100 permanece registrado; não foi substituído por uma alegação de 100/100 em nova rodada paga.

A rodada principal terminou antes dos últimos ajustes específicos de retomada. Depois deles, as **288 interpretações gravadas da rodada principal foram revalidadas offline e permaneceram idênticas**, e os casos afetados foram executados novamente com modelo real. Não se afirma que todo o conjunto de 39 casos foi rodado junto depois da última edição.

## Custo por lead

“Lead”, nesta medição, significa uma conversa de entrada até o encaminhamento à equipe, incluindo dúvidas e recusas. Não significa cliente convertido ou proposta fechada. A média soma as chamadas de cada conversa e divide pelo número de conversas; não é a média por mensagem nem a média simples entre grupos.

A referência usa somente a rodada principal aprovada, separando o gasto de ajuste do custo operacional. Os casos extras têm frequência artificialmente elevada para investigar regressão e ficam fora dessa média principal.

| Medida | Resultado |
| --- | ---: |
| Conversas / chamadas | 108 / 288 |
| Chamadas por conversa | 2,67 |
| Média por conversa | US$ 0,003915 |
| 95% das conversas custaram até | US$ 0,006132 |
| Maior custo observado | US$ 0,007990 |
| Projeção para 100 / 1.000 conversas semelhantes | US$ 0,39 / US$ 3,91 |
| Tempo médio / percentil 95 da chamada ao modelo | 1,69 s / 2,70 s |

| Grupo de cenários | Execuções | Média por conversa |
| --- | ---: | ---: |
| Abertura, fluxo básico | 21 | US$ 0,004324 |
| Troca de contador | 12 | US$ 0,002874 |
| Regularização/inatividade | 9 | US$ 0,003395 |
| Planejamento tributário | 6 | US$ 0,004376 |
| Resultados e gestão | 6 | US$ 0,004336 |
| Dúvida de preço durante abertura | 6 | US$ 0,005030 |
| Correções de dados | 9 | US$ 0,005019 |
| Pausas e retomadas | 6 | US$ 0,006824 |

Os demais grupos — isolamento, origem, múltiplos pedidos, anexo, reentrega e humano — também entram na média geral e estão discriminados no arquivo de métricas. A mistura de situações do laboratório não estima a frequência real desses pedidos no escritório.

Na rodada principal foram reportados **350.512 tokens de entrada, 35.506 de saída e zero tokens de cache**. Logo, a média não dependeu de desconto de cache. Sem arredondar cada chamada, o cálculo pelos mesmos tokens é US$ 0,003914 por conversa; a diferença vem do arredondamento conservador para milionésimos de dólar. Saída inclui os tokens de raciocínio reportados pelo provedor.

Preços usados: US$ 0,75 por milhão de tokens de entrada e US$ 4,50 por milhão de saída, conforme a [documentação oficial do GPT-5.4 Mini](https://developers.openai.com/api/docs/models/gpt-5.4-mini), consultada nesta etapa. O consumo observado é uma estimativa pelos tokens, não uma conciliação com a fatura da conta.

Não estão incluídos WhatsApp/Meta, hospedagem, banco, trabalho humano, futuras ferramentas, geração livre de respostas, áudio, leitura de anexos ou agenda. Conversas mais longas, mudança de modelo/prompt e novas funções exigem nova medição. A latência acima é apenas da chamada ao modelo, sem a fila e entrega do WhatsApp.

## Orçamento

- Teto adicional autorizado: **US$ 5,00**.
- Consumo com tokens conhecidos: **US$ 1,588607**.
- Quatro reservas mantidas: **US$ 0,12**, incluindo o timeout e três falhas locais anteriores. Não foram liberadas para apresentar custo menor.
- Total conservador: **US$ 1,708607**; margem restante do teto: **US$ 3,291393**.
- O orçamento de 27/09, até US$ 0,543770, pertence à etapa anterior e não foi somado a esta média ou a este teto adicional.

O registro tem 1.154 reservas, mas 1.151 chamadas chegaram ao adaptador externo; as três tentativas interrompidas antes da chamada explicam a diferença. Todas as rodadas reutilizaram o mesmo arquivo de orçamento, sem aumentar seu teto. Os serviços de teste e os bancos descartáveis foram encerrados.

## Exemplos capturados

Trechos abaixo são de personagens fictícios. Os textos da Altan foram efetivamente produzidos pelo app no laboratório.

**Abertura:** “oii, quero abrir uma empresa” → “Como você se chama?” → “sou a Bia 😊” → “Qual atividade você pretende exercer?” → “faço bolos e doces pra festa” → “Em qual cidade a empresa vai funcionar? Se ainda não definiu, tudo bem.” → “em Recife”. O app encaminhou ao contador com Bia, atividade e Recife no resumo. Custo dessa execução: **US$ 0,005804**.

**Troca de contador:** “quero trocar de contador” → “O que você gostaria de melhorar em relação ao contador atual?” → “o meu só manda guia pra pagar e não explica nada”. O app preservou a reclamação, apresentou o acompanhamento oferecido conforme o serviço contratado e encaminhou à equipe. Não tentou emitir uma guia.

**Retomada:** “pera aí, tô dirigindo” → “Tudo bem. Quando quiser continuar, é só escrever por aqui.” → “voltei, sou a Marina, faço fotografia em Recife”. O app encaminhou ao contador com os três dados, sem pedir novamente. Custo dessa execução: **US$ 0,004266**.

As transcrições completas dos **39 cenários**, com as respostas e custos individuais, estão em [conversas do laboratório](conversas-ia-leads-20260928.md).

## Verificações locais e evidências

| Verificação | Resultado | Evidência em `test-evidence/` |
| --- | --- | --- |
| Contrato, coleta, interpretação, custos, falhas e concorrência | 437 testes / 7 suítes aprovados | `leads-20260928-regressao.json` |
| Resumo do pré-atendimento na interface | 9 testes aprovados | `resumo-20260928.json` |
| Configuração, orçamento e cálculo de métricas | 13 testes aprovados | `cli-20260928.log` |
| Banco: principal / comercial / IA simulada | 19 / 27 / 9 verificações aprovadas | `leads-postgres-1790617703579/` |
| Modelo real, rodada principal | 108/108 | `dialogos-1790617417795/` |
| Modelo real, retomadas finais | 10/10 | `dialogos-1790618286732/` |
| Modelo real, retomada das vendas | 5/5 | `dialogos-1790619059802/` |
| Modelo real, corpus anterior | 99/100; ocorrência restante corrigida depois | `eval-leads-1790618602648/` |
| Revalidação sem chamadas pagas | 288 interpretações idênticas, ocorrência extra corrigida e 100 expectativas do corpus conferidas | `revalidacao-20260928.json` |
| Configuração privada | Chave presente, IA/coleta desligadas, nenhum número no piloto | `configuracao-20260928.json` |
| Orçamento compartilhado | US$ 1,708607 conservadores | `orcamento-adicional-20260928.json` |

São **459 testes locais mais 55 verificações de banco** neste recorte; repetições anteriores não foram somadas como testes diferentes. Os 257 testes de chat executados em 27/09 pertencem àquela versão, não são uma nova execução de toda a interface em 28/09.

Rodadas anteriores preservadas: `dialogos-1790615580308`, `dialogos-1790616029460`, `dialogos-1790616284860`, `dialogos-1790616684150` e `dialogos-1790618009706`. Cada pasta contém resultados e logs; as últimas também registram hashes dos arquivos relevantes. A chave não aparece nos relatórios e o arquivo privado continua ignorado pelo Git.

## O que falta antes de atender clientes

1. A equipe revisar os exemplos, os serviços descritos e o horário informado nas respostas; depois homologar em números internos autorizados.
2. Integrar e validar a versão no ambiente de implantação. Os testes locais usaram Node 24.19; a API declara Node 20. A regressão geral anterior ainda tem falhas fora deste recorte, descritas no relatório de 27/09.
3. Implementar e avaliar as fases futuras do plano: biblioteca comercial por ferramentas, resposta natural e agenda real. O custo desta medição não cobre essas fases.
4. Validar separadamente, no Chat completo, a exibição de documentos/guias enviados por modelo — preocupação da auditoria original. Estes testes da IA de leads não comprovam a correção desse problema visual.

O pré-atendimento avaliado está preparado para revisão e homologação interna. A automação permanece desligada e nenhuma mensagem foi enviada a clientes.
