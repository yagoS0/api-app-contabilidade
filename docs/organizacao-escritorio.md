# Organização do escritório — primeira entrega

Implementação em desenvolvimento, 17/09/2026.

## Navegação

- Operação: Empresas e agenda, Apuração, Consultas, Rotinas e Guias não identificadas.
- Relacionamento: Atendimento, Entrada de clientes, Comunicados, Pendências de e-mail e Biblioteca.
- Gestão: Planejamento, Laboratório e Configurações.

Rotas, permissões e registros existentes foram preservados. A navegação aparece após a validação da sessão. Formulário público, proposta pública e portal do cliente continuam com suas próprias interfaces. A marca é única, na navegação global; os cabeçalhos das páginas mantêm título e ações locais. Documentos e configurações da empresa continuam no contexto da empresa.

## Entrada de clientes

A lista inicia nos atendimentos em andamento; encerrados e todos têm filtros explícitos. O detalhe possui Atendimento comercial, Dados do cliente e Implantação. Os painéis permanecem montados quando ocultos para preservar campos em edição. A checklist usa etapas já gravadas; não prova assinatura nem pagamento. Serviços avulsos podem terminar sem entrada na carteira. Na carteira, cadastro e documentos permanecem acessíveis.

No chat, a ficha abre em nova aba para manter a conversa e seu rascunho. O processo comercial completo continua disponível, inicialmente recolhido. Nenhuma mensagem é enviada por abrir ou alternar áreas.

## Limites desta entrega

A organização reaproveita os fluxos atuais. Não cria novos portais, perfis de acesso, responsáveis, marcos automáticos de implantação ou integração de cobrança. Pendências de e-mail continua sendo a tela de e-mail; não apresenta uma falsa visão unificada dos demais canais.

## Validação

Cobertura de autenticação, navegação e histórico, acesso a documentos, formulários públicos, conversão, encerramento avulso, preservação de rascunhos e atendimento. Verificação visual local do chat em tela estreita e desktop, incluindo campo de resposta. Build Vite com os avisos preexistentes de tamanho de bundle e imports mistos.
