local opt = vim.opt

-- AstroNvim v5 defaults, followed by the existing local overrides.
opt.tabclose = "uselast"
opt.backspace:append "nostop"
opt.breakindent = true
opt.clipboard = "unnamedplus"
opt.cmdheight = 0
opt.completeopt = { "menu", "menuone", "noselect", "popup" }
opt.autocomplete = true
opt.complete = ".^5,w^5,b^5,u^5"
opt.confirm = true
opt.copyindent = true
opt.cursorline = true
opt.diffopt:append { "algorithm:histogram", "linematch:60" }
opt.expandtab = true
opt.fillchars = { eob = " " }
opt.ignorecase = true
opt.infercase = true
opt.laststatus = 3
opt.linebreak = true
opt.mouse = "a"
opt.number = true
opt.preserveindent = true
opt.pumheight = 10
opt.relativenumber = true
opt.shiftround = true
opt.shiftwidth = 0
opt.shortmess:append { I = true, c = true, C = true, s = true }
opt.showmode = false
opt.showtabline = 2
opt.signcolumn = "yes"
opt.smartcase = true
opt.splitbelow = true
opt.splitright = true
opt.tabstop = 2
opt.termguicolors = true
opt.timeout = true
opt.timeoutlen = 300
opt.title = true
opt.undofile = true
opt.updatetime = 300
opt.virtualedit = "block"
opt.wrap = false
opt.writebackup = false

vim.g.markdown_recommended_style = 0
vim.diagnostic.config {
  severity_sort = true,
  signs = true,
  underline = true,
  update_in_insert = false,
  virtual_lines = false,
  virtual_text = true,
}

vim.filetype.add {
  extension = { pcss = "postcss", postcss = "postcss" },
}
vim.treesitter.language.register("scss", "less")
vim.treesitter.language.register("scss", "postcss")
