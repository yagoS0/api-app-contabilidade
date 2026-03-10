import { createMockApi } from "./mock/mockApi";
import { createRealApi } from "./real/realApi";

export function createApiClient() {
  const mode = String(import.meta.env.VITE_API_MODE || "mock").toLowerCase();
  const mock = createMockApi();
  const real = createRealApi();

  if (mode === "real") {
    return {
      mode: "real",
      ...real,
    };
  }

  if (mode === "real_with_mock_fallback") {
    return new Proxy(
      {
        mode: "real_with_mock_fallback",
      },
      {
        get(target, prop) {
          if (prop in target) return target[prop];
          const realFn = real[prop];
          const mockFn = mock[prop];
          if (typeof realFn === "function" && typeof mockFn === "function") {
            return async (...args) => {
              try {
                return await realFn(...args);
              } catch {
                return mockFn(...args);
              }
            };
          }
          return realFn ?? mockFn;
        },
      }
    );
  }

  return {
    mode: "mock",
    ...mock,
  };
}
