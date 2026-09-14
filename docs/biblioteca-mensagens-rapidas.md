# Biblioteca e lista de contatos — 14/09/2026

A lista de contatos à esquerda ocupava espaço demais. Agora tem 280 px no desktop e 260 px em telas de 761 a 1250 px, acompanhando o breakpoint que sobrepõe os detalhes. No celular, lista e conversa continuam alternadas.

## Uso

1. No chat, abrir **Mensagens rápidas**. A gaveta esquerda oferece título, descrição e busca, além dos três formulários ligados ao onboarding.
2. Selecionar **Preparar mensagem**, conferir a prévia e enviar explicitamente ao contato. O CNPJ já informado no onboarding é aproveitado; não é necessário digitá-lo novamente.
3. **Gerenciar biblioteca compartilhada** abre uma nova aba em `/biblioteca`. A mesma página está em Configurações. O chat e seu rascunho permanecem na aba original.
4. Revisar o texto, salvar nova versão e aprovar. Salvar sozinho deixa rascunho. Ao voltar à conversa, a biblioteca é relida e prévias anteriores são descartadas. O menu oferece apenas a última versão aprovada de cada chave.

## Mensagens configuradas

Dez orientações: pedir CNPJ; abertura avulsa/com contabilidade; transferência; empresa parada; explicar procuração; guia de procuração; ajuda com procuração; envio de documentos; proposta de serviços; assinatura gov.br.

O banco de produção tinha seis orientações em rascunho, sem nenhuma aprovada. A configuração solicitada criou novas versões para esses seis textos, acrescentou quatro orientações e aprovou os dez textos revisados. Dados institucionais foram preenchidos a partir do CNPJ já cadastrado no SERPRO; somente esse identificador foi consultado, sem ler credenciais nem chamar provedor fiscal. A configuração usou os métodos existentes de criação/aprovação, dentro de transação, conferindo versões e gestor ativo. Cada texto foi preparado com dados sintéticos para verificar os marcadores; nenhum cliente recebeu mensagem nessa operação. Catálogo privado e contrato mantiveram seus conteúdos e estados.

Em instalações novas, **Carregar rascunhos iniciais** continua criando apenas versões iniciais não aprovadas. `MensagensPadrao.js` contém textos genéricos, descrições e fontes; CNPJ real e políticas comerciais permanecem na configuração privada. Não aprovar institucional incompleto nem substituir automaticamente recursos personalizados.

## Fontes oficiais e manutenção

- [Serviço de Autorização de Acesso da Receita](https://www.gov.br/pt-br/servicos/cadastrar-ou-cancelar-procuracao-para-acesso-ao-e-cac): conta prata/ouro, serviços escolhidos pelo cliente e confirmação pelo autorizado.
- [Manual ilustrado da Receita](https://www.gov.br/receitafederal/pt-br/centrais-de-conteudo/publicacoes/passo-a-passo/autorizacoes-de-acesso-guia-do-usuario): cadastro, assinatura, estado Em Análise e confirmação pelo escritório. Operacionalmente, conferir as autorizações recebidas; o manual prevê cancelamento automático se não confirmadas em 30 dias.
- [Tutorial oficial de assinatura gov.br](https://www.gov.br/governodigital/pt-br/identidade/assinatura-eletronica): assinar no portal, autorizar pelo gov.br e baixar o arquivo assinado. Imprimir/salvar novamente como PDF não preserva a assinatura original.

Fontes consultadas em 14/09/2026. Se o portal oficial mudar, revisar os textos e criar uma nova versão. O guia orienta a autorização, sem afirmar que ela já existe ou que SITFIS foi consultado. Assinatura continua manual, sem DocuSign; cobrança Asaas por API não foi implementada neste ajuste.

## Validação

124 testes de onboarding/API, 328 testes da interface e build Vite passaram. Conferência visual com contatos fictícios em 1280 px e frames de 1100/390 px: largura da lista, detalhes sobrepostos, alternância no celular, edição versionada, mensagens aprovadas e preservação do rascunho. Atributos de nova aba e atualização no evento de foco são cobertos por testes; o navegador embutido de validação não abriu o popup, então a página independente foi inspecionada em outra aba criada pelo teste. Não usar esses testes como evidência de envio pela Meta. Nenhum token Anthropic, consulta fiscal real, assinatura ou cobrança foi consumido nos testes.
