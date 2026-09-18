// ==UserScript==
// @name         Bookmarks Folders Bridge
// @description  Move folders between the tab sidebar and the bookmarks bar
// @version      1.1.0
// @author       pvalles
// @grant        none
// ==/UserScript==

(async function BFBridge() {
  "use strict";

  const LOG = "[BFBridge]";

  // ============================================================
  // LIFECYCLE — allow clean re-injection
  // ============================================================
  // Sine re-runs this script on every mod update/reload. Instead of bailing
  // out (which left a half-dead UI behind), tear the previous instance down.
  if (window.__bfBridge && typeof window.__bfBridge.destroy === "function") {
    try { window.__bfBridge.destroy(); } catch (e) { console.warn(LOG, "cleanup failed:", e); }
  }

  const instance = { listeners: [] };
  window.__bfBridge = instance;

  // Register a listener and remember how to undo it
  function on(target, type, fn, capture = false) {
    target.addEventListener(type, fn, capture);
    instance.listeners.push(() => target.removeEventListener(type, fn, capture));
  }

  instance.destroy = () => {
    for (const off of instance.listeners) {
      try { off(); } catch (_) {}
    }
    instance.listeners.length = 0;
    for (const el of document.querySelectorAll("[id^='bfbridge-']")) el.remove();
  };

  // Wait for the browser window to be ready
  await new Promise(r => {
    if (document.readyState === "complete") return r();
    window.addEventListener("load", r, { once: true });
  });

  // Zen exposes its folder/workspace APIs only after initialization
  if (typeof gZenWorkspaces !== "undefined" && gZenWorkspaces.promiseInitialized) {
    try { await gZenWorkspaces.promiseInitialized; } catch (_) {}
  }

  // Private windows (and very old Zen builds) have no folders API at all
  if (typeof gZenWorkspaces === "undefined" || typeof gZenFolders === "undefined") {
    console.warn(LOG, "Zen folders/workspaces API not available in this window — mod not loaded.");
    return;
  }

  // ============================================================
  // LOCALIZATION (es / en)
  // ============================================================

  const IS_ES = (() => {
    try { return (Services.locale.appLocaleAsBCP47 || "en").toLowerCase().startsWith("es"); }
    catch (_) { return false; }
  })();

  const STRINGS = {
    es: {
      menuSave: "📌 Guardar en Marcadores…",
      menuOpen: "📂 Abrir como carpeta de pestañas…",
      bmHeader: "📌 Guardar carpeta en Marcadores",
      bmHint: "Selecciona la carpeta destino:",
      wsHeader: "📂 Abrir marcadores como carpeta de pestañas",
      wsHintWorkspace: "Workspace destino:",
      wsHintFolder: "Dentro de carpeta <em>(opcional — raíz si no aplica)</em>:",
      toolbar: "Barra de marcadores",
      menuRoot: "Menú de marcadores",
      other: "Otros marcadores",
      wsRoot: "📂 Raíz del workspace",
      cancel: "Cancelar",
      save: "Guardar",
      open: "Abrir",
      loading: "Cargando…",
      folder: "Carpeta",
      unnamed: "Carpeta sin nombre",
      imported: "Carpeta importada",
      savedOk: "Carpeta guardada en marcadores",
      openedOk: "Carpeta abierta como pestañas",
      errNoFolder: "No se pudo identificar la carpeta de marcadores.",
      errNoWorkspace: "No hay ningún workspace seleccionado.",
      errRead: "No se pudo leer la carpeta de marcadores.",
      errCreate: "No se pudo crear la carpeta de pestañas.",
      errPrefix: "Error: "
    },
    en: {
      menuSave: "📌 Save to Bookmarks…",
      menuOpen: "📂 Open as tab folder…",
      bmHeader: "📌 Save folder to Bookmarks",
      bmHint: "Pick the destination folder:",
      wsHeader: "📂 Open bookmarks as a tab folder",
      wsHintWorkspace: "Target workspace:",
      wsHintFolder: "Inside folder <em>(optional — root if unset)</em>:",
      toolbar: "Bookmarks toolbar",
      menuRoot: "Bookmarks menu",
      other: "Other bookmarks",
      wsRoot: "📂 Workspace root",
      cancel: "Cancel",
      save: "Save",
      open: "Open",
      loading: "Loading…",
      folder: "Folder",
      unnamed: "Untitled folder",
      imported: "Imported folder",
      savedOk: "Folder saved to bookmarks",
      openedOk: "Folder opened as tabs",
      errNoFolder: "Could not identify the bookmark folder.",
      errNoWorkspace: "No workspace selected.",
      errRead: "Could not read the bookmark folder.",
      errCreate: "Could not create the tab folder.",
      errPrefix: "Error: "
    }
  };

  const S = IS_ES ? STRINGS.es : STRINGS.en;

  // ============================================================
  // PREFERENCES (declared in preferences.json)
  // ============================================================

  const PREF_INCLUDE_EMPTY = "bfbridge.include-empty-tabs";
  const PREF_BACKGROUND = "bfbridge.open-tabs-in-background";

  function getBoolPref(name, fallback) {
    try { return Services.prefs.getBoolPref(name, fallback); } catch (_) { return fallback; }
  }

  // ============================================================
  // STATE
  // ============================================================
  let _contextFolder = null;           // zen-folder being right-clicked
  let _contextBookmarkGuid = null;     // bookmark folder guid being right-clicked
  let _selectedBookmarkParentGuid = PlacesUtils.bookmarks.toolbarGuid;
  let _selectedTargetFolder = null;    // zen-folder to nest into (null = workspace root)

  // ============================================================
  // UTILITIES — FOLDER TRAVERSAL
  // ============================================================

  function getWorkspaces() {
    return gZenWorkspaces.getWorkspaces() || [];
  }

  // Direct children of a folder that are zen-folders (subfolders)
  function getDirectSubfolders(folder) {
    return getFolderItems(folder).filter(el => el.isZenFolder);
  }

  // Top-level folders in a workspace
  function getTopFoldersInWorkspace(workspaceUuid) {
    const wsEl = gZenWorkspaces.workspaceElement(workspaceUuid);
    const container = wsEl?.pinnedTabsContainer;
    if (!container) return [];
    return Array.from(container.querySelectorAll("zen-folder")).filter(
      f => !f.parentElement?.closest("zen-folder")
    );
  }

  // Get direct child items of a zen-folder (tabs + subfolders), using the
  // correct Zen API. Falls back gracefully across Zen versions.
  function getFolderItems(folder) {
    if (Array.isArray(folder.allItems)) return folder.allItems;
    if (folder.allItems && folder.allItems.length !== undefined) return Array.from(folder.allItems);
    return Array.from(folder.children);
  }

  // Resolve a tab URL, including unloaded/lazy pinned tabs (same order Zen uses)
  function getTabURL(tab) {
    return tab._zenPinnedInitialState?.entry?.url || tab.linkedBrowser?.currentURI?.spec || "";
  }

  // Places rejects the whole tree if a single entry carries an unusable URL
  function isBookmarkableURL(url) {
    if (!url) return false;
    try { Services.io.newURI(url); return true; } catch (_) { return false; }
  }

  const EMPTY_URLS = ["about:blank", "about:newtab", "about:home", "about:privatebrowsing"];

  // Build a nested bookmarks insertTree node from a zen-folder (recursive)
  function zenFolderToInsertNode(folder, includeEmpty) {
    const children = [];

    for (const child of getFolderItems(folder)) {
      if (child.isZenFolder) {
        children.push(zenFolderToInsertNode(child, includeEmpty));
      } else if (gBrowser.isTab?.(child)) {
        const isEmptyTab = child.hasAttribute("zen-empty-tab");
        const url = getTabURL(child);
        const isEmptyURL = !url || EMPTY_URLS.includes(url.replace(/[?#].*$/, ""));

        if (!includeEmpty && (isEmptyTab || isEmptyURL)) continue;
        if (!isBookmarkableURL(url)) continue;

        children.push({
          type: PlacesUtils.bookmarks.TYPE_BOOKMARK,
          title: child.label || child.linkedBrowser?.contentTitle || url,
          url
        });
      }
    }

    return {
      type: PlacesUtils.bookmarks.TYPE_FOLDER,
      title: folder.label || S.unnamed,
      children
    };
  }

  // A promiseBookmarksTree node is a bookmark (leaf) if it has a URL
  function isBmBookmarkNode(n) {
    return !!(n.uri || n.url) && !isBmFolderNode(n);
  }

  // Open a bookmark tree recursively as zen-folders inside workspaceUuid.
  // parentZenFolder: zen-folder to nest into, or null = workspace root.
  function bookmarkNodeToZenFolder(node, workspaceUuid, parentZenFolder) {
    if (!node || !isBmFolderNode(node)) return null;

    const inBackground = getBoolPref(PREF_BACKGROUND, true);
    const children = node.children || [];
    const directBookmarks = children.filter(isBmBookmarkNode);
    const subfolderNodes = children.filter(c => isBmFolderNode(c) && !isBmBookmarkNode(c));

    // Create tabs for direct bookmarks (createFolder pins them itself)
    const tabs = [];
    for (const bm of directBookmarks) {
      const url = bm.uri || bm.url;
      if (!isBookmarkableURL(url)) continue;
      const tab = gBrowser.addTab(url, {
        triggeringPrincipal: Services.scriptSecurityManager.getSystemPrincipal(),
        inBackground,
        skipAnimation: true
      });
      tabs.push(tab);
    }

    // Build folder creation options; nest into parent if provided by
    // anchoring the insertion point inside the parent's groupContainer.
    const opts = {
      workspaceId: workspaceUuid,
      label: node.title || S.imported,
      renameFolder: false
    };
    if (parentZenFolder && parentZenFolder.groupContainer) {
      parentZenFolder.collapsed = false;
      const anchor = parentZenFolder.groupContainer.lastElementChild;
      if (anchor) opts.insertAfter = anchor;
    }

    const newFolder = gZenFolders.createFolder(tabs, opts);

    // Recursively create subfolders nested inside this folder
    for (const subNode of subfolderNodes) {
      bookmarkNodeToZenFolder(subNode, workspaceUuid, newFolder);
    }

    return newFolder;
  }

  // ============================================================
  // UI — CREATE PANELS
  // ============================================================

  const HTMLNS = "http://www.w3.org/1999/xhtml";

  // Helper: build an HTML element in the correct namespace
  function h(tag, attrs = {}, children = []) {
    const el = document.createElementNS(HTMLNS, tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (k === "class") el.className = v;
      else if (k === "text") el.textContent = v;
      else el.setAttribute(k, v);
    }
    for (const c of children) el.appendChild(c);
    return el;
  }

  // Panel references (stored, not looked up by getElementById)
  let _bmPanel, _bmTree, _wsPanel, _wsSelect, _wsTree;

  // Open a panel centered in the browser window
  function openCentered(panel) {
    const PANEL_W = 460;
    const PANEL_H = Math.min(600, Math.round(window.innerHeight * 0.78));
    const x = window.mozInnerScreenX + (window.innerWidth - PANEL_W) / 2;
    const y = window.mozInnerScreenY + (window.innerHeight - PANEL_H) / 2;
    panel.openPopupAtScreen(Math.round(x), Math.round(y), false);
  }

  function createUI() {
    const popupSet = document.getElementById("mainPopupSet") || document.documentElement;

    // --- Bookmark folder picker panel (tab→bookmark direction) ---
    _bmPanel = document.createXULElement("panel");
    _bmPanel.id = "bfbridge-bm-panel";
    _bmPanel.setAttribute("noautofocus", "true");

    _bmTree = h("div", { class: "bfbridge-tree", id: "bfbridge-bm-tree" });
    const bmCancel = h("button", { text: S.cancel });
    const bmOk = h("button", { class: "bfbridge-primary", text: S.save });
    bmCancel.addEventListener("click", () => _bmPanel.hidePopup());
    bmOk.addEventListener("click", onSaveFolderToBookmarks);

    _bmPanel.appendChild(
      h("div", { class: "bfbridge-panel" }, [
        h("div", { class: "bfbridge-header", text: S.bmHeader }),
        h("div", { class: "bfbridge-hint", text: S.bmHint }),
        _bmTree,
        h("div", { class: "bfbridge-actions" }, [bmCancel, bmOk])
      ])
    );
    popupSet.appendChild(_bmPanel);

    // --- Workspace + folder picker panel (bookmark→tab direction) ---
    _wsPanel = document.createXULElement("panel");
    _wsPanel.id = "bfbridge-ws-panel";
    _wsPanel.setAttribute("noautofocus", "true");

    _wsSelect = h("select", { class: "bfbridge-select", id: "bfbridge-ws-select" });
    _wsTree = h("div", { class: "bfbridge-tree", id: "bfbridge-ws-tree" });
    _wsSelect.addEventListener("change", populateWsFolderTree);
    const wsCancel = h("button", { text: S.cancel });
    const wsOk = h("button", { class: "bfbridge-primary", text: S.open });
    wsCancel.addEventListener("click", () => _wsPanel.hidePopup());
    wsOk.addEventListener("click", onOpenBookmarkAsFolder);

    const hintFolder = h("div", { class: "bfbridge-hint" });
    hintFolder.innerHTML = S.wsHintFolder;

    _wsPanel.appendChild(
      h("div", { class: "bfbridge-panel" }, [
        h("div", { class: "bfbridge-header", text: S.wsHeader }),
        h("div", { class: "bfbridge-hint", text: S.wsHintWorkspace }),
        _wsSelect,
        hintFolder,
        _wsTree,
        h("div", { class: "bfbridge-actions" }, [wsCancel, wsOk])
      ])
    );
    popupSet.appendChild(_wsPanel);
  }

  // ============================================================
  // BOOKMARK FOLDER PICKER (tab → bookmark)
  // ============================================================

  // Robust folder detection for promiseBookmarksTree nodes
  function isBmFolderNode(n) {
    return n.type === PlacesUtils.bookmarks.TYPE_FOLDER
      || n.typeCode === PlacesUtils.bookmarks.TYPE_FOLDER
      || Array.isArray(n.children)
      || (!n.uri && !n.url && n.type !== PlacesUtils.bookmarks.TYPE_SEPARATOR && n.type !== 3);
  }

  async function showBookmarkPicker() {
    _selectedBookmarkParentGuid = PlacesUtils.bookmarks.toolbarGuid;
    const tree = _bmTree;
    tree.textContent = S.loading;

    openCentered(_bmPanel);

    tree.textContent = "";
    const roots = [
      { guid: PlacesUtils.bookmarks.toolbarGuid, label: S.toolbar },
      { guid: PlacesUtils.bookmarks.menuGuid, label: S.menuRoot },
      { guid: PlacesUtils.bookmarks.unfiledGuid, label: S.other }
    ];

    for (const root of roots) {
      let fullTree = null;
      try { fullTree = await PlacesUtils.promiseBookmarksTree(root.guid); } catch (_) {}
      const node = fullTree || { guid: root.guid, title: root.label, children: [] };
      node.title = root.label; // override root label
      buildCollapsibleFolder(tree, node, 0, false);
    }
  }

  // Build a collapsible folder row + hidden children container (recursive)
  function buildCollapsibleFolder(container, node, depth, expanded) {
    const folderChildren = (node.children || []).filter(isBmFolderNode);
    const hasChildren = folderChildren.length > 0;

    const row = h("div", { class: "bfbridge-item" + (node.guid === _selectedBookmarkParentGuid ? " selected" : "") });
    row.style.paddingLeft = `${depth * 16 + 6}px`;
    row.dataset.guid = node.guid;

    const arrow = h("span", { class: "bfbridge-arrow" });
    arrow.textContent = hasChildren ? (expanded ? "▾" : "▸") : "　";

    const labelSpan = h("span");
    labelSpan.textContent = "📁 " + (node.title || S.folder);

    row.appendChild(arrow);
    row.appendChild(labelSpan);
    container.appendChild(row);

    const childrenBox = h("div");
    childrenBox.style.display = expanded ? "" : "none";
    container.appendChild(childrenBox);

    // Select folder on row click
    row.addEventListener("click", () => {
      _bmTree.querySelectorAll(".bfbridge-item.selected").forEach(el => el.classList.remove("selected"));
      row.classList.add("selected");
      _selectedBookmarkParentGuid = node.guid;
    });

    // Toggle expand/collapse on arrow click
    if (hasChildren) {
      arrow.addEventListener("click", (e) => {
        e.stopPropagation();
        const isOpen = childrenBox.style.display !== "none";
        childrenBox.style.display = isOpen ? "none" : "";
        arrow.textContent = isOpen ? "▸" : "▾";
      });
      // Render children (collapsed by default)
      for (const fc of folderChildren) {
        buildCollapsibleFolder(childrenBox, fc, depth + 1, false);
      }
    }
  }

  // ============================================================
  // WORKSPACE + FOLDER PICKER (bookmark → tab)
  // ============================================================

  async function showWorkspacePicker() {
    const wsSelect = _wsSelect;
    wsSelect.textContent = "";
    _selectedTargetFolder = null;

    const workspaces = getWorkspaces();
    for (const ws of workspaces) {
      const opt = h("option");
      opt.value = ws.uuid;
      opt.textContent = (ws.icon ? ws.icon + " " : "") + (ws.name || ws.uuid);
      if (ws.uuid === gZenWorkspaces.activeWorkspace) opt.selected = true;
      wsSelect.appendChild(opt);
    }

    await populateWsFolderTree();

    openCentered(_wsPanel);
  }

  async function populateWsFolderTree() {
    const wsSelect = _wsSelect;
    const tree = _wsTree;
    tree.textContent = "";
    _selectedTargetFolder = null;

    const workspaceUuid = wsSelect.value;
    if (!workspaceUuid) return;

    // Root option (always selected by default)
    const rootItem = h("div", { class: "bfbridge-item selected" });
    rootItem.style.paddingLeft = "6px";
    const rootArrow = h("span", { class: "bfbridge-arrow", text: "　" });
    const rootLabel = h("span", { text: S.wsRoot });
    rootItem.appendChild(rootArrow);
    rootItem.appendChild(rootLabel);
    rootItem.addEventListener("click", () => {
      tree.querySelectorAll(".bfbridge-item.selected").forEach(el => el.classList.remove("selected"));
      rootItem.classList.add("selected");
      _selectedTargetFolder = null;
    });
    tree.appendChild(rootItem);

    // Folders in workspace (collapsible)
    const topFolders = getTopFoldersInWorkspace(workspaceUuid);
    for (const folder of topFolders) {
      buildCollapsibleZenFolder(tree, folder, 1, false);
    }
  }

  // Collapsible zen-folder row + hidden children container (recursive)
  function buildCollapsibleZenFolder(container, folder, depth, expanded) {
    const subfolders = getDirectSubfolders(folder);
    const hasChildren = subfolders.length > 0;

    const row = h("div", { class: "bfbridge-item" });
    row.style.paddingLeft = `${depth * 16 + 6}px`;

    const arrow = h("span", { class: "bfbridge-arrow", text: hasChildren ? (expanded ? "▾" : "▸") : "　" });
    const labelSpan = h("span", { text: "📁 " + (folder.label || S.unnamed) });
    row.appendChild(arrow);
    row.appendChild(labelSpan);
    container.appendChild(row);

    const childrenBox = h("div");
    childrenBox.style.display = expanded ? "" : "none";
    container.appendChild(childrenBox);

    row.addEventListener("click", () => {
      _wsTree.querySelectorAll(".bfbridge-item.selected").forEach(el => el.classList.remove("selected"));
      row.classList.add("selected");
      _selectedTargetFolder = folder;
    });

    if (hasChildren) {
      arrow.addEventListener("click", (e) => {
        e.stopPropagation();
        const isOpen = childrenBox.style.display !== "none";
        childrenBox.style.display = isOpen ? "none" : "";
        arrow.textContent = isOpen ? "▸" : "▾";
      });
      for (const sf of subfolders) {
        buildCollapsibleZenFolder(childrenBox, sf, depth + 1, false);
      }
    }
  }

  // ============================================================
  // ACTIONS
  // ============================================================

  async function onSaveFolderToBookmarks() {
    _bmPanel.hidePopup();
    if (!_contextFolder) {
      notify("❌ " + S.errNoFolder, true);
      return;
    }

    try {
      const includeEmpty = getBoolPref(PREF_INCLUDE_EMPTY, false);
      const node = zenFolderToInsertNode(_contextFolder, includeEmpty);
      await PlacesUtils.bookmarks.insertTree({
        guid: _selectedBookmarkParentGuid,
        children: [node]
      });
      notify("✅ " + S.savedOk);
    } catch (e) {
      console.error(LOG, "save failed:", e);
      notify("❌ " + S.errPrefix + e.message, true);
    }
  }

  async function onOpenBookmarkAsFolder() {
    _wsPanel.hidePopup();
    if (!_contextBookmarkGuid) {
      notify("❌ " + S.errNoFolder, true);
      return;
    }

    const workspaceUuid = _wsSelect.value;
    if (!workspaceUuid) {
      notify("❌ " + S.errNoWorkspace, true);
      return;
    }

    try {
      const tree = await PlacesUtils.promiseBookmarksTree(_contextBookmarkGuid);
      if (!tree) throw new Error(S.errRead);
      const result = bookmarkNodeToZenFolder(tree, workspaceUuid, _selectedTargetFolder);
      if (!result) throw new Error(S.errCreate);
      await gZenWorkspaces.changeWorkspaceWithID(workspaceUuid);
      notify("✅ " + S.openedOk);
    } catch (e) {
      console.error(LOG, "open failed:", e);
      notify("❌ " + S.errPrefix + e.message, true);
    }
  }

  // Transient in-window message. Uses the modern notification-box API
  // (appendNotification(type, {label, priority}, buttons)) and degrades to the
  // console when the window has no notification box.
  function notify(msg, isError = false) {
    try {
      const nb = gBrowser.getNotificationBox?.();
      if (nb?.appendNotification) {
        const result = nb.appendNotification(
          "bfbridge-message",
          {
            label: msg,
            priority: isError ? nb.PRIORITY_WARNING_MEDIUM : nb.PRIORITY_INFO_MEDIUM
          },
          []
        );
        Promise.resolve(result)
          .then(el => setTimeout(() => { try { el?.close?.(); } catch (_) {} }, 5000))
          .catch(() => {});
        return;
      }
    } catch (e) {
      console.warn(LOG, "notification box unavailable:", e);
    }
    console.log(LOG, msg);
  }

  // ============================================================
  // CONTEXT MENU HOOKS
  // ============================================================

  // Resolve a zen-folder from whatever node a context menu was opened on
  function folderFromNode(node) {
    if (!node) return null;
    const el = node.closest ? node : node.parentElement;
    const folder = el?.closest?.("zen-folder");
    return folder?.isZenFolder ? folder : null;
  }

  function buildSaveMenuItem() {
    const sep = document.createXULElement("menuseparator");
    sep.id = "bfbridge-save-sep";
    const item = document.createXULElement("menuitem");
    item.id = "bfbridge-save-to-bookmarks";
    item.setAttribute("label", S.menuSave);
    item.addEventListener("command", () => showBookmarkPicker());
    return { sep, item };
  }

  function hookZenFolderContextMenu() {
    // Remember the last folder right-clicked, as a fallback for Zen versions
    // where the popup does not expose a usable trigger node.
    let pendingFolder = null;
    on(document, "contextmenu", e => {
      pendingFolder = folderFromNode(e.target);
    }, true);

    // Preferred path: Zen's own folder context menu.
    const folderMenu = document.getElementById("zenFolderActions");
    if (folderMenu) {
      const { sep, item } = buildSaveMenuItem();
      folderMenu.appendChild(sep);
      folderMenu.appendChild(item);

      on(folderMenu, "popupshowing", e => {
        if (e.target !== folderMenu) return;
        const folder =
          folderFromNode(e.explicitOriginalTarget) ||
          folderFromNode(folderMenu.triggerNode) ||
          pendingFolder;
        _contextFolder = folder;
        sep.hidden = item.hidden = !folder;
      });

      console.log(LOG, "folder menu hooked (#zenFolderActions)");
      return;
    }

    // Fallback: inject into whichever menupopup opens right after the click.
    console.warn(LOG, "#zenFolderActions not found — using generic popup hook");
    on(document, "popupshowing", e => {
      const popup = e.target;
      if (popup.tagName !== "menupopup" || !pendingFolder) return;
      if (popup.querySelector("#bfbridge-save-to-bookmarks")) return;

      const folder = folderFromNode(popup.triggerNode) || pendingFolder;
      if (!folder) return;

      _contextFolder = folder;
      pendingFolder = null;

      const { sep, item } = buildSaveMenuItem();
      popup.appendChild(sep);
      popup.appendChild(item);
    }, true);
  }

  // Find a places result node from a DOM element, trying all known props
  function findPlacesNode(startEl) {
    for (let el = startEl; el; el = el.parentNode) {
      if (el._placesNode) return el._placesNode;
      if (el.node && el.node.bookmarkGuid !== undefined) return el.node;
      if (el._placesView?.selectedNode) return el._placesView.selectedNode;
    }
    return null;
  }

  // Tolerant folder check for places result nodes (folders may carry a
  // "place:" uri, so we can't require the absence of uri)
  function placesNodeIsFolder(n) {
    if (!n || !n.bookmarkGuid) return false;
    try { if (PlacesUtils.nodeIsFolder(n)) return true; } catch (_) {}
    const uri = n.uri || "";
    return !uri || uri.startsWith("place:");
  }

  function hookPlacesContextMenu() {
    // The bookmarks context menu may be built lazily, so never look it up at
    // init time — listen on the document and inject when it is actually shown.
    let lastPlacesEl = null;
    on(document, "contextmenu", e => { lastPlacesEl = e.target; }, true);

    on(document, "popupshowing", e => {
      const popup = e.target;
      if (popup?.id !== "placesContext") return;

      let sep = popup.querySelector("#bfbridge-places-sep");
      let item = popup.querySelector("#bfbridge-open-as-tabs");
      if (!item) {
        sep = document.createXULElement("menuseparator");
        sep.id = "bfbridge-places-sep";
        item = document.createXULElement("menuitem");
        item.id = "bfbridge-open-as-tabs";
        item.setAttribute("label", S.menuOpen);
        item.addEventListener("command", () => showWorkspacePicker());
        popup.appendChild(sep);
        popup.appendChild(item);
      }

      const placesNode = findPlacesNode(popup.triggerNode) || findPlacesNode(lastPlacesEl);
      const isFolder = placesNodeIsFolder(placesNode);

      // Show the entry for folders, and also when detection is inconclusive;
      // hide it only for nodes positively identified as single bookmarks.
      const isPlainBookmark = !!placesNode?.bookmarkGuid && !isFolder;
      _contextBookmarkGuid = isFolder ? placesNode.bookmarkGuid : null;
      sep.hidden = item.hidden = isPlainBookmark;
    }, true);
  }

  // ============================================================
  // INIT
  // ============================================================

  try {
    createUI();
    hookZenFolderContextMenu();
    hookPlacesContextMenu();
    console.log("%c[BFBridge] v1.1.0 loaded ✅", "color: lime; font-weight: bold");
  } catch (e) {
    console.error(LOG, "init failed:", e);
  }

})().catch(e => console.error("[BFBridge] async init failed:", e));
