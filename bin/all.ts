import type { SpawnOptions } from "bun";

const spawnOptions: SpawnOptions.BaseOptions<"inherit", "inherit", "inherit"> =
  {
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  };

const run = async () => {
  Bun.spawn(["bun", "run", "dev"], spawnOptions);
  Bun.spawn(["bun", "run", "api"], spawnOptions);

  process.on("SIGINT", () => {
    console.log("\n👋 Shutting down servers...");
    process.exit(0);
  });
};

run();
