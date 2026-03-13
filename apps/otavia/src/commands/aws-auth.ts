import { getAwsProfile } from "./aws.js";

export type AwsCliRunner = (
  args: string[],
  env: Record<string, string | undefined>
) => Promise<number>;

const defaultAwsCliRunner: AwsCliRunner = async (args, env) => {
  const proc = Bun.spawn(["aws", ...args], {
    cwd: process.cwd(),
    env: { ...process.env, ...env },
    stdout: "ignore",
    stderr: "ignore",
  });
  return await proc.exited;
};

export async function checkAwsCredentials(
  rootDir: string,
  runAwsCli: AwsCliRunner = defaultAwsCliRunner
): Promise<{ ok: boolean; profile: string }> {
  const profile = getAwsProfile(rootDir);
  const env: Record<string, string | undefined> = {
    AWS_PROFILE: process.env.AWS_PROFILE ?? profile,
    AWS_REGION: process.env.AWS_REGION,
  };
  const exitCode = await runAwsCli(
    ["sts", "get-caller-identity", "--output", "json"],
    env
  );
  return { ok: exitCode === 0, profile };
}
