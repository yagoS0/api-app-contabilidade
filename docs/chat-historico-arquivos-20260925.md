# Histórico verificável de guias e arquivos

Implementação da auditoria 01, 02, 07 e parte transversal de 10, sobre a base `b4d88d40`.

## Guias

`EnvioGuiaWhatsappService` prepara a tentativa antes de chamar a Meta. A empresa, tributo, competência, valor, vencimento, nome/idioma/parâmetros do modelo e hash são preservados em `EnvioGuiaTentativa.snapshot`. O PDF efetivamente fornecido ao transportador é copiado para uma chave nova do armazenamento existente, identificada por tentativa e SHA-256. `arquivoPdfFileId` é uma referência interna; nenhuma URL de storage é exposta no chat.

O catálogo atual não armazena o texto integral nem uma versão do modelo fornecida pela Meta. O snapshot declara `texto:null`, `versaoProvedor:null` e `renderizacaoExataDisponivel:false`. A interface mostra os parâmetros efetivamente preparados e um cartão da guia; não deve afirmar reprodução exata do telefone do destinatário. O `corpo` do balão é um resumo interno identificável da guia.

Uma mensagem reservada, ligada à tentativa, é persistida antes da chamada externa. Falha nessa preparação impede o transporte. Aceite, entrega e leitura continuam pertencendo à tentativa, sem cópia concorrente de estados. `reconciliarHistoricoGuiasWhatsapp` apenas reconcilia registros locais com identificador Meta já conhecido; nunca chama a Meta, nunca recalcula e nunca reenvia. A chave determinística da mensagem e a unicidade do identificador Meta impedem cartões duplicados. Uma nova aceitação reabre conversa arquivada anteriormente; repetir o recibo não desfaz arquivamento posterior ao aceite.

Falha entre aceite e persistência integral mantém o estado incerto existente. Sem identificador recuperável não é fabricado um aceite. O serviço não libera repetição automática. Tentativas antigas sem snapshot são apresentadas como `RECUPERADO_DO_VINCULO`, com aviso explícito; o PDF atual da guia não é oferecido como PDF enviado.

## Arquivos

`salvarArquivoManual` é chamado pelo registro da saída, antes do transporte. PDF/JPEG/PNG ficam em `ArquivoWhatsapp`, com hash, versão original e a mesma retenção de 90 dias já aplicada à entrada. Arquivo expirado mantém metadados e indica indisponibilidade. Legado sem original preservado não recebe botão de download nem dependência de link temporário da Meta.

`enriquecerMensagensWhatsapp` acrescenta `cartaoGuia` e `arquivo` às mensagens previamente filtradas pela autorização do inbox. `obterArquivoDaMensagem` exige IDs de mensagens, segmentos e empresas autorizados pela rota; recarrega os registros e recusa arquivo posteriormente vinculado a empresa fora do escopo. O cartão também oculta nome, tipo e tamanho quando o arquivo foi atribuído a uma empresa não autorizada. O download é autenticado, não armazenável em cache e confere SHA-256. Nome e conteúdo continuam separados de qualquer URL pública.

Antes do aceite, a interface deve usar “PDF da tentativa”, inclusive em envio falhado ou incerto. “PDF enviado” só se aplica ao aceite/entrega/leitura comprovado. `ORIGINAL_REGISTRADO` identifica a origem do arquivo preparado, não é uma declaração de entrega.

## Validação local

122 testes passaram em seis suítes: `historicoArquivoWhatsapp`, `envioGuiaWhatsapp`, `arquivoWhatsapp`, `liberacaoGuiasCanais`, `GuideReleaseBatchService` e `complianceAposEnvioWhatsapp`. Os cenários incluem alteração posterior da guia/modelo, falha após aceite, reparação sem nova chamada, duas guias distintas, corpo nulo, legado, hash divergente, retenção e escopo de download. Transporte e storage são sintéticos; nenhum teste chamou Meta, SERPRO ou IA. Os testes do serviço de envio usam a preparação real do histórico com storage sintético, mantendo o vínculo entre a preparação e o transporte sob verificação.

Aplicar a migration aditiva do atendimento PWA e gerar Prisma antes da API. A cópia histórica das guias depende do armazenamento configurado; falha de leitura é indicada, não substituída silenciosamente pelo PDF atual. Validação de produção e aparelhos pertence à implantação conjunta.
