# Chat no cadastro da empresa — 21/09/2026

## Comportamento

- A conversa continua sendo da pessoa. A ficha limita a lista de contatos no servidor; não cria histórico separado por empresa.
- A seleção de contato usa a identidade da pessoa, preservando a escolha e o rascunho quando a lista muda de ordem.
- Mudar de ficha remonta o chat e as anotações, descartando o estado do cadastro anterior. Respostas assíncronas antigas não podem reabrir outra pessoa.
- O botão **Atualizar conversa** recupera tanto falha inicial da lista quanto a leitura do contato aberto.
- O compositor oferece os canais disponíveis do cliente e guarda um rascunho por pessoa e canal. Leads continuam obrigatoriamente no Comercial.
- A lateral **Detalhes da conversa** contém o mesmo atendimento comercial e passo a passo da central. Canal da etapa e canal do compositor usam a mesma coordenação (`useCanalAtendimento`).
- A biblioteca recebe o usuário da sessão para manter a ordenação de mensagens usadas por atendente.
- Notas são preparadas pelo menu da mensagem. A opção legada de selecionar uma mensagem nas ações rápidas não aparece no chat da empresa.
- **Expandir conversa** remove de fato a segunda coluna; os painéis de atendimento e biblioteca ficam contidos no chat da ficha.

## Guias e documentos

- O menu usa a empresa da ficha, desde que ela conste nos vínculos autorizados retornados pelo servidor, independentemente da empresa selecionada na automação.
- Guias continuam usando a rota da empresa, enviando aos contatos habilitados e exibindo a lista antes da confirmação. O modelo de guia continua disponível fora da janela de resposta.
- Documentos são baixados pela rota autenticada da ficha e enviados pela rota existente de anexo manual, no canal preparado do contato. A legenda identifica a empresa e o documento; o histórico registra o envio como anexo manual da pessoa.
- Não são alterados os vínculos, a empresa escolhida pelo cliente na automação ou as autorizações do servidor.
- Documentos exigem janela aberta e canal disponível. A disponibilidade é conferida de novo após o download, antes de iniciar o envio.
- Falha de download permite nova tentativa; falha incerta após iniciar o envio bloqueia repetição automática e orienta consultar o histórico. Após a conferência explícita, o contador pode preparar outro envio. Essa pendência não bloqueia o envio independente de guias. Cliques simultâneos não iniciam dois envios.
- A versão legada da API continua atendida apenas quando a empresa da conversa corresponde à ficha aberta.

## Validação

Os testes usam dados sintéticos e APIs simuladas, sem Claude/Anthropic, consultas fiscais ou mensagens reais.

Cobertura adicionada: documento de uma empresa quando a automação está em outra; canal escolhido; rascunhos separados; reordenação de contatos; troca de ficha com leitura atrasada; conclusão de envio após trocar de pessoa; recuperação de lista; vínculos autorizados; falha antes e depois do transporte; janela que fecha durante download; canal indisponível; etapa de devolutiva dentro do cadastro avançando até a proposta.

Comando para regressão:

```text
node ../../node_modules/jest/bin/jest.js --runInBand --testPathPatterns='features/whatsapp|anotacoesComChat'
```

Executar em `apps/web`. A revisão visual usa uma fixture local temporária com componentes reais; seus arquivos `qa-chat-empresa-*` não devem entrar no commit.

Resultado da regressão em 21/09/2026: **31 suítes e 222 testes aprovados**, incluindo 14 cenários adicionados nesta revisão. `git diff --check` também não encontrou erros nos arquivos alterados deste escopo.

## Limites preservados

Envios manuais de documentos seguem os formatos e o limite da API existente (PDF, JPEG ou PNG até 5 MB) e a janela da Meta. A autorização final permanece nas rotas do servidor. Esta correção não adiciona envio real em testes nem declara entregue uma mensagem apenas aceita pela Meta.
