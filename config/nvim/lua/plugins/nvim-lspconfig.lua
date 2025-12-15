return {
  "neovim/nvim-lspconfig",
  dependencies = {
    { "AstroNvim/astrolsp", opts = {} },
    {
      "williamboman/mason-lspconfig.nvim", -- MUST be set up before `nvim-lspconfig`
      dependencies = { "williamboman/mason.nvim" },
      opts = {
        -- use AstroLSP setup for mason-lspconfig
        handlers = { function(server) require("astrolsp").lsp_setup(server) end },
      },
      config = function(_, opts)
        -- Optionally tell AstroLSP to register new language servers before calling the `setup` function
        -- this enables the `mason-lspconfig.servers` option in the AstroLSP configuration
        require("astrolsp.mason-lspconfig").register_servers()
        require("mason-lspconfig").setup(opts)
      end,
    },
  },
  config = function()
    -- set up servers configured with AstroLSP
    vim.tbl_map(require("astrolsp").lsp_setup, require("astrolsp").config.servers)
  end,
}
