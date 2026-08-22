local M = {}
local group = vim.api.nvim_create_augroup("native_lsp", { clear = true })

local function supports(client, method, bufnr)
  return client:supports_method(method, bufnr)
end

local function format(bufnr)
  local ok, conform = pcall(require, "conform")
  if ok then
    conform.format { bufnr = bufnr, timeout_ms = 1000, lsp_format = "fallback" }
  else
    vim.lsp.buf.format { bufnr = bufnr, timeout_ms = 1000 }
  end
end

local function set_lsp_maps(client, bufnr)
  local function map(mode, lhs, rhs, desc, method)
    if not method or supports(client, method, bufnr) then
      vim.keymap.set(mode, lhs, rhs, { buffer = bufnr, silent = true, desc = desc })
    end
  end

  -- AstroLSP mappings. Existing local Snacks mappings intentionally win.
  map({ "n", "x" }, "<Leader>la", vim.lsp.buf.code_action, "LSP code action", "textDocument/codeAction")
  map("n", "<Leader>lA", function()
    vim.lsp.buf.code_action { context = { only = { "source" }, diagnostics = {} } }
  end, "LSP source action", "textDocument/codeAction")
  map("n", "<Leader>ll", function()
    vim.lsp.codelens.enable(true, { bufnr = bufnr })
  end, "LSP CodeLens refresh", "textDocument/codeLens")
  map("n", "<Leader>lL", vim.lsp.codelens.run, "LSP CodeLens run", "textDocument/codeLens")
  map("n", "<Leader>lf", function()
    format(bufnr)
  end, "Format buffer")
  map("x", "<Leader>lf", function()
    format(bufnr)
  end, "Format selection")
  map("n", "<Leader>lr", vim.lsp.buf.rename, "Rename current symbol", "textDocument/rename")
  map("n", "<Leader>lh", vim.lsp.buf.signature_help, "Signature help", "textDocument/signatureHelp")
  map("n", "gK", vim.lsp.buf.signature_help, "Signature help", "textDocument/signatureHelp")
  map("n", "<Leader>lG", function()
    Snacks.picker.lsp_workspace_symbols()
  end, "Search workspace symbols", "workspace/symbol")
  map("n", "<Leader>ls", function()
    Snacks.picker.lsp_symbols()
  end, "Search symbols", "textDocument/documentSymbol")
  map("n", "<Leader>lD", function()
    Snacks.picker.diagnostics()
  end, "Search diagnostics")

  map("n", "gd", function()
    Snacks.picker.lsp_definitions()
  end, "Goto definition", "textDocument/definition")
  map("n", "gD", function()
    Snacks.picker.lsp_declarations()
  end, "Goto declaration", "textDocument/declaration")
  map("n", "gr", function()
    Snacks.picker.lsp_references()
  end, "References", "textDocument/references")
  map("n", "gI", function()
    Snacks.picker.lsp_implementations()
  end, "Goto implementation", "textDocument/implementation")
  map("n", "gy", function()
    Snacks.picker.lsp_type_definitions()
  end, "Goto type definition", "textDocument/typeDefinition")
  map("n", "gh", vim.lsp.buf.hover, "Hover")
  map("n", "<Leader>lR", vim.lsp.buf.rename, "LSP rename", "textDocument/rename")

  map("n", "<Leader>uf", function()
    vim.b[bufnr].disable_autoformat = not vim.b[bufnr].disable_autoformat
    vim.notify("Buffer autoformat: " .. (vim.b[bufnr].disable_autoformat and "off" or "on"))
  end, "Toggle autoformatting (buffer)")
  map("n", "<Leader>uF", function()
    vim.g.disable_autoformat = not vim.g.disable_autoformat
    vim.notify("Global autoformat: " .. (vim.g.disable_autoformat and "off" or "on"))
  end, "Toggle autoformatting (global)")
  map("n", "<Leader>u?", function()
    vim.b[bufnr].auto_signature = not vim.b[bufnr].auto_signature
    vim.notify("Automatic signature help: " .. (vim.b[bufnr].auto_signature and "on" or "off"))
  end, "Toggle automatic signature help", "textDocument/signatureHelp")
  map("n", "<Leader>uh", function()
    local enabled = vim.lsp.inlay_hint.is_enabled { bufnr = bufnr }
    vim.lsp.inlay_hint.enable(not enabled, { bufnr = bufnr })
  end, "Toggle LSP inlay hints (buffer)", "textDocument/inlayHint")
  map("n", "<Leader>uH", function()
    vim.g.inlay_hints = not vim.g.inlay_hints
    for _, buf in ipairs(vim.api.nvim_list_bufs()) do
      if vim.api.nvim_buf_is_loaded(buf) then
        pcall(vim.lsp.inlay_hint.enable, vim.g.inlay_hints, { bufnr = buf })
      end
    end
  end, "Toggle LSP inlay hints (global)", "textDocument/inlayHint")
  map("n", "<Leader>uL", function()
    local enabled = vim.lsp.codelens.is_enabled { bufnr = bufnr }
    vim.lsp.codelens.enable(not enabled, { bufnr = bufnr })
  end, "Toggle CodeLens", "textDocument/codeLens")
  map("n", "<Leader>uY", function()
    local enabled = vim.lsp.semantic_tokens.is_enabled { bufnr = bufnr, client_id = client.id }
    vim.lsp.semantic_tokens.enable(not enabled, { bufnr = bufnr, client_id = client.id })
  end, "Toggle LSP semantic highlight", "textDocument/semanticTokens/full")
end

function M.setup()
  vim.g.disable_autoformat = false
  vim.g.inlay_hints = false

  vim.lsp.config("*", {
    capabilities = vim.lsp.protocol.make_client_capabilities(),
  })

  vim.lsp.config("lua_ls", {
    settings = { Lua = { hint = { enable = true, arrayIndex = "Disable" } } },
  })
  vim.lsp.config("vtsls", {
    settings = {
      typescript = {
        updateImportsOnFileMove = { enabled = "always" },
        inlayHints = {
          enumMemberValues = { enabled = true },
          functionLikeReturnTypes = { enabled = true },
          parameterNames = { enabled = "all" },
          parameterTypes = { enabled = true },
          propertyDeclarationTypes = { enabled = true },
          variableTypes = { enabled = true },
        },
      },
      javascript = {
        updateImportsOnFileMove = { enabled = "always" },
        inlayHints = {
          enumMemberValues = { enabled = true },
          functionLikeReturnTypes = { enabled = true },
          parameterNames = { enabled = "literals" },
          parameterTypes = { enabled = true },
          propertyDeclarationTypes = { enabled = true },
          variableTypes = { enabled = true },
        },
      },
      vtsls = { enableMoveToFileCodeAction = true },
    },
  })
  vim.lsp.config("yamlls", {
    settings = {
      yaml = { schemaStore = { enable = false, url = "" }, schemas = require("schemastore").yaml.schemas() },
    },
  })
  vim.lsp.config("jsonls", {
    settings = { json = { validate = { enable = true }, schemas = require("schemastore").json.schemas() } },
  })
  vim.lsp.config("html", { init_options = { provideFormatter = false } })
  vim.lsp.config("cssls", { init_options = { provideFormatter = false } })

  vim.api.nvim_create_autocmd("LspAttach", {
    group = group,
    callback = function(ev)
      local client = assert(vim.lsp.get_client_by_id(ev.data.client_id))
      local bufnr = ev.buf
      set_lsp_maps(client, bufnr)

      if supports(client, "textDocument/completion", bufnr) then
        vim.lsp.completion.enable(true, client.id, bufnr, { autotrigger = true })
      end
      if supports(client, "textDocument/inlayHint", bufnr) then
        vim.lsp.inlay_hint.enable(vim.g.inlay_hints, { bufnr = bufnr })
      end
      if supports(client, "textDocument/codeLens", bufnr) then
        vim.lsp.codelens.enable(true, { bufnr = bufnr, client_id = client.id })
      end
      if supports(client, "textDocument/documentHighlight", bufnr) then
        vim.api.nvim_create_autocmd({ "CursorHold", "CursorHoldI" }, {
          group = group,
          buffer = bufnr,
          callback = vim.lsp.buf.document_highlight,
        })
        vim.api.nvim_create_autocmd({ "CursorMoved", "CursorMovedI" }, {
          group = group,
          buffer = bufnr,
          callback = vim.lsp.buf.clear_references,
        })
      end
      if supports(client, "textDocument/signatureHelp", bufnr) then
        vim.api.nvim_create_autocmd("CursorHoldI", {
          group = group,
          buffer = bufnr,
          callback = function()
            if vim.b[bufnr].auto_signature then
              vim.lsp.buf.signature_help()
            end
          end,
        })
      end

      -- Existing local policy: external formatters handle TypeScript and YAML.
      if vim.tbl_contains({ "ts_ls", "vtsls", "yamlls" }, client.name) then
        client.server_capabilities.documentFormattingProvider = false
        if client.name ~= "yamlls" then
          client.server_capabilities.documentRangeFormattingProvider = false
        end
      end
    end,
  })

  vim.api.nvim_create_autocmd("LspDetach", {
    group = group,
    callback = function(ev)
      vim.lsp.buf.clear_references()
      pcall(vim.api.nvim_clear_autocmds, { group = group, buffer = ev.buf })
    end,
  })

  vim.keymap.set("i", "<C-Space>", function()
    vim.lsp.completion.get()
  end, { desc = "Trigger LSP completion" })

  -- Keep C# configured even before Mason finishes installing the server.
  vim.lsp.enable "roslyn_ls"
end

return M
