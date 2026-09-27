"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { askAction, clearAction } from "./actions";
import { EMPTY_CHAT, type ChatMessage, type ChatState } from "./types";

const SUGGESTIONS = [
  "¿Cuál es mi saldo?",
  "¿En qué gasté este mes?",
  "Muéstrame mis últimos movimientos",
  "¿Tengo avisos pendientes?",
];

const TOOL_LABELS: Record<string, string> = {
  consultar_cuentas: "tus cuentas",
  consultar_movimientos: "tus movimientos",
  resumen_del_mes: "el resumen del mes",
  consultar_avisos: "tus avisos",
};

async function reducer(prev: ChatState, form: FormData): Promise<ChatState> {
  return form.get("intent") === "clear"
    ? clearAction(prev)
    : askAction(prev, form);
}

export function AssistantChat() {
  const [state, action, pending] = useActionState<ChatState, FormData>(
    reducer,
    EMPTY_CHAT,
  );
  const [draft, setDraft] = useState("");
  const [sent, setSent] = useState<string | null>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!pending) {
      setSent(null);
      inputRef.current?.focus();
    }
  }, [pending]);

  function submit(text: string) {
    setDraft(text);
    requestAnimationFrame(() => formRef.current?.requestSubmit());
  }

  const shown: ChatMessage[] = sent
    ? [...state.messages, { role: "user", text: sent }]
    : state.messages;

  return (
    <section className="panel chat" aria-labelledby="conversacion">
      <h2 id="conversacion" className="sr-only">
        Conversación
      </h2>
      {shown.length === 0 ? (
        <div
          className="suggestions"
          aria-label="Preguntas sugeridas"
          role="group"
        >
          {SUGGESTIONS.map((s) => (
            <button
              key={s}
              type="button"
              className="btn"
              onClick={() => submit(s)}
              disabled={pending}
            >
              {s}
            </button>
          ))}
        </div>
      ) : null}

      <div
        role="log"
        aria-live="polite"
        aria-relevant="additions"
        aria-label="Mensajes"
      >
        <ol className="chat-log">
          {shown.map((m, i) => (
            <li key={i} className={`bubble ${m.role}`}>
              <span className="sr-only">
                {m.role === "user" ? "Tú:" : "Asistente:"}{" "}
              </span>
              {m.text}
              {m.notices?.map((n) => (
                <span key={n} className="meta" role="note">
                  {n}
                </span>
              ))}
              {m.tools?.length ? (
                <span className="meta">
                  Consulté {m.tools.map((t) => TOOL_LABELS[t] ?? t).join(", ")}.
                </span>
              ) : null}
            </li>
          ))}
          {pending && sent ? (
            <li className="bubble assistant" aria-busy="true">
              Pensando…
            </li>
          ) : null}
        </ol>
      </div>

      {state.error ? (
        <p className="alert" role="alert">
          {state.error}
        </p>
      ) : null}

      <form
        ref={formRef}
        className="chat-form"
        action={(form) => {
          const text = String(form.get("message") ?? "").trim();
          if (form.get("intent") !== "clear") {
            if (!text) return;
            setSent(text);
            setDraft("");
          }
          action(form);
        }}
      >
        <input
          type="hidden"
          name="conversationId"
          value={state.conversationId ?? ""}
        />
        <label htmlFor="pregunta">Tu pregunta</label>
        <textarea
          id="pregunta"
          ref={inputRef}
          name="message"
          className="input"
          maxLength={1000}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              formRef.current?.requestSubmit();
            }
          }}
          aria-describedby="pregunta-ayuda"
          disabled={pending}
        />
        <p id="pregunta-ayuda" className="hint">
          Enter para enviar, Shift+Enter para otra línea. Las conversaciones se
          borran solas en 24 horas.
        </p>
        <div className="chat-row">
          <button
            type="submit"
            className="btn btn-primary"
            disabled={pending || draft.trim().length === 0}
          >
            {pending ? "Enviando…" : "Enviar"}
          </button>
          {state.conversationId ? (
            <button
              type="submit"
              name="intent"
              value="clear"
              className="btn btn-quiet"
              disabled={pending}
            >
              Borrar conversación
            </button>
          ) : null}
        </div>
      </form>
    </section>
  );
}
