import { plugin } from "bun";
import { promises as fs } from "fs";
import path from "path";
import { Glob } from "bun";
import type { OnLoadArgs, PluginBuilder } from "bun";

interface GlobPluginOptions {
  extensions?: string[]; // allowed file extensions (e.g. [".js", ".ts"])
}

export function globEagerPlugin(options: GlobPluginOptions = {}): any {
  const defaultExtensions = options.extensions || [".js", ".ts"];

  return {
    name: "glob-eager-plugin",
    setup(builder: PluginBuilder) {
      builder.onLoad({ filter: /\.(jsx?|tsx?)$/ }, async (args: OnLoadArgs) => {
        // console.log("Plugin triggered for file:", args.path);
        const sourceCode = await fs.readFile(args.path, "utf8");
        if (!sourceCode.includes("import.meta.glob")) {
          return; // Skip files without import.meta.glob
        }

        const importerDir = path.dirname(args.path);
        const importLines: string[] = [];
        let transformedCode = sourceCode;

        // Match `import.meta.glob('./some/pattern/*.js', { eager: true })`
        const globRegex =
          /import\.meta\.glob\(\s*["'`](.*?)["'`](?:,\s*\{.*?eager:\s*true.*?)?\s*\)/g;
        let match: RegExpExecArray | null;

        while ((match = globRegex.exec(sourceCode)) !== null) {
          const [fullMatch, globPattern] = match;
          const absolutePattern = path.resolve(importerDir, globPattern);

          //   console.log("Processing glob pattern:", globPattern);
          //   console.log("Absolute pattern:", absolutePattern);

          // Extract the base directory and pattern
          let firstWildcard = absolutePattern.length;
          for (const ch of ["*", "?", "[", "{", "!"]) {
            const idx = absolutePattern.indexOf(ch);
            if (idx !== -1 && idx < firstWildcard) firstWildcard = idx;
          }

          let baseDir = path.dirname(absolutePattern);
          let globPart = path.basename(absolutePattern);
          if (firstWildcard !== absolutePattern.length) {
            baseDir = absolutePattern.substring(0, firstWildcard);
            globPart = absolutePattern.substring(firstWildcard);
          }

          // Scan files matching the glob pattern
          try {
            const globber = new Glob(globPart);
            const matchedFiles: string[] = [];

            // console.log("Scanning directory:", baseDir);
            // console.log("Using glob pattern:", globPart);

            for await (const filePath of globber.scan(baseDir)) {
              //   console.log("Found file:", filePath);
              if (!defaultExtensions.some((ext) => filePath.endsWith(ext)))
                continue;
              const fullPath = path.join(baseDir, filePath);
              matchedFiles.push(fullPath);
            }
            matchedFiles.sort();

            // console.log("Matched files:", matchedFiles);

            // Generate import statements
            const objectEntries: string[] = [];
            matchedFiles.forEach((file, index) => {
              const importVar = `__glob_${index}`;
              let importPath = path
                .relative(importerDir, file)
                .split(path.sep)
                .join("/");

              if (!importPath.startsWith("./")) {
                importPath = "./" + importPath;
              }

              //   console.log("Generated import path:", importPath);

              importLines.push(
                `import * as ${importVar} from '${importPath}';`
              );
              objectEntries.push(`"${importPath}": ${importVar}`);
            });

            // Replace `import.meta.glob(...)` with an object
            transformedCode = transformedCode.replace(
              fullMatch,
              `{ ${objectEntries.join(", ")} }`
            );
          } catch (error) {
            console.error("Error processing glob:", error);
            const line = sourceCode
              .substring(0, match.index)
              .split("\n").length;
            const reason =
              error instanceof Error ? error.message : String(error);
            throw new Error(
              `Failed to process glob pattern at ${args.path}:${line}: ${reason}`
            );
          }
        }

        // Prepend generated import statements
        const finalCode = importLines.join("\n") + "\n" + transformedCode;
        // console.log(finalCode);
        return {
          contents: finalCode,
          loader: args.path.endsWith(".ts") ? "ts" : "js",
        };
      });
    },
  };
}
