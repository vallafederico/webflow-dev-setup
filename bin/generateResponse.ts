import { CONFIG } from "./config";
import { getValidatedUrlSafe } from "../src/utils/url-validator";

interface BuildOutput {
  path: string;
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function generateLoaderScript(
  appJs: string | null,
  pageJs: string[],
  cssFiles: string[],
  deployUrl: string,
  localUrl: string
): string {
  const cssArray = cssFiles.map((f) => `"${f}"`).join(", ");
  const hasPages = pageJs.length > 0;

  const pagesMap = hasPages
    ? `{${pageJs
        .map((f) => {
          const slug = f.replace(/^pages\//, "").replace(/\.js$/, "");
          return `"${slug}":"${f}"`;
        })
        .join(",")}}`
    : null;

  const fallback = appJs ? `"${appJs}"` : "null";

  return `<script>
(function(d,h,host){
  var isWF = host.endsWith(".webflow.io");
  var DEP = "${deployUrl}";
  var LOC = "${localUrl}";

  function loadScript(src,cors){
    var s=d.createElement("script");
    s.src=src; s.defer=1;
    if(cors) s.crossOrigin="anonymous";
    h.appendChild(s);
    return s;
  }

  function loadCSS(href){
    var l=d.createElement("link");
    l.rel="stylesheet"; l.href=href;
    h.appendChild(l);
    return l;
  }

  var css = [${cssArray}];
${
  hasPages
    ? `
  var pages = ${pagesMap};
  var slug = location.pathname.replace(/^\\/|\\/$/g,"").split("/")[0];
  var js = pages[slug] || ${fallback};`
    : `
  var js = ${fallback};`
}

  if(!isWF){
    css.forEach(function(f){ loadCSS(DEP+"/"+f); });
    if(js) loadScript(DEP+"/"+js, true);
    return;
  }

  if(js){
    var p=d.createElement("link");
    p.rel="preload"; p.as="script"; p.href=DEP+"/"+js; p.crossOrigin="anonymous";
    h.appendChild(p);
  }
  css.forEach(function(f){
    var p=d.createElement("link");
    p.rel="preload"; p.as="style"; p.href=DEP+"/"+f;
    h.appendChild(p);
  });

  css.forEach(function(f){
    var l=loadCSS(LOC+"/"+f);
    l.onerror=function(){ loadCSS(DEP+"/"+f); };
  });
  if(js){
    var s=loadScript(LOC+"/"+js);
    s.onerror=function(){ loadScript(DEP+"/"+js, true); };
  }

})(document,document.head,location.hostname);
<\/script>`;
}

function generateIndexHtml(outputs: BuildOutput[]) {
  const vercelUrl = getValidatedUrlSafe("VERCEL_URL") || "{NO VERCEL URL}";
  const hasVercel = vercelUrl !== "{NO VERCEL URL}";

  const protocol = process.env.USE_SSL === "true" ? "https" : "http";
  const localUrl = `${protocol}://localhost:${CONFIG.SERVE_PORT}`;

  const allJs = outputs
    .filter(
      (o) => o.path.endsWith(".js") && !o.path.endsWith(".js.map")
    )
    .map((o) => o.path.split("/dist/")[1]);

  const appJs = allJs.find((f) => f === "app.js") ?? null;
  const pageJs = allJs.filter((f) => f !== "app.js");

  const cssFiles = outputs
    .filter((o) => o.path.endsWith(".css"))
    .map((o) => o.path.split("/dist/")[1]);

  const loaderScript = hasVercel
    ? generateLoaderScript(appJs, pageJs, cssFiles, vercelUrl, localUrl)
    : null;

  const jsLinks = allJs
    .map((relativePath) => {
      const isPage = pageJs.includes(relativePath);
      const slug = relativePath.replace(/\.js$/, "");
      const badge = isPage
        ? ` <span style="font-size:0.75em;opacity:0.6">(/&ZeroWidthSpace;${slug})</span>`
        : appJs === relativePath && pageJs.length > 0
        ? ` <span style="font-size:0.75em;opacity:0.6">(fallback)</span>`
        : "";
      return `<li>
        <a href="/${relativePath}" target="_blank" class="main-link">${relativePath}</a>${badge}
        <code class="tag">&lt;script defer src="${localUrl}/${relativePath}"&gt;&lt;/script&gt;</code>
        ${
          hasVercel
            ? `<code class="tag">&lt;script defer src="<a href="${vercelUrl}/${relativePath}" target="_blank">${vercelUrl}/${relativePath}</a>"&gt;&lt;/script&gt;</code>`
            : ""
        }
      </li>`;
    })
    .join("\n");

  const cssLinks = cssFiles
    .map(
      (relativePath) => `<li>
        <a href="/${relativePath}" target="_blank" class="main-link">${relativePath}</a>
        <code class="tag">&lt;link rel="stylesheet" href="${localUrl}/${relativePath}"&gt;</code>
        ${
          hasVercel
            ? `<code class="tag">&lt;link rel="stylesheet" href="<a href="${vercelUrl}/${relativePath}" target="_blank">${vercelUrl}/${relativePath}</a>"&gt;</code>`
            : ""
        }
      </li>`
    )
    .join("\n");

  const mapLinks = outputs
    .filter((output) => output.path.endsWith(".js.map"))
    .map((output) => {
      const relativePath = output.path.split("/dist/")[1];
      return `<li class="map-file"><a href="/${relativePath}" target="_blank" class="main-link">${relativePath}</a></li>`;
    })
    .join("\n");

  return `
    <!DOCTYPE html>
    <html>
      <head>
        <title>Generated Files</title>
        <style>
          :root {
            --bg-color: #ffffff;
            --text-color: #333333;
            --link-color: #0066cc;
            --code-bg: #f5f5f5;
            --code-color: #666666;
            --border-color: #dee2e6;
            --notice-bg: #f8f9fa;
            --notice-text: #495057;
            --hover-bg: #e6ffe6;
          }

          @media (prefers-color-scheme: dark) {
            :root {
              --bg-color: #1a1a1a;
              --text-color: #e0e0e0;
              --link-color: #66b3ff;
              --code-bg: #2d2d2d;
              --code-color: #a0a0a0;
              --border-color: #404040;
              --notice-bg: #2d2d2d;
              --notice-text: #e0e0e0;
              --hover-bg: #1a331a;
            }
          }

          body { 
            font-family: system-ui; 
            padding: 2rem;
            background-color: var(--bg-color);
            color: var(--text-color);
          }
          a { 
            color: var(--link-color); 
            text-decoration: none; 
          }
          a:hover { text-decoration: underline; }
          .main-link { font-weight: bold; }
          ul { list-style: none; padding: 0; }
          li { margin: 0.5rem 0; }
          .map-file { font-size: 0.8em; opacity: 0.5; }
          h2, h3 { margin-top: 2rem; }
          h2:first-child { margin-top: 0; }
          .tag {
            display: block;
            margin-top: 0.25rem;
            font-size: 0.9em;
            color: var(--code-color);
            font-family: monospace;
          }
          .tag a {
            color: var(--link-color);
          }
          .loader-box {
            background-color: var(--code-bg);
            padding: 1rem;
            border-radius: 4px;
            margin-top: 0.5rem;
            cursor: pointer;
            position: relative;
            transition: background-color 0.3s ease;
          }
          .loader-box.copied {
            background-color: var(--hover-bg);
          }
          .loader-box pre {
            margin: 0;
            font-size: 0.85em;
            white-space: pre;
            overflow-x: auto;
            color: var(--code-color);
          }
          .loader-box .copy-hint {
            position: absolute;
            top: 0.5rem;
            right: 0.75rem;
            font-size: 0.75em;
            color: var(--code-color);
            opacity: 0.6;
          }
          .vercel-notice {
            position: fixed;
            bottom: 20px;
            right: 20px;
            background-color: var(--notice-bg);
            border: 1px solid var(--border-color);
            border-radius: 8px;
            padding: 12px 20px;
            box-shadow: 0 2px 10px rgba(0,0,0,0.1);
            font-size: 0.9em;
            color: var(--notice-text);
            z-index: 1000;
            display: flex;
            align-items: center;
            gap: 10px;
          }
          .vercel-notice .icon {
            color: var(--link-color);
            font-size: 1.2em;
          }
          .vercel-notice .close {
            margin-left: 10px;
            cursor: pointer;
            color: var(--code-color);
            font-size: 1.2em;
            padding: 0 5px;
          }
          .vercel-notice .close:hover {
            color: var(--text-color);
          }
        </style>
        <script>
          document.addEventListener('DOMContentLoaded', () => {
            document.querySelectorAll('.loader-box').forEach(box => {
              box.addEventListener('click', async () => {
                const code = box.querySelector('pre').textContent;
                try {
                  await navigator.clipboard.writeText(code);
                  box.classList.add('copied');
                  setTimeout(() => box.classList.remove('copied'), 1000);
                } catch (err) {
                  console.error('Failed to copy text: ', err);
                }
              });
            });

            const closeButton = document.querySelector('.vercel-notice .close');
            if (closeButton) {
              closeButton.addEventListener('click', () => {
                const notice = document.querySelector('.vercel-notice');
                if (notice) notice.style.display = 'none';
              });
            }
          });
        </script>
      </head>
      <body>
        ${
          loaderScript
            ? `<h2>Loader Script</h2>
        <p style="font-size:0.9em;color:var(--code-color)">Paste this into your Webflow site's <code>&lt;head&gt;</code> custom code. Loads from local dev server when on <code>.webflow.io</code>, falls back to deployed.</p>
        <div class="loader-box">
          <span class="copy-hint">click to copy</span>
          <pre>${escapeHtml(loaderScript)}</pre>
        </div>`
            : ""
        }

        <h2>JavaScript Files:</h2>
        <ul>${jsLinks}</ul>

        <h2>CSS Files:</h2>
        <ul>${cssLinks}</ul>
        
        ${mapLinks ? `<h3>Source Maps:</h3><ul>${mapLinks}</ul>` : ""}

        ${
          !hasVercel
            ? '<div class="vercel-notice"><span class="icon">&#9432;</span><span>Add VERCEL_URL to your .env file for full CI/CD functionality</span><span class="close">&#10005;</span></div>'
            : ""
        }
      </body>
    </html>
  `;
}

export function generateResponse(filePath: string, outputs: BuildOutput[]) {
  // Ignore favicon requests
  if (filePath === "/favicon.ico") {
    return new Response(null, { status: 204 });
  }

  // Serve index page
  if (filePath === "/") {
    const html = generateIndexHtml(outputs);
    return new Response(html, {
      headers: { "Content-Type": "text/html" },
    });
  }

  // Serve files from dist
  const file = Bun.file(`dist${filePath}`);
  const contentType =
    {
      ".js": "application/javascript",
      ".css": "text/css",
      ".html": "text/html",
    }[filePath.match(/\.[^.]+$/)?.[0] || ""] || "text/plain";

  return new Response(file, {
    headers: {
      "Content-Type": contentType,
    },
  });
}
