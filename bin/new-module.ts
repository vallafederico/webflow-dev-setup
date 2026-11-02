import { existsSync, writeFileSync } from "node:fs";
import path from "node:path";
import { moduleNameProblem } from "./check/house-rules";

const root = path.resolve(import.meta.dir, "..");

/** Starts from a pattern every house rule accepts, so it needs no edits. */
export function moduleSource(): string {
  return `import { onDestroy, onMount } from "@/modules/_";

export default function (element: HTMLElement, dataset: DOMStringMap) {
  const onClick = () => {
    element.dataset.clicked = dataset.clicked ?? "true";
  };

  onMount(() => {
    element.addEventListener("click", onClick);
  });

  onDestroy(() => {
    element.removeEventListener("click", onClick);
  });
}
`;
}

if (import.meta.main) {
  const name = process.argv[2];
  if (!name || name.startsWith("-")) {
    console.error(
      "Usage: pnpm new:module <name>   (kebab-case, e.g. hero-video)"
    );
    process.exit(1);
  }
  const problem = moduleNameProblem(name);
  if (problem) {
    console.error(`Can't create a module: ${problem}`);
    process.exit(1);
  }

  const file = path.join(root, "src", "modules", `${name}.ts`);
  const relative = `src/modules/${name}.ts`;
  if (existsSync(file)) {
    console.error(`Refusing to overwrite ${relative}, it already exists`);
    process.exit(1);
  }
  if (!existsSync(path.dirname(file))) {
    console.error("src/modules does not exist, so this is not a project root");
    process.exit(1);
  }

  writeFileSync(file, moduleSource(), { flag: "wx" });
  console.log(`Created ${relative}`);
  console.log(`Use it in Webflow with the attribute data-module="${name}"`);
  console.log("Run pnpm check after you change it");
}
