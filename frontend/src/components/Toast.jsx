import { createContext, useCallback, useContext, useMemo, useRef, useState } from "react";
import { Icon } from "./ui.jsx";

const ToastContext = createContext(() => {});

// Call const toast = useToast(); toast("Saved") or toast("Failed", { tone: "error" })
// An action adds a button: toast("Task deleted", { action: { label: "Undo", onClick } })
export const useToast = () => useContext(ToastContext);

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const nextId = useRef(1);

  const dismiss = useCallback((id) => setToasts((list) => list.filter((t) => t.id !== id)), []);

  const push = useCallback(
    (message, { tone = "success", action = null, duration } = {}) => {
      const id = nextId.current++;
      setToasts((list) => [...list.slice(-3), { id, message, tone, action }]);
      setTimeout(() => dismiss(id), duration ?? (action ? 6500 : tone === "error" ? 5500 : 3500));
    },
    [dismiss]
  );

  const value = useMemo(() => push, [push]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast toast-${t.tone}`}>
            <Icon name={t.tone === "error" ? "alert" : "check"} size={18} />
            <span className="toast-text">{t.message}</span>
            {t.action && (
              <button
                className="toast-action"
                onClick={() => {
                  t.action.onClick();
                  dismiss(t.id);
                }}
              >
                {t.action.label}
              </button>
            )}
            <button className="toast-close" aria-label="Dismiss" onClick={() => dismiss(t.id)}>
              <Icon name="close" size={16} />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}