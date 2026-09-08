# Validação da conversa do WhatsApp

Esta revisão combina regressões de fluxo e contratos com conversas do modelo real. As fixtures são fictícias; não devem ser substituídas por históricos de clientes em um repositório público.

## Falha de compatibilidade reproduzida

Em 08/09/2026, uma saudação com o catálogo completo, Opus 5 e esforço medium falhou com HTTP 400: 19 parâmetros com unions, acima do limite combinado de 16. Converter campos em opcionais ou strings obrigatórias continuou falhando no limite interno de compilação. O mesmo catálogo foi aceito ao reservar a validação do schema de `preparar_emissao` ao servidor e manter as demais ferramentas strict.

Por isso apenas `preparar_emissao` usa `strict: false`. Sua entrada passa por validação de tipos, campos e objetos aninhados antes das consultas; depois passa pelo validador fiscal compartilhado. Campos ausentes não viram zero. A função apenas cria uma pendência: a emissão continua dependente da confirmação por código, das permissões e da autorização verificadas pelo servidor.

A Anthropic descreve tanto limites agregados quanto limites internos e recomenda strict seletivo quando necessário: [structured outputs](https://platform.claude.com/docs/en/build-with-claude/structured-outputs#schema-complexity-limits).

## Comportamento esperado

- Opções na apresentação, com liberdade para escrever o pedido. Um pedido substantivo na primeira mensagem continua para a IA.
- Menu e IA compartilham a reserva da conversa. Mensagens curtas já recebidas podem compor um único pedido.
- Dúvidas e respostas como “sim” preservam a pendência, sem executar. Correções geram novo resumo e código. Confirmação acompanhada de alterações exige nova revisão.
- Guias preservam o identificador do PDF, distinguem situação de pagamento de processamento e competência de vencimento. Valores desconhecidos não se tornam zero.
- A busca de notas considera as emitidas recentemente, antes da captura posterior. Filtros e páginas permitem localizar registros fora da primeira lista.
- A resposta reconhece entregas parciais e só anuncia encaminhamento depois de registrá-lo.

## Repetir a avaliação

Na raiz do repositório:

```sh
node --test apps/api/scripts/eval-whatsapp-conversacao.test.mjs
node apps/api/scripts/eval-whatsapp-conversacao.mjs --dry-run --output /tmp/whatsapp-plano.json
node apps/api/scripts/eval-whatsapp-conversacao.mjs --live --schema-only --output /tmp/whatsapp-schema.json
node apps/api/scripts/eval-whatsapp-conversacao.mjs --live --output /tmp/whatsapp-conversas.json
```

O modo live usa a configuração do ambiente e exige chave já configurada. Tem teto de 120 chamadas e US$ 5 estimados por execução, com reserva anterior a cada chamada. `--cases` seleciona cenários. `--code-root`, `--runtime-root` e `--tools-json` permitem avaliar uma revisão numa pasta temporária sem substituir arquivos da aplicação ativa. Não coloque chaves em argumentos ou relatórios.

O runner usa o cliente e o prompt reais, mas suas funções operam apenas em memória. Registra mensagens, chamadas, resultados, entregas fictícias, pendências, latência e uso. Não guarda raciocínio interno e não chama WhatsApp, Receita ou emissores fiscais. Registre a revisão avaliada junto aos resultados; conserve um baseline para repetir os mesmos cenários após cada ajuste.

Os verificadores de estado precisam ser complementados por um avaliador independente das transcrições: pedido atual, continuidade, ação correta, clareza e próximo passo. Uma promessa de entrega sem entrega, valor inventado ou ação indevida reprova o cenário, mesmo com texto natural. Essa combinação segue [Anthropic sobre avaliações](https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents) e [τ-bench](https://arxiv.org/abs/2406.12045).

## Limites da prova

Conversas com o modelo e funções simuladas comprovam escolha de ferramentas e comunicação. As suítes de contratos verificam executores reais com dependências isoladas. As suítes de PostgreSQL e outbox verificam persistência e concorrência. Nenhuma delas, sozinha, comprova emissão fiscal real ou entrega a um telefone real; essas operações precisam de ambiente e destinatário de teste próprios.
