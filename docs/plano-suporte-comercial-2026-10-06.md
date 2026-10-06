# Suporte e Comercial — plano de implementação

Data: 06/10/2026. Estado: planejamento; implementação, limpeza e testes ainda não executados.

## Objetivo

Substituir Relacionamento por Suporte e Comercial. Manter o atendimento no ALTAN, preservar o piloto OpenAI e reunir o processo de venda até o onboarding em uma ficha de oportunidade. Interface direta, sem legendas repetidas ou formulários disputando espaço com a conversa.

## Estrutura

| Área | Navegação |
| --- | --- |
| Suporte | Atendimento, Comunicados, Pendências de e-mail |
| Comercial | Hoje, Oportunidades, Onboarding, Biblioteca comercial |

- Hoje: mensagens sem resposta, retornos agendados, propostas e contratos pendentes.
- Oportunidades: Novo contato → Qualificação → Análise → Proposta → Negociação → Contratação → Onboarding → Concluído. Perdido é um encerramento separado, com motivo.
- Ficha da oportunidade: Conversa, Resumo, Análise, Proposta, Contrato e Onboarding. Mostrar somente ações aplicáveis à etapa.
- Biblioteca comercial: preços, escopos, modelos e mensagens comerciais existentes; recursos compartilhados continuam acessíveis ao suporte quando necessários.
- Um cliente atual pode ter oportunidade comercial sem perder o vínculo com suporte. Pessoa, empresa, canal e oportunidade são conceitos distintos.
- Serviços avulsos encerram com sua entrega; não exigem onboarding recorrente nem inclusão artificial na carteira.

## 1. Base e separação

1. Levantar rotas, permissões, contagens, vínculos e estados existentes. Mapear as etapas atuais para as novas sem reiniciar processos válidos.
2. Separar as entradas de navegação e consultas das filas no servidor, incluindo não lidas e pesquisa. Manter redirecionamentos para links internos antigos.
3. Reutilizar o transporte WhatsApp, registro de mensagens, identidade e permissões. Não duplicar esses serviços por área.
4. Encaminhar solicitações recebidas no canal inadequado com contexto e ação explícita; não mudar o canal remetente silenciosamente.
5. Preservar alterações paralelas de pendências fiscais encontradas no workspace. Integrar mudanças de schema, rotas e APIs sem sobrescrevê-las.

Aceite: Suporte e Comercial têm filas e contagens corretas; nenhuma informação de outra empresa/escritório aparece; clientes com oportunidades continuam acessíveis nas duas áreas apropriadas.

## 2. Ficha e jornada comercial

1. Reaproveitar AtendimentoLead, Onboarding, FluxoComercial, análises, propostas e contratos existentes.
2. Permitir criar oportunidade antes de existir uma conversa recebida. Hoje AtendimentoLead exige conversaId: escolher e migrar explicitamente o vínculo opcional ou separar oportunidade de atendimento, sem fabricar mensagem de entrada ou janela aberta.
3. Adicionar, onde faltarem, responsável, etapa, próxima ação/data, origem e registro de autorização de contato. Controlar edição concorrente e duplicação.
4. Reunir dados informados, documentos, resultados das consultas e resumo da IA na mesma ficha, com origem e data acessíveis em detalhes.
5. Reaproveitar consultas públicas e fiscais e suas autorizações. Exibir dados faltantes e resultados inconclusivos; consultas pagas são ações explícitas.
6. Proposta em legal design a partir da ficha, análise e catálogo aprovado, com versão, prévia, PDF/link e aceite. Preço, escopo e condições permanecem protegidos.
7. Contrato a partir da proposta aceita; preservar revisão, assinatura conferida e controles existentes. Não apresentar upload como assinatura verificada.
8. Onboarding por tipo de serviço, com documentos e tarefas; conclusão não deve criar empresas duplicadas.

Aceite: uma oportunidade percorre cadastro, análise, proposta, contratação e onboarding sem redigitar dados conhecidos; avulsos e clientes existentes seguem suas rotas próprias.

## 3. Iniciar e retomar contato

1. Conferir no canal comercial o template reabrir_conversa e sua situação real na Meta. O código já oferece prévia, solicitação de aprovação e envio; aprovação/publicação não foram confirmadas neste planejamento.
2. Criar Novo contato e Retomar atendimento. Novo contato aceita telefone normalizado, origem e autorização; retomada usa a oportunidade e o histórico existente.
3. Preparar modelos específicos para primeiro contato autorizado e acompanhamento de proposta. Submeter na categoria adequada, sem prometer aprovação ou entrega.
4. Mostrar texto aprovado e variáveis antes de enviar; conferir canal, destinatário, autorização, opt-out e estado do modelo no servidor.
5. Dentro da janela, permitir mensagem livre. Fora dela, oferecer modelo aprovado. Após envio, mostrar Aguardando resposta; somente mensagem recebida válida reabre a janela. Leitura, clique em URL e status de entrega não a reabrem.
6. Separar estados: envio pendente, aceito pelo provedor, entregue, lido, falhou e resultado incerto. Repetições não podem duplicar mensagem.
7. Retorno agendado gera tarefa interna nesta primeira versão. Não dispara automaticamente uma sequência de mensagens.
8. Resposta do lead respeita o responsável atual e a pausa humana; não reinicia a qualificação nem religa IA automaticamente.

Aceite: iniciar contato autorizado sem entrada anterior e retomar contato antigo funciona por template; nenhuma operação simula uma janela aberta.

## 4. Experiência do chat

- Computador: lista, conversa e painel recolhível da ficha. A conversa ocupa a maior parte da tela.
- Celular: uma tela por vez, navegação simples entre lista/conversa/ficha e compositor utilizável com teclado aberto.
- Prioridades: texto, áudio, anexos, busca, não lidas, rascunho por conversa/canal, resposta a mensagem e recuperação de falhas.
- Exibir responsável e estado da IA com ações Assumir e Retomar IA. Explicações adicionais só em detalhes ou erros acionáveis.
- Conferir recursos mobile/PWA e push já existentes; completar notificações e abertura da conversa correta conforme suporte do navegador e permissão do usuário.
- Preservar posição de leitura; mudanças de conversa não podem transportar rascunhos, anexos ou respostas atrasadas para outro destinatário.

Aceite: uso confortável em 360/390 px e desktop, inclusive teclado, arquivos, áudio, acessibilidade por teclado e rede instável.

## 5. Preservar e integrar a IA

1. Manter LeadsOpenAIClient, InterpretarMensagemLeadService, validação de evidências, registros de tokens/custo e guardas existentes.
2. Confirmar no servidor o piloto do telefone informado pelo responsável, com DDI 55, e o canal autorizado. Não publicar o telefone completo nem chaves neste documento.
3. Preservar IA_LEADS_OPENAI, listas próprias de telefone/canal e teto acumulado. Limpeza de histórico não renova saldo nem remove reservas incertas.
4. Mostrar resumo, informações capturadas, pendências e próxima ação; correções humanas prevalecem sobre extrações antigas.
5. Manter a interpretação de pré-atendimento separada da geração de diagnósticos e propostas. Qualquer nova função usa validação própria; não presumir que o piloto já fecha vendas autonomamente.
6. Começar testes com modelo simulado. Rodada real usa o orçamento remanescente confirmado e registra consumo; se indisponível, registrar bloqueio sem aumentar teto silenciosamente.

Aceite: IA responde somente ao piloto permitido, para quando o humano assume, não inventa preços/dados e conserva os limites após migração e limpeza.

## 6. Limpeza comercial autorizada

O responsável autorizou apagar históricos de contatos comerciais. Executar na implantação preparada para homologação, após validação em banco descartável; não apagar dados durante o planejamento.

1. Inventariar por canal e caso comercial; produzir prévia com IDs e quantidades, ambiente e vínculos. Não selecionar apenas por telefone ou ausência de empresa.
2. Fazer cópia recuperável restrita antes da limpeza. Preservar suporte, contatos compartilhados, empresas, propostas, contratos, aceites, consultas e documentos de negócio, além de custos/reservas da IA.
3. Remover histórico conversacional comercial e resumos/notas derivados selecionados; tratar anexos exclusivos sem remover arquivos compartilhados. Preservar referências mínimas quando necessárias à integridade dos documentos e auditoria.
4. Invalidar trabalhos de automação antigos e impedir reentregas de webhook de reconstruírem mensagens apagadas ou dispararem respostas. Manter deduplicação e corte persistente de automação.
5. Preservar opt-outs, autorização de contato e evidência mínima da última entrada válida para a janela. Se essa evidência não puder ser preservada, exigir template até nova mensagem do cliente.
6. Limpar leituras, resumos e contagens derivados. Validar nova entrada do piloto como atendimento novo, sem herdar triagem nem tarefas antigas.
7. Executar com seleção explícita e transação/lotes recuperáveis, registrar resultado e conferir que suporte e gastos permaneceram idênticos.

Aceite: comercial limpo para os testes, sem exclusão cruzada, sem restauração por replay e sem redefinir orçamento da IA. Casos com vínculos ambíguos ficam fora da limpeza automática e aparecem no relatório.

## 7. Testes técnicos

| Camada | Cenários obrigatórios |
| --- | --- |
| API e permissões | Separação por área/canal/escritório, cliente com nova oportunidade, contatos ambíguos, primeiro contato sem mensagem prévia |
| Comercial | Etapas por modalidade, edição concorrente, análise, proposta versionada, aceite, contrato, onboarding e avulso |
| WhatsApp | Janela aberta/fechada, modelo ausente/pendente/rejeitado/aprovado, opt-out, falha, timeout incerto, replay e canal incorreto |
| IA | Piloto correto/incorreto, pausa humana, teto, custo, correção, retomada e ausência de credencial |
| Banco real descartável | Migração, vínculos compartilhados, limpeza, rollback, jobs antigos, deduplicação e integridade financeira |
| Interface | Navegação, contagens, envio/recebimento simulado, busca, áudio/anexos, rascunhos, mobile e erros recuperáveis |

Ordem: testes direcionados por entrega → integração com PostgreSQL descartável → inspeção visual desktop/mobile → regressão dos módulos afetados → build web, validação Prisma e CI aplicável. Usar scripts Jest existentes de web/API e verificações PostgreSQL adaptadas; não considerar --passWithNoTests como evidência.

Guardar resultados e falhas conhecidas. Testes automatizados usam transportes simulados: não enviam mensagens a clientes, não assinam, não cobram e não executam consultas fiscais pagas.

## 8. Implantação e teste pelo telefone

Antes da homologação: validar CI, migrações, saúde da API/worker, configuração do canal, modelo aprovado e piloto restrito; executar a limpeza comercial e conferir totais. Publicar com possibilidade de desativar a nova interface/IA sem excluir registros novos.

Roteiro do responsável:

1. Enviar Olá, quero abrir uma empresa e responder naturalmente. Conferir extração, resumo e custo.
2. Corrigir uma informação; pedir atendimento humano; confirmar que a IA para.
3. Trocar texto, áudio e documento; usar o ALTAN pelo celular e verificar notificações quando suportadas.
4. Preencher a análise, gerar proposta de teste, abrir PDF/link e conferir contrato/onboarding sem assinatura ou cobrança real.
5. Testar primeiro contato com destinatário autorizado que ainda não tenha conversa cadastrada, usando modelo aprovado.
6. Testar retomada em conversa realmente fora de 24 horas; responder ao template e confirmar mensagens livres. A limpeza não substitui a espera da janela real da Meta.
7. Repetir uma abertura de atendimento e conferir que histórico antigo não reaparece e o suporte continua intacto.

Separar testes observados de limitações do ambiente. Nenhuma entrega é considerada homologada apenas porque o transporte simulado passou. Corrigir problemas encontrados pelo responsável e repetir os cenários afetados.

## Referências locais

- apps/web/src/app/navigation/OfficeNavigation.jsx
- apps/web/src/features/whatsapp/components/RetomarConversa.jsx
- apps/web/src/features/onboarding/components/FluxoComercial.jsx
- apps/api/src/application/whatsapp/RetomadaAtendimentoService.js
- apps/api/src/application/assistente/InterpretarMensagemLeadService.js
- docs/piloto-openai-leads-20260928.md
- docs/avaliacao-dialogos-ia-leads-20260928.md
- docs/fluxo-comercial-leads.md
- docs/proposta-contrato-formulario-20260921.md

Regra externa: https://business.whatsapp.com/policy — templates aprovados para iniciar/retomar fora da janela; envio do template não libera mensagem livre sem resposta do destinatário.

## Implementação DEV — 6 de outubro

Entregue no código:

- Menu Suporte separado de Comercial; painel Hoje, oportunidades, conversas, onboarding e biblioteca.
- Filtros de área aplicados no servidor antes da paginação, histórico, busca e leitura. O mesmo telefone pode aparecer nas duas áreas sem misturar mensagens.
- Reaproveitamento da ficha e dos fluxos existentes de análise, proposta, contrato e onboarding.
- Primeiro contato pela ficha: canal comercial ativo, evidência de autorização, verificação de identidade e escopo, criação idempotente do vínculo. Preparar contato não envia mensagem, não fabrica entrada e não abre a janela de resposta.
- Retorno interno com data, ação e responsável, controle de versão e apresentação no painel Hoje.
- Biblioteca direcionada para conversas comerciais. Continuidade dos serviços e limites existentes de IA, sem alterar credenciais ou teto.
- Prévia isolada em `http://127.0.0.1:5176/comercial`, com dados fictícios e sem transporte real. O código da interface também está ligado às APIs reais do aplicativo.

Verificado: 175 testes de API e 120 testes web; build Vite; PostgreSQL descartável com migrações e oito verificações de autorização, isolamento entre áreas, idempotência, concorrência e ausência de chamadas pagas. Evidência local em `test-evidence/suporte-comercial-1791321267782`. Inspeção na aba: preparar conversa, janela nunca aberta, recarregar conversa e agendar retorno.

Ainda pendente para encerrar o plano completo: refino do funil (novo/negociação), conclusão de retornos, reorganização interna das abas de documentos, adaptação do aplicativo móvel dedicado e suas notificações, limpeza recuperável dos históricos comerciais reais e homologação do telefone piloto. A prévia não se conecta ao banco/canal real, portanto não houve limpeza real nem envio pelo telefone. O chat móvel legado permanece com o comportamento anterior. Executar essas etapas antes de produção, usando os critérios das seções acima.
