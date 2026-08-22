# Neovim configuration

Standalone Neovim 0.12+ configuration. It keeps selected AstroNvim behavior without loading AstroNvim or AstroCommunity.

Configuration precedence is:

1. plugin defaults (inside each plugin),
2. locally copied/adapted AstroNvim presets,
3. this repository's local overrides.

The latter wins when tables are merged.

## Run

```sh
nvim
```

On Linux/macOS, `install.conf.yaml` links `config/nvim` to `~/.config/nvim`. On Windows, `install.conf-win.yaml` links it to `~/AppData/Local/nvim`.

## Design

- 29 locked plugins; no AstroNvim/AstroCommunity runtime dependency.
- Yazi remains the file browser. Snacks Explorer is intentionally not enabled.
- Snacks provides picker, Lazygit, terminal, dashboard, notifier, and UI selection.
- LSP uses `vim.lsp.config()`, `vim.lsp.enable()`, native completion, native snippets, CodeLens, inlay hints, semantic tokens, and document highlights.
- `nvim-lspconfig` only supplies server definitions; Mason installs server executables.
- Formatting uses Conform with Prettier/Prettierd, StyLua, and pgFormatter.
- AstroNvim-style LSP mappings are retained, with the existing local Snacks mappings taking priority.
- Heirline provides an Astro-like statusline/tabline and VS Code-style path winbar.

Configured LSP servers: LuaLS, vtsls, YAML LS, JSON LS, LemMinX, HTML LS, CSS LS, Emmet LS, PowerShell Editor Services, Tailwind CSS LS, Marksman, and Roslyn.

Roslyn requires a .NET SDK/runtime. The Mason package is `roslyn-language-server`; unlike the old config, there is no machine-specific hard-coded DLL path.
