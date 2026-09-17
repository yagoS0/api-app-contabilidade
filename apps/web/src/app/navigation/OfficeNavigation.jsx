import { Link, useLocation } from "react-router-dom";
import { WorkspaceHomeLink } from "./WorkspaceNavigation";
import "./office-navigation.css";

const OFFICE_AREAS = [
  {
    id: "operacao", label: "Operação", to: "/companies",
    links: [
      { label: "Empresas e agenda", to: "/companies", paths: ["/companies", "/obrigacoes", "/"] },
      { label: "Apuração", to: "/apuracao" },
      { label: "Consultas", to: "/funcoes-serpro", paths: ["/funcoes-serpro", "/download-notas"] },
      { label: "Rotinas", to: "/rotinas" },
      { label: "Guias não identificadas", to: "/guides/upload" },
    ],
  },
  {
    id: "relacionamento", label: "Relacionamento", to: "/whatsapp",
    links: [
      { label: "Atendimento", to: "/whatsapp", exact: true },
      { label: "Entrada de clientes", to: "/onboardings" },
      { label: "Comunicados", to: "/whatsapp/comunicados" },
      { label: "Pendências de e-mail", to: "/guides/pending", paths: ["/guides/pending", "/guides/batch-email"] },
      { label: "Biblioteca", to: "/biblioteca" },
    ],
  },
  {
    id: "gestao", label: "Gestão", to: "/planejamento",
    links: [
      { label: "Planejamento", to: "/planejamento" },
      { label: "Laboratório", to: "/laboratorio" },
      { label: "Configurações", to: "/configuracoes", paths: ["/configuracoes", "/firm-settings"] },
    ],
  },
];

function matchesLink(link, pathname) {
  return (link.paths || [link.to]).some((path) =>
    pathname === path || (!link.exact && path !== "/" && pathname.startsWith(`${path}/`)));
}

// Rendered by the authenticated shell; public forms and login keep their own layout.
export function OfficeNavigation({ resumoWhatsapp = null }) {
  const location = useLocation();
  const pathname = location.pathname.replace(/\/+$/, "") || "/";
  const activeArea = OFFICE_AREAS.find((area) => area.links.some((link) => matchesLink(link, pathname)));
  if (!activeArea) return null;
  const currentDestination = `${location.pathname}${location.search}${location.hash}`;
  const unread = resumoWhatsapp?.selo;
  const unreadBadge = unread ? <span className="office-navigation__badge" aria-label={`${unread} mensagens não lidas no WhatsApp`}>{unread}</span> : null;

  return <div className="office-navigation">
    <div className="office-navigation__top">
    <WorkspaceHomeLink />
    <nav className="office-navigation__areas" aria-label="Áreas do escritório">
      {OFFICE_AREAS.map((area) => <Link
        key={area.id}
        to={area.id === activeArea.id ? currentDestination : area.to}
        className="office-navigation__area"
        aria-current={area.id === activeArea.id ? "location" : undefined}
        title={area.id === "relacionamento" ? resumoWhatsapp?.frase : undefined}
      >{area.label}{area.id === "relacionamento" && activeArea.id !== "relacionamento" ? unreadBadge : null}</Link>)}
    </nav>
    </div>
    <nav className="office-navigation__destinations" aria-label={`Navegação de ${activeArea.label}`}>
      {activeArea.links.map((link) => <Link
        key={link.to}
        to={link.to}
        className="office-navigation__destination"
        aria-current={matchesLink(link, pathname) ? "page" : undefined}
        title={link.to === "/whatsapp" ? resumoWhatsapp?.frase : undefined}
      >{link.label}{link.to === "/whatsapp" ? unreadBadge : null}</Link>)}
    </nav>
  </div>;
}
