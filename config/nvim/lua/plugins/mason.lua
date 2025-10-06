-- Customize Mason

---@type LazySpec
return {
  -- use mason-tool-installer for automatically installing Mason packages
  {
    "WhoIsSethDaniel/mason-tool-installer.nvim",
    -- overrides `require("mason-tool-installer").setup(...)`
    opts = {
      -- Make sure to use the names found in `:Mason`
      ensure_installed = {
        "marksman",
        "prettier",
        "lua-language-server",
        "stylua",
        "debugpy",
        "tree-sitter-cli",
        "powershell-editor-services",
        "deno",
        "postgrestools",
        "pgformatter",
      },
    },
  },
}
