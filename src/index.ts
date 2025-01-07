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
  @func()
  bun_container(bun_version = "latest"): Container {
    // might be useful to check if the version is in a valid format
    return dag.container().from(`oven/bun:${bun_version}`);
  }

  @func()
  node_container(node_version = "current-alpine3.21"): Container {
    return dag.container().from(`node:${node_version}`);
  }

  @func()
  install_dependencies(source: Directory): Container {
    const package_json = source.file(PACKAGE_JSON);
    const lockb_file = source.file(BUN_LOCKB);

    return this.bun_container()
      .withWorkdir("/app")
      .withFiles("/app", [package_json, lockb_file])
      .withExec(["bun", "install"]);
  }

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
   * @param source The directory containing the project to test
   * @returns a container that runs the tests of the project
   */
  @func()
  // async test(source: Directory) {
  //     const tested_app = this.app_container(source).withExec(['bun', 'test']);
  async test(app: Container): Promise<Container> {
    const tested_app = app.withExec(["bun", "test"]);

    await tested_app.stdout();
    await tested_app.stderr();

    return tested_app;
  }

  /**
   * This function runs the lint of the project
   * @param source
   * @returns
   */
  @func()
  async lint(app: Container): Promise<Container> {
    const linted_app = app.withExec(["bun", "lint"]);

    await linted_app.stdout();
    await linted_app.stderr();

    return linted_app;
  }

  @func()
  async build(source: Directory): Promise<Container> {
    const built_app = this.mount_app_with(source).withExec([
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
   * This function runs the lint and test of the project (used by `on_pull_request` but can be used to test local changes)
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
    const tag_update = await this.get_tag(tag, git_url);

    const app = this.mount_app_with(source_files);

    await this.lint(app);
    await this.test(app);

    const built_app = await this.build(source_files)
    const built_app_directory = built_app.directory(".");
    await this.bump_and_publish(tag_update, built_app_directory, npm_token);
    // await this.build_and_publish(npm_token, app_files, tag_update);

    // return app;
    // pulling the git tags
    // return {files: dag.git(url).head().tree(),
    //     tags: await dag.git(url).tags(),
    // }
    // const tags = (await dag.git(url).tags())
    // return `Tags: ${tags.join(', ')} | Number of tags: ${tags.length}`;
  }

  async get_tag(tag: string, git_url: string): Promise<string> {
    const retrieved_tag = tag ?? (await this.get_latest_tag(git_url));

    if (retrieved_tag.startsWith("v")) {
      return retrieved_tag.slice(1);
    }

    return retrieved_tag;
  }

  /**
   * This function can be use to publish the project on a release trigger.
   * This function is mandatory due to how the asserters are used by dragee's cli and cannot be built to js files for the moment.
   * @param npm_token - the npm token to use to publish the project
   * @param source - the source directory
   * @param git_url - the git url of the repository
   * @param branch - the branch to use
   * @param tag - the tag version to update the project to
   */
  @func()
  async publish(
    npm_token: Secret,
    source?: Directory,
    git_url?: string,
    branch?: string,
    tag?: string
  ) {
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
    const tag_update = await this.get_tag(tag, git_url);

    const app = this.mount_app_with(source_files);

    await this.lint(app);
    await this.test(app);

    const app_directory = app.directory(".");
    await this.bump_and_publish(tag_update, app_directory, npm_token);
  }
  
  @func()
  async bump_and_publish(tag: string, source: Directory, npm_token: Secret): Promise<Container> {
    const updated_version_app = await this.update_app_version(tag, source);
    const published_app = await this.publish_app(updated_version_app, npm_token);
    return published_app;
  }

  @func()
  async publish_app(app: Container, npm_token: Secret): Promise<Container> {
    const published_app = app
      .withSecretVariable("NPM_TOKEN", npm_token)
      .withExec(["npm", "publish", "--access", "public"]);

    await published_app.stdout();
    await published_app.stderr();

    return published_app;
  }

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

  get_repository(url: string, branch = "main"): GitRef {
    const repo = dag.git(url).branch(branch);

    return repo;
  }

  @func()
  async get_latest_tag(url: string): Promise<string> {
    const tags = await dag.git(url).tags();

    return tags.at(-1);
  }
}
