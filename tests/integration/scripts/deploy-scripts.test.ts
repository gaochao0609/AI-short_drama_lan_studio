import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, copyFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const repoRoot = process.cwd();
const tempRoots: string[] = [];
const describeWindows = process.platform === "win32" ? describe : describe.skip;

function makeTempProject() {
  const root = mkdtempSync(join(tmpdir(), "lan-studio-scripts-"));
  tempRoots.push(root);
  mkdirSync(join(root, "scripts"), { recursive: true });
  mkdirSync(join(root, "bin"), { recursive: true });
  return root;
}

function copyRepoScript(root: string, scriptName: string) {
  copyFileSync(join(repoRoot, "scripts", scriptName), join(root, "scripts", scriptName));
}

function writeComposeEnv(root: string) {
  writeFileSync(
    join(root, ".env"),
    [
      "DATABASE_URL=postgresql://postgres:postgres@postgres:5432/ai_short_drama",
      "REDIS_URL=redis://redis:6379",
      "APP_URL=http://localhost:3000",
    ].join("\n"),
    "utf8",
  );
}

function writeFakeDocker(root: string) {
  const dockerCmd = [
    "@echo off",
    "setlocal enabledelayedexpansion",
    'if not defined DOCKER_LOG exit /b 1',
    'echo %*>> \"%DOCKER_LOG%\"',
    "exit /b 0",
    "",
  ].join("\r\n");

  writeFileSync(join(root, "bin", "docker.cmd"), dockerCmd, "utf8");
}

function runPowerShellScript(root: string, scriptName: string, args: string[] = []) {
  const scriptPath = join(root, "scripts", scriptName);
  const dockerLog = join(root, "docker.log");
  const pathEnv = `${join(root, "bin")}${delimiter}${process.env.PATH ?? ""}`;
  const candidates = [
    { command: "pwsh", args: ["-NoProfile", "-NonInteractive", "-File", scriptPath, ...args] },
    {
      command: "powershell",
      args: ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", scriptPath, ...args],
    },
  ];

  let lastError: unknown;

  for (const candidate of candidates) {
    try {
      const stdout = execFileSync(candidate.command, candidate.args, {
        cwd: root,
        env: {
          ...process.env,
          PATH: pathEnv,
          DOCKER_LOG: dockerLog,
        },
        encoding: "utf8",
        stdio: "pipe",
      });

      return { exitCode: 0, stdout, stderr: "", dockerLog };
    } catch (error) {
      const commandError = error as Error & {
        code?: string | number;
        stdout?: Buffer | string;
        stderr?: Buffer | string;
      };

      if (commandError.code === "ENOENT") {
        lastError = error;
        continue;
      }

      return {
        exitCode: typeof commandError.code === "number" ? commandError.code : 1,
        stdout:
          typeof commandError.stdout === "string"
            ? commandError.stdout
            : commandError.stdout?.toString("utf8") ?? "",
        stderr:
          typeof commandError.stderr === "string"
            ? commandError.stderr
            : commandError.stderr?.toString("utf8") ?? "",
        dockerLog,
      };
    }
  }

  throw lastError ?? new Error("PowerShell executable was not found");
}

function readDockerLog(logPath: string) {
  try {
    return readFileSync(logPath, "utf8")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}

afterEach(() => {
  while (tempRoots.length > 0) {
    const root = tempRoots.pop();
    if (root) {
      rmSync(root, { recursive: true, force: true });
    }
  }
});

describeWindows("deployment PowerShell scripts", () => {
  it("install.ps1 stops with a manual .env prompt when .env is missing", () => {
    const root = makeTempProject();
    copyRepoScript(root, "install.ps1");
    writeFakeDocker(root);
    writeFileSync(join(root, ".env.example"), "APP_URL=http://localhost:3000\n", "utf8");

    const result = runPowerShellScript(root, "install.ps1");

    expect(result.exitCode).not.toBe(0);
    expect(`${result.stdout}\n${result.stderr}`).toContain(".env");
    expect(`${result.stdout}\n${result.stderr}`).toContain("manual");
    expect(readDockerLog(result.dockerLog)).not.toContain("compose up -d postgres redis");
  });

  it("install.ps1 runs compose bootstrap, migrate, seed, and app startup in order", () => {
    const root = makeTempProject();
    copyRepoScript(root, "install.ps1");
    writeFakeDocker(root);
    writeComposeEnv(root);

    const result = runPowerShellScript(root, "install.ps1");

    expect(result.exitCode).toBe(0);
    expect(readDockerLog(result.dockerLog)).toEqual([
      "--version",
      "compose version",
      "compose up -d --wait postgres redis",
      "compose run --rm web pnpm db:migrate",
      "compose run --rm web pnpm db:seed",
      "compose up -d web worker",
      "compose ps",
    ]);
  });

  it("install.ps1 rejects host-mode .env values that do not use compose service hostnames", () => {
    const root = makeTempProject();
    copyRepoScript(root, "install.ps1");
    writeFakeDocker(root);
    writeFileSync(
      join(root, ".env"),
      [
        "DATABASE_URL=postgresql://postgres:postgres@localhost:5432/ai_short_drama",
        "REDIS_URL=redis://127.0.0.1:6379",
        "APP_URL=http://localhost:3000",
      ].join("\n"),
      "utf8",
    );

    const result = runPowerShellScript(root, "install.ps1");

    expect(result.exitCode).not.toBe(0);
    expect(`${result.stdout}\n${result.stderr}`).toContain("Compose-style");
    expect(`${result.stdout}\n${result.stderr}`).toContain("postgres");
    expect(readDockerLog(result.dockerLog)).not.toContain("compose up -d --wait postgres redis");
  });

  it("start.ps1 defaults to docker compose up -d", () => {
    const root = makeTempProject();
    copyRepoScript(root, "start.ps1");
    writeFakeDocker(root);
    writeComposeEnv(root);

    const result = runPowerShellScript(root, "start.ps1");

    expect(result.exitCode).toBe(0);
    expect(readDockerLog(result.dockerLog)).toEqual([
      "--version",
      "compose version",
      "compose up -d",
      "compose ps",
    ]);
  });

  it("start.ps1 uses docker compose up -d --build when -Rebuild is set", () => {
    const root = makeTempProject();
    copyRepoScript(root, "start.ps1");
    writeFakeDocker(root);
    writeComposeEnv(root);

    const result = runPowerShellScript(root, "start.ps1", ["-Rebuild"]);

    expect(result.exitCode).toBe(0);
    expect(readDockerLog(result.dockerLog)).toEqual([
      "--version",
      "compose version",
      "compose up -d --build",
      "compose ps",
    ]);
  });

  it("start.ps1 rejects host-mode .env values that would break compose networking", () => {
    const root = makeTempProject();
    copyRepoScript(root, "start.ps1");
    writeFakeDocker(root);
    writeFileSync(
      join(root, ".env"),
      [
        "DATABASE_URL=postgresql://postgres:postgres@localhost:5432/ai_short_drama",
        "REDIS_URL=redis://127.0.0.1:6379",
        "APP_URL=http://localhost:3000",
      ].join("\n"),
      "utf8",
    );

    const result = runPowerShellScript(root, "start.ps1");

    expect(result.exitCode).not.toBe(0);
    expect(`${result.stdout}\n${result.stderr}`).toContain("Compose-style");
    expect(`${result.stdout}\n${result.stderr}`).toContain("postgres");
    expect(readDockerLog(result.dockerLog)).not.toContain("compose up -d");
  });
});
