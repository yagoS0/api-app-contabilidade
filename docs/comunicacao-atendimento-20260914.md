# Comunicação e atendimento comercial — 14/09/2026

Decisões solicitadas pelo dono, substituindo orientações antigas incompatíveis. A conversa pertence à pessoa identificada pelo número estrito. O histórico apresenta todas as empresas dentro da carteira autorizada. A empresa escolhida no atendimento automático aparece como informação; texto e anexo manual não exigem seleção de empresa. Guias, documentos internos e atos fiscais continuam com escopo, confirmação e permissões próprios. CNPJ é exibido só com números e copia ao clicar.

## Caminho do atendimento

1. Identificar abertura, transferência ou empresa parada. Uma solicitação ativa por conversa. Corrigir motivo ou iniciar outro serviço encerra somente o vínculo de atendimento e cria outra ficha, preservando mensagens, propostas e documentos anteriores. Não oferecer vínculo com empresa existente após classificação comercial.
2. Na abertura, coletar atividade, município/endereço e movimento previsto. Não exigir CNPJ que ainda não existe. Nos outros caminhos, salvar o CNPJ e consultar a fonte pública pelo servidor. Mostrar resultado, fonte, data, razão social, CNAE, atividade e endereço; falha não equivale a cadastro vazio nem regularidade.
3. Enviar orientação da biblioteca sobre Autorização de Acesso da Receita. CNPJ do procurador vem do recurso institucional aprovado; não inventar nem extrair automaticamente de uma minuta incompleta. Conferir identidade/representação, verificar procuração e só então solicitar SITFIS pela fila existente. Não criar PortalClient provisório.
4. Ler a análise salva em tabela e PDF, usando o componente fiscal existente. A devolutiva identifica o que foi encontrado e os serviços necessários; envio exige ação do contador. Uma consulta pública não comprova regularidade fiscal.
5. Aba Proposta comercial: catálogo aprovado, mensalidade, avulsos, regularização e taxas separados. Abertura avulsa e abertura com contabilidade continuam possíveis. Aprovação fixa a versão; aceite prepara contrato baseado em modelo aprovado, com variáveis preenchidas em formulário.
6. Contrato e pagamento: conferir minuta, liberar PDF para assinatura, enviar pela conversa, orientar assinatura gov.br, receber PDF e conferir assinatura. Upload isolado não comprova assinatura. Registrar cobrança e comprovante separadamente.

## Biblioteca e arquivos

Mensagens rápidas abrem à esquerda do chat. Cards mostram título e descrição, busca, prévia e envio explícito. Gerenciar biblioteca compartilhada abre `/biblioteca` em nova aba; modelos iniciais, criação, revisão e aprovação ficam nessa página. Voltar à aba da conversa atualiza a lista. Rascunhos não são mensagens aprovadas. Dez mensagens padrão foram revisadas e configuradas por pedido do dono; ver `biblioteca-mensagens-rapidas.md`. Preços e contratos privados ficam no banco, fora do repositório público.

Formulários de abertura, transferência e empresa parada criam/usam a ficha deste atendimento e geram link pessoal para o formulário público existente. Salvar/finalizar alimenta o onboarding diretamente. Gerar outro link revoga o anterior; preparar o formulário não envia mensagem. Caso já exista solicitação de outra origem, orientar Nova solicitação, sem juntar fichas.

O transporte Meta existente já oferece upload, documento e imagem. O compositor aceita PDF, JPEG e PNG até 5 MB (limite próprio, inferior ao máximo de documento da Meta), confere assinatura do arquivo e MIME no servidor, exibe destinatário/prévia e usa envio rastreado. Não publica URL do documento, não executa importação contábil e não repete automaticamente envio incerto. Aceite da Meta não significa entrega. Janela de 24 horas, contato e acesso são reconferidos antes do transporte. Links HTTPS podem ser enviados como texto.

## Atualização e layout

Lista de conversas mais legível, cabeçalho e compositor compactos. Painel de atendimento com abas sob demanda. Leitura visível a cada 2,5 segundos com conversa aberta e 10 segundos na lista; abas ocultas param. Lista e fio usam relógios independentes, uma requisição por recurso, com respostas antigas descartadas. Não recarregar toda a lista de onboardings em cada polling. Gerar formulário atualiza a classificação do painel imediatamente. Atualizar atendimento recarrega também análises fiscais, mesmo sem mudança na versão cadastral. Revisões futuras devem medir custo de consultas antes de aumentar frequência ou adotar eventos de servidor.

## Integrações futuras

Não há conector Asaas nem DocuSign neste código. O fluxo atual permite abrir Asaas, criar cobrança lá e enviar o link da fatura pela conversa; a conferência do pagamento continua manual. Não mostrar cobrança criada ou pagamento recebido por uma simulação.

Próxima implementação: credenciais por ambiente, cliente Asaas identificado, IDs de plano/cobrança e referência externa ligados à versão contratada, criação avulsa/recorrente separada, reserva persistente antes da rede, reconciliação após timeout e webhook autenticado/idempotente. Asaas paymentLinks não cria cobrança imediatamente; para cobrança individual usar payments e a invoiceUrl retornada. DocuSign exige configuração OAuth, template/envelope vinculado ao contrato aceito, webhook verificado e preservação do PDF assinado/evidência. Homologar em sandbox antes de habilitar para clientes. Nunca usar testes para emitir cobranças reais ou envelopes reais.

## Fontes consultadas antes de implementar

- Meta, coleção oficial: https://www.postman.com/meta/whatsapp-business-platform/folder/13382743-ecb27be5-4d27-4763-bbee-6a8002c04bf3 — tipos de mídia e upload. A página direta developers.facebook.com não respondeu ao navegador de pesquisa; o cliente existente também já implementa ambos os transportes.
- Receita Federal: https://www.gov.br/pt-br/servicos/cadastrar-ou-cancelar-procuracao-para-acesso-ao-e-cac — Autorização de Acesso e confirmação pela pessoa autorizada.
- gov.br: https://www.gov.br/pt-br/servicos/assinatura-eletronica — assinatura com conta prata/ouro e envio do arquivo digital.
- Asaas: https://docs.asaas.com/docs/guia-de-cobrancas e https://docs.asaas.com/reference/criar-um-link-de-pagamentos — cobrança individual versus link de pagamento.
- DocuSign: https://www.docusign.com/blog/developers/deep-dive-the-embedded-signing-recipient-view — envelope e sessão de assinatura.

## Validação

Testes locais com transportes e modelo substituídos. Não usar tokens Anthropic, não consultar SERPRO pago, não enviar mensagens a clientes como teste. Validar formato/tamanho do anexo, rejeição fora da janela/carteira, resposta manual sem seleção, preservação de histórico, reinício concorrente, link correto por origem, falha de CNPJ visível, retorno ao chat e atualização sem perder rascunho/rolagem. Publicação e homologação de provedores devem ser registradas separadamente dos testes locais.

Validação executada em 14/09: 1.012 testes da API em 40 suítes, 260 da interface em 28 suítes e 28 verificações com PostgreSQL local descartável, incluindo criação e reinício concorrentes, propostas, contratos e preservação de dados. Conferência visual em navegador com dados fictícios: gaveta de mensagens, classificação, resultado público, navegação entre empresas e tela estreita. Nenhum envio real, consumo Anthropic ou emissão de cobrança usado na validação. A confirmação de entrega pela Meta e a configuração institucional dos modelos continuam verificações operacionais independentes.
