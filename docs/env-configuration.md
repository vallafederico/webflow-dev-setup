# .Env Configuration

Environment variables go in `.env` (gitignored). `.env.example` lists the ones the project reads, and [Hosting](./hosting.md#environment) has the table: what each one does and which command reads it.

The deploy URL, preview suffix and host are not environment variables. They are in `project.config.json`, written by `pnpm connect` and committed: see [Configuration Guide](./config.md#project-settings).

The one automatic exception: a production build on Vercel with no `project.config.json` uses the `VERCEL_URL` that Vercel sets itself. Don't set it by hand.
