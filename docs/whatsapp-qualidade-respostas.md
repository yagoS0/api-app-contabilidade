# Qualidade das respostas do WhatsApp

O pedido atual termina o histórico enviado ao modelo. A consulta ao banco e o montador excluem mensagens posteriores ao instante dessa entrada. As mensagens carregam data e marcador de histórico/pedido atual; opções interativas preservam seu texto. O cliente da API recusa localmente um histórico que termine em `assistant`.

Saudações depois de um menu recente recebem uma resposta breve sem IA. Pedidos simples de situação fiscal, por botão ou texto, usam a mesma ferramenta e o mesmo envio rastreado de PDF. O transporte revalida sessão, empresa, permissões e janela. Só há confirmação depois de a Meta aceitar o anexo. Não há consulta nova ao SERPRO.

Falhas do modelo, bloqueios de custo/configuração, recusas e respostas incompletas encaminham a conversa para a equipe antes de anunciar o encaminhamento. A gravação é condicional ao escopo e à conversa ainda automatizada. Apenas o aviso deste turno pode passar pelo bloqueio humano recém-gravado; uma pessoa assumindo continua interrompendo a IA. Se o aviso falhar, a fila humana permanece. Pedidos explícitos via `chamar_escritorio` também são persistidos antes da confirmação ao cliente.

`max_tokens` não entrega texto cortado nem executa `tool_use` incompleto. O limite de iterações não reaproveita a frase intermediária anterior ao resultado das ferramentas. As confirmações fiscais por código continuam fora do modelo.

Erros HTTP guardam categoria conhecida, tipo e `request-id` validado. O diagnóstico não copia o corpo do provedor, que pode conter texto do cliente. Erros antigos registrados apenas como HTTP 400 não permitem comprovar retroativamente sua causa. Não alterar modelo/esforço por suposição.

Validação local: suítes de assistente (cliente, serviço, ferramentas, escopo, custo, confirmações e worker), menu e processamento do webhook. Os testes usam transportes e modelo simulados. A qualidade de redação do prompt ainda precisa ser observada no piloto após implantação; testes determinísticos não homologam respostas reais do modelo.
