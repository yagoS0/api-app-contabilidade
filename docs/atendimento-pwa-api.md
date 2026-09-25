# API de atendimento — PWA e auditoria do chat

Implementação de 25/09/2026. Reutiliza autenticação `admin|contador`, carteira visível, identidade por pessoa, canais e reservas existentes. Não ativa IA nem muda regras fiscais.

## Operação e contratos

- Com `WHATSAPP_CHAT_V2` habilitado, lista e histórico servem o contrato V2 também para consumidores que omitem `v2=1`. A ordenação continua pela última mensagem autorizada no banco; leitura, cadastro e notas não promovem uma conversa. O caminho legado com a flag desligada mantém compatibilidade; não deve ser utilizado como PWA homologado.
- GET histórico não marca leitura nem sincroniza cadastro. POST `/firm/whatsapp/conversas/:id/lida` recebe `{mensagemId}` de uma entrada efetivamente visível. Só aceita mensagem recebida autorizada e atualiza monotonicamente até seu horário. O navegador deve suspender reconhecimento ao esconder o fio.
- Texto, orientação e anexo manuais assumem o atendimento antes de enviar. Outro responsável não é substituído. CAS na identidade/atendimento, invalidação de turnos e nova checagem antes da rede protegem concorrência. Documento de empresa preserva somente o contexto previamente conferido e reservado por versão; assumir comum conserva a política anterior de encerrar seleção automática.
- Resposta, documento, anexo e retomada aceitam `clientRequestId` (8–100 caracteres alfanuméricos, `_` e `-`). Cliente novo deve sempre enviar chave; compatibilidade sem chave permanece para clientes antigos, sem anunciar deduplicação para eles.
- `IntencaoEnvioAtendimento` tem unicidade por usuário/chave e hash de conteúdo/destino/canal/vigência. A mesma chave nunca libera segunda chamada de transporte. Conteúdo/destino divergente retorna 409. `MensagemWhatsapp.intencaoEnvioId` liga a saída antes da Meta. Callback de arquivo é persistido antes do transporte.
- GET `/intencoes/:clientRequestId` retorna `{ok,intencao:{clientRequestId,status,mensagem,resultado,erroCodigo}}`. Estados públicos: `PROCESSANDO`, `ACEITA`, `INCERTA`, `FALHOU`. ACEITA confirma identificador do provedor, não entrega. `mensagem.statusEnvio` distingue enviado, entregue, lido ou falhou. Reserva antiga sem resposta fica incerta; não expira para permitir transporte novo. A consulta é reautorizada pelo usuário e destino atual.
- Recuperar uma intenção aceita também funciona depois do encerramento da janela. Não transforma a recuperação em uma nova mensagem e não amplia a janela.

## Rascunhos

GET/PUT/DELETE `/rascunho`, com modo `texto`, `orientacao`, `anexo`, `documento` ou `retomar`. Escopo derivado do usuário, segmento/pessoa/vigência, canal e telefone do servidor. Anexos não guardam binário no rascunho.

PUT recebe `{modo,versao,conteudo}`; conteúdo admite `texto`, `orientacao`, `destinoPreparado`, `clientRequestId`, `intencaoTexto`, `envioIncerto`. Máximo 10 mil caracteres de texto e 32 KB no JSON. Primeira criação usa versão 0; alterações exigem versão atual e retornam a próxima. Resposta `{ok,rascunho:{versao,conteudo,expiraEm}}`; inexistente retorna `rascunho:null`.

DELETE exige versão e retorna `{ok,excluido:true,versao}`. Apagar ou expirar elimina o conteúdo, preservando marcador vazio e revisão incrementada. Isso impede a aba antiga de sobrescrever uma nova versão após apagar/recriar. GET do marcador retorna texto vazio com versão atual. Conflito 409 `RASCUNHO_CONFLITO` não sobrescreve nem apaga edição de outro aparelho. A interface deve conservar a revisão retornada pelo descarte.

Retenção de conteúdo: sete dias desde a última edição. GET/PUT expiram conteúdo antigo do usuário; `expirarRascunhosAtendimento` é chamado também pelo worker. Metadados de revisão são mantidos contra clientes atrasados. Texto não salvo sem rede não possui garantia de recuperação.

## Pesquisa, arquivos e retomada

- GET `/buscar?q=...&cursor=...&limite=...` pesquisa mensagens, nomes de arquivos e referências de guias já salvas, dentro do grupo autorizado. Texto 2–200 caracteres; até 50 resultados por página; cursor precisa pertencer à mesma busca. Não consulta CNPJ ou APIs fiscais. Retorna `resultados`, `temMais`, `proximoCursor` e empresa contextual.
- GET `/mensagens?mensagemId=...` abre página até a mensagem autorizada indicada, incluindo o alvo; `contextoHistorico:true` e `mensagemAlvoId` impedem tratar o trecho como mensagens recentes. A interface oferece voltar às recentes.
- GET `/mensagens/:mensagemId/arquivo` revalida mensagem, grupo e empresa atribuída ao arquivo. Retorna `{ok,arquivo:{nomeArquivo,mimeType,base64,origem}}`, `no-store` e `nosniff`. Arquivo expirado/indisponível ou de empresa fora da carteira não é liberado. Cartão e prévia não expõem nome de arquivo sem acesso.
- GET `/retomar` deve ocorrer apenas por ação explícita de preparar retomada, nunca por polling. Confere catálogo local e aprovação real na WABA/canal, idioma, categoria e componentes, devolvendo texto, destinatário, disponibilidade e `previaHash`.
- POST `/retomar` exige intenção e hash da prévia. Reconfere modelo antes de transportar, resolve telefone exclusivamente da conversa e registra mensagem rastreada. Não abre a janela de texto: a entrada válida do cliente continua sendo necessária.
- Primeira entrega suporta retomada por modelo estático sem parâmetros, mídia ou botões. Modelo ausente, não aprovado, incompatível ou não conferível retorna pendência explícita, sem inventar aprovação. Não cria nem submete template na Meta.

## Validação

Testes de serviço e HTTP usam banco/transporte sintéticos. Cobrem clique concorrente, timeout, persistência falha após aceite, hash divergente, isolamento de usuário/destino, retomada fora da janela, CAS humano, contexto de documento, leitura explícita, busca autorizada, conflito de rascunho, descarte atrasado e retenção. Os testes PostgreSQL da entrega validam unicidade e concorrência com o schema real. Instalação, teclado e notificações de aparelho físico têm homologação separada.
