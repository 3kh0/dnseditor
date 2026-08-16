import tailwindcss from "@tailwindcss/vite";

export default defineNuxtConfig({
  compatibilityDate: "2026-07-29",
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

  modules: ["@nuxt/icon", "@vercel/speed-insights", "@vercel/analytics"],

  icon: {
    provider: "none",
    serverBundle: false,
    clientBundle: {
      scan: true,
      icons: ["material-symbols:cloud", "material-symbols:cloud-outline"],
      sizeLimitKb: 64,
    },
  },
});
