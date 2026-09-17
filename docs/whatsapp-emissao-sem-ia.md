# Atendimento do cliente com uso de IA apenas quando necessário

## Fluxo implementado

O menu atual executa consultas por identificador sem chamar um modelo. O atalho de emissão apenas enviava uma instrução e deixava a coleta seguinte para a IA. A preparação também não recuperava o tomador salvo nem os dados tributários usados no portal.

O menu agora conduz uma coleta persistente, sem modelo, usando as funções compartilhadas: memória do tomador por empresa/documento, CNPJ com fonte pública alternativa, CEP parcial e leitura fiscal anterior à confirmação. A ferramenta `preparar_emissao` também usa essas funções. A emissão continua dependendo do código de confirmação e das autorizações já existentes. Nenhuma emissão é executada na preparação.

`coletaEmissaoWhatsapp` interpreta os campos e decide a próxima pergunta. `EmissaoGuiadaWhatsappService` persiste cada etapa antes da resposta. `ConfirmacaoGuiadaWhatsappService` executa o protocolo de confirmação existente sem chamar o assistente ou reservar orçamento de IA.

## Conversa sem modelo

1. A lista inicial apresenta **Guias em aberto → Emitir nota → Documentos → Outras**, respeitando as permissões. Quatro opções usam lista nativa, pois botões aceitam no máximo três. Situação fiscal, notas, faturamento, recálculo, cancelamento e equipe ficam em Outras. IDs antigos continuam válidos sob as guardas de empresa/versão; o novo atalho de guias inclui todos os vencimentos em aberto liberados, mantendo a seleção/envio de PDFs sem IA.
2. Cliente escolhe **Emitir nota** ou escreve um pedido simples reconhecido, como “quero emitir uma nota”. A primeira mensagem pede **CNPJ/CPF, descrição, valor e data do serviço juntos**. Tomadores salvos continuam disponíveis. Nome e endereço conhecidos não são perguntados novamente.
3. Aceita campos rotulados por linhas, ponto e vírgula ou vírgula antes do próximo rótulo; também aceita quatro linhas na ordem documento, descrição, valor e data. Respostas separadas continuam funcionando. A mensagem seguinte reúne somente as lacunas; dado inválido é corrigido sem descartar os demais. Valores ambíguos não são adivinhados.
4. **Data** e **data do serviço** correspondem à competência do emissor em lote. DD/MM/AAAA preserva o dia; “hoje” usa o dia em São Paulo. MM/AAAA e “mês atual” continuam aceitos, sem inventar o dia. Com dois ou mais perfis fiscais, oferece os nomes configurados pelo contador; um perfil único é automático.
5. Funções completam os dados. CEP resolve município, rua e bairro; número/complemento do imóvel vêm da memória ou do cliente. Pergunta-se somente o que continua faltando. Não se consulta CPF em base externa.
6. Cadastro e histórico local fornecem regime, serviço e tributos, seguindo a resolução do emissor e a regra do portal. Configuração fiscal ausente gera encaminhamento com os dados já coletados, sem pedir percentuais ao cliente.
7. Sistema mostra o resumo, inclusive a competência usada na fonte tributária, e oferece **confirmar, corrigir ou desistir**. Só o mecanismo existente de `CONFIRMAR <código>` autoriza o ato fiscal.
8. Após execução, mostra o resultado real. Falha ou resultado indeterminado não pode ser anunciado como sucesso nem reemitido automaticamente.

Esse percurso não consome tokens de IA. Eventuais custos do canal WhatsApp continuam separados.

## Retenção mencionada pelo cliente — 16/09/2026

Avisos como “essa nota tem retenção”, “tem ISS retido”, “o cliente vai reter 5%”, “IRRF: 15,00” e correções negativas como “na verdade é sem retenção” interrompem a coleta e encaminham para o contador. Funcionam no primeiro pedido, nas perguntas, na revisão e em uma coleta pausada. Não dependem de dois-pontos, interrogação ou IA. A retenção não é decidida pela detecção de palavras: ela apenas identifica uma informação fiscal que precisa de conferência.

O código antigo é invalidado antes de gravar o encaminhamento; falha no recibo não o reativa. O rascunho guarda `observacaoRetencao` com a mensagem original, os impostos apenas **mencionados** e `conferida: false`. Preserva os campos anteriores e aproveita campos explícitos válidos recebidos junto do aviso. Trechos ambíguos permanecem no texto original para o contador, sem virar alíquota, valor retido ou descrição do serviço.

O cliente recebe a confirmação de que os dados foram guardados. Se não mencionou o imposto, pode informar qual é ou enviar a orientação recebida do tomador; não precisa calcular tributos. A conversa fica em atendimento humano pelo mecanismo existente do menu. Retomar o mesmo pedido não apaga a observação; “nova emissão” começa outro rascunho vazio, preservando o histórico. O contador confere a operação e prepara uma nova revisão antes da emissão. Este ajuste não automatiza incidência fiscal nem cria uma tela de aprovação da retenção.

Descrições como “retenção de clientes”, “retenção de talentos” e “retenção de líquidos” continuam sendo serviços; um aviso de ISS/IRRF na mesma mensagem continua encaminhando. Tributos mencionados nunca são inferidos do CNAE nem aplicados automaticamente. Testes de conversação bloqueiam Anthropic; o verificador PostgreSQL cobre o aviso persistido, reentrega e falha no recibo com código cancelado.

## Quando cada caminho atende

| Situação | Caminho |
| --- | --- |
| Clique no menu, documento digitado, valor, competência ou opção de perfil | Regras e funções do sistema |
| Dado já salvo ou consulta pública de CNPJ/CEP | Leitura direta, sem modelo |
| Dúvida simples sobre a coleta ou competência | Explicação fixa e última pergunta |
| Pedido de outro assunto ou conversa livre após pausa | Roteamento existente do chat; se a IA estiver indisponível, equipe |
| Decisão tributária, alteração fiscal, negociação ou solicitação de pessoa | Contador, com resumo da coleta |
| Correção objetiva durante a revisão | Atualiza o rascunho e substitui resumo/código |

Texto livre permanece permitido. Entrar no fluxo não obriga o cliente a repetir números de opções. A IA não é acionada por erro de digitação nem por indisponibilidade de uma consulta; primeiro entram validação, resposta fixa e preenchimento manual. “Pausar” guarda a coleta; “continuar emissão” retoma. Trocar de assunto cancela a autorização pendente e preserva os dados. A biblioteca comercial existente não foi alterada nesta entrega.

## Persistência e implantação

1. Aplicar a migração aditiva `20260909200000_whatsapp_guided_issuance` e gerar Prisma antes de iniciar a API. O comando de produção já executa as duas etapas.
2. `RascunhoEmissaoWhatsapp` mantém dados, origem por campo, conversa/empresa/usuário, corte de automação, versão e validade de 24 horas. `EtapaEmissaoWhatsapp` tem recibo único por entrada. Rascunho, pendência validada e recibo são gravados juntos; falha reverte a transição.
3. O coletor roda sob o lease `ia:conversa`, antes do encaminhamento ao assistente. Vínculo, contato, papel, permissões, janela e atendimento humano são reconferidos antes das leituras e da saída. Versão otimista evita sobrescrever outra etapa; cliques de versões antigas são recusados.
4. A correção invalida o código antes das consultas. Somente uma mensagem textual `CONFIRMAR código` pode reservar o ato; mensagem anterior ao resumo ou acompanhada de correção não autoriza. A resposta final fica persistida na ação para recuperação após reinício. Reserva sem desfecho exige conferência humana e nunca é repetida automaticamente.
5. O piloto usa `INTEGRACAO_WHATSAPP_MENU` e as listas já autorizadas de empresas/telefones. Não amplia o piloto nem altera o teto de IA. O percurso guiado funciona com a IA desligada. Recibos registram motivos das transições, permitindo medir conclusão e encaminhamento sem ler conteúdo privado.
6. Não há mudança no frontend. O histórico mostra dados fornecidos, tomador recuperado, perguntas e resumo; encaminhamentos do coletor incluem os dados já coletados. Não foi criado painel para editar rascunhos nem alterado o fluxo comercial.

## Critérios de aceite do coletor

- Tomador conhecido + serviço + valor + competência chega ao resumo sem modelo e sem pedir tributos.
- CNPJ novo com cadastro completo funciona sem pedir nome/endereço; CNPJ indisponível + CEP + número pede apenas eventuais lacunas reais.
- CPF desconhecido permite nome e endereço manuais; CEP continua disponível.
- Corrigir valor, tomador, endereço ou competência invalida o resumo anterior; “sim” isolado não emite.
- Confirmação duplicada, webhook repetido, interrupção/reinício e troca de empresa não duplicam emissão nem expõem dados.
- Atendimento humano, vínculo revogado ou configuração incompleta interrompem o ato, preservando coleta útil para a equipe.
- Testes de conversação usam transportes e modelos simulados, com acesso ao Claude bloqueado. Nenhum teste de desenvolvimento precisa emitir nota ou mandar mensagens reais.

Validação: testes puros do parser, conversação com persistência simulada, ferramentas/validador reais com fornecedores sintéticos, regressão de WhatsApp e script `verify-whatsapp-coleta-postgres.js` no PostgreSQL descartável do CI. Esse script recusa destinos fora do banco local de teste e bloqueia HTTP. Os testes não homologam a resposta de uma prefeitura nem enviam mensagens a clientes.
