# Perfil de emissão, planejamento e incidente do certificado — 15/09/2026

## Município no perfil

O editor de perfis usa `MunicipioDoPerfil` com a lista compartilhada de municípios do IBGE e o autocomplete `CampoComBusca`. O contador busca por nome/UF e seleciona a cidade; somente o código de sete dígitos vai em `cLocPrestacao`. É o município da prestação, não uma inferência automática do endereço do emissor.

Códigos já salvos mostram nome e UF quando encontrados. Código legado desconhecido é preservado e identificado. Digitar outra busca limpa o código anterior; uma busca não resolvida impede salvar, enquanto limpar intencionalmente o campo permite salvar `null` conforme o contrato opcional existente. O texto de busca não entra no payload. Testes do editor: 6 aprovados; conferência visual no mock com São Paulo / SP → 3550308 aprovada.

## Incidente em produção: Lente

O cliente recebeu `NO_COMPANY_CERT` em tentativas de emissão em 15/09. Diagnóstico somente de leitura confirmou vínculo Company/PortalClient e CNPJ coincidentes, certificado no banco (`db:company-pfx`, 9.319 bytes), senha protegida presente e validade cadastrada até 30/10/2026. Os logs registraram recusa antes de reservar numeração.

Com as variáveis atuais da API, o cofre AWS KMS recusou a descriptografia com `UnrecognizedClientException`, HTTP 400. Arquivo e senha não puderam ser abertos. Existe credencial dedicada do KMS, de formato compatível com credencial permanente; não existe credencial AWS compartilhada alternativa. Não foram expostos segredos nem emitidas notas no diagnóstico.

**A emissão permanece bloqueada até restabelecer o acesso à AWS.** O usuário confirmou suspensão da conta por falta de pagamento e informou que já pagou. O teste realizado após essa informação continuou retornando UnrecognizedClientException. Aguardar reativação da conta; a orientação anterior de investigar a credencial IAM foi superada por essa informação, sem evidência de que seja necessário trocá-la. Preservar a chave criptográfica que protege os dados: substituir a credencial IAM não significa substituir a chave KMS ou recadastrar os certificados. Após a correção, verificar abertura do PFX, senha, CNPJ e validade com o mesmo caminho de leitura; a emissão real fica com o cliente.

Correção de código preparada: `CertResolver` distingue certificado cadastrado mas inacessível (`CERT_STORAGE_UNAVAILABLE`) de certificado ausente. O retorno `null` de `decryptSecret` é reconhecido como `CERT_PASSWORD_DECRYPT_FAILED`, em vez de usar senha vazia. `nfseCertificado` só traduz `NO_CERT_AVAILABLE` para ausência; falhas inesperadas de leitura recebem mensagem de indisponibilidade sem repassar detalhes internos. O desfecho continua local, antes de envio/numeração. O portal do cliente orienta acionar o suporte para restabelecer o cofre. A mudança de mensagem, sozinha, não restaura o acesso à AWS.

Referência: [AWS — diagnóstico de UnrecognizedClientException no KMS](https://repost.aws/knowledge-center/lambda-kmsaccessdeniedexception-errors).

Nova verificação solicitada pelo usuário após o pagamento: em 15/09, por volta de 17h32 (São Paulo), o erro mudou para `AccessDeniedException`. A AWS informou expressamente que a conta proprietária da chave ainda não está ativa (`resource owners account is not active`); PFX e senha permanecem inacessíveis. Isso confirma reativação pendente, sem evidência para alterar permissões ou trocar credenciais.

## Planejamento: investigação pendente de premissas

O usuário esclareceu que usou Planejamento pelo dashboard, em simulação livre, sem empresa selecionada. Na reprodução pelo navegador, digitando receita anual de R$ 1.200.000,00 e mantendo os padrões (serviços, Anexo III, ISS 5%, RBT12 igual à receita, sem folha), a tela mostrou Simples R$ 156.360/ano (13,03%) e Presumido R$ 210.360/ano (17,53%). O Presumido sinaliza CPP ausente por falta de folha. A linha IRPJ do Simples, separadamente, mostra R$ 6.254,40; isso não prova que tenha sido o valor observado pelo usuário.

Não foi reproduzido total anual de R$ 6 mil. Foram solicitados os demais campos usados no cenário. Não alterar fórmulas tributárias para forçar um resultado sem reproduzir o problema. A máscara monetária existente trabalha em centavos; a reprodução confirmou valor visível de 1.200.000,00 antes de conferir os cartões. Não confundir RBT12, receita anual, tributo isolado e total anual.

Validação: 100 testes de certificado/desfecho/emissão, 7 do texto ao cliente, 6 do perfil e 400 de planejamento aprovados. Builds dos dois frontends aprovados, com aviso existente de chunks acima de 500 kB. Estas alterações ainda não foram publicadas em produção.
