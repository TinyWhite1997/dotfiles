local servers = {
  "lua_ls",
  "roslyn_ls",
  "vtsls",
  "yamlls",
  "jsonls",
  "lemminx",
  "html",
  "cssls",
  "emmet_ls",
  "powershell_es",
  "tailwindcss",
  "marksman",
}

return {
  {
    "neovim/nvim-lspconfig",
    lazy = false,
    dependencies = { "b0o/schemastore.nvim" },
    config = function()
      require("config.lsp").setup()
    end,
  },
  {
    "mason-org/mason.nvim",
    cmd = "Mason",
    opts = { ui = { border = "rounded" } },
  },
  {
    "mason-org/mason-lspconfig.nvim",
    lazy = false,
    dependencies = { "mason-org/mason.nvim", "neovim/nvim-lspconfig" },
    opts = { ensure_installed = servers, automatic_enable = servers },
  },
  {
    "WhoIsSethDaniel/mason-tool-installer.nvim",
    lazy = false,
    dependencies = { "mason-org/mason.nvim" },
    opts = {
      ensure_installed = {
        "lua-language-server",
        "roslyn-language-server",
        "vtsls",
        "yaml-language-server",
        "json-lsp",
        "lemminx",
        "html-lsp",
        "css-lsp",
        "emmet-ls",
        "powershell-editor-services",
        "tailwindcss-language-server",
        "marksman",
        "stylua",
        "prettier",
        "prettierd",
        "pgformatter",
        "tree-sitter-cli",
      },
      run_on_start = true,
      start_delay = 3000,
      debounce_hours = 24,
    },
  },
  { "b0o/schemastore.nvim", lazy = true },
  {
    "folke/lazydev.nvim",
    ft = "lua",
    opts = { library = { { path = "${3rd}/luv/library", words = { "vim%.uv" } } } },
  },
}
