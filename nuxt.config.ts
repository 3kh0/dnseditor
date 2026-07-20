import tailwindcss from "@tailwindcss/vite";

export default defineNuxtConfig({
  compatibilityDate: "2024-11-01",
  devtools: { enabled: true },
  css: ["~/assets/css/main.css"],

  runtimeConfig: {
    githubAppClientId: "",
    githubAppClientSecret: "",
    githubAppSlug: "",
    sessionSecret: "",
    dnsGithubOwner: "hackclub",
    dnsGithubRepo: "dns",
    dnsGithubBranch: "main",
    public: {
      appUrl: "",
    },
  },

  vite: {
    plugins: [tailwindcss()],
    optimizeDeps: {
      include: ["@vue/devtools-core", "@vue/devtools-kit"],
    },
  },

  modules: ["@nuxt/icon", "@vercel/speed-insights"],
});
