"use client";

import * as React from "react";
import CodeMirror, { type ReactCodeMirrorRef } from "@uiw/react-codemirror";
import { oneDark } from "@codemirror/theme-one-dark";
import { Compartment, type Extension } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import { useTheme } from "next-themes";

import { cpp } from "@codemirror/lang-cpp";
import { css } from "@codemirror/lang-css";
import { go } from "@codemirror/lang-go";
import { html } from "@codemirror/lang-html";
import { java } from "@codemirror/lang-java";
import { javascript } from "@codemirror/lang-javascript";
import { json } from "@codemirror/lang-json";
import { markdown } from "@codemirror/lang-markdown";
import { php } from "@codemirror/lang-php";
import { python } from "@codemirror/lang-python";
import { rust } from "@codemirror/lang-rust";
import { sql } from "@codemirror/lang-sql";
import { yaml } from "@codemirror/lang-yaml";
import { StreamLanguage } from "@codemirror/language";
import { csharp } from "@codemirror/legacy-modes/mode/clike";
import { shell } from "@codemirror/legacy-modes/mode/shell";

/**
 * CodeMirror 6 wrapper.
 *
 * Language support is resolved from the same identifiers the API stores, so an
 * item's `language` value maps deterministically onto a grammmar. Unknown
 * languages fall back to plain text rather than throwing.
 */

function extensionForLanguage(language: string | null): Extension[] {
  switch (language) {
    case "javascript":
      return [javascript()];
    case "typescript":
      return [javascript({ typescript: true })];
    case "jsx":
      return [javascript({ jsx: true })];
    case "tsx":
      return [javascript({ jsx: true, typescript: true })];
    case "python":
      return [python()];
    case "java":
      return [java()];
    case "c":
    case "cpp":
      return [cpp()];
    case "csharp":
      return [StreamLanguage.define(csharp)];
    case "go":
      return [go()];
    case "rust":
      return [rust()];
    case "php":
      return [php()];
    case "html":
      return [html()];
    case "css":
      return [css()];
    case "json":
      return [json()];
    case "sql":
      return [sql()];
    case "bash":
      return [StreamLanguage.define(shell)];
    case "yaml":
      return [yaml()];
    case "markdown":
      return [markdown()];
    case "plaintext":
    default:
      return [];
  }
}

export interface CodeEditorProps {
  value: string;
  language: string | null;
  readOnly?: boolean;
  /** Ctrl/Cmd+S handler; the editor also keeps tab indentation. */
  onSave?: () => void;
  onChange: (value: string) => void;
  ariaLabel?: string;
}

export function CodeEditor({
  value,
  language,
  readOnly = false,
  onSave,
  onChange,
  ariaLabel,
}: CodeEditorProps) {
  const { resolvedTheme } = useTheme();
  // @uiw/react-codemirror exposes the EditorView on its ref object, not on the
  // ref itself (the previous shape caused a runtime crash on mount).
  const editorRef = React.useRef<ReactCodeMirrorRef>(null);
  const saveCompartment = React.useMemo(() => new Compartment(), []);

  // A static extension list; the save keymap is reconfigured in an effect so the
  // handler can change without rebuilding the editor (and without reading refs
  // during render).
  const extensions = React.useMemo<Extension[]>(
    () => [...extensionForLanguage(language), EditorView.lineWrapping, saveCompartment.of([])],
    [language, saveCompartment],
  );

  React.useEffect(() => {
    const view = editorRef.current?.view;
    if (!view) return;
    const saveKeymap = onSave
      ? keymap.of([
          {
            key: "Mod-s",
            preventDefault: true,
            run: () => {
              onSave();
              return true;
            },
          },
        ])
      : [];
    view.dispatch({ effects: saveCompartment.reconfigure(saveKeymap) });
  }, [onSave, saveCompartment]);

  return (
    <CodeMirror
      ref={editorRef}
      value={value}
      height="100%"
      minHeight="320px"
      theme={resolvedTheme === "light" ? "light" : oneDark}
      extensions={extensions}
      editable={!readOnly}
      readOnly={readOnly}
      indentWithTab
      placeholder={readOnly ? "" : "Start typing…"}
      onChange={onChange}
      basicSetup={{
        lineNumbers: true,
        highlightActiveLine: !readOnly,
        foldGutter: false,
        autocompletion: false,
        searchKeymap: true,
      }}
      aria-label={ariaLabel}
      className="h-full text-sm [&_.cm-editor]:h-full [&_.cm-scroller]:font-mono"
    />
  );
}
