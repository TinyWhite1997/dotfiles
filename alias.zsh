alias ..="cd .."
alias ...="cd ../.."
alias ....="cd ../../.."
alias ~="cd ~"
alias c="clear"
alias /="cd /"

alias md="mkdir -p"
alias rd="rmdir"

alias l="eza -lh"
alias la="eza -lha"
alias ll="eza -lh"

alias gsts="git status"
alias gco="git checkout"
alias gcm="git commit -m"
alias gl="git pull"
alias gp="git push"
alias ga="git add"
alias gb="git branch"
alias gd="git diff"

alias lg="lazygit"

# Conditionally unalias gh only if it is currently defined as an alias
if alias gh >/dev/null 2>&1; then
  unalias gh
fi
