# Complemento operacional — jornada e integração das telas

## Autoridade e limites

Ler primeiro a fonte viva `altan-regras-operacionais/REGRAS_OPERACIONAIS.md`; [retrato desta entrega](REFERENCIA_OPERACIONAL_EXISTENTE.md). Este complemento organiza a jornada pedida pelo usuário e os requisitos de implementação; não substitui R01–R24 nem aprova V01–V08. Não especifica alíquotas, obrigações universais por regime ou endpoints SERPRO. Esses contratos exigem documentação oficial e vigência na etapa de implementação fiscal.

O relato original termina incompleto no acompanhamento de guias. Cadência de lembretes, canais obrigatórios, suspensão de cobrança e política de recálculo permanecem sujeitos à fonte viva/decisão de negócio. Não preencher a lacuna com automações inventadas.

## 1. Jornada do Simples Nacional

```text
Notas recebidas/importadas → validação automática
  erro bloqueante → corrigir → validar novamente
  aviso → apresentar ao contador conforme regra
Base válida → apuração automática / consulta prevista → aguarda conferência
Conferência por empresa → aprovar revisão → liberar conjunto revisado
Transmissão → recibo/protocolo confirmado
  recusa → corrigir; resultado incerto → conciliar antes de repetir
Receber guia + extrato → validar separadamente → documentos disponíveis
Complementar guias aplicáveis: folha/pró-labore e parcelamentos com guia
Enviar documentos liberados → acompanhar resultados por canal/destinatário
Acompanhar vencimento e pagamento → informado / confirmado / em aberto
Quando aplicável, recalcular → nova versão → liberação/envio → acompanhar
```

Essa jornada é uma visão de trabalho, não um único enum linear. Uma empresa pode ter DAS transmitido, INSS faltante, guia disponível com falha no WhatsApp e pagamento em conferência simultaneamente. Não reduzir tudo a `Concluído`.

## 2. Contrato por etapa

| Etapa | Entrada / guarda | Evidência de saída | Falha / propagação |
| --- | --- | --- | --- |
| Notas | Empresa, competência, identidade documental e fontes identificadas | Resultado por nota e versão de regras | Erro bloqueia dependência; aviso aparece na nota/central |
| Fechamento da base | Notas e ajustes conferidos conforme fluxo | Versão da base, data, autor/origem e cobertura | Mudança relevante pede revisão |
| Apuração | Base elegível e integração configurada | Snapshot com origem, valor, anexo e revisão | Consulta falha não vira valor zero |
| Conferência | Dados suficientes e divergências tratadas | Aprovação por empresa vinculada ao snapshot | Mudança de base invalida aprovação dependente |
| Liberação final | Conjunto explícito de revisões aprovadas | Identidade do lote e alcance confirmado | Empresa pendente fica fora; mostrar motivo |
| Transmissão | Revisão aprovada, autorização e versão válidas | Protocolo/recibo confirmado no domínio | Timeout incerto exige conciliação |
| Guia | Documento recebido e validado | Versão vigente vinculada à obrigação | Falta de PDF não desfaz transmissão confirmada |
| Extrato | Documento íntegro e empresa/período corretos | Fonte persistida, parsing e conciliação | Erro de leitura mantém documento e pendência |
| Lançamentos | Dados do extrato conciliados e mapeamento contábil válido | Receita/provisão com vínculo à origem | Sem duplicar receita já lançada por outra fonte |
| INSS/parcelas | Aplicabilidade por competência e modalidade | Documento válido ou não exigência fundamentada | Não presumir existência de folha nem de guia |
| Envio | Documento vigente, destino e liberação válidos | Resultado por versão/destinatário/canal | Falha não retira disponibilidade documental |
| Pagamento | Evidência com origem e data | Estado financeiro apropriado | Declaração do cliente não equivale à baixa contábil |
| Recálculo | Obrigação elegível, versão e autorização aplicáveis | Nova versão ligada à anterior | Não duplicar dívida, quitar ou reenviar por consequência implícita |

A leitura do extrato deve produzir receita e provisão conforme solicitação, mas o caminho concreto (criação automática ou fila de validação diante de conflito) precisa respeitar os contratos contábeis existentes. Não lançar nova receita se notas/integração já reconheceram o mesmo fato. Documento, parsing e lançamento têm estados separados.

## 3. Dimensões e identidade

Preservar dimensões de R01: aplicabilidade, apuração, documento, comunicação, pagamento, execução e tratamento. Cada evidência identifica escritório, empresa, competência, obrigação e revisão; quando aplicável, estabelecimento, acordo/parcela e período de vencimento. Nomes aqui são conceituais: mapear para o modelo existente antes de criar campos ou migrations.

Toda projeção deve permitir rastrear sua fonte, data e revisão. Origem manual é legítima quando validada e autorizada; não precisa imitar execução automática. Documento manual não comprova transmissão.

## 4. Contadores e invariantes

Para o mesmo conjunto e unidade definida: `E = esperadas`, `D = disponíveis válidas`, `F = E - D`. Garantir `0 ≤ D ≤ E` e nenhuma contagem de revisão substituída. Envio considera versão válida e política de canais; itens com falha podem continuar disponíveis. Pagamento é outro eixo.

Com E conhecido e igual a zero: `Nenhuma guia exigível`. Com expectativa desconhecida: `Exigibilidade a verificar`; não usar denominador inventado. DARF consolidado e guia complementar dependem de V03. Exemplo 3/4 é fixture de quatro itens conhecidos, não regra de Presumido.

Uma guia excepcional deve continuar visível mesmo quando a avaliação anterior indicava dispensa, com conflito ou ajuste rastreável. Parcela de acordo não cobre DAS corrente. Débito automático sem documento retira expectativa de obtenção/envio, não acompanhamento de pagamento.

## 5. Eventos e atualização de superfícies

| Evento persistido | Consumidores a reavaliar | Proteção |
| --- | --- | --- |
| Nota nova, cancelada, substituída ou ajuste de base | Notas, apuração, carteira, central, circular/relatórios dependentes | Revisão e marco; nota antiga importada tarde não é chamada de recém-emitida |
| Apuração calculada/revisada | Apuração, conferência, central, carteira | Não comprova transmissão |
| Transmissão confirmada | Apuração, central, tarefas documentais, carteira | Protocolo não implica PDF processado |
| Guia manual/automática validada | Guias, carteira, central, lote de envio | Deduplicação e versão vigente |
| Extrato conciliado | Lançamentos, circular, relatórios | Origem única do fato e reversão auditável |
| Envio ou falha de canal | Guias, carteira, central, histórico de comunicação | Resultado por destinatário; não perder falha parcial |
| Pagamento informado/confirmado/estornado | Guias, parcelas, acompanhamento, financeiro aplicável | Origem; preservar separação contábil |
| Reabertura | Domínio escolhido e aprovações dependentes | Preservar recibos, arquivos e pagamentos históricos |
| Mudança de regra/exceção vigente | Expectativa do período e todas as projeções consumidoras | Não reescrever passado automaticamente |

A implementação pode usar a arquitetura atual de invalidação/consulta. Não é exigência criar um novo barramento de eventos. Persistir antes de sucesso; ignorar respostas antigas; tratar concorrência no servidor. Repetir comando não repete efeito externo já confirmado. Resultado incerto mantém identidade da tentativa para conciliação.

## 6. Casos que não podem ser simplificados

- **Sem movimento:** sem notas importadas não prova ausência de receita. Avaliar fontes, folha, parcelas, período trimestral e obrigações declaratórias. V05 permanece pendente.
- **Nota posterior:** marcar competência impactada, base anterior, momento da transmissão/fechamento e natureza da alteração. Pedir revisão; necessidade e conteúdo da retificadora são avaliados conforme regra, nunca executados silenciosamente.
- **Reabertura:** distinguir conferência, apuração e fechamento contábil. Validar permissão, versão, resposta e persistência. Reabrir localmente não retifica no órgão.
- **Comunicação parcial:** e-mail com sucesso e WhatsApp com erro conserva ambos. Manter política de sucesso existente até decisão V07b, com falha do canal visível. Não declarar todos os destinatários atendidos se a evidência não demonstra isso.
- **Pagamento:** preservar origem cliente/contador/consulta oficial. A proposta de suspender cobrança ao receber informação depende de V04; não alterar pagamentos legados em massa.
- **Recálculo:** distinguir principal, encargos, vencimento e versão. A versão anterior fica substituída quando confirmado o vínculo, sem desaparecer do histórico.

## 7. Dependências de decisão

| Decisão da fonte viva | Bloqueia qual implementação | Trabalho que pode continuar |
| --- | --- | --- |
| V01 | Política específica de reabertura | Reproduzir defeito, validar contrato de resposta e persistência |
| V02 | Matriz fiscal por regime/atividade/vigência | Organizar UI, inventariar fontes e divergências |
| V03 | Unidade principal com consolidação | Rótulos explícitos e fixtures com unidade conhecida |
| V04 | Confirmação de pagamento/suspensão de cobrança | Exibir origem e mapear consumidores |
| V05 | Critério de ausência de movimento | Diferenciar desconhecido e zero confirmado |
| V06 | Vigência/exceções do débito automático | Rastrear bloqueio de envio e inconsistências |
| V07a/b | Marco de notas, canais e meta de atualização | Separar filtros, erros e recortes existentes |
| V08 | Exclusão/arquivamento de oportunidade | Inventariar vínculos e estados |

Preparar uma decisão concreta com exemplo, alternativa e efeitos antes de pedir validação. Não paralisar revisão visual independente por uma decisão de política pendente. Não afirmar que o usuário aprovou uma política só porque pediu esta documentação.
