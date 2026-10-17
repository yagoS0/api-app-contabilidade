# UX_RULES — contratos de interação

## 1. Princípio de operação

Cada tela deve responder: qual empresa e período estou vendo, qual situação está comprovada, o que falta e qual ação posso executar. A interface apresenta evidências do domínio; não mantém um checklist paralelo que contradiz os dados reais.

Minimalismo significa retirar repetição e organizar decisões. Não significa retirar rótulos, consequências, erros ou dados necessários ao contador.

## 2. Navegação e contexto

Preservar as áreas Anotações, Contabilidade, Fiscal e Documentos, e suas subabas atuais. Empresas é o controle da carteira; Operações é a fila de trabalho entre empresas; detalhe da empresa é a execução e investigação contextual. Evitar replicar configuração completa em cada superfície.

Ao abrir uma pendência da central, levar empresa, competência e filtro. Voltar deve recuperar posição, filtro e seleção válidos. Ao trocar empresa/competência, cancelar ou ignorar respostas antigas e impedir que rascunhos sejam aplicados no novo contexto. Se houver edição não salva, oferecer saída clara com preservação ou descarte explícito.

Competência e vencimento não são intercambiáveis. Em Guias: `Competência: setembro/2026` e filtro `Vencimentos: outubro/2026`, quando aplicável. Guia antiga recalculada continua identificada pelo período original.

## 3. Estado, motivo e próxima ação

| Situação | Texto recomendado | Ação |
| --- | --- | --- |
| Dados sendo consultados | Carregando / Atualizando | Aguardar; evitar execução duplicada |
| Última leitura disponível e atualização falhou | Não foi possível atualizar · última atualização… | Tentar novamente |
| Nenhum registro com consulta bem-sucedida | Nenhuma guia neste filtro | Limpar filtro ou adicionar, se permitido |
| Aplicabilidade conhecida, nenhuma guia exigível | Nenhuma guia exigível | Ver critérios / adicionar guia excepcional |
| Aplicabilidade desconhecida | Exigibilidade a verificar | Completar cadastro / conferir |
| Arquivo recebido, parsing pendente | Processando documento | Ver processamento |
| Documento válido | Disponível | Abrir / enviar |
| Envio enfileirado | Envio em andamento | Acompanhar |
| Falha por canal | Falha no WhatsApp ou Falha no e-mail | Conferir tentativa / tentar novamente |
| Resposta externa ambígua | Resultado a confirmar | Conciliar |
| Pagamento declarado pelo cliente | Informado pelo cliente | Conferir pagamento |

Mensagens devem explicar o motivo conhecido sem expor stack trace, nomes de campos internos ou payload. Detalhes técnicos ficam em registro de suporte com identificador de atendimento.

## 4. Contadores e seleção

O número do cartão e a lista aberta usam o mesmo conjunto, recorte e permissões. `3/4 disponíveis` requer denominador confiável; não inferir quatro apenas porque o regime costuma ter quatro tributos. A lista detalha cada expectativa, documento, envio e ação. Unidade para DARF consolidado depende de V03 da fonte operacional.

Uma falha pode estar em mais de uma fila. Não somar cartões sobrepostos como total de tarefas. Mostrar total geral e número de empresas apenas quando definidos sobre conjuntos distintos e conhecidos.

Seleção explicita `3 nesta página` ou `todos os 42 resultados`. Ao mudar filtros, tratar seleção invisível de forma explícita; nunca executar sobre itens ocultos silenciosamente. Resultado de lote informa sucessos, falhas, recusas e incertos por item, mesmo se o sucesso o retirar do filtro ativo.

## 5. Ações, confirmação e recuperação

- Ação de linha atua naquele item; ação de seção atua na seção; lote declara alcance.
- Confirmações relevantes incluem transmissão fiscal, envio ao cliente, consulta paga, reabertura e exclusão. Reutilizar a política e as confirmações existentes; não criar confirmação para abrir, filtrar ou baixar documento salvo.
- A confirmação mostra empresa, período, versão, quantidade, destinatários/canais quando aplicável e consequência. O botão usa verbo específico: `Transmitir`, `Enviar 3 guias`, `Reabrir apuração`.
- Desabilitar repetição enquanto salva; sucesso só após resposta válida e persistência. Método ausente, resposta vazia e timeout não significam sucesso.
- Falha mantém os dados preenchidos e permite corrigir. Resultado incerto exige conciliação antes de repetir efeitos externos.
- Reenvio restringe item, versão, destinatário e canal. Sucesso anterior não é repetido por um botão genérico de tentar novamente.
- Automação executa somente ações liberadas e sobre a revisão aprovada. Mudança relevante invalida a aprovação dependente.

## 6. Escrita e divulgação progressiva

Preferir `Adicionar guia`, `Ver extrato`, `Conferir pagamento`, `Reabrir fechamento contábil`. Evitar `Processar tudo`, `Marcar vazio` e `Atualizar` quando o efeito não é claro. Ajustar rótulos ambíguos somente após mapear o que a ação realmente faz.

Texto visível deve mudar a decisão, explicar consequência ou resolver erro. Critérios extensos, histórico e cálculos detalhados podem ser recolhidos. Aviso crítico permanece visível junto à ação afetada. Tooltip complementa; não é o único acesso a uma regra necessária.

Exemplo de redução: trocar vários parágrafos repetidos sobre comparação ausente por `Comparação indisponível: período anterior incompleto`, com `Ver cobertura`. Os cartões mantêm seus valores atuais e usam `Sem comparação` apenas onde necessário.

## 7. Formulários e modais

Ordenar contexto → dados necessários → dados opcionais → revisão → ação. Configurações avançadas ficam recolhidas e sinalizam quando contêm valor relevante ou erro. Evitar formulário aberto permanentemente se criar é uma ação eventual.

Modal não deve virar uma segunda aplicação. Para fluxos longos, usar etapas claras no mesmo diálogo ou página dedicada, preservando contexto. Footer permanece alcançável sem encobrir campos. Validação coloca foco no primeiro erro e mantém resumo quando existem vários.

## 8. Permissões

Visibilidade não é autorização. Servidor valida escritório, empresa, papel e revisão em cada operação. Não apresentar ação executável para quem não pode executá-la; quando entender a restrição ajuda, manter ação desabilitada com motivo acessível. Documento não pode ser aberto por URL de outra empresa.

## 9. Contrato de conclusão

Após ação concluída, a linha, a aba, o resumo da empresa e a central concordam, inclusive após recarga. O estado anterior pode continuar no histórico. Um toast de sucesso sozinho nunca cumpre o contrato. Metas temporais de atualização assíncrona dependem da decisão V07b; o tempo de resposta do provedor não é controlado pela interface.
