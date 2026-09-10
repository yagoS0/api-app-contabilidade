# Notas — revisão de uso (08/09/2026)

## Revisão aprovada de navegação

Emissão no contador tem três etapas: Tomador → Serviço e valores → Conferência. O primeiro avanço valida tomador/endereço e impedimentos cadastrais; o segundo exige a nota completa. Voltar preserva os dados. Erros direcionam à etapa correspondente. Emitir permanece exclusivo da conferência, com validação integral, confirmação e trava de desfecho desconhecido.

Lista apresenta busca identificada, direção e inclusão de canceladas. Filtros externos são a fonte de verdade para direção, situação e competência; o rascunho local é apenas de busca. A coluna de status local se chama “Ajustes na base”, distinguindo-a de cancelamento fiscal.

NF-e e NFS-e continuam separadas. Lista mantém linha acessível por teclado; nomes podem quebrar e ações de linha precisam de área legível. Auditoria abre a íntegra em `NotaDetailModal`, sem trocar empresa/competência nem gravar um veredito; fechar retorna ao mesmo conjunto de achados. Resposta de detalhe antiga é descartada.

Emissor usa `Modal` compartilhado com `ocupado={enviando}`. Durante emissão, fundo, X, Esc e Cancelar não devem ocultar o resultado; beforeunload alerta ao sair/recarregar. Não remover bloqueio após resposta de desfecho desconhecido. Formulário e prévia permanecem ligados à mesma declaração; permissões e certificado não foram flexibilizados. Dados excepcionais de obra/destinatário e retenções não devem desaparecer durante mudanças de layout.

## EMI-01 — etapa 2 (08/09/2026)

Referência de experiência: emissor do cliente. No contador, apresentar Para quem → O que → Quanto antes das seções excepcionais de retenções/obra/destinatário. Perfil e bloqueios da empresa seguem antes do preenchimento. Conferência obrigatória e confirmação da declaração completa permanecem; não permitir emissão a partir de handler com formulário inválido, envio em andamento ou rejeição de desfecho desconhecido.

`packages/shared/src/nfse/dadosDaOperacao.js` é a fonte única das validações de retenções, obra e destinatário nos dois portais. Os módulos locais são reexports para preservar os imports. O contador adapta suas chaves de formulário e mantém retenções numéricas no payload; a normalização compartilhada valida CPF, remove pontuação legítima do documento, recusa caracteres de controle e retém dados de operação completos. Não inferir campos excepcionais do cadastro. Erros direcionam foco à região de operação e abrem seus details, preservando preenchimento.

CSS do emissor é escopado por `.emissor-contador`: grades internas de duas colunas viram uma abaixo de 600px, labels/campos encolhem, ações quebram linha. Nenhuma alteração no App.css. Testes DOM não substituem inspeção visual real com zoom/mobile. Não foi implementado rascunho persistente de emissão; erro mantém dados enquanto assistente permanece aberto.

QA mobile identificou excesso de texto quando a empresa não está configurada: manter título, nomes dos requisitos faltantes e destino de correção visíveis; explicações extensas ficam em ajuda expansível. A lista junto ao botão tem um único retorno focável ao aviso cadastral, sem repetir todos os motivos. O bloqueio fiscal continua igual.
