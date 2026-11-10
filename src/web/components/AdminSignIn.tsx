/** The admin's sign-in, and the first-visit setup with the code from Hearth's log. */
import { useState } from "react";
import { api } from "../lib/api";
import { useRefresh } from "../lib/queries";
import { Button, ErrorNote, Field, Input, Modal } from "./ui";

export function AdminSignIn({
  open,
  onClose,
  needsSetup,
}: {
  open: boolean;
  onClose: () => void;
  needsSetup: boolean;
}) {
  const refresh = useRefresh();
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [again, setAgain] = useState("");
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (needsSetup && password !== again) {
      setError(new Error("The two passwords don't match."));
      return;
    }
    setBusy(true);
    try {
      if (needsSetup) await api.post("/api/setup", { code, password });
      else await api.post("/api/login", { password });
      setPassword("");
      setAgain("");
      await refresh();
      onClose();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={needsSetup ? "Set up the admin" : "Sign in as the admin"}
    >
      <form onSubmit={submit} className="grid gap-4">
        {needsSetup ? (
          <>
            <p className="text-sm text-muted">
              Choose the password that lets you change Hearth. To prove it's you, enter the
              six-digit setup code from Hearth's log (in Container Manager, open the <b>hearth</b>{" "}
              container's log; in development, the terminal).
            </p>
            <Field label="Setup code">
              {(id) => (
                <Input
                  id={id}
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  required
                />
              )}
            </Field>
          </>
        ) : null}
        <Field
          label={needsSetup ? "New password" : "Password"}
          hint={needsSetup ? "At least 8 characters." : undefined}
        >
          {(id) => (
            <Input
              id={id}
              type="password"
              autoComplete={needsSetup ? "new-password" : "current-password"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          )}
        </Field>
        {needsSetup ? (
          <Field label="Password again">
            {(id) => (
              <Input
                id={id}
                type="password"
                autoComplete="new-password"
                value={again}
                onChange={(e) => setAgain(e.target.value)}
                required
              />
            )}
          </Field>
        ) : null}
        <ErrorNote error={error} />
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" busy={busy}>
            {needsSetup ? "Set password" : "Sign in"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
