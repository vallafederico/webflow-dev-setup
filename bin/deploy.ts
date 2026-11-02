import { readProjectConfig } from "./project-config";

export async function deploy() {
  const config = readProjectConfig();
  if (!config) {
    console.log("No project.config.json. Run `pnpm connect` to choose a host.");
    return;
  }

  if (config.host === "cloudflare") {
    console.log(
      "Cloudflare deploys from git. Push to main and Workers Builds updates " +
        config.deployUrl
    );
    return;
  }

  if (!process.env.VERCEL_DEPLOY_HOOK) {
    console.log("VERCEL_DEPLOY_HOOK is not set. Set it in the .env file");
    return;
  }

  const res = await fetch(process.env.VERCEL_DEPLOY_HOOK!, {
    method: "POST",
  });

  if (!res.ok) {
    console.log("Deploy failed ;(");
  }

  const data = await res.json();
  console.log(data);

  console.log(`\nDeployment URL: ${config.deployUrl}`);
  console.log("Check the build progress at the URL above");
}

if (import.meta.main) deploy();
