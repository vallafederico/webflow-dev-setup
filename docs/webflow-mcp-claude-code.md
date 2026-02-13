# Webflow MCP in Claude Code

The [Webflow MCP server](https://developers.webflow.com/mcp/reference/getting-started) connects Claude Code to your Webflow projects so you can manage sites, CMS, pages, and Designer elements via natural language. This guide uses a **per-project** MCP setup and optional Webflow skills.

## What you need

- **Claude Code** – [Install the CLI](https://github.com/anthropics/claude-code#installation) and run `claude --version` to confirm
- **Node.js** – v22.3.0 or higher ([nodejs.org](https://nodejs.org/))
- **Webflow account** – at least one site you can access

**Rough setup time:** ~5 minutes

## Per-project MCP setup

Using **project scope** keeps the Webflow MCP in this repo so the whole team gets the same tools and you avoid repeated auth prompts when switching projects.

### 1. Add the Webflow MCP server (project scope)

From your project root, run:

```bash
claude mcp add --transport http webflow --scope project https://mcp.webflow.com/mcp
```

This creates or updates **`.mcp.json`** in the project root. Commit this file so everyone gets the Webflow MCP in this project.

**Manual alternative:** Create or edit `.mcp.json` in the project root:

```json
{
  "mcpServers": {
    "webflow": {
      "type": "http",
      "url": "https://mcp.webflow.com/mcp"
    }
  }
}
```

**Tip:** Project-scoped servers prompt for approval before first use. To reset approval choices later: `claude mcp reset-project-choices`.

### 2. Authorize Webflow

1. Start Claude Code from this project directory:

   ```bash
   claude
   ```

2. In the Claude Code REPL, run:

   ```
   /mcp
   ```

3. Choose the Webflow MCP server and **Authenticate**. Complete the OAuth flow in the browser: select which Webflow sites to allow and install the [companion app](https://developers.webflow.com/mcp/reference/how-it-works#designer-companion-app).
4. When done, Webflow should show as connected.

**Tip:** Authorize only the sites you need. To re-authorize or revoke, use `/mcp` and clear authentication for Webflow.

### 3. Open the Webflow Designer

Open the site you want to work on in the [Webflow Designer](https://webflow.com/dashboard).

Or ask in chat:

```
Give me a link to open <MY_SITE_NAME> in the Webflow Designer
```

### 4. Start the MCP Bridge App (for Designer tools)

For Designer-related actions (elements, styles, canvas):

1. In the Designer, open the Apps panel (**E**).
2. Open **Webflow MCP Bridge App** (installed during OAuth).
3. Wait until it shows as connected to the MCP server.

## Optional: Webflow skills plugin

[Webflow Claude skills](https://developers.webflow.com/mcp/reference/claude-skills) are pre-built workflows (bulk CMS update, site audit, safe publish, etc.) that combine multiple MCP tools. They work on top of the Webflow MCP.

### Install from marketplace

```bash
# Add the marketplace
claude plugin marketplace add webflow/webflow-skills

# Install the plugin
claude plugin install webflow-skills@webflow-skills
```

Restart Claude Code after installing. Skills activate automatically when your prompt matches their use case.

### Or install from local repo

```bash
git clone git@github.com:webflow/webflow-skills.git ~/webflow-skills
claude plugin install ~/webflow-skills
```

### Verify

In Claude Code, try:

```
Audit my Webflow site for common issues
```

If the `site-audit` skill is working, Claude will run the health check automatically.

### Updating skills

```bash
claude plugin marketplace update
claude plugin update webflow-skills@webflow-skills
```

Or use the interactive plugin manager: `/plugin`.

## Example prompts

Once the MCP (and optionally skills) are set up:

- *List all my collections and show me their field structures*
- *Audit my site for broken links, missing alt text, and incomplete meta descriptions*
- *Create a responsive hero section with a headline, description, and CTA button*
- *Read the structure of [this page / the current page] and implement a data-module for the FAQ accordion*

## Rules and skills for Claude Code

Use these so Claude Code uses the Webflow MCP effectively.

### Rules (summary)

1. **Resolve site and IDs first** – Never assume a site or collection ID. Use the Sites (or CMS) tools to list and use returned IDs.
2. **Data API vs Designer API** – Data API works after OAuth. Designer API (elements, styles, assets, variables) only works when the Webflow Designer is open and the **Webflow MCP Bridge App** is connected.
3. **Designer: page and selection** – Designer tools act on the current page and, where relevant, the selected element.
4. **Element builder** – Max **3 levels** of nesting; build complex layouts in steps.
5. **Styles** – Use **long-form** CSS property names (e.g. `margin-top`, `grid-row-gap`).
6. **CMS** – Provide required fields and `name`/`slug`; get collection details first if needed.
7. **Publish** – Data API changes are draft until you publish; confirm before publishing.
8. **Context** – Every MCP tool expects a **context** string (15–25 words, third-person).

### Data-modules: read structure first

Before writing or editing any **data-module** (or DOM-targeting script), fetch the real HTML/CSS structure from Webflow:

- **Data API → get_page_content(page_id)** – When you have a page_id (from list pages). No Designer needed.
- **Designer → get_all_elements** – When Designer + Bridge are open. Use `include_style_properties: false` and `include_all_breakpoint_styles: false` when you only need structure/classes/IDs.
- **Designer → get_selected_element** – When the user has selected the container or relevant element.

Derive selectors and `data-module` placement from the returned nodes. Prefer `data-module` for attaching behavior. Add the attribute via Designer **add_or_update_attribute** when `canHaveAttributes: true`, or tell the user where to add it.

**Full rules and skills** (including the full “Implement a data-module” flow): see [Webflow MCP in Cursor](webflow-mcp-cursor.md#rules-and-skills-for-cursor) — the same rules and skills apply to Claude Code.

## Performance tip

MCP works better with smaller projects. For heavy MCP use, consider a dedicated project directory to reduce tool overhead and speed up responses.

## References

- [Webflow MCP – Getting started](https://developers.webflow.com/mcp/reference/getting-started) (includes Claude Desktop “Enable developer mode” and Cursor/Windsurf tabs)
- [Webflow MCP – How it works](https://developers.webflow.com/mcp/reference/how-it-works)
- [Webflow MCP – Claude skills](https://developers.webflow.com/mcp/reference/claude-skills)
- [Webflow MCP – Prompt examples](https://developers.webflow.com/mcp/examples)
- [Claude Code – MCP (scopes, .mcp.json, /mcp)](https://code.claude.com/docs/en/mcp)
- [Claude Code – Settings (project vs user scope)](https://code.claude.com/docs/en/settings)
- [Webflow MCP in Cursor](webflow-mcp-cursor.md) (same rules/skills, Cursor-specific setup)
