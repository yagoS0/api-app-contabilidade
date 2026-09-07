jest.mock("../../config.js",()=>({INTEGRACAO_WHATSAPP:true,log:{error:jest.fn()}}));
jest.mock("../../application/whatsapp/WhatsappInboxService.js",()=>({processarInboxWhatsappUmaVez:jest.fn()}));
jest.mock("../../application/assistente/TurnoIaWhatsappService.js",()=>({processarTurnosIaUmaVez:jest.fn()}));
import {iniciarWorkerWhatsappDuravel,pararWorkerWhatsappDuravel} from "../whatsappDurableWorker.js";
import {processarInboxWhatsappUmaVez} from "../../application/whatsapp/WhatsappInboxService.js";
import {processarTurnosIaUmaVez} from "../../application/assistente/TurnoIaWhatsappService.js";
it("inbox continua durante IA lenta e shutdown aguarda turno atual",async()=>{
 jest.useFakeTimers();let terminar;const lento=new Promise(resolve=>{terminar=resolve;});
 processarInboxWhatsappUmaVez.mockResolvedValue({});processarTurnosIaUmaVez.mockReturnValue(lento);
 iniciarWorkerWhatsappDuravel();await jest.advanceTimersByTimeAsync(6000);
 expect(processarInboxWhatsappUmaVez.mock.calls.length).toBeGreaterThan(1);expect(processarTurnosIaUmaVez).toHaveBeenCalledTimes(1);
 let encerrado=false;const fim=pararWorkerWhatsappDuravel().then(()=>{encerrado=true;});await Promise.resolve();expect(encerrado).toBe(false);
 terminar({});await fim;expect(encerrado).toBe(true);const n=processarInboxWhatsappUmaVez.mock.calls.length;await jest.advanceTimersByTimeAsync(10000);expect(processarInboxWhatsappUmaVez).toHaveBeenCalledTimes(n);
 jest.useRealTimers();
});
