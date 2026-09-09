# Atendimento do cliente com uso de IA apenas quando necessário

## Situação e escopo desta correção

O menu atual executa consultas por identificador sem chamar um modelo. O atalho de emissão apenas enviava uma instrução e deixava a coleta seguinte para a IA. A preparação também não recuperava o tomador salvo nem os dados tributários usados no portal.

Esta correção entrega funções de preparação reutilizáveis: memória do tomador por empresa/documento, CNPJ com fonte pública alternativa, CEP parcial e leitura fiscal anterior à confirmação. A ferramenta `preparar_emissao` usa essas funções. A emissão continua dependendo do código de confirmação e das autorizações já existentes. Nenhuma emissão é executada na preparação.

O roteiro determinístico abaixo é a próxima etapa proposta. **A coleta guiada persistente ainda não está implementada nesta alteração.**

## Conversa proposta, sem modelo

1. Cliente escolhe **Emitir nota** ou escreve um pedido simples reconhecido, como “quero emitir uma nota”.
2. Sistema pede **CPF/CNPJ ou tomador salvo**. Recupera o cadastro da própria empresa; consulta CNPJ se necessário. Nome e endereço que já existem não são perguntados novamente.
3. Sistema pede **descrição do serviço** e **valor**, aceitando respostas separadas ou campos identificados na mesma mensagem. Valores ambíguos são esclarecidos, sem conversão por adivinhação.
4. Sistema oferece **competência atual ou outra competência**. Com dois ou mais perfis fiscais, oferece os nomes configurados pelo contador; um perfil único é automático.
5. Funções completam os dados. CEP resolve município, rua e bairro; número/complemento do imóvel vêm da memória ou do cliente. Pergunta-se somente o que continua faltando. Não se consulta CPF em base externa.
6. Cadastro e histórico local fornecem regime, serviço e tributos, seguindo a resolução do emissor e a regra do portal. Configuração fiscal ausente gera encaminhamento com os dados já coletados, sem pedir percentuais ao cliente.
7. Sistema mostra o resumo, inclusive a competência usada na fonte tributária, e oferece **confirmar, corrigir ou desistir**. Só o mecanismo existente de `CONFIRMAR <código>` autoriza o ato fiscal.
8. Após execução, mostra o resultado real. Falha ou resultado indeterminado não pode ser anunciado como sucesso nem reemitido automaticamente.

Esse percurso não consome tokens de IA. Eventuais custos do canal WhatsApp continuam separados.

## Quando cada caminho atende

| Situação | Caminho |
| --- | --- |
| Clique no menu, documento digitado, valor, competência ou opção de perfil | Regras e funções do sistema |
| Dado já salvo ou consulta pública de CNPJ/CEP | Leitura direta, sem modelo |
| Pergunta prevista e aprovada na biblioteca | Mensagem rápida cadastrada |
| Texto que não pôde ser entendido após esclarecimento simples | IA recebe somente o pedido e o rascunho necessário |
| Decisão tributária, alteração fiscal, negociação ou solicitação de pessoa | Contador, com resumo da coleta |
| Correção objetiva durante a revisão | Atualiza o rascunho e substitui resumo/código |

Texto livre permanece permitido. Entrar no fluxo não obriga o cliente a repetir números de opções. A IA não é acionada por todo erro de digitação nem por indisponibilidade de uma consulta; primeiro entram validação, resposta fixa e preenchimento manual.

## Encaixe no código e ordem de implementação

1. **Base compartilhada (esta alteração):** `application/tomador/prepararTomadorDoCliente.js`, `consultarCep.js`, `consultaCnpj.js` e `application/nfse/preparacaoFiscalDoCliente.js`. A ferramenta de IA usa a mesma preparação que o futuro coletor guiado.
2. **Rascunho persistente:** criar armazenamento próprio para emissão com conversa, empresa, usuário, dados, origem por campo, etapa, versão e expiração. Não reutilizar pendência confirmável ou metadados comerciais para dados incompletos. Persistir antes de responder; reinício da API não perde a coleta.
3. **Coletor sem IA:** acoplar ao `MenuWhatsappService`, sob o lease da conversa e antes do encaminhamento de texto ao assistente em `ProcessarEventoWhatsappService`. Revalidar vínculo, acesso e atendimento humano em cada passo. Mensagem repetida não avança duas etapas.
4. **Preparação e confirmação:** coletor chama as funções compartilhadas; somente dados completos criam `AcaoPendenteWhatsapp`. Reutilizar o serviço de confirmação, seu cancelamento e a proteção contra código antigo ou confirmação junto com correção.
5. **Continuação livre:** manter rascunho ao encaminhar à IA ou ao contador. Campos que vieram de consulta devem conservar a origem entre turnos; a mera passagem pelo modelo não os torna dados digitados pelo cliente.
6. **Piloto e medição:** ativar a coleta guiada nos números autorizados e medir conclusão sem modelo, campos repetidos, consultas malsucedidas, encaminhamentos, tempo até resumo e consumo por atendimento. Expandir depois dos critérios abaixo.

## Critérios de aceite do coletor

- Tomador conhecido + serviço + valor + competência chega ao resumo sem modelo e sem pedir tributos.
- CNPJ novo com cadastro completo funciona sem pedir nome/endereço; CNPJ indisponível + CEP + número pede apenas eventuais lacunas reais.
- CPF desconhecido permite nome e endereço manuais; CEP continua disponível.
- Corrigir valor, tomador, endereço ou competência invalida o resumo anterior; “sim” isolado não emite.
- Confirmação duplicada, webhook repetido, interrupção/reinício e troca de empresa não duplicam emissão nem expõem dados.
- Atendimento humano, vínculo revogado ou configuração incompleta interrompem o ato, preservando coleta útil para a equipe.
- Testes de conversação usam transportes e modelos simulados, com acesso ao Claude bloqueado. Nenhum teste de desenvolvimento precisa emitir nota ou mandar mensagens reais.
