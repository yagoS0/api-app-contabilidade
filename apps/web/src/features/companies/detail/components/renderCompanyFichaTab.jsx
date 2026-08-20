import { Button } from "../../../../components/ui/Button";
import { Painel } from "../../../../components/ui/Painel";
import { faltasParaEmitir } from "../../../../lib/nfse/cadastroEmissaoNfse";

// Ficha de cadastro — READ-ONLY, no formato da ficha que o escritório já usa em planilha.
// É a tela de consulta do dia a dia: antes, a única forma de ver o cadastro era abrir o
// formulário de edição. Editar é um botão daqui.
//
// Fonte dos dados: `selectedCompany.legacyCompany` (o backend já devolvia porte, capital e
// data de abertura em toda listagem — o frontend é que não lia).
//
// ⚠ A IDENTIDADE NÃO SE REPETE. Havia um `<h1>` com razão social + CNPJ aqui, dois centímetros
// abaixo do `company-topbar`, que mostra exatamente os mesmos dois campos em TODA aba da empresa.
// Quem chegou nesta tela chegou por dentro da empresa; repetir o nome dela não informa nada e
// empurra o conteúdo para baixo. O que ficou é a linha de AÇÃO — os selos de exceção e o Editar.
//
// ⚠ A LARGURA NÃO MORA MAIS AQUI. Era `maxWidth: 1100` cravado, e as abas vizinhas do mesmo grupo
// tinham 900 (Senhas, Anotações) e `--content-wide` (Documentos). Hoje quem decide é o
// `CompanyTabLayout` (`largura="leitura"`), num lugar só.
//
// ⚠ AS CORES SAEM DE `styles/tokens.css`. O `PANEL` local desta tela tinha cinco hex literais, e
// um deles era defeito de verdade: `dim: "#6b7280"` era a cor de TODOS os rótulos e mede 3,10:1
// sobre o fundo `#24253a` — abaixo do mínimo 4,5:1 da WCAG AA. É a mesma regressão que o
// comentário do `tokens.css` documenta ter consertado uma vez, com `--text-faint` (5,79:1).

const REGIME_LABEL = {
  SIMPLES: "Simples Nacional",
  LUCRO_PRESUMIDO: "Lucro Presumido",
  LUCRO_REAL: "Lucro Real",
  MEI: "MEI",
};

function fmtDate(value) {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toLocaleDateString("pt-BR");
}

function fmtMoney(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function fmtCnpj(value) {
  const d = String(value || "").replace(/\D+/g, "");
  if (d.length !== 14) return value || null;
  return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`;
}

function fmtCpf(value) {
  const d = String(value || "").replace(/\D+/g, "");
  if (d.length !== 11) return value || null;
  return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`;
}

function fmtCep(value) {
  const d = String(value || "").replace(/\D+/g, "");
  if (d.length !== 8) return value || null;
  return `${d.slice(0, 5)}-${d.slice(5)}`;
}

// Campo da ficha. Valor ausente aparece como "—" em vez de sumir: numa ficha, o vazio
// também é informação (mostra o que falta preencher).
function Campo({ label, value, wide = false }) {
  return (
    <div style={{ gridColumn: wide ? "span 2" : "auto", minWidth: 0 }}>
      <div style={{ fontSize: "0.7rem", color: "var(--text-faint)", textTransform: "uppercase", letterSpacing: "0.03em" }}>
        {label}
      </div>
      <div style={{ fontSize: "0.9rem", color: value ? "var(--text)" : "var(--text-faint)", wordBreak: "break-word" }}>
        {value || "—"}
      </div>
    </div>
  );
}

function Grade({ cols, children }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`, gap: "var(--space-3)" }}>
      {children}
    </div>
  );
}

/**
 * Um bloco da ficha.
 *
 * ⚠⚠ O VAZIO CONTINUA VISÍVEL — ELE SÓ PAROU DE OCUPAR A TELA INTEIRA. Decisão do dono, com a
 * tela da IOHANNA na frente: aquela empresa tem ~15 travessões espalhados por seis blocos, e um
 * paredão de "—" esconde o que ESTÁ preenchido tão bem quanto esconderia o que falta.
 *
 * A regra antiga ("numa ficha, o vazio também é informação") NÃO foi revertida, e é por isso que
 * os ausentes não sumiram: eles condensam numa linha que diz QUANTOS são e abre com um clique.
 * Trocar isto por "renderiza só o preenchido" devolveria o defeito que a regra existe para
 * impedir — não haveria como distinguir "cadastro completo" de "ninguém preencheu".
 */
function Bloco({ titulo, cols = 3, campos = [], children, id }) {
  const preenchidos = campos.filter((c) => c.value);
  const vazios = campos.filter((c) => !c.value);

  return (
    <Painel titulo={titulo} id={id}>
      {preenchidos.length > 0 ? (
        <Grade cols={cols}>
          {preenchidos.map((c) => (
            <Campo key={c.label} label={c.label} value={c.value} wide={c.wide} />
          ))}
        </Grade>
      ) : null}

      {vazios.length > 0 ? (
        <details className="detalhe-recolhivel" style={{ marginTop: preenchidos.length ? "var(--space-3)" : 0 }}>
          <summary>
            {vazios.length} {vazios.length === 1 ? "campo em branco" : "campos em branco"}
          </summary>
          <div style={{ marginTop: "var(--space-2)" }}>
            <Grade cols={cols}>
              {vazios.map((c) => (
                <Campo key={c.label} label={c.label} value={null} wide={c.wide} />
              ))}
            </Grade>
          </div>
        </details>
      ) : null}

      {children}
    </Painel>
  );
}

export function CompanyFichaTab({ selectedCompany, canEditCompany, onEdit }) {
  const c = selectedCompany || {};
  const lg = c.legacyCompany || {};
  // ⚠ Lido da MESMA linha que `buildMissingFields` lê — a `Company` (`legacyCompany`). A inscrição
  // municipal do topo do payload é do `PortalClient` e pode estar preenchida enquanto a coluna da
  // `Company` não está; a ficha diria "está tudo certo" e a emissão recusaria mesmo assim.
  // ⚠ `cnpj` NÃO está no `legacyCompanySelect` da rota — ele só volta no topo do payload (o
  // `PortalClient`). Sem o fallback a ficha acusaria "falta o CNPJ" em TODA empresa, que é o
  // oposto do que este aviso existe para fazer. É o único campo desta lista com duas fontes.
  const faltasDaEmissao = faltasParaEmitir({ ...lg, cnpj: lg.cnpj || c.cnpj });
  const end = lg.enderecoJson && typeof lg.enderecoJson === "object" ? lg.enderecoJson : {};
  const socios = Array.isArray(lg.partners) ? lg.partners : [];
  const historico = Array.isArray(lg.regimeHistorico) ? lg.regimeHistorico : [];
  const cnaesSec = Array.isArray(lg.cnaesSecundarios) ? lg.cnaesSecundarios : [];
  const regimeAtual = lg.regimeTributario || lg.tipoTributario;

  const selo = { padding: "4px 10px", borderRadius: 999, fontSize: "0.78rem", fontWeight: 700 };

  return (
    <div>
      {/* A linha de AÇÃO. Sem título: quem é a empresa está no topbar, e a sub-aba já se chama
          "Cadastro". Selo só aparece na EXCEÇÃO — mesma regra do card da carteira. */}
      <div style={{ display: "flex", justifyContent: "flex-end", alignItems: "center", gap: "var(--space-2)", marginBottom: "var(--space-3)", flexWrap: "wrap" }}>
        {c.status === "SUSPENSA" && (
          <span style={{ ...selo, color: "var(--state-warn)", background: "var(--state-warn-surface)", border: "1px solid var(--state-warn)" }}>
            Suspensa
          </span>
        )}
        {c.empresaZerada && (
          <span style={{ ...selo, color: "var(--accent-cyan)", background: "var(--state-neutral-surface)", border: "1px solid var(--accent-cyan)" }}>
            Zerada
          </span>
        )}
        <Button
          variant="secondary"
          onClick={onEdit}
          disabled={!canEditCompany}
          title={!canEditCompany ? "Apenas admin ou contador pode editar." : undefined}
        >
          ✎ Editar
        </Button>
      </div>

      <Bloco
        titulo="Identificação"
        campos={[
          { label: "CNPJ", value: fmtCnpj(c.cnpj) },
          { label: "Data de abertura", value: fmtDate(lg.dataAbertura) },
          { label: "Porte", value: lg.porte },
          { label: "Razão social", value: lg.razaoSocial || c.razao, wide: true },
          { label: "Nome fantasia", value: lg.nomeFantasia },
          { label: "Natureza jurídica", value: lg.naturezaJuridica },
          { label: "Abriu com", value: lg.abriuCom },
          { label: "Responsável", value: c.ownerName },
          { label: "E-mail do responsável", value: c.ownerEmail },
        ]}
      />

      <Bloco
        titulo="Endereço"
        campos={[
          { label: "Logradouro", value: end.rua, wide: true },
          { label: "Número", value: end.numero },
          { label: "Complemento", value: end.complemento },
          { label: "Bairro", value: end.bairro },
          { label: "CEP", value: fmtCep(end.cep) },
          { label: "Município", value: end.cidade || c.municipio },
          { label: "Estado", value: end.uf || c.uf },
        ]}
      />

      <Bloco
        titulo="Registros e inscrições"
        id="ficha-inscricoes"
        campos={[
          { label: "Nº de registro", value: lg.numeroRegistro },
          { label: "Tipo de registro", value: lg.tipoRegistro },
          { label: "Diário nº", value: lg.diarioNumero },
          { label: "Inscrição municipal", value: c.inscricaoMunicipal || lg.inscricaoMunicipal },
          { label: "Data da IM", value: fmtDate(lg.inscricaoMunicipalData) },
          { label: "Inscrição estadual", value: lg.inscricaoEstadual },
          { label: "Data da IE", value: fmtDate(lg.inscricaoEstadualData) },
          // ⚠ O município EMISSOR (código IBGE) não é o mesmo dado que o município do ENDEREÇO logo
          // acima: um é texto cadastral, o outro é o `cLocEmi` da nota. Ficam em blocos diferentes
          // de propósito — foi tratar os dois como a mesma coisa que produziu a ideia de derivar o
          // código a partir do nome. Vazio aqui quer dizer que a empresa não emite NFS-e.
          { label: "Município emissor (IBGE)", value: lg.codigoMunicipioIbge, wide: true },
        ]}
      >
        {!lg.codigoMunicipioIbge && (
          <div style={{ marginTop: "var(--space-3)", fontSize: "0.75rem", color: "var(--state-warn)" }}>
            Sem o município emissor esta empresa não emite nota de serviço — o servidor recusa a
            emissão. Preencha em <strong>Editar</strong>, escolhendo o município na lista do IBGE.
          </div>
        )}
      </Bloco>

      {/* ⚠ BLOCO PRÓPRIO, e não mais três linhas soltas em "Registros e inscrições": estes campos
          não descrevem a empresa, descrevem a NOTA que este sistema emite por ela. Eles são o que
          `buildMissingFields` confere, e até um tempo atrás não apareciam em tela nenhuma — a
          emissão recusava por eles e não havia por onde preenchê-los. */}
      <Bloco
        titulo="Emissão de NFS-e"
        id="ficha-emissao-nfse"
        campos={[
          { label: "Código nacional do serviço", value: lg.codigoServicoNacional },
          { label: "Código municipal do serviço", value: lg.codigoServicoMunicipal },
          { label: "Série da DPS", value: lg.rpsSerie },
          // ⚠ CARGA TRIBUTÁRIA APROXIMADA (Lei 12.741/2012). Aparece na FICHA porque é o número que
          // a nota IMPRIME ao tomador — conferir isto é trabalho de contador, e até aqui não havia
          // onde vê-lo sem abrir o formulário de edição.
          // ⚠ `!= null`, nunca `||`: `0` é um percentual conferido (serviço não tem ICMS), e com
          // `||` ele apareceria como ausente — a ficha diria "não configurado" sobre um campo que
          // o contador preencheu com zero de propósito.
          { label: "Carga aprox. federal (%)", value: lg.pTotTribFed != null ? String(lg.pTotTribFed) : null },
          { label: "Carga aprox. estadual (%)", value: lg.pTotTribEst != null ? String(lg.pTotTribEst) : null },
          { label: "Carga aprox. municipal (%)", value: lg.pTotTribMun != null ? String(lg.pTotTribMun) : null },
        ]}
      >
        {faltasDaEmissao.length > 0 && (
          <div style={{ marginTop: "var(--space-3)", fontSize: "0.75rem", color: "var(--state-warn)" }}>
            {/* ⚠ Nomeia QUAL campo falta E ONDE ele fica. "Configuração incompleta" mandaria o
                contador procurar; e os campos não moram todos no mesmo bloco do formulário — a
                inscrição municipal fica em Inscrições, os outros em Emissão de NFS-e. */}
            Enquanto faltar o que está abaixo, esta empresa <strong>não emite nota de serviço</strong>:
            o servidor recusa a emissão inteira.
            <ul style={{ margin: "6px 0 0", paddingLeft: 18 }}>
              {faltasDaEmissao.map((f) => (
                <li key={f.campo}>{f.rotulo} — preencha em <strong>Editar</strong> → {f.onde.replace("Editar cadastro → ", "")}</li>
              ))}
            </ul>
          </div>
        )}
      </Bloco>

      <Bloco
        titulo="Atividades"
        cols={1}
        campos={[
          { label: "CNAE principal", value: lg.cnaePrincipal },
          { label: "CNAEs secundários", value: cnaesSec.length > 0 ? cnaesSec.join(" · ") : null },
        ]}
      />

      {/* Regime: o atual manda no sistema; o histórico é informativo (registro do escritório).
          ⚠ SEM HISTÓRICO, ISTO NÃO PRECISA DE TABELA — precisa de uma linha. O painel inteiro
          existia para exibir a frase "Nenhum histórico cadastrado", gastando a altura de seis
          campos preenchidos. O regime ATUAL, que é o que manda no sistema, fica no cabeçalho:
          é a informação que se procura aqui em quase toda visita. */}
      <Painel
        titulo="Regime tributário"
        acoes={
          <span style={{ fontSize: "0.8rem", color: "var(--text-muted)" }}>
            Atual: <strong style={{ color: "var(--text)" }}>{REGIME_LABEL[regimeAtual] || regimeAtual || "—"}</strong>
            {lg.desoneracao ? <span style={{ color: "var(--state-warn)", marginLeft: 8 }}>c/ desoneração</span> : null}
          </span>
        }
      >
        {historico.length === 0 ? (
          <p style={{ margin: 0, fontSize: "0.8rem", color: "var(--text-faint)" }}>
            Nenhuma vigência registrada. Use Editar para incluir o histórico.
          </p>
        ) : (
          <div className="table-wrap">
            <table className="tabela--densa">
              <thead>
                <tr>
                  <th>Regime</th>
                  <th>De</th>
                  <th>Até</th>
                  <th>Impostos</th>
                </tr>
              </thead>
              <tbody>
                {historico.map((h) => (
                  <tr key={h.id}>
                    <td style={{ fontWeight: 600 }}>
                      {REGIME_LABEL[h.regime] || h.regime}
                      {h.desoneracao && <span style={{ color: "var(--state-warn)", fontSize: "0.75rem", marginLeft: 6 }}>c/ desone</span>}
                    </td>
                    <td>{fmtDate(h.vigenciaInicio)}</td>
                    <td style={{ color: h.vigenciaFim ? "var(--text)" : "var(--state-ok)" }}>
                      {fmtDate(h.vigenciaFim) || "vigente"}
                    </td>
                    <td style={{ color: "var(--text-muted)" }}>
                      {Array.isArray(h.impostos) && h.impostos.length > 0 ? h.impostos.join("/") : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Painel>

      <Painel
        titulo="Sócios"
        acoes={
          <span style={{ fontSize: "0.8rem", color: "var(--text-muted)" }}>
            Capital social: <strong style={{ color: "var(--text)" }}>{fmtMoney(lg.capitalSocial) || "—"}</strong>
            {(lg.alteracaoNumero || lg.alteracaoData) && (
              <span style={{ marginLeft: 12, color: "var(--text-faint)" }}>
                {lg.alteracaoNumero ? `${lg.alteracaoNumero}ª alteração` : "Alteração"}
                {lg.alteracaoData ? ` em ${fmtDate(lg.alteracaoData)}` : ""}
              </span>
            )}
          </span>
        }
      >
        {socios.length === 0 ? (
          <p style={{ margin: 0, fontSize: "0.8rem", color: "var(--text-faint)" }}>
            Nenhum sócio cadastrado. Use Editar para incluir.
          </p>
        ) : (
          <div className="table-wrap">
            <table className="tabela--densa">
              <thead>
                <tr>
                  <th>Nome</th>
                  <th>CPF</th>
                  <th>%</th>
                  <th>Nascimento</th>
                  <th>RG</th>
                  <th>Situação</th>
                </tr>
              </thead>
              <tbody>
                {socios.map((s) => {
                  const saiu = Boolean(s.dataSaida);
                  return (
                    <tr key={s.id} style={{ opacity: saiu ? 0.55 : 1 }}>
                      <td style={{ fontWeight: 600 }}>
                        {s.name}
                        {s.representante && <span style={{ color: "var(--accent-purple)", fontSize: "0.72rem", marginLeft: 6 }}>representante</span>}
                      </td>
                      <td>{fmtCpf(s.documento)}</td>
                      <td>{s.participacao != null ? `${Number(s.participacao)}%` : "—"}</td>
                      <td>{fmtDate(s.dataNascimento) || "—"}</td>
                      <td>
                        {s.rg || "—"}
                        {s.rgOrgaoEmissor && <span style={{ color: "var(--text-faint)" }}> {s.rgOrgaoEmissor}</span>}
                      </td>
                      <td style={{ color: saiu ? "var(--state-danger)" : "var(--state-ok)" }}>
                        {saiu ? `Saiu em ${fmtDate(s.dataSaida)}` : "Ativo"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Painel>

      <Bloco
        titulo="Contato"
        campos={[
          { label: "Telefone", value: lg.telefone || c.telefone },
          { label: "E-mail", value: lg.email || c.email },
          { label: "E-mail para guias", value: c.guideNotificationEmail },
        ]}
      />
    </div>
  );
}
