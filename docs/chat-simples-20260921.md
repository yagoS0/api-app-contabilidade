# Chat e biblioteca: clareza no atendimento

## Problema e decisões

O escritório relatou excesso de informação junto ao nome, cores concorrentes, texto pequeno, botões demais e dificuldade para encontrar mensagens rápidas e descartar rascunhos. A revisão concentra a tela na conversa e apresenta ferramentas no momento em que serão usadas.

- Lista: nome, hora, prévia, não lidas e contexto curto. Papel, origem do nome, telefone e cadastro ficam nos detalhes, preservando a identificação recebida do servidor.
- Cabeçalho: situação do atendimento e empresa continuam acessíveis; assumir/devolver e abrir atendimento são ações principais. Navegação da empresa e lixeira ficam em Mais.
- Compositor: escrever, mensagens rápidas, anexos e responder em uma barra. Guias/documentos abrem sob demanda na ficha da empresa. Descartar remove somente o rascunho do canal/modo atual; Desfazer restaura texto e referência enquanto a pessoa não muda de contexto.
- Biblioteca: mensagens com título, explicação de quando usar e prévia; Usar mensagem insere no compositor para revisão. Mais usadas ordena inserções feitas pelo próprio usuário neste navegador, não entregas nem popularidade de toda a equipe. Somente identificadores das mensagens e contagens são persistidos; sem usuário identificado, a preferência vale só na sessão.
- Gestão: mensagens, contratos, honorários e dados institucionais têm categorias próprias; versões antigas ficam no histórico. Excluir rascunho exige ID/versão e recusa versões aprovadas ou alteradas durante a ação.
- Guias: a prévia informa empresa, canal WhatsApp, documento e todos os destinatários autorizados. O servidor continua revalidando o envio; a aceitação pela Meta não equivale à entrega.
- Jornada: próximo passo e suas pendências aparecem antes do mapa completo. Formulários recolhidos preservam a edição; etapas futuras mantêm descrição legível e bloqueio funcional.

O escopo conserva a paleta e os componentes do projeto. Não muda identidade, acesso fiscal, canais, pausa humana, tributação, preços ou regras de avanço do atendimento. Não há nova integração paga ou uso de IA.

## Etapas de execução e revisão

1. Pesquisa de referências oficiais e inventário do código.
2. Design da hierarquia; divisão dos arquivos entre chat, biblioteca e jornada.
3. Construção independente e correções funcionais dos rascunhos.
4. Revisão cruzada de guardas, testes de comportamento e validação no navegador com dados fictícios.
5. Integração após regressões e compilação; verificação da versão implantada.

O coordenador revisa as entregas e resolve divergências antes da integração. Testes não enviam WhatsApp/e-mail real nem chamam Anthropic ou serviços fiscais. Capturas locais de demonstração e resultados operacionais ficam fora do repositório público.

## Referências de design

Recomendações adaptadas ao ALTAN, sem copiar identidade visual de outros produtos:

- [Slack — preferências da lateral](https://slack.com/help/articles/212596808-Adjust-your-sidebar-preferences): largura ajustável e ferramentas menos usadas fora do caminho principal.
- [Intercom — usar macros](https://www.intercom.com/help/en/articles/6584504-using-macros-in-the-inbox): preparar no compositor, personalizar e depois enviar.
- [Intercom — gerenciar macros](https://www.intercom.com/help/en/articles/6433193-creating-and-managing-macros): títulos claros e uso observado.
- [Carbon — divulgação progressiva](https://carbondesignsystem.com/patterns/disclosures-pattern/): detalhes disponíveis sob demanda.
- [Atlassian — tipografia](https://atlassian.design/foundations/typography): hierarquia e corpo de leitura consistente.
- [W3C — WCAG 2.2](https://www.w3.org/TR/WCAG22/): contraste, ampliação de texto, foco e alvos acessíveis.

## Critérios de validação

Troca de pessoa/canal/modo não mistura rascunhos. Descartar não envia nem apaga histórico; estado de envio impede descarte. Versão aprovada e concorrência com aprovação impedem exclusão da biblioteca. Uso local não guarda dados do contato e mantém a ordem por frequência. Preparação não equivale a envio. Mudança dos destinatários da guia exige nova conferência. Recolher o formulário não salva, conclui ou perde edição. Desktop e tela estreita devem manter acesso ao compositor e às ferramentas sem rolagem horizontal da página.

## Validação realizada

- Regressão local de interface: 519 testes executados; as cinco falhas iniciais (quatro por tempo sob carga concorrente e uma expectativa de texto/expansão antiga) foram verificadas em execução isolada. O reteste passou em sete suítes, 53 testes, incluindo o novo diálogo de descarte. Não houve alteração de timeout ou remoção de proteções.
- API: 62 testes passaram em três suítes de recursos e fluxo comercial, incluindo exclusão concorrente com aprovação, autorização, ID/versão inválidos e preservação de versões aprovadas.
- Compilação do escritório concluída. Revisão cruzada independente não encontrou regressão crítica nova.
- Navegador local com dados fictícios: descarte/desfazer, troca de contato, biblioteca/categorias/editor, aprovação e inserção de exemplo sem envio, ordem por uso, jornada de abertura e painel de guias com conferência de destinatários e cancelamento.
- Tela de 390 × 844 e desktop de 1280 × 800 conferidos. A revisão visual corrigiu o estilo das categorias e o painel de guias que antes estendia o compositor para fora da área disponível; agora o painel tem rolagem própria sobre o histórico.
- A biblioteca importa seus próprios estilos, funcionando também quando aberta diretamente. Descarte de ficha vinculada continua recusado, mas o motivo aparece no diálogo e permite abrir a ficha para encerramento com histórico.

Integração e implantação dependem dos checks do commit publicado. Evidências operacionais e dados de teste permanecem fora do repositório público.
