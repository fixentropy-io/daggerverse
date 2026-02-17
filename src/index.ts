/**
 * This dagger module is used to run tests, lints, and builds of @dragee-io typescript packages
 * Once the test, lint and build steps are done, the module is published to npm registry
 * 
 * There are 3 available entrypoints for CIs which are:
 * - `on_pull_request`: runs the lint and test steps on a pull request
 * - `on_publish`: runs the lint, test and build steps on a release and then publish it to npm registry
 * - `publish`: ⚠️ runs the lint, test and then publish to npm registry - it's a temporary entrypoint since some packages like the asserters cannot be build at the moment
 */
import {
  Container,
  dag,
  Directory,
  func,
  GitRef,
  object,
  Secret,
} from "@dagger.io/dagger";

const PACKAGE_JSON = "package.json";
const BUN_LOCKB = "bun.lockb";

@object()
export class Dragee {
  /**
   * Used to create a container with bun installed
   * @param bun_version specify the version of bun to use
   * @returns a container with bun installed
   */
  @func()
  bun_container(bun_version = "latest"): Container {
    // might be useful to check if the version is in a valid format
    return dag.container().from(`oven/bun:${bun_version}`);
  }

  /**
   * Used to create a container with node installed
   * @param node_version specify the version of node to use
   * @returns a container with node installed
   */
  @func()
  node_container(node_version = "current-alpine3.21"): Container {
    return dag.container().from(`node:${node_version}`);
  }

  /**
   * Used to install dependencies of the project on a bun container
   * @param source the directory containing the project
   * @returns a container with the dependencies installed
   */
  @func()
  install_dependencies(source: Directory): Container {
    const package_json = source.file(PACKAGE_JSON);
    const lockb_file = source.file(BUN_LOCKB);

    return this.bun_container()
      .withWorkdir("/app")
      .withFiles("/app", [package_json, lockb_file])
      .withExec(["bun", "install"]);
  }

  /**
   * This step is used to mount the project's directory/files and dependencies on a fresh bun container
   * @param source the directory containing the application files
   * @returns a container with the project mounted
   */
  @func()
  mount_app_with(source: Directory): Container {
    const node_modules =
      this.install_dependencies(source).directory("/app/node_modules");

    return this.bun_container()
      .withWorkdir("/app")
      .withMountedDirectory("/app", source)
      .withMountedDirectory("/app/node_modules", node_modules);
  }

  /**
   * It runs the tests of the project
   * @param app The container containing the project to test
   * @returns a container with tests ran
   */
  @func()
  async test(app: Container): Promise<Container> {
    const tested_app = app.withExec(["bun", "test"]);

    await tested_app.stdout();
    await tested_app.stderr();

    return tested_app;
  }

  /**
   * This function runs the lint of the project on a bun container
   * @param app the container to run the lint on
   * @returns a container with lint ran
   */
  @func()
  async lint(app: Container): Promise<Container> {
    const linted_app = app.withExec(["bun", "lint"]);

    await linted_app.stdout();
    await linted_app.stderr();

    return linted_app;
  }

  /**
   * This function mounts the application and runs the build of the project on a bun container
   * @param app the directory containing the project to build
   * @returns a container with build ran
   */
  @func()
  async build(app: Directory): Promise<Container> {
    const mounted_app = this.mount_app_with(app);
    const built_app = await this.build_app(mounted_app);
    return built_app;
  }

  /**
   * This function runs the build of the project on a bun container
   * @param app the directory containing the project to build
   * @returns a container with build ran
   */
  async build_app(app: Container): Promise<Container> {
    const built_app = app.withExec([
      "bun",
      "run",
      "build",
    ]);

    await built_app.stdout();
    await built_app.stderr();

    return built_app;
  }

  /**
   * This function runs the lint and test of the project on a pull request trigger
   * @param url - the repository url (it can either be a http or a git url)
   * @param branch - the branch to use - defaults to `main`
   * @returns the linted and tested app
   */
  @func()
  async on_pull_request(url: string, branch = "main"): Promise<void> {
    const repository_files = this.get_repository(url, branch).tree();

    await this.lint_and_test(repository_files);
  }

  /**
   * This function runs the lint and test of the project
   * @param source the source directory
   * @returns the linted and tested app container
   */
  @func()
  async lint_and_test(source: Directory): Promise<Container> {
    const app = this.mount_app_with(source);

    await this.lint(app);
    await this.test(app);

    return app;
  }

  /**
   * This function is executed when a release is triggered and will lint, test, build, bump the package version and publish it to npm registry
   * You can call this function in different ways:
   * ```sh
   * dagger call on-publish npm-token=env:NPM_TOKEN source=<path/to/source> tag=v1.0.0
   * ```
   * or
   * ```sh
   * dagger call on-publish npm-token=env:NPM_TOKEN git-url=https://github.com/dragee-io/dragee-io.git branch=main tag=v1.0.0
   * ```
   * or
   * ```sh
   * dagger call on-publish npm-token=env:NPM_TOKEN git-url=https://github.com/dragee-io/dragee-io.git branch=main
   * ```
   * 
   * @param npm_token is the npm token to use to publish the project
   * @param source the source directory to use - if not provided, will pull the repository if the git_url and branch are provided
   * @param git_url the git url of the repository
   * @param branch the branch to use
   * @param tag the tag version to release the package to - if not provided, will use the latest tag created on the repository
   */
  @func()
  async on_publish(
    npm_token: Secret,
    source?: Directory,
    git_url?: string,
    branch?: string,
    tag?: string
  ): Promise<void> {
    if (!source || (!git_url && !branch)) {
      throw new Error(
        "Either a source directory or a git url and a branch name must be provided"
      );
    }
    const source_files = source ?? this.get_repository(git_url, branch).tree();

    if (!git_url && !tag) {
      throw new Error(
        "Either a git url or a tag must be provided to be able to apply a version update"
      );
    }
    const tag_update = await this.get_tag(git_url, tag);

    const app = this.mount_app_with(source_files);

    await this.lint(app);
    await this.test(app);

    const built_app = await this.build(source_files)
    const built_app_directory = built_app.directory(".");
    await this.bump_and_publish(tag_update, built_app_directory, npm_token);
  }

  /**
   * This function is executed to publish a release when it is triggered.
   * The following operations are executed in this order:
   * 1. Retrieve sources from Git
   * 2. Lint the app
   * 3. Test the app
   * 4. Build the app
   * 5. Bump the package version
   * 6. Publish the app to npm registry
   * 
   * @param oidcUrl the OIDC URL to use for the token request
   * @param oidcToken the OIDC token to use for the publish (pass as env:ACTIONS_ID_TOKEN_REQUEST_TOKEN)
   * @param git_url the git url of the repository to clone and publish
   * @param branch the branch to use - defaults to `main`
   */
  @func()
  async publish_release(
    oidcUrl: string,
    oidcToken: string,
    git_url: string,
  ): Promise<void> {

    console.log("GITHUB_REPOSITORY =", process.env.GITHUB_REPOSITORY)
    console.log("GITHUB_WORKFLOW =", process.env.GITHUB_WORKFLOW)
    console.log("GITHUB_REF =", process.env.GITHUB_REF)
    console.log("GITHUB_SHA =", process.env.GITHUB_SHA)
    console.log("GITHUB_RUN_ID =", process.env.GITHUB_RUN_ID)

    if (!git_url) {
      throw new Error(
        "A git url must be provided to be able to apply a version update"
      );
    }

    const source = this.get_repository(git_url).tree();
    if (!source) {
      throw new Error(
        "No source directory has been found for the given git url"
      );
    }

    const latestTag = await this.get_tag(git_url);
    const app = await this.lint_and_test(source);
    
    const built_app = await this.build_app(app);
    const built_app_directory = built_app.directory(".");
    
    await this.bump_and_publish_with_dynamic_token(oidcUrl, oidcToken, built_app_directory, latestTag);
  }

  /**
   * This function works as `on_publish` but will not run the build step
   */
  @func()
  async publish(
    npm_token: Secret,
    source?: Directory,
    git_url?: string,
    branch?: string,
    tag?: string
  ): Promise<void> {
    if (!source || (!git_url && !branch)) {
      throw new Error(
        "Either a source directory or a git url and a branch name must be provided"
      );
    }
    const source_files = source ?? this.get_repository(git_url, branch).tree();

    if (!git_url && !tag) {
      throw new Error(
        "Either a git url or a tag must be provided to be able to apply a version update"
      );
    }
    const tag_update = await this.get_tag(git_url, tag);

    const app = this.mount_app_with(source_files);

    await this.lint(app);
    await this.test(app);

    const app_directory = app.directory(".");
    await this.bump_and_publish(tag_update, app_directory, npm_token);
  }
  
  /**
   * Bumps the version of the app and publishes it to npm
   * @param tag the tag to use for the version bump
   * @param source the source directory of the project to bump the version
   * @param npm_token the npm token to use for the publish
   * @returns the published app
   */
  @func()
  async bump_and_publish(tag: string, source: Directory, npm_token: Secret): Promise<Container> {
    const updated_version_app = await this.update_app_version(tag, source);
    const published_app = await this.publish_app(updated_version_app, npm_token);
    return published_app;
  }

  /**
   * Bumps the version of the app and publishes it to npm using a dynamic OIDC token
   * @param oidcUrl the OIDC URL to use for the token request
   * @param oidcToken the OIDC token to use for the publish
   * @param source the source directory of the project to bump the version
   * @param tag the tag to use for the version bump
   * @returns the published app
   */
  async bump_and_publish_with_dynamic_token(oidcUrl: string, oidcToken: string, source: Directory, tag: string): Promise<Container> {
    const updated_version_app = await this.update_app_version(tag, source);
    const published_app = await this.publish_app_with_dynamic_token(oidcUrl, oidcToken, updated_version_app);
    return published_app;
  }

  /**
   * Publishes the app to npm
   * @param app the app to publish
   * @param npm_token the npm token to use for the publish
   * @returns the published app
   */
  @func()
  async publish_app(app: Container, npm_token: Secret): Promise<Container> {
    let published_app = app
      .withSecretVariable("NPM_TOKEN", npm_token)
      .withExec(["npm", "publish", "--access", "public"]);

    await published_app.stdout();
    await published_app.stderr();

    return published_app;
  }

    /**
   * Publishes the app to npm using a dynamic OIDC token
   * @param oidcUrl the OIDC URL to use for the token request
   * @param oidcToken the OIDC token to use for the publish
   * @param app the app to publish
   * @returns the published app
   */
  async publish_app_with_dynamic_token(oidcUrl: string, oidcToken: string, app: Container): Promise<Container> {
    const tokenSecret = dag.setSecret("oidc", oidcToken)

    const token = await dag
      .github()
      .getOidctoken(tokenSecret, oidcUrl);
    
    const published_app = app
      .withEnvVariable("ACTIONS_ID_TOKEN", token)
      .withExec(["npm", "publish", "--access", "public"]);

    await published_app.stdout();
    await published_app.stderr();
    return published_app;
  }

  /**
   * Updates the version of the app
   * @param version the version to update to
   * @param source the source directory of the project to update the version
   * @returns 
   */
  @func()
  async update_app_version(
    version: string,
    source: Directory
  ): Promise<Container> {
    const updated_app_version = this.node_container()
      .withDirectory("/app", source)
      .withWorkdir("/app")
      .withExec([
        "npm",
        "version",
        version,
        "--commit-hooks",
        "false",
        "--git-tag-version",
        "false",
      ]);

    await updated_app_version.stdout();
    await updated_app_version.stderr();

    return updated_app_version;
  }

  /**
   * Gets the repository by its url and branch name
   * @param url the url of the repository
   * @param branch the branch to use - defaults to `main`
   * @returns the repository reference
   */
  get_repository(url: string, branch = "main"): GitRef {
    const repo = dag.git(url).branch(branch);
    return repo;
  }

  async get_tag(git_url: string, tag?: string): Promise<string> {
    const retrieved_tag = tag ?? (await this.get_latest_tag(git_url));

    if (retrieved_tag.startsWith("v")) {
      return retrieved_tag.slice(1);
    }

    return retrieved_tag;
  }

  /**
   * Gets the latest tag of the repository
   * @param url the url of the repository
   * @returns the latest tag of the repository
   */
  @func()
  async get_latest_tag(url: string): Promise<string> {
    const tags = await dag.git(url).tags();

    return tags.at(-1);
  }
}
