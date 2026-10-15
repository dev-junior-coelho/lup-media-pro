"use client";
import { useRef, useState } from "react";
import {
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  sendPasswordResetEmail,
} from "firebase/auth";
import { Instagram, ArrowRight, ShieldCheck } from "lucide-react";
import { firebaseClient } from "@/lib/firebase-client";
export function Auth() {
  const [mode, setMode] = useState<"login" | "signup" | "reset">("login"),
    [email, setEmail] = useState(""),
    [password, setPassword] = useState(""),
    [error, setError] = useState(""),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const configured = Boolean(
    process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID &&
    process.env.NEXT_PUBLIC_FIREBASE_API_KEY &&
    process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  );
  function changeMode(next: typeof mode) {
    if (pending.current) return;
    setMode(next);
    setError("");
    setMessage("");
  }
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (pending.current || !configured) return;
    pending.current = true;
    setError("");
    setMessage("");
    setBusy(true);
    try {
      const auth = firebaseClient()!.auth;
      if (mode === "reset") {
        await sendPasswordResetEmail(auth, email.trim());
        setMessage(
          "Se houver uma conta para esse e-mail, você receberá as instruções.",
        );
      } else if (mode === "signup")
        await createUserWithEmailAndPassword(auth, email.trim(), password);
      else await signInWithEmailAndPassword(auth, email.trim(), password);
    } catch (error) {
      const code = (error as { code?: string }).code;
      const messages: Record<string, string> = {
        "auth/invalid-credential":
          "E-mail ou senha incorretos. Confira os dados e tente novamente.",
        "auth/email-already-in-use":
          "Não foi possível criar a conta. Tente entrar ou recuperar sua senha.",
        "auth/weak-password": "Escolha uma senha com pelo menos 8 caracteres.",
        "auth/too-many-requests":
          "Muitas tentativas. Aguarde alguns minutos e tente novamente.",
        "auth/network-request-failed":
          "Não foi possível conectar. Verifique sua internet e tente novamente.",
      };
      setError(
        messages[code ?? ""] ??
          (mode === "reset"
            ? "Não foi possível solicitar a recuperação. Tente novamente."
            : mode === "signup"
              ? "Não foi possível criar a conta. Tente novamente."
              : "Não foi possível entrar. Tente novamente em instantes."),
      );
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }
  return (
    <main className="auth-shell">
      <section className="procard auth-card">
        <div className="logo">
          <Instagram size={30} />
        </div>
        <h1>LUP Media Pro</h1>
        <p>
          Seu conteúdo, seus seguidores.
          <br />
          Tudo organizado em um só lugar.
        </p>
        {!configured && (
          <div className="info-alert">
            O acesso está temporariamente indisponível. A configuração do
            serviço precisa ser concluída.
          </div>
        )}
        <form onSubmit={submit}>
          <h2>
            {mode === "login"
              ? "Entrar na sua conta"
              : mode === "signup"
                ? "Criar sua conta"
                : "Recuperar senha"}
          </h2>
          <label htmlFor="email">E-mail</label>
          <input
            id="email"
            className="proinput"
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          {mode !== "reset" && (
            <>
              <label htmlFor="password">Senha</label>
              <input
                id="password"
                className="proinput"
                type="password"
                minLength={mode === "signup" ? 8 : 1}
                required
                autoComplete={
                  mode === "signup" ? "new-password" : "current-password"
                }
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </>
          )}
          {error && (
            <div role="alert" className="error-alert">
              {error}
            </div>
          )}
          {message && (
            <div role="status" className="success-alert">
              {message}
            </div>
          )}
          <button
            disabled={!configured || busy}
            className="gradientbtn fullwidth button-icon"
          >
            {busy
              ? "Aguarde…"
              : mode === "login"
                ? "Entrar"
                : mode === "signup"
                  ? "Cadastrar"
                  : "Enviar recuperação"}
            <ArrowRight size={16} />
          </button>
        </form>
        <div className="flex">
          <button
            className="qsmall"
            disabled={busy}
            onClick={() => changeMode(mode === "signup" ? "login" : "signup")}
          >
            {mode === "signup" ? "Já tenho conta" : "Criar conta"}
          </button>
          <button
            className="qsmall"
            disabled={busy}
            onClick={() => changeMode(mode === "reset" ? "login" : "reset")}
          >
            {mode === "reset" ? "Voltar ao login" : "Esqueci minha senha"}
          </button>
        </div>
        <p className="button-icon">
          <ShieldCheck size={15} />
          LUP Soluções Inteligentes
        </p>
      </section>
    </main>
  );
}
