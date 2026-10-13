jest.mock("axios", () => ({ create: jest.fn() }));
jest.mock("node:https", () => ({ Agent: jest.fn() }));
jest.mock("../pfxToTls.js", () => ({ extractTlsMaterialFromPfx: jest.fn(() => ({ cert: "cert", key: "key" })) }));
import axios from "axios";
import https from "node:https";
import { fetchDfeNFSe } from "../adn-nacional/AdnNacionalClient.js";
const get = jest.fn();
const destroy = jest.fn();
const opts = { cnpj: "53742042000164", ultNSU: "25", pfxBuffer: Buffer.from("fixture"), password: "fixture" };
beforeEach(() => { jest.clearAllMocks(); axios.create.mockReturnValue({ get }); https.Agent.mockImplementation(() => ({ destroy })); });
test("TLS não vaza OpenSSL e libera agente sem repetir transporte", async () => {
  const cause = Object.assign(new Error("80CCF91C:error:ssl3_get_record:decryption failed or bad record mac:/private/path"), { code: "ERR_SSL_DECRYPTION_FAILED_OR_BAD_RECORD_MAC" });
  get.mockRejectedValue(cause);
  let error;
  try { await fetchDfeNFSe(opts); } catch (err) { error = err; }
  expect(error).toMatchObject({ code: "NETWORK_ERROR", category: "TLS", cause });
  expect(error.message).not.toMatch(/80CCF|ssl3|private|bad record/);
  expect(get).toHaveBeenCalledTimes(1);
  expect(destroy).toHaveBeenCalledTimes(1);
  expect(https.Agent).toHaveBeenCalledWith(expect.objectContaining({ rejectUnauthorized: true, minVersion: "TLSv1.2" }));
});
test("sucesso libera agente", async () => {
  get.mockResolvedValue({ status: 200, data: JSON.stringify({ StatusProcessamento: "NENHUM_DOCUMENTO_LOCALIZADO" }), headers: {} });
  expect((await fetchDfeNFSe(opts)).status).toBe("NENHUM_DOCUMENTO_LOCALIZADO");
  expect(destroy).toHaveBeenCalledTimes(1);
});
test("429 preserva Retry-After e libera agente", async () => {
  get.mockResolvedValue({ status: 429, data: "html", headers: { "retry-after": "3600" } });
  await expect(fetchDfeNFSe(opts)).rejects.toMatchObject({ code: "HTTP_429", retryAfterSec: 3600 });
  expect(destroy).toHaveBeenCalledTimes(1);
});

test("HTTP inesperado não expõe corpo ou cabeçalhos", async () => {
  get.mockResolvedValue({ status: 403, data: "<html>internal proxy</html>", headers: { "set-cookie": "private" } });
  let error;
  try { await fetchDfeNFSe(opts); } catch (err) { error = err; }
  expect(error.code).toBe("HTTP_403");
  expect(error.message).not.toMatch(/html|internal|proxy|cookie|private/);
  expect(error).not.toHaveProperty("headers");
  expect(error).not.toHaveProperty("body");
  expect(destroy).toHaveBeenCalledTimes(1);
});
