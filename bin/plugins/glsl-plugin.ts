import { plugin, type BunPlugin } from "bun";

// https://bun.sh/docs/runtime/plugins
// https://github.com/UstymUkhman/vite-plugin-glsl

/*
(*) TODO
- [ ] #1 add glsl file loader al vite plugin glsl
- [ ] #1.1 add include functionality
- [ ] #2 compress shaders
- [ ] #3 load those as raw text
*/

const FILE_EXTENSION = [".glsl", ".vs", ".fs", ".vert", ".frag", ".wgsl"];
const COMPRESS = true;

await plugin({
  name: "glsl loader",
  async setup(build) {
    // const { compile } = await import("svelte/compiler");

    // when a .svelte file is imported...
    build.onLoad({ filter: /\.svelte$/ }, async ({ path }) => {
      // read and compile it with the Svelte compiler
      const file = await Bun.file(path).text();
      //   const contents = compile(file, {
      //     filename: path,
      //     generate: "ssr",
      //   }).js.code;

      const contents = "";

      // and return the compiled source code as "js"
      return {
        contents,
        loader: "js",
      };
    });
  },
});
