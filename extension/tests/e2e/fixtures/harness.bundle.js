"use strict";
var __harness = (() => {
  // src/core/adapters/genericWebAdapter.ts
  var BOILERPLATE_SELECTORS = [
    "nav",
    "header",
    "footer",
    "script",
    "style",
    "noscript",
    "iframe",
    "svg",
    "form",
    "aside",
    '[role="navigation"]',
    '[role="banner"]',
    '[role="contentinfo"]',
    '[aria-hidden="true"]',
    ".ad",
    ".ads",
    ".advertisement",
    ".cookie-banner"
  ];
  var BLOCK_SELECTOR = "h1, h2, h3, h4, h5, h6, p, li, pre, code";
  var BOILERPLATE_SELECTOR = BOILERPLATE_SELECTORS.join(",");
  function isRendered(el, memo) {
    const anyEl = el;
    if (typeof anyEl.checkVisibility === "function") {
      return anyEl.checkVisibility({ visibilityProperty: true, opacityProperty: true });
    }
    const view = el.ownerDocument?.defaultView;
    const chain = [];
    let node = el;
    let verdict = true;
    while (node) {
      const cached = memo.get(node);
      if (cached !== void 0) {
        verdict = cached;
        break;
      }
      chain.push(node);
      if (node.hidden) {
        verdict = false;
        break;
      }
      if (view && typeof view.getComputedStyle === "function") {
        const style = view.getComputedStyle(node);
        if (style.display === "none" || style.visibility === "hidden" || style.opacity === "0") {
          verdict = false;
          break;
        }
      }
      node = node.parentElement;
    }
    for (const n of chain) memo.set(n, verdict);
    return verdict;
  }
  function extractBlocks(root) {
    const blocks = [];
    const captured = /* @__PURE__ */ new Set();
    const visibility = /* @__PURE__ */ new Map();
    root.querySelectorAll(BLOCK_SELECTOR).forEach((el) => {
      const blockAncestor = el.parentElement?.closest(BLOCK_SELECTOR);
      if (blockAncestor && captured.has(blockAncestor)) return;
      if (el.closest(BOILERPLATE_SELECTOR)) return;
      if (!isRendered(el, visibility)) return;
      const text = (el.textContent || "").replace(/\s+/g, " ").trim();
      if (!text) return;
      const tag = el.tagName.toLowerCase();
      if (/^h[1-6]$/.test(tag)) {
        blocks.push({ type: "heading", level: Number(tag[1]), text });
      } else if (tag === "li") {
        blocks.push({ type: "list-item", text });
      } else if (tag === "pre" || tag === "code") {
        blocks.push({ type: "code", text });
      } else {
        if (text.split(" ").length < 3) return;
        blocks.push({ type: "paragraph", text });
      }
      captured.add(el);
    });
    return blocks;
  }
  function fallbackText(body) {
    const visibility = /* @__PURE__ */ new Map();
    const doc = body.ownerDocument;
    const walker = doc.createTreeWalker(
      body,
      4
      /* NodeFilter.SHOW_TEXT */
    );
    const parts = [];
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const parent = n.parentElement;
      if (!parent || parent.closest(BOILERPLATE_SELECTOR) || !isRendered(parent, visibility)) continue;
      parts.push(n.textContent ?? "");
    }
    return parts.join(" ").replace(/\s+/g, " ").trim();
  }
  function extractLinks(root, baseUrl) {
    const links = /* @__PURE__ */ new Set();
    root.querySelectorAll("a[href]").forEach((a) => {
      if (a.closest(BOILERPLATE_SELECTOR)) return;
      const href = a.getAttribute("href");
      if (!href || href.startsWith("#")) return;
      try {
        const resolved = new URL(href, baseUrl);
        if (resolved.protocol !== "http:" && resolved.protocol !== "https:") return;
        links.add(resolved.toString());
      } catch {
      }
    });
    return Array.from(links);
  }
  var genericWebAdapter = {
    sourceType: "generic-web",
    detect(_doc) {
      return true;
    },
    getCapabilityLevel() {
      return 1;
    },
    getConfidence() {
      return "high";
    },
    getMetadata(doc) {
      const title = doc.querySelector('meta[property="og:title"]')?.getAttribute("content") || doc.title || "Untitled page";
      const author = doc.querySelector('meta[name="author"]')?.getAttribute("content") || void 0;
      const publishedRaw = doc.querySelector('meta[property="article:published_time"]')?.getAttribute("content") || void 0;
      const publishedAt = publishedRaw ? Date.parse(publishedRaw) : void 0;
      return {
        url: doc.location?.href || "",
        title,
        author,
        timestamps: { capturedAt: Date.now(), publishedAt: Number.isNaN(publishedAt) ? void 0 : publishedAt }
      };
    },
    extractCurrentPage(doc) {
      if (!doc.body) return null;
      const blocks = extractBlocks(doc.body);
      const metadata = this.getMetadata(doc);
      if (blocks.length === 0) {
        const text2 = fallbackText(doc.body);
        if (!text2) return null;
        return {
          id: "",
          sourceId: "",
          title: metadata.title,
          text: text2,
          blocks: [{ type: "paragraph", text: text2 }],
          metadata,
          links: extractLinks(doc.body, metadata.url)
        };
      }
      const text = blocks.map((b) => b.text).join("\n\n");
      return {
        id: "",
        sourceId: "",
        title: metadata.title,
        text,
        blocks,
        metadata,
        links: extractLinks(doc.body, metadata.url)
      };
    },
    extractSelection(selection) {
      if (!selection || selection.isCollapsed) return null;
      const text = selection.toString().trim();
      if (!text) return null;
      const url = typeof window !== "undefined" ? window.location.href : "";
      const title = typeof document !== "undefined" ? document.title : "Selection";
      return {
        id: "",
        sourceId: "",
        title: `Selection from ${title}`,
        text,
        blocks: [{ type: "paragraph", text }],
        metadata: { url, title, timestamps: { capturedAt: Date.now() } }
      };
    }
  };

  // src/core/processing/clean.ts
  var ENTITY_MAP = {
    "&amp;": "&",
    "&lt;": "<",
    "&gt;": ">",
    "&quot;": '"',
    "&#39;": "'",
    "&apos;": "'",
    "&nbsp;": " ",
    "&mdash;": "\u2014",
    "&ndash;": "\u2013",
    "&hellip;": "\u2026"
  };
  function decodeEntities(text) {
    let out = text.replace(/&(amp|lt|gt|quot|#39|apos|nbsp|mdash|ndash|hellip);/g, (m) => ENTITY_MAP[m] ?? m);
    out = out.replace(/&#(?:([0-9]{1,7})|[xX]([0-9a-fA-F]{1,6}));/g, (m, dec, hex) => {
      const code = dec !== void 0 ? Number(dec) : parseInt(hex, 16);
      const valid = code > 0 && code <= 1114111 && !(code >= 55296 && code <= 57343);
      return valid ? String.fromCodePoint(code) : m;
    });
    return out;
  }
  function normalizeWhitespace(text) {
    return text.replace(/\r\n?/g, "\n").replace(/[ \t]+/g, " ").replace(/ *\n */g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  }
  var BOILERPLATE_LINE_PATTERNS = [
    /^skip to (main )?content$/i,
    /^cookie(s)? (policy|settings|notice)/i,
    /^accept (all )?cookies$/i,
    /^subscribe to our newsletter$/i,
    /^all rights reserved\.?$/i,
    /^©\s?\d{4}/,
    /^sign (in|up)$/i,
    /^advertisement$/i
  ];
  function stripBoilerplateLines(text) {
    const lines = text.split("\n");
    const kept = lines.filter((line) => {
      const trimmed = line.trim();
      if (!trimmed) return true;
      return !BOILERPLATE_LINE_PATTERNS.some((re) => re.test(trimmed));
    });
    return kept.join("\n");
  }
  function cleanText(rawText) {
    const decoded = decodeEntities(rawText);
    const stripped = stripBoilerplateLines(decoded);
    return normalizeWhitespace(stripped);
  }

  // src/core/processing/chunk.ts
  var TARGET_MIN_TOKENS = 300;
  var TARGET_MAX_TOKENS = 500;
  var OVERLAP_TOKENS = 60;
  var WORDS_TO_TOKENS_RATIO = 1.3;
  var MAX_UNIT_CHARS = 3e3;
  var MAX_OVERLAP_CHARS = 600;
  function estimateTokens(text) {
    const words = text.split(/\s+/).filter(Boolean).length;
    return Math.ceil(words * WORDS_TO_TOKENS_RATIO);
  }
  function splitSentences(text) {
    const trimmed = text.trim();
    if (!trimmed) return [];
    const parts = trimmed.match(/[^.!?]+[.!?]+(?=\s+|$)|[^.!?]+$/g);
    if (!parts) return [trimmed];
    return parts.map((s) => s.trim()).filter(Boolean);
  }
  function splitOversizedText(text) {
    if (estimateTokens(text) <= TARGET_MAX_TOKENS && text.length <= MAX_UNIT_CHARS) return [text];
    const words = text.split(/\s+/).filter(Boolean).flatMap((w) => {
      if (w.length <= MAX_UNIT_CHARS) return [w];
      const pieces = [];
      for (let i = 0; i < w.length; i += MAX_UNIT_CHARS) pieces.push(w.slice(i, i + MAX_UNIT_CHARS));
      return pieces;
    });
    const out = [];
    let buf = [];
    let bufChars = 0;
    for (const word of words) {
      const nextChars = bufChars + (buf.length ? 1 : 0) + word.length;
      if (buf.length && (nextChars > MAX_UNIT_CHARS || Math.ceil((buf.length + 1) * WORDS_TO_TOKENS_RATIO) > TARGET_MAX_TOKENS)) {
        out.push(buf.join(" "));
        buf = [];
        bufChars = 0;
      }
      bufChars += (buf.length ? 1 : 0) + word.length;
      buf.push(word);
    }
    if (buf.length) out.push(buf.join(" "));
    return out;
  }
  function blocksToUnits(blocks) {
    const units = [];
    const headingStack = [];
    for (const block of blocks) {
      if (block.type === "heading") {
        const level = Math.min(6, Math.max(1, block.level ?? 1));
        headingStack.splice(level - 1);
        headingStack[level - 1] = block.text.slice(0, 300);
        units.push({ text: block.text, headingPath: [...headingStack] });
        continue;
      }
      const cleaned = cleanText(block.text);
      if (!cleaned) continue;
      if (estimateTokens(cleaned) <= TARGET_MAX_TOKENS && cleaned.length <= MAX_UNIT_CHARS) {
        units.push({ text: cleaned, headingPath: [...headingStack] });
      } else {
        const sentences = splitSentences(cleaned);
        let buf = "";
        const pushUnit = (text) => {
          for (const piece of splitOversizedText(text)) units.push({ text: piece, headingPath: [...headingStack] });
        };
        for (const sentence of sentences) {
          const candidate = buf ? `${buf} ${sentence}` : sentence;
          if ((estimateTokens(candidate) > TARGET_MAX_TOKENS || candidate.length > MAX_UNIT_CHARS) && buf) {
            pushUnit(buf);
            buf = sentence;
          } else {
            buf = candidate;
          }
        }
        if (buf) pushUnit(buf);
      }
    }
    return units;
  }
  function takeOverlapSuffix(text, maxTokens) {
    const sentences = splitSentences(text);
    let buf = "";
    for (let i = sentences.length - 1; i >= 0; i -= 1) {
      const candidate = buf ? `${sentences[i]} ${buf}` : sentences[i];
      if (estimateTokens(candidate) > maxTokens || candidate.length > MAX_OVERLAP_CHARS) break;
      buf = candidate;
    }
    return buf;
  }
  function chunkDocument(doc) {
    const blocks = doc.blocks && doc.blocks.length > 0 ? doc.blocks : [{ type: "paragraph", text: doc.text }];
    const units = blocksToUnits(blocks);
    const chunks = [];
    let bufferParts = [];
    let bufferTokens = 0;
    let bufferChars = 0;
    let lastHeadingPath = [];
    let position = 0;
    const flush = (overlapPrefix) => {
      if (bufferParts.length === 0) return;
      const text = bufferParts.join("\n\n");
      const finalText = overlapPrefix ? `${overlapPrefix}

${text}` : text;
      chunks.push({
        id: "",
        documentId: doc.id,
        sourceId: doc.sourceId,
        text: finalText,
        position: position++,
        sourceAnchor: {
          url: doc.metadata.url,
          headingPath: lastHeadingPath.length ? lastHeadingPath : void 0
        }
      });
    };
    let pendingOverlap = "";
    for (const unit of units) {
      const unitTokens = estimateTokens(unit.text);
      const wouldBeTokens = bufferTokens + unitTokens;
      const wouldBeChars = bufferChars + unit.text.length;
      if (bufferParts.length > 0 && (wouldBeTokens > TARGET_MAX_TOKENS || wouldBeChars > MAX_UNIT_CHARS)) {
        flush(pendingOverlap || void 0);
        const joined = bufferParts.join("\n\n");
        pendingOverlap = takeOverlapSuffix(joined, OVERLAP_TOKENS);
        bufferParts = [];
        bufferTokens = estimateTokens(pendingOverlap);
        bufferChars = pendingOverlap.length;
      }
      bufferParts.push(unit.text);
      bufferTokens += unitTokens;
      bufferChars += unit.text.length;
      lastHeadingPath = unit.headingPath;
      if (bufferTokens >= TARGET_MIN_TOKENS && bufferTokens <= TARGET_MAX_TOKENS) {
        flush(pendingOverlap || void 0);
        const joined = bufferParts.join("\n\n");
        pendingOverlap = takeOverlapSuffix(joined, OVERLAP_TOKENS);
        bufferParts = [];
        bufferTokens = 0;
        bufferChars = 0;
      }
    }
    if (bufferParts.length > 0) {
      flush(pendingOverlap || void 0);
    }
    return chunks;
  }

  // tests/e2e/harness-entry.ts
  window.__extractAndChunk = () => {
    const extracted = genericWebAdapter.extractCurrentPage(document);
    if (!extracted) return null;
    const cleaned = { ...extracted, text: cleanText(extracted.text) };
    const chunks = chunkDocument({ ...cleaned, id: "doc_test", sourceId: "src_test" });
    return {
      title: cleaned.title,
      blockCount: cleaned.blocks?.length ?? 0,
      chunkCount: chunks.length,
      firstChunkText: chunks[0]?.text ?? null
    };
  };
})();
