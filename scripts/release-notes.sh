#!/usr/bin/env bash
# Print the release notes of a tag, in English then French, with the update instructions.
#
#   scripts/release-notes.sh v2.0.0 > notes.md
#
# The CHANGELOG.md section "## [2.0.0]" (if any) is included. The asset names are the ones
# release.yml publishes.
set -euo pipefail

tag=${1:?usage: release-notes.sh TAG}
version=${tag#v}
repo=${GITHUB_REPOSITORY:-titouannwtt/frequi-ultimate}
cd "$(dirname "$0")/.."

changelog_section() {
  awk -v v="$version" '
    /^## \[/ { if (on) exit; if (index($0, "## [" v "]") == 1) { on = 1; next } }
    on { print }
  ' CHANGELOG.md | sed -e '/./,$!d' | sed -e :a -e '/^\n*$/{$d;N;ba' -e '}' | sed 's/^### /#### /'
}
section=$(changelog_section || true)

cat <<NOTES
# FreqUI Ultimate $tag

## English

${section:+### What changed

$section

}### Update the UI

This is the only step most people need. Your bot list stays in your browser: nothing to register again.

\`\`\`bash
freqtrade install-ui --ui-version $tag
\`\`\`

Without freqtrade-ultimate, or to do it by hand: download \`frequi-ultimate-ui-$tag.zip\` (the first asset below) and unzip it
into \`freqtrade/rpc/api_server/ui/installed/\`. Hard-refresh the page once (Ctrl+Shift+R).

### Optional: the gateway

\`frequi-gateway\` is a small Rust service that polls your bots once, whatever the number of open tabs and phones. Without it the UI works exactly
as before (direct mode). Download the binary for your machine (\`x86_64\` or \`aarch64\`, static, no dependency), verify it, and run it:

\`\`\`bash
sha256sum -c --ignore-missing SHA256SUMS
install -m 0755 frequi-gateway-x86_64-unknown-linux-musl ~/.local/bin/frequi-gateway
frequi-gateway print-default-config > config.toml    # then edit cors_origins
frequi-gateway check-config --config config.toml
frequi-gateway run --config config.toml
\`\`\`

Full guide, systemd unit, Docker and rollback: [docs/UPGRADE.en.md](https://github.com/$repo/blob/$tag/docs/UPGRADE.en.md).

### Roll back

Reinstall the previous UI: \`freqtrade install-ui --ui-version <previous tag>\`. The gateway can be stopped at any time; the UI falls back
to direct mode by itself. Your browser data is kept (the old keys are never deleted).

## Français

${section:+### Ce qui change

Le détail (en anglais) est dans le [CHANGELOG](https://github.com/$repo/blob/$tag/CHANGELOG.md).

}### Mettre à jour l'interface

C'est la seule étape nécessaire pour la plupart des utilisateurs. La liste de vos bots reste dans votre navigateur : rien à
enregistrer à nouveau.

\`\`\`bash
freqtrade install-ui --ui-version $tag
\`\`\`

Sans freqtrade-ultimate, ou pour le faire à la main : téléchargez \`frequi-ultimate-ui-$tag.zip\` (le premier fichier ci-dessous)
et décompressez-le dans \`freqtrade/rpc/api_server/ui/installed/\`. Rechargez la page une fois (Ctrl+Maj+R).

### Facultatif : la passerelle

\`frequi-gateway\` est un petit service Rust qui interroge vos bots une seule fois, quel que soit le nombre d'onglets et de
téléphones ouverts. Sans elle, l'interface fonctionne comme avant (mode direct). Téléchargez le binaire de votre machine
(\`x86_64\` ou \`aarch64\`, statique, sans dépendance), vérifiez-le et lancez-le :

\`\`\`bash
sha256sum -c --ignore-missing SHA256SUMS
install -m 0755 frequi-gateway-x86_64-unknown-linux-musl ~/.local/bin/frequi-gateway
frequi-gateway print-default-config > config.toml    # puis éditez cors_origins
frequi-gateway check-config --config config.toml
frequi-gateway run --config config.toml
\`\`\`

Guide complet, unité systemd, Docker et retour arrière : [docs/UPGRADE.fr.md](https://github.com/$repo/blob/$tag/docs/UPGRADE.fr.md).

### Revenir en arrière

Réinstallez l'interface précédente : \`freqtrade install-ui --ui-version <tag précédent>\`. La passerelle peut être arrêtée à tout
moment, l'interface repasse seule en mode direct. Les données de votre navigateur sont conservées (les anciennes clés ne sont
jamais supprimées).
NOTES
