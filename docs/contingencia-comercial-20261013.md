# Contingência do atendimento comercial

Falha do modelo, recusa, resposta inválida ou limite de consumo encaminham o atendimento à equipe. O caso conserva `triagem.preatendimento` e registra `triagem.contingenciaIa`, com estado, código controlado, mensagem de origem e instante. O alerta e o bloqueio da automação são persistidos na mesma transação. Erros brutos do provedor não aparecem em notificações.

O chat mostra **IA indisponível · atendimento humano necessário**, acesso ao resumo e **Assumir conversa**. A lista mantém **Precisa de atendimento**, mesmo depois da leitura. Assumir usa a atribuição existente do servidor e invalida respostas automáticas concorrentes. Ao devolver à automação, a pendência é encerrada sem apagar o resumo; uma falha posterior cria nova contingência.

O evento push `COMERCIAL_CONTINGENCIA` é idempotente por atendimento e mensagem. Seu envio revalida a identidade, o caso aberto, a pendência, as permissões e as preferências do aparelho; ler a conversa não cancela o aviso. A entrega fora do portal exige uma inscrição push ativa. O aviso persistente no chat não depende dessa inscrição.

## Conversas que ficaram sem resposta

Um observador independente do processamento da IA e do inbox verifica o banco a cada 30 segundos. Considera entradas recentes do canal comercial sem resposta há cinco minutos, falha de envio e execução esgotada ou indeterminada. Reconfere identidade, atendimento humano, resposta já registrada e situação do caso sob transação antes de encaminhar. Não reenvia mensagens incertas nem chama GPT/SERPRO. Reações, mensagens antigas, atendimento assumido, canal de suporte e casos encerrados ficam fora.

A janela de observação é de 24 horas. A contingência não recupera mensagens que nunca chegaram ao servidor. Se o envelope chegou, mas a ingestão falhou antes de criar a mensagem e a conversa, o inbox preserva o envelope e suas tentativas; não se atribui um caso sem identidade confirmada.

## Indisponibilidade da infraestrutura

O workflow `atendimento-monitor.yml` verifica `/readyz` (API e banco) e o HTML do portal pelo GitHub, com três tentativas. Após falha, abre um único incidente no repositório, atribuído ao proprietário; fecha o incidente na recuperação. As execuções também ficam com erro. A agenda é de dez minutos, sujeita a atrasos do GitHub Actions; não é um SLA. A entrega externa depende das notificações configuradas no GitHub. O monitor não confirma entrega do WhatsApp nem disponibilidade do GPT.

## Verificação

- Testes unitários e de integração simulam erro/limite da IA, primeiro contato sem intenção, preservação do relato, atribuição humana, leitura, devolução e erro de persistência.
- O teste PostgreSQL `verify-contingencia-postgres.js` executa o observador e as transações em banco descartável, inclusive com comparação UTC independente do fuso do cluster. Provedores externos são bloqueados.
- Testes de interface verificam aviso, resumo, assumir, erro, clique repetido e permanência do histórico. O service worker abre a conversa comercial indicada pelo push.
- `scripts/monitor-atendimento.test.mjs` testa queda, recuperação transitória e resposta HTTP 200 inválida, sem rede.
