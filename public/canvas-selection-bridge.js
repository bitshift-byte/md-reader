
;(function() {
  "use strict"

  // 防止重复注入
  if (window.__CANVAS_BRIDGE_INJECTED__) return
  window.__CANVAS_BRIDGE_INJECTED__ = true

  // ============================================================
  // 状态
  // ============================================================

  /** 当前选中元素 */
  let selectedElement = null
  /** 同点多次点击时的命中穿透状态 */
  let clickThroughState = null
  /** 当前悬停元素（用于 scroll 时更新 overlay 坐标） */
  let hoveredElement = null
  /** Nudge 实时预览专用 style 节点，避免同名暗色变量污染浅色主题 */
  let tweakOverrideStyle = null
  /** bridge 是否启用（仅 Point and Edit 模式启用，不启用时不拦截页面交互） */
  let bridgeEnabled = false
  /** 当前正在 iframe 内直接编辑文案的元素 */
  let inlineEditingElement = null
  /** 直接编辑前的元素状态，用于提交或取消 */
  let inlineEditState = null
  /** 是否在 iframe 内渲染选中/悬停可视框（对齐 Onlook：关闭，统一由父层画布渲染） */
  const ENABLE_IFRAME_OVERLAY = false
  /** 选中高亮 overlay */
  let selectOverlay = null
  /** hover 高亮 overlay */
  let hoverOverlay = null
  /** 元素 ID 计数器 */
  let idCounter = 0
  /** 弱引用映射：elementId → Element */
  const elementMap = new WeakMap()
  /** ID → Element 查找表 */
  const idToElement = new Map()
  /** 子 iframe 向父 Canvas 透传的运行时消息 */
  const CHILD_TO_PARENT_MESSAGE_TYPES = new Set([
    "element-selected",
    "element-text-edited",
    "element-hovered",
    "dom-snapshot-response",
    "canvas-wheel",
  ])
  /** 父 Canvas 需要下发到同源子 iframe 的编辑命令 */
  const PARENT_TO_CHILD_MESSAGE_TYPES = new Set([
    "select-element",
    "clear-selection",
    "hover-element",
    "dom-style-patch",
    "dom-text-patch",
    "tweak-root-vars",
    "tweak-root-vars-reset",
    "set-tweak-theme",
    "dom-snapshot-request",
    "set-bridge-mode",
  ])

  // ============================================================
  // Overlay 管理
  // ============================================================

  function createOverlay(color, bgColor) {
    const el = document.createElement("div")
    el.style.cssText = [
      "position: fixed",
      "pointer-events: none",
      "z-index: 2147483647",
      "border: 2px solid " + color,
      "background: " + bgColor,
      "transition: all 0.1s ease",
      "display: none",
    ].join(";")
    document.body.appendChild(el)
    return el
  }

  function positionOverlay(overlay, rect) {
    if (!ENABLE_IFRAME_OVERLAY) return
    if (!rect) {
      overlay.style.display = "none"
      return
    }
    overlay.style.display = "block"
    overlay.style.left = rect.left + "px"
    overlay.style.top = rect.top + "px"
    overlay.style.width = rect.width + "px"
    overlay.style.height = rect.height + "px"
  }

  function ensureOverlays() {
    if (!ENABLE_IFRAME_OVERLAY) return
    if (!selectOverlay) {
      selectOverlay = createOverlay("#2680EB", "rgba(38,128,235,0.06)")
    }
    if (!hoverOverlay) {
      hoverOverlay = createOverlay("#2680EB", "rgba(38,128,235,0.03)")
      hoverOverlay.style.borderStyle = "dashed"
      hoverOverlay.style.borderWidth = "1px"
    }
  }

  // ============================================================
  // 元素 ID 管理
  // ============================================================

  function getElementId(el) {
    let id = el.getAttribute("data-canvas-eid")
    if (id) {
      idToElement.set(id, el)
      return id
    }
    id = "ce-" + (++idCounter)
    el.setAttribute("data-canvas-eid", id)
    idToElement.set(id, el)
    return id
  }

  function getTweakOverrideStyle() {
    if (tweakOverrideStyle && document.head && document.head.contains(tweakOverrideStyle)) return tweakOverrideStyle
    tweakOverrideStyle = document.querySelector("style[data-qoder-tweak-overrides]")
    if (!tweakOverrideStyle) {
      tweakOverrideStyle = document.createElement("style")
      tweakOverrideStyle.setAttribute("data-qoder-tweak-overrides", "true")
      document.head.appendChild(tweakOverrideStyle)
    }
    return tweakOverrideStyle
  }

  function renderTweakOverrideStyle(entries) {
    var blocks = {}
    var hasSeedTokenOverride = false
    for (var i = 0; i < entries.length; i++) {
      var entry = entries[i]
      if (!entry || !entry.variable) continue
      if (/^--seed-(bg|fg|primary|accent|surface|muted|border|radius)$/.test(entry.variable)) {
        hasSeedTokenOverride = true
      }
      var selector = entry.selector || ":root"
      if (!blocks[selector]) blocks[selector] = []
      blocks[selector].push("  " + entry.variable + ": " + entry.value + ";")
    }
    var css = ""
    var selectors = Object.keys(blocks)
    for (var s = 0; s < selectors.length; s++) {
      css += selectors[s] + " {\n" + blocks[selectors[s]].join("\n") + "\n}\n"
    }
    if (hasSeedTokenOverride) {
      css += [
        "html, body, #root {",
        "  background: var(--seed-surface, var(--seed-bg)) !important;",
        "  color: var(--seed-fg) !important;",
        "}",
        ".ant-layout, .ant-layout-content {",
        "  background: var(--seed-surface, var(--seed-bg)) !important;",
        "  color: var(--seed-fg) !important;",
        "}",
        ".ant-layout-header, .ant-layout-sider, .ant-card, .ant-table, .ant-table-container, .ant-table-content, .ant-table-thead > tr > th, .ant-table-tbody > tr > td, .ant-menu, .ant-input, .ant-select-selector, .ant-picker, .ant-tag {",
        "  background: var(--seed-bg) !important;",
        "  color: var(--seed-fg) !important;",
        "  border-color: var(--seed-border) !important;",
        "}",
        ".ant-card, .ant-input, .ant-select-selector, .ant-picker, .ant-btn, .ant-tag, .ant-menu-item {",
        "  border-radius: var(--seed-radius, 4px) !important;",
        "}",
        ".ant-statistic-title, .ant-breadcrumb, .ant-breadcrumb a, .ant-breadcrumb-link, .ant-table-column-title, .ant-empty-description {",
        "  color: var(--seed-muted, var(--seed-fg)) !important;",
        "}",
        ".ant-statistic-content, .ant-table-cell, .ant-menu-title-content, .ant-input input, .ant-picker input {",
        "  color: var(--seed-fg) !important;",
        "}",
        ".ant-menu-item-selected, .ant-table-tbody > tr:hover > td {",
        "  background: color-mix(in srgb, var(--seed-primary) 16%, var(--seed-bg)) !important;",
        "  color: var(--seed-primary) !important;",
        "}",
        ".ant-btn-primary, .ant-avatar, [style*=\"#0F62FE\"], [style*=\"rgb(15, 98, 254)\"] {",
        "  background-color: var(--seed-primary) !important;",
        "  border-color: var(--seed-primary) !important;",
        "}",
        ".anticon, .ant-btn-text, .ant-statistic-content-prefix {",
        "  color: var(--seed-primary) !important;",
        "}",
      ].join("\n") + "\n"
    }
    getTweakOverrideStyle().textContent = css
  }

  function getSameOriginChildFrames() {
    var result = []
    var frames = document.querySelectorAll("iframe")
    for (var i = 0; i < frames.length; i++) {
      var frame = frames[i]
      try {
        if (frame.contentWindow && frame.contentDocument) {
          result.push(frame)
        }
      } catch (_err) {
        // 跨域 iframe 不参与 Canvas 设计态桥接。
      }
    }
    return result
  }

  function relayMessageToChildFrames(message) {
    if (!message || !PARENT_TO_CHILD_MESSAGE_TYPES.has(message.type)) return false
    var frames = getSameOriginChildFrames()
    for (var i = 0; i < frames.length; i++) {
      frames[i].contentWindow.postMessage(message, "*")
    }
    return frames.length > 0
  }

  function isChildFrameSource(source) {
    if (!source) return false
    var frames = getSameOriginChildFrames()
    for (var i = 0; i < frames.length; i++) {
      if (frames[i].contentWindow === source) return true
    }
    return false
  }

  // ============================================================
  // 语义化标签映射
  // ============================================================

  const SEMANTIC_TAG_NAMES = {
    NAV: "Nav",
    HEADER: "Header",
    MAIN: "Main",
    SECTION: "Section",
    ARTICLE: "Article",
    ASIDE: "Aside",
    FOOTER: "Footer",
    BUTTON: "Button",
    A: "Link",
    IMG: "Image",
    VIDEO: "Video",
    AUDIO: "Audio",
    FORM: "Form",
    INPUT: "Input",
    TEXTAREA: "Textarea",
    SELECT: "Select",
    TABLE: "Table",
    UL: "List",
    OL: "OrderedList",
    LI: "ListItem",
    H1: "Heading1",
    H2: "Heading2",
    H3: "Heading3",
    H4: "Heading4",
    H5: "Heading5",
    H6: "Heading6",
  }

  /** utility class 正则模式 */
  var UTILITY_PATTERNS = [
    /^(flex|grid|block|inline|hidden|relative|absolute|fixed|sticky)$/,
    /^(m|p|mx|my|mt|mb|ml|mr|px|py|pt|pb|pl|pr)-/,
    /^(w|h|min-w|min-h|max-w|max-h)-/,
    /^(text|font|leading|tracking|bg|border|rounded|shadow|opacity)-/,
    /^(gap|space|justify|items|self|content|place)-/,
    /^(overflow|z|top|right|bottom|left|inset)-/,
  ]

  function isUtilityClass(cls) {
    for (var i = 0; i < UTILITY_PATTERNS.length; i++) {
      if (UTILITY_PATTERNS[i].test(cls)) return true
    }
    return false
  }

  /** 获取第一个有意义的 class 名 */
  function getMeaningfulClass(el) {
    var classes = el.className
    if (typeof classes !== "string" || !classes.trim()) return null
    var list = classes.trim().split(/\s+/)
    for (var i = 0; i < list.length; i++) {
      if (!isUtilityClass(list[i])) return list[i]
    }
    return null
  }

  /** 获取元素的语义化标签名 */
  function getSemanticLabel(el) {
    // 优先级1: data-component
    var dc = el.getAttribute("data-component")
    if (dc) return dc
    // 优先级2: id
    if (el.id) return "#" + el.id
    // 优先级3: 有意义的 class
    var mc = getMeaningfulClass(el)
    if (mc) return mc
    // 优先级4: 语义化标签
    var sn = SEMANTIC_TAG_NAMES[el.tagName]
    if (sn) return sn
    // 优先级5: 兜底标签名
    return el.tagName.toLowerCase()
  }

  /** 获取元素自身直接承载的文本，不包含子元素深层文本 */
  function getDirectTextContent(el) {
    var text = ""
    for (var i = 0; i < el.childNodes.length; i++) {
      var child = el.childNodes[i]
      if (child.nodeType === 3) text += child.textContent || ""
    }
    return text.replace(/\s+/g, " ").trim().slice(0, 120)
  }

  /** 获取完整直接文本，编辑场景不截断 */
  function getFullDirectTextContent(el) {
    var text = ""
    for (var i = 0; i < el.childNodes.length; i++) {
      var child = el.childNodes[i]
      if (child.nodeType === 3) text += child.textContent || ""
    }
    return text.replace(/\u00a0/g, " ")
  }

  /** 只更新直接文本节点，避免破坏可能存在的子元素 */
  function setDirectTextContent(el, text) {
    if (!el) return
    if (!el.children || el.children.length === 0) {
      el.textContent = text
      return
    }
    for (var i = 0; i < el.childNodes.length; i++) {
      var child = el.childNodes[i]
      if (child.nodeType === 3) {
        child.textContent = text
        return
      }
    }
    el.insertBefore(document.createTextNode(text), el.firstChild)
  }

  /** 判断元素是否适合像 Figma 一样直接编辑文案 */
  function canInlineEditText(el) {
    if (!el || el.nodeType !== 1) return false
    var tag = el.tagName
    if (!tag) return false
    if (/^(INPUT|TEXTAREA|SELECT|OPTION|IMG|SVG|CANVAS|VIDEO|AUDIO|IFRAME|SCRIPT|STYLE|LINK)$/.test(tag)) return false
    if (el.isContentEditable) return false
    if (el.children && el.children.length > 0) return false
    return !!getFullDirectTextContent(el).trim()
  }

  function selectInlineText(el) {
    var selection = window.getSelection && window.getSelection()
    if (!selection) return
    var range = document.createRange()
    range.selectNodeContents(el)
    selection.removeAllRanges()
    selection.addRange(range)
  }

  /** 将实际点击节点规整到更符合用户预期的可选元素 */
  function resolveSelectableTarget(rawTarget) {
    var el = rawTarget && rawTarget.nodeType === 1 ? rawTarget : (rawTarget && rawTarget.parentElement)
    if (!el) return null
    if (el === document.body || el === document.documentElement) return el
    if (el === selectOverlay || el === hoverOverlay) return null

    var tag = el.tagName
    if (/^(PATH|CIRCLE|RECT|LINE|POLYLINE|POLYGON|G|USE|DEFS|CLIPPATH|LINEARGRADIENT|RADIALGRADIENT|STOP)$/i.test(tag)) {
      var svgOwner = el.closest("svg,[data-qoder-id],[data-component]")
      if (svgOwner) el = svgOwner
    }

    if (!hasSelectionMarker(el)) {
      var marked = el.closest("[data-qoder-id],[data-qoder-source],[data-component]")
      if (marked) el = marked
    }

    if (isDecorativeSelectionLayer(el)) {
      var parentMarked = el.parentElement && el.parentElement.closest("[data-qoder-id],[data-qoder-source],[data-component]")
      if (parentMarked && parentMarked !== el) el = parentMarked
    }

    return el
  }

  function isSelectableCandidate(el) {
    if (!el || el.nodeType !== 1) return false
    if (el === document.body || el === document.documentElement) return false
    if (el === selectOverlay || el === hoverOverlay) return false
    if (/^(SCRIPT|STYLE|LINK|META|TITLE|HEAD)$/i.test(el.tagName)) return false
    if (/^(PATH|CIRCLE|RECT|LINE|POLYLINE|POLYGON|G|USE|DEFS|CLIPPATH|LINEARGRADIENT|RADIALGRADIENT|STOP)$/i.test(el.tagName)) return false
    if (isDecorativeSelectionLayer(el)) return false
    return true
  }

  function normalizeRawClickTarget(rawTarget) {
    var el = rawTarget && rawTarget.nodeType === 1 ? rawTarget : (rawTarget && rawTarget.parentElement)
    if (!el) return null
    if (/^(PATH|CIRCLE|RECT|LINE|POLYLINE|POLYGON|G|USE|DEFS|CLIPPATH|LINEARGRADIENT|RADIALGRADIENT|STOP)$/i.test(el.tagName)) {
      return el.closest("svg,[data-qoder-id],[data-component]") || el
    }
    return el
  }

  /** 生成从当前命中层到更深 DOM 子层的穿透候选链 */
  function buildClickThroughCandidates(rawTarget, initialTarget) {
    if (!initialTarget || initialTarget === document.body || initialTarget === document.documentElement) return []
    var rawEl = normalizeRawClickTarget(rawTarget)
    if (!rawEl) return initialTarget ? [initialTarget] : []

    var path = []
    var cursor = rawEl
    while (cursor && cursor !== document.body && cursor !== document.documentElement) {
      if (isSelectableCandidate(cursor)) path.push(cursor)
      cursor = cursor.parentElement
    }
    path.reverse()

    var initialIndex = path.indexOf(initialTarget)
    var candidates = initialIndex >= 0 ? path.slice(initialIndex) : [initialTarget]
    var seen = []
    var unique = []
    for (var i = 0; i < candidates.length; i++) {
      var candidate = candidates[i]
      if (!candidate || seen.indexOf(candidate) >= 0) continue
      seen.push(candidate)
      unique.push(candidate)
    }
    return unique
  }

  function getClickThroughSignature(candidates) {
    var ids = []
    for (var i = 0; i < candidates.length; i++) {
      ids.push(getElementId(candidates[i]))
    }
    return ids.join(">")
  }

  function isSameClickThroughSpot(e, signature) {
    if (!clickThroughState) return false
    if (clickThroughState.signature !== signature) return false
    return Math.abs(clickThroughState.x - e.clientX) <= 8 && Math.abs(clickThroughState.y - e.clientY) <= 8
  }

  function resolveClickSelectableTarget(e) {
    var initialTarget = resolveSelectableTarget(e.target)
    if (!initialTarget) return null
    var candidates = buildClickThroughCandidates(e.target, initialTarget)
    if (candidates.length <= 1) {
      clickThroughState = null
      return initialTarget
    }

    var signature = getClickThroughSignature(candidates)
    var target = initialTarget
    if (selectedElement && isSameClickThroughSpot(e, signature)) {
      var selectedIndex = candidates.indexOf(selectedElement)
      if (selectedIndex >= 0 && selectedIndex < candidates.length - 1) {
        target = candidates[selectedIndex + 1]
      } else if (selectedIndex === candidates.length - 1) {
        target = selectedElement
      }
    }

    clickThroughState = {
      x: e.clientX,
      y: e.clientY,
      signature: signature,
    }
    return target
  }

  function hasSelectionMarker(el) {
    return !!(
      el.getAttribute("data-qoder-id") ||
      el.getAttribute("data-qoder-source") ||
      el.getAttribute("data-component")
    )
  }

  /** 透明覆盖层、渐变蒙层等通常不是用户想编辑的结构节点 */
  function isDecorativeSelectionLayer(el) {
    if (!el || !el.parentElement) return false
    var className = typeof el.className === "string" ? el.className : (el.getAttribute("class") || "")
    var tag = el.tagName
    if (/^(IMG|VIDEO|CANVAS|SVG|BUTTON|A|INPUT|TEXTAREA|SELECT)$/i.test(tag)) return false
    if (getFullDirectTextContent(el).trim()) return false
    var absoluteLayer = /(absolute|fixed)/.test(className)
    var fillsParent = /inset-0/.test(className) || /(top|right|bottom|left)-0/.test(className)
    var looksDecorative = /(pointer-events-none|opacity-0|bg-gradient|blur|backdrop-blur|noise-bg)/.test(className)
    return absoluteLayer && fillsParent && looksDecorative
  }

  /** 进入 iframe 内直接文本编辑 */
  function beginInlineTextEdit(el) {
    if (!canInlineEditText(el)) return false
    finishInlineTextEdit(true)
    selectedElement = el
    inlineEditingElement = el
    inlineEditState = {
      originalText: getFullDirectTextContent(el),
      contentEditable: el.getAttribute("contenteditable"),
      spellcheck: el.getAttribute("spellcheck"),
      outline: el.style.outline,
      outlineOffset: el.style.outlineOffset,
      cursor: el.style.cursor,
      userSelect: el.style.userSelect,
      webkitUserSelect: el.style.webkitUserSelect,
    }
    el.setAttribute("contenteditable", "plaintext-only")
    el.setAttribute("spellcheck", "false")
    el.style.outline = "2px solid #2680EB"
    el.style.outlineOffset = "2px"
    el.style.cursor = "text"
    el.style.userSelect = "text"
    el.style.webkitUserSelect = "text"
    el.focus({ preventScroll: true })
    selectInlineText(el)
    window.parent.postMessage({ type: "element-selected", ...collectElementInfo(el) }, "*")
    return true
  }

  /** 结束 iframe 内直接文本编辑 */
  function finishInlineTextEdit(commit) {
    if (!inlineEditingElement || !inlineEditState) return
    var el = inlineEditingElement
    var state = inlineEditState
    var nextText = getFullDirectTextContent(el)
    if (!commit) {
      setDirectTextContent(el, state.originalText)
      nextText = state.originalText
    }

    if (state.contentEditable === null) el.removeAttribute("contenteditable")
    else el.setAttribute("contenteditable", state.contentEditable)
    if (state.spellcheck === null) el.removeAttribute("spellcheck")
    else el.setAttribute("spellcheck", state.spellcheck)
    el.style.outline = state.outline
    el.style.outlineOffset = state.outlineOffset
    el.style.cursor = state.cursor
    el.style.userSelect = state.userSelect
    el.style.webkitUserSelect = state.webkitUserSelect

    inlineEditingElement = null
    inlineEditState = null
    window.getSelection && window.getSelection()?.removeAllRanges()

    var info = collectElementInfo(el)
    if (commit && nextText !== state.originalText) {
      window.parent.postMessage({
        type: "element-text-edited",
        text: nextText,
        originalText: state.originalText,
        ...info,
      }, "*")
    } else {
      window.parent.postMessage({ type: "element-selected", ...info }, "*")
    }
  }

  /** 清理当前选择态，并让父层同步收起选区。 */
  function clearBridgeSelection(notifyParent) {
    finishInlineTextEdit(true)
    selectedElement = null
    hoveredElement = null
    clickThroughState = null
    if (selectOverlay) selectOverlay.style.display = "none"
    if (hoverOverlay) hoverOverlay.style.display = "none"
    if (notifyParent) {
      window.parent.postMessage({ type: "element-selected", elementId: null }, "*")
      window.parent.postMessage({ type: "element-hovered", elementId: null, boundingRect: null }, "*")
    }
  }

  /** 解析生成器写入的稳定源码引用，失败时兼容旧字符串路径 */
  function parseQoderSourceRef(el) {
    var raw = el.getAttribute("data-qoder-source")
    if (!raw) return null
    try {
      var parsed = JSON.parse(raw)
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed
      }
    } catch (_err) {}
    return { filePath: raw }
  }

  // ============================================================
  // 元素信息收集
  // ============================================================

  function collectElementInfo(el) {
    var cs = window.getComputedStyle(el)
    var rect = el.getBoundingClientRect()
    var eid = getElementId(el)

    // 收集常用 computed styles
    var styles = {}
    var props = [
      "width", "height", "marginTop", "marginRight", "marginBottom", "marginLeft",
      "paddingTop", "paddingRight", "paddingBottom", "paddingLeft",
      "borderTopWidth", "borderRightWidth", "borderBottomWidth", "borderLeftWidth",
      "borderTopColor", "borderRightColor", "borderBottomColor", "borderLeftColor",
      "borderTopStyle", "borderRightStyle", "borderBottomStyle", "borderLeftStyle",
      "borderTopLeftRadius", "borderTopRightRadius", "borderBottomLeftRadius", "borderBottomRightRadius",
      "backgroundColor", "color", "fontSize", "fontWeight", "fontFamily", "lineHeight",
      "letterSpacing", "textAlign", "textDecoration", "opacity",
      "display", "position", "flexDirection", "justifyContent", "alignItems",
      "gap", "overflow", "boxShadow",
    ]
    for (var i = 0; i < props.length; i++) {
      var kebab = props[i].replace(/[A-Z]/g, function(m) { return "-" + m.toLowerCase() })
      styles[kebab] = cs.getPropertyValue(kebab)
    }

    return {
      elementId: eid,
      tagName: el.tagName.toLowerCase(),
      id: el.id || null,
      className: el.getAttribute("class") || null,
      dataComponent: el.getAttribute("data-component") || null,
      qoderId: el.getAttribute("data-qoder-id") || null,
      qoderSource: el.getAttribute("data-qoder-source") || null,
      sourceRef: parseQoderSourceRef(el),
      semanticLabel: getSemanticLabel(el),
      textContent: getFullDirectTextContent(el),
      computedStyles: styles,
      boundingRect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
      outerHTML: el.outerHTML.slice(0, 500),
    }
  }

  // ============================================================
  // DOM 树序列化（用于图层面板）
  // ============================================================

  function serializeDomTree(root, maxDepth) {
    maxDepth = maxDepth || 20
    function walk(el, depth) {
      if (depth > maxDepth) return null
      if (el.nodeType !== 1) return null
      // 跳过注入的 overlay 和 script
      if (el === selectOverlay || el === hoverOverlay) return null
      if (el.tagName === "SCRIPT" || el.tagName === "STYLE" || el.tagName === "LINK") return null
      var rect = el.getBoundingClientRect()

      var node = {
        elementId: getElementId(el),
        tagName: el.tagName.toLowerCase(),
        id: el.id || null,
        className: (typeof el.className === "string") ? el.className : null,
        dataComponent: el.getAttribute("data-component") || null,
        qoderId: el.getAttribute("data-qoder-id") || null,
        qoderSource: el.getAttribute("data-qoder-source") || null,
        sourceRef: parseQoderSourceRef(el),
        semanticLabel: getSemanticLabel(el),
        textContent: getDirectTextContent(el),
        boundingRect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
        children: [],
      }

      var children = el.children
      for (var i = 0; i < children.length; i++) {
        var child = walk(children[i], depth + 1)
        if (child) node.children.push(child)
      }

      return node
    }

    var target = root || document.body
    return walk(target, 0)
  }

  // ============================================================
  // 事件处理
  // ============================================================

  /** 点击选中元素 */
  document.addEventListener("click", function(e) {
    // bridge 禁用时不拦截（preview 模式）
    if (!bridgeEnabled) return

    // 忽略 overlay 上的点击
    if (e.target === selectOverlay || e.target === hoverOverlay) return
    if (inlineEditingElement && (e.target === inlineEditingElement || inlineEditingElement.contains(e.target))) return

    e.preventDefault()
    e.stopPropagation()

    var target = resolveClickSelectableTarget(e)
    if (!target) return
    // 跳过 body 和 html
    if (target === document.body || target === document.documentElement) {
      clearBridgeSelection(true)
      return
    }

    selectedElement = target

    var info = collectElementInfo(target)
    window.parent.postMessage({ type: "element-selected", ...info }, "*")
  }, true)

  /** 双击直接编辑简单文本元素 */
  document.addEventListener("dblclick", function(e) {
    if (!bridgeEnabled) return
    var target = resolveSelectableTarget(e.target)
    if (!target) return
    if (!canInlineEditText(target)) return
    e.preventDefault()
    e.stopPropagation()
    beginInlineTextEdit(target)
  }, true)

  document.addEventListener("keydown", function(e) {
    if (inlineEditingElement) {
      if (e.key === "Escape") {
        e.preventDefault()
        e.stopPropagation()
        finishInlineTextEdit(false)
        return
      }
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault()
        e.stopPropagation()
        finishInlineTextEdit(true)
      }
      return
    }

    if (!bridgeEnabled) return
    var active = document.activeElement
    if (active && /^(INPUT|TEXTAREA|SELECT)$/.test(active.tagName)) return

    if (e.key === "Escape") {
      e.preventDefault()
      e.stopPropagation()
      clearBridgeSelection(true)
      return
    }

    if (e.key === "Enter" && !e.shiftKey && selectedElement && canInlineEditText(selectedElement)) {
      e.preventDefault()
      e.stopPropagation()
      beginInlineTextEdit(selectedElement)
    }
  }, true)

  document.addEventListener("focusout", function(e) {
    if (!inlineEditingElement) return
    var nextTarget = e.relatedTarget
    if (nextTarget && inlineEditingElement.contains(nextTarget)) return
    finishInlineTextEdit(true)
  }, true)

  /** Hover 高亮 */
  document.addEventListener("mousemove", function(e) {
    if (!bridgeEnabled) return
    var target = resolveSelectableTarget(e.target)
    if (!target) return
    if (target === selectOverlay || target === hoverOverlay) return
    // 鼠标在 body/html/滚动条区域时，不清空 hoveredElement（保留引用以便 scroll 更新位置）
    if (target === document.body || target === document.documentElement) return
    if (target === selectedElement) {
      hoveredElement = null
      window.parent.postMessage({ type: "element-hovered", elementId: null, boundingRect: null }, "*")
      return
    }
    // 鼠标移到当前 hoveredElement 的祖先时（如移向滚动条途经父容器），不覆盖引用
    if (hoveredElement && target !== hoveredElement && target.contains && target.contains(hoveredElement)) return

    hoveredElement = target
    var rect = target.getBoundingClientRect()

    var eid = getElementId(target)
    window.parent.postMessage({
      type: "element-hovered",
      elementId: eid,
      tagName: target.tagName.toLowerCase(),
      semanticLabel: getSemanticLabel(target),
      boundingRect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
    }, "*")
  }, false)

  /** 鼠标离开时隐藏 hover overlay */
  document.addEventListener("mouseleave", function() {
    hoveredElement = null
    if (hoverOverlay) hoverOverlay.style.display = "none"
  }, false)

  // ============================================================
  // 来自父窗口的消息处理
  // ============================================================

  window.addEventListener("message", function(e) {
    var data = e.data
    if (!data || !data.type) return

    if (isChildFrameSource(e.source) && CHILD_TO_PARENT_MESSAGE_TYPES.has(data.type)) {
      window.parent.postMessage(data, "*")
      return
    }

    var relayedToChildFrame = e.source === window.parent && relayMessageToChildFrames(data)
    if (relayedToChildFrame && (
      data.type === "select-element" ||
      data.type === "clear-selection" ||
      data.type === "hover-element" ||
      data.type === "dom-style-patch" ||
      data.type === "dom-text-patch" ||
      data.type === "dom-snapshot-request"
    )) {
      return
    }

    switch (data.type) {
      case "select-element": {
        // 通过选择器或 elementId 选中元素
        var el = null
        if (data.elementId) {
          el = idToElement.get(data.elementId) || null
        }
        if (!el && data.selector) {
          el = document.querySelector(data.selector)
        }
        if (el) {
          clickThroughState = null
          selectedElement = el
          var info = collectElementInfo(el)
          window.parent.postMessage({ type: "element-selected", ...info }, "*")
        }
        break
      }

      case "clear-selection": {
        clearBridgeSelection(true)
        break
      }

      case "hover-element": {
        // 来自图层面板的 hover 请求
        var hoverEl = data.elementId ? idToElement.get(data.elementId) || null : null
        if (hoverEl) {
          ensureOverlays()
          var hRect = hoverEl.getBoundingClientRect()
          positionOverlay(hoverOverlay, hRect)
          window.parent.postMessage({
            type: "element-hovered",
            elementId: data.elementId,
            tagName: hoverEl.tagName.toLowerCase(),
            semanticLabel: getSemanticLabel(hoverEl),
            boundingRect: { x: hRect.x, y: hRect.y, width: hRect.width, height: hRect.height },
          }, "*")
        } else {
          if (hoverOverlay) hoverOverlay.style.display = "none"
          window.parent.postMessage({ type: "element-hovered", elementId: null, boundingRect: null }, "*")
        }
        break
      }

      case "dom-style-patch": {
        // 临时修改选中元素的 style
        var patchEl = data.elementId ? idToElement.get(data.elementId) : selectedElement
        if (patchEl && data.styles) {
          var keys = Object.keys(data.styles)
          for (var i = 0; i < keys.length; i++) {
            var styleValue = data.styles[keys[i]]
            if (styleValue === "") {
              patchEl.style.removeProperty(keys[i])
            } else {
              patchEl.style.setProperty(keys[i], styleValue)
            }
          }
          // 更新 overlay 位置
          if (ENABLE_IFRAME_OVERLAY && patchEl === selectedElement) {
            positionOverlay(selectOverlay, patchEl.getBoundingClientRect())
          }
          // 回传更新后的信息
          window.parent.postMessage({
            type: "element-selected",
            ...collectElementInfo(patchEl),
          }, "*")
        }
        break
      }

      case "dom-text-patch": {
        var textEl = data.elementId ? idToElement.get(data.elementId) : selectedElement
        if (textEl && typeof data.text === "string") {
          setDirectTextContent(textEl, data.text)
          if (textEl === selectedElement) {
            window.parent.postMessage({
              type: "element-selected",
              ...collectElementInfo(textEl),
            }, "*")
          }
        }
        break
      }

      case "tweak-root-vars": {
        // 覆盖 CSS 变量（实时预览 Nudge）
        var entries = data.entries
        if (entries && entries.length) {
          renderTweakOverrideStyle(entries)
          break
        }

        // 兼容旧格式：覆盖 :root 上的 CSS 变量。
        var overrides = data.overrides
        if (overrides) {
          var tvars = Object.keys(overrides)
          for (var ti = 0; ti < tvars.length; ti++) {
            document.documentElement.style.setProperty(tvars[ti], overrides[tvars[ti]])
          }
        }
        break
      }

      case "tweak-root-vars-reset": {
        var resetEntries = data.entries
        if (resetEntries && resetEntries.length) {
          var styleEl = document.querySelector("style[data-qoder-tweak-overrides]")
          if (styleEl) styleEl.textContent = ""
          break
        }

        // 移除 :root 上的覆盖变量（恢复原始值）
        var resetVars = data.variables
        if (resetVars && resetVars.length) {
          for (var ri = 0; ri < resetVars.length; ri++) {
            document.documentElement.style.removeProperty(resetVars[ri])
          }
        }
        break
      }

      case "set-tweak-theme": {
        var theme = data.theme === "dark" ? "dark" : "light"
        document.documentElement.setAttribute("data-theme", theme)
        document.documentElement.classList.toggle("dark", theme === "dark")
        if (document.body) {
          document.body.setAttribute("data-theme", theme)
          document.body.classList.toggle("dark", theme === "dark")
        }
        break
      }

      case "dom-snapshot-request": {
        // 序列化 DOM 树返回
        var root = null
        if (data.selector) {
          root = document.querySelector(data.selector)
        }
        var tree = serializeDomTree(root)

        // 读取 :root 的 CSS custom properties
        var rootStyles = {}
        var rootCS = window.getComputedStyle(document.documentElement)
        // 遍历所有 CSS 规则获取自定义属性
        try {
          var sheets = document.styleSheets
          for (var s = 0; s < sheets.length; s++) {
            try {
              var rules = sheets[s].cssRules
              for (var r = 0; r < rules.length; r++) {
                var rule = rules[r]
                if (rule.selectorText === ":root") {
                  for (var p = 0; p < rule.style.length; p++) {
                    var prop = rule.style[p]
                    if (prop.startsWith("--")) {
                      rootStyles[prop] = rootCS.getPropertyValue(prop).trim()
                    }
                  }
                }
              }
            } catch (x) {
              // 跨域样式表，跳过
            }
          }
        } catch (x) {
          // 忽略
        }

        window.parent.postMessage({
          type: "dom-snapshot-response",
          tree: tree,
          rootStyles: rootStyles,
        }, "*")
        break
      }

      case "set-bridge-mode": {
        // 切换 bridge 启用/禁用（只有 Point and Edit 模式启用）
        bridgeEnabled = !!data.enabled
        if (!bridgeEnabled) {
          // 禁用时清除选中和 hover 状态
          clearBridgeSelection(true)
        }
        break
      }
    }
  }, false)

  // ============================================================
  // Wheel 事件转发：将 iframe 内的滚轮事件冒泡给父窗口处理缩放/平移
  // ============================================================

  document.addEventListener("wheel", function(e) {
    // bridge 禁用时不拦截滚轮（preview 模式允许正常滚动）
    if (!bridgeEnabled) return

    e.preventDefault()
    window.parent.postMessage({
      type: "canvas-wheel",
      deltaX: e.deltaX,
      deltaY: e.deltaY,
      clientX: e.clientX,
      clientY: e.clientY,
      ctrlKey: e.ctrlKey,
      metaKey: e.metaKey,
    }, "*")
  }, { passive: false, capture: true })

  // ============================================================
  // Scroll 事件：内容滚动时更新选区位置，使高亮框跟随元素
  // ============================================================

  document.addEventListener("scroll", function() {
    if (selectedElement) {
      var info = collectElementInfo(selectedElement)
      window.parent.postMessage({ type: "element-selected", ...info }, "*")
    }
    if (hoveredElement && hoveredElement !== selectedElement) {
      var rect = hoveredElement.getBoundingClientRect()
      var eid = getElementId(hoveredElement)
      window.parent.postMessage({
        type: "element-hovered",
        elementId: eid,
        tagName: hoveredElement.tagName.toLowerCase(),
        semanticLabel: getSemanticLabel(hoveredElement),
        boundingRect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
      }, "*")
    }
  }, true)

  // ============================================================
  // 窗口 resize 时更新 overlay 位置
  // ============================================================

  window.addEventListener("resize", function() {
    if (ENABLE_IFRAME_OVERLAY && selectedElement && selectOverlay) {
      positionOverlay(selectOverlay, selectedElement.getBoundingClientRect())
    }
    // 同时通知父层更新位置
    if (selectedElement) {
      var info = collectElementInfo(selectedElement)
      window.parent.postMessage({ type: "element-selected", ...info }, "*")
    }
  }, false)

  console.log("[CanvasBridge] Selection bridge injected")
})()
