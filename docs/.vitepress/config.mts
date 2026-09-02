import { defineConfig } from "vitepress";

// https://vitepress.dev/reference/site-config
export default defineConfig({
  lang: "en-US",
  // Project pages serve under /<repo>/; CI sets BASE_PATH=/baton/.
  // Local dev/preview defaults to "/".
  base: process.env.BASE_PATH || "/",
  title: "Baton",
  description:
    "Portable, validated, local-first context handoffs for coding agents — checkpoints your agent can put down and pick back up.",
  cleanUrls: true,
  ignoreDeadLinks: false,

  head: [
    ["link", { rel: "icon", type: "image/svg+xml", href: "/logo.svg" }],
    ["meta", { name: "theme-color", content: "#6366f1" }],
  ],

  vue: {
    template: {
      compilerOptions: {
        isCustomElement: (tag) => tag === "schema-viewer",
      },
    },
  },

  themeConfig: {
    siteTitle: "Baton",
    logo: "/logo.svg",
    nav: [
      { text: "Guide", link: "/guide/what-is-baton", activeMatch: "/guide/" },
      { text: "Specs", link: "/guide/spec", activeMatch: "/guide/spec" },
      { text: "Schemas", link: "/schemas", activeMatch: "/schemas" },
      {
        text: "GitHub",
        link: "https://github.com/zloeber/baton",
      },
    ],

    sidebar: [
      {
        text: "Guide",
        items: [
          { text: "What is Baton?", link: "/guide/what-is-baton" },
          { text: "Getting started", link: "/guide/getting-started" },
          { text: "CLI reference", link: "/guide/cli" },
          { text: "MCP server", link: "/guide/mcp" },
          { text: "Hermes adapter", link: "/guide/hermes-adapter" },
          { text: "Configuration", link: "/guide/configuration" },
          { text: "Security", link: "/guide/security" },
          { text: "Interoperability", link: "/guide/interoperability" },
        ],
      },
      {
        text: "Specifications",
        items: [
          { text: "Core spec (v0.1)", link: "/guide/spec" },
          { text: "Hermes adapter spec", link: "/guide/hermes-adapter-spec" },
        ],
      },
      {
        text: "Reference",
        items: [
          { text: "JSON Schemas", link: "/schemas/index" },
          { text: "Handoff v0.1", link: "/schemas/handoff-v0.1" },
          { text: "Config v0.1", link: "/schemas/config-v0.1" },
          { text: "Adapter event v0.1", link: "/schemas/adapter-event-v0.1" },
        ],
      },
    ],

    socialLinks: [
      { icon: "github", link: "https://github.com/zloeber/baton" },
    ],

    search: {
      provider: "local",
    },

    outline: { level: [2, 3], label: "On this page" },

    footer: {
      message: "Released under the MIT License.",
      copyright: "Copyright © 2026 Baton contributors",
    },
  },
});
