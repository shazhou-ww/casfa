export interface ExecResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export async function exec(cmd: string[], opts?: { cwd?: string }): Promise<ExecResult> {
  const proc = Bun.spawn(cmd, {
    cwd: opts?.cwd,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  const exitCode = await proc.exited;

  return { exitCode, stdout: stdout.trim(), stderr: stderr.trim() };
}

export async function isDockerRunning(): Promise<boolean> {
  const { exitCode } = await exec(["docker", "info"]);
  return exitCode === 0;
}

export async function isContainerRunning(name: string): Promise<boolean> {
  const { exitCode, stdout } = await exec(["docker", "inspect", "-f", "{{.State.Running}}", name]);
  return exitCode === 0 && stdout === "true";
}

export async function containerExists(name: string): Promise<boolean> {
  const { exitCode } = await exec(["docker", "inspect", name]);
  return exitCode === 0;
}

export async function stopContainer(name: string): Promise<void> {
  await exec(["docker", "rm", "-f", name]);
}

export async function getContainerHostPort(
  name: string,
  containerPort: number
): Promise<number | undefined> {
  const { exitCode, stdout } = await exec(["docker", "port", name, `${containerPort}/tcp`]);
  if (exitCode !== 0 || !stdout) return undefined;
  const firstLine = stdout.split(/\r?\n/)[0]?.trim();
  if (!firstLine) return undefined;
  const match = firstLine.match(/:(\d+)$/);
  if (!match) return undefined;
  const port = Number.parseInt(match[1], 10);
  if (!Number.isFinite(port)) return undefined;
  return port;
}

export interface DynamoDBOpts {
  port: number;
  persistent: boolean;
  containerName: string;
}

export function buildDynamoDBArgs(opts: DynamoDBOpts): string[] {
  const args = [
    "docker",
    "run",
    "-d",
    ...(opts.persistent ? [] : ["--rm"]),
    "--name",
    opts.containerName,
    "-p",
    `${opts.port}:8000`,
    "amazon/dynamodb-local",
    "-jar",
    "DynamoDBLocal.jar",
    "-sharedDb",
  ];
  if (!opts.persistent) {
    args.push("-inMemory");
  }
  return args;
}

export async function startDynamoDB(opts: DynamoDBOpts): Promise<void> {
  if (await isContainerRunning(opts.containerName)) {
    const mappedPort = await getContainerHostPort(opts.containerName, 8000);
    if (mappedPort === opts.port) return;
    await stopContainer(opts.containerName);
  }
  if (await containerExists(opts.containerName)) {
    await exec(["docker", "start", opts.containerName]);
    const mappedPort = await getContainerHostPort(opts.containerName, 8000);
    if (mappedPort === opts.port) return;
    await stopContainer(opts.containerName);
  }
  const args = buildDynamoDBArgs(opts);
  const { exitCode, stderr } = await exec(args);
  if (exitCode !== 0) {
    throw new Error(`Failed to start DynamoDB container: ${stderr}`);
  }
}

export interface MinIOOpts {
  port: number;
  containerName: string;
  dataDir?: string;
  /** When true, add --rm so container is removed on exit (e.g. for e2e). */
  rm?: boolean;
}

export function buildMinIOArgs(opts: MinIOOpts): string[] {
  const args = [
    "docker",
    "run",
    "-d",
    ...(opts.rm ? ["--rm"] : []),
    "--name",
    opts.containerName,
    "-p",
    `${opts.port}:9000`,
    "-e",
    "MINIO_ROOT_USER=minioadmin",
    "-e",
    "MINIO_ROOT_PASSWORD=minioadmin",
  ];
  if (opts.dataDir) {
    args.push("-v", `${opts.dataDir}:/data`);
  }
  args.push("minio/minio", "server", "/data");
  return args;
}

export async function startMinIO(opts: MinIOOpts): Promise<void> {
  if (await isContainerRunning(opts.containerName)) {
    const mappedPort = await getContainerHostPort(opts.containerName, 9000);
    if (mappedPort === opts.port) return;
    await stopContainer(opts.containerName);
  }
  if (await containerExists(opts.containerName)) {
    await exec(["docker", "start", opts.containerName]);
    const mappedPort = await getContainerHostPort(opts.containerName, 9000);
    if (mappedPort === opts.port) return;
    await stopContainer(opts.containerName);
  }
  const args = buildMinIOArgs(opts);
  const { exitCode, stderr } = await exec(args);
  if (exitCode !== 0) {
    throw new Error(`Failed to start MinIO container: ${stderr}`);
  }
}

export async function waitForPort(port: number, timeoutMs = 30_000): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const socket = await Bun.connect({
        hostname: "127.0.0.1",
        port,
        socket: {
          data() {},
          open(socket) {
            socket.end();
          },
          error() {},
          close() {},
        },
      });
      socket.end();
      return true;
    } catch {
      await Bun.sleep(200);
    }
  }
  return false;
}
