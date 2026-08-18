import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Porta própria (5210) para não brigar com o portal do escritório (apps/web, 517x/519x)
// quando os dois estiverem no ar na mesma máquina.
export default defineConfig({
  plugins: [react()],
  server: { port: 5210 },
});
