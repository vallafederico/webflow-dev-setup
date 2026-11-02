# Backend

The only code that runs per request is the API in `api/`. Everything else is static files. See [Hosting](./hosting.md) for how each host serves it.

# The Api Folder

Each top-level file `api/<name>.ts` is a route at `/api/<name>`. It exports one function per HTTP method, each taking a `Request` and returning a `Response`:

```ts
// api/hello.ts
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,OPTIONS",
  "Content-Type": "application/json",
};

export function OPTIONS(request: Request) {
  return new Response(null, { headers: cors });
}

export function GET(request: Request) {
  return new Response(JSON.stringify({ message: "Hello" }), { headers: cors });
}
```

- **Methods**: `GET`, `HEAD`, `POST`, `PUT`, `PATCH`, `DELETE` and `OPTIONS`. A method the file doesn't export gets 405. That includes `HEAD`: a handler that needs it exports `HEAD` itself.
- **CORS**: handlers set their own headers, and export `OPTIONS` if the browser preflights. `api/test.ts` shows a full example.
- **Helpers**: keep shared code in a subfolder such as `api/utils/`. On Cloudflare, files starting with `_` or `.`, `*.test.ts` and `*.d.ts` aren't routes. The local server (`pnpm api`) loads every top-level `.ts` file, so don't rely on that naming there.
- **Unused**: if you have no API routes, delete the `api/` folder.

Run it locally with `pnpm api`, which serves the routes on port 6546 and lists them at `http://localhost:6546/api`. `pnpm all` runs it next to the dev server.

# Api Path File

`src/utils/api-path.ts` exports `apiPath(route)`, which gives the full URL of a route from the bundle, because the bundle runs on the Webflow domain where relative URLs would miss:

```ts
import { apiPath } from "@/utils/api-path";

const response = await fetch(apiPath("hello"));
```

- **Dev**: `http://localhost:6546/api/hello` (`https` when `USE_SSL=true`).
- **Production**: the deploy URL, `https://<name>.<domain>/api/hello`. No `localhost` URL is built into the production bundle.
- **Previews**: when the bundle was loaded from a preview deployment (`?js=<preview url>`), the preview's own API is used.
