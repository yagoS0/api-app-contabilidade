import axios from "axios";
import { SerproAuthService } from "../SerproAuthService.js";
import { getResolvedSerproCredentials } from "../SerproRuntimeSettings.js";
jest.mock("axios", () => ({ post: jest.fn(), isAxiosError: () => false }));
jest.mock("../SerproRuntimeSettings.js", () => ({ getResolvedSerproCredentials: jest.fn() }));
const client = () => { const c = new SerproAuthService({ config: {} }); c.buildHttpsAgent = jest.fn(async () => null); return c; };
test("clientes concorrentes autenticam uma vez e rotação invalida token", async () => {
  const runtime = { authUrl: "https://invalid.test", consumerKey: "key", consumerSecret: "secret", certificate: { storageKey: "cert-v1" } };
  getResolvedSerproCredentials.mockResolvedValue(runtime);
  axios.post.mockResolvedValue({ data: { access_token: "token", jwt_token: "jwt", expires_in: 300 } });
  await Promise.all([client().authenticate(), client().authenticate(), client().authenticate()]);
  expect(axios.post).toHaveBeenCalledTimes(1);
  getResolvedSerproCredentials.mockResolvedValue({ ...runtime, certificate: { storageKey: "cert-v2" } });
  await client().authenticate(); expect(axios.post).toHaveBeenCalledTimes(2);
});
