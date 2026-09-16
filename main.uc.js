// ==UserScript==
// @name         Bookmarks Folders Bridge
// @description  Move folders between the tab sidebar and bookmarks bar
// @version      1.0.0
// @author       pvalles
// @grant        none
// ==/UserScript==

(async function BFBridge() {
  "use strict";

  // Prevent double initialization (script may be injected more than once)
  if (window.__bfBridgeInit) return;
  window.__bfBridgeInit = true;

  // Wait for browser window and Zen to initialize
  await new Promise(r => {
    if (document.readyState === "complete") return r();
    window.addEventListener("load", r, { once: true });
  });
  if (typeof gZenWorkspaces !== "undefined" && gZenWorkspaces.promiseInitialized) {
    await gZenWorkspaces.promiseInitialized;
  }

  // ============================================================
  // STATE
  // ============================================================
  let _contextFolder = null;           // zen-folder being right-clicked
  let _contextBookmarkGuid = null;     // bookmark folder guid being right-clicked
  let _pendingPlacesFolder = false;    // whether last right-click was on a bookmark folder
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
    if (!wsEl) return [];
    return Array.from(wsEl.pinnedTabsContainer.querySelectorAll("zen-folder")).filter(
      f => !f.parentElement.closest("zen-folder")
    );
  }

  // Get direct child items of a zen-folder (tabs + subfolders), using the
  // correct Zen API. Falls back gracefully across Zen versions.
  function getFolderItems(folder) {
    if (Array.isArray(folder.allItems)) return folder.allItems;
    if (folder.allItems && folder.allItems.length !== undefined) return Array.from(folder.allItems);
    return Array.from(folder.children);
  }

  // Build a nested bookmarks insertTree node from a zen-folder (recursive)
  function zenFolderToInsertNode(folder) {
    const children = [];

    for (const child of getFolderItems(folder)) {
      if (child.isZenFolder) {
        children.push(zenFolderToInsertNode(child));
      } else if (gBrowser.isTab?.(child) && !child.hasAttribute("zen-empty-tab")) {
        const url = child.linkedBrowser?.currentURI?.spec;
        const title = child.label || child.linkedBrowser?.contentTitle || url || "";
        if (url && url !== "about:blank" && url !== "about:newtab") {
          children.push({
            type: PlacesUtils.bookmarks.TYPE_BOOKMARK,
            title,
            url
          });
        }
      }
    }

    return {
      type: PlacesUtils.bookmarks.TYPE_FOLDER,
      title: folder.label || "Carpeta sin nombre",
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

    const children = node.children || [];
    const directBookmarks = children.filter(isBmBookmarkNode);
    const subfolderNodes = children.filter(c => isBmFolderNode(c) && !isBmBookmarkNode(c));

    // Create tabs for direct bookmarks (createFolder pins them itself)
    const tabs = [];
    for (const bm of directBookmarks) {
      const url = bm.uri || bm.url;
      if (!url) continue;
      const tab = gBrowser.addTab(url, {
        triggeringPrincipal: Services.scriptSecurityManager.getSystemPrincipal(),
        inBackground: true,
        skipAnimation: true
      });
      tabs.push(tab);
    }

    // Build folder creation options; nest into parent if provided by
    // anchoring the insertion point inside the parent's groupContainer.
    const opts = {
      workspaceId: workspaceUuid,
      label: node.title || "Carpeta importada",
      renameFolder: false
    };
    if (parentZenFolder && parentZenFolder.groupContainer) {
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
    const popupSet = document.getElementById("mainPopupSet");

    // --- Bookmark folder picker panel (tab→bookmark direction) ---
    _bmPanel = document.createXULElement("panel");
    _bmPanel.id = "bfbridge-bm-panel";
    _bmPanel.setAttribute("noautofocus", "true");

    _bmTree = h("div", { class: "bfbridge-tree", id: "bfbridge-bm-tree" });
    const bmCancel = h("button", { text: "Cancelar" });
    const bmOk = h("button", { class: "bfbridge-primary", text: "Guardar" });
    bmCancel.addEventListener("click", () => _bmPanel.hidePopup());
    bmOk.addEventListener("click", onSaveFolderToBookmarks);

    _bmPanel.appendChild(
      h("div", { class: "bfbridge-panel" }, [
        h("div", { class: "bfbridge-header", text: "📌 Guardar carpeta en Marcadores" }),
        h("div", { class: "bfbridge-hint", text: "Selecciona la carpeta destino:" }),
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
    const wsCancel = h("button", { text: "Cancelar" });
    const wsOk = h("button", { class: "bfbridge-primary", text: "Abrir" });
    wsCancel.addEventListener("click", () => _wsPanel.hidePopup());
    wsOk.addEventListener("click", onOpenBookmarkAsFolder);

    const hintFolder = h("div", { class: "bfbridge-hint" });
    hintFolder.innerHTML = "Dentro de carpeta <em>(opcional — raíz si no aplica)</em>:";

    _wsPanel.appendChild(
      h("div", { class: "bfbridge-panel" }, [
        h("div", { class: "bfbridge-header", text: "📂 Abrir marcadores como carpeta de pestañas" }),
        h("div", { class: "bfbridge-hint", text: "Workspace destino:" }),
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
    tree.textContent = "Cargando…";

    openCentered(_bmPanel);

    tree.textContent = "";
    const roots = [
      { guid: PlacesUtils.bookmarks.toolbarGuid, label: "Barra de marcadores" },
      { guid: PlacesUtils.bookmarks.menuGuid, label: "Menú de marcadores" },
      { guid: PlacesUtils.bookmarks.unfiledGuid, label: "Otros marcadores" }
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
    labelSpan.textContent = "📁 " + (node.title || "Carpeta");

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
    const rootLabel = h("span", { text: "📂 Raíz del workspace" });
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
    const labelSpan = h("span", { text: "📁 " + (folder.label || "Sin nombre") });
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
    if (!_contextFolder) return;

    try {
      const node = zenFolderToInsertNode(_contextFolder);
      await PlacesUtils.bookmarks.insertTree({
        guid: _selectedBookmarkParentGuid,
        children: [node]
      });
      notify("✅ Carpeta guardada en marcadores");
    } catch (e) {
      Cu.reportError("[BFBridge] " + e);
      notify("❌ Error: " + e.message);
    }
  }

  async function onOpenBookmarkAsFolder() {
    _wsPanel.hidePopup();
    if (!_contextBookmarkGuid) {
      alert("[BFBridge] No se capturó la carpeta de marcadores (_contextBookmarkGuid vacío)");
      return;
    }

    const workspaceUuid = _wsSelect.value;
    if (!workspaceUuid) {
      alert("[BFBridge] No hay workspace seleccionado");
      return;
    }

    try {
      const tree = await PlacesUtils.promiseBookmarksTree(_contextBookmarkGuid);
      if (!tree) throw new Error("No se pudo leer la carpeta de marcadores");
      const result = bookmarkNodeToZenFolder(tree, workspaceUuid, _selectedTargetFolder);
      if (!result) throw new Error("No se pudo crear la carpeta de pestañas");
      await gZenWorkspaces.changeWorkspaceWithID(workspaceUuid);
      notify("✅ Carpeta abierta como pestañas");
    } catch (e) {
      Cu.reportError("[BFBridge] " + e);
      alert("[BFBridge] Error al abrir: " + e.message);
    }
  }

  function notify(msg) {
    const nb = gBrowser.getNotificationBox?.();
    if (nb) {
      nb.appendNotification(msg, "bfbridge", null, nb.PRIORITY_INFO_MEDIUM);
    }
  }

  // ============================================================
  // CONTEXT MENU HOOKS
  // ============================================================

  function hookZenFolderContextMenu() {
    let pendingFolderContext = false;

    // Step 1: track when right-click happens on a zen-folder
    document.addEventListener("contextmenu", e => {
      const folder = e.target.closest("zen-folder");
      if (folder) {
        _contextFolder = folder;
        pendingFolderContext = true;
      } else {
        pendingFolderContext = false;
      }
    }, true);

    // Step 2: inject into the next menupopup that opens after a folder right-click
    document.addEventListener("popupshowing", e => {
      const popup = e.target;
      if (popup.tagName !== "menupopup") return;
      if (!pendingFolderContext) return;
      if (popup.querySelector("#bfbridge-save-to-bookmarks-native")) return;

      // Verify trigger node is inside a zen-folder (extra safety check)
      const trigger = popup.triggerNode;
      if (trigger) {
        const f = trigger.closest("zen-folder");
        if (f) _contextFolder = f;
        else {
          pendingFolderContext = false;
          return;
        }
      }

      pendingFolderContext = false;

      const sep = document.createXULElement("menuseparator");
      sep.id = "bfbridge-native-sep";
      const item = document.createXULElement("menuitem");
      item.id = "bfbridge-save-to-bookmarks-native";
      item.setAttribute("label", "📌 Guardar en Marcadores…");
      item.addEventListener("command", () => showBookmarkPicker());
      popup.appendChild(sep);
      popup.appendChild(item);
    }, true);
  }

  function hookPlacesContextMenu() {
    const placesCtx = document.getElementById("placesContext");
    if (!placesCtx) return;

    // Inject our menu item once
    const sep = document.createXULElement("menuseparator");
    sep.id = "bfbridge-places-sep";
    const item = document.createXULElement("menuitem");
    item.id = "bfbridge-open-as-tabs";
    item.setAttribute("label", "📂 Abrir como carpeta de pestañas…");
    item.addEventListener("command", () => showWorkspacePicker());
    placesCtx.appendChild(sep);
    placesCtx.appendChild(item);

    // Track the last right-clicked element (capture phase)
    let _lastPlacesEl = null;
    document.addEventListener("contextmenu", (e) => {
      _lastPlacesEl = e.target;
    }, true);

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

    placesCtx.addEventListener("popupshowing", () => {
      const placesNode = findPlacesNode(_lastPlacesEl) || findPlacesNode(placesCtx.triggerNode);

      if (placesNodeIsFolder(placesNode)) {
        _contextBookmarkGuid = placesNode.bookmarkGuid;
        item.setAttribute("label", "📂 Abrir como carpeta de pestañas…");
        sep.hidden = false;
        item.hidden = false;
      } else if (placesNode && placesNode.bookmarkGuid) {
        // Has a guid but not clearly a folder — still allow (graceful if leaf)
        _contextBookmarkGuid = placesNode.bookmarkGuid;
        item.setAttribute("label", "📂 Abrir como carpeta de pestañas…");
        sep.hidden = false;
        item.hidden = false;
      } else {
        // Nothing found — keep visible but flag so clicking explains the issue
        _contextBookmarkGuid = null;
        item.setAttribute("label", "📂 Abrir como carpeta de pestañas…");
        sep.hidden = false;
        item.hidden = false;
      }
    });
  }

  // ============================================================
  // INIT
  // ============================================================

  try {
    createUI();
    hookZenFolderContextMenu();
    hookPlacesContextMenu();
    console.log("%c[BFBridge] Mod cargado ✅", "color: lime; font-weight: bold");
  } catch (e) {
    alert("[BFBridge] ERROR en init: " + e.message + "\n\n" + e.stack);
  }

})().catch(e => { try { alert("[BFBridge] ERROR async: " + e.message); } catch(_){} });
