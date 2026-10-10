import { useEffect, useId, useRef, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { WorkspaceHomeLink } from "./WorkspaceNavigation";
import { TaskCenterSlot } from "../../features/tasks/TaskCenterPlacement";
import "./office-navigation.css";

const OFFICE_AREAS = [
  {
    id: "operacao", label: "Operação", to: "/companies",
    links: [
      { label: "Empresas", to: "/companies", paths: ["/companies", "/obrigacoes", "/"] },
      { label: "Apuração", to: "/apuracao" },
      { label: "Consultas", to: "/funcoes-serpro", paths: ["/funcoes-serpro", "/download-notas"] },
      { label: "Rotinas", to: "/rotinas" },
      { label: "Guias não identificadas", to: "/guides/upload" },
    ],
  },
  {
    id: "suporte", label: "Suporte", to: "/suporte",
    links: [
      { label: "Atendimento", to: "/suporte", paths: ["/suporte", "/whatsapp"], exact: true },
      { label: "Comunicados", to: "/whatsapp/comunicados" },
      { label: "Pendências de e-mail", to: "/guides/pending", paths: ["/guides/pending", "/guides/batch-email"] },
    ],
  },
  {
    id: "comercial", label: "Comercial", to: "/comercial",
    links: [
      { label: "Hoje", to: "/comercial", exact: true },
      { label: "Oportunidades", to: "/comercial/oportunidades" },
      { label: "Conversas", to: "/comercial/conversas" },
      { label: "Onboarding", to: "/onboardings" },
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
export function OfficeNavigation({ resumoWhatsapp = null, resumoComercial = null }) {
  const location = useLocation();
  const [destinationsOpen, setDestinationsOpen] = useState(false);
  const destinationsId = useId();
  const disclosureRef = useRef(null);
  const triggerRef = useRef(null);
  const focusFirstLink = useRef(false);
  const pathname = location.pathname.replace(/\/+$/, "") || "/";
  const activeArea = OFFICE_AREAS.find((area) => area.links.some((link) => matchesLink(link, pathname)));
  const inCompany = /^\/companies\/(?!new(?:\/|$))[^/]+/.test(pathname);

  useEffect(() => { setDestinationsOpen(false); }, [location.pathname, location.search, location.hash]);

  useEffect(() => {
    if (!destinationsOpen) return undefined;
    if (focusFirstLink.current) {
      disclosureRef.current?.querySelector("nav a")?.focus();
      focusFirstLink.current = false;
    }
    const dismissOutside = (event) => {
      if (!disclosureRef.current?.contains(event.target)) setDestinationsOpen(false);
    };
    const dismissOnEscape = (event) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      setDestinationsOpen(false);
      triggerRef.current?.focus();
    };
    document.addEventListener("pointerdown", dismissOutside);
    document.addEventListener("focusin", dismissOutside);
    document.addEventListener("keydown", dismissOnEscape);
    return () => {
      document.removeEventListener("pointerdown", dismissOutside);
      document.removeEventListener("focusin", dismissOutside);
      document.removeEventListener("keydown", dismissOnEscape);
    };
  }, [destinationsOpen]);

  if (!activeArea) return null;
  const currentDestination = `${location.pathname}${location.search}${location.hash}`;
  const unread = resumoWhatsapp?.selo;
  const suportePendente = resumoWhatsapp?.pendenciasSuporte > 0 ? <span className="office-navigation__badge" aria-label={`${resumoWhatsapp.pendenciasSuporte} atendimentos precisam da equipe`}>{Math.min(99, resumoWhatsapp.pendenciasSuporte)}{resumoWhatsapp.pendenciasSuporte > 99 ? '+' : ''}</span> : null;
  const unreadBadge = unread ? <span className="office-navigation__badge" aria-label={`${unread} mensagens não lidas no WhatsApp`}>{unread}</span> : null;

  const destinations = <nav
    id={destinationsId}
    className="office-navigation__destinations office-navigation__destinations--popover"
    aria-label={`Navegação de ${activeArea.label}`}
  >
    {activeArea.links.map((link) => <Link
      key={link.to}
      to={link.to}
      className="office-navigation__destination"
      aria-current={matchesLink(link, pathname) ? "page" : undefined}
      title={link.to === "/whatsapp" ? resumoWhatsapp?.frase : undefined}
      >{link.label}{link.to === '/suporte' ? suportePendente : null}</Link>)}
  </nav>;

  return <div className={`office-navigation${inCompany ? " office-navigation--company" : ""}`}>
    <div className="office-navigation__top">
    <WorkspaceHomeLink />
    <nav className="office-navigation__areas" aria-label="Áreas do escritório">
      {OFFICE_AREAS.map((area) => <Link
        key={area.id}
        to={area.id === activeArea.id ? currentDestination : area.to}
        className="office-navigation__area"
        aria-current={area.id === activeArea.id ? "location" : undefined}
        title={area.id === "suporte" ? resumoWhatsapp?.frase : undefined}
      >{area.label}{area.id === "suporte" ? <>{unreadBadge}{suportePendente}</> : area.id === 'comercial' && resumoComercial?.selo ? <span className="office-navigation__badge" aria-label={`${resumoComercial.selo} mensagens comerciais não lidas`}>{resumoComercial.selo}</span> : null}</Link>)}
    </nav>
    <TaskCenterSlot />
    <div className="office-navigation__disclosure" ref={disclosureRef}>
      <button
        type="button"
        className="office-navigation__trigger"
        aria-label="Navegar"
        title="Navegar pelo escritório"
        ref={triggerRef}
        aria-expanded={destinationsOpen}
        aria-controls={destinationsId}
        onClick={() => setDestinationsOpen((open) => !open)}
        onKeyDown={(event) => {
          if (event.key !== "ArrowDown") return;
          event.preventDefault();
          if (destinationsOpen) disclosureRef.current?.querySelector("nav a")?.focus();
          else {
            focusFirstLink.current = true;
            setDestinationsOpen(true);
          }
        }}
      >
        <svg className="office-navigation__menu-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" aria-hidden="true"><path d="M4 6h16M4 12h16M4 18h16" /></svg>
      </button>
      {destinationsOpen && destinations}
    </div>
    </div>
  </div>;
}
