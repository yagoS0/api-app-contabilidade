# Candidato T1/T2 FS12 interno — não integrado nem executado

Dono Fiscal. Escopo autorizado E2 seção38; concretiza R01/R02/R05/R06/R20 sem alterar regras tributárias, fonte de folha, permissões, transporte ou estado fiscal. Nenhum arquivo versionado, governança, config, Fechamento, HTTP, seletor de payload ou B31 foi alterado por esta preparação. Canônica/cópia SHA99a27e4a2191f8243cffa662e18074ea92216bb4cad4ec0b08caa42d650cb745.

## Fluxo e portas

prepararComandoFs12(entrada,{transacionar}): T1 abre transação local Serializable, incrementa coordenação por PortalClient/PA ANTES das leituras de autorização/contexto. Reutiliza prepararFs12ParaNovoCalculo e portas B31 para ACL, regime histórico/abertura, janela e série MANUAL vigente. SIMULAR não cria nem aceita vínculo de cálculo. TRANSMITIR/RETIFICAR exigem snapshot fechado e B32 exato existente, hash e revisão válidos. Não fabricar B32 para registrar tentativa.

prepararNoServidor(entrada,tx) é porta interna, não rota nem JSON fornecido pelo cliente. Deve ler a revisão original e base atual na TX, produzir Buffer do envelope que seria enviado, CNPJ/Company, origem e provaPreparacao estrutural. Não tem rede/retry externo. IdentificarEnvelope(payload,rota) deve ser função existente do guard conectada pela composição, não algoritmo paralelo de assinatura. Preparador deverá também validar intenção/selector pelo contrato fiscal oficialmente revisado; esta preparação não escolhe série/payload nem declara PA11/12 liberado.

T1 calcula hashes do envelope e provaPreparacao; grava intenção congelada, revisão, série/contexto/política, cálculo/vínculo de origem e chave de replay. esperado.custodia contém EXATAMENTE {respostaId,custodianteId,capacidadeId}, alocados internamente. Nenhum status/hash de corpo/instante futuro é inventado. Identidade de resposta prealocada permite T3a achar origem mesmo após queda do DB na observação. Alocação de IDs não tem efeitos externos; replay recupera IDs originais. Cada retry local abortado não publica os IDs da tentativa revertida.

Hash de comando = JSON canônico com chaves recursivamente ordenadas; contém identidade, intenção, revisão, cálculo/vínculo, hashes de série/contexto/envelope/preparo, política e origem. Não persiste envelope em claro. Replay revalida ACL e FS12 antes de devolver o comando; mudança de dados mesma chave recusa. Retorno sempre autorizaEfeitoFiscal:false.

criarPersistenciaComandoFs12 recebe db e portas obrigatórias prepararNoServidor/identificarEnvelope/alocarIdentidades/cifraEnvelope/validarSnapshot. lerResolucaoFiscal é opcional e recusa por ausência. Nenhuma configuração produtiva/segredo é lida por esses adaptadores. Reutiliza criarPersistenciaFs12 numa ponte para o MESMO TransactionClient; erros abortados são encapsulados antes de atravessar retry interno B31 e restaurados na fronteira externa. Não existe $transaction aninhada real nem fallback para cliente global.

## Hooks futuros do guard

Dentro da TX EXISTENTE do guard, após travas SERPRO global e política empresarial:
persistencia.naTransacaoDoGuard(tx,escopoAutenticado,ports => associarReservaComandoFs12({comandoId,reservaId},ports)).
O escopo vem do guard confiável, não do comando solicitado. Após coordenação, lerComando confere empresa/PA/autor com esse escopo. A associação usa reserva existente; não cria ledger. Reserva deve estar reservada, acaoId=comandoId e identidade/serviço/rota coincidentes. Assinatura corresponde aos bytes preparados identificados pela função existente. Envelope cifrado tem AAD próprio ENVELOPE, não formato de observação de resposta.

Antes de criar marcador, na mesma ordem de locks e mesma TX:
conferirComandoAntesMarcadorFs12({comandoId,reservaId},ports).
Revalida contexto, ACL, FS12, vínculo, preparo, envelope/cifra e ausência de marcador. Hook retorna verificado, não licença de transporte independente. O guard ainda precisa registrar marcador na mesma TX e aplicar todas as próprias políticas. Nenhum hook é conectado nesta entrega.

Resultado desconhecido bloqueia por PortalClient/PA, independentemente de assinatura, chave, revisão ou idade. Consulta todas as tentativas PGDAS do escopo, não só comando novo: reservada/incerta bloqueiam; tentativa com marcador e HTTP ok/erro também bloqueia sem resolução causal fornecida pela porta confiável. Não confundir status de ledger com aceitação fiscal. Porta lerResolucaoFiscal deve ler prova persistida causal (reservaId,tipo,evidenciaReferencia), nunca aceitar confirmação do navegador/índice não correlacionado. Implementação probatória dessa porta pertence à integração de conciliação; padrão null mantém bloqueio.

## Coordenação compartilhada com B31

chaveCoordenacaoFs12 = fs12_coord_v1:SHA256(JSON[PortalClient,PA]). Linha AppSetting contém somente v/revision; INSERT ou UPDATE incrementa revision real. Não é estado fiscal, lease, agenda nem autorização. Não expira, não apaga resultado e não substitui reservas.

B31 futura: transacaoCoordenadaFs12(db,entrada,tx => comPortasB31NaTransacao(tx,ports => casoConfirmacao(...ports...))). Coordenar ANTES de qualquer leitura de ACL/contexto/revisão. A integração deverá adaptar a assinatura da confirmação sem mudar sua regra nem fazer duas transações. P2034, SQLSTATE40001 e P2010 meta.code40001 reiniciam transação COMPLETA, limitada a três; outros P2010/P2002 não viram retry genérico.

T2 ReadCommitted: ordem SERPRO global → política empresa → coordenaçãoFS12 → ACL/contexto → releitura de revisão → marcador. UPDATE bloqueia escritor concorrente; próxima consulta em ReadCommitted vê revisão já confirmada. B31 Serializable concorrente usa conflito de escrita e repetição completa; simples advisory lock não atualizaria snapshot antigo. Nenhum HTTP/KMS remoto deve acontecer dentro de callback com retry; resolvedor de chave do candidato precisa ser local/pré-resolvido na integração.

## Cifra de envelope

criarCifraEnvelopeFs12({keyId,resolveKey}) cifra bytes com tipo AAD ALTAN_FS12_ENVELOPE e identidade/reserva/comandoHash/envelopeHash. Sem corpoHash/httpStatus/recebidoEm fictícios. Envelope SQL permanece sete campos v/alg/keyId/nonce/ciphertext/tag/aadVersion, AES-256-GCM, nonce12/tag16, base64 canônico e máximo16MiB. Resolvedor histórico injetado, sem chave efêmera produtiva, fallback de chave atual ou alteração de crypto certificado/cifra de resposta v2. Nenhuma fixture é importada em produto.

Marcador T3a: adotar hashMarcadorCustodiaFs12 do candidato do revisor, SHA256 UTF8 JSON com chaves recursivamente ordenadas/arrays preservados. Os hooks não calculam marcador antes de ele existir. A composição de observação usará marcador efetivamente persistido.

## Integrações ainda obrigatórias e limites

- B31 versionado ainda não usa a coordenação: não afirmar que concorrência confirmação/despacho foi corrigida no produto.
- Snapshot atual de Fechamento entra transmitindo antes do guard. Candidato bloqueia esse estado conservadoramente. Para integrar, identificar reserva do próprio comando na snapshot com vínculo exato; não liberar transmitindo genericamente nem excluir toda pendência porque existe reservaId atual. Desenho e teste dessa transição pertencem ao próximo coordenador.
- Guard global não participa de T1 e não é relançado. T2 não abre nova TX; não pode ser chamado com Prisma global. Ordem com demais locks de ciclo fiscal deverá ser revisada ao conectar.
- Resultado confirmado de tentativa antiga não autoriza por si só nova declaração/retificação; elegibilidade do preparador, snapshot e guard preserva essa decisão. A porta de resolução não é autorização de despacho.
- Chaves/capacidades reais, ACL de filesystem, grants, T3b e seleção fiscal oficial são pendentes próprios. Não existe flag global de liberação.
- Unitários preparados cobrem replay/ACL/revisão, desconhecido com chave/revisão nova, vínculo ausente, retries e cifra.
- Harness PostgreSQL16 preparado usa dois processos/duas transações e pg_blocking_pids para comprovar espera real, incremento e isolamento por empresa/PA. Usa somente linhas AppSetting sintéticas e não declara provar T1/T2 completo nem confirmação B31 real. Testes completos de comandos/reservas/cadastro/ACL com modelos reais continuam pendentes de integração/fixtures.
- Nenhum teste, Node, build, PostgreSQL ou gate foi executado. Não há ready_for_human nem E2 completa.

Comandos futuros somente após incorporação e janela autorizada:
node --test apps/api/scripts/fs12-command/command.unit.test.mjs
NODE_ENV=test + DATABASE_URL igual ALTAN_GOVERNANCE_TEST_DATABASE_URL, PostgreSQL16 loopback/DB *_governance_test explicitamente reservado:
node --test apps/api/scripts/fs12-command/coordination.process.postgres.test.mjs

Rollback de código conserva comandos/reservas/custódia e linhas técnicas; não apagar evidências fiscais. Cleanup do harness limita-se às chaves aleatórias que ele próprio cria.
