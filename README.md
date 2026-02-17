# Dragee - Module Dagger pour les packages TypeScript

## Objectif du projet

Ce module Dagger automatise l'intégration continue (CI/CD) des packages TypeScript de l'écosystème @dragee-io. Il orchestre les différentes étapes du cycle de vie d'un package :

- **Validation du code** : exécution des linters et des tests
- **Construction** : compilation des packages TypeScript
- **Publication** : déploiement automatique sur le registre npm

Le module est conçu pour être utilisé dans des pipelines CI/CD et offre plusieurs points d'entrée adaptés aux différents événements (pull request, release, publication manuelle).

## Installation

### Prérequis

Assurez-vous d'avoir installé les outils suivants :

- **Dagger CLI** : version `v0.19.10` ou supérieure
- **Yarn** : version `1.22.22` (spécifiée dans le package.json)
- **Node.js** : version recommandée 18+ ou 20+
- **Bun** : utilisé comme runtime pour les tests et builds (installé automatiquement dans les conteneurs)

### Étapes d'installation

1. **Générer le SDK Dagger TypeScript**

   ```bash
   dagger develop
   ```

   Cette commande génère le dossier `./sdk` contenant le SDK TypeScript de Dagger.

2. **Installer les dépendances**

   ```bash
   yarn install
   ```

### Dépendances du projet

Le projet utilise les dépendances suivantes :

- `typescript`: ^5.5.4
- `@types/node`: ^20.0.0 (devDependencies)
- `@dagger.io/dagger`: généré localement via `dagger develop`

## Opérations disponibles

### Conteneurs de base

#### `bun_container(bun_version?: string)`

Crée un conteneur avec Bun installé.

- **Paramètre** : `bun_version` - version de Bun à utiliser (défaut: `"latest"`)
- **Retour** : Conteneur avec Bun installé

**Exemple** :
```bash
dagger call bun-container --bun-version=1.0.0
```

#### `node_container(node_version?: string)`

Crée un conteneur avec Node.js installé.

- **Paramètre** : `node_version` - version de Node à utiliser (défaut: `"current-alpine3.21"`)
- **Retour** : Conteneur avec Node.js installé

**Exemple** :
```bash
dagger call node-container --node-version=20-alpine
```

### Gestion des dépendances

#### `install_dependencies(source: Directory)`

Installe les dépendances du projet dans un conteneur Bun.

- **Paramètre** : `source` - répertoire contenant le projet
- **Retour** : Conteneur avec les dépendances installées

#### `mount_app_with(source: Directory)`

Monte le projet et ses dépendances sur un conteneur Bun frais.

- **Paramètre** : `source` - répertoire contenant les fichiers de l'application
- **Retour** : Conteneur avec le projet monté et prêt à l'emploi

### Opérations de validation

#### `test(app: Container)`

Exécute les tests du projet.

- **Paramètre** : `app` - conteneur sur lequel exécuter les tests
- **Retour** : Conteneur avec les tests exécutés

**Exemple** :
```bash
dagger call mount-app-with --source=. test
```

#### `lint(app: Container)`

Exécute le linter sur le projet.

- **Paramètre** : `app` - conteneur sur lequel exécuter le lint
- **Retour** : Conteneur avec le lint exécuté

**Exemple** :
```bash
dagger call mount-app-with --source=. lint
```

#### `lint_and_test(source: Directory)`

Exécute le lint et les tests en séquence.

- **Paramètre** : `source` - répertoire source du projet
- **Retour** : Conteneur avec lint et tests exécutés

### Opérations de build

#### `build(source: Directory)`

Compile le projet TypeScript.

- **Paramètre** : `source` - répertoire contenant le projet à compiler
- **Retour** : Conteneur avec le build exécuté

**Exemple** :
```bash
dagger call build --source=.
```

### Points d'entrée CI/CD

#### `on_pull_request(url: string, branch?: string)`

Point d'entrée pour les pull requests. Exécute le lint et les tests.

- **Paramètres** :
  - `url` - URL du dépôt (HTTP ou Git)
  - `branch` - branche à utiliser (défaut: `"main"`)

**Exemple** :
```bash
dagger call on-pull-request --url=https://github.com/dragee-io/dragee-io.git --branch=feature/new-feature
```

#### `on_publish(npm_token?: Secret, source?: Directory, git_url?: string, branch?: string, tag?: string)`

Point d'entrée pour les releases. Exécute lint, test, build, bump de version et publication sur npm.

- **Paramètres** :
  - `npm_token` - token npm pour la publication (optionnel si utilisation de provenance)
  - `source` - répertoire source (optionnel si `git_url` et `branch` sont fournis)
  - `git_url` - URL du dépôt Git
  - `branch` - branche à utiliser
  - `tag` - tag de version (ex: `v1.0.0`)

**Exemples** :
```bash
# Avec source locale
dagger call on-publish --npm-token=env:NPM_TOKEN --source=. --tag=v1.0.0

# Avec dépôt Git
dagger call on-publish --npm-token=env:NPM_TOKEN \
  --git-url=https://github.com/dragee-io/dragee-io.git \
  --branch=main \
  --tag=v1.0.0

# Utilise le dernier tag du dépôt
dagger call on-publish --npm-token=env:NPM_TOKEN \
  --git-url=https://github.com/dragee-io/dragee-io.git \
  --branch=main
```

#### `publish(npm_token?: Secret, source?: Directory, git_url?: string, branch?: string, tag?: string)`

⚠️ Point d'entrée temporaire pour les packages qui ne peuvent pas être compilés. Exécute lint, test et publication (sans build).

Les paramètres sont identiques à `on_publish`.

**Exemple** :
```bash
dagger call publish --npm-token=env:NPM_TOKEN --source=. --tag=v1.0.0
```

### Gestion des versions

#### `update_app_version(version: string, source: Directory)`

Met à jour la version du package dans le `package.json`.

- **Paramètres** :
  - `version` - nouvelle version (ex: `1.0.0` ou `v1.0.0`)
  - `source` - répertoire source du projet
- **Retour** : Conteneur avec la version mise à jour

#### `bump_and_publish(tag: string, source: Directory, npm_token?: Secret)`

Combine la mise à jour de version et la publication sur npm.

- **Paramètres** :
  - `tag` - tag de version à appliquer
  - `source` - répertoire source du projet
  - `npm_token` - token npm (optionnel)
- **Retour** : Conteneur avec le package publié

#### `publish_app(app: Container, npm_token?: Secret)`

Publie le package sur le registre npm.

- **Paramètres** :
  - `app` - conteneur contenant le package à publier
  - `npm_token` - token npm pour l'authentification (optionnel si provenance npm)
- **Retour** : Conteneur avec le package publié

### Utilitaires Git

#### `get_repository(url: string, branch?: string)`

Récupère une référence Git vers un dépôt.

- **Paramètres** :
  - `url` - URL du dépôt
  - `branch` - branche à récupérer (défaut: `"main"`)
- **Retour** : Référence Git

#### `get_latest_tag(url: string)`

Récupère le dernier tag d'un dépôt Git.

- **Paramètre** : `url` - URL du dépôt
- **Retour** : Dernier tag du dépôt

**Exemple** :
```bash
dagger call get-latest-tag --url=https://github.com/dragee-io/dragee-io.git
```

## Utilisation dans un pipeline CI/CD

### GitHub Actions

```yaml
name: CI

on:
  pull_request:
    branches: [main]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Run tests
        run: |
          dagger call on-pull-request \
            --url=${{ github.repositoryUrl }} \
            --branch=${{ github.head_ref }}
```

```yaml
name: Release

on:
  release:
    types: [published]

jobs:
  publish:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Publish to npm
        run: |
          dagger call on-publish \
            --npm-token=env:NPM_TOKEN \
            --git-url=${{ github.repositoryUrl }} \
            --branch=${{ github.ref_name }} \
            --tag=${{ github.ref_name }}
        env:
          NPM_TOKEN: ${{ secrets.NPM_TOKEN }}
```

## Architecture

Le module utilise plusieurs technologies :

- **Bun** : pour l'exécution des tests et du linter (rapide et performant)
- **Node.js** : pour les opérations de versioning et de publication npm
- **Dagger** : pour l'orchestration des conteneurs et la reproductibilité des builds

Toutes les opérations s'exécutent dans des conteneurs isolés, garantissant la reproductibilité et l'isolation des environnements.
