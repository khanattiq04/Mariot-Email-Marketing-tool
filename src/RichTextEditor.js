import { useRef, useEffect } from "react";

const FONT_SIZES = [12, 14, 16, 18, 20, 24, 28, 32, 36];
const FONT_WEIGHTS = [
  { label: "Normal", value: "400" },
  { label: "Medium", value: "500" },
  { label: "Semi Bold", value: "600" },
  { label: "Bold", value: "700" },
  { label: "Extra Bold", value: "800" },
];

/**
 * A minimal rich-text editor built on contentEditable.
 * Select some text, then click Bold/Italic or pick a size/weight
 * from the dropdowns to style just that selection.
 *
 * value:    HTML string (controlled from parent, but only applied on mount)
 * onChange: called with the latest HTML string on every edit
 */
export default function RichTextEditor({ value, onChange, placeholder, rows = 6 }) {
  const editorRef = useRef(null);
  const savedRange = useRef(null);
  const didInit = useRef(false);

  // Only set innerHTML once, on mount. After that the DOM is the source of
  // truth (this is what stops the cursor from jumping to the start on every
  // keystroke, which happens if you keep re-applying value via React render).
  useEffect(() => {
    if (editorRef.current && !didInit.current) {
      editorRef.current.innerHTML = value || "";
      didInit.current = true;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const emitChange = () => {
    if (editorRef.current) onChange(editorRef.current.innerHTML);
  };

  const saveSelection = () => {
    const sel = window.getSelection();
    if (sel && sel.rangeCount > 0 && editorRef.current?.contains(sel.anchorNode)) {
      savedRange.current = sel.getRangeAt(0).cloneRange();
    }
  };

  const restoreSelection = () => {
    const sel = window.getSelection();
    if (savedRange.current) {
      sel.removeAllRanges();
      sel.addRange(savedRange.current);
    }
  };

  const wrapSelectionWithStyle = (styleProp, styleValue) => {
    editorRef.current?.focus();
    restoreSelection();
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return;
    const range = sel.getRangeAt(0);
    if (!editorRef.current.contains(range.commonAncestorContainer)) return;

    const span = document.createElement("span");
    span.style[styleProp] = styleValue;

    try {
      range.surroundContents(span);
    } catch {
      // Selection spans multiple elements — extract & re-wrap instead.
      const contents = range.extractContents();
      span.appendChild(contents);
      range.insertNode(span);
    }

    // Keep the same text selected so multiple styles can be stacked
    // (e.g. bold, then also bump the font size) without reselecting.
    sel.removeAllRanges();
    const newRange = document.createRange();
    newRange.selectNodeContents(span);
    sel.addRange(newRange);
    savedRange.current = newRange.cloneRange();

    emitChange();
  };

  const toggleBold = () => wrapSelectionWithStyle("fontWeight", "700");
  const toggleItalic = () => wrapSelectionWithStyle("fontStyle", "italic");

  const applyFontSize = (e) => {
    const size = e.target.value;
    if (size) wrapSelectionWithStyle("fontSize", `${size}px`);
    e.target.value = "";
  };

  const applyFontWeight = (e) => {
    const weight = e.target.value;
    if (weight) wrapSelectionWithStyle("fontWeight", weight);
    e.target.value = "";
  };

  return (
    <div className="rte-wrapper">
      <style>{`
        .rte-wrapper { border: 1px solid #ddd; border-radius: 8px; overflow: hidden; }
        .rte-toolbar {
          display: flex; align-items: center; gap: 6px;
          padding: 6px 8px; background: #f7f7f7; border-bottom: 1px solid #e2e2e2;
          flex-wrap: wrap;
        }
        .rte-toolbar button {
          min-width: 30px; height: 30px; border: 1px solid #d5d5d5; background: #fff;
          border-radius: 6px; cursor: pointer; font-size: 14px;
        }
        .rte-toolbar button:hover { background: #eee; }
        .rte-toolbar select {
          height: 30px; border: 1px solid #d5d5d5; border-radius: 6px;
          background: #fff; font-size: 13px; padding: 0 4px;
        }
        .rte-editor {
          padding: 10px 12px; outline: none; font-size: 14px; line-height: 1.5;
        }
        .rte-editor:empty:before {
          content: attr(data-placeholder); color: #999;
        }
      `}</style>

      <div className="rte-toolbar">
        <button type="button" title="Bold" onMouseDown={(e) => e.preventDefault()} onClick={toggleBold}>
          <b>B</b>
        </button>
        <button type="button" title="Italic" onMouseDown={(e) => e.preventDefault()} onClick={toggleItalic}>
          <i>I</i>
        </button>
        <select
          defaultValue=""
          title="Font size"
          onMouseDown={saveSelection}
          onChange={applyFontSize}
        >
          <option value="" disabled>Size</option>
          {FONT_SIZES.map((s) => (
            <option key={s} value={s}>{s}px</option>
          ))}
        </select>
        <select
          defaultValue=""
          title="Font weight"
          onMouseDown={saveSelection}
          onChange={applyFontWeight}
        >
          <option value="" disabled>Weight</option>
          {FONT_WEIGHTS.map((w) => (
            <option key={w.value} value={w.value}>{w.label}</option>
          ))}
        </select>
      </div>

      <div
        ref={editorRef}
        className="rte-editor"
        contentEditable
        suppressContentEditableWarning
        data-placeholder={placeholder}
        style={{ minHeight: `${rows * 22}px` }}
        onInput={emitChange}
        onMouseUp={saveSelection}
        onKeyUp={saveSelection}
      />
    </div>
  );
}