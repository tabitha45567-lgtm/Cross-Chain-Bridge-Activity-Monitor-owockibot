import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// "./" base makes the build work when served from a GitHub Pages
// project subpath (username.github.io/repo-name/) as well as locally.
export default defineConfig({
  plugins: [react()],
  base: "./",
});
