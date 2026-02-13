# Webflow MCP in Cursor

The [Webflow MCP server](https://developers.webflow.com/mcp/reference/getting-started) connects Cursor to your Webflow projects so you can manage sites, CMS, pages, and Designer elements via natural language.

## What you need

- **Cursor** – [cursor.com](https://www.cursor.com/)
- **Node.js** – v22.3.0 or higher ([nodejs.org](https://nodejs.org/))
- **Webflow account** – at least one site you can access

**Rough setup time:** ~5 minutes

## Installation

### 1. Add the MCP server in Cursor

1. Go to **Settings → Cursor Settings → MCP & Integrations**
2. Under MCP Tools, click **+ New MCP Server** / **Add Custom MCP**
3. Put this in `.cursor/mcp.json` (or add the `webflow` block to your existing config):

```json
{
  "mcpServers": {
    "webflow": {
      "url": "https://mcp.webflow.com/mcp"
    }
  }
}
```

4. Save the file.

**Tip:** Use a [project-specific `mcp.json`](https://docs.cursor.com/en/context/mcp#configuration-locations) so you don’t get repeated auth prompts when opening multiple Cursor windows.

### 2. Authorize Webflow

1. Go to **Settings → Cursor Settings → MCP & Integrations**
2. Click **Connect** next to Webflow MCP
3. Complete the OAuth flow in the browser: choose which Webflow sites the MCP can use and install the [companion app](https://developers.webflow.com/mcp/reference/how-it-works#designer-companion-app)
4. When done, the Webflow MCP status should show as connected (green)

**Tip:** Authorize only the sites you need to keep things secure and fast. To re-authorize later, expand Webflow MCP and click **Logout**.

### 3. Open the Webflow Designer

Open the site you want to work on in the [Webflow Designer](https://webflow.com/dashboard).

Or ask in chat:

```
Give me a link to open <MY_SITE_NAME> in the Webflow Designer
```

### 4. Start the MCP Bridge App (for Designer tools)

For Designer-related actions (elements, styles, pages in the Designer):

1. In the Designer, open the Apps panel (**E**)
2. Open **Webflow MCP Bridge App** (installed during OAuth)
3. Wait until it shows as connected to the MCP server

## Example prompts

Once the MCP is connected, you can use prompts like:

- *List all my collections and show me their field structures*
- *Audit my site for broken links, missing alt text, and incomplete meta descriptions*
- *Create a responsive hero section with a headline, description, and CTA button*
- *Read the structure of [this page / the current page] and implement a data-module for the FAQ accordion*

## What the MCP can do

- **Data API** – Sites, CMS collections/items, pages, scripts, comments, enterprise (redirects, robots.txt, etc.)
- **Designer API** – Elements, components, styles, variables, pages (when the Designer + Bridge app are open)

Details: [Webflow MCP – How it works & available tools](https://developers.webflow.com/mcp/reference/how-it-works#available-tools)

## Rules and skills for Cursor

Use these so Cursor (and you) get the most out of the Webflow MCP.

### Rules

1. **Resolve site and IDs first**  
   Never assume a site ID. For any tool that needs `site_id`, `siteId`, or `collection_id`, call the **Sites** (or **Collections**) tool first to list options, then use the returned IDs. If the user hasn’t specified a site, list sites and ask which one to use.

2. **Data API vs Designer API**  
   - **Data API** (sites, pages, CMS, components, scripts, etc.): works as soon as OAuth is done. Use for content, structure, and metadata.  
   - **Designer API** (elements, styles, assets, variables, canvas): only works when the Webflow Designer is open and the **Webflow MCP Bridge App** is open and connected. For “change the design” or “add an element” tasks, remind the user to open the Designer and Bridge app first if needed.

3. **Designer: page and selection**  
   Designer tools operate on the **current page** in the open Designer and (where relevant) the **selected element**. Tell the user to open the right page and select the right parent element before running Designer actions.

4. **Element builder depth**  
   The Designer **element builder** only supports up to **3 levels** of nesting. For complex layouts, create in small steps (e.g. container → then add children in a follow-up) or describe the structure so the user can refine in the Designer.

5. **Styles and long-form CSS**  
   When changing styles via MCP, use **long-form** CSS property names (e.g. `margin-top`, `grid-row-gap`) as required by the Designer. Don’t use shorthand the API doesn’t support.

6. **CMS: slug and required fields**  
   When creating or updating CMS items, always provide **name** and **slug** where required, and satisfy any **required** fields in the collection schema. Fetch collection details first if you’re unsure.

7. **Publish explicitly**  
   Data API changes (e.g. CMS items, pages) are **draft** until published. Use the **publish** (or equivalent) tool when the user wants changes to go live, and confirm before publishing.

8. **Context parameter**  
   Every MCP tool call expects a **context** string (15–25 words, third-person, no “I/we/you”). Use it to describe why you’re calling the tool (e.g. “Listing sites to resolve site ID for CMS collection lookup”).

### Skills (effective patterns)

- **Bulk CMS updates**  
  List collection items (with pagination if needed), get collection schema for field types, then create/update items in batches. Validate required fields and slugs; suggest a preview or dry run before applying many changes.

- **Site or page audit**  
  Use **Sites** → **Pages** (and **Collections** / **Items** if needed) to gather structure and content, then analyze for broken links, missing alt text, missing or duplicate meta descriptions, and suggest fixes.

- **Safe publish**  
  Before publishing: list what will be published (e.g. which items/pages), confirm with the user, then call the publish tool. Optionally list sites to confirm the target site.

- **Designer flows**  
  For “add a section” or “change styles”: 1) Confirm Designer + Bridge app are open and on the right page. 2) Get current elements or selection if needed. 3) Use element builder with max 3 levels. 4) Apply styles with long-form properties. 5) If the layout is complex, break into multiple steps.

- **Custom code and scripts**  
  Use the **Custom Code** / **Scripts** tools to list existing scripts, then add or update. Prefer listing first to avoid overwriting existing code by mistake.

- **Referencing official docs**  
  For parameter names, limits (e.g. CMS limit 100), and tool-specific behavior, refer to [Webflow MCP – How it works](https://developers.webflow.com/mcp/reference/how-it-works) and the linked Data/Designer tool reference pages when in doubt.

### Reading HTML/CSS structure for data-modules

When implementing **data-module(s)** or any custom JS that targets Webflow’s DOM, the agent must know the real structure (tags, classes, IDs, nesting, attributes). Use the MCP to read that structure instead of guessing.

**Rules**

- **Read before writing.** Before writing or editing code for a data-module (or any script that queries the DOM), fetch the current page or element structure from Webflow. Never assume class names, IDs, or DOM shape.
- **Choose the right source of truth:**
  - **Data API – Pages: get_page_content**  
    Use when you have a `page_id` (e.g. from listing pages). Returns the page’s content structure and node data. Works without the Designer. Best for understanding what’s on a given page (static and structure) so selectors and data-module hooks match the real output.
  - **Designer API – Elements: get_all_elements**  
    Use when the user has the page open in the Designer and the Bridge app is connected. Returns the full element tree (tag, classes, IDs, nesting, attributes). Set `include_style_properties` and `include_all_breakpoint_styles` to `false` when you only need structure/classes/IDs to avoid large payloads; set to `true` only when you need CSS for the implementation.
  - **Designer – get_selected_element**  
    Use when the user has selected a specific element (e.g. the container for a module). Gives exact tag, classes, ID, attributes, and children for that subtree.
- **Use the structure you get.** Derive selectors (e.g. `[data-module="…"]`, `.class-name`, `#id`) and parent/child relationships from the returned nodes. Prefer **data-module** (and optionally data-attributes for options) for attaching behavior so the contract is explicit and stable across design changes.
- **Adding data-module in Webflow.** If the element doesn’t have `data-module` yet, use Designer **element_tool → add_or_update_attribute** (only when the element’s metadata has `canHaveAttributes: true`). Otherwise instruct the user to add the attribute in the Designer (Element settings → Attributes).
- **Verify visually when useful.** After changing elements or attributes, use **element_snapshot_tool** to confirm the area looks correct, especially when layout or visibility matter for the module.

**Skill: Implement a data-module**

1. **Resolve page and site**  
   List sites → list pages (or get current page if Designer is open) → identify the page where the module will run.

2. **Read the structure**  
   - **Option A (no Designer):** Data API → **get_page_content** for that `page_id`. Inspect the returned nodes (tag names, classes, IDs, nesting, text).  
   - **Option B (Designer open):** Designer → **get_all_elements** (structure-only: `include_style_properties: false`, `include_all_breakpoint_styles: false`). If the user selected a container, use **get_selected_element** for that subtree.

3. **Summarize for the implementation**  
   Note: wrapper and trigger elements, key classes/IDs, nesting depth, any existing `data-*` attributes. Identify the best node(s) to carry `data-module` (e.g. the root of the interactive block).

4. **Write the script**  
   Write JS that: uses selectors matching the actual structure (e.g. `document.querySelector('[data-module="my-module"]')` and then queries inside for `.btn`, `.panel`, etc. from the structure); initializes only on present elements; avoids fragile or generic selectors that might match the wrong thing.

5. **Add data-module if needed**  
   If you used Designer to read structure: add `data-module="name"` (and any data-options) via **add_or_update_attribute** on the chosen element, or tell the user exactly where to add it. If you only used Data API, tell the user which element (class/ID/position) should get the attribute.

6. **Register the script**  
   Use Custom Code / Scripts tools to add or update the site or page script that loads and runs the module (list existing scripts first to avoid overwriting).

## Performance tip

MCP works better with smaller projects. For heavy MCP use, consider a dedicated Cursor project to reduce tool overhead and speed up responses.

## References

- [Webflow MCP – Getting started](https://developers.webflow.com/mcp/reference/getting-started)
- [Webflow MCP – How it works](https://developers.webflow.com/mcp/reference/how-it-works)
- [Webflow MCP – Prompt examples](https://developers.webflow.com/mcp/examples)
- [Cursor MCP configuration](https://docs.cursor.com/en/context/mcp#configuration-locations)
- [Webflow MCP in Claude Code](webflow-mcp-claude-code.md) (per-project MCP + skills for Claude Code)
