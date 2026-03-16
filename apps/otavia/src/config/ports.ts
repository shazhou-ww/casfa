export type PortStage = "dev" | "test";

export type StagePorts = {
  portBase: number;
  frontend: number;
  backend: number;
  dynamodb: number;
  minio: number;
};

type PortOffsets = {
  frontend: number;
  backend: number;
  dynamodb: number;
  minio: number;
};

const OFFSETS: Record<PortStage, PortOffsets> = {
  dev: {
    frontend: 100,
    backend: 1900,
    dynamodb: 2001,
    minio: 2000,
  },
  test: {
    frontend: 100,
    backend: 910,
    dynamodb: 12,
    minio: 1014,
  },
};

export function resolvePortsFromPortBase(stage: PortStage, portBase: number): StagePorts {
  const offsets = OFFSETS[stage];
  return {
    portBase,
    frontend: portBase + offsets.frontend,
    backend: portBase + offsets.backend,
    dynamodb: portBase + offsets.dynamodb,
    minio: portBase + offsets.minio,
  };
}

export function resolvePortsFromEnv(
  stage: PortStage,
  env: Record<string, string | undefined> = process.env
): StagePorts {
  const raw = env.PORT_BASE?.trim();
  if (!raw) {
    throw new Error(`Missing PORT_BASE for stage "${stage}". Define it in .env.dev/.env.test or process env.`);
  }
  const portBase = Number.parseInt(raw, 10);
  if (!Number.isFinite(portBase)) {
    throw new Error(`Invalid PORT_BASE for stage "${stage}": "${raw}"`);
  }
  return resolvePortsFromPortBase(stage, portBase);
}
