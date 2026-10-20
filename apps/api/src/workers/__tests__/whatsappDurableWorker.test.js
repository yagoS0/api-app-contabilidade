jest.mock("../../config.js",()=>({INTEGRACAO_WHATSAPP:true,log:{error:jest.fn()}}));
jest.mock("../../application/whatsapp/WhatsappInboxService.js",()=>({processarInboxWhatsappUmaVez:jest.fn()}));
jest.mock("../../application/assistente/TurnoIaWhatsappService.js",()=>({processarTurnosIaUmaVez:jest.fn()}));
jest.mock("../../application/onboarding/WatchdogComercialService.js",()=>({processarContingenciasComerciaisUmaVez:jest.fn().mockResolvedValue({})}));
import {iniciarWorkerWhatsappDuravel,pararWorkerWhatsappDuravel} from "../whatsappDurableWorker.js";
import {processarInboxWhatsappUmaVez} from "../../application/whatsapp/WhatsappInboxService.js";
import {processarTurnosIaUmaVez} from "../../application/assistente/TurnoIaWhatsappService.js";
import {processarContingenciasComerciaisUmaVez} from "../../application/onboarding/WatchdogComercialService.js";
it("inbox continua durante IA lenta e shutdown aguarda turno atual",async()=>{
 jest.useFakeTimers();let terminar;const lento=new Promise(resolve=>{terminar=resolve;});
 processarInboxWhatsappUmaVez.mockResolvedValue({});processarTurnosIaUmaVez.mockReturnValue(lento);
 iniciarWorkerWhatsappDuravel();await jest.advanceTimersByTimeAsync(6000);
 expect(processarInboxWhatsappUmaVez.mock.calls.length).toBeGreaterThan(1);expect(processarTurnosIaUmaVez).toHaveBeenCalledTimes(1);
 let encerrado=false;const fim=pararWorkerWhatsappDuravel().then(()=>{encerrado=true;});await Promise.resolve();expect(encerrado).toBe(false);
 terminar({});await fim;expect(encerrado).toBe(true);const n=processarInboxWhatsappUmaVez.mock.calls.length;await jest.advanceTimersByTimeAsync(10000);expect(processarInboxWhatsappUmaVez).toHaveBeenCalledTimes(n);
 jest.useRealTimers();
});

it("contingência continua mesmo com coleta síncrona e turno IA travados",async()=>{
 jest.useFakeTimers(); let liberarInbox, liberarIa;
 processarInboxWhatsappUmaVez.mockReturnValue(new Promise(r=>{liberarInbox=r;}));
 processarTurnosIaUmaVez.mockReturnValue(new Promise(r=>{liberarIa=r;}));
 processarContingenciasComerciaisUmaVez.mockClear();
 iniciarWorkerWhatsappDuravel(); await jest.advanceTimersByTimeAsync(62000);
 expect(processarContingenciasComerciaisUmaVez).toHaveBeenCalledTimes(3);
 liberarInbox({}); liberarIa({}); await pararWorkerWhatsappDuravel();
 jest.useRealTimers();
});

jest.mock("../../application/onboarding/FiscalLeadService.js", () => ({ criarFiscalLead: () => ({ processarUmaVez: (...args) => mockFiscal(...args) }) }));
jest.mock("../../application/whatsapp/ComunicadosWhatsappService.js", () => ({ criarComunicadosWhatsapp: () => ({ processarUmaVez: async () => ({}) }) }));
jest.mock("../../application/whatsapp/TesteIaWhatsappService.js", () => ({ criarTesteIaWhatsapp: () => ({ processarUmaVez: async () => ({}) }) }));
const mockFiscal = jest.fn(async () => ({}));
test.each([[false,false], [false,true], [true,false], [true,true]])(
  "flags WhatsApp=%s Fiscal=%s respeitam cada integração", async (whatsapp, fiscal) => {
    jest.resetModules(); jest.clearAllMocks(); jest.useFakeTimers();
    jest.doMock("../../config.js", () => ({ INTEGRACAO_WHATSAPP: whatsapp, INTEGRACAO_FISCAL_LEADS: fiscal, log: { error: jest.fn() } }));
    const inbox = require("../../application/whatsapp/WhatsappInboxService.js").processarInboxWhatsappUmaVez;
    inbox.mockResolvedValue({});
    require("../../application/assistente/TurnoIaWhatsappService.js").processarTurnosIaUmaVez.mockResolvedValue({});
    const worker = require("../whatsappDurableWorker.js");
    try {
      worker.iniciarWorkerWhatsappDuravel();
      expect(mockFiscal).toHaveBeenCalledTimes(fiscal ? 1 : 0);
      expect(inbox).toHaveBeenCalledTimes(whatsapp ? 1 : 0);
      worker.iniciarWorkerWhatsappDuravel();
      expect(mockFiscal).toHaveBeenCalledTimes(fiscal ? 1 : 0);
    } finally { await worker.pararWorkerWhatsappDuravel(); jest.useRealTimers(); }
  });