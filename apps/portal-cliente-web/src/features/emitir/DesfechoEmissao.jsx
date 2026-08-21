import { TIPO } from "./lib/desfechoEmissao";
import { mensagemDeErro } from "../../lib/mensagens";
import { TRACO, brl, texto } from "../../lib/format";

// Nomes dos campos do cadastro que o backend devolve em `company_missing_fields`
// (`REQUIRED_COMPANY_FIELDS`, em `apps/api/src/application/nfse/NfseService.js`), traduzidos.
// ⚠ Sem tradução o cliente lê `codigoServicoMunicipal` e liga para o escritório perguntando o que
// é isso — a lista existe justamente para o telefonema já começar resolvido.
const NOME_DO_CAMPO = {
  cnpj: "CNPJ da empresa",
  inscricaoMunicipal: "inscrição municipal",
  codigoServicoNacional: "código de serviço nacional",
  codigoServicoMunicipal: "código de serviço municipal",
  rpsSerie: "série do RPS",
};

function LinhaDado({ rotulo, valor }) {
  return (
    <>
      <dt>{rotulo}</dt>
      <dd>{valor}</dd>
    </>
  );
}

/**
 * O QUE ACONTECEU DEPOIS DE "EMITIR" — um bloco por desfecho, e nunca o mesmo bloco para dois.
 *
 * ⚠⚠ **AS TRÊS CAMADAS TÊM TRÊS DESENHOS, E ISSO NÃO É ESTÉTICA.**
 *
 *   `NOSSA`      → nada saiu daqui. Corrija e envie de novo; nenhum número foi consumido.
 *   `TRANSPORTE` → **não se sabe se a nota foi emitida**. A tela NÃO oferece reenvio — nem botão,
 *                  nem retentativa automática. Reemitir pode gerar nota em duplicidade, e a NFS-e
 *                  **não tem inutilização**: número queimado é buraco permanente. A saída é
 *                  consultar antes.
 *   `RECEITA`    → a nota foi analisada e recusada. Fato fiscal: corrija a NOTA e emita de novo.
 *
 * Antes de a camada existir no backend, os três eram o mesmo "rejeitada" — e quem lia não tinha
 * como saber se corrigia, se esperava ou se consultava.
 */
// ⚠ O PROP DE VOLTA MUDOU DE NOME EM 19/08/2026, e a troca não é cosmética: a emissão deixou de
// ser rota e virou um MODO da tela de Notas (ver `shell/AppShell.jsx`). Este componente só usava o
// prop antigo para um destino — a lista de notas —, quatro vezes, sempre o mesmo. Ou seja: o que
// ele sempre quis dizer foi "volte para a lista". Um prop chamado "navegar" que não navega
// mentiria, e o argumento de destino viraria um parâmetro morto que alguém trocaria por outro.
/**
 * ⚠ A MESMA GARANTIA, ESCRITA UMA VEZ. Ela aparecia em QUATRO ramos deste arquivo, em quatro
 * redações diferentes ("Nada saiu daqui e nenhum número de nota foi consumido", "Nada foi enviado
 * ao sistema nacional", "…Isso se resolve no escritório, não aqui", "A nota não foi enviada e
 * nenhum número foi consumido. Se você conseguiu abrir o formulário…").
 *
 * ⚠ O QUE ELA AFIRMA NÃO MUDOU, e é o que decide: **é seguro tentar de novo**. Sem ela, quem
 * recebeu uma recusa fica com medo de emitir em duplicidade — que é o oposto do ramo TRANSPORTE,
 * onde a tela manda NÃO reenviar. A distinção entre os dois é a razão deste arquivo existir.
 *
 * O que saiu foi o rabo de cada cópia: "isso se resolve no escritório, não aqui" (o ramo já diz
 * o que falta e onde) e "se você conseguiu abrir o formulário e mesmo assim recebeu isto, a
 * permissão mudou enquanto você preenchia" — que descreve a NOSSA condição de corrida entre ler o
 * portão na abertura e conferi-lo no envio.
 */
const NADA_FOI_ENVIADO = "Nada foi enviado e nenhum número de nota foi consumido — tentar de novo é seguro.";

export function DesfechoEmissao({ desfecho, aoCorrigir, aoNovaNota, aoVoltarParaNotas }) {
  if (!desfecho) return null;

  // ── SUCESSO ───────────────────────────────────────────────────────────────────────────────
  if (desfecho.tipo === TIPO.SUCESSO) {
    const nfse = desfecho.nfse || {};
    return (
      <div className="card card-success" role="status">
        <h2>Nota {texto(nfse.numeroNfse)} emitida</h2>
        <p className="muted">
          A nota foi aceita pelo sistema nacional. Ela já aparece na sua lista de notas.
        </p>
        <dl>
          <LinhaDado rotulo="Número da NFS-e" valor={texto(nfse.numeroNfse)} />
          <LinhaDado rotulo="Código de verificação" valor={texto(nfse.codigoVerificacao)} />
          <LinhaDado
            rotulo="Série / número do RPS"
            valor={
              nfse.rpsSerie || nfse.rpsNumero
                ? `${texto(nfse.rpsSerie)} / ${texto(nfse.rpsNumero)}`
                : TRACO
            }
          />
          <LinhaDado rotulo="Tomador" valor={texto(nfse.tomadorNome)} />
          <LinhaDado
            rotulo="Valor"
            valor={nfse.valorServicos == null ? TRACO : brl(nfse.valorServicos)}
          />
          <LinhaDado rotulo="Chave de acesso" valor={texto(nfse.chaveAcesso)} />
        </dl>
        <div className="actions">
          <button type="button" className="btn" onClick={aoNovaNota}>
            Emitir outra nota
          </button>
          <button type="button" className="btn btn-primary" onClick={aoVoltarParaNotas}>
            Ver minhas notas
          </button>
        </div>
      </div>
    );
  }

  // ── 202: ACEITO, MAS AINDA NÃO EMITIDO ────────────────────────────────────────────────────
  // ⚠ Não é sucesso e não pode ser desenhado como tal: a linha existe e a nota, não.
  if (desfecho.tipo === TIPO.EM_PROCESSAMENTO) {
    return (
      <div className="alerta alerta-info" role="status">
        <p>
          <strong>Pedido enviado — a nota ainda não foi confirmada.</strong>
        </p>
        <p>
          O sistema nacional recebeu o pedido e ainda não devolveu o número da nota. Acompanhe pela
          lista de notas. <strong>Não envie a mesma nota de novo</strong> enquanto esta não se
          resolver — duas notas iguais não têm como ser desfeitas.
        </p>
        <div className="actions">
          <button type="button" className="btn btn-primary" onClick={aoVoltarParaNotas}>
            Ver minhas notas
          </button>
          {/* ⚠ "OUTRA nota", e o formulário é limpo antes de reaparecer — não é um caminho de
              volta para reenviar ESTA. Sem esta saída a tela vira um beco: o único jeito de voltar
              ao formulário seria sair da aba e entrar de novo. */}
          <button type="button" className="btn" onClick={aoNovaNota}>
            Preencher outra nota
          </button>
        </div>
      </div>
    );
  }

  // ── TRANSPORTE: A LINHA DO MEIO ───────────────────────────────────────────────────────────
  //
  // ⚠⚠ NENHUM BOTÃO DE REENVIO EXISTE NESTE RAMO, E É PROPOSITAL. Não é "reenviar com aviso": é
  // não oferecer. O formulário é DESCARTADO — recomeçar é um ato deliberado, não um clique.
  // Âmbar, não vermelho: isto não é uma recusa, é uma dúvida, e pintá-la de erro faria a pessoa
  // concluir que a nota não saiu.
  if (desfecho.tipo === TIPO.TRANSPORTE) {
    return (
      <div className="alerta alerta-aviso" role="alert">
        <p>
          <strong>Não sabemos se esta nota foi emitida.</strong>
        </p>
        <p>
          O pedido saiu daqui, mas o sistema nacional não respondeu. Ele pode ter registrado a nota
          e pode não ter — não há como afirmar nenhuma das duas coisas a partir daqui.
        </p>
        <p>
          <strong>Não emita esta nota de novo por conta própria.</strong> Se ela já tiver sido
          registrada, uma segunda emissão gera uma nota em duplicidade; e a NFS-e não tem
          inutilização, ou seja, um número não pode ser simplesmente descartado.
        </p>
        <p>
          <strong>O que fazer:</strong>{" "}
          {desfecho.correcao ||
            "Fale com o seu contador para que ele consulte esta nota no sistema nacional antes de qualquer nova tentativa."}
        </p>
        <p className="muted">
          Referência para o contador: {texto(desfecho.codigo)}
          {desfecho.extra?.nfse?.rpsSerie || desfecho.extra?.nfse?.rpsNumero
            ? ` · RPS série ${texto(desfecho.extra.nfse.rpsSerie)} nº ${texto(desfecho.extra.nfse.rpsNumero)}`
            : ""}
        </p>
        <div className="actions">
          <button type="button" className="btn" onClick={aoVoltarParaNotas}>
            Ver minhas notas
          </button>
          <button type="button" className="btn" onClick={aoNovaNota}>
            Preencher uma nota diferente
          </button>
        </div>
      </div>
    );
  }

  // ── RECEITA: recusa fiscal ────────────────────────────────────────────────────────────────
  if (desfecho.tipo === TIPO.RECEITA) {
    return (
      <div className="alerta alerta-erro" role="alert">
        <p>
          <strong>O sistema nacional recusou esta nota.</strong>
        </p>
        <p>{desfecho.message || "A nota foi analisada e não foi aceita."}</p>
        {desfecho.correcao ? (
          <p>
            <strong>O que fazer:</strong> {desfecho.correcao}
          </p>
        ) : (
          <p>
            Corrija os dados da nota e emita de novo. Se não estiver claro o que corrigir, mostre o
            código abaixo ao seu contador.
          </p>
        )}
        <p className="muted">Código da recusa: {texto(desfecho.codigo)}</p>
        <div className="actions">
          <button type="button" className="btn btn-primary" onClick={aoCorrigir}>
            Corrigir e emitir de novo
          </button>
        </div>
      </div>
    );
  }

  // ── NOSSA: recusamos antes de enviar ──────────────────────────────────────────────────────
  if (desfecho.tipo === TIPO.NOSSA) {
    return (
      <div className="alerta alerta-erro" role="alert">
        <p>
          <strong>A nota não chegou a ser enviada.</strong>
        </p>
        <p>{desfecho.message || "Faltou algum dado para montar a nota."}</p>
        {desfecho.correcao ? (
          <p>
            <strong>O que fazer:</strong> {desfecho.correcao}
          </p>
        ) : null}
        <p className="muted">
          {NADA_FOI_ENVIADO} Código: {texto(desfecho.codigo)}
        </p>
        <div className="actions">
          <button type="button" className="btn btn-primary" onClick={aoCorrigir}>
            Corrigir e enviar de novo
          </button>
        </div>
      </div>
    );
  }

  // ── Recusa do validador: campo do formulário ──────────────────────────────────────────────
  if (desfecho.tipo === TIPO.PEDIDO_INVALIDO) {
    return (
      <div className="alerta alerta-erro" role="alert">
        <p>
          <strong>Confira os dados da nota.</strong>
        </p>
        <p>{mensagemDeErro({ code: desfecho.codigo, status: 400 }, "Algum campo não foi aceito.")}</p>
        <p className="muted">{NADA_FOI_ENVIADO}</p>
        <div className="actions">
          <button type="button" className="btn btn-primary" onClick={aoCorrigir}>
            Voltar ao formulário
          </button>
        </div>
      </div>
    );
  }

  // ── Impedimento no cadastro da empresa ────────────────────────────────────────────────────
  if (desfecho.tipo === TIPO.EMPRESA) {
    const faltando = Array.isArray(desfecho.extra?.missing) ? desfecho.extra.missing : [];
    return (
      <div className="alerta alerta-erro" role="alert">
        <p>
          <strong>Esta empresa ainda não pode emitir.</strong>
        </p>
        <p>{mensagemDeErro({ code: desfecho.codigo, status: 400 }, "Falta configuração no cadastro da empresa.")}</p>
        {faltando.length ? (
          <p>
            Falta no cadastro:{" "}
            {faltando.map((campo) => NOME_DO_CAMPO[campo] || campo).join(", ")}.
          </p>
        ) : null}
        <p className="muted">{NADA_FOI_ENVIADO}</p>
        <div className="actions">
          {/* Nada saiu da máquina: voltar ao formulário com os dados intactos é seguro, e evita
              que a pessoa perca o que digitou enquanto fala com o contador. */}
          <button type="button" className="btn" onClick={aoCorrigir}>
            Voltar ao formulário
          </button>
        </div>
      </div>
    );
  }

  // ── O PORTÃO, RECUSANDO NO ENVIO ──────────────────────────────────────────────────────────
  //
  // ⚠ ESTE RAMO NÃO É REDUNDANTE COM A TELA DE PORTÃO FECHADO. A tela lê o portão quando a página
  // abre; o servidor o confere no INSTANTE do envio. Entre um e outro o contador pode ter revogado
  // a liberação, ou o OWNER pode ter mudado o papel de quem está digitando — e nesses casos a
  // recusa chega aqui, já com a nota preenchida. Cair no ramo "não sabemos o que aconteceu"
  // mandaria a pessoa conferir a lista de notas por causa de um 403 em que **nada saiu da
  // máquina**, e esconderia o único fato que ela precisa saber: quem tem de agir agora.
  if (desfecho.tipo === TIPO.PORTAO) {
    const papelInsuficiente = desfecho.codigo === "EMISSAO_CLIENTE_PAPEL_INSUFICIENTE";
    return (
      <div className="alerta alerta-aviso" role="alert">
        <p>
          <strong>
            {papelInsuficiente
              ? "Seu perfil nesta empresa não emite notas."
              : "A emissão não está liberada para esta empresa."}
          </strong>
        </p>
        <p>{desfecho.message || "A permissão de emissão mudou."}</p>
        {desfecho.correcao ? <p>{desfecho.correcao}</p> : null}
        <p className="muted">{NADA_FOI_ENVIADO}</p>
      </div>
    );
  }

  // ── Sessão ────────────────────────────────────────────────────────────────────────────────
  if (desfecho.tipo === TIPO.SESSAO) {
    return (
      <div className="alerta alerta-erro" role="alert">
        <p>Sua sessão expirou antes de a nota ser enviada. Entre novamente para continuar.</p>
      </div>
    );
  }

  // ── Desconhecido ──────────────────────────────────────────────────────────────────────────
  //
  // ⚠ MESMO CUIDADO DO TRANSPORTE, E PELA MESMA RAZÃO. Rede caída, erro de servidor, resposta que
  // não se soube ler: em nenhum desses se sabe se a emissão aconteceu. Um "tentar de novo" aqui
  // seria presumir que não aconteceu — a suposição mais cara que esta tela poderia fazer.
  return (
    <div className="alerta alerta-aviso" role="alert">
      <p>
        <strong>Não conseguimos confirmar o que aconteceu com esta nota.</strong>
      </p>
      <p>{mensagemDeErro({ code: desfecho.codigo }, "A resposta do servidor não chegou ou não foi entendida.")}</p>
      <p>
        <strong>Confira a sua lista de notas antes de tentar emitir de novo</strong> — se esta nota
        já estiver lá, emitir outra criaria uma nota em duplicidade.
      </p>
      <div className="actions">
        <button type="button" className="btn btn-primary" onClick={aoVoltarParaNotas}>
          Ver minhas notas
        </button>
      </div>
    </div>
  );
}
