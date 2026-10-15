"use client";
import { useState } from "react";
import type { Account } from "@/lib/shared/schema";
import {
  money,
  type PlanCatalog,
  defaultCatalog,
} from "@/lib/shared/plan-management";
import { plans, type Subscription } from "@/lib/shared/plans";
export function PlanPanel({
  subscription,
  catalog = defaultCatalog,
  accounts,
  owner,
  busy,
  onRequestPro,
  onEssential,
}: {
  subscription: Subscription;
  catalog?: PlanCatalog;
  accounts: Account[];
  owner: boolean;
  busy: boolean;
  onRequestPro: () => void;
  onEssential: (accountId: string | null) => void;
}) {
  const available = accounts.filter(
    (account) => account.status !== "disconnected",
  );
  const [primary, setPrimary] = useState(
    available.find((account) => !account.planPaused)?.id ??
      available[0]?.id ??
      "",
  );
  const selectedPrimary = available.some((account) => account.id === primary)
    ? primary
    : (available.find((account) => !account.planPaused)?.id ??
      available[0]?.id ??
      "");
  return (
    <section className="settingbox plan-panel">
      <h2>
        {subscription.status === "suspended"
          ? "Assinatura suspensa"
          : `Seu plano: ${plans[subscription.plan].name}`}
      </h2>
      <p>
        {accounts.filter((account) => !account.planPaused).length} de{" "}
        {plans[subscription.plan].accountLimit} contas em uso.
      </p>
      <div className="plan-options">
        <article>
          <h3>Essencial</h3>
          <strong>1 conta do Instagram</strong>
          {catalog.essential.published && (
            <>
              <p>
                {money(catalog.essential.monthlyCents)} / mês ·{" "}
                {money(catalog.essential.yearlyCents)} / ano
              </p>
              <p>{catalog.essential.description}</p>
            </>
          )}
          <p>Organize publicações, calendário e seguidores de uma conta.</p>
        </article>
        <article>
          <h3>Pro</h3>
          <strong>Até 3 contas do Instagram</strong>
          {catalog.pro.published && (
            <>
              <p>
                {money(catalog.pro.monthlyCents)} / mês ·{" "}
                {money(catalog.pro.yearlyCents)} / ano
              </p>
              <p>{catalog.pro.description}</p>
            </>
          )}
          <p>
            Alterne entre suas contas, veja o calendário conjunto e copie
            conteúdo para outra conta.
          </p>
        </article>
      </div>
      {subscription.status === "suspended" ? (
        <p className="info-alert">
          Entre em contato com a administração para reativar sua assinatura.
        </p>
      ) : (
        subscription.plan === "essential" &&
        <>
          <button
            disabled={busy || !owner}
            className="gradientbtn"
            onClick={onRequestPro}
          >
            Migrar para o Pro
          </button>
          <p className="lightnote">
            Ativação imediata, sem cobrança nesta etapa.
          </p>
        </>

      )}
      {subscription.plan === "pro" && owner && (
        <div className="plan-downgrade">
          <h3>Voltar ao Essencial</h3>
          <p>
            Escolha a conta que continuará ativa. As demais ficam pausadas, com
            os dados preservados. Os agendamentos dessas contas não serão
            enviados enquanto estiverem pausadas.
          </p>
          {available.length > 0 && (
            <select
              className="proselect"
              aria-label="Conta que permanece no Essencial"
              value={selectedPrimary}
              onChange={(event) => setPrimary(event.target.value)}
            >
              {available.map((account) => (
                <option key={account.id} value={account.id}>
                  @{account.username}
                </option>
              ))}
            </select>
          )}
          <button
            className="linebutton"
            disabled={busy || (available.length > 0 && !selectedPrimary)}
            onClick={() => {
              if (
                confirm(
                  "Voltar ao Essencial? Somente a conta escolhida continuará ativa. As demais contas e seus agendamentos ficarão pausados.",
                )
              )
                onEssential(selectedPrimary || null);
            }}
          >
            Confirmar mudança para Essencial
          </button>
        </div>
      )}
      {!owner && (
        <p className="lightnote">
          O proprietário deste perfil gerencia a assinatura.
        </p>
      )}
    </section>
  );
}
