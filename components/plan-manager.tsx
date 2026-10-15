"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { request } from "@/lib/client-api";
import { plans, type PlanId } from "@/lib/shared/plans";
import {
  money,
  parsePrice,
  type ManagedProfile,
  type PlanCatalog,
  type PlanManagerData,
} from "@/lib/shared/plan-management";
import { displayDate } from "@/lib/shared/presentation";
const statusLabels = {
  active: "Ativa",
  cancelled: "Cancelada · Essencial disponível",
  suspended: "Suspensa",
};
interface AuditEvent {
  id: string;
  action: string;
  at: string;
  plan?: PlanId;
  status?: string;
  reason?: string;
}
const actionLabels: Record<string, string> = {
  subscription_changed: "Assinatura alterada",
  pro_requested: "Pro solicitado",
  pro_declined: "Solicitação não aprovada",
  catalog_updated: "Preços atualizados",
};
export function PlanManager({
  onSelfChange,
}: {
  onSelfChange: () => Promise<void>;
}) {
  const [data, setData] = useState<PlanManagerData | null>(null),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [view, setView] = useState("all"),
    [search, setSearch] = useState(""),
    [appliedSearch, setAppliedSearch] = useState(""),
    [cursor, setCursor] = useState<string | null>(null),
    [selected, setSelected] = useState<ManagedProfile | null>(null),
    [tab, setTab] = useState("clients"),
    [saving, setSaving] = useState(false);
  const version = useRef(0),
    pending = useRef(false);
  const load = useCallback(async () => {
    const sequence = ++version.current;
    setLoading(true);
    setError("");
    const query = new URLSearchParams({ view });
    if (cursor) query.set("cursor", cursor);
    if (appliedSearch) query.set("search", appliedSearch);
    try {
      const result = await request<PlanManagerData>(
        `admin/plan-manager?${query}`,
      );
      if (version.current === sequence) {
        setData(result);
        setSelected((current) =>
          current
            ? (result.profiles.find((profile) => profile.id === current.id) ??
              null)
            : null,
        );
      }
    } catch (error) {
      if (version.current === sequence) {
        setError((error as Error).message);
        setData(null);
      }
    } finally {
      if (version.current === sequence) setLoading(false);
    }
  }, [view, cursor, appliedSearch]);
  const invalidate = useCallback(() => {
    ++version.current;
  }, []);
  useEffect(() => {
    const timer = setTimeout(() => void load(), 0);
    return () => {
      clearTimeout(timer);
      invalidate();
    };
  }, [load, invalidate]);
  async function change(
    profile: ManagedProfile,
    value: {
      plan: PlanId;
      status: "active" | "cancelled" | "suspended";
      activeAccountIds: string[];
      reason: string;
    },
  ) {
    if (pending.current) return;
    pending.current = true;
    setSaving(true);
    setError("");
    setNotice("");
    try {
      await request(`admin/subscriptions/${profile.id}`, "PUT", {
        ...value,
        expectedRevision: profile.revision,
        ...(value.plan === "pro" &&
        value.status === "active" &&
        profile.request?.status === "pending"
          ? { requestId: profile.request.id }
          : {}),
      });
      setSelected(null);
      setNotice(
        "Assinatura atualizada. A alteração não gera cobrança automática.",
      );
      await Promise.all([load(), onSelfChange()]);
    } catch (error) {
      setError((error as Error).message);
    } finally {
      pending.current = false;
      setSaving(false);
    }
  }
  async function decline(profile: ManagedProfile, message: string) {
    if (pending.current || !profile.request) return;
    pending.current = true;
    setSaving(true);
    setError("");
    setNotice("");
    try {
      await request(`admin/subscriptions/${profile.id}/decline`, "POST", {
        requestId: profile.request.id,
        message,
      });
      setSelected(null);
      setNotice(
        "Solicitação respondida. A mensagem ficará disponível na conta do cliente.",
      );
      await load();
      await onSelfChange();
    } catch (error) {
      setError((error as Error).message);
    } finally {
      pending.current = false;
      setSaving(false);
    }
  }
  async function saveCatalog(catalog: PlanCatalog) {
    if (pending.current) return;
    pending.current = true;
    setSaving(true);
    setError("");
    setNotice("");
    try {
      const result = await request<{ catalog: PlanCatalog }>(
        "admin/plan-catalog",
        "PUT",
        catalog,
      );
      setData((current) =>
        current ? { ...current, catalog: result.catalog } : current,
      );
      setNotice(
        "Preços salvos. Os valores publicados aparecem em Plano e contas.",
      );
      await onSelfChange();
    } catch (error) {
      setError((error as Error).message);
    } finally {
      pending.current = false;
      setSaving(false);
    }
  }
  return (
    <div className="plan-manager">
      <div className="info-alert">
        Administração da plataforma · As alterações abaixo afetam os planos dos
        clientes. A migração feita pelo cliente é imediata. Nenhuma cobrança é realizada nesta etapa.
      </div>
      {error && (
        <div className="error-alert" role="alert">
          {error}
          <button
            className="qsmall"
            onClick={() => void load()}
            disabled={saving}
          >
            Atualizar lista
          </button>
        </div>
      )}
      {notice && (
        <div className="success-alert" role="status">
          {notice}
        </div>
      )}
      <div
        className="togglegroup toolbar"
        role="tablist"
        aria-label="Gestor de planos"
      >
        <button
          role="tab"
          aria-selected={tab === "clients"}
          className={`typechoice ${tab === "clients" ? "active" : ""}`}
          disabled={saving}
          onClick={() => setTab("clients")}
        >
          Clientes e migrações
        </button>
        <button
          role="tab"
          aria-selected={tab === "prices"}
          className={`typechoice ${tab === "prices" ? "active" : ""}`}
          disabled={saving}
          onClick={() => setTab("prices")}
        >
          Preços dos planos
        </button>
      </div>
      {tab === "clients" ? (
        <>
          <div className="dashboardcards manager-stats">
            <div className="metric">
              <strong>{data?.stats.totalProfiles ?? "—"}</strong>
              <p>Perfis cadastrados</p>
            </div>
            <div className="metric">
              <strong>{data?.stats.migratedProfiles ?? "—"}</strong>
              <p>Clientes que migraram de plano</p>
            </div>
          </div>
          <form
            className="toolbar"
            onSubmit={(event) => {
              event.preventDefault();
              setCursor(null);
              setView("all");
              if (appliedSearch === search.trim() && !cursor && view === "all")
                void load();
              else setAppliedSearch(search.trim());
              setSelected(null);
            }}
          >
            <input
              className="proinput"
              aria-label="E-mail do cliente"
              type="email"
              placeholder="Buscar pelo e-mail completo"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              disabled={saving}
            />
            <button className="linebutton" disabled={saving || loading}>
              Buscar cliente
            </button>
            <button
              type="button"
              className="qsmall"
              disabled={saving || loading}
              onClick={() => {
                setSearch("");
                setAppliedSearch("");
                setCursor(null);
              }}
            >
              Limpar busca
            </button>
            <select
              className="proselect"
              aria-label="Exibir clientes"
              disabled={saving}
              value={view}
              onChange={(event) => {
                setView(event.target.value);
                setCursor(null);
                setSelected(null);
                setAppliedSearch("");
                setSearch("");
              }}
            >
              <option value="all">Todos os clientes</option>
              <option value="migrations">Migrações mais recentes</option>
              <option value="requests">Solicitações antigas pendentes</option>
            </select>
            <button
              type="button"
              className="qsmall"
              disabled={saving || loading}
              onClick={() => void load()}
            >
              Atualizar
            </button>
          </form>
          {loading ? (
            <p role="status">Carregando clientes…</p>
          ) : selected ? (
            <SubscriptionEditor
              key={`${selected.id}:${selected.revision}`}
              profile={selected}
              saving={saving}
              onCancel={() => setSelected(null)}
              onSave={(value) => change(selected, value)}
              onDecline={(message) => decline(selected, message)}
            />
          ) : (
            <div className="managed-profiles">
              {data?.profiles.map((profile) => (
                <article className="procard managed-profile" key={profile.id}>
                  <div>
                    <h2>{profile.ownerName || profile.name}</h2>
                    <p className="managed-email">{profile.email}</p>
                    {profile.ownerName && (
                      <p className="mutedcopy">{profile.name}</p>
                    )}
                  </div>
                  <div>
                    <span className="statuspill">
                      {plans[profile.assignedPlan].name}
                    </span>
                    <p>{statusLabels[profile.subscription.status]}</p>
                    <p className="mutedcopy">
                      {
                        profile.accounts.filter(
                          (account) => !account.planPaused,
                        ).length
                      }{" "}
                      contas ativas
                    </p>
                  </div>
                  {profile.lastPlanMigration && (
                    <p className="info-alert">
                      Cliente migrou de {plans[profile.lastPlanMigration.from].name} para{" "}
                      {plans[profile.lastPlanMigration.to].name} em{" "}
                      {displayDate(profile.lastPlanMigration.at, "America/Bahia")}.
                    </p>
                  )}
                  {profile.request?.status === "pending" && (
                    <p className="info-alert">
                      Pro solicitado em{" "}
                      {displayDate(profile.request.createdAt, "America/Bahia")}
                    </p>
                  )}
                  <button
                    className="linebutton"
                    onClick={() => {
                      setSelected(profile);
                      setError("");
                      setNotice("");
                    }}
                  >
                    Gerenciar assinatura
                  </button>
                </article>
              ))}
              {!data?.profiles.length && (
                <p className="procard empty-state">
                  {appliedSearch
                    ? "Nenhum cliente encontrado com esse e-mail."
                    : view === "migrations"
                      ? "Nenhuma migração registrada."
                    : view === "requests"
                      ? "Nenhuma solicitação pendente."
                      : "Nenhum cliente cadastrado."}
                </p>
              )}
              <div className="flex">
                <button
                  className="linebutton"
                  disabled={!cursor || saving}
                  onClick={() => setCursor(null)}
                >
                  Primeira página
                </button>
                {data?.nextCursor && (
                  <button
                    className="linebutton"
                    onClick={() => {
                      setCursor(data.nextCursor);
                      setSelected(null);
                    }}
                  >
                    Próxima página
                  </button>
                )}
              </div>
            </div>
          )}
        </>
      ) : loading ? (
        <p role="status">Carregando preços…</p>
      ) : (
        data && (
          <CatalogEditor
            key={data.catalog.revision}
            catalog={data.catalog}
            saving={saving}
            onSave={saveCatalog}
          />
        )
      )}
    </div>
  );
}
function SubscriptionEditor({
  profile,
  saving,
  onCancel,
  onSave,
  onDecline,
}: {
  profile: ManagedProfile;
  saving: boolean;
  onCancel: () => void;
  onSave: (value: {
    plan: PlanId;
    status: "active" | "cancelled" | "suspended";
    activeAccountIds: string[];
    reason: string;
  }) => Promise<void>;
  onDecline: (message: string) => Promise<void>;
}) {
  const [plan, setPlan] = useState<PlanId>(
      profile.request?.status === "pending" ? "pro" : profile.assignedPlan,
    ),
    [status, setStatus] = useState(profile.subscription.status),
    [ids, setIds] = useState(
      profile.accounts
        .filter((account) => !account.planPaused)
        .map((account) => account.id),
    ),
    [reason, setReason] = useState(""),
    [message, setMessage] = useState(""),
    [confirmed, setConfirmed] = useState(false),
    [events, setEvents] = useState<AuditEvent[] | null>(null),
    [historyError, setHistoryError] = useState("");
  const limit =
    status === "suspended"
      ? 0
      : plans[status === "cancelled" ? "essential" : plan].accountLimit;
  const available = profile.accounts.filter(
    (account) => account.status !== "disconnected",
  );
  const selectedIds = status === "suspended" ? [] : ids;
  const valid =
    selectedIds.length <= limit &&
    (status === "suspended" ||
      available.length === 0 ||
      selectedIds.length > 0);
  function choosePlan(value: PlanId) {
    setPlan(value);
    setConfirmed(false);
  }
  return (
    <section className="procard subscription-editor">
      <div className="protitle">
        <div>
          <h2>Assinatura de {profile.ownerName || profile.name}</h2>
          <p>{profile.email}</p>
        </div>
        <button className="qsmall" disabled={saving} onClick={onCancel}>
          Voltar à lista
        </button>
      </div>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (valid && confirmed)
            void onSave({
              plan,
              status,
              activeAccountIds: selectedIds,
              reason,
            });
        }}
      >
        <div className="formrow">
          <div>
            <label className="formlabel" htmlFor="managed-plan">
              Plano
            </label>
            <select
              className="proselect"
              id="managed-plan"
              value={plan}
              disabled={saving}
              onChange={(event) => choosePlan(event.target.value as PlanId)}
            >
              <option value="essential">Essencial · 1 conta</option>
              <option value="pro">Pro · até 3 contas</option>
            </select>
          </div>
          <div>
            <label className="formlabel" htmlFor="managed-status">
              Situação da assinatura
            </label>
            <select
              className="proselect"
              id="managed-status"
              value={status}
              disabled={saving}
              onChange={(event) => {
                setStatus(event.target.value as typeof status);
                setConfirmed(false);
              }}
            >
              <option value="active">Ativa</option>
              <option value="cancelled">Cancelada · manter Essencial</option>
              <option value="suspended">
                Suspensa · pausar todas as contas
              </option>
            </select>
          </div>
        </div>
        <fieldset
          disabled={saving || status === "suspended"}
          className="managed-accounts"
        >
          <legend>Contas que ficam ativas · limite {limit}</legend>
          {available.map((account) => (
            <label key={account.id} className="managed-checkbox">
              <input
                type="checkbox"
                checked={selectedIds.includes(account.id)}
                onChange={(event) => {
                  setIds((current) =>
                    event.target.checked
                      ? [...current, account.id]
                      : current.filter((id) => id !== account.id),
                  );
                  setConfirmed(false);
                }}
              />
              @{account.username}
            </label>
          ))}
          {!available.length && <p>Nenhuma conta do Instagram conectada.</p>}
        </fieldset>
        {!valid && (
          <p className="error-alert">
            Escolha de uma a {limit} contas para este plano.
          </p>
        )}
        <p className="info-alert">
          Contas fora da seleção ficam pausadas, com os dados preservados.
          Reativar contas retoma seus agendamentos, inclusive horários vencidos.
          Envios em andamento precisam terminar antes de uma pausa.
        </p>
        <label className="formlabel" htmlFor="managed-reason">
          Motivo da alteração (registro interno)
        </label>
        <textarea
          className="protextarea"
          id="managed-reason"
          required
          minLength={3}
          maxLength={500}
          value={reason}
          disabled={saving}
          onChange={(event) => {
            setReason(event.target.value);
            setConfirmed(false);
          }}
        />
        <label className="managed-checkbox">
          <input
            type="checkbox"
            checked={confirmed}
            disabled={saving}
            onChange={(event) => setConfirmed(event.target.checked)}
          />
          Conferi o cliente, o plano e as contas. Esta alteração não confirma
          nem realiza um pagamento.
        </label>
        <button
          className="gradientbtn"
          disabled={saving || !valid || !confirmed || reason.trim().length < 3}
        >
          Salvar assinatura
        </button>
      </form>
      {profile.request?.status === "pending" && (
        <form
          className="decline-request"
          onSubmit={(event) => {
            event.preventDefault();
            if (
              confirm(
                "Responder a solicitação sem ativar o Pro? O cliente verá a mensagem informada.",
              )
            )
              void onDecline(message);
          }}
        >
          <h3>Responder sem ativar o Pro</h3>
          <label className="formlabel" htmlFor="request-message">
            Mensagem ao cliente
          </label>
          <textarea
            className="protextarea"
            id="request-message"
            required
            minLength={3}
            maxLength={300}
            value={message}
            disabled={saving}
            onChange={(event) => setMessage(event.target.value)}
          />
          <button
            className="linebutton"
            disabled={saving || message.trim().length < 3}
          >
            Não aprovar solicitação
          </button>
        </form>
      )}
      <section className="plan-audit">
        <h3>Histórico desta assinatura</h3>
        <button
          className="qsmall"
          disabled={saving}
          onClick={() => {
            setHistoryError("");
            void request<{ events: AuditEvent[] }>(
              `admin/subscriptions/${profile.id}/history`,
            )
              .then((result) => setEvents(result.events))
              .catch((error) => setHistoryError(error.message));
          }}
        >
          Carregar histórico
        </button>
        {historyError && <p role="alert">{historyError}</p>}
        {events &&
          (!events.length ? (
            <p>Nenhuma alteração registrada.</p>
          ) : (
            <ul>
              {events.map((event) => (
                <li key={event.id}>
                  <strong>
                    {actionLabels[event.action] ?? "Atualização da assinatura"}
                  </strong>{" "}
                  · {displayDate(event.at, "America/Bahia")}
                  {event.plan && <span> · {plans[event.plan].name}</span>}
                  {event.reason && <p>{event.reason}</p>}
                </li>
              ))}
            </ul>
          ))}
      </section>
    </section>
  );
}
function CatalogEditor({
  catalog,
  saving,
  onSave,
}: {
  catalog: PlanCatalog;
  saving: boolean;
  onSave: (catalog: PlanCatalog) => Promise<void>;
}) {
  const [values, setValues] = useState(catalog),
    [prices, setPrices] = useState(
      () =>
        Object.fromEntries(
          (["essential", "pro"] as const).map((id) => [
            id,
            {
              monthly:
                catalog[id].monthlyCents === null
                  ? ""
                  : (catalog[id].monthlyCents! / 100)
                      .toFixed(2)
                      .replace(".", ","),
              yearly:
                catalog[id].yearlyCents === null
                  ? ""
                  : (catalog[id].yearlyCents! / 100)
                      .toFixed(2)
                      .replace(".", ","),
            },
          ]),
        ) as Record<PlanId, { monthly: string; yearly: string }>,
    ),
    [error, setError] = useState("");
  return (
    <form
      className="procard catalog-editor"
      onSubmit={(event) => {
        event.preventDefault();
        setError("");
        try {
          const next = { ...values };
          for (const id of ["essential", "pro"] as const)
            next[id] = {
              ...values[id],
              monthlyCents: parsePrice(prices[id].monthly),
              yearlyCents: parsePrice(prices[id].yearly),
            };
          void onSave(next);
        } catch (error) {
          setError((error as Error).message);
        }
      }}
    >
      <h2>Preços dos planos</h2>
      <p>
        Defina os valores em reais. Deixe em branco para exibir “Sob consulta”.
        Os limites continuam sendo uma conta no Essencial e até três no Pro.
      </p>
      <div className="plan-options">
        {(["essential", "pro"] as const).map((id) => (
          <section key={id} className="catalog-plan">
            <h3>{plans[id].name}</h3>
            <label className="formlabel" htmlFor={`${id}-monthly`}>
              Mensalidade do {plans[id].name} (R$)
            </label>
            <input
              className="proinput"
              id={`${id}-monthly`}
              inputMode="decimal"
              value={prices[id].monthly}
              disabled={saving}
              onChange={(event) =>
                setPrices((current) => ({
                  ...current,
                  [id]: { ...current[id], monthly: event.target.value },
                }))
              }
            />
            <label className="formlabel" htmlFor={`${id}-yearly`}>
              Valor anual do {plans[id].name} (R$)
            </label>
            <input
              className="proinput"
              id={`${id}-yearly`}
              inputMode="decimal"
              value={prices[id].yearly}
              disabled={saving}
              onChange={(event) =>
                setPrices((current) => ({
                  ...current,
                  [id]: { ...current[id], yearly: event.target.value },
                }))
              }
            />
            <label className="formlabel" htmlFor={`${id}-description`}>
              Descrição do {plans[id].name}
            </label>
            <textarea
              className="protextarea"
              id={`${id}-description`}
              maxLength={240}
              disabled={saving}
              value={values[id].description}
              onChange={(event) =>
                setValues((current) => ({
                  ...current,
                  [id]: { ...current[id], description: event.target.value },
                }))
              }
            />
            <label className="managed-checkbox">
              <input
                type="checkbox"
                checked={values[id].published}
                disabled={saving}
                onChange={(event) =>
                  setValues((current) => ({
                    ...current,
                    [id]: { ...current[id], published: event.target.checked },
                  }))
                }
              />
              Exibir preços do {plans[id].name} aos clientes
            </label>
            <p className="mutedcopy">
              Atual: {money(catalog[id].monthlyCents)} / mês ·{" "}
              {money(catalog[id].yearlyCents)} / ano
            </p>
          </section>
        ))}
      </div>
      {error && (
        <p className="error-alert" role="alert">
          {error}
        </p>
      )}
      <p className="info-alert">
        Os preços publicados são informativos. Salvar aqui não cobra clientes
        nem altera contratos já confirmados.
      </p>
      <button className="gradientbtn" disabled={saving}>
        Salvar preços dos planos
      </button>
    </form>
  );
}
