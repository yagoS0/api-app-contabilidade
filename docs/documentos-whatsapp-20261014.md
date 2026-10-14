# Documentos e CNPJ pelo WhatsApp

O cliente vinculado escolhe a empresa, abre Documentos e seleciona o arquivo por botão, número ou nome exato da opção. A lista mostra oito arquivos por página, com Ver mais documentos. O envio usa o cadastro e armazenamento existentes, sem modelo de IA nem consulta fiscal. Imagens são enviadas como imagem; demais arquivos como documento.

Outras → CNPJ da empresa, ou a mensagem CNPJ, retorna o número do cadastro em uma linha para copiar. Pedidos com nome explícito de outra empresa passam pelo seletor de empresas autorizadas. Campos de tomador e pedidos de emissão não são tratados como consulta do próprio CNPJ.

Documentos exigem papel e permissão DOCUMENTOS_EMPRESA. Cada envio refaz vínculo, empresa, contexto, acesso e janela. Opções vencem em 30 minutos; troca de empresa, outra saída ou envio do arquivo invalida a escolha. Reentrega da mesma entrada não duplica a saída. Arquivo removido ou indisponível pausa a automação e registra encaminhamento e aviso persistente ao escritório.

Não altera habilitação do piloto/menu, consentimento, papéis ou permissões de contatos. Disponível aos clientes habilitados no atendimento atual; não libera acesso ao cadastro de terceiros. Não exige migração de banco ou novo template Meta.

Validação: testes sintéticos de escolha, paginação além de 30 arquivos, repetição, expiração, troca de empresa, revogação, imagens, arquivo indisponível e CNPJ; regressão do WhatsApp. Sem chamadas pagas ou mensagens reais.
