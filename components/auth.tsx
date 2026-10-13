"use client";
import { useState } from "react";
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
  const configured = !!process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setMessage("");
    setBusy(true);
    try {
      const auth = firebaseClient()!.auth;
      if (mode === "reset") {
        await sendPasswordResetEmail(auth, email);
        setMessage(
          "Se houver uma conta para esse e-mail, você receberá as instruções.",
        );
      } else if (mode === "signup")
        await createUserWithEmailAndPassword(auth, email, password);
      else await signInWithEmailAndPassword(auth, email, password);
    } catch {
      setError(
        mode === "reset"
          ? "Não foi possível solicitar a recuperação. Tente novamente."
          : "Não foi possível entrar. Verifique os dados e a configuração do Firebase.",
      );
    } finally {
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
            Firebase independente ainda não configurado. Defina as variáveis do
            projeto para habilitar login e persistência.
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
                minLength={8}
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
            onClick={() => {
              setMode(mode === "signup" ? "login" : "signup");
              setError("");
            }}
          >
            {mode === "signup" ? "Já tenho conta" : "Criar conta"}
          </button>
          <button
            className="qsmall"
            onClick={() => {
              setMode(mode === "reset" ? "login" : "reset");
              setError("");
            }}
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
