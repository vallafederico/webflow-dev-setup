type EditorListener = (isEditor: boolean) => void;

// app.js is injected from the head, so on a cached reload it can run before
// <body> is parsed. Reading `document.body` then threw during bundle init,
// which killed the whole app and left the preloader cover up for good.
const checkEditorState = () => {
  const firstChild = document.body?.firstElementChild;
  return (
    firstChild instanceof HTMLElement &&
    firstChild.classList.contains("w-editor-publish-node")
  );
};

// 19 modules call handleEditor(). Creating a MutationObserver per call meant 19
// observers on document.body, none of them ever disconnected. One shared
// observer fans out to every listener instead.
const listeners = new Set<EditorListener>();
let observer: MutationObserver | null = null;
let previousState = false;

const syncState = () => {
  const nextState = checkEditorState();
  if (nextState === previousState) return;
  previousState = nextState;
  console.log("Editor state changed to:", nextState);
  listeners.forEach((fn) => fn(nextState));
};

function ensureObserver() {
  if (observer) return;
  previousState = checkEditorState();

  const mutationObserver = new MutationObserver(syncState);
  observer = mutationObserver;

  const observeBody = () => {
    mutationObserver.observe(document.body, {
      childList: true,
      subtree: false,
    });
    syncState();
  };

  if (document.body) observeBody();
  else document.addEventListener("DOMContentLoaded", observeBody, { once: true });
}

export function handleEditor(onEditorView: EditorListener | null = null) {
  ensureObserver();

  const isEditor = checkEditorState();

  if (onEditorView) {
    listeners.add(onEditorView);
    onEditorView(isEditor);
  }

  return isEditor;
}

/** Drop a listener registered via {@link handleEditor}. */
export function releaseEditor(onEditorView: EditorListener) {
  listeners.delete(onEditorView);
}
