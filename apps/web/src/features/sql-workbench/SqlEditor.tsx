import Editor, { loader, type OnMount } from "@monaco-editor/react";
import * as monaco from "monaco-editor/editor/editor.api";
import "monaco-editor/languages/definitions/sql/register";
import EditorWorker from "monaco-editor/editor/editor.worker?worker";
import { useEffect, useRef } from "react";

import { useTheme } from "@/hooks/useTheme";
import type { SchemaTable } from "@/types/api";

// Bundle Monaco locally: no CDN requests, so the editor works fully offline.
self.MonacoEnvironment = { getWorker: () => new EditorWorker() };
loader.config({ monaco });

monaco.editor.defineTheme("aether-dark", {
  base: "vs-dark", inherit: true, rules: [{ token: "keyword", foreground: "4fd6c6" }],
  colors: { "editor.background": "#12161d", "editor.lineHighlightBackground": "#171c24", "editorLineNumber.foreground": "#4a5262" },
});
monaco.editor.defineTheme("aether-light", {
  base: "vs", inherit: true, rules: [{ token: "keyword", foreground: "0b7f75" }],
  colors: { "editor.background": "#ffffff", "editor.lineHighlightBackground": "#f8f9fb" },
});

const KEYWORDS = ["SELECT", "FROM", "WHERE", "GROUP BY", "ORDER BY", "HAVING", "LIMIT", "JOIN", "LEFT JOIN", "INNER JOIN", "WITH",
  "AS", "ON", "USING", "UNION ALL", "CASE", "WHEN", "THEN", "ELSE", "END", "DISTINCT", "OVER", "PARTITION BY", "QUALIFY"];
const FUNCTIONS = ["count", "sum", "avg", "min", "max", "median", "quantile_cont", "stddev_samp", "date_trunc", "strftime",
  "round", "coalesce", "row_number", "rank", "dense_rank", "lag", "lead", "corr", "approx_count_distinct", "string_agg"];

interface Props {
  value: string;
  onChange: (v: string) => void;
  onRun: () => void;
  schema: SchemaTable[];
}

export function SqlEditor({ value, onChange, onRun, schema }: Props) {
  const { resolved } = useTheme();
  const runRef = useRef(onRun);
  runRef.current = onRun;
  const schemaRef = useRef(schema);
  schemaRef.current = schema;

  useEffect(() => {
    const provider = monaco.languages.registerCompletionItemProvider("sql", {
      provideCompletionItems(model, position) {
        const word = model.getWordUntilPosition(position);
        const range = { startLineNumber: position.lineNumber, endLineNumber: position.lineNumber, startColumn: word.startColumn, endColumn: word.endColumn };
        const K = monaco.languages.CompletionItemKind;
        const suggestions: monaco.languages.CompletionItem[] = [
          ...schemaRef.current.map((t) => ({ label: t.table_name, kind: K.Struct, insertText: t.table_name, detail: `${t.name} · ${t.row_count} rows`, range })),
          ...schemaRef.current.flatMap((t) => t.columns.map((c) => ({
            label: c.name, kind: K.Field, detail: `${t.table_name} · ${c.logical_type}`, range,
            insertText: /^[a-z_][a-z0-9_]*$/.test(c.name) ? c.name : `"${c.name.replace(/"/g, '""')}"`,
          }))),
          ...KEYWORDS.map((k) => ({ label: k, kind: K.Keyword, insertText: k, range })),
          ...FUNCTIONS.map((f) => ({ label: f, kind: K.Function, insertText: `${f}($0)`, insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet, range })),
        ];
        return { suggestions };
      },
    });
    return () => provider.dispose();
  }, []);

  const onMount: OnMount = (editor) => {
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, () => runRef.current());
    editor.focus();
  };

  return (
    <Editor
      language="sql"
      value={value}
      onChange={(v) => onChange(v ?? "")}
      onMount={onMount}
      theme={resolved === "dark" ? "aether-dark" : "aether-light"}
      options={{
        minimap: { enabled: false }, fontSize: 13, fontFamily: "JetBrains Mono, Cascadia Code, Consolas, monospace",
        scrollBeyondLastLine: false, automaticLayout: true, tabSize: 2, wordWrap: "on", padding: { top: 10 },
        renderLineHighlight: "line", ariaLabel: "SQL editor. Press Control+Enter to run.",
      }}
    />
  );
}
